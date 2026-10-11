# Gói dữ liệu đăng bài (khi người dùng muốn dán thẳng vào website)

Handio chỉ soạn, KHÔNG đăng và không gọi giao diện lập trình của website; đăng bài là việc của người dùng trong trang quản trị. Mặc định bài lưu kèm khối "Dữ liệu đăng" dưới đây; chỉ làm HTML và bản tiếng Anh khi người dùng chọn (hỏi trong câu ask_user của bước 2, dạng chọn nhiều).

## Khối "Dữ liệu đăng" (mặc định, đặt sau Body, ngăn bằng dòng ---)

- **Slug**: kebab-case không dấu từ Title (dùng `vn_text` action slug), ngắn gọn, ví dụ "hoc-bong-truong-he-ai-2026". Website KHÔNG tự sinh slug: bỏ trống thì bài không truy cập được bằng đường dẫn công khai.
- **Danh mục gợi ý** (chọn một): sự kiện (su-kien), hội thảo (hoi-thao), thông báo (thong-bao), tuyển sinh (tuyen-sinh), học bổng (hoc-bong), cuộc thi (cuoc-thi), tin tổng hợp (tin-tong-hop).
- **Thẻ**: 3–5 thẻ.
- **Ảnh đại diện**: bắt buộc phải có khi đăng; Handio không tạo/tìm ảnh. Gợi ý: ảnh thật chuyên nghiệp, ngang, rộng tối thiểu ~2000 px; nguồn tự do ghi rõ giấy phép và tác giả vào chú thích (vd "Ảnh: tên tác giả, CC BY 2.0").
- **SEO tiếng Việt**: 
  - metaTitle ≤ 60 ký tự, dạng "{Tiêu đề rút gọn} | Khoa CNTT NEU";
  - metaDescription 120–160 ký tự, viết lại từ Description, có từ khoá chính, không chép nguyên;
  - keywords: 5–7 cụm, cách nhau ", " (vd "Khoa CNTT NEU", "Đại học Kinh tế Quốc dân", tên ngành nếu là tuyển sinh; bài chuyên môn dùng từ khoá kỹ thuật cụ thể);
  - metaRobots: "index, follow";
  - tiêu đề chia sẻ mạng xã hội ≤ 60 ký tự, mô tả ≤ 65 ký tự.
  Đếm ký tự cẩn thận: vượt giới hạn thì website báo lỗi khi lưu.

## Bản HTML cho trình soạn thảo (khi được yêu cầu)

Nội dung website là HTML. Chuyển Body markdown theo quy tắc:

| Markdown | HTML |
|---|---|
| "## 📅 Tiêu đề" | h2 có style "margin-top:0.5em;" (không dùng giá trị lớn hơn) |
| đoạn văn | p |
| **x** / *x* | strong / em |
| danh sách | ul/ol với li |
| [chữ](url) | a href |
| bảng | figure class="table" bọc table style "width:100%;" có thead/tbody |
| khối mã | pre chứa code class="language-<tên>" |

- Bảng: KHÔNG tự thêm border, padding, border-collapse cho td/th (giao diện của website đã có kiểu cho bảng; thêm vào sẽ đè và xấu). Cột đầu có nhãn ngắn: th style "width:30%;" (10% cho cột số thứ tự).
- Khối mã: bắt buộc có class ngôn ngữ (python, javascript, java, cpp, sql, bash, yaml, json, html, css…); không dùng "plaintext" cho mã thật; không bịa tên ngôn ngữ lạ.
- Giữ emoji nguyên trong tiêu đề h2. Lưu thành tệp .html riêng, không trộn vào tệp .md.

## Bản tiếng Anh (khi được yêu cầu)

Dịch Title, Description, Body, GIỮ NGUYÊN cấu trúc (chỉ dịch chữ), slug ASCII mới; kèm SEO tiếng Anh.
- Giữ tên riêng người Việt có dấu. Tên đơn vị: Khoa Công nghệ thông tin → Faculty of Information Technology; Đại học Kinh tế Quốc dân → National Economics University; Trường Công nghệ → College of Technology.
- Ngày 20/05/2026 → May 20, 2026; giờ 9h30 → 9:30 AM.
- Title 10–15 từ, description ≤ 200 ký tự; tránh sáo ngữ tiếng Anh ("In today's digital age", "Let's explore"). Thẻ dịch sang tiếng Anh (3–5). metaTitle dạng "{Title} | FIT NEU".
