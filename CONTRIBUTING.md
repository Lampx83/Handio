# Cùng phát triển NEU Agent

Cảm ơn bạn đã tham gia. Quy trình ngắn gọn: **nhánh riêng → pull request → CI xanh → có người duyệt → gộp vào `main` → tự triển khai**.

## Chuẩn bị

```bash
git clone https://github.com/Lampx83/NEUAGENT.git && cd NEUAGENT
npm ci                 # Node 22
npm run dev:web        # bản web ở localhost, có mô hình giả để thử không cần key
npm run desktop        # bản Desktop (Electron)
```

## Làm một thay đổi

1. Tạo nhánh từ `main`: `git switch -c ten-viec-ban-lam`.
2. Sửa mã **kèm kiểm thử** cho phần bạn đổi (xem thư mục `test/` của từng gói).
3. Chạy trước khi đẩy lên (CI chạy đúng những lệnh này):

   | Việc kiểm tra | Lệnh |
   |---|---|
   | Kiểu + kiểm thử TypeScript | `npm run typecheck && npx vitest run` |
   | Máy chủ (Python) | `cd deploy/220/diag && python3 -m unittest discover -s . -p 'test_*.py'` |
   | nginx, SSO, cài đặt, triển khai (cần Docker) | `node deploy/test/e2e-sso.mjs`, `node deploy/test/e2e-install.mjs`, `node deploy/test/e2e-deploy.mjs` |
   | Phiên bản khớp CHANGELOG | `npm run version:check` |

4. Mở pull request vào `main`, điền mẫu PR. **CI phải xanh** và cần ít nhất một người duyệt.

## Khi PR được gộp vào `main`

GitHub Actions (`deploy.yml`) tự chạy lại CI, dựng web, rồi triển khai lên máy chủ 220 và kiểm tra site thật (xem `docs/CICD.md`). Thay đổi chạm vào `deploy/` hoặc `.github/` cần chủ dự án duyệt (CODEOWNERS) vì chúng chạy với quyền cao trên máy chủ.

Không tự triển khai: dịch vụ đăng nhập (`deploy/220/auth/`), máy 222, bản Desktop (đóng gói khi gắn tag `v*`, xem `docs/RELEASE-SIGNING.md`).

## Quy tắc quan trọng

- **Không bao giờ commit** mật khẩu, khoá, secret Entra, token, tệp `.env`, chứng chỉ, tệp `.p12`/`.pem`. CI không dùng secret nên PR từ nhánh/fork vẫn chạy được mà không lộ gì.
- Không dán email, mật khẩu hay dữ liệu thật của người dùng vào mã, kiểm thử, issue hay PR.
- Thay đổi về bảo mật (đăng nhập, quyền, nginx, dịch vụ chạy bằng root): mô tả rõ rủi ro trong PR và cập nhật `docs/SECURITY.md`.
- Đổi phiên bản bằng `npm run version:bump` (cập nhật mọi gói + CHANGELOG), không sửa tay `package.json`.
- Commit nhỏ, thông điệp tiếng Việt nêu **vì sao** đổi.
