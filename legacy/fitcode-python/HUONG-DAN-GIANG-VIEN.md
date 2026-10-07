# Hướng dẫn giảng viên triển khai FIT Code

## 1. Chuẩn bị máy chủ
- Máy chủ mô hình: `http://192.0.2.11:8037/vllm/v1` (vLLM sau Kong, Qwen3.5-35B-A3B-GPTQ-Int4, tool calling bật sẵn).
- Mỗi sinh viên **một key riêng** (consumer riêng trong Kong, nhóm quyền chat, giới hạn lệnh/phút). Quản lý và theo dõi tại SIM → server 232 → tab **API Gateway → Quản lý key** (số lệnh, lỗi, token theo từng key).
- Gợi ý giới hạn: 30–60 lệnh/phút mỗi key. Một lượt agent thường gọi mô hình 5–15 lần.

## 2. Phát hành công cụ
- Chạy `./build.sh` để tạo `dist/fitcode.pyz` (khoảng 40 KB), đặt lên chỗ sinh viên tải được (LMS, Google Drive, hoặc trang `/docs/` của máy chủ).
- Sinh viên chạy `python3 fitcode.pyz login` rồi `doctor`. Nếu `doctor` báo đủ 3 dấu ✓ là dùng được.

## 3. Thử tải (đã đo)
- 1 agent sửa lỗi 2 hàm Python: ~4 giây.
- 6 agent chạy đồng thời cùng việc đó: mỗi agent ~9–10 giây, đều đạt, không lỗi.
- **Chưa đo** với 30–60 sinh viên cùng lúc. Nên thử trước buổi học (ví dụ 20 tài khoản chạy cùng một bài), và theo dõi tab **Sức khoẻ LLM** trong SIM (hàng đợi, KV cache). Nếu hàng đợi dài: chia ca, hoặc giảm số lệnh/phút mỗi key.
- Máy chủ này còn phục vụ NEUAI; giờ cao điểm của NEUAI có thể làm chậm lớp học và ngược lại.

## 4. Gợi ý tổ chức buổi học
1. Bài mở đầu: `fitcode example`, cho sinh viên đọc từng file ví dụ (lệnh, subagent, skill, hook, MCP) rồi thử sửa.
2. Giao bài thực hành trong repo mẫu có test hỏng; yêu cầu sinh viên nộp: `FITCODE.md` họ tạo bằng `/init`, file `.fitcode/` của họ, và bản `/export` hội thoại.
3. Chấm theo quy trình: có lập kế hoạch (`/plan`)? có chạy test? có kiểm chứng kết quả agent? Bản ghi đầy đủ nằm trong `.fitcode/sessions/*.jsonl` của dự án sinh viên.

## 5. Rủi ro cần lưu ý
- `bash` chạy với quyền người dùng trên máy sinh viên (có hỏi trước, có chặn lệnh nguy hiểm, nhưng không phải sandbox). Phòng máy: dùng tài khoản riêng hoặc container.
- Mô hình có thể sai; coi đó là một phần của bài học về verification.
- Dữ liệu dự án của sinh viên đi qua máy chủ của Khoa; nhắc không để mật khẩu/khóa trong mã.
