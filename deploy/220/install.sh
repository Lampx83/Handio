#!/usr/bin/env bash
# Cài NEU Agent (web + proxy mô hình + đăng nhập SSO + bản tải) trên máy 220. Chạy bằng sudo trong thư mục chứa các tệp này.
#   sudo ./auth/install-auth.sh               (làm TRƯỚC, một lần: dịch vụ đăng nhập)
#   sudo ./install.sh <key mô hình>           cài lần đầu (cập nhật sau đó không cần key: tự dùng lại key đang chạy)
#   sudo ./install.sh                         cập nhật (chép web.tar.gz / downloads/ mới rồi chạy lại lệnh này)
#   sudo ./install.sh --uninstall             gỡ cấu hình nginx của NEU Agent (giữ tệp web và dịch vụ đăng nhập)
# An toàn: sao lưu cấu hình, nginx -t trước khi nạp lại, tự khôi phục nếu lỗi hoặc kiểm tra sau cài thất bại; không đụng tới các site khác.
set -euo pipefail

SITE=/etc/nginx/sites-available/neu-agent
LINK=/etc/nginx/sites-enabled/neu-agent
CONFD=/etc/nginx/conf.d/neu-agent.conf
SNIP=/etc/nginx/snippets/neu-agent-locations.conf
SNIPA=/etc/nginx/snippets/neu-agent-auth.conf
WEBROOT=/var/www/neu-agent
DLROOT=/var/www/neu-agent-dl
GUIDEROOT=/var/www/neu-agent-guide
HERE="$(cd "$(dirname "$0")" && pwd)"
# Dấu giữ chỗ @@SITE_…@@ phải đã được điền (CD điền khi đóng gói; tay: node deploy/render-site.mjs). Chưa điền thì dừng, chưa đụng gì tới máy.
if grep -rIlE '@@SITE_[A-Z0-9_]+@@' "$HERE" >/dev/null 2>&1; then
  echo "Chưa điền cấu hình site: còn dấu giữ chỗ @@SITE_…@@ trong $HERE. Chạy: node deploy/render-site.mjs <thư mục> --env site.env (xem docs/PUBLIC.md)."; exit 1
fi
TS=$(date +%Y%m%d%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v nginx >/dev/null || { echo "Không thấy nginx."; exit 1; }
reload() { nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload); }

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$LINK" "$CONFD" "$SNIP" "$SNIPA"; reload && echo "Đã gỡ cấu hình nginx của NEU Agent (tệp web còn ở $WEBROOT)."; exit 0
fi

KEY="${NEU_AGENT_KEY:-${1:-}}"
# Cập nhật không cần nhập lại key: dùng lại key đang chạy trong cấu hình đã cài (để CI/CD tự triển khai mà KHÔNG phải giữ key ở GitHub)
if [ -z "$KEY" ] && [ -r "$CONFD" ]; then KEY=$(sed -n 's/^[[:space:]]*""[[:space:]]*"\([A-Za-z0-9._-]\{1,\}\)";.*$/\1/p' "$CONFD" | head -1); fi
[ -n "$KEY" ] || { echo "Thiếu key mô hình (chưa cài lần nào). Ví dụ: sudo ./install.sh <key>"; exit 1; }
case "$KEY" in *[!A-Za-z0-9._-]*) echo "Key chỉ được chứa chữ, số, . _ -"; exit 1;; esac
for f in web.tar.gz neu-agent.http.conf neu-agent.server.conf neu-agent.locations.conf neu-agent-auth.conf; do [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }; done
systemctl is-active --quiet neu-agent-oauth2 || { echo "Dịch vụ đăng nhập chưa chạy. Chạy trước: sudo ./auth/install-auth.sh"; exit 1; }

# trạng thái các site khác trước khi cài (để chắc chắn không bị ảnh hưởng)
other_before=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: @@SITE_220_PUBLIC_IP@@" http://127.0.0.1/ || true)

bak() { [ -e "$1" ] && cp -a "$1" "$1.bak-$TS" || true; }
for f in "$SITE" "$CONFD" "$SNIP" "$SNIPA"; do bak "$f"; done
had_link=0; [ -L "$LINK" ] && had_link=1

rollback() {
  echo "!! Có lỗi, đang khôi phục cấu hình cũ…"
  for f in "$SITE" "$CONFD" "$SNIP" "$SNIPA"; do
    if [ -e "$f.bak-$TS" ]; then cp -a "$f.bak-$TS" "$f"; else rm -f "$f"; fi
  done
  [ $had_link = 1 ] || rm -f "$LINK"
  nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload) || true
  [ -d "$WEBROOT.prev" ] && { rm -rf "$WEBROOT"; mv "$WEBROOT.prev" "$WEBROOT"; }
  echo "Đã khôi phục."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# 1) tệp web (giữ bản cũ để khôi phục)
rm -rf "$WEBROOT.new" "$WEBROOT.prev"; mkdir -p "$WEBROOT.new"
tar -xzf "$HERE/web.tar.gz" -C "$WEBROOT.new"
[ -f "$WEBROOT.new/index.html" ] || { echo "web.tar.gz không có index.html"; exit 1; }
chmod -R a+rX "$WEBROOT.new"
[ -d "$WEBROOT" ] && mv "$WEBROOT" "$WEBROOT.prev"
mv "$WEBROOT.new" "$WEBROOT"

# 1b) bản cài Desktop (tuỳ chọn): downloads/ -> /var/www/neu-agent-dl (kiểm mã băm trước khi chép)
if [ -d "$HERE/downloads" ] && ls "$HERE/downloads" | grep -q .; then
  if [ -f "$HERE/downloads/SHA256SUMS.txt" ]; then (cd "$HERE/downloads" && sha256sum -c SHA256SUMS.txt >/dev/null) || { echo "Mã băm các bản cài không khớp SHA256SUMS.txt. Dừng."; exit 1; }; fi
  mkdir -p "$DLROOT"; cp -f "$HERE/downloads/"* "$DLROOT/"; chmod 755 "$DLROOT"; chmod 644 "$DLROOT"/*
  echo "Đã cập nhật bản cài Desktop: $(ls "$DLROOT" | tr '\n' ' ')"
fi

# 1c) trang giới thiệu/hướng dẫn công khai: guide-public/ -> /var/www/neu-agent-guide (thay nguyên thư mục để không sót ảnh cũ)
if [ -f "$HERE/guide-public/index.html" ]; then
  rm -rf "$GUIDEROOT.new"; mkdir -p "$GUIDEROOT.new"; cp -R "$HERE/guide-public/." "$GUIDEROOT.new/"
  chmod -R a+rX "$GUIDEROOT.new"; rm -rf "$GUIDEROOT"; mv "$GUIDEROOT.new" "$GUIDEROOT"
  echo "Đã cập nhật trang hướng dẫn công khai: $GUIDEROOT"
fi

# 2) cấu hình nginx (key chỉ nằm ở tệp conf.d, quyền 640)
mkdir -p /etc/nginx/snippets
sed "s/__NEU_AGENT_KEY__/$KEY/" "$HERE/neu-agent.http.conf" > "$CONFD"; chmod 640 "$CONFD"
cp "$HERE/neu-agent.locations.conf" "$SNIP"; cp "$HERE/neu-agent-auth.conf" "$SNIPA"; chmod 644 "$SNIP" "$SNIPA"
cp "$HERE/neu-agent.server.conf" "$SITE"; chmod 644 "$SITE"
ln -sf "$SITE" "$LINK"
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload

# 3) kiểm tra sau cài (gọi thẳng vào nginx cục bộ với Host của người dùng); thất bại thì tự khôi phục
sleep 1
H="Host: ai.neu.edu.vn"
code() { curl -s -o /dev/null -w "%{http_code}" -H "$H" "$@"; }
r_page=$(code http://127.0.0.1/agent/index.html)  # đường dẫn đúng /agent/ nay hiện trang giới thiệu khi chưa đăng nhập; tệp ứng dụng vẫn phải đăng nhập (302)
r_start=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -H "$H" -H "X-Forwarded-Proto: https" "http://127.0.0.1/agent/oauth2/start?rd=/agent/")
r_api=$(code http://127.0.0.1/agent/vllm/v1/models)
r_apibody=$(curl -s -H "$H" http://127.0.0.1/agent/vllm/v1/models | head -c 60)
r_dl=$(code http://127.0.0.1/agent/download/SHA256SUMS.txt)
r_embed=$(code http://127.0.0.1/agent/vllm/v1/embeddings)
r_other=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: @@SITE_220_PUBLIC_IP@@" http://127.0.0.1/ || true)
echo "Kiểm tra: trang=$r_page(302: chuyển tới đăng nhập) | đăng nhập=${r_start%% *}→${r_start#* } | API chưa đăng nhập=$r_api $r_apibody | tải về=$r_dl | embeddings=$r_embed | site khác=$other_before→$r_other"
[ "$r_page" = 302 ] && [ "${r_start%% *}" = 302 ] && [[ "${r_start#* }" == https://login.microsoftonline.com/* ]] && [ "$r_api" = 401 ] && [[ "$r_apibody" == *login_required* ]] && [ "$r_dl" = 302 ] && [ "$r_embed" != 200 ] && [ "$r_other" = "$other_before" ] || { echo "Kiểm tra sau cài THẤT BẠI"; exit 1; }
rm -rf "$WEBROOT.prev"
trap - EXIT
echo "OK: NEU Agent đã chạy trên máy 220. Còn lại: trỏ ai.neu.edu.vn/agent/ từ máy 222 sang đây (xem deploy/222)."
