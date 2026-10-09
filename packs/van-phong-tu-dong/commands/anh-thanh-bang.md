---
description: Đọc bảng trong ảnh chụp/scan và chuyển thành bảng Excel có công thức
---
Chuyển bảng trong ảnh sang Excel: $ARGUMENTS

Dùng `read_image` với chỉ dẫn rõ ràng: trích bảng thành Markdown, giữ đúng số cột và thứ tự, ghi "[không đọc được]" cho ô mờ. Nếu bảng trải qua nhiều ảnh, nối theo thứ tự và bỏ dòng tiêu đề lặp lại. Tạo Excel MỚI bằng `create_xlsx`: số là số thật (không phải chuỗi), ngày dd/mm/yyyy, tiêu đề cột một dòng; nếu ảnh có dòng tổng, đặt công thức sống (SUM…) rồi so với tổng ghi trong ảnh và báo nếu lệch (có thể do đọc sai một ô). Đọc lại tệp, đối chiếu ít nhất ba ô với ảnh gốc, và liệt kê các ô không chắc chắn.
