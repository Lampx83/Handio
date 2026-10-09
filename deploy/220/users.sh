#!/usr/bin/env bash
# Quản lý tài khoản tên + mật khẩu (ngoài đăng nhập Microsoft). Chạy bằng sudo trên máy 220.
#   sudo ./users.sh add <tên>        tạo tài khoản hoặc đổi mật khẩu (hỏi mật khẩu 2 lần, gõ không hiện)
#   sudo ./users.sh add <tên> --stdin   như trên nhưng đọc mật khẩu từ stdin (tạo nhanh/bằng script: printf '%s\n' "mật-khẩu" | sudo ./users.sh add tên --stdin)
#   sudo ./users.sh remove <tên>     xoá tài khoản
#   sudo ./users.sh list             liệt kê tên (không hiện mật khẩu)
#   sudo ./users.sh kick             bắt MỌI người đang đăng nhập phải đăng nhập lại (đổi khoá phiên)
# Mật khẩu được băm bcrypt (không lưu mật khẩu gốc), tệp /etc/neu-agent/users.htpasswd quyền 600 chỉ root đọc.
# Tên: 3–32 ký tự a-z 0-9 . _ -  | Mật khẩu: từ 6 ký tự, không trùng tên, không toàn số.
# Xoá/đổi mật khẩu: ứng dụng Desktop (gửi mật khẩu mỗi yêu cầu) bị chặn NGAY; phiên trình duyệt đã đăng nhập còn hiệu lực tới 8 giờ, dùng `kick` để cắt ngay.
set -euo pipefail
# Đường dẫn mặc định của máy chủ. Đặt NEU_USERS_FILE/NEU_ENV_FILE chỉ để KIỂM THỬ với tệp tạm (khi đó không cần root và không khởi động lại dịch vụ).
F="${NEU_USERS_FILE:-/etc/neu-agent/users.htpasswd}"
ENVF="${NEU_ENV_FILE:-/etc/neu-agent/oauth2-proxy.env}"
if [ -z "${NEU_USERS_FILE:-}" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
  mkdir -p /etc/neu-agent; chmod 750 /etc/neu-agent
fi
touch "$F"; chmod 600 "$F"
restart() {
  if [ -n "${NEU_USERS_FILE:-}" ]; then echo "Đã áp dụng (thử nghiệm)."; return 0; fi
  systemctl restart neu-agent-oauth2 2>/dev/null && echo "Đã áp dụng (khởi động lại dịch vụ đăng nhập)." || echo "Nhớ khởi động lại: sudo systemctl restart neu-agent-oauth2"
}

hash_pw() { # $1 = tên; mật khẩu đọc từ stdin (không lộ qua danh sách tiến trình)
  if command -v htpasswd >/dev/null; then htpasswd -niB "$1" | tr -d '\n'
  else python3 -W ignore -c 'import crypt,sys; pw=sys.stdin.readline().rstrip("\n"); sys.stdout.write(sys.argv[1]+":"+crypt.crypt(pw, crypt.mksalt(crypt.METHOD_BLOWFISH)))' "$1"
  fi
}

case "${1:-}" in
  add)
    U="${2:-}"; [[ "$U" =~ ^[a-z0-9][a-z0-9._-]{2,31}$ ]] || { echo "Tên không hợp lệ (3–32 ký tự: a-z 0-9 . _ -)."; exit 1; }
    if [ "${3:-}" = "--stdin" ]; then read -r P1; P2="$P1"
    else read -r -s -p "Mật khẩu cho $U: " P1; echo; read -r -s -p "Nhập lại: " P2; echo; fi
    [ "$P1" = "$P2" ] || { echo "Hai lần nhập không khớp."; exit 1; }
    [ "${#P1}" -ge 6 ] || { echo "Mật khẩu phải từ 6 ký tự."; exit 1; }
    [ "$P1" != "$U" ] && [[ ! "$P1" =~ ^[0-9]+$ ]] || { echo "Mật khẩu quá yếu (trùng tên hoặc toàn số)."; exit 1; }
    LINE=$(printf '%s\n' "$P1" | hash_pw "$U"); unset P1 P2
    case "$LINE" in "$U":'$2'*) ;; *) echo "Không tạo được băm bcrypt (cần htpasswd hoặc python3 có mô-đun crypt)."; exit 1;; esac
    TMP=$(mktemp "$F.XXXXXX"); chmod 600 "$TMP"; grep -v "^$U:" "$F" > "$TMP" || true; echo "$LINE" >> "$TMP"; mv "$TMP" "$F"; chmod 600 "$F"
    echo "Đã lưu tài khoản: $U"; restart;;
  remove)
    U="${2:-}"; grep -q "^$U:" "$F" || { echo "Không có tài khoản $U."; exit 1; }
    TMP=$(mktemp "$F.XXXXXX"); chmod 600 "$TMP"; grep -v "^$U:" "$F" > "$TMP" || true; mv "$TMP" "$F"; chmod 600 "$F"; echo "Đã xoá: $U"; restart;;
  list) cut -d: -f1 "$F" | sort | sed 's/^/  /'; echo "($(grep -c . "$F") tài khoản)";;
  kick)
    [ -f "$ENVF" ] || { echo "Chưa cài dịch vụ đăng nhập."; exit 1; }
    NEW=$(openssl rand -hex 16); TMPE=$(mktemp "$ENVF.XXXXXX"); sed "s/^OAUTH2_PROXY_COOKIE_SECRET=.*/OAUTH2_PROXY_COOKIE_SECRET=$NEW/" "$ENVF" > "$TMPE"; cat "$TMPE" > "$ENVF"; rm -f "$TMPE"; restart; echo "Mọi phiên đăng nhập trên trình duyệt đã bị huỷ.";;
  *) sed -n 2,9p "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
