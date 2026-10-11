---
name: design-critique
description: Phê bình thiết kế (tệp HTML/SVG, ảnh chụp hoặc mô tả) theo năm chiều: ấn tượng đầu, khả năng dùng, thứ bậc thị giác, nhất quán, tiếp cận. Dùng khi người dùng nhờ xem, nhận xét, góp ý hay đánh giá một bản thiết kế, màn hình hoặc trang web, ở bất kỳ giai đoạn nào.
---
# Phê bình thiết kế

## Cần có
- **Bản thiết kế**: tệp .html/.svg (read_file), ảnh chụp (read_image) hoặc mô tả. Ảnh chụp chỉ cho cái nhìn tổng thể, không đo được pixel.
- **Bối cảnh**: đây là gì, cho ai, giai đoạn (khám phá / chỉnh sửa / hoàn thiện), có cần soi riêng một phần (ví dụ "chỉ màn hình điện thoại"). Thiếu thì hỏi một lần. Giai đoạn quyết định giọng điệu: khám phá thì bàn hướng đi, hoàn thiện mới soi chi tiết.

## Cách làm
1. Đọc cả tệp (tệp dài thì read_file theo khối offset/limit). Ghi lại: bố cục chính, các cỡ chữ, bảng màu, nút và liên kết, ảnh.
2. Đi qua năm chiều dưới đây. Mỗi chiều tách "kiểm bằng mã" (có số liệu, số dòng) khỏi "cần mắt người".
3. Viết báo cáo theo mẫu. Nhận xét phải cụ thể ("nút chính cạnh tranh với thanh điều hướng", không phải "bố cục rối"), nói vì sao, đề xuất cách sửa, khen điều đang tốt, và hợp giai đoạn.

## Năm chiều
1. **Ấn tượng đầu (2 giây)**: mắt dừng ở đâu trước, mục đích có rõ ngay không, cảm xúc gì. Từ mã chỉ suy được qua cỡ, độ đậm, độ tương phản của phần tử nổi nhất; ghi mức chắc chắn và đề nghị xem ảnh chụp hoặc mắt người xác nhận.
2. **Khả năng dùng**: làm được việc chính không; phần tử bấm được có nhìn ra là bấm được (nút có nền/viền, liên kết có gạch chân); bước thừa; mỗi vùng chỉ một nút chính (đếm các nút "chính" cùng cấp bằng grep); có trạng thái rỗng, lỗi.
3. **Thứ bậc thị giác**: thứ tự đọc, nhấn đúng chỗ, khoảng trắng. Kiểm bằng mã: một h1; số cấp cỡ chữ (3–5 là hợp lý, mỗi cấp hơn cấp dưới ≥ 1,2 lần); độ rộng dòng ≤ ~75 ký tự (max-width theo ch hoặc px); khoảng cách giữa nhóm lớn hơn trong nhóm.
4. **Nhất quán**: cùng loại phần tử cùng kiểu. Kiểm bằng mã: đếm giá trị khác nhau của màu (hex), cỡ chữ, bo góc, đổ bóng, khoảng cách; nhiều bất thường (gợi ý: > 8 màu, > 6 cỡ chữ, > 3 mức bo góc) thì liệt kê giá trị lệch kèm dòng; khoảng cách có theo thang (4/8/16/24…) hay lẻ (13px, 22px); biến CSS có được dùng hay gõ cứng. Dự án có hệ thống thiết kế riêng thì đối chiếu với nó.
5. **Tiếp cận (soi nhanh)**: tương phản chữ/nền, cỡ chữ thân ≥ 16px, alt, vùng chạm ≥ 44px, lang="vi". Cách tính tương phản và kiểm đầy đủ: nạp skill `accessibility-review`.

## Mẫu báo cáo
```
## Phê bình thiết kế: [tên tệp] · giai đoạn [...]
### Ấn tượng chung
[1–2 câu: điều đang tốt và cơ hội lớn nhất]
### Khả năng dùng
| Phát hiện | Dòng | Mức | Đề xuất |
### Thứ bậc thị giác
- Mắt dừng đầu tiên: [phần tử], có đúng không? (mức chắc chắn)
- Luồng đọc: ...
- Nhấn mạnh: đúng thứ cần nhấn chưa
### Nhất quán
| Yếu tố | Vấn đề (giá trị, dòng) | Đề xuất |
### Tiếp cận
- Tương phản: các cặp chính, tỉ lệ, đạt/không đạt
- Vùng chạm, cỡ chữ, dòng cách
### Điều đang tốt
### Ưu tiên sửa
1. [Thay đổi hiệu quả nhất] — vì sao, sửa thế nào
2. ... 3. ...
### Cần kiểm tay
- [những điều mã không cho biết]
```
Mức: Nghiêm trọng / Vừa / Nhẹ. Kết thúc bằng việc hỏi người dùng có muốn sửa các mục ưu tiên (bản mới -v2) hoặc xuất báo cáo Word không.
