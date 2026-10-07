#!/usr/bin/env bash
# Máy 222: chuyển ai.neu.edu.vn/agent/ sang máy 220 (nơi NEU Agent chạy thật). Chạy bằng sudo, trong thư mục chứa các tệp này.
#   sudo ./install.sh                  bật chuyển tiếp (chỉ làm SAU KHI máy 220 đã cài xong: deploy/220)
#   sudo ./install.sh --uninstall      gỡ chuyển tiếp (đường dẫn /agent/ trên 222 trả 404)
# An toàn: kiểm tra 220 trả lời đúng trước khi đụng cấu hình; sao lưu; nginx -t; tự khôi phục nếu lỗi hoặc kiểm tra sau cài thất bại.
set -euo pipefail

SITE=/etc/nginx/sites-available/ai.neu.edu.vn
SNIP=/etc/nginx/snippets/neu-agent-locations.conf
UPSTREAM="${NEU_UPSTREAM:-192.0.2.20}"   # chỉ đổi khi kiểm thử
INCLUDE_LINE="    include /etc/nginx/snippets/neu-agent-locations.conf;   # NEU Agent (chuyển tiếp sang máy 220)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v nginx >/dev/null || { echo "Không thấy nginx."; exit 1; }
[ -f "$SITE" ] || { echo "Không thấy $SITE"; exit 1; }
[ -f "$HERE/neu-agent-locations.conf" ] || { echo "Thiếu $HERE/neu-agent-locations.conf"; exit 1; }
reload() { nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload); }

if [ "${1:-}" = "--uninstall" ]; then
  cp -a "$SITE" "$SITE.bak-uninstall-$TS"; sed -i '/include \/etc\/nginx\/snippets\/neu-agent-locations.conf;/d' "$SITE"; rm -f "$SNIP"
  reload && echo "Đã gỡ chuyển tiếp NEU Agent khỏi máy 222."; exit 0
fi

# 0) máy 220 phải trả lời đúng (401 JSON "login_required" khi chưa đăng nhập) — chứng tỏ mạng 222→220 thông và 220 đã cài xong
probe=$(curl -s -m 8 -H "Host: ai.neu.edu.vn" "http://$UPSTREAM/agent/vllm/v1/models" || true)
case "$probe" in *login_required*) ;; *) echo "Máy 220 chưa sẵn sàng (nhận: ${probe:0:80}). Cài deploy/220 trước, hoặc kiểm tra tường lửa 222→220:80."; exit 1;; esac

cp -a "$SITE" "$SITE.bak-neu-agent-$TS"
had_snip=0; [ -f "$SNIP" ] && { cp -a "$SNIP" "$SNIP.bak-$TS"; had_snip=1; }
rollback() {
  echo "!! Có lỗi, đang khôi phục cấu hình cũ…"
  cp -a "$SITE.bak-neu-agent-$TS" "$SITE"
  if [ $had_snip = 1 ]; then cp -a "$SNIP.bak-$TS" "$SNIP"; else rm -f "$SNIP"; fi
  nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload) || true
  echo "Đã khôi phục."
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

mkdir -p /etc/nginx/snippets
sed "s#http://192.0.2.20:80#http://$UPSTREAM:80#" "$HERE/neu-agent-locations.conf" > "$SNIP"; chmod 644 "$SNIP"
if ! grep -q "neu-agent-locations.conf" "$SITE"; then
  # chèn ngay sau dòng server_name của khối server nghe cổng 443 và có ai.neu.edu.vn
  awk -v inc="$INCLUDE_LINE" '
    { line[NR]=$0 }
    END {
      n=NR; i=1
      while (i<=n) {
        if (line[i] ~ /^[ \t]*server[ \t]*\{/) {
          depth=0; j=i; has443=0; sn=0
          while (j<=n) {
            t=line[j]; gsub(/#.*/,"",t)
            if (t ~ /^[ \t]*listen[ \t].*443/) has443=1
            if (t ~ /^[ \t]*server_name[ \t].*ai\.neu\.edu\.vn/ && !sn) sn=j
            o=gsub(/\{/,"{",t); c=gsub(/\}/,"}",t); depth+=o-c
            if (depth<=0) break
            j++
          }
          if (has443 && sn && !done) { ins=sn; done=1 }
          i=j+1
        } else i++
      }
      for (k=1;k<=n;k++) { print line[k]; if (k==ins) print inc }
    }' "$SITE" > "$SITE.tmp"
  grep -q "neu-agent-locations.conf" "$SITE.tmp" || { echo "Không tìm thấy khối server (listen 443, server_name ai.neu.edu.vn) trong $SITE."; rm -f "$SITE.tmp"; exit 1; }
  cat "$SITE.tmp" > "$SITE"; rm -f "$SITE.tmp"
fi
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload

# kiểm tra sau cài: gọi qua chính nginx của 222 (HTTPS, tên miền thật)
sleep 1
chk() { curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 "$@"; }
r_page=$(chk -o /dev/null -w "%{http_code} %{redirect_url}" https://ai.neu.edu.vn/agent/)
r_api=$(chk https://ai.neu.edu.vn/agent/vllm/v1/models | head -c 70)
r_other=$(chk -o /dev/null -w "%{http_code}" https://ai.neu.edu.vn/apps/)
echo "Kiểm tra: /agent/=$r_page | API chưa đăng nhập=$r_api | /apps/ (ứng dụng khác)=$r_other"
[ "${r_page%% *}" = 302 ] && [[ "${r_page#* }" == *"/agent/oauth2/start"* ]] && [[ "$r_api" == *login_required* ]] || { echo "Kiểm tra sau cài THẤT BẠI"; exit 1; }
trap - EXIT
echo "OK: https://ai.neu.edu.vn/agent/ nay chạy trên máy 220 (đăng nhập Microsoft 365)."
