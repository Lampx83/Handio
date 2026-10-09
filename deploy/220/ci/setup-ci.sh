#!/usr/bin/env bash
# Cài (MỘT LẦN) phía máy 220 cho CI/CD: người dùng `neu-deploy` + khoá SSH bị hạn chế + script nhận/áp dụng bản triển khai.
#   sudo ./ci/setup-ci.sh --pubkey "ssh-ed25519 AAAA… github-deploy"     cài (chạy lại để đổi khoá hoặc cập nhật script)
#   sudo ./ci/setup-ci.sh --uninstall                                      gỡ người dùng, khoá và script (giữ các bản đã triển khai ở /opt/neu-agent-deploy)
#
# Khoá này CHỈ chạy được `sudo -n /usr/local/sbin/neu-agent-deploy …`: không có shell, không pty, không chuyển cổng, không đọc/ghi tệp tuỳ ý.
# sudoers cho phép đúng MỘT lệnh. Cần lưu ý (xem docs/CICD.md): ai ghi được vào nhánh main trên GitHub thì gián tiếp triển khai được mã lên máy này
# (script cài chạy bằng root) → bảo vệ nhánh main (bắt buộc review + CI xanh) và hạn chế người có quyền ghi.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME=neu-deploy
HOME_DIR=/home/$USER_NAME
BIN=/usr/local/sbin/neu-agent-deploy
SUDOERS=/etc/sudoers.d/neu-agent-ci

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$SUDOERS" "$BIN"
  id -u "$USER_NAME" >/dev/null 2>&1 && userdel -r "$USER_NAME" 2>/dev/null || true
  echo "Đã gỡ CI/CD phía máy chủ (các bản đã triển khai vẫn ở /opt/neu-agent-deploy)."
  exit 0
fi

PUB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pubkey) PUB="${2:-}"; shift 2;;
    *) echo "Tham số lạ: $1"; exit 1;;
  esac
done
[[ "$PUB" =~ ^ssh-ed25519\ [A-Za-z0-9+/]{60,}={0,2}(\ [A-Za-z0-9._@:-]{1,64})?$ ]] || { echo "--pubkey phải là một khoá công khai ssh-ed25519 (một dòng, không có tuỳ chọn đi kèm)."; exit 1; }
[ -f "$HERE/neu-agent-deploy" ] || { echo "Thiếu $HERE/neu-agent-deploy"; exit 1; }
command -v visudo >/dev/null && command -v flock >/dev/null || { echo "Thiếu visudo hoặc flock."; exit 1; }

id -u "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --home-dir "$HOME_DIR" --shell /bin/bash --comment "NEU Agent CI deploy (khoá SSH hạn chế)" "$USER_NAME"
passwd -l "$USER_NAME" >/dev/null 2>&1 || true   # không đăng nhập bằng mật khẩu

install -m 0755 -o root -g root "$HERE/neu-agent-deploy" "$BIN"

# sudoers: đúng một lệnh; kiểm tra cú pháp TRƯỚC khi đặt vào /etc/sudoers.d (tệp sai làm hỏng sudo của cả máy)
TMP=$(mktemp)
printf '# Tạo bởi neu-agent ci/setup-ci.sh: khoá CI chỉ được chạy đúng một lệnh với quyền root.\n%s ALL=(root) NOPASSWD: %s\nDefaults:%s !requiretty\n' "$USER_NAME" "$BIN" "$USER_NAME" > "$TMP"
visudo -cf "$TMP" >/dev/null || { rm -f "$TMP"; echo "Tệp sudoers sinh ra không hợp lệ. Dừng (không đổi gì)."; exit 1; }
install -m 0440 -o root -g root "$TMP" "$SUDOERS"; rm -f "$TMP"
visudo -c >/dev/null 2>&1 || echo "Lưu ý: visudo -c báo có tệp sudoers khác của máy chưa đúng (không phải tệp này); xem: sudo visudo -c"

# khoá SSH hạn chế
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
printf 'restrict,command="sudo -n %s \\"$SSH_ORIGINAL_COMMAND\\"" %s\n' "$BIN" "$PUB" > "$HOME_DIR/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh/authorized_keys"; chmod 600 "$HOME_DIR/.ssh/authorized_keys"
install -d -m 0750 -o root -g root /opt/neu-agent-deploy

# tự kiểm tra: đúng lệnh qua sudo của người dùng này chạy được, lệnh khác bị từ chối
if su -s /bin/bash "$USER_NAME" -c "sudo -n $BIN status" >/dev/null 2>&1; then c1=ok; else c1=LỖI; fi
if su -s /bin/bash "$USER_NAME" -c "sudo -n /bin/true" >/dev/null 2>&1; then c2="LỖI (sudo quá rộng!)"; else c2=ok; fi
echo "Tự kiểm tra: sudo đúng lệnh=$c1 | sudo lệnh khác bị chặn=$c2"
[ "$c1" = ok ] && [ "$c2" = ok ] || { echo "Tự kiểm tra THẤT BẠI."; exit 1; }
echo "OK: máy chủ sẵn sàng nhận bản triển khai từ CI."
echo "Khoá host SSH (đưa vào secret DEPLOY_KNOWN_HOSTS): lấy từ máy bạn bằng  ssh-keyscan -p <cổng> <địa chỉ máy>"
