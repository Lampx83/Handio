---
name: khao-sat-likert
description: Phân tích dữ liệu khảo sát thang Likert: mô tả, độ tin cậy Cronbach's alpha, so sánh nhóm, bảng biểu chuẩn báo cáo.
---
# Phân tích khảo sát Likert

1. **Khám phá**: đọc tệp, liệt kê cột, kiểu dữ liệu, số dòng; xác định cột nhân khẩu học, cột câu hỏi theo từng nhóm (construct), cột mã hoá ngược (thường ghi "R" hoặc do người dùng báo). Hỏi lại duy nhất khi không thể suy ra nhóm câu hỏi.
2. **Làm sạch** (trên bản sao): bỏ dòng trống; kiểm tra giá trị ngoài thang (ví dụ ngoài 1–5); phát hiện trả lời một đáp án cho mọi câu (straight-lining); đảo điểm câu mã hoá ngược (thang − giá trị + 1). Ghi lại mọi thay đổi và số dòng bị ảnh hưởng.
3. **Mô tả**: bảng nhân khẩu học (số lượng, %); với mỗi nhóm câu hỏi: số câu, trung bình, độ lệch chuẩn, min–max. Điểm nhóm = trung bình cộng các câu (nói rõ cách tính).
4. **Độ tin cậy**: Cronbach's alpha cho từng nhóm = k/(k−1) × (1 − Σ phương sai từng câu / phương sai tổng). Ngưỡng tham khảo ≥ 0,7 chấp nhận được. Alpha thấp: chỉ ra câu nào kéo xuống (alpha nếu bỏ câu), đề xuất — không tự ý loại.
5. **So sánh nhóm** khi được yêu cầu: hai nhóm → so sánh trung bình (nêu rõ phép thử và điều kiện áp dụng); từ ba nhóm trở lên → ANOVA hoặc kiểm định phi tham số; luôn nêu cỡ mẫu từng nhóm. Nếu công cụ không tính được kiểm định, nói rõ và chỉ báo mô tả, đừng bịa giá trị p.
6. **Đầu ra**: Excel mới với công thức sống (create_xlsx) cho các bảng, biểu đồ cột/đường phù hợp, và một trang tóm tắt bằng lời (3–5 phát hiện, hạn chế của dữ liệu). Đọc lại tệp để đối chiếu vài con số với dữ liệu gốc.
