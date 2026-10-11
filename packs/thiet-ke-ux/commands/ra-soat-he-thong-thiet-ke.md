---
description: Rà soát, mô tả tài liệu hoặc mở rộng hệ thống thiết kế (token, thành phần) trong dự án
---
Hệ thống thiết kế: $ARGUMENTS

Chọn chế độ theo yêu cầu: audit (rà soát; mặc định khi không nói rõ), document (tài liệu hoá một thành phần), extend (thêm thành phần/mẫu mới). Không suy ra được thì hỏi một lần bằng ask_user.

1. glob *.css, *.html, *.svg trong dự án (nếu không có tệp nào thì nói rõ và dừng). Nhiều tệp: giao subagent `reviewer-thiet-ke` (công cụ `task`) đếm giá trị gõ cứng và liệt kê tên class/biến theo nhóm, rồi tổng hợp.
2. Nạp skill `design-system` (công cụ `skill`) và làm đúng khung của chế độ đã chọn. Điểm số phải tính bằng calc theo công thức trong skill và ghi công thức.
3. audit: báo cáo trong chat. document: lưu thành Word mới (create_docx). extend: viết đề xuất, và ở tab Design tạo thêm một tệp HTML minh hoạ mới dùng token hiện có (không ghi đè tệp cũ).
4. Không sửa tệp hiện có trừ khi người dùng yêu cầu. Cuối cùng nêu 3 việc ưu tiên.
