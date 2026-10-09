# CI/CD: mọi người cùng viết mã, hệ thống tự kiểm tra và tự triển khai

```
 nhánh riêng ──► pull request ──► CI (ci.yml) ──► duyệt ──► gộp vào main ──► CD (deploy.yml) ──► máy 220 ──► kiểm tra site thật
                                  xanh mới gộp                              CI lại + dựng + SSH hạn chế
```

## 1. Cái gì chạy khi nào

| Sự kiện | Workflow | Việc làm |
|---|---|---|
| Mở/cập nhật pull request, hoặc vào `main` | `ci.yml` | `typecheck` + 413 bài vitest + dựng web; 81 bài Python (chẩn đoán, quản lý tài khoản); `bash -n` + shellcheck mọi script; e2e Docker: nginx + SSO thật, script cài 220/222, khoá SSH triển khai. **Không dùng bí mật nào** (PR từ fork cũng chạy được an toàn). |
| Vào `main` | `deploy.yml` | Chạy lại CI → dựng web → đóng gói → gửi qua SSH tới 220 → `install.sh` (và `install-diag.sh` nếu phần chẩn đoán/tài khoản đổi) → kiểm tra `healthz`, `/agent/` (302), API chưa đăng nhập (401), trang đăng nhập (200). Hai lần triển khai không bao giờ chạy cùng lúc. |
| Chạy tay (Actions → Deploy → Run workflow) | `deploy.yml` | Chọn `deploy` (triển khai lại `main`) hoặc `rollback` (quay lại bản trước). |
| Gắn tag `v*` | `release.yml` | Dựng + ký bản Desktop (xem `docs/RELEASE-SIGNING.md`). |

**Không tự triển khai** (làm tay, hiếm khi đổi): dịch vụ đăng nhập (`deploy/220/auth/install-auth.sh`, cần mã bí mật Entra), máy 222 (`deploy/222`), bản Desktop.

## 2. Bảo mật: đọc kỹ trước khi bật

- **Ai gộp được vào `main` thì gián tiếp chạy được mã bằng quyền root trên máy 220** (script cài chạy bằng root). CI/CD không tránh được điều đó; nó chỉ làm cho việc đó có kiểm soát. Vì vậy:
  1. **Bảo vệ nhánh `main`** (Settings → Branches → Add rule): bắt buộc pull request, ≥ 1 người duyệt, "Require review from Code Owners", "Require status checks" (chọn các job của CI), cấm đẩy thẳng và cấm force-push, áp dụng cả cho quản trị viên.
  2. Chỉ cho **ít người có quyền Write/Admin**; người ngoài đóng góp qua fork + PR.
  3. (Khuyến nghị) Settings → Environments → `production` → **Required reviewers**: mỗi lần triển khai chờ một người bấm duyệt.
- Khoá SSH của CI **không có shell**. Trên máy 220 nó bị trói vào đúng một lệnh (`authorized_keys: restrict,command="sudo -n /usr/local/sbin/neu-agent-deploy …"`), sudoers chỉ cho đúng lệnh đó. `neu-agent-deploy` (thuộc root) kiểm tra: gói ≤ 400 MB, mã băm SHA-256 khớp, chỉ tệp thường/thư mục, không đường dẫn tuyệt đối/`..`/liên kết; chép sang thư mục của root rồi mới chạy script cài từ bản sao đó. Hết thảy được kiểm thử trong `deploy/test/e2e-deploy.mjs` (gói độc hại, lệnh lạ qua `SSH_ORIGINAL_COMMAND`, web hỏng tự đưa về bản trước, rollback, khoá chống chạy song song).
- Bí mật chỉ nằm ở GitHub Secrets của repo: `DEPLOY_SSH_KEY` (khoá riêng chỉ dùng cho việc này) và `DEPLOY_KNOWN_HOSTS` (khoá host được ghim, không tin lần đầu). **Key mô hình và secret Entra KHÔNG ở GitHub**: `install.sh` tự dùng lại key đang chạy trên máy chủ.
- Máy chủ phải nhận được kết nối SSH từ GitHub Actions. Nếu tường lửa chỉ cho IP trường, dùng runner tự lưu trữ đặt trong mạng trường (đổi `runs-on` của job `deploy`) — logic còn lại giữ nguyên.

## 3. Thiết lập một lần

### 3.1 Trên máy 220 (cần sudo, làm một lần)

```bash
# từ máy bạn, sau khi đã sinh khoá (xem 3.2) — chép thư mục ci/ lên rồi cài
scp -P <cổng-ssh> -r deploy/220/ci <quản-trị>@<máy 220>:~/neu-agent-220/
ssh -t 220 'cd ~/neu-agent-220 && sudo ./ci/setup-ci.sh --pubkey "ssh-ed25519 AAAA… github-deploy"'
```

Script tạo người dùng `neu-deploy` (khoá mật khẩu), cài `/usr/local/sbin/neu-agent-deploy`, sudoers đúng một lệnh (kiểm cú pháp bằng `visudo -cf` trước), `authorized_keys` hạn chế, rồi tự kiểm tra (đúng lệnh chạy được, lệnh khác bị chặn). Gỡ: `sudo ./ci/setup-ci.sh --uninstall`.

### 3.2 Khoá SSH và GitHub

```bash
ssh-keygen -t ed25519 -N '' -C github-deploy -f ./deploy_key        # sinh khoá riêng dùng cho CI
gh secret set DEPLOY_SSH_KEY < ./deploy_key                         # riêng → GitHub Secrets
ssh-keygen -F '[<địa chỉ 220>]:<cổng-ssh>' -f ~/.ssh/known_hosts | grep -v '^#' | gh secret set DEPLOY_KNOWN_HOSTS   # khoá host đã tin cậy trên máy bạn
gh variable set DEPLOY_HOST --body '<địa chỉ công khai 220>'
gh variable set DEPLOY_PORT --body '<cổng-ssh>'
shred -u ./deploy_key 2>/dev/null || rm -P ./deploy_key             # xoá khoá riêng khỏi máy bạn (chỉ còn ở GitHub)
```

### 3.3 Bật tự triển khai

1. Chạy thử: Actions → **Deploy** → Run workflow (khi `DEPLOY_ENABLED` còn tắt, job triển khai bị bỏ qua; đặt biến rồi chạy lại).
2. `gh variable set DEPLOY_ENABLED --body true` → từ đó mỗi lần vào `main` đều tự triển khai.
3. Làm các bước bảo vệ nhánh ở mục 2.

## 4. Vận hành

- **Xem một lần triển khai:** tab Actions → Deploy → run → phần *Tóm tắt* có nhật ký của máy chủ.
- **Quay lại:** Actions → Deploy → Run workflow → `rollback`. Máy chủ giữ 5 bản gần nhất ở `/opt/neu-agent-deploy/releases` (thuộc root).
- **Kiểm tra trên máy chủ:** `sudo /usr/local/sbin/neu-agent-deploy status`.
- **Lỗi giữa chừng:** `install.sh` / `install-diag.sh` tự sao lưu, kiểm tra sau cài và tự khôi phục; nếu một bước thất bại, `neu-agent-deploy` đưa nginx + web về bản trước và job báo đỏ. Site vẫn phục vụ phiên bản cũ.
- **Triển khai tay khi CI/CD hỏng:** như trước (`scp` + `sudo ./install.sh`, xem `docs/DEPLOY.md`); CI/CD không khoá cách đó.
- **Thay khoá CI:** sinh khoá mới, `gh secret set DEPLOY_SSH_KEY`, chạy lại `setup-ci.sh --pubkey …`. Khoá cũ hết tác dụng ngay.

## 5. Giới hạn đã biết

- Phần chẩn đoán/tài khoản (`install-diag.sh`) cần systemd thật nên chưa chạy được trong bài thử Docker; nó được kiểm bằng 81 bài Python và chạy thật trên máy chủ ở lần triển khai đầu.
- CI chưa chạy bài thử Electron (`npm run smoke`) vì cần môi trường đồ hoạ; chạy tay trên máy Mac/Windows trước khi phát hành bản Desktop.
- Triển khai là *một máy, không có bản chạy thử (staging)*: `rollback` và các kiểm tra sau cài là lưới an toàn duy nhất.
