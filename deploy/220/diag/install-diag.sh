#!/usr/bin/env bash
# Cài hệ thống tự chẩn đoán + báo cáo chất lượng + kiểm tra sức khoẻ của NEU Agent trên máy 220 (Ubuntu 24.04, cần python3, systemd).
# Chạy bằng sudo, trong thư mục deploy/220 (hoặc bất kỳ đâu: script tự tìm các tệp cạnh nó). Chạy lại bất kỳ lúc nào để cập nhật (idempotent).
#
# THỨ TỰ CÀI (lần đầu):
#   1) sudo ./auth/install-auth.sh                      đăng nhập SSO (oauth2-proxy)
#   2) sudo ./install.sh <key mô hình>                  nginx — ĐÃ GỒM /agent/diag, /agent/admin/, /agent/healthz và nhật ký JSON
#                                                       (chưa cài bước 3 thì các route này trả 502/503, vô hại)
#   3) sudo ./diag/install-diag.sh --admin a@neu.edu.vn [--admin b@neu.edu.vn]
# Sau đó mỗi lần cập nhật nginx (install.sh) hay mã chẩn đoán chỉ cần chạy lại lệnh tương ứng.
#
#   sudo ./diag/install-diag.sh [--admin email]...      cài/cập nhật (thêm quản trị viên vào /etc/neu-agent/admins.txt)
#   sudo ./diag/install-diag.sh --uninstall             gỡ dịch vụ + mã (GIỮ dữ liệu /var/lib/neu-agent, bí mật và danh sách quản trị)
#   NEU_DIAG_SKIP_TESTS=1 ...                            bỏ qua bộ kiểm thử trước khi cài (không khuyến nghị)
#
# Bản nháp gợi ý bằng mô hình cho báo cáo (tuỳ chọn): đặt key mô hình vào /etc/neu-agent/llm-key (quyền 600) rồi chạy lại script này.
# An toàn: sao lưu tệp cũ, kiểm tra sau cài, tự khôi phục nếu lỗi; không đụng tới site/cấu hình nginx khác.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/neu-agent-diag
UNITDIR=/etc/systemd/system
LROT=/etc/logrotate.d/neu-agent-diag
ETC=/etc/neu-agent
SECRET=$ETC/diag-secret
ADMINS=$ETC/admins.txt
LLMKEY=$ETC/llm-key
DROPIN_DIR=$UNITDIR/neu-agent-diag-report.service.d
VAR=/var/lib/neu-agent
USER_NAME=neu-diag
SNIP=/etc/nginx/snippets/neu-agent-locations.conf
TS=$(date +%Y%m%d%H%M%S)
BAK=/var/backups/neu-agent-diag/$TS
SERVICES="neu-agent-diag.service neu-agent-accounts.service"
TIMERS="neu-agent-diag-report.timer neu-agent-healthz.timer neu-agent-diag-stats.timer"
UNITS="neu-agent-diag.service neu-agent-accounts.service neu-agent-diag-report.service neu-agent-diag-report.timer neu-agent-healthz.service neu-agent-healthz.timer neu-agent-diag-stats.service neu-agent-diag-stats.timer"
CODE="collector.py report.py stats.py charts.py pages.py healthz.py schema.json accounts.py accounts.html accounts.js quota_admin.py quota.html quota.js feedback.py feedback.html feedback.js shares.py shares.html shares.js"

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v python3 >/dev/null && command -v systemctl >/dev/null || { echo "Thiếu python3 hoặc systemctl."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  for t in $TIMERS; do systemctl disable --now "$t" 2>/dev/null || true; done
  for s in $SERVICES; do systemctl disable --now "$s" 2>/dev/null || true; done
  for u in $UNITS; do rm -f "$UNITDIR/$u"; done
  rm -rf "$DROPIN_DIR" "$LIB" "$LROT"; systemctl daemon-reload
  echo "Đã gỡ dịch vụ chẩn đoán. Còn lại (xoá tay nếu muốn): $VAR, $ETC/diag-secret, $ETC/admins.txt, người dùng $USER_NAME."
  exit 0
fi

# ---- tham số
ADMIN_LIST=()
while [ $# -gt 0 ]; do
  case "$1" in
    --admin) [ -n "${2:-}" ] || { echo "--admin cần email hoặc tên đăng nhập."; exit 1; }; ADMIN_LIST+=("$2"); shift 2;;
    *) echo "Tham số lạ: $1"; exit 1;;
  esac
done
if [ -n "${NEU_DIAG_ADMINS:-}" ]; then IFS=',' read -r -a _extra <<< "$NEU_DIAG_ADMINS"; ADMIN_LIST+=("${_extra[@]}"); fi
for a in "${ADMIN_LIST[@]:-}"; do
  [ -z "$a" ] && continue
  [[ "$a" =~ ^[A-Za-z0-9._%+\'-]{1,64}@[A-Za-z0-9.-]{1,190}$ || "$a" =~ ^[a-z0-9][a-z0-9._-]{2,31}$ ]] || { echo "Quản trị không hợp lệ (email, hoặc tên đăng nhập chữ thường của tài khoản mật khẩu): $a"; exit 1; }
done

[ -f "$HERE/../users.sh" ] || { echo "Thiếu $HERE/../users.sh (quản lý tài khoản dùng nó)."; exit 1; }
for f in $CODE neu-agent-diag.service neu-agent-accounts.service neu-agent-diag-report.service neu-agent-diag-report.timer neu-agent-healthz.service neu-agent-healthz.timer neu-agent-diag-stats.service neu-agent-diag-stats.timer neu-agent-diag.logrotate; do
  [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }
done

# ---- kiểm thử trước khi cài (nhanh, không chạm vào hệ thống)
if [ -z "${NEU_DIAG_SKIP_TESTS:-}" ] && ls "$HERE"/test_*.py >/dev/null 2>&1; then
  echo "Chạy kiểm thử…"
  (cd "$HERE" && python3 -m unittest discover -s . -p 'test_*.py' >/dev/null 2>"$HERE/.unittest.log") || { echo "Kiểm thử THẤT BẠI (xem $HERE/.unittest.log). Dừng."; exit 1; }
  rm -f "$HERE/.unittest.log"
fi

# ---- sao lưu để khôi phục
MANAGED=()
for c in $CODE; do MANAGED+=("$LIB/$c"); done
for u in $UNITS; do MANAGED+=("$UNITDIR/$u"); done
MANAGED+=("$LROT" "$DROPIN_DIR/llm.conf" "$LIB/users.sh")
mkdir -p "$BAK"
declare -A EXISTED
for f in "${MANAGED[@]}"; do
  if [ -e "$f" ]; then EXISTED["$f"]=1; mkdir -p "$BAK$(dirname "$f")"; cp -a "$f" "$BAK$f"; else EXISTED["$f"]=0; fi
done
HAD_SERVICE=0; systemctl cat neu-agent-diag.service >/dev/null 2>&1 && HAD_SERVICE=1
HAD_ACCOUNTS=0; systemctl cat neu-agent-accounts.service >/dev/null 2>&1 && HAD_ACCOUNTS=1

rollback() {
  echo "!! Có lỗi, đang khôi phục…"
  [ "$HAD_ACCOUNTS" = 1 ] || systemctl disable --now neu-agent-accounts.service 2>/dev/null || true   # dịch vụ phụ mới cài: dừng TRƯỚC khi xoá tệp đơn vị (nếu không tiến trình mồ côi vẫn chạy)
  for f in "${MANAGED[@]}"; do
    if [ "${EXISTED[$f]}" = 1 ]; then mkdir -p "$(dirname "$f")"; cp -a "$BAK$f" "$f"; else rm -f "$f"; fi
  done
  systemctl daemon-reload || true
  if [ "$HAD_SERVICE" = 1 ]; then systemctl restart neu-agent-diag.service || true
  else
    for t in $TIMERS; do systemctl disable --now "$t" 2>/dev/null || true; done
    systemctl disable --now neu-agent-diag.service 2>/dev/null || true
  fi
  echo "Đã khôi phục (bản sao lưu: $BAK)."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# ---- 1) người dùng hệ thống, thư mục, bí mật, danh sách quản trị
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$USER_NAME"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$VAR"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$VAR/diag"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$VAR/reports"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$VAR/feedback"   # góp ý của người dùng (SQLite)
install -d -m 0750 -o root -g root "$ETC"
if [ ! -s "$SECRET" ]; then
  # KHÔNG ghi đè nếu đã có: đổi bí mật làm mã người dùng giả danh cũ không còn khớp
  (umask 077; python3 -c 'import secrets; print(secrets.token_hex(32))' > "$SECRET"); chmod 600 "$SECRET"
  echo "Đã tạo bí mật HMAC mới ($SECRET). Giữ nguyên tệp này khi cài lại để số liệu theo người dùng liên tục."
fi
if [ ! -f "$ADMINS" ]; then (umask 027; printf '# Quản trị viên được xem /agent/admin/ (mỗi dòng một email, hoặc tên đăng nhập của tài khoản mật khẩu). Sau khi sửa: sudo systemctl restart neu-agent-diag\n' > "$ADMINS"); fi
chmod 640 "$ADMINS"
for a in "${ADMIN_LIST[@]:-}"; do
  [ -z "$a" ] && continue
  l=$(printf '%s' "$a" | tr 'A-Z' 'a-z')
  grep -qixF "$l" "$ADMINS" || echo "$l" >> "$ADMINS"
done
grep -qE '^[^#[:space:]]' "$ADMINS" || echo "Lưu ý: chưa có quản trị viên nào trong $ADMINS — trang /agent/admin/ sẽ từ chối tất cả. Chạy lại với --admin email."

# ---- 2) mã, dịch vụ, logrotate
install -d -m 0755 "$LIB"
for c in $CODE; do install -m 0644 -o root -g root "$HERE/$c" "$LIB/$c"; done
install -m 0755 -o root -g root "$HERE/../users.sh" "$LIB/users.sh"   # dịch vụ phụ (root) gọi đúng bản này để ghi tệp mật khẩu
for u in $UNITS; do install -m 0644 -o root -g root "$HERE/$u" "$UNITDIR/$u"; done
install -m 0644 -o root -g root "$HERE/neu-agent-diag.logrotate" "$LROT"
if [ -s "$LLMKEY" ]; then
  chmod 600 "$LLMKEY"
  mkdir -p "$DROPIN_DIR"
  cat > "$DROPIN_DIR/llm.conf" <<EOT
# Tạo bởi install-diag.sh vì có $LLMKEY: báo cáo hằng ngày nhờ mô hình nháp gợi ý (chỉ gửi số liệu tổng hợp tới cổng mô hình).
[Service]
LoadCredential=llm-key:$LLMKEY
PrivateNetwork=no
IPAddressDeny=any
IPAddressAllow=192.0.2.10
ExecStart=
ExecStart=/usr/bin/python3 $LIB/report.py --llm
EOT
else
  rm -f "$DROPIN_DIR/llm.conf"; rmdir "$DROPIN_DIR" 2>/dev/null || true
fi
if command -v systemd-analyze >/dev/null; then
  for u in $UNITS; do systemd-analyze verify "$UNITDIR/$u" 2>&1 | grep -v '^$' | sed "s/^/  [systemd-analyze] /" || true; done   # chỉ cảnh báo; khởi động dịch vụ bên dưới mới là phép thử thật
fi
systemctl daemon-reload
systemctl enable $SERVICES $TIMERS >/dev/null 2>&1
systemctl restart neu-agent-accounts.service
systemctl restart neu-agent-diag.service
sleep 1
systemctl is-active --quiet neu-agent-diag.service || { journalctl -u neu-agent-diag -n 20 --no-pager 2>/dev/null || true; echo "Bộ thu không chạy."; exit 1; }
systemctl is-active --quiet neu-agent-accounts.service || { journalctl -u neu-agent-accounts -n 20 --no-pager 2>/dev/null || true; echo "Dịch vụ quản lý tài khoản không chạy."; exit 1; }
systemctl start $TIMERS

# ---- 3) kiểm tra sau cài
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@"; }
c_health=$(curl -s --max-time 5 http://127.0.0.1:4190/healthz || true)
c_bad=$(code -X POST -H 'X-User-Email: install-check@neu.edu.vn' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:4190/diag || true)   # thân sai lược đồ: phải 400 và KHÔNG ghi gì
c_noid=$(code -X POST -d '{}' http://127.0.0.1:4190/diag || true)                                                                              # thiếu danh tính: 401
c_admin=$(code http://127.0.0.1:4190/admin/ || true)                                                                                           # không phải quản trị viên: 403
systemctl start neu-agent-healthz.service 2>/dev/null || true       # tạo health.json (có thể báo lỗi nếu oauth2/cổng mô hình đang lỗi; không chặn cài)
rep_ok=1; systemctl start neu-agent-diag-report.service || rep_ok=0 # báo cáo đầu tiên (trống) để trang quản trị có nội dung
[ -s "$VAR/reports/latest.html" ] || rep_ok=0
systemctl start neu-agent-diag-stats.service || rep_ok=0            # trang tổng quan quản trị (index.html)
[ -s "$VAR/reports/index.html" ] || rep_ok=0
# quản lý tài khoản: qua socket (chính root được phép) — danh sách, rồi tạo + xoá một tài khoản thử để chắc việc ghi tệp và khởi động lại dịch vụ đăng nhập chạy được trong sandbox
acc_rpc() { python3 - "$1" <<'PY'
import json, socket, sys
s = socket.socket(socket.AF_UNIX); s.settimeout(60); s.connect("/run/neu-agent-accounts/accounts.sock")
s.sendall(sys.argv[1].encode() + b"\n"); b = b""
while not b.endswith(b"\n"):
    c = s.recv(4096)
    if not c: break
    b += c
print(json.loads(b).get("ok"))
PY
}
a_list=$(acc_rpc '{"op":"list"}' 2>/dev/null || echo err)
a_add=$(acc_rpc '{"op":"add","name":"zz-kiem-tra-cai","password":"Kiem-tra-cai-dat-9X!","actor":"install@local"}' 2>/dev/null || echo err)
a_del=$(acc_rpc '{"op":"remove","name":"zz-kiem-tra-cai","actor":"install@local"}' 2>/dev/null || echo err)
first_admin=$(grep -m1 -E '^[^#[:space:]]' "$ADMINS" 2>/dev/null || true)
c_api=skip; [ -n "$first_admin" ] && c_api=$(code -H "X-User-Email: $first_admin" http://127.0.0.1:4190/admin/api/accounts || true)   # quản trị viên qua collector: 200
c_apinon=$(code http://127.0.0.1:4190/admin/api/accounts || true)                                                                         # không phải quản trị viên: 403
# thử tạo/xoá ở trên khởi động lại dịch vụ đăng nhập: đợi nó chạy lại hẳn rồi mới kiểm tra qua nginx (nếu không sẽ thấy 500 giả)
for _i in $(seq 1 90); do curl -fs -o /dev/null http://127.0.0.1:4180/ping && break; sleep 1; done
echo "Tài khoản: dịch vụ phụ list=$a_list add=$a_add remove=$a_del | API quản trị=$c_api(200) | API khi không phải quản trị=$c_apinon(403)"
[ "$a_list" = True ] && [ "$a_add" = True ] && [ "$a_del" = True ] && [ "$c_apinon" = 403 ] && { [ "$c_api" = skip ] || [ "$c_api" = 200 ]; } || { echo "Kiểm tra quản lý tài khoản THẤT BẠI (xem: journalctl -u neu-agent-accounts)"; exit 1; }
echo "Kiểm tra: bộ thu=$c_health | POST sai lược đồ=$c_bad(400) | thiếu danh tính=$c_noid(401) | admin khi chưa đăng nhập=$c_admin(403) | báo cáo=$([ $rep_ok = 1 ] && echo ok || echo LỖI)"
[ "$c_health" = '{"ok":true}' ] && [ "$c_bad" = 400 ] && [ "$c_noid" = 401 ] && [ "$c_admin" = 403 ] && [ $rep_ok = 1 ] || { echo "Kiểm tra sau cài THẤT BẠI"; exit 1; }

# nếu nginx đã có các route mới: kiểm tra qua nginx (không cần đăng nhập thật)
if [ -f "$SNIP" ] && grep -q 'location = /agent/diag' "$SNIP"; then
  H="Host: ai.neu.edu.vn"
  n_diag=$(code -X POST -H "$H" -d '{}' http://127.0.0.1/agent/diag || true)           # chưa đăng nhập: 401 JSON
  n_hz=$(curl -s --max-time 5 -H "$H" http://127.0.0.1/agent/healthz || true)
  n_adm=$(code -H "$H" http://127.0.0.1/agent/admin/ || true)                          # chưa đăng nhập: 302 tới đăng nhập
  echo "nginx: /agent/diag=$n_diag(401) | /agent/healthz=$n_hz | /agent/admin/=$n_adm(302)"
  { [ "$n_diag" = 401 ] && [ "$n_adm" = 302 ] && [[ "$n_hz" == '{"ok":'* ]]; } || { echo "Kiểm tra qua nginx THẤT BẠI (đã chạy sudo ./install.sh <key> với bản cấu hình mới chưa?)"; exit 1; }
else
  echo "Lưu ý: nginx chưa có route chẩn đoán. Chạy: sudo ./install.sh <key mô hình> (bản cấu hình mới đã gồm /agent/diag, /agent/admin/, /agent/healthz)."
fi

trap - EXIT
echo "OK: chẩn đoán đã chạy. Báo cáo: https://ai.neu.edu.vn/agent/admin/ (quản trị viên); quản lý tài khoản: https://ai.neu.edu.vn/agent/admin/accounts hoặc $VAR/reports/latest.html trên máy. Nhật ký sức khoẻ: /var/log/neu-agent/health.log"
echo "Xem lịch: systemctl list-timers 'neu-agent-*' | Chạy báo cáo ngay: sudo systemctl start neu-agent-diag-report.service"
