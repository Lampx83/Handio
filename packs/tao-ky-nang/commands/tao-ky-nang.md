---
description: Tạo lệnh /tên hoặc kỹ năng riêng cho dự án này từ mô tả việc lặp lại, rồi chạy thử
---
Tạo lệnh hoặc kỹ năng riêng cho dự án: $ARGUMENTS

1. Nạp skill `tao-ky-nang` (công cụ `skill`) và làm theo quy trình trong đó.
2. Nếu việc người dùng muốn lưu vừa được làm xong trong cuộc trò chuyện này, rút các bước, tệp vào/ra và chỗ người dùng đã sửa từ chính cuộc trò chuyện thay vì hỏi lại. Còn thiếu (khi nào dùng, đầu ra mong muốn, trường hợp biên) thì hỏi một lần bằng ask_user, tối đa 3 câu có lựa chọn.
3. Chọn loại: lệnh một việc (tệp `.neuagent/commands/<tên>.md`) hoặc kỹ năng có quy trình dài (thư mục `.neuagent/skills/<tên>/` có SKILL.md). Tên viết thường không dấu, số, gạch nối; dùng list_dir trên `.neuagent/commands` (nếu có) để không trùng tên đang có.
4. Viết tệp bằng write_file (ghi vào `.neuagent/` sẽ hiện thẻ xin quyền: nói trước với người dùng và đừng thử cách khác để né). Rồi chạy thử MỘT lần với ví dụ thật, xem kết quả, sửa chỗ yếu và báo: tên lệnh, cách gọi, kết quả chạy thử.
