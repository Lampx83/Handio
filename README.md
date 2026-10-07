# NEU Agent

Bộ công cụ trợ lý AI dạng *agent* của Trường Đại học Kinh tế Quốc dân, chạy trên mô hình Qwen3.5 do Khoa CNTT vận hành (máy chủ 232, qua Kong cổng 8037). Không cần tài khoản Claude/Codex.

Một ứng dụng, **ba tab**, lấy cảm hứng từ Claude Code, Claude Desktop và các công cụ thiết kế bằng AI. Mỗi tab có **dự án** riêng (thư mục + hướng dẫn + lịch sử trò chuyện):

| Tab | Cho ai | Làm gì |
|---|---|---|
| **Work** | Khối văn phòng | Tóm tắt, soạn thảo, tính toán, rà soát, làm slide từ **Word / Excel / PowerPoint / PDF**; tìm xuyên tài liệu; không có terminal; không ghi đè bản gốc |
| **Code** | Sinh viên (FIT-VIBE, vibe coding), giảng viên CNTT | Đọc/sửa mã, lập kế hoạch, chạy thử, sửa đến khi chạy được; chế độ *Lập kế hoạch*; diff trước khi duyệt; `/undo` |
| **Design** | Truyền thông, giảng viên, sinh viên | Poster, tờ rơi, landing page, slide, logo, infographic, danh thiếp… viết thành HTML/SVG; **xem trước ngay** trong khung cách ly (không script, không mạng); chọn khổ A4/vuông/story/slide/điện thoại; xuất **PDF/PNG** (Desktop) |

Chạy ở **web** (trình duyệt, thư mục ảo) và **máy tính** (Electron, thư mục thật). 

## Chạy thử

```bash
npm install
npm run dev:web        # web: http://127.0.0.1:5173  (có "Demo giả lập", không cần key)
npm run desktop        # ứng dụng Electron (NEU_MOCK=1 để có Demo giả lập)
npm test               # test tự động
npm run smoke          # kiểm thử đầu-cuối bản Desktop
```

Mô hình thật: mặc định trỏ tới máy chủ của Khoa. **Desktop có key tích hợp sẵn**; **web** do nginx gắn key phía máy chủ (xem [docs/DEPLOY.md](docs/DEPLOY.md), thư mục `deploy/ai-neu`). Có key riêng thì nhập ở Cài đặt.

## Học vibe coding ngay trong ứng dụng (khớp học phần FIT-VIBE)

Nút **📚 Học** ở tab Code mở: 12 bài học (8 buổi FIT-VIBE + chuyên đề, mỗi bước có nút *▶ Thử*), 16 bài tập **chấm tự động** (JavaScript/HTML chạy được cả ở bản web; Python cần bản Desktop) với gợi ý theo bậc, và 7 dự án mẫu. Thao tác như Claude Code/Codex: `@tệp` (gợi ý khi gõ), `!lệnh`, `/init` tạo `AGENTS.md`, `Shift+Tab` chế độ lập kế hoạch, `Esc` dừng; ô chat gợi ý cấu trúc **Mục tiêu – Ngữ cảnh – Ràng buộc**; tiến trình nền (vd `streamlit run`) hiện thanh *Mở/Dừng*. Tab Work có 29 mẫu nghiệp vụ dạng lệnh `/` (`/congvan`, `/thongbao`, `/hopdong`, `/email`…). Đối chiếu với bài giảng: [docs/course/FIT-VIBE-buoi-1.md](docs/course/FIT-VIBE-buoi-1.md).

### Tab Code giống Cursor / Claude Code / Codex / Antigravity

- **± Thay đổi** (`/diff`): tệp agent đã tạo/sửa/xoá (kể cả do lệnh bash) với +/−, xem diff từng tệp, hoàn tác từng tệp hoặc tất cả.
- **↶ Quay lại** (`/rewind`, hoặc Esc hai lần): cắt hội thoại về trước một lượt và khôi phục luôn các tệp đã đổi từ đó.
- **Thẻ tổng kết** cuối lượt (kiểu Walkthrough): số tệp, +/−, đã chạy kiểm tra sau lần sửa cuối chưa.
- **`/status`**, **`/context`** (chia nhỏ ngữ cảnh: lời nhắc, công cụ, AGENTS.md, hội thoại), **`@thư_mục/`** đính kèm cây thư mục.
- **🤖 chọn mô hình** nhanh ở thanh trên; **▶ Chạy** (Desktop) gợi ý lệnh chạy/test từ `package.json`, `*.py`, `index.html`… và nhờ agent chạy (vẫn phải duyệt).

### Tab Work giống NotebookLM / Microsoft 365 Copilot / Claude Cowork

- **Trích dẫn bấm xem được**: câu trả lời từ tài liệu kèm chip số `[1]` → mở **khung xem tài liệu** (Word/Excel/PowerPoint/PDF, chỉ đọc, chữ thuần) và tô sáng đúng đoạn / ô / slide / trang; trích dẫn không có thật bị cảnh báo. Bấm tệp trong cây tệp cũng mở khung này.
- **Trộn thư hàng loạt** (`/tronthu`): mẫu Word/PowerPoint có `{{Tên cột}}` + bảng Excel/CSV → mỗi dòng một tệp (hoặc một tệp Word gộp); xem trước bản đầu, tối đa 200 bản, không ghi đè, `/undo` cả lô.
- **Dữ liệu cá nhân** (`/quetcanhan`): quét CCCD/CMND, SĐT, email, mã số thuế, số tài khoản, mã sinh viên (chỉ báo số lượng + vị trí, giá trị che); tạo **bản sao đã che**; đọc tài liệu có dữ liệu nhạy cảm thì agent nhắc trước khi chia sẻ.
- **Word dạng đề xuất**: `docx_replace` với `suggest` ghi **Track Changes thật** (Chấp nhận/Từ chối trong Word) + bảng trước → sau.
- **Bảng tổng hợp** (`/bangtonghop`, kiểu PivotTable) bằng công thức sống `SUMIFS/COUNTIFS/AVERAGEIFS`, tô màu điều kiện; **biểu đồ thật trong PowerPoint** (khối ` ```chart `). Excel/Word không tạo được biểu đồ (thư viện không hỗ trợ).
- **⚡ Quy trình của tôi**: lưu việc vừa làm thành lệnh `/tên` của dự án (`.neuagent/commands`); `/bienban` kèm bảng theo dõi việc (Excel) từ biên bản.

## Dự án và lịch sử trò chuyện

Như Claude Code/ChatGPT Projects: **mỗi tab có nhiều dự án**. Nút tên dự án ở thanh bên mở danh sách để chuyển, tạo mới (*Dự án mới…*, kèm hướng dẫn riêng lưu thành `AGENTS.md`), đổi tên hoặc bỏ khỏi danh sách (không xoá tệp). Ở bản **Desktop**, *Mở thư mục có sẵn…* thêm một thư mục thật trên máy làm dự án (từ chối gốc ổ đĩa, thư mục cá nhân, thư mục hệ thống, `~/.ssh`…); dự án tạo mới nằm ở `Tài liệu/NEU Agent/<Work|Code|Design>/`. Mỗi dự án có **các cuộc trò chuyện được lưu** (ở thư mục dữ liệu ứng dụng, không ghi vào thư mục dự án); bấm để mở lại và hỏi tiếp đúng ngữ cảnh cũ.

## Tài liệu

- **[Training](docs/training/README.md)**: [kịch bản cho sinh viên (Code)](docs/training/KICH-BAN-CODE.md) · [kịch bản cho khối văn phòng (Work)](docs/training/KICH-BAN-WORK.md) · [kịch bản thiết kế (Design)](docs/training/KICH-BAN-DESIGN.md)
- **[Triển khai, vận hành, mô hình bảo mật](docs/DEPLOY.md)**
- `legacy/fitcode-python/HUONG-DAN-GIANG-VIEN.md`: cấp key và theo dõi sử dụng

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `packages/core` | Lõi TypeScript dùng chung: vòng lặp agent, công cụ, **quyền** (phân tích lệnh shell, quy tắc allow/deny), chế độ plan, nén ngữ cảnh, lệnh `/`, hồ sơ Code/Work, **module Office** (`office/`: Word, Excel có tính công thức, PowerPoint, PDF) |
| `packages/env-node` | Nơi chạy "thật": file, lệnh (có timeout/ngắt), `web_fetch` chặn SSRF, xuất PDF qua LibreOffice, kho cài đặt mã hoá key |
| `packages/ui` | Giao diện dùng chung cho web và Desktop (thanh hai tab, thẻ công cụ, diff, xin quyền, kéo thả tệp) |
| `apps/web` | Bản web (tệp tĩnh), thư mục ảo lưu trong trình duyệt, hộp cát chạy JS; máy chủ dev + LLM giả |
| `apps/desktop` | Bản Electron: hai phiên trên thư mục thật, IPC cách ly, kiểm thử đầu-cuối `smoke` |
| `apps/playground` | Trang thử mô hình `http://192.0.2.11:8037/docs/` (một file HTML) |
| `server/gateway-232` | Bản sao script vận hành gateway LLM ở 232 (vLLM, kong-usage, sao lưu, nginx); không chứa khóa bí mật |
| `legacy/fitcode-python` | FIT Code bản Python gốc (chỉ dùng thư viện chuẩn): giữ để tham khảo; lõi TypeScript đã thay thế và sửa các lỗ hổng quyền của bản này |

Phần giám sát gateway trong ứng dụng SIM nằm trong repo SIM, không chép vào đây.

## Thiết kế chính

- **Lõi không phụ thuộc nơi chạy:** agent chỉ nói chuyện qua giao diện `Env` (file + chạy lệnh/JS/web tuỳ chọn), nên cùng một lõi chạy ở Node (thật), Electron và trình duyệt (thư mục ảo).
- **An toàn theo nhiều lớp:** đường dẫn bị giới hạn trong thư mục (kể cả liên kết tượng trưng); lệnh shell được *phân tích* (tách `&&`/`;`/`|`, từ chối `$()`/backtick/`$VAR`…) trước khi cho tự động; lệnh phá hoại bị chặn; mọi hành động có tác dụng phụ đều hỏi, kèm diff/bản mô tả; cấu hình trong thư mục dự án **không tin cậy** theo mặc định (không đổi được máy chủ/key; quy tắc `allow` cần bấm "Tin cậy").
- **Office thật, không giả lập:** tạo `.docx` đúng thể thức hành chính Việt Nam (quốc hiệu, nơi nhận, chữ ký), `.xlsx` với công thức được tính sẵn và đối chiếu, `.pptx` có ghi chú; đọc lại để kiểm chứng; kiểm tra bằng LibreOffice/Word.
- **Chính sách cấp trường** (đã có nền): giao diện không nhận lại key; cấu hình dự án chỉ được *thắt chặt* thêm. Tệp chính sách quản trị không sửa được (địa chỉ máy chủ, quy tắc cấm bắt buộc) là bước tiếp theo.

## Trạng thái

Chạy được và đã kiểm thử: lõi (~100 test), Office, bản web, bản Desktop (kiểm thử đầu-cuối trên Electron thật). Đã có: hook, subagent, skill, MCP, tiến trình nền, bài học và bài tập chấm tự động, sandbox macOS, gói cài Windows/macOS (chưa ký số). Chưa làm: ký số gói cài, sandbox Windows, OCR cho PDF scan, trình soạn thảo/terminal tương tác trong bản web, mở thư mục thật trong trình duyệt (File System Access API), tệp chính sách cấp trường. Xem mục "Hạn chế đã biết" trong [docs/DEPLOY.md](docs/DEPLOY.md).
