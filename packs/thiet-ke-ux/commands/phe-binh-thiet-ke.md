---
description: Phê bình thiết kế (HTML/SVG hoặc ảnh chụp): thứ bậc, khả năng dùng, nhất quán, tiếp cận
---
Phê bình thiết kế: $ARGUMENTS

1. Xác định đối tượng: tệp .html/.svg được nêu (read_file); ảnh chụp thì đọc bằng read_image; không nêu gì thì glob *.html và *.svg, lấy tệp mới sửa gần nhất và nói rõ đã chọn tệp nào.
2. Thiếu bối cảnh (thiết kế này là gì, cho ai, giai đoạn khám phá / chỉnh sửa / hoàn thiện, cần soi phần nào) thì hỏi một lần bằng ask_user, tối đa 3 câu có lựa chọn; đã rõ thì làm ngay.
3. Nạp skill `design-critique` (công cụ `skill`) và làm đúng khung đó: mỗi phát hiện kèm số dòng, mức độ, cách sửa; tính tương phản bằng calc, không ước lượng; phần cần mắt người ghi là "cần kiểm tay".
4. Trả báo cáo trong chat theo mẫu. Không sửa tệp. Kết thúc bằng việc hỏi người dùng có muốn sửa các mục ưu tiên (bản mới -v2) hoặc xuất báo cáo Word không.
