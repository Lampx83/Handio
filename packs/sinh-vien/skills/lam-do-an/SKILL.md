---
name: lam-do-an
description: Quy trình làm đồ án/khoá luận phần mềm từ ý tưởng đến báo cáo: phạm vi, yêu cầu, thiết kế, hiện thực, kiểm thử, viết báo cáo.
---
# Làm đồ án

1. **Chốt phạm vi** (1 trang): bài toán, người dùng, 5–8 chức năng chính xếp ưu tiên (phải có / nên có / để sau), cái gì KHÔNG làm. Đồ án nhỏ mà hoàn chỉnh tốt hơn đồ án lớn dang dở.
2. **Yêu cầu và thiết kế**: danh sách yêu cầu chức năng và phi chức năng; sơ đồ use case; mô hình dữ liệu (bảng, khoá, quan hệ); sơ đồ kiến trúc một hình; phác giao diện từng màn hình chính. Viết dạng Mermaid hoặc bảng trong tệp `docs/` để báo cáo dùng lại.
3. **Hiện thực theo lát dọc**: làm xong từng chức năng từ giao diện đến dữ liệu rồi mới sang chức năng kế, giữ chương trình luôn chạy được. Commit thường xuyên với thông điệp rõ.
4. **Kiểm thử**: lập bảng ca kiểm thử cho từng chức năng (dữ liệu vào, kết quả mong đợi, kết quả thực); có ít nhất một bộ kiểm thử tự động cho phần logic cốt lõi. Ghi lỗi tìm thấy và cách sửa — rất có giá trị cho báo cáo.
5. **Báo cáo**: giới thiệu bài toán → khảo sát/cơ sở lý thuyết → phân tích thiết kế → cài đặt (chụp màn hình, đoạn mã then chốt) → kiểm thử → kết luận, hạn chế, hướng phát triển → tài liệu tham khảo. Mọi số liệu, hình, trích dẫn phải có thật; không bịa tài liệu tham khảo.
6. **Chuẩn bị bảo vệ**: slide 10–12 trang, kịch bản demo 3 phút có kế hoạch dự phòng, 10 câu hỏi hội đồng có thể hỏi và câu trả lời của chính bạn.
