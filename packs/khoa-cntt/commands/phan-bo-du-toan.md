---
description: Chia tiền cho từng người vào tệp Dự toán.xlsx và kiểm tra khớp từng dòng
---
Phân bổ tiền theo người vào tệp Dự toán theo skill `phan-bo-tien-du-toan`. Nạp skill bằng công cụ `skill` trước: $ARGUMENTS

Nếu chưa rõ tệp nào, liệt kê các tệp Dự toán .xlsx trong dự án và hỏi bằng ask_user. Đọc lại tệp ngay trước khi sửa; chỉ CHIA tổng tiền của dòng (không cộng thêm); số tài khoản chỉ lấy từ du-lieu/nguoi-nhan.csv, không có thì hỏi, KHÔNG bịa; chia theo bội số 100.000đ; công thức H = F − I. Sửa bằng `xlsx_edit`, sau đó chạy đủ quy trình kiểm của skill và báo bảng kết quả từng dòng. Không sinh chứng từ.
