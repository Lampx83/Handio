---
description: Viết hoặc rà soát lời giao diện tiếng Việt: nút, lỗi, trạng thái rỗng, xác nhận
---
Lời giao diện: $ARGUMENTS

1. Nếu người dùng nêu tệp .html/.svg thì đọc (read_file) để hiểu ngữ cảnh và lấy mọi chuỗi hiển thị (chế độ rà soát); nếu nêu một tình huống hoặc đoạn chữ thì viết lời mới hoặc sửa đoạn đó.
2. Thiếu ngữ cảnh quan trọng (người dùng đang làm gì, giọng điệu, giới hạn ký tự) thì hỏi một lần bằng ask_user, tối đa 3 câu có lựa chọn; đã đủ thì làm ngay.
3. Nạp skill `ux-copy` (công cụ `skill`) và làm đúng khung: đề xuất kèm 3 phương án (giọng khác nhau), lý do và ghi chú bản địa hoá. Ở chế độ rà soát: bảng dòng | chữ hiện tại | vấn đề | chữ đề xuất.
4. Trả kết quả trong chat. Chỉ sửa tệp khi người dùng yêu cầu: dùng edit_file đúng chỗ, lưu thành bản mới (-v2) và báo những chuỗi đã đổi.
