# Gói mở rộng (packs)

Mỗi thư mục con là một **gói mở rộng**: thêm kỹ năng, lệnh `/tên`, subagent, lời dặn và (khi cần) công cụ MCP cho NEU Agent
**mà không sửa mã nguồn lõi**. Định dạng và cách tạo gói: [docs/EXTENSIONS.md](../docs/EXTENSIONS.md).

Thư mục này là **bộ gói của NEU**. Triển khai cho tổ chức khác: giữ nguyên mã lõi, thay nội dung thư mục này
(hoặc đặt `NEU_PACKS_DIR` trỏ tới bộ gói của tổ chức đó khi dựng).

| Gói | Dành cho | Có gì |
|---|---|---|
| `tim-kiem-web` | mọi tab | công cụ `web_search` + `fetch_page` (cần dịch vụ công cụ web, xem docs/DEPLOY.md) |
| `research` | mọi tab | nghiên cứu có nguồn, so sánh, phản biện |
| `giang-vien` | Work | đề cương môn học, đề thi + đáp án, rubric chấm điểm, phản hồi bài làm |
| `phan-tich-du-lieu` | Work, Code | làm sạch và phân tích bảng số liệu, khảo sát Likert, báo cáo có biểu đồ |
| `chat-luong-web` | Code, Design | kiểm tra giao diện (a11y, responsive, hiệu năng), subagent soát giao diện |
| `sinh-vien` | Code, Work | làm đồ án/khoá luận, giải thích lỗi, ôn tập |
| `van-phong-tu-dong` | Work | gộp, đối chiếu, tổng hợp hàng loạt tệp; đọc ảnh/scan thành Word, bảng trong ảnh thành Excel |
| `nang-suat` | Work | việc cần làm trong `VIEC-CAN-LAM.md` (`/viec-can-lam`), bộ nhớ thuật ngữ và người-việc (`/ghi-nho`, `/don-bo-nho`), bản tin đầu ngày từ thư mục dự án (`/ban-tin-ngay`) |
