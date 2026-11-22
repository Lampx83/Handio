# Góp ý qua Feedback Hub (bản web)

Bản web có thể dùng **Feedback Hub** (https://github.com/Lampx83/FeedbackHub) làm hộp góp ý: nút **Góp ý** trên thanh trên mở widget của hub thay cho hộp góp ý riêng. Mặc định **TẮT**: chưa đặt biến môi trường thì mọi thứ chạy y như trước (hộp góp ý cũ → `/agent/admin/feedback`).

Bản **Desktop** chưa dùng hub: CSP của Desktop cấm gọi mạng từ giao diện (`connect-src 'none'`), nên Desktop vẫn dùng hộp góp ý cũ.

## Bật (máy 220)

1. **Dựng hub** (Docker Compose, xem README của Feedback Hub) **cùng tên miền với ứng dụng**, ví dụ `https://ai.neu.edu.vn/agent/feedbackhub` (đặt `HUB_BASE_PATH=/agent/feedbackhub` và `HUB_PUBLIC_URL` khi dựng; nginx chuyển tiếp `/agent/feedbackhub/` về hub, GIỮ tiền tố). Phải cùng nguồn vì CSP của trang chỉ cho `script-src 'self'; connect-src 'self'` — không nới CSP, và giao diện từ chối hub khác nguồn.
2. **Tạo dự án** từ [`feedbackhub.project.json`](feedbackhub.project.json) (chế độ `collect`: chỉ thu nhận, AI không tự sửa mã):
   ```bash
   HUB_URL=https://ai.neu.edu.vn/agent/feedbackhub HUB_ADMIN_EMAIL=… HUB_ADMIN_PASSWORD=… \
     node scripts/setup-project.mjs docs/feedbackhub.project.json --print-secret
   ```
   (script nằm trong repo Feedback Hub). Lệnh in **khoá ký token**: lưu vào kho bí mật, không dán vào chat hay commit.
3. **Đặt khoá ở máy 220** (chỉ root đọc), rồi khởi động lại bộ thu:
   ```bash
   sudo install -m 0600 -o root -g root /dev/null /etc/neu-agent/feedbackhub.env
   sudo nano /etc/neu-agent/feedbackhub.env      # 3 dòng bên dưới
   sudo systemctl restart neu-agent-diag
   ```
   ```
   NEU_FEEDBACK_HUB_URL=https://ai.neu.edu.vn/agent/feedbackhub
   NEU_FEEDBACK_HUB_PROJECT=handio
   NEU_FEEDBACK_HUB_SECRET=<khoá ký token>
   ```
   Cần cập nhật unit và nginx trước (`install-diag.sh`, cài lại `neu-agent-locations.conf`): bản mới có `EnvironmentFile=-/etc/neu-agent/feedbackhub.env` và route `/agent/feedback-token`.
4. Kiểm tra: đăng nhập web → bấm **Góp ý** thấy ngăn kéo của hub. `GET /agent/feedback-token` khi chưa đăng nhập phải ra 401; chưa cấu hình hub thì 404.

## Hành vi

- Máy chủ (bộ thu `collector.py`) ký token **HS256 sống 10 phút** cho người đã đăng nhập: `uid`/`name` là email hoặc tên đăng nhập do nginx xác thực, `role` là `ADMIN` nếu có trong `admins.txt`, còn lại `USER`. Khoá ký **không bao giờ** xuống trình duyệt hay vào kho/nhật ký.
- Giao diện chỉ nạp `widget.js` khi máy chủ trả hub **cùng nguồn**; hub lỗi, 404 hay khác nguồn thì lặng lẽ dùng hộp góp ý cũ.
- Mỗi góp ý kèm `extra`: nền tảng (`web`) và phiên bản ứng dụng. Không kèm nội dung hội thoại, tên tệp hay đường dẫn.
- Quyền quản trị trên hub lấy từ `admins.txt` lúc cấp token, không từ trình duyệt.

## Tắt / quay lại

Xoá (hoặc đổi tên) `/etc/neu-agent/feedbackhub.env` rồi `sudo systemctl restart neu-agent-diag`: `/agent/feedback-token` trả 404, nút Góp ý mở lại hộp góp ý cũ. Góp ý đã gửi lên hub vẫn nằm ở hub.

## Mã liên quan

`deploy/220/diag/feedback.py` (`hub_config`, `sign_hub_token`), route `GET /feedback-token` trong `collector.py`, location trong `neu-agent.locations.conf`, `packages/ui/src/feedback-hub.ts` (nạp widget), `feedback-ui.ts` (chọn hub hay hộp cũ), `apps/web/src/main.ts`; kiểm thử `test_feedback.py` (`HubToken`), `packages/ui/test/feedback-hub.test.ts`.
