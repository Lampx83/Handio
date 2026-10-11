---
description: Tổng hợp ghi chú phỏng vấn/khảo sát thành chủ đề, trích dẫn có nguồn và khuyến nghị ưu tiên (Word)
---
Tổng hợp nghiên cứu người dùng từ: $ARGUMENTS

1. Xác định dữ liệu: các tệp ghi chú/phiên âm/khảo sát (.docx, .xlsx, .txt, .pdf) được nêu; không nêu thì list_dir và hỏi một lần bằng ask_user nên dùng tệp nào. Mỗi tệp thường là một người tham gia; hỏi nếu không rõ.
2. Nạp skill `research-synthesis` (công cụ `skill`) và làm đúng quy trình: đọc từng tệp (read_document), mã hoá, nhóm thành chủ đề, đếm số người, chọn trích dẫn nguyên văn. Chưa có chắc chắn thì nói, không bịa.
3. Kiểm tra trước khi viết: mỗi trích dẫn phải tìm lại được nguyên văn bằng find_in_documents; số "x/y người" khớp bảng mã hoá (dùng calc nếu tính phần trăm).
4. Tạo MỘT tệp Word mới (create_docx, style modern; dài thì thêm phần bằng cùng đường dẫn và append=true), tên dạng tong-hop-nghien-cuu-<chủ-đề>.docx, rồi đọc lại bằng read_document. Chỉ dùng mã ẩn danh P1, P2…. Báo tên tệp, các chủ đề chính và giới hạn của dữ liệu.
