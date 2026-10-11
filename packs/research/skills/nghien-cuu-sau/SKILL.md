---
name: nghien-cuu-sau
description: Nghiên cứu sâu một câu hỏi rộng: tách thành các khía cạnh độc lập giao cho nhà nghiên cứu phụ, rồi tổng hợp thành báo cáo có luận điểm, nguồn rõ.
---
# Nghiên cứu sâu (điều phối nhiều nhà nghiên cứu phụ)

Dùng khi câu hỏi rộng hoặc cần so nhiều phía (thị trường, quy định theo vùng, nhiều sản phẩm, xu hướng-lịch sử). Câu hỏi hẹp một sự kiện thì dùng `nghien-cuu-co-nguon`. Bạn là người điều phối: giữ ngữ cảnh gọn, giao việc tìm kiếm cho subagent `nha-nghien-cuu` (công cụ `task`), tự mình tổng hợp. Có `todo_write` thì lập danh sách việc cho người dùng theo dõi (đừng nhắc "subagent" trong đó).

## 1. Làm rõ (chỉ khi ảnh hưởng thật đến cách tìm)
Hỏi bằng ask_user một lần nếu: thuật ngữ/viết tắt đa nghĩa; câu trả lời đổi nhiều theo quốc gia/vùng mà chưa nói; tên riêng chỉ nhiều đối tượng. Không hỏi những điều tự chọn hợp lý được (ghi giả định).

## 2. Tách đề tài
Chia thành các khía cạnh độc lập, không chồng nhau, cộng lại phủ hết câu hỏi; mỗi khía cạnh một nhà nghiên cứu (nếu cần, thêm góc nhìn độc lập).
| Số nhà nghiên cứu | Khi nào | Ví dụ |
|---|---|---|
| 1 | một câu hỏi thực tế, không tách được | "Ai thắng giải X năm 2024?" |
| 3 | vài góc nhìn tự nhiên (mặc định) | "tác động của nhiệt độ lên cá hồi": cơ chế, số liệu quan sát, dự báo |
| 4 | nhiều tiêu chí | "so sánh CRM cho doanh nghiệp nhỏ": giá, tính năng, tích hợp, đánh giá người dùng |
| 5 | nhiều đối tượng/khu vực | "bức tranh quy định AI": Mỹ, EU, Trung Quốc, Anh, tự quản ngành |
| 6+ | tập lớn cần phủ có hệ thống | "tỷ lệ xe điện theo bang": gộp thành cụm theo vùng |
Ngữ cảnh của mô hình nhỏ (khoảng 32.000 token): giao tối đa 5 nhà nghiên cứu, mỗi người một khía cạnh; tập lớn hơn thì gộp cụm hoặc làm nhiều lượt và tóm tắt từng lượt trước khi sang lượt sau.

## 3. Giao việc
Mỗi lần gọi `task` với `agent: "nha-nghien-cuu"` và prompt TỰ CHỨA (subagent không thấy cuộc trò chuyện), gồm: chủ đề hẹp; mục tiêu (đầu ra cần có gì); 3–5 câu hỏi chính; loại nguồn nên ưu tiên (tài liệu gốc, báo cáo thường niên, cơ quan quản lý, bài báo gốc); ràng buộc từ câu hỏi gốc (thời gian, địa lý, ngôn ngữ); yêu cầu trả ghi chú theo khuôn bên dưới và dưới ~600 từ.
Khuôn ghi chú (mỗi câu hỏi chính một khối):
- **Kết luận chính**: 1–2 câu.
- **Dữ kiện có nguồn**: gạch đầu dòng "dữ kiện — nguồn (tên, địa chỉ, ngày)"; mâu thuẫn thì ghi cả hai nguồn.
- **Suy luận**: điều rút ra từ các dữ kiện trên (nói là suy luận).
- **Chưa biết**: điều không tìm được và vì sao. Dữ kiện không có nguồn thì chuyển xuống đây.

## 4. Vòng bổ sung (chỉ khi thật cần)
Sau khi nhận ghi chú, nếu còn lỗ hổng làm báo cáo thiếu sót nghiêm trọng thì giao thêm MỘT vòng, rồi tổng hợp ngay bất kể kết quả. Nói với người dùng khi làm vậy.

## 5. Viết báo cáo
- **Tiêu đề** khoảng 6 từ, động từ chủ động, cụ thể.
- **Đoạn mở (kết luận trước)**: một đoạn 5–8 câu nói ngay phát hiện chính, ý nghĩa, tác động, bối cảnh cần biết; người đọc dừng ở đây vẫn nắm được.
- **3–5 mục**, tiêu đề là "biển chỉ đường" nêu ý hoặc con số cụ thể (không "Ảnh hưởng của khí hậu" mà "Ngỗng di cư kiếm ăn thêm 370 giờ mỗi năm"), viết hoa chữ đầu câu.
- Thân bài văn xuôi đặc, mỗi mục tiến lập luận chứ không chỉ liệt kê; **in đậm** dữ kiện và số quan trọng; dùng bảng khi thật sự giúp; nguồn ngay sau dữ kiện (tên nguồn + địa chỉ). Dữ kiện lớn nào chưa có nguồn thì bỏ khỏi báo cáo: năm dữ kiện có nguồn hơn hai mươi dữ kiện nửa có nửa không.
- **Kết luận** 1–2 đoạn, chỉ ý mới (hiểu biết đổi thế nào, hàm ý), không nhắc lại.
- Chính trực về nhận thức: nói rõ cái chưa chắc, xem xét lập luận đối lập ở dạng mạnh nhất, đưa ra lập trường dựa trên bằng chứng thay vì chỉ tổng quan. Giải thích dữ liệu NGHĨA LÀ GÌ, không chỉ nêu.
- Độ dài theo câu hỏi: khoa học chuyên sâu thì dài và chặt; kỹ thuật thì sẵn sàng ra quyết định; ngắn mà rõ hơn dài mà tham.
- Tab Work: lưu thành Word mới bằng `create_docx` (tài liệu dài thì nối thêm bằng append); tab khác: tệp Markdown. Nói tên tệp.
