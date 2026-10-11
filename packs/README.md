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
| `thiet-ke-ux` | Design, Work | phê bình thiết kế, kiểm tra tiếp cận WCAG 2.1 AA (tính tương phản từ mã), đặc tả bàn giao, rà soát hệ thống thiết kế, lời giao diện tiếng Việt; subagent soát thiết kế chỉ đọc |
| `nghien-cuu-nguoi-dung` | Work | kế hoạch nghiên cứu người dùng; tổng hợp ghi chú phỏng vấn/khảo sát thành chủ đề, trích dẫn nguyên văn có nguồn, khuyến nghị ưu tiên (Word) |
| `tao-ky-nang` | mọi tab | viết lệnh `/tên` và kỹ năng riêng cho dự án: cấu trúc tệp, checklist chất lượng, chạy thử và cải thiện |
