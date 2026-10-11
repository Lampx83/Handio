# Quy trình kiểm bằng công cụ (thay cho chương trình kiểm tra)

Thực hiện SAU mỗi lần sửa và TRƯỚC khi báo xong. `xlsx_edit` tự tính lại mọi công thức và trả giá trị; đọc lại bằng `read_document` (Excel hiện công thức dạng [=…] kèm giá trị) và ghi kết quả từng mục vào báo cáo.

## A. Dò cấu trúc

1. `read_document` sheet chứa bảng, range đủ rộng (vd A1:AA60).
2. Xác định: hàng tiêu đề (có "TT" và "Thành tiền" trong 7 cột đầu), hàng "Tổng cộng" (cột A bắt đầu bằng "Tổng cộng"), các dòng chi tiết nằm giữa, các cột người (từ J, có nội dung ở hàng tiêu đề). Không tìm được cấu trúc này: nói rõ, không đoán, hỏi người dùng.
3. Cột người liền mạch: từ J tới cột cuối không có ô trống ở hàng roster. Có khoảng trống là LỖI.

## B. Từng dòng chi tiết

Với mỗi dòng chi tiết n:
1. F (Thành tiền) bằng D × E (kiểm bằng `calc`); F là công thức, không phải số gõ tay.
2. Dòng CÓ số tiền ở cột người: tổng các ô người = F (cộng bằng `calc`), I = tổng đó, H = F − I = 0. Khác thì đánh dấu LỆCH, nêu dòng và chênh lệch.
3. Dòng KHÔNG phân bổ theo tên (không ô người nào có số): I = F và H = 0; ghi "(chưa phân bổ tên)" trong báo cáo.
4. Công thức H đúng chiều F − I và I đúng dạng SUM hoặc = F; không có H gõ cứng 0.

## C. Tiền lẻ

Mỗi số tiền ở cột người phải chia hết cho 100.000 (kiểm bằng `calc`: giá trị / 100000 là số nguyên). Liệt kê ô lẻ (dòng, cột, giá trị). Mức lẻ 50.000đ là lỗi; chia lại theo vai trò.

## D. Hàng Tổng cộng và theo người

1. Mỗi cột người ở hàng Tổng cộng có công thức SUM đúng dải từ dòng chi tiết đầu đến cuối.
2. Tổng các cột người + tổng cột H (các dòng không phân bổ) = tổng cột F ở hàng Tổng cộng.
3. Sau khi đổi chỗ/xoá cột: tổng theo từng người bằng đúng trước khi sắp xếp.

## E. Roster

Mỗi ô roster có đúng 4 phần ngăn bởi 3 dấu ";" ("Họ tên;Đơn vị;Số tài khoản;Ngân hàng"), không khoảng trắng sau dấu ;, đơn vị đã viết tắt, số tài khoản và ngân hàng khớp `du-lieu/nguoi-nhan.csv`. Không có tên giả của tệp mẫu (Nguyễn Văn A) hoặc số 0000000000.

## F. Báo cáo kiểm

Bảng gọn: dòng | Thành tiền | Tổng người | Kết quả (khớp / LỆCH x đ / chưa phân bổ tên); rồi: số ô lẻ; khoảng trống cột; tổng toàn bảng; kết luận "đạt" chỉ khi mọi dòng khớp, không còn tiền lẻ, cột người liền mạch.

## Giới hạn cần nói thật

- Không có chương trình tính lại ngoài `xlsx_edit`/`read_document`: kết quả kiểm là theo giá trị công thức mà công cụ tính. Nếu người dùng nghi ngờ, bảo họ mở tệp trong Excel và xem cột H có toàn số 0 không.
- Handio không mở phần mềm Thanh toán và không sinh chứng từ.
