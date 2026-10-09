---
description: Đọc nhiều tệp trong thư mục và lập bảng tổng hợp (Excel) kèm tóm tắt
---
Tổng hợp các tệp trong thư mục làm việc theo yêu cầu: $ARGUMENTS

Liệt kê tệp liên quan trước và báo số lượng (nếu hơn 30 tệp, xử lý theo lô và nói rõ). Đọc từng tệp bằng read_document hoặc find_in_documents, trích đúng các trường cần thiết, ghi nguồn (tên tệp + vị trí) cho mỗi dòng. Lập bảng Excel mới bằng create_xlsx có cột "Nguồn", dòng tổng bằng công thức sống, và một trang tóm tắt bằng lời. Tệp không đọc được hoặc thiếu trường thì đánh dấu trong bảng chứ không bỏ lặng lẽ. Đối chiếu ngẫu nhiên ít nhất ba dòng với tệp gốc rồi mới báo xong.
