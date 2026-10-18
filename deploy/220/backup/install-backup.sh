#!/usr/bin/env bash
# Cài sao lưu dữ liệu hằng đêm của NEU Agent trên máy 220 (Ubuntu 24.04, cần python3, systemd; age hoặc gpg). Chạy bằng sudo; chạy lại bất kỳ lúc nào.
#   sudo ./backup/install-backup.sh --recipient 'age1…'            khai khoá CÔNG KHAI age (lặp lại được; hoặc 'ssh-ed25519 AAAA…')
#   sudo ./backup/install-backup.sh --gpg-key quan-tri.asc         hoặc khoá công khai gpg (gpg --armor --export <khoá>)
#   sudo ./backup/install-backup.sh --keep 30                      số bản giữ trên máy (mặc định 14)
#   sudo ./backup/install-backup.sh --remote bk@may-khac:/srv/neu-agent [--remote-port 22]   đẩy thêm sang máy khác (rsync/SSH)
#   sudo ./backup/install-backup.sh --no-remote                    thôi đẩy sang máy khác
#   sudo ./backup/install-backup.sh --uninstall                    gỡ lịch + mã (GIỮ các bản sao lưu và cấu hình)
# Dữ liệu sao lưu: góp ý + chia sẻ, CSDL hạn mức + grants.json, sổ "ai đã dùng", tệp mật khẩu tài khoản, diag-secret, admins.txt, quota.json,
# nhật ký thao tác tài khoản. Bản sao lưu ở /var/backups/neu-agent-data (chỉ root), mã hoá; KHÔNG để khoá riêng trên máy này.
# Dùng: sudo neu-agent-backup run | list | verify <tệp> --identity <khoá riêng> | restore <tệp> --identity <khoá riêng> [--only …] --yes
# An toàn: kiểm thử trước khi cài, sao lưu tệp cũ, kiểm tra sau cài (chạy thật một lần), tự khôi phục nếu lỗi; không đụng dịch vụ khác.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if grep -rIlE '@@SITE_[A-Z0-9_]+@@' "$HERE" >/dev/null 2>&1; then
  echo "Chưa điền cấu hình site: còn dấu giữ chỗ @@SITE_…@@ trong $HERE. Chạy: node deploy/render-site.mjs <thư mục> --env site.env (xem docs/PUBLIC.md)."; exit 1
fi
LIB=/usr/local/lib/neu-agent-backup
BIN=/usr/local/sbin/neu-agent-backup
UNITDIR=/etc/systemd/system
SVC=neu-agent-backup.service
TIMER=neu-agent-backup.timer
DROPIN=$UNITDIR/$SVC.d
ETC=/etc/neu-agent
CONF=$ETC/backup.conf
AGE_R=$ETC/backup-recipients.txt
GPG_K=$ETC/backup-recipient.asc
SSH_K=$ETC/backup-ssh-key
KNOWN=$ETC/backup-known_hosts
OUT=/var/backups/neu-agent-data
TS=$(date +%Y%m%d%H%M%S)
BAK=/var/backups/neu-agent-backup/$TS

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v python3 >/dev/null && command -v systemctl >/dev/null || { echo "Thiếu python3 hoặc systemctl."; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now "$TIMER" 2>/dev/null || true
  rm -f "$UNITDIR/$SVC" "$UNITDIR/$TIMER" "$BIN"; rm -rf "$DROPIN" "$LIB"; systemctl daemon-reload
  echo "Đã gỡ lịch sao lưu. Còn lại (xoá tay nếu muốn): $OUT (các bản sao lưu), $CONF, khoá công khai và khoá SSH sao lưu ở $ETC."
  exit 0
fi

# ---- tham số (kiểm tra hết TRƯỚC khi đụng vào máy)
RECIPIENTS=(); GPG_FILE=""; KEEP=""; REMOTE=""; REMOTE_PORT=""; NO_REMOTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --recipient) [ -n "${2:-}" ] || { echo "--recipient cần khoá công khai."; exit 1; }; RECIPIENTS+=("$2"); shift 2;;
    --gpg-key) [ -f "${2:-}" ] || { echo "--gpg-key cần tệp khoá công khai gpg."; exit 1; }; GPG_FILE="$2"; shift 2;;
    --keep) [[ "${2:-}" =~ ^[0-9]{1,3}$ ]] && [ "$2" -ge 1 ] && [ "$2" -le 365 ] || { echo "--keep cần số 1–365."; exit 1; }; KEEP="$2"; shift 2;;
    --remote) [[ "${2:-}" =~ ^[a-z_][a-z0-9_.-]{0,31}@[A-Za-z0-9][A-Za-z0-9.-]{0,252}:[A-Za-z0-9._/-]{0,200}$ ]] || { echo "--remote phải dạng người_dùng@máy:thư/mục"; exit 1; }; REMOTE="$2"; shift 2;;
    --remote-port) [[ "${2:-}" =~ ^[0-9]{1,5}$ ]] && [ "$2" -ge 1 ] && [ "$2" -le 65535 ] || { echo "--remote-port không hợp lệ."; exit 1; }; REMOTE_PORT="$2"; shift 2;;
    --no-remote) NO_REMOTE=1; shift;;
    *) echo "Tham số lạ: $1"; exit 1;;
  esac
done
for k in "${RECIPIENTS[@]:-}"; do
  [ -z "$k" ] && continue
  case "$k" in *AGE-SECRET-KEY*|*PRIVATE*) echo "Đó là KHOÁ RIÊNG. Chỉ đưa khoá CÔNG KHAI (age1… hoặc ssh-ed25519 …) lên máy chủ."; exit 1;; esac
  [[ "$k" =~ ^age1[0-9a-z]{58}$ || "$k" =~ ^(ssh-ed25519|ssh-rsa)\ AAAA[0-9A-Za-z+/]+=*(\ [^[:space:]]+)?$ ]] || { echo "Không phải khoá công khai age/ssh: ${k:0:20}…"; exit 1; }
done
if [ -n "$GPG_FILE" ]; then
  grep -q 'PRIVATE KEY' "$GPG_FILE" && { echo "$GPG_FILE chứa KHOÁ RIÊNG. Chỉ đưa khoá CÔNG KHAI lên máy chủ."; exit 1; }
  grep -q -- '-----BEGIN PGP PUBLIC KEY BLOCK-----' "$GPG_FILE" || { echo "$GPG_FILE không phải khoá công khai gpg dạng ASCII."; exit 1; }
  [ "${#RECIPIENTS[@]}" -eq 0 ] || { echo "Chọn MỘT loại: --recipient (age) hoặc --gpg-key."; exit 1; }
fi
[ -n "$REMOTE" ] && [ "$NO_REMOTE" = 1 ] && { echo "--remote và --no-remote không dùng cùng nhau."; exit 1; }
for f in backup.py neu-agent-backup.service neu-agent-backup.timer backup.default.conf; do [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }; done

if [ -z "${NEU_BACKUP_SKIP_TESTS:-}" ] && ls "$HERE"/test_*.py >/dev/null 2>&1; then
  echo "Chạy kiểm thử…"
  (cd "$HERE" && python3 -m unittest discover -s . -p 'test_*.py' >/dev/null 2>"$HERE/.unittest.log") || { echo "Kiểm thử THẤT BẠI (xem $HERE/.unittest.log). Dừng."; exit 1; }
  rm -f "$HERE/.unittest.log"
fi

# ---- sao lưu để khôi phục
MANAGED=("$LIB/backup.py" "$BIN" "$UNITDIR/$SVC" "$UNITDIR/$TIMER" "$DROPIN/remote.conf" "$CONF" "$AGE_R" "$GPG_K" "$SSH_K" "$SSH_K.pub" "$KNOWN")
mkdir -p "$BAK"; chmod 700 "$BAK"
declare -A EXISTED
for f in "${MANAGED[@]}"; do
  if [ -e "$f" ]; then EXISTED["$f"]=1; mkdir -p "$BAK$(dirname "$f")"; cp -a "$f" "$BAK$f"; else EXISTED["$f"]=0; fi
done
HAD_TIMER=0; systemctl is-enabled --quiet "$TIMER" 2>/dev/null && HAD_TIMER=1
rollback() {
  echo "!! Có lỗi, đang khôi phục…"
  for f in "${MANAGED[@]}"; do
    if [ "${EXISTED[$f]}" = 1 ]; then mkdir -p "$(dirname "$f")"; cp -a "$BAK$f" "$f"; else rm -f "$f"; fi
  done
  rmdir "$DROPIN" 2>/dev/null || true
  systemctl daemon-reload || true
  if [ "$HAD_TIMER" = 1 ]; then systemctl enable --now "$TIMER" >/dev/null 2>&1 || true; else systemctl disable --now "$TIMER" 2>/dev/null || true; fi
  echo "Đã khôi phục (bản sao lưu cấu hình: $BAK)."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# ---- mã + lệnh
install -d -m 0755 "$LIB"
install -m 0644 -o root -g root "$HERE/backup.py" "$LIB/backup.py"
printf '#!/bin/sh\n# Tạo bởi install-backup.sh\nexec /usr/bin/python3 %s/backup.py "$@"\n' "$LIB" > "$BIN"; chmod 0755 "$BIN"
install -d -m 0700 -o root -g root "$OUT"
install -d -m 0750 -o root -g root "$ETC"

# ---- cấu hình (không ghi đè phần quản trị đã đặt, chỉ đổi đúng mục được truyền vào)
[ -f "$CONF" ] || install -m 0640 -o root -g root "$HERE/backup.default.conf" "$CONF"
set_conf() { python3 - "$CONF" "$1" "$2" <<'PY'
import re, sys
path, key, val = sys.argv[1:]
lines = open(path, encoding="utf-8").read().splitlines()
out, done = [], False
for ln in lines:
    if re.match(r"^\s*%s=" % key, ln):
        if not done:
            out.append("%s=%s" % (key, val)); done = True
        continue
    out.append(ln)
if not done:
    out.append("%s=%s" % (key, val))
open(path + ".tmp", "w", encoding="utf-8").write("\n".join(out) + "\n")
import os; os.chmod(path + ".tmp", 0o640); os.replace(path + ".tmp", path)
PY
}
[ -n "$KEEP" ] && set_conf KEEP "$KEEP"
[ -n "$REMOTE" ] && set_conf REMOTE "$REMOTE"
[ -n "$REMOTE_PORT" ] && set_conf REMOTE_PORT "$REMOTE_PORT"
[ "$NO_REMOTE" = 1 ] && set_conf REMOTE ""
if [ "${#RECIPIENTS[@]}" -gt 0 ]; then
  rm -f "$GPG_K"
  [ -f "$AGE_R" ] || (umask 077; printf '# Khoá CÔNG KHAI age nhận bản sao lưu (mỗi dòng một khoá). Khoá riêng giữ ở nơi khác, không bao giờ trên máy này.\n' > "$AGE_R")
  for k in "${RECIPIENTS[@]}"; do grep -qxF "$k" "$AGE_R" || echo "$k" >> "$AGE_R"; done
  chmod 0644 "$AGE_R"
fi
if [ -n "$GPG_FILE" ]; then rm -f "$AGE_R"; install -m 0644 -o root -g root "$GPG_FILE" "$GPG_K"; fi

# ---- đẩy sang máy khác: khoá SSH riêng của việc sao lưu + khoá máy đích ghim trong known_hosts + drop-in mở mạng tới đúng địa chỉ đó
R_DEST=$(sed -n 's/^REMOTE=//p' "$CONF" | tail -1 | tr -d "\"'"); R_PORT=$(sed -n 's/^REMOTE_PORT=//p' "$CONF" | tail -1 | tr -d "\"'"); R_PORT=${R_PORT:-22}
if [ -n "$R_DEST" ]; then
  command -v rsync >/dev/null && command -v ssh >/dev/null || { echo "Đẩy sang máy khác cần rsync và ssh: sudo apt-get install rsync openssh-client"; exit 1; }
  R_HOST=${R_DEST#*@}; R_HOST=${R_HOST%%:*}
  [ -f "$SSH_K" ] || { ssh-keygen -q -t ed25519 -N '' -C "neu-agent-backup@$(hostname -s)" -f "$SSH_K"; echo "Đã tạo khoá SSH cho sao lưu ($SSH_K)."; }
  chmod 600 "$SSH_K"
  if [ ! -s "$KNOWN" ]; then
    ssh-keyscan -p "$R_PORT" -T 10 "$R_HOST" 2>/dev/null > "$KNOWN.tmp" || true
    [ -s "$KNOWN.tmp" ] || { rm -f "$KNOWN.tmp"; echo "Không lấy được khoá máy $R_HOST (cổng $R_PORT)."; exit 1; }
    mv "$KNOWN.tmp" "$KNOWN"; chmod 644 "$KNOWN"
    echo "Đã ghim khoá của máy $R_HOST vào $KNOWN. ĐỐI CHIẾU với máy đích (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub trên máy đó):"
    ssh-keygen -lf "$KNOWN" | sed 's/^/  /'
  fi
  IPS=$(getent ahosts "$R_HOST" | awk '{print $1}' | sort -u | tr '\n' ' ')
  [ -n "$IPS" ] || { echo "Không phân giải được $R_HOST."; exit 1; }
  mkdir -p "$DROPIN"
  cat > "$DROPIN/remote.conf" <<EOT
# Tạo bởi install-backup.sh vì có REMOTE=$R_DEST: chỉ mở mạng tới máy đích (địa chỉ phân giải lúc cài; đổi máy/IP thì chạy lại install-backup.sh).
[Service]
PrivateNetwork=no
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressAllow=localhost $IPS
EOT
else
  rm -f "$DROPIN/remote.conf"; rmdir "$DROPIN" 2>/dev/null || true
fi

python3 "$LIB/backup.py" check || { echo "Khai khoá công khai: --recipient 'age1…' hoặc --gpg-key tệp.asc (xem docs/DEPLOY.md)."; exit 1; }

# ---- dịch vụ + lịch
install -m 0644 -o root -g root "$HERE/neu-agent-backup.service" "$UNITDIR/$SVC"
install -m 0644 -o root -g root "$HERE/neu-agent-backup.timer" "$UNITDIR/$TIMER"
command -v systemd-analyze >/dev/null && { for u in $SVC $TIMER; do systemd-analyze verify "$UNITDIR/$u" 2>&1 | grep -v '^$' | sed 's/^/  [systemd-analyze] /' || true; done; }
systemctl daemon-reload
systemctl enable --now "$TIMER" >/dev/null 2>&1

# ---- kiểm tra sau cài: chạy thật một lần trong sandbox của dịch vụ
echo "Chạy thử một lần sao lưu…"
systemctl start "$SVC" 2>/dev/null || true
STATE=$(python3 - "$OUT/last.json" <<'PY'
import json, sys, time
try:
    st = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print("none"); sys.exit()
fresh = time.time() - st.get("time", 0) < 600
print(("ok" if st.get("ok") else "fail") if fresh else "stale", st.get("archive", "-"), "pushfail" if st.get("pushed") is False else "")
PY
)
case "$STATE" in
  ok*) ;;
  *) journalctl -u neu-agent-backup -n 20 --no-pager 2>/dev/null || true; echo "Sao lưu thử THẤT BẠI ($STATE)."; exit 1;;
esac
NEWEST=$(echo "$STATE" | cut -d' ' -f2)
[[ "$NEWEST" =~ ^neu-agent-data-[0-9]{8}-[0-9]{6}\.tar\.gz\.(age|gpg)$ ]] && [ -s "$OUT/$NEWEST" ] || { echo "Không thấy bản sao lưu vừa tạo."; exit 1; }
if [ -s "$ETC/diag-secret" ] && grep -qF -- "$(head -c 64 "$ETC/diag-secret")" "$OUT/$NEWEST"; then echo "Bản sao lưu chứa bí mật ở dạng rõ: huỷ."; exit 1; fi

trap - EXIT
echo "OK: sao lưu hằng đêm (~2:30) đã bật. Bản đầu tiên: $OUT/$NEWEST ($(du -h "$OUT/$NEWEST" | cut -f1))."
if [[ "$STATE" == *pushfail* ]]; then
  echo "CẢNH BÁO: chưa đẩy được sang $R_DEST. Trên máy đích, thêm vào ~/.ssh/authorized_keys của người dùng nhận (chỉ cho ghi, không đọc/xoá được):"
  echo "  command=\"rrsync -wo -no-del /srv/neu-agent-backup\",restrict $(cat "$SSH_K.pub")"
  echo "  (với rrsync, đường dẫn sau dấu : trong --remote tính TỪ thư mục đó: thường để trống, ví dụ --remote bk@may-dich:)"
  echo "  rồi thử lại: sudo systemctl start $SVC && sudo neu-agent-backup list"
elif [ -n "$R_DEST" ]; then
  echo "Đã đẩy sang $R_DEST."
fi
echo "Xem: sudo neu-agent-backup list | Thử khôi phục (trên máy có khoá riêng, hoặc chép khoá tạm rồi xoá): sudo neu-agent-backup verify <tệp> --identity <khoá riêng>"
