#!/usr/bin/env bash
# Cài cổng hạn mức token theo người dùng của NEU Agent trên máy 220 (Ubuntu 24.04, cần python3, systemd). Chạy bằng sudo; chạy lại bất kỳ lúc nào để cập nhật.
#   sudo ./quota/install-quota.sh              cài/cập nhật dịch vụ (KHÔNG ghi đè /etc/neu-agent/quota.json nếu đã có)
#   sudo ./quota/install-quota.sh --uninstall  gỡ dịch vụ + mã (giữ dữ liệu và cấu hình)
# THỨ TỰ: cài tệp này TRƯỚC, rồi mới cập nhật nginx (sudo ./install.sh <key>) để nginx chuyển yêu cầu chat qua cổng này. Nếu cổng chết, nginx tự chuyển thẳng tới Kong
# (người dùng vẫn dùng được, chỉ tạm không có hạn mức) và trang quản trị/healthz báo lỗi "quota".
# An toàn: kiểm thử trước khi cài, sao lưu, kiểm tra sau cài, tự khôi phục nếu lỗi; không đụng tới dịch vụ khác.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/neu-agent-quota
UNITDIR=/etc/systemd/system
UNIT=neu-agent-quota.service
ETC=/etc/neu-agent
CONF=$ETC/quota.json
VAR=/var/lib/neu-agent/quota
USER_NAME=neu-diag
TS=$(date +%Y%m%d%H%M%S)
BAK=/var/backups/neu-agent-quota/$TS

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v python3 >/dev/null && command -v systemctl >/dev/null || { echo "Thiếu python3 hoặc systemctl."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNITDIR/$UNIT"; rm -rf "$LIB"; systemctl daemon-reload
  echo "Đã gỡ cổng hạn mức. Còn lại (xoá tay nếu muốn): $VAR, $CONF. Nhớ cập nhật nginx về bản không có cổng này (sudo ./install.sh <key>)."
  exit 0
fi

for f in quota.py neu-agent-quota.service quota.default.json; do [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }; done
[ -s "$ETC/diag-secret" ] || { echo "Chưa có $ETC/diag-secret: chạy ./diag/install-diag.sh trước."; exit 1; }
id -u "$USER_NAME" >/dev/null 2>&1 || { echo "Chưa có người dùng $USER_NAME: chạy ./diag/install-diag.sh trước."; exit 1; }

if [ -z "${NEU_QUOTA_SKIP_TESTS:-}" ] && ls "$HERE"/test_*.py >/dev/null 2>&1; then
  echo "Chạy kiểm thử…"
  (cd "$HERE" && python3 -m unittest discover -s . -p 'test_*.py' >/dev/null 2>"$HERE/.unittest.log") || { echo "Kiểm thử THẤT BẠI (xem $HERE/.unittest.log). Dừng."; exit 1; }
  rm -f "$HERE/.unittest.log"
fi

# ---- sao lưu để khôi phục
mkdir -p "$BAK"
declare -A EXISTED
for f in "$LIB/quota.py" "$UNITDIR/$UNIT"; do
  if [ -e "$f" ]; then EXISTED["$f"]=1; mkdir -p "$BAK$(dirname "$f")"; cp -a "$f" "$BAK$f"; else EXISTED["$f"]=0; fi
done
HAD_SERVICE=0; systemctl cat "$UNIT" >/dev/null 2>&1 && HAD_SERVICE=1
rollback() {
  echo "!! Có lỗi, đang khôi phục…"
  for f in "$LIB/quota.py" "$UNITDIR/$UNIT"; do
    if [ "${EXISTED[$f]}" = 1 ]; then mkdir -p "$(dirname "$f")"; cp -a "$BAK$f" "$f"; else rm -f "$f"; fi
  done
  systemctl daemon-reload || true
  if [ "$HAD_SERVICE" = 1 ]; then systemctl restart "$UNIT" || true; else systemctl disable --now "$UNIT" 2>/dev/null || true; fi
  echo "Đã khôi phục (bản sao lưu: $BAK)."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# ---- thư mục dữ liệu, cấu hình mặc định (không ghi đè)
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" /var/lib/neu-agent "$VAR"
install -d -m 0750 -o root -g root "$ETC"
if [ ! -f "$CONF" ]; then install -m 0640 -o root -g root "$HERE/quota.default.json" "$CONF"; echo "Đã tạo cấu hình mặc định $CONF (sinh viên 1.000.000, giảng viên 10.000.000 token/ngày)."; fi
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CONF" || { echo "$CONF không phải JSON hợp lệ."; exit 1; }

# ---- mã + dịch vụ
install -d -m 0755 "$LIB"
install -m 0644 -o root -g root "$HERE/quota.py" "$LIB/quota.py"
install -m 0644 -o root -g root "$HERE/neu-agent-quota.service" "$UNITDIR/$UNIT"
command -v systemd-analyze >/dev/null && { systemd-analyze verify "$UNITDIR/$UNIT" 2>&1 | grep -v '^$' | sed 's/^/  [systemd-analyze] /' || true; }
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
systemctl restart "$UNIT"
sleep 1
systemctl is-active --quiet "$UNIT" || { journalctl -u neu-agent-quota -n 20 --no-pager 2>/dev/null || true; echo "Cổng hạn mức không chạy."; exit 1; }

# ---- kiểm tra sau cài (cục bộ, không cần đăng nhập thật)
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@"; }
c_health=$(curl -s --max-time 5 http://127.0.0.1:4191/healthz || true)
c_noid=$(code -X POST -H 'Content-Type: application/json' -d '{"model":"x"}' http://127.0.0.1:4191/vllm/v1/chat/completions || true)     # thiếu danh tính: 401
c_quota=$(curl -s --max-time 5 -H 'X-User-Email: install-check@st.neu.edu.vn' http://127.0.0.1:4191/quota || true)
echo "Kiểm tra: healthz=$c_health | thiếu danh tính=$c_noid(401) | /quota=${c_quota:0:90}"
[[ "$c_health" == '{"ok":true'* ]] && [ "$c_noid" = 401 ] && [[ "$c_quota" == *'"state":"ok"'* ]] || { echo "Kiểm tra sau cài THẤT BẠI"; exit 1; }

trap - EXIT
echo "OK: cổng hạn mức đã chạy ở 127.0.0.1:4191. Xem/đổi hạn mức: sudo $HERE/quota.sh show | set | tier | mode"
echo "Tiếp theo: cập nhật nginx để chuyển yêu cầu chat qua cổng này:  sudo ./install.sh <key mô hình>"
