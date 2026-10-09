---
name: kiem-tra-giao-dien
description: Danh sách kiểm tra giao diện web (bố cục, chữ, màu, điện thoại, truy cập, hiệu năng) và cách sửa nhanh từng lỗi hay gặp.
---
# Kiểm tra giao diện trước khi giao

Đọc lại toàn bộ HTML/CSS đã tạo và đối chiếu từng nhóm dưới đây. Lỗi nào thấy được thì sửa luôn, rồi mới báo xong.

**Bố cục & điện thoại**
- Có `<meta name="viewport" content="width=device-width, initial-scale=1">` và ít nhất một `@media (max-width: 640px)`; cột chuyển thành một cột, không cuộn ngang (không có phần tử rộng cố định > 100vw; ảnh `max-width:100%`).
- Khoảng cách theo thang cố định (ví dụ 4/8/16/24/32), lề trang ≥ 16px trên điện thoại, nội dung dài có `max-width` (~70ch).
- Nút và liên kết bấm được cao ≥ 44px trên điện thoại.

**Chữ & màu**
- Cỡ chữ thân ≥ 16px, dòng cách ≥ 1,5; chỉ 1–2 họ chữ, dùng font hệ thống có hỗ trợ tiếng Việt khi không nhúng font.
- Tương phản chữ/nền ≥ 4,5:1 (chữ nhỏ), ≥ 3:1 (chữ lớn); không dùng màu là cách duy nhất để truyền ý (thêm biểu tượng/chữ).
- Màu khai báo bằng biến CSS (`--bg`, `--fg`, `--accent`…); hỗ trợ `prefers-color-scheme: dark` nếu trang có nền.

**Truy cập được**
- Một `<h1>`, thứ tự tiêu đề không nhảy cấp; vùng `<header> <main> <footer>`; ảnh có `alt` (ảnh trang trí `alt=""`).
- Mọi điều khiển dùng được bằng bàn phím, có trạng thái `:focus-visible` rõ; nhãn cho ô nhập (`<label for>`); `lang="vi"` trên thẻ html.
- Không để nội dung quan trọng chỉ hiện khi rê chuột.

**Hoàn thiện**
- Có trạng thái hover/focus/active/disabled cho nút; trạng thái rỗng và lỗi có lời hướng dẫn, không để trang trắng.
- Không còn chữ giả (lorem ipsum), nút không làm gì, liên kết `#` chết, `console.log` thừa.

**Hiệu năng**
- Ảnh có kích thước hợp lý, `loading="lazy"` cho ảnh dưới màn hình đầu; không tải thư viện lớn cho việc nhỏ; CSS/JS không chặn hiển thị không cần thiết.
