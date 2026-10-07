#!/usr/bin/env bash
# Gỡ hệ thống OJ Judge (Judge0) cũ khỏi máy 220. Chạy bằng sudo.
#   sudo ./remove-oj-judge.sh              chỉ LIỆT KÊ những gì sẽ xoá (không xoá gì)
#   sudo ./remove-oj-judge.sh --yes        xoá site nginx + container + image của Judge0 (sao lưu cấu hình trước)
#   sudo ./remove-oj-judge.sh --yes --purge-data   thêm: xoá cả volume dữ liệu và thư mục cài đặt khớp "judge" (KHÔNG HOÀN TÁC)
# Chỉ đụng tới thứ có chữ "judge"/"judge0" trong tên. KHÔNG đụng: site mặc định, NEU Agent, certbot, sim-agent-runtime, cổng 9100/9200 (hãy tự kiểm tra các cổng đó).
set -euo pipefail
YES=0; PURGE=0
for a in "$@"; do case "$a" in --yes) YES=1;; --purge-data) PURGE=1;; *) echo "Tham số lạ: $a"; exit 1;; esac; done
[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
TS=$(date +%Y%m%d%H%M%S); BK=/root/oj-judge-backup-$TS
say() { printf '%s\n' "$*"; }

say "== 1) nginx"
SITES=$(ls /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null | grep -i judge | sort -u || true)
for s in $SITES; do say "  site: $s"; done
[ -n "$SITES" ] || say "  (không có site judge)"

say "== 2) docker (container/image/volume có chữ judge)"
CONT=""; IMGS=""; VOLS=""
if command -v docker >/dev/null; then
  CONT=$(docker ps -a --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}' | grep -i judge || true)
  IMGS=$(docker images --format '{{.ID}} {{.Repository}}:{{.Tag}} {{.Size}}' | grep -i judge || true)
  VOLS=$(docker volume ls --format '{{.Name}}' | grep -i judge || true)
fi
[ -n "$CONT" ] && echo "$CONT" | sed 's/^/  container: /' || say "  (không có container judge)"
[ -n "$IMGS" ] && echo "$IMGS" | sed 's/^/  image: /' || say "  (không có image judge)"
[ -n "$VOLS" ] && echo "$VOLS" | sed 's/^/  volume: /' || say "  (không có volume judge)"

say "== 3) thư mục cài đặt có thể là Judge0 (chỉ xoá khi --purge-data)"
DIRS=$(find /opt /srv /home -maxdepth 3 -iname '*judge*' -not -path '*/node_modules/*' 2>/dev/null | head -20 || true)
[ -n "$DIRS" ] && echo "$DIRS" | sed 's/^/  /' || say "  (không thấy)"

say "== 4) cổng đang nghe (để bạn tự đối chiếu; script KHÔNG đụng 9100/9200)"
ss -ltnp 2>/dev/null | grep -E ':(8017|9200|9100)\b' | sed 's/^/  /' || true

if [ $YES -ne 1 ]; then say; say "Chưa xoá gì. Chạy lại với --yes để xoá (thêm --purge-data nếu muốn xoá cả dữ liệu)."; exit 0; fi

say; say "== ĐANG XOÁ (sao lưu cấu hình ở $BK) =="
mkdir -p "$BK"; chmod 700 "$BK"
for s in $SITES; do for d in sites-available sites-enabled; do [ -e "/etc/nginx/$d/$s" ] && cp -a "/etc/nginx/$d/$s" "$BK/$d-$s" 2>/dev/null || true; done; done
for s in $SITES; do rm -f "/etc/nginx/sites-enabled/$s" "/etc/nginx/sites-available/$s"; done
if [ -n "$SITES" ]; then nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload) && say "  đã gỡ site nginx"; fi
if [ -n "$CONT" ]; then docker ps -a --format '{{.ID}} {{.Names}} {{.Image}}' | grep -i judge | awk '{print $1}' | while read -r id; do docker inspect "$id" > "$BK/container-$id.json" 2>/dev/null || true; docker rm -f "$id" >/dev/null && say "  đã xoá container $id"; done; fi
if [ -n "$IMGS" ]; then docker images --format '{{.ID}} {{.Repository}}' | grep -i judge | awk '{print $1}' | sort -u | while read -r id; do docker rmi -f "$id" >/dev/null 2>&1 && say "  đã xoá image $id" || say "  (image $id còn được dùng, bỏ qua)"; done; fi
if [ $PURGE -eq 1 ]; then
  for v in $VOLS; do docker volume rm "$v" >/dev/null 2>&1 && say "  đã xoá volume $v" || say "  (volume $v đang được dùng, bỏ qua)"; done
  for d in $DIRS; do [ -e "$d" ] && tar -czf "$BK/$(echo "$d" | tr '/' '_').tgz" "$d" 2>/dev/null && rm -rf "$d" && say "  đã xoá $d (bản nén ở $BK)"; done
else
  [ -n "$VOLS$DIRS" ] && say "  Giữ lại volume và thư mục dữ liệu (thêm --purge-data nếu muốn xoá hẳn)."
fi
say "Xong. Cấu hình đã sao lưu ở $BK (xoá thư mục này khi chắc chắn không cần)."
