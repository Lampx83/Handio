# Cấu trúc Dự toán (.xlsx)

## Hai cách làm

- **Cách A (có mẫu Dự toán .xlsx của Khoa trong dự án):** `copy_file` mẫu sang tên mới, `read_document` để biết ô nào là gì, rồi `xlsx_edit` (set, append_rows, insert_rows…) điền tên hoạt động (mẫu gốc: dòng 8) và các dòng chi phí; giữ nguyên các căn cứ cố định phía trên bảng và khối chữ ký của mẫu.
- **Cách B (không có mẫu):** dựng bằng `create_xlsx` (header=false để tự đặt khối đầu), rồi `xlsx_edit` format: tiêu đề đậm, `number_format` "#,##0" cho cột tiền, dòng Tổng cộng đậm, độ rộng cột.

## Bố cục

1. Khối đầu: tên đơn vị; "DỰ TOÁN KINH PHÍ"; tên hoạt động (một dòng riêng); các căn cứ cố định của năm (lấy từ `du-lieu/nguoi-ky.md`, thiếu thì "[cần bổ sung]").
2. Bảng chi tiết, hàng tiêu đề đúng 7 cột A–G:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| TT | Nội dung | Đơn vị tính | Số lượng | Đơn giá | Thành tiền | Ghi chú |

   - Nhóm khoản chi đánh số La Mã, từng khoản đánh 1, 2, 3…
   - Thành tiền (F) = D × E bằng công thức, ví dụ "=D14*E14". KHÔNG gõ số đã tính.
   - Hàng cuối bảng: A = "Tổng cộng", F = "=SUM(F[đầu]:F[cuối])".
3. Dưới bảng:
   - "Trong đó Nhóm 2": =SUMIF(G[đầu]:G[cuối],"Nhóm 2*",F[đầu]:F[cuối]); "Trong đó Nhóm 3": tương tự với "Nhóm 3*". Nhóm 2 + Nhóm 3 phải bằng Tổng cộng: mỗi khoản chi thuộc đúng một trong hai nhóm, ô Ghi chú bắt đầu bằng "Nhóm 2" hoặc "Nhóm 3".
   - "Bằng chữ:" gọi `vn_number_words` (value = tổng, currency "vnd"), chép nguyên kết quả; số tổng đổi thì phải gọi lại.
   - Khối chữ ký: Người lập dự toán; Xác nhận của đơn vị (chức danh theo cấp); Kế toán trưởng. Họ tên lấy từ `du-lieu/nguoi-ky.md` theo cấp; thiếu thì "[cần bổ sung: họ tên]".

## Quy tắc tiền

- Đơn giá, Thành tiền, Tổng cộng đều là số nguyên đồng, KHÔNG lẻ dưới 1.000đ.
- Đơn giá lấy theo thứ tự: người dùng nêu; `du-lieu/dinh-muc.csv` nếu có; dự toán cũ cùng loại trong dự án (`find_in_documents`). Không có căn cứ nào thì tự đề xuất mức hợp lý nhưng ghi "(đề xuất)" ở Ghi chú của dòng đó và liệt kê trong báo cáo để Trưởng khoa xác nhận.
- Khoản thường gặp tuỳ loại hoạt động: thù lao báo cáo viên/diễn giả, hỗ trợ công tác chỉ đạo điều hành, giải khát giữa giờ, in ấn tài liệu, văn phòng phẩm, thuê hội trường/thiết bị, truyền thông. Chỉ đưa khoản thật sự cần cho hoạt động.
- Có ngân sách dự kiến từ người dùng: tổng dự toán phải khớp (hoặc nói rõ chênh lệch).
- Tính toán dùng `calc`, không nhẩm.

## Mẫu có khối người nhận (EP17 của Khoa CNTT)

Khi mẫu của người dùng có khối cột người nhận từ J trở đi và hai cột H, I:
- H = Tổng 1 (phần chưa phân bổ theo tên), I = Tổng 2 (đã phân bổ theo tên).
- Công thức H = F − I (KHÔNG I − F); I = SUM(J:cột cuối) cho dòng có phân bổ theo tên, I = F cho dòng không phân bổ theo tên.
- Hàng roster nằm cùng hàng tiêu đề bảng, từ cột J, mỗi cột một người: "Họ tên;Đơn vị;Số tài khoản;Ngân hàng" (dấu ; liền, không khoảng trắng). Lấy từ `du-lieu/nguoi-nhan.csv`; không có thì để trống, KHÔNG bịa số tài khoản.
- Việc chia số tiền cho từng người thuộc skill `phan-bo-tien-du-toan` (lệnh /phan-bo-du-toan): ở bước này chỉ dựng bảng chi tiết và roster, trừ khi người dùng đã nói rõ ai nhận bao nhiêu.
