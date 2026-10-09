# apps/desktop — Electron (an ninh là ưu tiên số một)

- **Ba lớp:** `src/main.ts` (tiến trình chính, có quyền), `src/preload.ts` (cầu hẹp), `renderer/` (giao diện, KHÔNG có quyền Node). Mọi thứ renderer gọi đi qua IPC; **mọi kênh IPC phải có bộ kiểm tra tham số trong `src/security.ts`** (`IPC_VALIDATORS`, `AUTH_METHODS`) và kiểm thử ở `test/security.test.ts`. Thêm kênh mới = thêm validator + bài thử chặn dữ liệu xấu.
- CSP chặt, giao thức `app://`, mọi điều hướng bị chặn (`will-navigate`). **Renderer không được `location.reload()`**: muốn tải lại cửa sổ thì tiến trình chính gọi `webContents.reload()`.
- **Đăng nhập (`src/auth.ts`):** OIDC Authorization Code + PKCE qua trình duyệt hệ thống, cổng loopback. Kiểm chữ ký id_token bằng `jose`, **đối chiếu giờ theo máy chủ** (đồng hồ máy người dùng có thể sai). Đăng nhập tên + mật khẩu chỉ giữ cookie phiên, không giữ mật khẩu.
- **Keychain/`safeStorage`:** chỉ chạm khi thật sự cần (`codec()` lười). Mặc định KHÔNG lưu phiên đăng nhập (tránh hộp thoại Keychain lặp lại ở bản chưa ký); chỉ lưu khi người dùng tích "Ghi nhớ". Đừng gọi `safeStorage` lúc khởi động.
- Không bao giờ nhúng key mô hình vào bản phát hành (`NEU_BUILTIN_KEY` mặc định rỗng); máy chủ tự gắn key sau khi đăng nhập.
- Kiểm tra: `npm run smoke` (58 kiểm tra thật trên Electron) + `npx vitest run apps/desktop`. Đóng gói: `npm run dist -w @neu/agent-desktop` (~10 phút; mac arm64/x64 + Windows). Bản chưa ký sẽ bị macOS/Windows cảnh báo lần đầu; **không** hứa với người dùng là "không cảnh báo" khi chưa có Developer ID/chứng chỉ ký.
- Cập nhật: ứng dụng chỉ **báo** bản mới (`src/updater.ts`), tải khi người dùng bấm và kiểm SHA-256; không tự cài. Xem `docs/RELEASE.md`.
- Số phiên bản/ghi chú phát hành: `docs/RELEASE.md`; đừng sửa tay `latest.json`.
