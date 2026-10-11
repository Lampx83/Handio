---
description: Lập đặc tả bàn giao cho lập trình viên từ thiết kế: token, thành phần, trạng thái, responsive
---
Lập đặc tả bàn giao cho: $ARGUMENTS

1. Xác định thiết kế: tệp .html/.svg được nêu (read_file), hoặc glob *.html và *.svg rồi lấy tệp mới sửa gần nhất (nói rõ đã chọn tệp nào). Ảnh chụp thì chỉ mô tả được bố cục, không trích được token chính xác: nói rõ điều đó.
2. Chưa biết công nghệ nhận bàn giao (HTML thuần, React, Tailwind...) thì hỏi một lần bằng ask_user (câu có lựa chọn); đã rõ thì làm ngay.
3. Nạp skill `design-handoff` (công cụ `skill`), trích token, thành phần, trạng thái, @media, chuyển động từ mã thật kèm số dòng. Thông tin thiết kế không có thì ghi "[cần bổ sung]", không tự chế.
4. Tạo MỘT tệp Word mới (create_docx, style modern; dài thì thêm phần bằng cùng đường dẫn và append=true), tên dạng ban-giao-<tên-màn-hình>.docx, rồi đọc lại bằng read_document để kiểm tra. Báo tên tệp, số token và thành phần đã ghi, và các mục "[cần bổ sung]".
