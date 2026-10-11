---
name: phan-bo-tien-du-toan
description: Phân bổ tiền cho từng người (tên, đơn vị, số tài khoản, ngân hàng) vào tệp Dự toán.xlsx của Khoa CNTT, rồi kiểm từng dòng có khớp không.
---
# Phân bổ tiền vào Dự toán

Thêm (hoặc sửa) khối "ai nhận bao nhiêu" vào tệp Dự toán đã có bảng chi tiết A–G (TT | Nội dung | Đơn vị tính | Số lượng | Đơn giá | Thành tiền | Ghi chú) nhưng CHƯA có cột người nhận. Khác với việc lập mới hồ sơ (skill `ke-hoach-du-toan-cntt`): ở đây các dòng chi đã có, việc cần làm là gắn tên và số tiền vào từng dòng.

Tệp kèm: `quy-trinh-kiem.md` (cách kiểm bằng công cụ, thay cho chương trình kiểm tra riêng) và `mau-nguoi-nhan.csv` (mẫu GIẢ của `du-lieu/nguoi-nhan.csv`).

Vì sao nghiêm ngặt: tệp này là căn cứ sinh chứng từ thanh toán thật; một dòng lệch là một phiếu chi sai số tiền cho người thật.

## Luồng làm việc

### 1. Đọc tệp ngay trước khi sửa

`read_document` đọc lại tệp NGAY trước khi sửa, kể cả khi vừa đọc vài phút trước: người dùng có thể đang mở và sửa tay trong Excel, và Excel có thể ghi đè lại tệp khi lưu. Công cụ báo tệp đã đổi sau lần đọc thì đọc lại và làm lại từ đầu; nhắc người dùng đóng tệp trong Excel trong lúc bạn sửa. Sau khi sửa, đọc lại để xác nhận thay đổi còn nguyên.

### 2. Xác định dòng nào, cho ai, mức bao nhiêu

Thiếu gì thì hỏi bằng ask_user MỘT lần (tối đa 3 câu, đề xuất mặc định ở lựa chọn đầu):
- Dòng chi nào (suy từ ngữ cảnh gần nhất nếu người dùng đang nói về một khoản).
- Những ai tham gia khoản đó; mức từng người (hoặc để bạn đề xuất theo vai trò).
- Người trùng tên ở nhiều đơn vị: người nào.

Tổng tiền của dòng là CỐ ĐỊNH (= Số lượng × Đơn giá, cột F): phân bổ là CHIA số này ra, không cộng thêm. Muốn tăng tổng là việc khác (sửa Số lượng/Đơn giá), phải hỏi rõ trước.

### 3. Tra người nhận

Chỉ lấy số tài khoản, ngân hàng, đơn vị từ `du-lieu/nguoi-nhan.csv` của dự án (cấu trúc xem `mau-nguoi-nhan.csv`), đọc bằng `read_document` hoặc `find_in_documents`. Trùng họ tên: xem cột đơn vị, hỏi người dùng chọn, không lấy kết quả đầu tiên. Không có người đó trong tệp: hỏi người dùng, KHÔNG bịa số tài khoản. Không nhắc lại đầy đủ số tài khoản trong câu trả lời.

### 4. Cấu trúc thêm vào (từ cột H, ngay sau cột G)

```
H{n} = F{n} - I{n}                 Tổng 1: phần chưa/không phân bổ theo tên
I{n} = SUM(J{n}:<cột cuối>{n})     Tổng 2: dòng CÓ phân bổ theo tên
I{n} = F{n}                        dòng KHÔNG phân bổ theo tên (vd nhà cung cấp ngoài)
```

- Chiều công thức là H = F − I, KHÔNG phải I − F: dòng lệch sẽ hiện số khác 0 ngay khi mở tệp, và dấu cho biết thiếu hay thừa.
- KHÔNG gõ H = 0 bằng tay: H phải là công thức, đó là cơ chế tự kiểm tra.
- Hàng Tổng cộng: mỗi cột người có công thức riêng, ví dụ "=SUM(J14:J21)" cho người ở cột J, chi tiết từ dòng 14 đến 21.

### 5. Hàng roster (cùng hàng với tiêu đề bảng, từ cột J)

Mỗi cột một người, một ô duy nhất: "Họ tên;Đơn vị;Số tài khoản;Ngân hàng". Dấu ; nối liền, KHÔNG khoảng trắng sau dấu ; (phần mềm chứng từ tách chuỗi theo dấu ;).

Đơn vị LUÔN viết tắt: giữ nguyên từ chỉ loại đơn vị (Khoa, Phòng, Viện, Trường, Trung tâm, Bộ môn, Trạm, Tổ, Ban, Văn phòng), phần tên riêng viết tắt bằng chữ cái đầu mỗi từ, viết hoa, bỏ "và", dấu gạch ngang, dấu phẩy. Ví dụ: Khoa Công nghệ thông tin → "Khoa CNTT"; Trường Công nghệ → "Trường CN"; Phòng Tài chính - Kế toán → "Phòng TCKT"; Phòng Quản lý đào tạo → "Phòng QLĐT"; Phòng Quản trị thiết bị → "Phòng QTTB". Tên đơn vị dài, viết tắt khó đọc hoặc dễ nhầm: hỏi người dùng, không đoán.

Danh sách người KHÔNG cố định ở một số giảng viên: bất kỳ ai thực sự tham gia công việc được chi trả đều có thể có mặt, kể cả lãnh đạo Trường, văn phòng, phòng kế toán.

### 6. Cách chia tiền cho một dòng

- "Số lượng" (cột D) chỉ là căn cứ tính Thành tiền, KHÔNG phải số người thật. Đừng suy ra "Số lượng 10 thì đúng 10 người, mỗi người một đơn giá". Lấy TOÀN BỘ số tiền F của dòng, chia cho những người tham gia theo MỨC KHÁC NHAU tuỳ vai trò thực tế, không chia đều máy móc.
- Ví dụ đã dùng: dòng "Hỗ trợ công tác chỉ đạo, điều hành", F = 6.400.000đ, 10 người: lãnh đạo Khoa và lãnh đạo Trường mỗi người 1.000.000đ; 4 người chủ trì chuyên môn mỗi người 600.000đ; 4 người còn lại mỗi người 500.000đ. Tổng vừa khít.
- Thứ bậc KHÔNG cố định giữa các dòng: dòng này lãnh đạo Trường ngang lãnh đạo Khoa, dòng kia có thể nhiều hơn tuỳ ai đứng mũi chịu sào. Không áp tỉ lệ từ dòng này sang dòng khác; không chắc thì hỏi mức cho dòng đang làm.
- Không phải ai cũng có mặt ở MỌI dòng: ô trống là hợp lệ, đừng lấp cho "cân đối".
- Làm tròn: chia theo BỘI SỐ 100.000đ (200k, 300k, 400k…). TRÁNH mức lẻ 50.000đ (150k, 250k…). Tổng không chia tròn đều được thì chia KHÔNG đều theo vai trò (người vai trò cao hơn nhận nhiều hơn 100k), đừng để mọi người cùng một mức lẻ 50k.
- Cộng, đối chiếu bằng `calc`.

### 7. Đổi chỗ, đẩy xuống cuối, xoá một người

- Đổi chỗ hai người ("X lên trước Y"): hoán đổi TOÀN BỘ nội dung hai cột, cả hàng roster lẫn mọi dòng chi tiết (`xlsx_edit` set). Công thức hàng Tổng cộng viết theo tên cột nên vẫn đúng.
- Đẩy một người xuống cuối hoặc xoá hẳn một cột ở giữa: `xlsx_edit` delete_columns viết lại công thức trỏ tới ô bị dồn, nhưng PHẢI kiểm lại ngay: không còn khoảng trống giữa các cột người, công thức hàng Tổng cộng đúng dải cột mới. Chỉ xoá nội dung ô (set null) mà để lại cột trống là sai.
- Sau mọi lần sắp xếp lại: tổng tiền theo từng người phải KHÔNG ĐỔI so với trước (chỉ đổi vị trí).

### 8. Kiểm tra trước khi báo xong

Làm đủ các mục trong `quy-trinh-kiem.md` (đọc lại từng dòng, từng cột bằng `read_document`, đối chiếu bằng `calc`). Chưa đạt thì sửa tiếp bằng `xlsx_edit`, không báo "xong".

### 9. Chứng từ

Handio KHÔNG sinh chứng từ: bước đó do phần mềm Thanh toán riêng của Khoa làm từ tệp Dự toán đã kiểm. Chỉ báo tệp đã sẵn sàng và kết quả kiểm; nhắc người dùng tự soát kỹ lần cuối trước khi sinh chứng từ vì đó là tài liệu thanh toán thật. Đừng tự ý làm gì khác ngoài việc được yêu cầu: "phân bổ tiền" và "sinh chứng từ" là hai việc khác nhau.
