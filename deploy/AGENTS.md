# deploy — mã chạy với quyền root trên máy chủ thật (cẩn thận nhất)

- Phần lớn script ở đây chạy bằng **root** trên máy 220/222. Sai một dòng có thể làm hỏng site đang chạy của cả trường (và các site khác cùng máy, ví dụ OJ Judge). **Mọi script cài phải: sao lưu trước, `nginx -t` trước khi nạp, kiểm tra sau cài, tự khôi phục khi lỗi, idempotent**, và không đụng tới site khác.
- Kiểm thử bắt buộc khi đổi: `deploy/220/diag` → `python3 -m unittest discover -s . -p 'test_*.py'`; `deploy/220/backup` → `python3 -m unittest discover -s deploy/220/backup -p 'test_*.py'` + `node deploy/test/e2e-backup.mjs`; nginx/cài đặt → `node deploy/test/e2e-sso.mjs`, `e2e-install.mjs`, `e2e-deploy.mjs` (Docker). Mỗi hành vi bảo mật mới cần một bài thử **tấn công** (đầu vào xấu phải bị từ chối), không chỉ bài thử đường đi đúng.
- Phân quyền: trang quản trị (`diag/collector.py`) chạy bằng tài khoản thường `neu-diag`; việc ghi tệp mật khẩu do dịch vụ phụ root `diag/accounts.py` làm qua socket Unix. **Đừng cho collector quyền ghi hệ thống.** Khoá CI chỉ chạy được `ci/neu-agent-deploy` (xem `docs/CICD.md`).
- nginx: `absolute_redirect off`; dùng `geo $realip_remote_addr` để kiểm nguồn; cookie phiên Microsoft lớn nên có `proxy_buffer_size 32k`. Thay đổi cấu hình phải qua `e2e-*.mjs` trước.
- **Bí mật** (`/etc/neu-agent/*`: secret Entra, cookie secret, key mô hình, `users.htpasswd`) không bao giờ vào kho/nhật ký/đầu ra. `install.sh` tự dùng lại key đang chạy; `auth/install-auth.sh` kiểm tra secret với Microsoft trước khi ghi.
- Không có môi trường thử (staging): tự khôi phục + `rollback` + bài thử Docker là lưới an toàn. Đừng giả định "chạy được trên máy tôi".
- Việc cần `sudo` thật trên máy chủ do người vận hành làm hoặc cho phép; AI không tự sửa tay trên máy chủ ngoài quy trình CD khi chưa được yêu cầu rõ.
- Số liệu chẩn đoán **không nội dung** (xem `docs/DIAGNOSTICS.md`); thêm thu thập gì phải sửa `diag/schema.json` + `packages/core/src/diagnostics.ts` + tài liệu.
