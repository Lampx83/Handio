# Tự chẩn đoán và báo cáo chất lượng

Mục tiêu: hệ thống **tự phát hiện vấn đề** (lỗi mô hình/cổng, công cụ hỏng, agent lặp, chậm…) để liên tục cải tiến, mà **không thu nội dung** của người dùng.

## 1. Nguyên tắc

1. **Không chứa nội dung ngay từ cấu trúc.** Gói gửi đi chỉ gồm các trường trong lược đồ (`deploy/220/diag/schema.json`, trùng `DIAG_SCHEMA` trong `packages/core/src/diagnostics.ts`). Bộ lọc là *danh sách cho phép* theo từng trường; trường lạ, giá trị lạ bị bỏ; tên công cụ lạ/tên mô hình giống khoá thành `other`. Có test nhét bí mật/đường dẫn/email vào mọi chỗ và chứng minh không lọt ra (`packages/core/test/diagnostics.test.ts`, `deploy/220/diag/test_collector.py`).
2. **Danh tính chỉ do máy chủ gắn:** `uid = HMAC-SHA256(bí mật máy chủ, email SSO)[:16 hex]` từ header `X-User-Email` mà nginx đặt (máy khách không tự khai được). Email không được lưu, không vào nhật ký. Đây là *giả danh*, không phải ẩn danh tuyệt đối.
3. **Mặc định bật khi ứng dụng được cấu hình điểm nhận** (hệ thống nội bộ, sau SSO). Tắt bằng `Settings.diagnostics=false` (công tắc trong Cài đặt) hoặc quản trị viên ép tắt bằng `policy.json` → `"diagnostics": false`. **Chưa cấu hình `diagnostics` ở controller = không ghi, không gửi gì.**
4. **Không bao giờ làm chậm/hỏng agent:** ghi đồng bộ O(1), gửi nền theo lô, lùi dần khi lỗi (30 s … 30 phút), bộ đệm vòng 500 sự kiện, mọi lỗi gửi đều im lặng, không theo chuyển hướng.

## 2. Thu thập gì

| Sự kiện | Trường (tất cả là mã/số/boolean) |
|---|---|
| `turn` (mỗi lượt làm việc) | `end` (ok/interrupted/error/step_limit/loop), `dur_s`, `ttft_ms`, `steps`, `tools`, `tool_fail`, `prompt_tok`, `completion_tok`, `ctx_pct`, `compactions`, `perm_allow`, `perm_deny` |
| `tool` | `name` (danh sách cố định, `mcp`, `other`), `ok`, `dur` (lt1s/lt5s/lt30s/lt2m/ge2m) |
| `llm_error` | `kind` (context/auth/rate/server/network/insecure/unexpected/other), `status` (mã HTTP) |
| `llm_retry` | `kind` (network/rate/server) |
| `signal` | `code` (loop, step_limit, repeat_tool_fail, slow_first_token, slow_turn, ctx_high, early_interrupt, perm_denied, empty_output, invalid_tool_args, unknown_tool, truncated, context_overflow), `tool`, `n` |
| `report` | `note`: ghi chú ≤500 ký tự **do người dùng gõ khi bấm “Báo lỗi”** (xem trước đúng gói sẽ gửi) |
| Chung | `ts`; app: mã cài ngẫu nhiên 32 hex, `version`, `build`, `platform` (web/mac/win), `profile` (work/code/design), `model` |

**Không bao giờ:** câu hỏi, câu trả lời, tên/đường dẫn/nội dung tệp, dòng lệnh, URL, thông điệp lỗi của công cụ, key, email, IP, User-Agent. Ngoại lệ duy nhất là `note` của “Báo lỗi” (văn bản tự do của người dùng, nhắc họ đừng dán dữ liệu nhạy cảm).

Phía nginx, nhật ký `/var/log/nginx/neu-agent-access.json.log` chỉ có: giờ, mã trạng thái, phương thức, *nhóm* đường dẫn (`vllm_chat`, `ui`, `diag`…), `$request_time`, `$upstream_response_time`, dung lượng. Không query string, cookie, Authorization, email, IP. Giữ 14 ngày.

## 3. Luồng dữ liệu

```
ứng dụng ─POST /agent/diag (SSO)─▶ nginx ─X-User-Email─▶ collector.py (127.0.0.1:4190) ─▶ /var/lib/neu-agent/diag/YYYY-MM-DD.jsonl (0600, xoá sau 90 ngày)
nginx JSON log ──┐
diag JSONL ──────┴─▶ report.py (hằng ngày 06:30) ─▶ /var/lib/neu-agent/reports/{YYYY-MM-DD,latest}.{md,html,json}
healthz.py (5 phút) ─▶ /var/lib/neu-agent/health.json (+ /var/log/neu-agent/health.log khi lỗi) ─▶ /agent/healthz chỉ trả {"ok":true|false}
```

Bộ thu: tối đa 16 KB và 200 sự kiện mỗi gói, giới hạn tốc độ theo người dùng giả danh (burst 20, 12 yêu cầu/phút, 20 000 sự kiện/ngày), mỗi tệp ngày ≤100 MB.

## 4. Cài trên máy 220

```bash
sudo ./auth/install-auth.sh                                  # (đã có)
sudo ./install.sh <key mô hình>                              # nginx: đã gồm /agent/diag, /agent/admin/, /agent/healthz, nhật ký JSON
sudo ./diag/install-diag.sh --admin ban@neu.edu.vn           # người dùng neu-diag, dịch vụ, timer, logrotate; tự kiểm tra, tự khôi phục nếu lỗi
```

- Chạy lại script để cập nhật (an toàn lặp lại, sao lưu ở `/var/backups/neu-agent-diag/`). `--uninstall` gỡ dịch vụ (giữ dữ liệu và bí mật).
- Bí mật HMAC: `/etc/neu-agent/diag-secret` (tạo một lần; **đổi nó = mã người dùng cũ không còn khớp**).
- Quản trị viên xem báo cáo: danh sách ở `/etc/neu-agent/admins.txt` (mỗi dòng một email); sửa xong `sudo systemctl restart neu-agent-diag`. Xem tại `https://ai.neu.edu.vn/agent/admin/` (nginx xác thực SSO, bộ thu đối chiếu email, CSP chặt, không tài nguyên ngoài). Không phải quản trị viên → 403.
- Chạy báo cáo ngay: `sudo systemctl start neu-agent-diag-report.service`; xem `latest.md` trong `/var/lib/neu-agent/reports/`.
- Sức khoẻ: `cat /var/lib/neu-agent/health.json`, `tail /var/log/neu-agent/health.log`, `curl https://ai.neu.edu.vn/agent/healthz`. Công cụ giám sát ngoài chỉ cần gọi `/agent/healthz` (200 `{"ok":true}`; 503 `{"ok":false}` khi có kiểm tra lỗi hoặc dữ liệu sức khoẻ cũ hơn 15 phút).
- Gợi ý bằng mô hình (tuỳ chọn): đặt key vào `/etc/neu-agent/llm-key` (600) rồi chạy lại `install-diag.sh`. Chỉ gửi **số liệu tổng hợp** (không sự kiện thô, không chuỗi tự do) tới `http://192.0.2.10:8037`; kết quả là *bản nháp* ghi rõ cần người kiểm tra.
- Lưu ý: `access_log` của máy chủ ảo này nay chỉ ghi JSON ở tệp trên (không còn ghi vào `access.log` chung).

## 4b. Trang quản trị tổng quan — `https://ai.neu.edu.vn/agent/admin/`

Chỉ email trong `/etc/neu-agent/admins.txt` mới xem được. Trang mặc định (`index.html`, do `deploy/220/diag/stats.py` tạo, **tự làm mới mỗi 10 phút** bởi `neu-agent-diag-stats.timer`) gồm:

- **Số người dùng**: 24 giờ / 7 ngày / 30 ngày / cả 90 ngày giữ dữ liệu; người dùng mới 7 ngày; tỷ lệ quay lại (tuần này so với tuần trước); số máy cài hoạt động.
- **Biểu đồ 30 ngày**: người dùng hoạt động, người dùng mới, lượt làm việc (kèm lượt lỗi), lệnh gọi mô hình qua nginx (kèm 5xx), lượt tải bản cài, lượt Desktop kiểm tra cập nhật; lượt làm việc theo giờ trong ngày (giờ VN).
- **Cơ cấu**: phiên bản, nền tảng, tab Work/Code/Design, mô hình (người dùng, máy, lượt).
- **Bảng người dùng** (100 người đầu theo số lượt 30 ngày): *mã giả danh* 8 ký tự, lần đầu/gần nhất, số ngày dùng, lượt, tab/nền tảng/phiên bản chính.
- Tình trạng hệ thống (`health.json`) và đường dẫn tới báo cáo chất lượng hằng ngày (`latest.html`) cùng `stats.json`.

Giới hạn cần biết: (1) chỉ thấy người **có gửi chẩn đoán** (tắt trong Cài đặt/`policy.json` thì không hiện); (2) người dùng chỉ là mã giả danh — không có email, đúng cam kết ở mục 1; muốn tra mã ứng với ai, tự tính `HMAC-SHA256(diag-secret, email_viết_thường)[:8 hex]` trên máy 220; (3) nhật ký nginx chỉ giữ 14 ngày nên số tải/lệnh gọi mô hình theo ngày được **cộng dồn từ lúc cài trang này** vào `reports/nginx-daily.json`; (4) lượt tải = yêu cầu HTTP 200 tới tệp `.dmg/.exe/...` (route nginx `download_pkg`; cần chạy lại `sudo ./install.sh <key>` để nginx có route này); (5) đổi `diag-secret` thì mã người dùng đổi theo.

Cập nhật: `sudo ./install.sh <key mô hình>` (nginx) rồi `sudo ./diag/install-diag.sh`; chạy ngay: `sudo systemctl start neu-agent-diag-stats.service`.

## 5. Đọc báo cáo

Mở `latest.html` (một tệp tĩnh). Từ trên xuống: các số chính; **“Phát hiện & đề xuất cải tiến”** (quy tắc theo ngưỡng, xếp cao → thấp, mỗi mục có *bằng chứng* và *đề xuất*); gợi ý của mô hình (nếu bật); **bất thường** so với 7 ngày trước (tăng ≥2 lần hoặc *mới xuất hiện*: loại lỗi, tín hiệu, phiên bản, mô hình, công cụ thất bại); bảng chi tiết (kết quả lượt, lỗi LLM, công cụ, tín hiệu, cổng mô hình p50/p95, độ trễ, phiên bản/nền tảng). Dưới `min_turns` lượt thì không kết luận về tỷ lệ. `$request_time` của luồng streaming gồm cả thời gian sinh văn bản (không phải chỉ token đầu).

Ngưỡng mặc định (`THRESHOLDS` trong `deploy/220/diag/report.py`; ghi đè bằng `--thresholds file.json`, thêm `--thresholds` vào ExecStart bằng drop-in):

| Quy tắc | Điều kiện |
|---|---|
| `turn_errors` | lỗi ≥5% lượt (≥15% = mức cao) |
| `gateway_5xx` | 5xx ≥2% (≥30 lệnh gọi) |
| `rate_limit` | 429 ≥1% |
| `auth` | 401 ≥5% hoặc ≥5 lỗi `auth` |
| `context` | ctx ≥85% ở ≥10% lượt, hoặc tràn ≥2% |
| `step_limit` / `loop` | ≥3% / ≥2% lượt |
| `tool_fail` | một công cụ ≥25% lỗi (≥10 lần gọi) |
| `bad_tool_calls` | tên công cụ bịa/tham số hỏng ≥2% lượt |
| `latency` | p95 token đầu ≥20 s, p95 lượt ≥180 s, p95 `/vllm` ≥90 s |
| `early_interrupt` / `perm_denied` / `empty_output` | ≥5% / từ chối ≥20% / ≥1% |
| `llm_retry` | ≥0,2 lần thử lại mỗi lượt |
| `old_versions` | ≥20% máy chưa dùng bản mới nhất |
| `intake` | ≥5% gửi chẩn đoán bị từ chối, hoặc ≥100 sự kiện bị bỏ |
| `no_data`, `unexpected` | không có dữ liệu 24 giờ; ≥3 lỗi chương trình |

Phát hiện phía ứng dụng (`DIAG_THRESHOLDS`): lặp ≥3 lần cùng công cụ+tham số; công cụ lỗi ≥3 lần/lượt; token đầu >20 s; lượt >300 s; ngữ cảnh ≥85%; bấm Dừng ≤8 s sau khi gửi; từ chối quyền ≥3/lượt (hoặc ≥2 cùng công cụ); đầu ra rỗng.

## 6. Thêm một quy tắc hoặc một trường

- **Quy tắc báo cáo:** trong `report.py` viết `def rule_xxx(S, T, B=None)` trả về `finding(id, "cao|trung bình|thấp", tiêu đề, bằng chứng, đề xuất)` hoặc `None`; thêm vào `RULES`; thêm ngưỡng vào `THRESHOLDS`; thêm test ở `test_report.py`. `S` = số liệu 24 giờ (xem `summarize`), `B` = mốc 7 ngày.
- **Tín hiệu mới ở máy khách:** thêm mã vào `DIAG_SIGNALS`, phát bằng `this.signal(...)` trong `DiagnosticsRecorder`, rồi tạo lại lược đồ chung: `npx esbuild packages/core/src/diagnostics.ts --bundle --platform=node --format=esm --outfile=/tmp/d.mjs && node -e "import('/tmp/d.mjs').then(m=>require('fs').writeFileSync('deploy/220/diag/schema.json',JSON.stringify(m.DIAG_SCHEMA,null,2)+'\n'))"`. Test so khớp TS với `schema.json` sẽ báo nếu quên. Cập nhật lại `install-diag.sh` trên 220 để bộ thu có lược đồ mới (bộ thu cũ bỏ trường lạ, không lỗi).
- **Công cụ mới của agent:** thêm tên vào `DIAG_TOOLS` (nếu không sẽ hiện là `other`).
- Nhận diện *vòng lặp/giới hạn bước* dựa vào câu chữ thông báo của `session.ts` (chỉ khớp cục bộ, chỉ mã được lưu); test chạy phiên thật nên sẽ đỏ nếu ai đó đổi câu chữ.

## 7. Nối vào ứng dụng (chủ ứng dụng làm)

- Controller: `LocalController.create({ …, diagnostics: { endpoint, headers?, version, build?, platform } })`. Bản web: `endpoint: "/agent/diag"` (cookie SSO cùng nguồn). Desktop: địa chỉ đầy đủ `https://ai.neu.edu.vn/agent/diag` và `headers: () => ({ Authorization: "Bearer " + token })` như khi gọi mô hình.
- Cài đặt: công tắc “Gửi chẩn đoán không chứa nội dung” = `saveSettings({ diagnostics })` (đọc `diagnosticsStatus()` để biết `lockedByPolicy`/`available`), kèm một dòng giải thích.
- “Báo lỗi”: ô ghi chú ngắn → `diagnosticsPreview(note)` (JSON đúng như sẽ gửi) → hiển thị → `diagnosticsSend()`.
- Desktop: IPC cho 3 hàm trên, và `policy.diagnostics` được `parsePolicy` đọc sẵn.
- Cập nhật Desktop: `checkForUpdate(version, fetch, { platform, headers })` (`packages/core/src/updates.ts`) đọc `https://ai.neu.edu.vn/agent/download/latest.json`; tạo tệp này bằng `deploy/220/make-latest.sh` sau khi có `SHA256SUMS.txt`. Chỉ báo, không tự tải/cài.

## 8. Giới hạn đã biết

- Nhận diện một số tín hiệu dựa vào câu chữ thông báo tiếng Việt của agent (có test bảo vệ).
- `uid` giả danh: ai có bí mật HMAC và danh sách email vẫn đối chiếu được; hạn chế truy cập `/etc/neu-agent/` và quản trị viên.
- Không có dữ liệu thì không có báo cáo tỷ lệ: bản Desktop chưa cấu hình điểm nhận sẽ không xuất hiện trong số liệu (chỉ thấy qua nhật ký nginx của lệnh gọi mô hình).
