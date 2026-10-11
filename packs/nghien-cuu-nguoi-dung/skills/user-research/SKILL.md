---
name: user-research
description: Lập kế hoạch nghiên cứu người dùng: câu hỏi nghiên cứu, chọn phương pháp (phỏng vấn, kiểm thử khả dụng, khảo sát, sắp xếp thẻ, nhật ký, A/B), cỡ mẫu, hướng dẫn phỏng vấn, bảng hỏi, đạo đức. Dùng khi người dùng nói "kế hoạch nghiên cứu", "hướng dẫn phỏng vấn", "thiết kế khảo sát", "kiểm thử khả dụng", "câu hỏi nghiên cứu".
---
# Lập kế hoạch nghiên cứu người dùng

## Hỏi trước (một lần, tối đa 3 câu)
Quyết định nào cần đưa ra nhờ nghiên cứu này? Người dùng là ai (nhóm, số lượng, tiếp cận được không)? Thời gian và nguồn lực? Đã biết gì rồi? Đã rõ thì làm luôn.

## Chọn phương pháp
| Phương pháp | Phù hợp để | Cỡ mẫu | Thời gian |
|---|---|---|---|
| Phỏng vấn người dùng | hiểu sâu nhu cầu, động cơ | 5–8 | 2–4 tuần |
| Kiểm thử khả dụng | đánh giá một thiết kế hay luồng cụ thể | 5–8 | 1–2 tuần |
| Khảo sát | định lượng thái độ, ưu tiên | 100+ | 1–2 tuần |
| Sắp xếp thẻ | quyết định cấu trúc thông tin | 15–30 | 1 tuần |
| Nhật ký (diary) | hành vi theo thời gian | 10–15 | 2–8 tuần |
| A/B | so sánh hai lựa chọn thiết kế | đủ ý nghĩa thống kê | 1–4 tuần |

Câu hỏi "vì sao, như thế nào" thì dùng định tính (phỏng vấn, quan sát); "bao nhiêu, bao nhiêu phần trăm" thì định lượng (khảo sát, A/B); thường nên kết hợp: định tính để khám phá, định lượng để đo.

## Nội dung kế hoạch
1. Bối cảnh và quyết định cần hỗ trợ.
2. Mục tiêu và 3–5 câu hỏi nghiên cứu (mở, trả lời được bằng dữ liệu).
3. Phương pháp và lý do chọn.
4. Người tham gia: tiêu chí chọn/loại, cỡ mẫu, cách tuyển, quà cảm ơn.
5. Lịch và vai trò (người hỏi, người ghi chép).
6. Đạo đức: xin đồng ý tham gia, ẩn danh, ghi âm có phép, nơi lưu và thời hạn xoá dữ liệu.
7. Cách phân tích: mã hoá, nhóm chủ đề (xem skill `research-synthesis`).
8. Sản phẩm bàn giao và rủi ro (thiên lệch, mẫu nhỏ).

## Hướng dẫn phỏng vấn (khoảng 50 phút)
1. Khởi động (5'): tạo thiện cảm, giải thích buổi trò chuyện, xin phép ghi âm.
2. Bối cảnh (10'): cách họ đang làm việc này hiện nay.
3. Đào sâu (20'): chủ đề chính.
4. Phản ứng (10'): cho xem ý tưởng hoặc nguyên mẫu.
5. Kết thúc (5'): "Còn điều gì tôi chưa hỏi?", cảm ơn.

Chất lượng câu hỏi: mở; hỏi về hành vi đã xảy ra ("Lần gần nhất bạn… kể cho tôi nghe") thay vì ý định ("Bạn có định…"); không dẫn dắt ("Bạn có thấy… khó không?"); thăm dò bằng "Vì sao?", "Bạn cho ví dụ được không?", "Rồi sao nữa?". Mỗi câu chính kèm 1–2 câu thăm dò.

## Khảo sát
Mỗi câu một ý, không câu hỏi kép, không dẫn dắt; thang đo thống nhất; có lựa chọn "Khác"/"Không áp dụng"; ≤ 10 phút; thử trước với 2–3 người. Dữ liệu thang Likert phân tích bằng skill `khao-sat-likert` nếu có.

## Sản phẩm
Kế hoạch nghiên cứu, hướng dẫn phỏng vấn/bảng hỏi, báo cáo tổng hợp, và "điểm nhấn" (các trích dẫn và quan sát then chốt). Xuất Word bằng create_docx: dài thì thêm phần bằng cùng đường dẫn và append=true. Ngày, người phụ trách, ngân sách chưa có thì ghi "[cần bổ sung]".
