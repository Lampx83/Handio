# Tự chẩn đoán và báo cáo chất lượng

Mục tiêu: hệ thống **tự phát hiện vấn đề** (lỗi mô hình/cổng, công cụ hỏng, agent lặp, chậm…) để liên tục cải tiến, mà **không thu nội dung** của người dùng.

## 1. Nguyên tắc

1. **Không chứa nội dung ngay từ cấu trúc.** Gói gửi đi chỉ gồm các trường trong lược đồ (`deploy/220/diag/schema.json`, trùng `DIAG_SCHEMA` trong `packages/core/src/diagnostics.ts`). Bộ lọc là *danh sách cho phép* theo từng trường; trường lạ, giá trị lạ bị bỏ; tên công cụ lạ/tên mô hình giống khoá thành `other`. Có test nhét bí mật/đường dẫn/email vào mọi chỗ và chứng minh không lọt ra (`packages/core/test/diagnostics.test.ts`, `deploy/220/diag/test_collector.py`).
2. **Danh tính chỉ do máy chủ gắn:** `uid = HMAC-SHA256(bí mật máy chủ, email SSO)[:16 hex]` từ header `X-User-Email` mà nginx đặt (máy khách không tự khai được). Email không được lưu, không vào nhật ký. Đây là *giả danh*, không phải ẩn danh tuyệt đối.
3. **Mặc định bật khi ứng dụng được cấu hình điểm nhận** (hệ thống nội bộ, sau SSO). Tắt bằng `Settings.diagnostics=false` (công tắc trong Cài đặt) hoặc quản trị viên ép tắt bằng `policy.json` → `"diagnostics": false`. **Chưa cấu hình `diagnostics` ở controller = không ghi, không gửi gì.**
4. **Không bao giờ làm chậm/hỏng agent:** ghi đồng bộ O(1), gửi nền theo lô, lùi dần khi lỗi (30 s … 30 phút), bộ đệm vòng 500 sự kiện, mọi lỗi gửi đều im lặng, không theo chuyển hướng.

### Ngoại lệ có chủ đích: sổ "ai đã dùng" (chỉ quản trị viên)

Để quản trị viên biết **ai đang dùng, ở web hay Desktop**, bộ thu còn giữ một sổ riêng `/var/lib/neu-agent/diag/users-seen.json` (quyền 0600): với mỗi tài khoản có email Microsoft hoặc tên đăng nhập thật, ghi *lần đầu, gần nhất, số lượt làm việc, nền tảng (web/mac/win), phiên bản*. **Không có nội dung hội thoại, tên tệp hay IP.** Chỉ hiện ở `https://ai.neu.edu.vn/agent/admin/accounts` (quản trị viên), không nằm trong các tệp JSONL/báo cáo (vẫn chỉ có mã giả danh). Sổ giữ tới khi quản trị viên xoá tệp; tối đa 5000 tài khoản. Tắt hẳn bằng `Environment=NEU_DIAG_KEEP_IDENTITIES=0` trong `neu-agent-diag.service`. Chỉ tính người đã làm việc ít nhất một lượt (ứng dụng gửi số liệu khi có hoạt động); người chỉ đăng nhập rồi thoát chưa chắc có trong sổ.

## 2. Thu thập gì

| Sự kiện | Trường (tất cả là mã/số/boolean) |
|---|---|
| `turn` (mỗi lượt làm việc) | `end` (ok/interrupted/error/step_limit/loop), `dur_s`, `ttft_ms`, `steps`, `tools`, `tool_fail`, `prompt_tok`, `completion_tok`, `ctx_pct`, `compactions`, `perm_allow`, `perm_deny` |
| `turn` (bổ sung từ 0.4.0) | `calls` (số lần gọi mô hình), `peak_prompt_tok` (lời nhắc lớn nhất của một lần gọi), `cached_tok` (token lời nhắc dùng lại từ bộ nhớ đệm), `tool_out_tok` (ước lượng token của kết quả công cụ đã gửi lại), `pruned` (số lần lược bớt kết quả cũ), `first_tool_s` (giây tới công cụ đầu tiên): để biết token đi đâu |
| `turn` (bổ sung từ 0.8.16: **hồ sơ công việc**) | `kind` (build/edit/fix/explain/research/convert/other: loại việc), `redo` (người dùng nhắn lại rằng kết quả chưa đạt; chỉ từ lượt thứ hai), `nth` (lượt thứ mấy của cuộc trò chuyện), `stack` (static/react/vue/svelte/next/vite/node/express/python/flask/fastapi/django/streamlit/other), `ui` (tailwind/chakra/mui/antd/bootstrap/shadcn/none), `art` (loại sản phẩm chính theo đuôi tệp: web/python/word/excel/slides/pdf/text/data/image/other), `files_new`, `files_edit` (số tệp tạo/sửa), `verify` (none/pass/fail: kết quả lần dựng/kiểm thử/check_page cuối của lượt) |
| `ui` | `act`: việc người dùng làm trong giao diện, **chỉ mã** (`suggestion`, `template`, `attach`, `new_chat`, `tab_switch`, `settings_open`, `mode_change`, `run_click`…): để biết tính năng nào được dùng/bỏ qua |
| `feedback` | `v` (`up`/`down`) và `reason` chọn sẵn (`wrong`/`incomplete`/`slow`/`confusing`/`other`): người dùng **tự bấm** 👍/👎 sau câu trả lời; không có chữ tự do |
| `tool` | `name` (danh sách cố định, `mcp`, `other`), `ok`, `dur` (lt1s/lt5s/lt30s/lt2m/ge2m), `err` (khi lỗi; **chỉ mã** như `not_found`, `read_first`, `no_match`, `sandbox`, `program`, `denied`…; từ bản 0.2.0) |
| `llm_error` | `kind` (context/auth/rate/server/network/insecure/quota/unexpected/other), `status` (mã HTTP) |
| `llm_retry` | `kind` (network/rate/server) |
| `signal` | `code` (loop, step_limit, repeat_tool_fail, slow_first_token, slow_turn, ctx_high, early_interrupt, perm_denied, empty_output, invalid_tool_args, unknown_tool, truncated, context_overflow), `tool`, `n` |
| `report` | `note`: ghi chú ≤500 ký tự **do người dùng gõ khi bấm “Báo lỗi”** (xem trước đúng gói sẽ gửi) |
| Chung | `ts`; app: mã cài ngẫu nhiên 32 hex, `version`, `build`, `platform` (web/mac/win), `profile` (work/code/design), `model` |

**Về `err`:** `program` = chương trình/test của người dùng chạy hỏng (kết quả bình thường trong bài tập sửa lỗi), `denied` = người dùng hoặc quy tắc từ chối quyền; hai loại này **không** tính là “công cụ lỗi” trong trang quản trị và báo cáo (bản cũ không gửi `err` thì tính như lỗi). Các mã còn lại cho biết agent dùng sai ở đâu (sai đường dẫn, sửa khi chưa đọc, đoạn cần sửa không khớp…) để biết sửa gì.

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
- Quản trị viên xem báo cáo: danh sách ở `/etc/neu-agent/admins.txt` (mỗi dòng một email, hoặc tên đăng nhập của tài khoản mật khẩu — xem `docs/SECURITY.md`); sửa xong `sudo systemctl restart neu-agent-diag`. Xem tại `https://ai.neu.edu.vn/agent/admin/` (nginx xác thực SSO, bộ thu đối chiếu email, CSP chặt, không tài nguyên ngoài). Không phải quản trị viên → 403.
- Chạy báo cáo ngay: `sudo systemctl start neu-agent-diag-report.service`; xem `latest.md` trong `/var/lib/neu-agent/reports/`.
- Sức khoẻ: `cat /var/lib/neu-agent/health.json`, `tail /var/log/neu-agent/health.log`, `curl https://ai.neu.edu.vn/agent/healthz`. Công cụ giám sát ngoài chỉ cần gọi `/agent/healthz` (200 `{"ok":true}`; 503 `{"ok":false}` khi có kiểm tra lỗi hoặc dữ liệu sức khoẻ cũ hơn 15 phút).
- Gợi ý bằng mô hình (tuỳ chọn): đặt key vào `/etc/neu-agent/llm-key` (600) rồi chạy lại `install-diag.sh`. Chỉ gửi **số liệu tổng hợp** (không sự kiện thô, không chuỗi tự do) tới cổng mô hình (gateway) của nơi triển khai; kết quả là *bản nháp* ghi rõ cần người kiểm tra.
- Lưu ý: `access_log` của máy chủ ảo này nay chỉ ghi JSON ở tệp trên (không còn ghi vào `access.log` chung).

## 4b. Trang quản trị tổng quan — `https://ai.neu.edu.vn/agent/admin/`

Chỉ email (hoặc tên đăng nhập) trong `/etc/neu-agent/admins.txt` mới xem được. Trang mặc định (`index.html`, do `deploy/220/diag/stats.py` tạo, **tự làm mới mỗi 10 phút** bởi `neu-agent-diag-stats.timer`) gồm:

- **Số người dùng**: 24 giờ / 7 ngày / 30 ngày / cả 90 ngày giữ dữ liệu; người dùng mới 7 ngày; tỷ lệ quay lại (tuần này so với tuần trước); số máy cài hoạt động.
- **Chọn khoảng thời gian** (nút trên thanh đầu trang): 1 ngày và 3 ngày chia theo **giờ**, 7/30/90 ngày chia theo ngày. 30 ngày là `index.html`; các khoảng khác là `index-1d.html`, `index-3d.html`, `index-7d.html`, `index-90d.html`, cùng được tạo mỗi 10 phút trong một lượt đọc dữ liệu (không cần cấu hình thêm). Các thẻ số đầu trang luôn theo cửa sổ cố định 24 giờ/7 ngày/30 ngày. Số liệu nginx theo giờ lấy từ nhật ký 14 ngày nên đủ cho 1–3 ngày; biểu đồ hạn mức token chỉ đếm theo ngày nên ở 1d/3d luôn hiện 7 ngày.
- **Biểu đồ theo khoảng đã chọn** (mặc định 30 ngày): người dùng hoạt động, người dùng mới, lượt làm việc (kèm lượt lỗi), lệnh gọi mô hình qua nginx (kèm 5xx), lượt tải bản cài, lượt Desktop kiểm tra cập nhật; lượt làm việc theo giờ trong ngày (giờ VN).
- **So sánh**: mỗi khoảng có đường đứt nét của kỳ liền trước cùng độ dài (không có ở 90 ngày vì dữ liệu chỉ giữ 90 ngày), vạch tím ở ngày một phiên bản mới xuất hiện (≥ 2 người dùng), vòng đỏ ở cột bất thường (tỷ lệ lỗi, p95, 5xx; điều kiện xảy ra ở > 40% cột được gộp thành "mức nền").
- **Chất lượng theo phiên bản / tab / mô hình / nền tảng** (bảng sắp xếp được): lượt, % lỗi, % lặp/hết bước, % bị ngắt, p50/p95 thời gian một lượt và tới token đầu. Dùng sau mỗi lần phát hành.
- **Công cụ**: tỷ lệ lỗi chỉ tính trên các phiên bản ứng dụng đã gắn mã lý do lỗi (bản cũ không phân biệt "chương trình/test lỗi" nên bị loại và ghi riêng "chưa phân loại"); công cụ × lý do lỗi; công cụ chạy chậm (≥ 5 giây); tín hiệu theo công cụ; lỗi gọi mô hình theo mã HTTP.
- **Ngữ cảnh, bước, quyền**: % lượt ngữ cảnh ≥ 85% và số lần nén; số bước mỗi lượt p50/p95; số lần được cho phép/bị từ chối.
- **Hạn mức**: mức tập trung (10% người dùng nhiều nhất chiếm bao nhiêu % token) và phân bố % hạn mức đã dùng hôm nay.
- **Cơ cấu**: phiên bản, nền tảng, tab Work/Code/Design, mô hình (người dùng, máy, lượt).
- **Bảng người dùng** (100 người đầu theo số lượt 30 ngày): *mã giả danh* 8 ký tự, lần đầu/gần nhất, số ngày dùng, lượt, tab/nền tảng/phiên bản chính.
- Tình trạng hệ thống (`health.json`) và đường dẫn tới báo cáo chất lượng hằng ngày (`latest.html`) cùng `stats.json`.
- **Tiện ích trang**: bấm tiêu đề cột để sắp xếp, ô lọc cho bảng dài, trang tự tải lại sau 10 phút (nếu đang không gõ), tải CSV theo khoảng đang xem (`series-<khoảng>.csv`, theo giờ với 1d/3d). Chạy bằng một tệp `admin.js` cùng nguồn, không gọi mạng.
- **Trang Tài khoản → "Người đã dùng NEU Agent"**: cột *Hoạt động* dẫn thẳng tới trang `u-<mã>.html` của tài khoản đó (mã giả danh tính phía máy chủ; chỉ có khi người đó dùng trong 30 ngày).

### Cảnh báo chủ động (tuỳ chọn)

Trang chỉ thụ động. Muốn nhận tin khi có sự cố: đặt URL webhook **https** (Microsoft Teams / Slack / Mattermost… nhận `{"text": "…"}`) vào `/etc/neu-agent/alert-webhook` (0600) rồi chạy lại `sudo ./diag/install-diag.sh` (tạo drop-in nạp URL qua `LoadCredential` và mở mạng cho đúng dịch vụ `neu-agent-diag-alert`). Mỗi 10 phút `alerts.py` đọc `stats.json` + `health.json` và báo khi: tỷ lệ lượt lỗi 24 giờ ≥ 20% (≥ 20 lượt), cổng mô hình 5xx ≥ 5% (≥ 50 lệnh), ≥ 5 người bị chặn vì hạn mức, kiểm tra sức khoẻ lỗi hoặc cũ, không có dữ liệu chẩn đoán mới > 6 giờ, trang quản trị không được làm mới > 1 giờ. Mỗi cảnh báo nhắc lại sau 6 giờ nếu còn, và có một tin khi đã hết. **Tin chỉ có số liệu tổng hợp** (không nội dung, không mã người dùng, không email). Không có tệp webhook thì dịch vụ không làm gì và không có mạng. Thử: `python3 /usr/local/lib/neu-agent-diag/alerts.py --dry-run`.

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

## Góp ý / báo lỗi do người dùng viết (khác chẩn đoán)

Chẩn đoán KHÔNG chứa nội dung (ngoại lệ riêng, mặc định tắt: quản trị có thể bật ghi nội dung hội thoại của vài tài khoản thử nghiệm ở cổng hạn mức, xem [QUOTA.md](QUOTA.md)). **Góp ý** thì ngược lại: là chữ do chính người dùng viết và chủ động gửi qua nút 💬 để nhóm phát triển đọc, nên có nội dung và **kèm tên đăng nhập** (hộp góp ý nói rõ điều này). Không có gì được gửi tự động.

| Điều | Cách làm |
|---|---|
| Đường đi | ứng dụng → `POST /agent/feedback` (nginx xác thực SSO, gắn `X-User-Email`, thân ≤ 16 KB) → bộ thu `collector.py` → SQLite `/var/lib/neu-agent/feedback/feedback.db` (quyền 0700, thuộc `neu-diag`) |
| Gồm | loại (bug/idea/praise/other), nội dung ≤ 3000 ký tự, tên đăng nhập; nếu người dùng đồng ý: phiên bản, nền tảng, tab, mô hình (đều là mã ngắn kiểm theo danh sách) |
| Không gồm | nội dung hội thoại, tệp, đường dẫn, lệnh, địa chỉ IP |
| Giới hạn | 6 góp ý/giờ và 20/ngày mỗi người, 400/giờ toàn hệ thống; nội dung trùng trong 24 giờ không lưu lại |
| Ai xem | chỉ quản trị viên (`admins.txt`) ở `/agent/admin/feedback`: lọc theo trạng thái/loại, tìm chữ, ghi chú, đặt trạng thái (Mới/Đã xem/Sẽ làm/Đã xong/Không làm), xoá, tải CSV |
| Lưu bao lâu | cho tới khi quản trị viên xoá (không tự xoá); sao lưu theo `/var/lib/neu-agent` |

Mã: `deploy/220/diag/feedback.py` (kho + kiểm tra), route trong `collector.py`, trang `feedback.html`/`feedback.js`, kiểm thử `test_feedback.py`; phía ứng dụng `packages/core/src/feedback.ts`, `LocalController.sendFeedback`, `packages/ui/src/feedback-ui.ts`.

## Hồ sơ công việc (0.8.16)

Để biết **người dùng làm việc gì và việc nào hay hỏng** mà không thu nội dung: ứng dụng phân loại ngay trên máy (`packages/core/src/task-profile.ts`) rồi chỉ gửi **mã** trong danh sách cố định. Câu hỏi, tên tệp, đường dẫn, lệnh được đọc cục bộ để phân loại và bị bỏ; không chuỗi nào của người dùng đi ra khỏi hàm phân loại (có bài kiểm thử gài một chuỗi bí mật vào yêu cầu, tên tệp và lệnh rồi kiểm tra gói gửi đi không chứa nó).

| Trường | Cách tính (cục bộ) | Dùng để |
|---|---|---|
| `kind` | từ khoá trong yêu cầu (tiếng Việt có/không dấu, tiếng Anh) | biết người dùng chủ yếu tạo mới, sửa, sửa lỗi, giải thích… |
| `redo` | yêu cầu có lời báo chưa đạt ("vẫn lỗi", "chưa đúng", "làm lại") ở lượt thứ ≥ 2 | dấu hiệu rõ nhất agent làm chưa đạt: nhìn theo `kind`/`stack` |
| `stack`, `ui` | tên gói trong `package.json`/`requirements.txt` của dự án (tab Code, Design) | thấy bộ khung/thư viện nào hay hỏng (ví dụ Chakra v3) |
| `art`, `files_new`, `files_edit` | đuôi tệp của các lần ghi thành công | biết sản phẩm chính: web, Word, Excel, PowerPoint… |
| `verify` | lệnh dựng/kiểm thử (`npm run build`, `vitest`, `pytest`…) hoặc `check_page`: mã thoát/kết luận cuối | tỷ lệ "báo xong nhưng kiểm chứng hỏng" theo bộ khung |

Báo cáo hằng ngày thêm bảng **«Công việc người dùng làm»** và hai quy tắc: `rework` (≥ 25% lượt nối tiếp bị báo chưa đạt) và `verify_fail` (bộ khung/thư viện có ≥ 40% lần kiểm chứng cuối hỏng, từ 5 lần). Trang quản trị có mục cùng tên (loại việc, sản phẩm, bộ khung, thư viện, lượt thứ mấy). Bản ứng dụng cũ không gửi các trường này nên bị bỏ qua, không làm lệch số liệu.

## Tín hiệu lỗi sinh nội dung (0.6.2)

Ngoài `invalid_tool_args`, `truncated`, `loop`…, bộ chẩn đoán ghi thêm hai tín hiệu (chỉ mã, không nội dung) để biết mô hình có sinh nội dung hỏng không:

| Tín hiệu | Khi nào | Báo cáo |
|---|---|---|
| `args_truncated` | lời gọi công cụ bị cắt giữa chừng vì hết độ dài đầu ra (JSON dở dang) | quy tắc `generation_faults` ở trang báo cáo chất lượng |
| `text_repeat` | mô hình cứ lặp một đoạn văn; bị ngắt giữa chừng | như trên |

Khi cả hai cùng tăng: kiểm tra `maxOutputTokens`, mô tả công cụ và lời nhắc chia nhỏ nội dung dài.

## Cuộc trò chuyện được chia sẻ (dữ liệu để cải tiến, có đồng ý)

Đây là nguồn **nội dung hội thoại** duy nhất đến máy chủ, và chỉ khi người dùng **chủ động bấm 🔗 Chia sẻ**, đọc cảnh báo và tick đồng ý. Nó đồng thời là cách lấy hội thoại thật để rà lỗi và dựng bộ ca kiểm thử (backlog B-09) mà không thu nội dung ngầm.

| Điều | Cách làm |
|---|---|
| Đường đi | ứng dụng → `POST /agent/share` (SSO, ≤ 512 KB) → `shares.py` → SQLite `/var/lib/neu-agent/feedback/shares.db` (0700, `neu-diag`) |
| Người dùng được báo | người có liên kết (đã đăng nhập) VÀ nhóm phát triển đều đọc được; che tự động; thu hồi bất cứ lúc nào |
| Gồm | tiêu đề, các lượt hỏi/đáp, tên công cụ + tóm tắt ngắn thao tác (≤ 400 ký tự); tab, phiên bản, nền tảng |
| Không gồm | nội dung tệp, kết quả công cụ dài, đường dẫn đầy đủ của máy, khoá/mật khẩu (che ở máy người dùng và che lần nữa ở máy chủ) |
| Liên kết | mã ngẫu nhiên 22 ký tự; trang đọc là HTML tĩnh, không script, CSP chặt, `noindex`; chưa đăng nhập thì chuyển tới đăng nhập |
| Giới hạn | 20 liên kết/ngày và tối đa 200 liên kết đang hoạt động mỗi người; ≤ 400 mục, ≤ 300 KB |
| Ai quản lý | chỉ quản trị viên ở `/agent/admin/shares`: xem, tìm, xoá; **tải JSONL** (tên người chia sẻ thay bằng mã giả danh) để phân tích |
| Thu hồi | người chia sẻ thu hồi ở hộp 🔗 (xoá hẳn bản chụp); quản trị xoá bất kỳ |

Khi dùng JSONL để cải tiến: đừng đưa nội dung ra ngoài hệ thống; ưu tiên mẫu lỗi (công cụ thất bại, hiểu sai yêu cầu) và chuyển thành ca kiểm thử đã ẩn danh.

