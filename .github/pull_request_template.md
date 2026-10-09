## Thay đổi này làm gì, và vì sao?

<!-- 1–3 câu. Nếu sửa lỗi: lỗi gì, người dùng thấy gì. -->

## Đã kiểm tra thế nào?

- [ ] `npm run typecheck && npx vitest run` đạt
- [ ] Đã thêm/cập nhật kiểm thử cho phần đổi
- [ ] (nếu đụng `deploy/`) Python / e2e Docker đạt (xem CONTRIBUTING.md)
- [ ] (nếu đổi giao diện) đã xem thử trên trình duyệt hoặc Desktop

## An toàn

- [ ] Không có mật khẩu, khoá, secret, token, email thật trong mã hay kiểm thử
- [ ] Không làm lỏng kiểm soát truy cập, kiểm tra đầu vào hay sandbox (nếu có, nói rõ ở đây)
- [ ] (nếu đụng `deploy/` hoặc `.github/`) đã nêu ảnh hưởng tới máy chủ và cách quay lại

## Sau khi gộp

Gộp vào `main` sẽ **tự triển khai** lên máy chủ. Nếu thay đổi cần làm tay thêm (dịch vụ đăng nhập, máy 222, bản Desktop), ghi ở đây:
