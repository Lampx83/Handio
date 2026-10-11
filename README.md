# Handio

Trợ lý AI dạng *agent* làm việc trực tiếp trên tệp của bạn: soạn và chỉnh **Word, Excel, PowerPoint, PDF**, viết và sửa **mã nguồn**, thiết kế **poster, trang web, slide, logo**. Phát triển tại Trường Đại học Kinh tế Quốc dân.

Một ứng dụng, **ba tab**. Mỗi tab có **dự án** riêng (thư mục + hướng dẫn + lịch sử trò chuyện):

| Tab | Cho ai | Làm gì |
|---|---|---|
| **Work** | Khối văn phòng, giảng viên | Tóm tắt, soạn thảo, tính toán, rà soát, làm slide từ Word / Excel / PowerPoint / PDF; **tạo mới và sửa tệp có sẵn tại chỗ** (nội dung, định dạng, màu sắc, cấu trúc); tìm xuyên tài liệu; không có terminal |
| **Code** | Sinh viên, người học lập trình | Đọc/sửa mã, lập kế hoạch, chạy thử, sửa đến khi chạy được; xem diff trước khi duyệt; hoàn tác |
| **Design** | Truyền thông, giảng viên, sinh viên | Poster, tờ rơi, landing page, slide, logo, infographic… viết thành HTML/SVG, **xem trước ngay** trong khung cách ly, xuất PDF/PNG (Desktop) |

Chạy ở **web** (trình duyệt, thư mục ảo) và **máy tính** (Electron, thư mục thật; tự cập nhật).

## Điểm nổi bật

- **Hỏi lại trước khi làm.** Yêu cầu tạo mới còn thiếu thông tin (mục đích, người xem, độ dài, phong cách…) thì agent hỏi bằng thẻ chọn đáp án, rồi mới bắt tay làm.
- **Sửa đúng tệp, không sinh bản sao.** Agent có công cụ sửa riêng cho Word (`docx_edit`), Excel (`xlsx_edit`) và PowerPoint (`pptx_edit`); mọi thay đổi hoàn tác được.
- **Trực quan, chuyên nghiệp mặc định.** Slide có bìa, mục lục, chủ đề màu theo nội dung, bố cục đa dạng; Excel có biểu đồ thật và công thức sống; Word có tiêu đề, bảng, hộp lưu ý; PDF A4 có mục lục và số trang.
- **Yên lặng với người dùng văn phòng.** Các bước của agent gập thành một dòng "Hoàn tất · N bước"; xong thì hiện kết quả và nút mở tệp. Muốn xem từng bước: Cài đặt › Giao diện.
- **Làm cho xong.** Agent tự đi tiếp qua nhiều bước, tự tóm tắt ngữ cảnh khi dài; vòng tròn cạnh nút Gửi cho biết ngữ cảnh đang dùng vào việc gì.
- **Trích dẫn bấm xem được.** Câu trả lời từ tài liệu kèm chip `[1]` mở khung xem tài liệu và tô sáng đúng đoạn / ô / slide / trang.

### Tab Work

- **Tạo và sửa Office:** `create_docx`, `create_xlsx`, `create_pptx` (có `slide_count`, chủ đề màu, biểu đồ, ghi chú diễn giả) và các công cụ sửa; thể thức hành chính Việt Nam (quốc hiệu, nơi nhận, chữ ký).
- **PDF:** xem thông tin, lấy chữ, tách, gộp, xoay, ghép ảnh thành PDF, tạo PDF từ nội dung (Desktop).
- **Trộn thư hàng loạt** (`/tronthu`): mẫu Word/PowerPoint có `{{Tên cột}}` + bảng Excel/CSV → mỗi dòng một tệp; xem trước bản đầu, không ghi đè.
- **Dữ liệu cá nhân** (`/quetcanhan`): quét CCCD, số điện thoại, email, mã số thuế, số tài khoản… (chỉ báo số lượng và vị trí) và tạo bản sao đã che.
- **Word dạng đề xuất:** ghi *Track Changes* thật để người nhận Chấp nhận/Từ chối trong Word.
- **Bảng tổng hợp** (`/bangtonghop`) bằng công thức sống; biểu đồ thật trong Excel và PowerPoint.
- **Tiện ích chính xác:** đọc số thành chữ, ngày/ngày làm việc/âm lịch, máy tính, CSV, email `.eml`, lịch `.ics`, so sánh văn bản.
- **Lệnh nghiệp vụ** dạng `/tên` (công văn, thông báo, hợp đồng, biên bản, email…) và **⚡ Quy trình của tôi**: lưu việc vừa làm thành lệnh dùng lại.
- Công cụ ít dùng (PDF, quản lý tệp, tiện ích, trộn thư) chỉ nạp khi cần để dành ngữ cảnh cho công việc chính.

### Tab Code

- **± Thay đổi** (`/diff`): tệp agent đã tạo/sửa/xoá với +/−, xem diff từng tệp, hoàn tác từng tệp hoặc tất cả.
- **↶ Quay lại** (`/rewind`, hoặc Esc hai lần): cắt hội thoại về trước một lượt và khôi phục các tệp đã đổi.
- **Thẻ tổng kết** cuối lượt: số tệp, +/−, đã chạy kiểm tra sau lần sửa cuối chưa.
- `@tệp` (gợi ý khi gõ), `!lệnh`, `/init` tạo `AGENTS.md`, `Shift+Tab` chế độ lập kế hoạch, `Esc` dừng; `/status`, `/context`.
- **Hướng dẫn cho agent:** `AGENTS.md` ở gốc dự án và thư mục con, quy tắc theo phạm vi ở `.agents/rules/`.
- **📚 Học:** bài học, bài tập chấm tự động và dự án mẫu cho người mới.
- **▶ Chạy** (Desktop): gợi ý lệnh chạy/test từ `package.json`, `*.py`, `index.html`… và nhờ agent chạy (vẫn phải duyệt).

### Tab Design

- Chọn khổ **A4 / vuông / story / slide / điện thoại**; mẫu có sẵn gõ `/` để chọn.
- **Chỉ vào để sửa:** bấm thẳng vào phần cần đổi rồi bấm *To hơn*, *Đổi màu*, *Viết ngắn lại*… không cần mô tả vị trí.
- Xuất **PDF / PNG** (Desktop).

## Chạy thử

```bash
npm ci                 # Node 22
npm run dev:web        # web: http://127.0.0.1:5173 (có "Demo giả lập", không cần key)
npm run desktop        # ứng dụng Electron (NEU_MOCK=1 để có Demo giả lập)
npm test               # kiểm thử tự động
npm run typecheck      # kiểm tra kiểu toàn kho
npm run smoke          # kiểm thử đầu-cuối bản Desktop (mở cửa sổ Electron)
```

## Kết nối mô hình

Handio dùng một máy chủ mô hình có **API kiểu OpenAI** (chat completions, có gọi công cụ). Địa chỉ và khoá cấu hình ở **Cài đặt**, hoặc cố định lúc dựng bản cài (`NEU_DEFAULT_BASE_URL`). Bản web thường để máy chủ nginx gắn khoá phía sau, người dùng không phải nhập; cách triển khai ở [docs/DEPLOY.md](docs/DEPLOY.md).

## Dự án và lịch sử trò chuyện

**Mỗi tab có nhiều dự án.** Nút tên dự án ở thanh bên mở danh sách để chuyển, tạo mới (kèm hướng dẫn riêng lưu thành `AGENTS.md`), đổi tên hoặc bỏ khỏi danh sách (không xoá tệp). Ở bản **Desktop**, *Mở thư mục có sẵn…* thêm một thư mục thật trên máy làm dự án (từ chối gốc ổ đĩa, thư mục cá nhân, thư mục hệ thống, `~/.ssh`…). Mỗi dự án có **các cuộc trò chuyện được lưu** (ở thư mục dữ liệu ứng dụng, không ghi vào thư mục dự án); bấm để mở lại và hỏi tiếp đúng ngữ cảnh cũ.

Danh sách tệp của dự án nằm ở **thanh bên phải**, cùng chỗ với khung xem tài liệu; tệp tạm của Office (`~$…`) được ẩn.

## Mở rộng bằng gói (packs)

Kỹ năng, lệnh `/` và agent chuyên biệt được đóng thành **gói** trong thư mục [`packs/`](packs/README.md) (một gói = `pack.json` + `prompt.md` + `skills/` + `commands/` + `agents/`), đi kèm bản cài và đọc lúc chạy. Một tổ chức khác chỉ cần thay nội dung `packs/`, không đụng mã lõi. Hướng dẫn: [docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `packages/core` | Lõi TypeScript dùng chung: vòng lặp agent, công cụ, **quyền** (phân tích lệnh shell, quy tắc allow/deny), chế độ lập kế hoạch, nén ngữ cảnh, lệnh `/`, hồ sơ ba tab, **module Office** (`office/`: Word, Excel có tính công thức, PowerPoint, PDF) |
| `packages/env-node` | Nơi chạy "thật": file, lệnh (có timeout/ngắt), `web_fetch` chặn SSRF, kho cài đặt mã hoá khoá |
| `packages/ui` | Giao diện dùng chung cho web và Desktop (DOM thuần, không framework) |
| `apps/web` | Bản web (tệp tĩnh), thư mục ảo trong trình duyệt, hộp cát chạy JS; máy chủ dev có mô hình giả |
| `apps/desktop` | Bản Electron: IPC cách ly, đăng nhập, tự cập nhật, kiểm thử đầu-cuối `smoke` |
| `packs/` | Gói kỹ năng/lệnh/agent đi kèm (xem trên) |
| `deploy/` | Triển khai máy chủ (nginx, đăng nhập SSO, chẩn đoán, hạn mức) và bài thử Docker |
| `docs/` | Tài liệu vận hành, bảo mật, phát hành |

## Thiết kế chính

- **Lõi không phụ thuộc nơi chạy:** agent chỉ nói chuyện qua giao diện `Env` (file + chạy lệnh/JS/web tuỳ chọn), nên cùng một lõi chạy ở Node (thật), Electron và trình duyệt (thư mục ảo).
- **An toàn theo nhiều lớp:** đường dẫn bị giới hạn trong thư mục (kể cả liên kết tượng trưng); lệnh shell được *phân tích* (tách `&&`/`;`/`|`, từ chối `$()`/backtick/`$VAR`…) trước khi cho tự động; lệnh phá hoại bị chặn; mọi hành động có tác dụng phụ đều hỏi, kèm diff hoặc bản mô tả; cấu hình trong thư mục dự án **không tin cậy** theo mặc định.
- **Office thật, không giả lập:** `.docx` đúng thể thức, `.xlsx` với công thức được tính sẵn và đối chiếu, `.pptx` có ghi chú và biểu đồ thật; đọc lại để kiểm chứng; kiểm tra bằng LibreOffice.
- **Riêng tư:** số liệu chẩn đoán chỉ gồm mã và số, không có nội dung hội thoại hay tên tệp ([docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md)).

Mô hình bảo mật đầy đủ: [docs/SECURITY.md](docs/SECURITY.md). Báo lỗ hổng: [SECURITY.md](SECURITY.md).

## Tài liệu

- [Cài đặt Desktop](docs/INSTALL.md) · [Triển khai và vận hành](docs/DEPLOY.md) · [Phát hành và cập nhật](docs/RELEASE.md) · [CI/CD](docs/CICD.md)
- [Cấu hình riêng của nơi triển khai, giữ kho sạch](docs/PUBLIC.md) · [Hạn mức token](docs/QUOTA.md)
- [Mở rộng bằng gói](docs/EXTENSIONS.md) · [Khoảng trống của công cụ Office](docs/KHOANG-TRONG-OFFICE.md)
- [Kịch bản đào tạo](docs/training/README.md): [Work](docs/training/KICH-BAN-WORK.md) · [Code](docs/training/KICH-BAN-CODE.md) · [Design](docs/training/KICH-BAN-DESIGN.md)
- [Nhật ký thay đổi](CHANGELOG.md)

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md) (quy trình nhánh → pull request → CI) và [AGENTS.md](AGENTS.md) (hướng dẫn cho người và AI viết mã trong kho).

## Giấy phép

Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Tên, logo và nhận diện của Trường Đại học Kinh tế Quốc dân không nằm trong giấy phép.
