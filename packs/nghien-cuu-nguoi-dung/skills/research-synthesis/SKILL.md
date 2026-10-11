---
name: research-synthesis
description: Tổng hợp dữ liệu nghiên cứu người dùng (ghi chú phỏng vấn, kết quả khảo sát, ghi chú kiểm thử, phản hồi) thành chủ đề, thấu hiểu, nhóm người dùng và khuyến nghị xếp ưu tiên, kèm trích dẫn nguyên văn có nguồn. Dùng khi người dùng đưa ghi chú .docx/.xlsx/.txt và muốn "tổng hợp", "tìm chủ đề", "rút ra thấu hiểu".
---
# Tổng hợp nghiên cứu người dùng

Kế hoạch và phương pháp: xem skill `user-research`.

## Đầu vào chấp nhận
Ghi chú hoặc phiên âm phỏng vấn, kết quả khảo sát (.xlsx/.csv), ghi chú kiểm thử khả dụng, phiếu hỗ trợ, phản hồi, đánh giá NPS/CSAT dán vào tệp. Mỗi tệp thường là một người tham gia; gán mã ẩn danh P1, P2… theo thứ tự tệp và lập bảng đối chiếu tệp → mã (không ghi họ tên vào báo cáo).

## Quy trình
1. **Đọc từng tệp** (read_document; dài thì đọc theo khối). Với mỗi tệp ghi vào BẢNG MÃ HOÁ làm việc (tệp Markdown hoặc Excel mới trong thư mục làm việc, để không giữ tất cả trong đầu): mã người | vị trí (đoạn/dòng/ô) | trích dẫn nguyên văn | mã (nhãn ngắn) | quan sát hay diễn giải.
2. **Nhóm thành chủ đề**: gom các mã cùng ý (affinity). Mỗi chủ đề phải có bằng chứng từ ≥ 2 người; chủ đề chỉ một người ghi riêng là "ý kiến đơn lẻ".
3. **Đếm mức phổ biến**: mỗi người chỉ tính một lần cho mỗi chủ đề; ghi "x/y người". Tính phần trăm bằng calc và chỉ khi có ≥ 10 người; khảo sát dạng thang đo thì dùng skill `khao-sat-likert` (nếu có) hoặc xlsx_pivot.
4. **Tách quan sát khỏi diễn giải**: "5/8 người bấm nhầm nút" là quan sát; "vị trí nút gây nhầm" là diễn giải, ghi riêng.
5. **Thấu hiểu → cơ hội → xếp ưu tiên**: mỗi thấu hiểu kèm cơ hội cụ thể, tác động (Cao/Vừa/Thấp) và công sức (Cao/Vừa/Thấp). Ưu tiên cao = tác động cao, công sức thấp, nhiều người gặp.
6. **Nhóm người dùng**: chỉ lập khi dữ liệu cho thấy khác biệt thật về nhu cầu hay hành vi; ghi đặc điểm, nhu cầu, quy mô theo "x/y".
7. **Kiểm tra trước khi viết**: tìm lại từng trích dẫn trong tệp nguồn bằng find_in_documents (lấy một cụm 4–6 từ); không khớp thì sửa theo nguyên văn hoặc bỏ. Số liệu "x/y" phải khớp bảng mã hoá. Có thông tin định danh trong ghi chú thì chạy scan_pii và không đưa vào báo cáo.

## Mẫu báo cáo (Word, create_docx style modern; dài thì thêm phần bằng append=true)
```
# Tổng hợp nghiên cứu: [tên nghiên cứu]
Phương pháp: [phỏng vấn / khảo sát / kiểm thử] | Số người: [y] | Thời gian: [khoảng ngày] | Người thực hiện: [cần bổ sung]
## Tóm tắt điều hành
[3–4 câu: phát hiện chính]
## Các chủ đề chính
### Chủ đề 1: [tên]
Mức phổ biến: x/y người
Tóm tắt: ...
Bằng chứng:
> "[trích dẫn nguyên văn]" — P3, [tệp], [vị trí]
> "[...]" — P5, [tệp], [vị trí]
Hàm ý cho sản phẩm: ...
## Từ thấu hiểu đến cơ hội
| Thấu hiểu | Cơ hội | Tác động | Công sức |
## Nhóm người dùng
| Nhóm | Đặc điểm | Nhu cầu chính | Quy mô (x/y) |
## Khuyến nghị (xếp ưu tiên)
1. [Cao] ... — dựa trên chủ đề nào
2. [Vừa] ...
3. [Thấp] ...
## Câu hỏi cần nghiên cứu thêm
## Ghi chú phương pháp
[cách làm, cỡ mẫu, thiên lệch và giới hạn]
```
Gợi ý: dùng trích dẫn nguyên văn vì chúng làm thấu hiểu đáng tin; định lượng bằng "7/10 người" thay vì "đa số". Điều không có trong dữ liệu thì ghi "[cần bổ sung]", không suy đoán thành kết luận.
