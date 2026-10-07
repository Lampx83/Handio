#!/usr/bin/env bash
# Cài / gỡ NEU Agent (web) trên máy chủ 222 (ai.neu.edu.vn). Chạy bằng sudo, trong thư mục chứa các tệp này.
#   sudo ./install.sh <key>                             cài (hoặc cập nhật bản web); hoặc NEU_AGENT_KEY=<key> sudo -E ./install.sh
#   sudo ./install.sh --uninstall                       gỡ cấu hình nginx (giữ lại /var/www/neu-agent)
# An toàn: sao lưu cấu hình, nginx -t trước khi nạp lại, tự khôi phục nếu lỗi hoặc kiểm tra sau cài thất bại.
set -euo pipefail

SITE=/etc/nginx/sites-available/ai.neu.edu.vn
CONFD=/etc/nginx/conf.d/neu-agent.conf
SNIP=/etc/nginx/snippets/neu-agent-locations.conf
WEBROOT=/var/www/neu-agent
INCLUDE_LINE="    include /etc/nginx/snippets/neu-agent-locations.conf;   # NEU Agent (web)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng sudo."; exit 1; }
command -v nginx >/dev/null || { echo "Không thấy nginx."; exit 1; }
[ -f "$SITE" ] || { echo "Không thấy $SITE"; exit 1; }

reload() { nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload); }

if [ "${1:-}" = "--uninstall" ]; then
  cp -a "$SITE" "$SITE.bak-uninstall-$TS"
  sed -i '/include \/etc\/nginx\/snippets\/neu-agent-locations.conf;/d' "$SITE"
  rm -f "$CONFD" "$SNIP"
  reload && echo "Đã gỡ cấu hình NEU Agent khỏi nginx (tệp web còn ở $WEBROOT)."
  exit 0
fi

KEY="${NEU_AGENT_KEY:-${1:-}}"
[ -n "$KEY" ] || { echo "Thiếu key. Ví dụ: sudo ./install.sh <key>"; exit 1; }
case "$KEY" in *[!A-Za-z0-9._-]*) echo "Key chỉ được chứa chữ, số, . _ -"; exit 1;; esac
for f in web.tar.gz neu-agent.http.conf neu-agent.locations.conf; do [ -f "$HERE/$f" ] || { echo "Thiếu $HERE/$f"; exit 1; }; done

BAK="$SITE.bak-neu-agent-$TS"
cp -a "$SITE" "$BAK"
had_confd=0; [ -f "$CONFD" ] && { cp -a "$CONFD" "$CONFD.bak-$TS"; had_confd=1; }
had_snip=0;  [ -f "$SNIP" ]  && { cp -a "$SNIP"  "$SNIP.bak-$TS";  had_snip=1; }

rollback() {
  echo "!! Có lỗi, đang khôi phục cấu hình cũ…"
  cp -a "$BAK" "$SITE"
  if [ $had_confd = 1 ]; then cp -a "$CONFD.bak-$TS" "$CONFD"; else rm -f "$CONFD"; fi
  if [ $had_snip = 1 ];  then cp -a "$SNIP.bak-$TS" "$SNIP";   else rm -f "$SNIP"; fi
  nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload) || true
  [ -d "$WEBROOT.prev" ] && { rm -rf "$WEBROOT"; mv "$WEBROOT.prev" "$WEBROOT"; }
  echo "Đã khôi phục. Bản sao lưu: $BAK"
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback; exit $rc' EXIT

# 1) tệp web (giữ bản cũ để khôi phục)
rm -rf "$WEBROOT.new" "$WEBROOT.prev"
mkdir -p "$WEBROOT.new"
tar -xzf "$HERE/web.tar.gz" -C "$WEBROOT.new"
[ -f "$WEBROOT.new/index.html" ] || { echo "web.tar.gz không có index.html"; exit 1; }
chmod -R a+rX "$WEBROOT.new"
[ -d "$WEBROOT" ] && mv "$WEBROOT" "$WEBROOT.prev"
mv "$WEBROOT.new" "$WEBROOT"

# 1b) bản cài Desktop (tuỳ chọn): thư mục downloads/ cạnh script -> /var/www/neu-agent-dl (không bị xoá khi cập nhật web)
DLROOT=/var/www/neu-agent-dl
if [ -d "$HERE/downloads" ] && ls "$HERE/downloads" | grep -q .; then
  mkdir -p "$DLROOT"
  if [ -f "$HERE/downloads/SHA256SUMS.txt" ] && command -v sha256sum >/dev/null; then
    (cd "$HERE/downloads" && sha256sum -c SHA256SUMS.txt >/dev/null) || { echo "Mã băm các bản cài không khớp SHA256SUMS.txt (tải lên bị lỗi?). Dừng."; exit 1; }
  fi
  cp -f "$HERE/downloads/"* "$DLROOT/"
  chmod 755 "$DLROOT"; chmod 644 "$DLROOT"/*
  echo "Đã cập nhật bản cài Desktop ở $DLROOT: $(ls "$DLROOT" | tr '\n' ' ')"
fi

# 2) cấu hình nginx (key chỉ nằm ở tệp này, quyền 640)
mkdir -p /etc/nginx/snippets
sed "s/__NEU_AGENT_KEY__/$KEY/" "$HERE/neu-agent.http.conf" > "$CONFD"
chmod 640 "$CONFD"
cp "$HERE/neu-agent.locations.conf" "$SNIP"
chmod 644 "$SNIP"
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
  grep -q "neu-agent-locations.conf" "$SITE.tmp" || { echo "Không tìm thấy khối server (listen 443, server_name ai.neu.edu.vn) trong $SITE để chèn include."; rm -f "$SITE.tmp"; exit 1; }
  cat "$SITE.tmp" > "$SITE"; rm -f "$SITE.tmp"
fi

# 3) kiểm tra rồi nạp lại
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload

# 4) kiểm tra sau cài (gọi thẳng vào nginx cục bộ); thất bại thì tự khôi phục
sleep 1
chk() { curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 -o /dev/null -w "%{http_code}" "$@"; }
r1=$(chk https://ai.neu.edu.vn/agent/)
r2=$(chk https://ai.neu.edu.vn/agent/app.js)
r3=$(chk https://ai.neu.edu.vn/agent/vllm/v1/models)
r4=$(chk -X DELETE https://ai.neu.edu.vn/agent/vllm/v1/models)
r5=$(chk https://ai.neu.edu.vn/agent/vllm/v1/embeddings)
r6=$(curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 -o /dev/null -w "%{http_code}" https://ai.neu.edu.vn/apps/)
csp=$(curl -skI --resolve ai.neu.edu.vn:443:127.0.0.1 https://ai.neu.edu.vn/agent/sandbox-worker.js | grep -ci "connect-src 'none'")
if [ -f "$DLROOT/SHA256SUMS.txt" ]; then
  rd=$(chk https://ai.neu.edu.vn/agent/download/SHA256SUMS.txt)
  first=$(awk 'NR==1{print $2}' "$DLROOT/SHA256SUMS.txt")
  rf=$(chk -I "https://ai.neu.edu.vn/agent/download/$first")
  echo "Tải về: SHA256SUMS=$rd  $first=$rf"
  [ "$rd" = 200 ] && [ "$rf" = 200 ] || { echo "Kiểm tra mục tải về THẤT BẠI"; exit 1; }
fi
echo "Kiểm tra: /agent/=$r1  app.js=$r2  models=$r3  DELETE(chặn)=$r4  embeddings(chặn)=$r5  /apps/(site cũ)=$r6  CSP worker=$csp"
[ "$r1" = 200 ] && [ "$r2" = 200 ] && [ "$r3" = 200 ] && [ "$r4" != 200 ] && [ "$r5" = 404 ] && [ "$csp" -ge 1 ] || { echo "Kiểm tra sau cài THẤT BẠI"; exit 1; }
rm -rf "$WEBROOT.prev"
trap - EXIT
echo "OK: https://ai.neu.edu.vn/agent/ đã chạy. Sao lưu cấu hình cũ: $BAK"
echo "Gỡ: sudo $HERE/install.sh --uninstall"
