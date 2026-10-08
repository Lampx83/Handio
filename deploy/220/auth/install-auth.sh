#!/usr/bin/env bash
# Cài dịch vụ đăng nhập SSO (oauth2-proxy) trên máy 220. Chạy bằng sudo, trong thư mục chứa các tệp này.
#   sudo ./auth/install-auth.sh            (hỏi mã bí mật của ứng dụng Entra; gõ không hiện)
# Hoặc đặt sẵn biến: NEU_SSO_SECRET=<mã bí mật> sudo -E ./auth/install-auth.sh
# Mã bí mật CHỈ nằm ở /etc/neu-agent/oauth2-proxy.env (quyền 600, root). Không nằm trong gói cài hay mã nguồn.
set -euo pipefail

VERSION=v7.15.5
SHA256=f63f94bf72c5f46ab002a0a275aa8b3cf19b4d828aed08a13978cb9a62c3a1fd
TENANT="${NEU_SSO_TENANT:-00000000-0000-0000-0000-000000000001}"
CLIENT_ID="${NEU_SSO_CLIENT_ID:-00000000-0000-0000-0000-000000000002}"
PUBLIC_URL="${NEU_PUBLIC_URL:-https://ai.neu.edu.vn}"
DOMAINS="${NEU_SSO_DOMAINS:-neu.edu.vn,st.neu.edu.vn}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF=/etc/neu-agent/oauth2-proxy.env
BIN=/usr/local/bin/oauth2-proxy

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v openssl >/dev/null && command -v systemctl >/dev/null || { echo "Thiếu openssl hoặc systemctl."; exit 1; }

# 1) chương trình: dùng tệp có sẵn cạnh script (đã ghim mã băm), tải nếu không có
TAR="$HERE/oauth2-proxy-$VERSION.linux-amd64.tar.gz"
if [ ! -f "$TAR" ]; then
  TAR=$(mktemp); curl -fsSL -o "$TAR" "https://github.com/oauth2-proxy/oauth2-proxy/releases/download/$VERSION/oauth2-proxy-$VERSION.linux-amd64.tar.gz"
fi
echo "$SHA256  $TAR" | sha256sum -c - >/dev/null || { echo "Mã băm oauth2-proxy KHÔNG khớp. Dừng."; exit 1; }
T=$(mktemp -d); tar -xzf "$TAR" -C "$T"
install -m 755 -o root -g root "$T"/oauth2-proxy-*/oauth2-proxy "$BIN"; rm -rf "$T"
echo "Đã cài $("$BIN" --version | head -1)"

# 2) cấu hình (giữ nguyên cookie-secret cũ nếu có để không làm mọi người bị đăng xuất khi cập nhật)
mkdir -p /etc/neu-agent; chmod 750 /etc/neu-agent
COOKIE=""; OLD_SECRET=""
if [ -f "$ENVF" ]; then COOKIE=$(grep '^OAUTH2_PROXY_COOKIE_SECRET=' "$ENVF" | cut -d= -f2-); OLD_SECRET=$(grep '^OAUTH2_PROXY_CLIENT_SECRET=' "$ENVF" | cut -d= -f2-); fi
[ -n "$COOKIE" ] || COOKIE=$(openssl rand -hex 16)
SECRET="${NEU_SSO_SECRET:-}"
# tệp tạm chứa mã bí mật (quyền 600, do người quản trị chép lên bằng scp): đọc xong xoá ngay
SECRET_FILE="$HERE/../.sso-secret"
if [ -z "$SECRET" ] && [ -f "$SECRET_FILE" ]; then SECRET=$(tr -d '[:space:]' < "$SECRET_FILE"); rm -f "$SECRET_FILE"; echo "Đã đọc mã bí mật từ tệp tạm (và xoá tệp)."; fi
if [ -z "$SECRET" ] && [ -n "$OLD_SECRET" ]; then
  # dán mã mới để thay; chỉ nhấn Enter nếu muốn giữ mã đang dùng (gõ không hiện)
  read -r -s -p "Dán mã bí mật MỚI của ứng dụng Entra (Enter = giữ mã đang dùng): " SECRET; echo
  [ -n "$SECRET" ] || SECRET="$OLD_SECRET"
fi
if [ -z "$SECRET" ]; then read -r -s -p "Mã bí mật (Application secret) của ứng dụng Entra: " SECRET; echo; fi
[ -n "$SECRET" ] || { echo "Thiếu mã bí mật."; exit 1; }
case "$SECRET" in *[!A-Za-z0-9._~-]*) echo "Mã bí mật có ký tự lạ; kiểm tra lại (chỉ chữ, số, . _ ~ -)."; exit 1;; esac
# thử mã với Microsoft trước khi dùng: sai thì dừng, không ghi đè cấu hình đang chạy
CHK=$(curl -s -m 20 -X POST "https://login.microsoftonline.com/$TENANT/oauth2/v2.0/token" --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$SECRET" --data-urlencode "grant_type=client_credentials" --data-urlencode "scope=https://graph.microsoft.com/.default" || true)
case "$CHK" in
  *access_token*) echo "Mã bí mật đúng (đã kiểm tra với Microsoft).";;
  *AADSTS7000215*|*invalid_client*) echo "MÃ BÍ MẬT SAI (Microsoft từ chối). Cấu hình cũ được giữ nguyên."; exit 1;;
  *) echo "Không kiểm tra được mã với Microsoft (mạng?); tiếp tục.";;
esac
umask 077
cat > "$ENVF" <<EOT
# NEU Agent - oauth2-proxy (đăng nhập SSO Microsoft 365). Tệp này chứa bí mật: quyền 600, chỉ root đọc.
OAUTH2_PROXY_PROVIDER=oidc
OAUTH2_PROXY_OIDC_ISSUER_URL=https://login.microsoftonline.com/$TENANT/v2.0
OAUTH2_PROXY_CLIENT_ID=$CLIENT_ID
OAUTH2_PROXY_CLIENT_SECRET=$SECRET
OAUTH2_PROXY_REDIRECT_URL=$PUBLIC_URL/agent/oauth2/callback
OAUTH2_PROXY_PROXY_PREFIX=/agent/oauth2
OAUTH2_PROXY_HTTP_ADDRESS=127.0.0.1:4180
OAUTH2_PROXY_UPSTREAMS=static://202
OAUTH2_PROXY_EMAIL_DOMAINS=$DOMAINS
OAUTH2_PROXY_OIDC_EMAIL_CLAIM=preferred_username
OAUTH2_PROXY_SCOPE=openid profile email
OAUTH2_PROXY_CODE_CHALLENGE_METHOD=S256
OAUTH2_PROXY_COOKIE_NAME=_neuagent_sso
OAUTH2_PROXY_COOKIE_PATH=/agent
OAUTH2_PROXY_COOKIE_SECRET=$COOKIE
OAUTH2_PROXY_COOKIE_SECURE=true
OAUTH2_PROXY_COOKIE_HTTPONLY=true
OAUTH2_PROXY_COOKIE_SAMESITE=lax
OAUTH2_PROXY_COOKIE_EXPIRE=8h
OAUTH2_PROXY_REVERSE_PROXY=true
OAUTH2_PROXY_REAL_CLIENT_IP_HEADER=X-Real-IP
OAUTH2_PROXY_SKIP_JWT_BEARER_TOKENS=true
OAUTH2_PROXY_SET_XAUTHREQUEST=true
OAUTH2_PROXY_PREFER_EMAIL_TO_USER=true
OAUTH2_PROXY_USER_ID_CLAIM=preferred_username
OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=false
OAUTH2_PROXY_DISPLAY_HTPASSWD_FORM=true
OAUTH2_PROXY_CUSTOM_TEMPLATES_DIR=/usr/local/share/neu-agent/templates
OAUTH2_PROXY_WHITELIST_DOMAINS=$(echo "$PUBLIC_URL" | sed -E 's#^https?://##; s#/.*##')
OAUTH2_PROXY_PASS_ACCESS_TOKEN=false
OAUTH2_PROXY_SILENCE_PING_LOGGING=true
EOT
chmod 600 "$ENVF"; chown root:root "$ENVF"

# 2b) trang đăng nhập tiếng Việt + tệp tài khoản mật khẩu (rỗng lúc đầu; quản lý bằng ../users.sh)
# (mẫu giao diện không chứa bí mật; để ngoài /etc/neu-agent vì dịch vụ chạy bằng tài khoản tạm, không đọc được thư mục đó)
mkdir -p /usr/local/share/neu-agent/templates; chmod 755 /usr/local/share/neu-agent /usr/local/share/neu-agent/templates
cp "$HERE"/templates/*.html /usr/local/share/neu-agent/templates/; chmod 644 /usr/local/share/neu-agent/templates/*.html
rm -rf /etc/neu-agent/templates
[ -f /etc/neu-agent/users.htpasswd ] || { : > /etc/neu-agent/users.htpasswd; chmod 600 /etc/neu-agent/users.htpasswd; }

# 3) dịch vụ
install -m 644 "$HERE/neu-agent-oauth2.service" /etc/systemd/system/neu-agent-oauth2.service
systemctl daemon-reload
systemctl enable neu-agent-oauth2 >/dev/null 2>&1
systemctl restart neu-agent-oauth2
for i in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:4180/ping && break; sleep 1; done
if curl -fs -o /dev/null http://127.0.0.1:4180/ping; then
  curl -fs http://127.0.0.1:4180/agent/oauth2/sign_in | grep -q "Đăng nhập Microsoft" || { echo "Dịch vụ chạy nhưng chưa nạp được trang đăng nhập tiếng Việt (xem journalctl -u neu-agent-oauth2)"; exit 1; }
  echo "OK: dịch vụ đăng nhập đang chạy (127.0.0.1:4180). Bước tiếp: sudo ./install.sh <key mô hình>"
else
  echo "Dịch vụ chưa chạy. Xem nguyên nhân: journalctl -u neu-agent-oauth2 -n 30 --no-pager"; exit 1
fi
