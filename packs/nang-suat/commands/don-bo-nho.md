---
description: Dọn bộ nhớ dự án: gộp mục trùng, đổi mốc tương đối thành ngày, bỏ mục lỗi thời, giữ AGENTS.md gọn
---
Dọn bộ nhớ dự án theo phần "Gộp và dọn" của skill `bo-nho-du-an` (nạp skill bằng công cụ `skill` trước): $ARGUMENTS

Phạm vi: mục "Thuật ngữ và người-việc" trong AGENTS.md và toàn bộ THUAT-NGU.md; không đụng phần khác của AGENTS.md. Đọc cả hai, lập danh sách mục trùng, mâu thuẫn, nghi lỗi thời rồi sửa bằng `edit_file`. Gộp và chuyển tầng thì làm luôn; muốn bỏ thông tin thì hỏi trước bằng `ask_user`, chưa được trả lời thì chuyển xuống THUAT-NGU.md thay vì xoá. Kết thúc bằng báo cáo ngắn: số mục gộp, chuyển, bỏ, còn chờ quyết định, và độ dài hiện tại của mục nóng.
