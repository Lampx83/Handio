# Công khai mã nguồn: cấu hình riêng của nơi triển khai và cách giữ kho sạch

Kho này công khai theo Apache-2.0 (`LICENSE`, `NOTICE`). Mọi thứ **riêng của một nơi triển khai** (địa chỉ máy chủ, định danh tổ chức, khoá) nằm **ngoài** kho; mã chỉ có dấu giữ chỗ hoặc biến cấu hình.

## Cái gì nằm ở đâu

| Thứ | Ở đâu | Ghi chú |
|---|---|---|
| Địa chỉ gateway mô hình, máy 220/222 (công khai + nội bộ), tenant/client SSO của máy chủ | **Secret repo `SITE_CONF`** | Nhiều dòng `SITE_TÊN=giá-trị`; mẫu: `deploy/site.example.env`. CD điền vào các tệp `@@SITE_…@@` lúc đóng gói và **che** từng giá trị trong nhật ký. |
| Tenant ID, client ID Entra của bản Desktop | Biến repo `NEU_AUTH_TENANT`, `NEU_AUTH_CLIENT_ID` | Là định danh công khai nhúng trong ứng dụng; bản phát hành dừng sớm (5 giây) nếu thiếu. |
| Gateway mạng nội bộ (HTTP) cho Desktop, tuỳ chọn | Biến repo `NEU_LAN_GATEWAY` | Dạng `http://địa-chỉ:cổng/vllm/v1`. Trống = không có lựa chọn "Mạng nội bộ". |
| Khoá SSH triển khai, known_hosts | Secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; biến `DEPLOY_ENABLED`, `DEPLOY_HOST`, `DEPLOY_PORT` | Như `docs/CICD.md`. |
| Chứng chỉ ký số macOS/Windows (nếu có) | Secrets như `docs/RELEASE-SIGNING.md` | |
| Sổ vận hành gateway (tên container, route Kong, consumer…) | Kho **riêng tư** của đơn vị vận hành | Không để trong kho công khai. |

## Thiết lập một lần (người quản trị repo)

```bash
# 1) Cấu hình máy chủ: tạo site.env từ mẫu, điền địa chỉ thật, rồi đặt thành SECRET (nội dung nhiều dòng)
cp deploy/site.example.env site.env      # sửa site.env; KHÔNG commit (đã nằm trong .gitignore)
gh secret set SITE_CONF < site.env

# 2) Bản Desktop
gh variable set NEU_AUTH_TENANT --body <tenant-id>
gh variable set NEU_AUTH_CLIENT_ID --body <client-id>
gh variable set NEU_LAN_GATEWAY --body http://<địa-chỉ>:<cổng>/vllm/v1   # tuỳ chọn
```

Cài tay (không qua CD) từ một bản checkout: điền dấu giữ chỗ vào một bản sao rồi cài từ bản sao đó.

```bash
node deploy/render-site.mjs deploy/220 --env site.env --out /tmp/neu-220   # hoặc deploy/222
sudo bash /tmp/neu-220/install.sh <khoá>
```

Script cài **từ chối chạy** nếu còn dấu giữ chỗ `@@SITE_…@@`; thiếu khoá cấu hình thì CD dừng ở bước đóng gói, trước khi gửi gì lên máy chủ.

## Giữ kho sạch (tự động)

- `node scripts/public-audit.mjs` quét các tệp đang theo dõi: IP máy chủ thật, GUID tổ chức, khoá/token, email cá nhân thật, tệp bí mật (`.env`, `*.pem`, `captures*.db`…). CI chạy nó ở mỗi PR và mỗi lần vào `main`; **mọi phát hiện đều làm CI đỏ**.
- Đã có máy mới? Thêm tiền tố địa chỉ thật của nó vào `ORG_PREFIXES` trong `scripts/public-audit.mjs`.
- `node scripts/public-audit.mjs --history` quét cả lịch sử (mọi nhánh, tag): chạy trước khi đổi repo sang công khai.
- Địa chỉ ví dụ trong tài liệu/kiểm thử: dùng `192.0.2.x`, `198.51.100.x`, `203.0.113.x` (dải dành cho tài liệu, RFC 5737).

## Cài đặt GitHub nên bật khi công khai

1. **Settings → Actions → General → Fork pull request workflows**: "Require approval for all outside collaborators".
2. **Settings → Environments → production**: *Deployment branches* chỉ `main`; thêm *Required reviewers* nếu muốn duyệt tay trước khi triển khai.
3. **Settings → Code security**: bật *Secret scanning* và *Push protection*, *Dependabot alerts*, *Private vulnerability reporting*.
4. **Branch protection cho `main`**: yêu cầu PR + CI xanh (job "Mã nguồn…", "Máy chủ…", "Script triển khai…", "e2e…"), cấm force-push.
5. **Không bao giờ dùng runner tự host** cho repo công khai (PR từ người ngoài có thể chạy mã trên máy đó). Actions trên runner của GitHub miễn phí không giới hạn với repo công khai.
6. Workflow chỉ dùng `pull_request` (không dùng `pull_request_target`): PR từ fork không đọc được secret. Giữ nguyên quy ước này.

## Lưu ý về nhật ký Actions

Nhật ký của repo công khai ai cũng đọc được. CD chỉ in tóm tắt triển khai (commit, người chạy, nhật ký script cài). Giá trị `SITE_CONF` được che bằng `::add-mask::`; vẫn tránh `echo` thêm cấu hình máy chủ trong workflow.
