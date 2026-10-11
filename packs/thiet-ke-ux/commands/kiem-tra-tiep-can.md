---
description: Kiểm tra tiếp cận WCAG 2.1 AA cho thiết kế HTML/SVG: tương phản, nhãn, bàn phím, vùng chạm
---
Kiểm tra tiếp cận: $ARGUMENTS

1. Xác định đối tượng: tệp .html/.svg được nêu, hoặc glob *.html và *.svg trong dự án (nói rõ đã chọn tệp nào); ảnh chụp thì đọc bằng read_image và ghi rõ không đo được chính xác. Chuẩn mặc định là WCAG 2.1 AA; chỉ hỏi (ask_user, một lần) khi không rõ đối tượng.
2. Từ 3 tệp trở lên hoặc tệp dài: giao subagent `reviewer-thiet-ke` (công cụ `task`) mỗi lần một nhóm tệp để lấy danh sách phát hiện có dòng, rồi gộp.
3. Nạp skill `accessibility-review` (công cụ `skill`) và làm đúng khung: tính tương phản mọi cặp chữ/nền chính bằng calc, kiểm từng tiêu chí bằng mã, kèm số dòng; mục cần kiểm tay (trình đọc màn hình, bàn phím thật, phóng 200%) liệt kê ở cuối.
4. Trả báo cáo theo mẫu trong chat, xếp theo mức. Không sửa tệp trừ khi người dùng yêu cầu; nếu yêu cầu sửa thì sửa các lỗi Nghiêm trọng bằng edit_file vào bản mới (-v2), đọc lại và tính lại tương phản các chỗ đã đổi.
