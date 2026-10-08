# Backlog cải tiến

Cách dùng và chấm điểm: xem [CAI-TIEN.md](CAI-TIEN.md). Cập nhật mỗi tuần; việc xong thì chuyển xuống “Đã làm” kèm kết quả đo được. Số liệu lấy từ trang quản trị (hành vi tổng hợp, không nội dung).

**Trạng thái:** `đề xuất` → `đã chọn` → `đang làm` → `đã phát hành` / `bỏ`. **Tác động** 1–5 · **Công sức** S/M/L.

## Đang mở

| ID | Việc | Bằng chứng (ngày) | Tác động | Công sức | Cách đo thành công | Trạng thái |
|---|---|---|---|---|---|---|
| B-01 | Giảm lỗi công cụ: `run_javascript`, `read_file`, `list_dir`, `edit_file`, `write_file` (hướng dẫn công cụ/đường dẫn/thông báo lỗi cho mô hình, kiểm tra tham số sớm) | 8/10/2026, 25 người, 263 lượt: tỷ lệ lỗi `run_javascript` 49/65 (75%), `read_file` 71/150 (47%), `edit_file` 16/56 (29%), `list_dir` 38/141 (27%), `write_file` 59/322 (18%) | 5 | M | Tỷ lệ lỗi từng công cụ < 15%; tín hiệu `repeat_tool_fail` giảm ≥ 50% | đề xuất |
| B-02 | Giảm lặp và chạm giới hạn bước (phát hiện lặp sớm, gợi ý đổi cách làm, hỏi lại người dùng) | 27 tín hiệu `repeat_tool_fail`, 13 `loop`, 9 `step_limit` trên 263 lượt; 8 lượt kết thúc vì lặp | 5 | M | `loop` + `step_limit` < 3% số lượt (hiện ≈ 6%) | đề xuất |
| B-03 | Giảm token gửi lên mỗi lượt (nén ngữ cảnh sớm hơn, cắt kết quả công cụ dài, bộ nhớ đệm tiền tố nếu máy chủ hỗ trợ) | Trong một ngày: ~14,6 triệu token prompt so với ~0,33 triệu token trả lời (≈ 44:1); p95 thời gian một lượt ~263 giây | 4 | M | Prompt/trả lời < 20:1; p95 một lượt < 120 giây | đề xuất |
| B-04 | Tab **Work** ít được dùng sâu: nhiều người thử nhưng ít lượt | 14 người dùng nhưng chỉ 37 lượt (≈ 2,6 lượt/người) so với tab **Code** 217 lượt/23 người (≈ 9,4) | 4 | M | Lượt/người tab Work ≥ 5 sau 2 tuần; người dùng Work quay lại | đề xuất (cần hỏi vài người dùng Work vì sao) |
| B-05 | Kéo người dùng quay lại: gợi ý bài/mẫu đầu tiên, nhắc lộ trình học | 3/25 người chỉ làm 1 lượt; chưa có ai dùng ≥ 2 ngày (dữ liệu mới có 1 ngày: đo lại sau 2 tuần) | 4 | S | Tỷ lệ “dùng ≥ 2 ngày” và tỷ lệ quay lại tuần tăng | đề xuất (chờ thêm dữ liệu) |
| B-06 | Bản web là kênh chính — kiểm tra trải nghiệm web trước, Desktop sau | 20/25 người dùng qua web, 10 Windows, 3 macOS | 3 | S | Điểm lỗi web ≤ Desktop; theo dõi tỷ lệ cài Desktop | đề xuất |
| B-07 | Phản hồi chậm: token đầu tiên p95 > 5 giây | p95 thời gian tới token đầu ≈ 5,3 giây (p50 ≈ 1,0 giây) | 3 | M | p95 < 3 giây (cần phối hợp phía mô hình/cổng) | đề xuất |

## Theo dõi (chưa có bằng chứng người dùng cần)
- Thêm lựa chọn mô hình/chi phí theo nhiệm vụ (mô hình nhỏ cho việc đơn giản): chờ báo cáo quý về chất lượng mô hình mở.
- Tương thích thêm tiêu chuẩn mở của hệ sinh thái agent (MCP, kỹ năng/skills): theo dõi trong radar hằng tuần.
- Phản hồi trực tiếp trong ứng dụng (👍/👎 sau câu trả lời, khảo sát ngắn) để hiểu *vì sao* — cần quyết định về thông báo và công tắc trước ([CAI-TIEN.md](CAI-TIEN.md), mục Quyền riêng tư).

## Đã làm
- 2026-10-08 — Trang quản trị tổng quan và cơ chế phát hành/cập nhật (thông báo, tải có kiểm mã băm, `minVersion`, CHANGELOG, `version:bump`) — [RELEASE.md](RELEASE.md).
