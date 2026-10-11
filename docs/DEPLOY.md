# Triển khai và vận hành Hando

## 1. Kiểm tra chất lượng (chạy trước khi phát hành)

```bash
npm install
npm run typecheck      # kiểm tra kiểu TypeScript toàn bộ
npm test               # ~100 test: quyền, công cụ, vòng lặp agent, Office, file thật, lệnh thật
npm run smoke          # kiểm thử đầu-cuối: mở app Electron thật, thao tác như người dùng, kiểm tra trên ổ đĩa
```

`npm run smoke` dùng máy chủ LLM giả (kịch bản có sẵn) nên không cần key; nó kiểm tra: hai tab, sửa lỗi + chạy `node` thật, tạo Excel/Word thật, file gốc không bị sửa, không đọc được file ngoài thư mục, giao diện có CSP chặt và không có Node. Ảnh chụp màn hình lưu ở thư mục tạm in ra cuối lệnh.

## 2. Bản web và máy chủ — chạy thật trên máy 220, tên miền ở máy 222

```text
Người dùng ──HTTPS──▶ 222 (ai.neu.edu.vn, giữ chứng chỉ)  ──HTTP nội bộ──▶  220 (nginx + oauth2-proxy)  ──▶  gateway Kong 232:8037 (Qwen)
                      chỉ chuyển tiếp /agent/ sang 220                        web, tải về, API, đăng nhập SSO, key mô hình
```

- **Máy 220** (`deploy/220/`): web tĩnh, bản cài Desktop, proxy mô hình (gắn key ở phía máy chủ), và **đăng nhập SSO Microsoft 365** (`oauth2-proxy`). Mọi đường dẫn đều yêu cầu đăng nhập; chỉ nhận kết nối từ máy 222.
- **Máy 222** (`deploy/222/`): giữ tên miền + HTTPS, chuyển `/agent/` sang 220 **qua địa chỉ nội bộ** (222 `192.0.2.23` → 220 `192.0.2.21:80`; 222 không tới được IP công khai của 220, giống 232). Các ứng dụng khác trên 222 (như `/apps`) không bị đụng tới.
- Trang đăng nhập/chuyển hướng dùng đường dẫn tương đối nên người dùng luôn ở HTTPS.

### Khai báo SSO trên Microsoft Entra (một lần, bởi người quản trị ứng dụng)
Ứng dụng có Application (client) ID `00000000-0000-0000-0000-000000000002`, tenant `00000000-0000-0000-0000-000000000001`.
- Authentication → thêm nền tảng **Web**: `https://ai.neu.edu.vn/agent/oauth2/callback` (dùng cho bản web và `oauth2-proxy`).
- Thêm nền tảng **Mobile and desktop applications**: `http://localhost` và bật **Allow public client flows = Yes** (dùng cho bản Desktop).
- Quyền (delegated): `openid`, `profile`, `email`, `offline_access`.
- Tài khoản `@st.neu.edu.vn` phải đăng nhập được vào đúng tenant này. Nếu gặp lỗi `AADSTS50020`, sinh viên thuộc tenant khác: cần đổi ứng dụng sang đa tenant (liên hệ người phát triển).
- **Mã bí mật (client secret) chỉ nhập trên máy 220 khi cài, không đưa vào mã nguồn/gói cài/chat.** Đổi mã định kỳ (tạo mã mới trong Entra rồi chạy lại `install-auth.sh`).

### Cài đặt (theo thứ tự)
```bash
# từ máy của bạn (SSH cổng <cổng-ssh> đã khai trong ~/.ssh/config: Host 220 / 222)
scp -r deploy/220 220:~/neu-agent-220                  # gồm web.tar.gz, cấu hình nginx, auth/, downloads/
ssh -t 220 'cd ~/neu-agent-220 && sudo ./auth/install-auth.sh'                   # 1) đăng nhập SSO (hỏi mã bí mật, gõ không hiện)
ssh -t 220 'cd ~/neu-agent-220 && sudo ./install.sh <key mô hình>'               # 2) web + proxy + tải về
scp -r deploy/222 222:~/neu-agent-222
ssh -t 222 'cd ~/neu-agent-222 && sudo ./install.sh'                             # 3) chuyển ai.neu.edu.vn/agent/ sang 220
```
Mỗi script tự sao lưu, chạy `nginx -t`, **tự khôi phục nếu lỗi hoặc kiểm tra sau cài thất bại**, và kiểm tra rằng các site khác không bị ảnh hưởng. Cập nhật về sau: chép `web.tar.gz`/`downloads/` mới rồi chạy lại bước 2. Gỡ: `sudo ./install.sh --uninstall` (từng máy).

Dọn OJ Judge cũ trên 220: `sudo ./remove-oj-judge.sh` (mặc định chỉ liệt kê), thêm `--yes` để xoá, `--purge-data` để xoá cả dữ liệu.

### Công cụ web cho agent (tìm kiếm + tải trang) và đọc ảnh

- **Đọc ảnh/OCR** không cần dịch vụ riêng: công cụ `read_image` gửi ảnh cho chính mô hình (Qwen3.5 đọc được ảnh, chữ tiếng Việt chính xác). Ảnh được thu nhỏ ở máy người dùng (≤ 1,4 MB, vừa giới hạn thân yêu cầu 2 MB của nginx 222) và đi qua cổng hạn mức như mọi lượt chat, nên tính vào hạn mức token. Muốn cho ảnh lớn hơn: tăng `client_max_body_size` ở 222 (đã sửa thành 4m trong `deploy/222`, cần `sudo ./install.sh` ở 222) và `VISION_MAX_SEND` trong `packages/core/src/vision.ts`. Mô hình khác không đọc được ảnh thì công cụ báo lỗi rõ.
- **Tìm web + đọc trang** (`web_search`, `fetch_page`, từ gói `packs/tim-kiem-web`) cần dịch vụ ở `deploy/220/tools/`: SearXNG tự dựng (Docker, ảnh ghim mã băm, chỉ nghe 127.0.0.1:8899, không cần khoá API) + `tools.py` (127.0.0.1:4192; giới hạn theo người dùng, **chặn truy cập mạng nội bộ** bằng cả mã lẫn `IPAddressDeny` của systemd, không ghi nội dung truy vấn). Nginx mở `/agent/tools/search` và `/agent/tools/fetch` (phải đăng nhập, chỉ GET).
  ```bash
  scp -r deploy/220 220:~/neu-agent-220
  ssh -t 220 'cd ~/neu-agent-220 && sudo ./tools/install-tools.sh'   # TRƯỚC: cài dịch vụ (kiểm thử, sao lưu, tự khôi phục)
  ssh -t 220 'cd ~/neu-agent-220 && sudo ./install.sh'               # SAU: nginx mở /agent/tools/
  ```
  Chưa cài dịch vụ thì nginx trả 503 JSON và agent nói rõ là không tra cứu được. Giới hạn mặc định: 40 lượt tìm và 60 lượt tải trang mỗi người trong 10 phút (đổi bằng biến `NEU_TOOLS_*` trong unit). Kiểm tra: `curl -s localhost:4192/healthz` (chỉ số đếm). Cập nhật SearXNG: kéo ảnh mới, thay mã băm trong `neu-agent-search.service`, chạy lại `install-tools.sh`.
  Lưu ý: Google/Brave/DuckDuckGo có thể tạm chặn IP máy chủ; SearXNG tự dùng nguồn còn lại. Nếu chất lượng giảm, thay bằng API trả phí (Brave/Serper) chỉ cần sửa `tools.py` ở hàm `search`.

### Tài khoản tên + mật khẩu (ngoài Microsoft 365)

Dành cho khách mời / tài khoản thử. **Chỉ quản trị viên tạo**, người dùng không tự đăng ký. Hai cách quản lý:

1. **Trang quản trị:** `https://ai.neu.edu.vn/agent/admin/accounts` (mục "Tài khoản" ở thanh trên của trang báo cáo): tạo tài khoản, đổi mật khẩu (có nút tạo mật khẩu ngẫu nhiên), xoá, "Huỷ mọi phiên đăng nhập", xem nhật ký thao tác (ai làm gì, lúc nào; không bao giờ có mật khẩu). Chỉ email Microsoft nằm trong `/etc/neu-agent/admins.txt` mới vào được; tài khoản tên + mật khẩu không bao giờ là quản trị viên.
2. **Dòng lệnh trên máy 220:** `sudo ./users.sh add|remove|list|kick` (xem đầu tệp `users.sh`).

Cách hoạt động (tách quyền): trang quản trị chạy bằng tài khoản thường `neu-diag`, **không** được ghi tệp mật khẩu. Nó gọi dịch vụ phụ `neu-agent-accounts` (root, chỉ nghe socket Unix `/run/neu-agent-accounts/accounts.sock` quyền 0660 nhóm `neu-diag`, kiểm tra thêm uid người gọi). Dịch vụ này chỉ nhận 5 việc (list, add, remove, kick, audit), kiểm tra chặt tên/mật khẩu, rồi gọi lại `users.sh` đã kiểm thử. POST có chống CSRF (tiêu đề `X-Neu-Admin`, `Origin` cùng nguồn, JSON), giới hạn 30 thao tác/phút/quản trị viên, thân ≤ 1 KB. Nhật ký: `/var/lib/neu-agent-accounts/audit.jsonl` (root, 0600) và `journalctl -u neu-agent-accounts`.

Cài/cập nhật: `sudo ./install.sh <key>` (nginx cho phép POST vào `/agent/admin/`) rồi `sudo ./diag/install-diag.sh --admin <email quản trị>` (cài dịch vụ phụ, tự thử tạo + xoá một tài khoản `zz-kiem-tra-cai`, tự khôi phục nếu lỗi).

### Đã kiểm thử thế nào
`node deploy/test/e2e-sso.mjs` (nginx 222 → nginx 220 thật → `oauth2-proxy` thật → máy chủ OIDC giả; 27 kiểm tra: chưa đăng nhập bị chặn ở mọi đường, đăng nhập giảng viên/sinh viên, miền lạ bị từ chối, Bearer của Desktop đúng/sai audience/hết hạn/bị sửa, key do máy chủ gắn và token không chuyển sang gateway) và `node deploy/test/e2e-install.mjs` (chạy hai script cài trong Ubuntu 24.04 có nginx thật cùng site "khác", kể cả ép lỗi để thử tự khôi phục). Chưa thử với Microsoft thật: lần đầu cần một người đăng nhập thử.

### Việc nên làm thêm
- **Giới hạn gateway:** cổng `232:8037` chỉ cho máy 220 truy cập và đổi key `neuagent`; nếu không, ai biết key vẫn vòng qua SSO được.
- Đường nội bộ 222 → 220 là HTTP (không mã hoá) trong mạng LAN; nếu mạng không tin cậy, thêm TLS giữa hai máy.
- Phát triển cục bộ: `npm run dev:web` (http://127.0.0.1:5173, không có SSO, có Demo giả lập); `NEU_DEV_KEY=<key> npm run dev:web` để thử với Qwen thật.

## 3. Bản Desktop (Electron)

```bash
npm run desktop                  # chạy từ mã nguồn
NEU_MOCK=1 npm run desktop       # thêm mẫu "Demo giả lập" trong Cài đặt (để trình diễn)
```

- Lần đầu tạo hai thư mục `~/Documents/NEU Agent` (dự án mẫu) và `~/Documents/NEU Agent` (dữ liệu mẫu). Đổi bằng menu **Tệp → Mở thư mục Code…/Work…**.
- **Key tích hợp sẵn** (`apps/desktop/src/main.ts`): ứng dụng tự dùng key `Hando` của Khoa, **chỉ gửi tới `192.0.2.11:8037`** và chỉ khi người dùng chưa tự nhập key (đổi địa chỉ sang máy chủ khác thì không gửi). Là key dùng chung đặt trong mã nguồn nên ai có ứng dụng đều lấy được: đặt giới hạn và thu hồi/đổi tại Kong; ghi đè bằng biến môi trường `NEU_BUILTIN_KEY`.
- Cài đặt nằm ở thư mục dữ liệu ứng dụng; **key người dùng tự nhập được mã hoá bằng kho khoá của hệ điều hành** (Keychain/DPAPI/libsecret qua `safeStorage`). Nếu hệ điều hành không có kho khoá, key lưu dạng tệp chỉ chủ sở hữu đọc được.
- Tab Code chạy lệnh thật (có hỏi quyền). Tab Work **không** có công cụ chạy lệnh. Xuất PDF cần LibreOffice.
- Giao diện chạy trong cửa sổ cách ly (`sandbox`, `contextIsolation`, CSP `connect-src 'none'`); chỉ tiến trình chính mới có mạng/ổ đĩa, qua một danh sách lệnh IPC cố định.
- **Chưa có đóng gói cài đặt** (`.dmg`/`.exe`). Bước tiếp theo: thêm `electron-builder`, ký số ứng dụng (macOS: Developer ID + notarize; Windows: chứng chỉ code signing), cấu hình cập nhật tự động. Cho tới lúc đó, phát hành cho lớp học bằng `npm run desktop` trên máy phòng lab hoặc dùng bản web.

## 4. Mô hình bảo mật (tóm tắt để rà soát)

| Mối đe doạ | Biện pháp | Giới hạn còn lại |
|---|---|---|
| Agent đọc/ghi ngoài thư mục dự án | Mọi đường dẫn được resolve (kể cả liên kết tượng trưng) và phải nằm trong thư mục; kiểm tra bằng test | Lệnh `bash` (tab Code, Desktop) là tiến trình thật: các lệnh *chỉ-đọc* tự động chỉ được cho phép khi không có đường dẫn ra ngoài; lệnh khác luôn hỏi |
| Lệnh phá hoại | Danh sách chặn (kể cả khi bọc trong `bash -c`, `env`…), bắt buộc hỏi cho mọi lệnh không chắc chắn là chỉ-đọc | Không phải bức tường; người dùng đọc trước khi duyệt là lớp chính |
| Quy tắc cho phép ngầm trong repo lạ | Cấu hình dự án (`.neuagent/settings.json`) **không** đổi được địa chỉ máy chủ, key, hook; quy tắc `allow` của dự án chỉ có hiệu lực sau khi người dùng bấm "Tin cậy"; quy tắc `deny` luôn có hiệu lực | — |
| Tự cấp quyền cho chính mình | Sửa `.neuagent/**`, `.git/**`, `NEUAGENT.md`, `AGENTS.md`, `CLAUDE.md` luôn hỏi (trừ chế độ "Toàn quyền") | — |
| Prompt injection từ tệp/web | Lời nhắc hệ thống coi nội dung đó là dữ liệu; `web_fetch` chặn địa chỉ nội bộ/riêng tư; mọi hành động có tác dụng phụ đều hỏi | Mô hình có thể bị dụ; không có biện pháp tuyệt đối |
| Mã do mô hình viết chạy trong trình duyệt | Web Worker dùng một lần, không DOM/mạng/IndexedDB, CSP riêng (`connect-src 'none'`), huỷ khi hết giờ | Cần cấu hình header CSP cho `sandbox-worker.js` ở máy chủ thật (mục 2) |
| Lộ key | Web: key chung nằm ở nginx (không trong JS), key riêng của người dùng ở `localStorage` (CSP `script-src 'self'`); Desktop: key tích hợp chỉ gửi tới máy chủ của Khoa, key tự nhập mã hoá bằng kho khoá hệ điều hành; giao diện không bao giờ nhận lại key thật | Key tích hợp của Desktop lấy được từ ứng dụng; phải giới hạn ở Kong. Lõi dùng chung không chứa key |
| Mở tệp thực thi do agent tạo | Nút "Mở bằng ứng dụng" từ chối `.app .sh .exe .js .py …` | — |

## 5. Hạn chế đã biết (nên công bố cho người dùng)

- Chưa đọc PDF scan (không OCR) và hình ảnh trong tài liệu.
- Sửa Excel bằng công cụ có thể làm mất biểu đồ/pivot/macro của bản gốc; luôn lưu bản mới.
- Hàm Excel hiếm chưa được tính kiểm (Excel tự tính khi mở).
- Windows: các phần chạy lệnh/đường dẫn chủ yếu được thử trên macOS/Linux.
- Chưa có hook/MCP/skill như Claude Code (sẽ thêm sau, phải đi kèm cơ chế tin cậy).
- Mô hình Qwen3.5 với cửa sổ ngữ cảnh ~32k token: việc dài cần `/compact`; tài liệu rất dài đọc theo trang (`offset`).
