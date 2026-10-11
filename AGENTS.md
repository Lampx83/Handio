# AGENTS.md — hướng dẫn cho AI viết mã trong kho Handio

Tệp này dành cho Claude Code, Codex, Cursor, Copilot, Gemini… và người mới. Các thư mục con có `AGENTS.md` riêng (quy tắc hẹp, ưu tiên hơn tệp này): `apps/desktop/`, `apps/web/`, `packages/core/`, `packages/ui/`, `deploy/`, `docs/`.

## Dự án là gì

Handio: trợ lý AI dạng *agent* của Trường ĐH Kinh tế Quốc dân (web + Desktop Electron), mô hình Qwen3.5 do Khoa CNTT vận hành (qua gateway Kong ở máy 232). Ba tab: **Work** (Word/Excel/PowerPoint/PDF cho khối văn phòng), **Code** (vibe coding cho sinh viên FIT-VIBE), **Design** (HTML/SVG, xem trước, xuất PDF/PNG). Mỗi tab có nhiều *dự án* (thư mục) và lịch sử trò chuyện. **Mọi người dùng bắt buộc đăng nhập** (Microsoft Entra @neu.edu.vn / @st.neu.edu.vn, hoặc tài khoản tên + mật khẩu do quản trị tạo).

## Bản đồ kho (npm workspaces, TypeScript strict)

| Đường dẫn | Là gì |
|---|---|
| `packages/core` | Lõi không phụ thuộc môi trường: vòng lặp agent (`session.ts`), công cụ (`tools.ts`, `office/`), quyền (`permissions.ts`), hồ sơ tab (`profiles.ts`), dự án/lịch sử, `LocalController` |
| `packages/env-node` | Cài đặt cho Node: hệ thống tệp thật, lưu cài đặt/lịch sử bằng JSON |
| `packages/ui` | Giao diện dùng chung cho web và Desktop (DOM thuần, không framework) |
| `apps/web` | Bản web (trình duyệt, thư mục ảo trong IndexedDB) + máy chủ dev có mô hình giả |
| `apps/desktop` | Electron: tiến trình chính, preload, renderer, đăng nhập OIDC, cập nhật, đóng gói |
| `deploy/` | Triển khai máy 220 (nginx, SSO oauth2-proxy, chẩn đoán, tài khoản) + 222 (tên miền/HTTPS) + bài thử Docker |
| `server/gateway-232` | Ghi chú vận hành gateway mô hình |
| `docs/` | Tài liệu (DEPLOY, SECURITY, RELEASE, CICD, DIAGNOSTICS…) |
| `packs/`, `labs/`, `legacy/`, `apps/playground` | Gói mẫu, thử nghiệm, mã cũ: không phải đường chính |

Nền tảng chung: `Env` (MemoryEnv trên web / NodeEnv trên Desktop) cho mọi thao tác tệp-lệnh; `AgentController` (cục bộ trên web, qua IPC trên Desktop); `AGENTS.md` **trong dự án của người dùng** là hướng dẫn riêng cho agent của họ (khác tệp này).

## Lệnh (chạy ở gốc kho; Node 22)

```bash
npm ci                         # cài từ package-lock (KHÔNG npm install bừa: làm trôi phiên bản)
npm run typecheck              # tsc --noEmit toàn kho
npx vitest run                 # kiểm thử TypeScript (~420 bài)
npm run dev:web                # web ở localhost, có "Demo giả lập" không cần key
npm run desktop                # chạy Electron từ mã nguồn
npm run smoke                  # kiểm thử đầu-cuối bản Desktop (58 kiểm tra, mở cửa sổ Electron)
npm run version:check          # mọi gói cùng phiên bản + CHANGELOG có mục đó
cd deploy/220/diag && python3 -m unittest discover -s . -p 'test_*.py'     # máy chủ (Python)
node deploy/test/e2e-sso.mjs && node deploy/test/e2e-install.mjs && node deploy/test/e2e-deploy.mjs   # cần Docker
```

**Trước khi báo "xong" hoặc commit: `npm run typecheck && npx vitest run` phải xanh** (và bộ liên quan nếu đụng `deploy/`/Desktop). CI chạy đúng những lệnh này; main đỏ thì **không được triển khai**.

## Quy tắc làm việc (rất quan trọng)

1. **Mỗi thay đổi người dùng thấy phải ghi vào `CHANGELOG.md`** (mục "Chưa phát hành": Thêm / Thay đổi / Sửa), viết cho người dùng, tiếng Việt. Người dùng đọc nó ngay trong ứng dụng và trên trang công khai. Đổi phiên bản **chỉ** bằng `npm run version:bump -- <patch|minor|major>`, không sửa tay `package.json`.
2. **Kho có thể bị nhiều phiên AI/người sửa cùng lúc trong một thư mục.** Vì vậy: chỉ `git add <đường dẫn cụ thể>` của việc bạn làm (không `git add -A`/`git commit -a`); xem `git status` và `git log origin/main..HEAD` trước khi đẩy; **không đẩy commit của người khác** khi chưa được yêu cầu (dùng `git worktree` trên `origin/main` nếu chỉ muốn đẩy phần của mình); đừng "dọn" hay hoàn tác thay đổi lạ trong thư mục làm việc.
3. **Gộp vào `main` = tự triển khai lên máy chủ thật** (`.github/workflows/deploy.yml`, xem `docs/CICD.md`). Chưa chắc thì làm trên nhánh + pull request. Không tự `ssh`/`sudo` lên máy 220/222 để sửa tay ngoài quy trình khi chưa được người dùng cho phép; không `git push --force`, không xoá nhánh/tag của người khác.
4. **Bí mật không bao giờ vào kho, nhật ký, câu trả lời hay kiểm thử:** secret Entra, key mô hình, mật khẩu (kể cả mật khẩu thử), khoá riêng, token, `.env`, `.p12`, email/dữ liệu thật của người dùng. Dùng dữ liệu giả rõ ràng (`khach01`, `a@neu.edu.vn`). Nếu thấy bí mật bị lộ: dừng, nói với người dùng, không tự xử lý lặng lẽ.
5. **Không làm lỏng bảo mật** để "cho chạy được": kiểm tra quyền, CSP, danh sách IPC cho phép, sandbox, giới hạn tốc độ, chống CSRF, chống `..`. Đổi bảo mật thì cập nhật `docs/SECURITY.md` và có kiểm thử chứng minh.
6. **Riêng tư:** số liệu chẩn đoán chỉ chứa mã/số, **không nội dung** hội thoại, tên tệp, đường dẫn, lệnh, URL, IP. Ngoại lệ có chủ đích duy nhất là sổ "ai đã dùng" cho quản trị viên (`docs/DIAGNOSTICS.md`).
7. **Ngôn ngữ:** giao diện, thông báo lỗi, nhật ký thay đổi, tài liệu và thông điệp commit bằng **tiếng Việt có dấu**, ngắn, ít chữ thừa (người dùng đã nhiều lần yêu cầu bớt chữ). Tên biến/hàm bằng tiếng Anh.
8. **Kiểm thử đi kèm mã.** Sửa lỗi thì thêm bài tái hiện lỗi trước (phải đỏ khi chưa sửa). Dùng `FakeLlm` + `makeController` (`packages/core/test/helpers.ts`), không gọi mô hình thật.
9. Giữ phong cách mã xung quanh (mật độ chú thích, đặt tên); không thêm phụ thuộc mới nếu không cần (mỗi phụ thuộc phải có lý do và phải khớp `package-lock.json`).
10. Trung thực khi báo cáo: nói rõ cái gì đã thử, cái gì chưa; bài kiểm thử đỏ thì nói đỏ.

## Nơi tìm hiểu thêm

`README.md` (tính năng), `docs/DEPLOY.md` (triển khai), `docs/SECURITY.md` (mô hình bảo mật), `docs/RELEASE.md` (phiên bản, phát hành, cập nhật Desktop), `docs/CICD.md` (CI/CD), `docs/DIAGNOSTICS.md` (số liệu), `docs/QUOTA.md` (hạn mức token), `CONTRIBUTING.md` (quy trình PR).
