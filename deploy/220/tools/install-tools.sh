#!/usr/bin/env bash
# Cài dịch vụ công cụ web của NEU Agent trên máy 220 (Ubuntu 24.04; cần python3, systemd, Docker): tìm kiếm web (SearXNG tự dựng) + tải trang an toàn.
#   sudo ./tools/install-tools.sh              cài/cập nhật
#   sudo ./tools/install-tools.sh --uninstall  gỡ dịch vụ + mã (giữ cấu hình ở /etc/neu-agent)
# THỨ TỰ: cài tệp này TRƯỚC, rồi cập nhật nginx (sudo ./install.sh) để mở /agent/tools/. Nginx chưa mở thì dịch vụ vẫn chỉ nghe 127.0.0.1, không ai gọi được.
# An toàn: kiểm thử trước khi cài, sao lưu, kiểm tra sau cài, tự khôi phục nếu lỗi; không đụng tới container/dịch vụ khác (sim-agent, watchtower…).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Dấu giữ chỗ @@SITE_…@@ phải đã được điền (CD điền khi đóng gói; tay: node deploy/render-site.mjs). Chưa điền thì dừng, chưa đụng gì tới máy.
if grep -rIlE '@@SITE_[A-Z0-9_]+@@' "$HERE" >/dev/null 2>&1; then
  echo "Chưa điền cấu hình site: còn dấu giữ chỗ @@SITE_…@@ trong $HERE. Chạy: node deploy/render-site.mjs <thư mục> --env site.env (xem docs/PUBLIC.md)."; exit 1
fi
LIB=/usr/local/lib/neu-agent-tools
UNITDIR=/etc/systemd/system
SVC_TOOLS=neu-agent-tools.service
SVC_SEARCH=neu-agent-search.service
ETC=/etc/neu-agent
SETTINGS=$ETC/searxng-settings.yml
USER_NAME=neu-tools
TS=$(date +%Y%m%d%H%M%S)
BAK=/var/backups/neu-agent-tools/$TS

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now "$SVC_TOOLS" "$SVC_SEARCH" 2>/dev/null || true
  docker rm -f neu-agent-search >/dev/null 2>&1 || true
  rm -f "$UNITDIR/$SVC_TOOLS" "$UNITDIR/$SVC_SEARCH"; rm -rf "$LIB"; systemctl daemon-reload
  echo "Đã gỡ dịch vụ công cụ web. Còn lại (xoá tay nếu muốn): $SETTINGS, người dùng $USER_NAME, ảnh Docker searxng. Nhớ cập nhật nginx (sudo ./install.sh)."
  exit 0
fi

command -v python3 >/dev/null && command -v systemctl >/dev/null && command -v docker >/dev/null || { echo "Thiếu python3, systemctl hoặc docker."; exit 1; }
for f in tools.py neu-agent-tools.service neu-agent-search.service searxng-settings.yml; do [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }; done
IMAGE=$(grep -o 'searxng/searxng@sha256:[0-9a-f]\{64\}' "$HERE/$SVC_SEARCH" | head -1)
[ -n "$IMAGE" ] || { echo "Không thấy ảnh SearXNG (ghim theo mã băm) trong $SVC_SEARCH"; exit 1; }

if [ -z "${NEU_TOOLS_SKIP_TESTS:-}" ] && ls "$HERE"/test_*.py >/dev/null 2>&1; then
  echo "Chạy kiểm thử…"
  (cd "$HERE" && python3 -m unittest discover -s . -p 'test_*.py' >/dev/null 2>"$HERE/.unittest.log") || { echo "Kiểm thử THẤT BẠI (xem $HERE/.unittest.log). Dừng."; exit 1; }
  rm -f "$HERE/.unittest.log"
fi

# ---- sao lưu để khôi phục
mkdir -p "$BAK"
declare -A EXISTED
for f in "$LIB/tools.py" "$UNITDIR/$SVC_TOOLS" "$UNITDIR/$SVC_SEARCH" "$SETTINGS"; do
  if [ -e "$f" ]; then EXISTED["$f"]=1; mkdir -p "$BAK$(dirname "$f")"; cp -a "$f" "$BAK$f"; else EXISTED["$f"]=0; fi
done
HAD_TOOLS=0; systemctl cat "$SVC_TOOLS" >/dev/null 2>&1 && HAD_TOOLS=1
HAD_SEARCH=0; systemctl cat "$SVC_SEARCH" >/dev/null 2>&1 && HAD_SEARCH=1
rollback() {
  echo "!! Có lỗi, đang khôi phục…"
  for f in "$LIB/tools.py" "$UNITDIR/$SVC_TOOLS" "$UNITDIR/$SVC_SEARCH" "$SETTINGS"; do
    if [ "${EXISTED[$f]}" = 1 ]; then mkdir -p "$(dirname "$f")"; cp -a "$BAK$f" "$f"; else rm -f "$f"; fi
  done
  systemctl daemon-reload || true
  if [ "$HAD_TOOLS" = 1 ]; then systemctl restart "$SVC_TOOLS" || true; else systemctl disable --now "$SVC_TOOLS" 2>/dev/null || true; fi
  if [ "$HAD_SEARCH" = 1 ]; then systemctl restart "$SVC_SEARCH" || true; else systemctl disable --now "$SVC_SEARCH" 2>/dev/null || true; docker rm -f neu-agent-search >/dev/null 2>&1 || true; fi
  echo "Đã khôi phục (bản sao lưu: $BAK)."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# ---- người dùng, cấu hình (giữ khoá bí mật cũ nếu có)
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
install -d -m 0750 -o root -g root "$ETC"
SECRET=""
[ -f "$SETTINGS" ] && SECRET=$(sed -n 's/^[[:space:]]*secret_key:[[:space:]]*"\([A-Za-z0-9]\{16,\}\)".*$/\1/p' "$SETTINGS" | head -1)
[ -n "$SECRET" ] || SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
sed "s/__SECRET__/$SECRET/" "$HERE/searxng-settings.yml" > "$SETTINGS.tmp"
# SearXNG chạy trong container với người dùng riêng: tệp cấu hình phải đọc được (không chứa thông tin nhạy cảm ngoài khoá phiên của chính nó)
chmod 0644 "$SETTINGS.tmp"; mv "$SETTINGS.tmp" "$SETTINGS"

# ---- ảnh Docker (ghim mã băm) + mã + dịch vụ
echo "Kéo ảnh SearXNG (có thể mất ít phút lần đầu)…"
docker pull -q "$IMAGE" >/dev/null
install -d -m 0755 "$LIB"
install -m 0644 -o root -g root "$HERE/tools.py" "$LIB/tools.py"
install -m 0644 -o root -g root "$HERE/$SVC_SEARCH" "$UNITDIR/$SVC_SEARCH"
install -m 0644 -o root -g root "$HERE/$SVC_TOOLS" "$UNITDIR/$SVC_TOOLS"
command -v systemd-analyze >/dev/null && { systemd-analyze verify "$UNITDIR/$SVC_TOOLS" "$UNITDIR/$SVC_SEARCH" 2>&1 | grep -v '^$' | sed 's/^/  [systemd-analyze] /' || true; }
systemctl daemon-reload
systemctl enable "$SVC_SEARCH" "$SVC_TOOLS" >/dev/null 2>&1
systemctl restart "$SVC_SEARCH"
for i in $(seq 1 40); do curl -sf --max-time 3 'http://127.0.0.1:8899/search?q=test&format=json' >/dev/null 2>&1 && break; sleep 2; done
curl -sf --max-time 5 'http://127.0.0.1:8899/search?q=test&format=json' >/dev/null 2>&1 || { journalctl -u neu-agent-search -n 20 --no-pager 2>/dev/null || true; echo "Máy tìm kiếm không chạy."; exit 1; }
systemctl restart "$SVC_TOOLS"
sleep 1
systemctl is-active --quiet "$SVC_TOOLS" || { journalctl -u neu-agent-tools -n 20 --no-pager 2>/dev/null || true; echo "Dịch vụ công cụ web không chạy."; exit 1; }

# ---- kiểm tra sau cài (cục bộ)
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$@"; }
c_health=$(curl -s --max-time 5 http://127.0.0.1:4192/healthz || true)
c_noid=$(code 'http://127.0.0.1:4192/tools/search?q=neu' || true)                                                                   # thiếu danh tính: 401
c_search=$(curl -s --max-time 30 -H 'X-User-Email: install-check@st.neu.edu.vn' 'http://127.0.0.1:4192/tools/search?q=Dai+hoc+Kinh+te+Quoc+dan&n=3' || true)
c_ssrf=$(code -H 'X-User-Email: install-check@st.neu.edu.vn' 'http://127.0.0.1:4192/tools/fetch?url=http%3A%2F%2F127.0.0.1%3A4191%2Fhealthz' || true)   # địa chỉ nội bộ: 400
c_ssrf2=$(code -H 'X-User-Email: install-check@st.neu.edu.vn' 'http://127.0.0.1:4192/tools/fetch?url=http%3A%2F%2F@@SITE_GATEWAY_IP@@%3A8037%2F' || true)
c_fetch=$(curl -s --max-time 30 -H 'X-User-Email: install-check@st.neu.edu.vn' 'http://127.0.0.1:4192/tools/fetch?url=https%3A%2F%2Fexample.com%2F&max_chars=500' || true)
echo "Kiểm tra: healthz=${c_health:0:40} | thiếu danh tính=$c_noid(401) | nội bộ=$c_ssrf/$c_ssrf2(400/400)"
echo "          tìm kiếm: $(echo "$c_search" | head -1 | cut -c1-90)"
echo "          tải trang: $(echo "$c_fetch" | sed -n 1,2p | tr '\n' ' ' | cut -c1-90)"
[[ "$c_health" == '{"ok": true'* ]] && [ "$c_noid" = 401 ] && [ "$c_ssrf" = 400 ] && [ "$c_ssrf2" = 400 ] || { echo "Kiểm tra an toàn sau cài THẤT BẠI"; exit 1; }
[[ "$c_search" == "Kết quả tìm kiếm"* ]] || { echo "Tìm kiếm không trả kết quả (máy chủ có ra Internet được không?)"; exit 1; }
[[ "$c_fetch" == "Nguồn: https://example.com/"* ]] || echo "CẢNH BÁO: tải thử example.com không thành công (kiểm tra đường ra Internet của máy chủ)."

trap - EXIT
echo "OK: công cụ web đã chạy (tìm kiếm 127.0.0.1:8899, dịch vụ 127.0.0.1:4192)."
echo "Tiếp theo: mở /agent/tools/ ở nginx:  sudo ./install.sh   (rồi bản web/Desktop có gói 'tim-kiem-web' sẽ có công cụ web_search, fetch_page)"
