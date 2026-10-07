# Triển khai và vận hành NEU Agent

## 1. Kiểm tra chất lượng (chạy trước khi phát hành)

```bash
npm install
npm run typecheck      # kiểm tra kiểu TypeScript toàn bộ
npm test               # ~100 test: quyền, công cụ, vòng lặp agent, Office, file thật, lệnh thật
npm run smoke          # kiểm thử đầu-cuối: mở app Electron thật, thao tác như người dùng, kiểm tra trên ổ đĩa
```

`npm run smoke` dùng máy chủ LLM giả (kịch bản có sẵn) nên không cần key; nó kiểm tra: hai tab, sửa lỗi + chạy `node` thật, tạo Excel/Word thật, file gốc không bị sửa, không đọc được file ngoài thư mục, giao diện có CSP chặt và không có Node. Ảnh chụp màn hình lưu ở thư mục tạm in ra cuối lệnh.

## 2. Bản web — triển khai lên `https://ai.neu.edu.vn/agent/`

```bash
NODE_ENV=production npm run build -w @neu/agent-web     # → apps/web/dist (không có sourcemap, ~1,2 MB nén)
npm run dev:web                                          # thử cục bộ: http://127.0.0.1:5173 (có Demo giả lập)
NEU_DEV_KEY=<key> npm run dev:web                        # thử với Qwen thật: proxy dev gắn key như nginx
```

**Kiến trúc trên máy 222** (nginx dùng chung của `ai.neu.edu.vn`; các ứng dụng khác như `/apps`, `/gaze` cũng đi theo kiểu này):

| Đường dẫn | Việc |
|---|---|
| `/agent/` | Tệp tĩnh từ `/var/www/neu-agent` (nginx đọc được; `/home/codelab` là 750 nên không đặt ở đó) |
| `/agent/sandbox-worker.js` | Như trên nhưng kèm header CSP `connect-src 'none'` (bắt buộc: worker chạy mã do mô hình viết) |
| `/agent/vllm/v1/{models,chat/completions}` | `proxy_pass` tới gateway nội bộ **`http://192.0.2.10:8037`** (222 không với được IP công khai `192.0.2.11:8037`; HTTPS của trang → không thể gọi HTTP trực tiếp từ trình duyệt vì mixed content). Chỉ 2 đường dẫn, phương thức GET/POST, thân ≤ 2 MB, giới hạn 10 yêu cầu/giây/IP (burst 100) và 40 kết nối đồng thời/IP |

**Key của bản web nằm ở nginx, không nằm trong JavaScript:** `map` trong `conf.d/neu-agent.conf` (quyền 640, chỉ root đọc) gắn `x-ollama-seckey` khi trình duyệt không gửi key; người dùng nào tự dán key riêng (Cài đặt) thì dùng key của họ để Kong theo dõi riêng.

**Tải ứng dụng Desktop từ trang web:** nút “⬇ Tải ứng dụng” (thanh trên cùng, chỉ ở bản web) mở hộp thoại tự nhận máy người dùng (macOS chip Apple/Intel, Windows; điện thoại và Linux được báo rõ là không có bản) và đưa bản phù hợp lên đầu, kèm SHA-256 và dung lượng. Tệp nằm ở `/var/www/neu-agent-dl/` (ngoài thư mục web, nên cập nhật web không xoá chúng), phục vụ tại `/agent/download/` (tệp tĩnh, không liệt kê thư mục). Cập nhật bản cài: đặt tệp mới và `SHA256SUMS.txt` (chỉ liệt kê tệp có thật) vào `deploy/ai-neu/downloads/`, chép lên rồi chạy lại `install.sh` (script kiểm tra mã băm trước khi chép). Muốn thêm/bớt bản nào chỉ cần đổi nội dung `SHA256SUMS.txt`.

**Cài đặt** (một bước, cần sudo trên 222; script tự sao lưu cấu hình, `nginx -t`, nạp lại, kiểm tra sau cài và **tự khôi phục** nếu lỗi):

```bash
scp -r deploy/ai-neu/* 222:~/neu-agent-deploy/        # gồm web.tar.gz, 3 tệp cấu hình và thư mục downloads/ (bản cài Desktop)
ssh 222
cd ~/neu-agent-deploy && sudo ./install.sh <key>      # cập nhật bản web về sau: chép web.tar.gz mới rồi chạy lại lệnh này
sudo ./install.sh --uninstall                         # gỡ (giữ lại /var/www/neu-agent)
```

Cấu hình trong `deploy/ai-neu/` đã được kiểm thử trên đúng nginx 1.24 của 222 (tiến trình tạm, cổng cục bộ): tệp tĩnh, header CSP, chặn `DELETE`/`embeddings`/đường dẫn lạ, key gắn phía máy chủ, streaming Qwen thật.

> ⚠ **Rủi ro cần quyết định:** `/agent/vllm/` là cửa ngõ vào mô hình **không cần đăng nhập** cho mọi người truy cập `ai.neu.edu.vn`. Hiện chỉ có giới hạn tần suất theo IP. Nếu muốn hạn chế người dùng nội bộ: thêm `allow <dải IP trường>; deny all;` vào location API, hoặc đặt sau SSO của NEUAI; đồng thời đặt giới hạn lệnh/phút/ngày cho consumer của key này ở Kong. Nên đặt thêm giới hạn trước đợt phát cho nhiều lớp.

Ghi chú khác:
- Thư mục làm việc của bản web nằm trong trình duyệt (IndexedDB), **chỉ trên máy đó**; xoá dữ liệu trình duyệt là mất. Nhắc học viên dùng nút **Zip/⬇**.
- Máy chủ giả (`/mock`) không có trong bản build; chỉ có ở `npm run dev:web`.

## 3. Bản Desktop (Electron)

```bash
npm run desktop                  # chạy từ mã nguồn
NEU_MOCK=1 npm run desktop       # thêm mẫu "Demo giả lập" trong Cài đặt (để trình diễn)
```

- Lần đầu tạo hai thư mục `~/Documents/NEU Agent` (dự án mẫu) và `~/Documents/NEU Agent` (dữ liệu mẫu). Đổi bằng menu **Tệp → Mở thư mục Code…/Work…**.
- **Key tích hợp sẵn** (`apps/desktop/src/main.ts`): ứng dụng tự dùng key `NEU Agent` của Khoa, **chỉ gửi tới `192.0.2.11:8037`** và chỉ khi người dùng chưa tự nhập key (đổi địa chỉ sang máy chủ khác thì không gửi). Là key dùng chung đặt trong mã nguồn nên ai có ứng dụng đều lấy được: đặt giới hạn và thu hồi/đổi tại Kong; ghi đè bằng biến môi trường `NEU_BUILTIN_KEY`.
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
| Tự cấp quyền cho chính mình | Sửa `.neuagent/**`, `.git/**`, `NEUAGENT.md`, `AGENTS.md`, `CLAUDE.md` luôn hỏi (trừ chế độ "Tự động hết") | — |
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
