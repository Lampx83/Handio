---
description: Đọc ảnh chụp/scan (công văn, biên bản, bảng, ghi chú) và chuyển thành văn bản Word
---
Chuyển nội dung ảnh sang văn bản: $ARGUMENTS

Dùng `read_image` để đọc từng ảnh được nêu (hoặc mọi ảnh trong thư mục làm việc nếu người dùng không chỉ rõ; hơn 15 ảnh thì làm theo lô và nói rõ). Với tài liệu nhiều trang, đọc theo thứ tự tên tệp và nối thành một văn bản liền mạch. Giữ nguyên chữ, dấu tiếng Việt, số liệu, tên riêng; chỗ không đọc được ghi "[không đọc được]" — không đoán. Trình bày lại đúng cấu trúc gốc (tiêu đề, đánh số, bảng). Tạo tệp Word MỚI bằng `create_docx` (không ghi đè), đọc lại để kiểm tra, rồi báo cáo ngắn: các ảnh đã đọc, số chỗ không chắc chắn kèm vị trí để người dùng đối chiếu với ảnh gốc. Nhắc rằng số liệu quan trọng (số tiền, ngày, số hiệu) cần được đối chiếu lại bằng mắt.
