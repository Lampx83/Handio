# apps/web — bản web

- Dữ liệu người dùng (dự án, tệp, lịch sử) nằm **trong trình duyệt** (IndexedDB/localStorage); máy chủ không giữ tệp của họ. Đừng thêm lưu trữ phía máy chủ nếu chưa có quyết định riêng về riêng tư.
- **Không có key mô hình trong JS.** nginx ở máy 220 gắn key sau khi đăng nhập (`/agent/vllm/`). Mã web gọi đường dẫn tương đối (`vllm/v1`), không địa chỉ gateway.
- Đường dẫn gốc là `/agent/` (nhiều đường dẫn tương đối: đừng dùng URL tuyệt đối bắt đầu bằng `/`).
- Hết phiên (401) → `authFetch` đưa về trang đăng nhập; đừng tự xử lý lại 401 ở chỗ khác.
- `dev/server.mjs`: máy chủ dev có mô hình giả (`/mock/v1`); `NEU_DEV_USER=ten@neu.edu.vn` giả lập người đã đăng nhập để xem thử giao diện tài khoản.
- Dựng: `NODE_ENV=production npm run build -w @neu/agent-web`. Bản web **luôn là bản mới nhất** (không cần người dùng cập nhật); gộp vào main là lên máy chủ.
