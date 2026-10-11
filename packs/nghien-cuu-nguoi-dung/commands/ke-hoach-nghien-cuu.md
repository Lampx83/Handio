---
description: Lập kế hoạch nghiên cứu người dùng: mục tiêu, phương pháp, người tham gia, hướng dẫn phỏng vấn, đạo đức
---
Lập kế hoạch nghiên cứu người dùng cho: $ARGUMENTS

1. Đọc các tài liệu người dùng nêu (read_document) để biết sản phẩm và những gì đã biết. Nếu chưa rõ quyết định cần đưa ra, người dùng là ai, thời gian, thì hỏi một lần bằng ask_user, tối đa 3 câu có lựa chọn; đã rõ thì làm ngay.
2. Nạp skill `user-research` (công cụ `skill`) và làm đúng khung: câu hỏi nghiên cứu, chọn phương pháp kèm lý do, người tham gia và cỡ mẫu, lịch, đạo đức, cách phân tích, sản phẩm bàn giao.
3. Soạn kèm công cụ thu thập phù hợp: hướng dẫn phỏng vấn (khung thời gian, câu hỏi chính, câu thăm dò) hoặc bảng hỏi khảo sát hoặc kịch bản kiểm thử khả dụng.
4. Lưu thành MỘT tệp Word mới (create_docx, style modern; dài thì thêm phần bằng cùng đường dẫn và append=true), tên dạng ke-hoach-nghien-cuu-<chủ-đề>.docx; đọc lại bằng read_document để kiểm tra. Điều chưa biết (ngày, người phụ trách, ngân sách) ghi "[cần bổ sung]". Báo tên tệp và 3 việc nên làm đầu tiên.
