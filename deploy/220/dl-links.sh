#!/usr/bin/env bash
# dl-links.sh <thư mục tải về> — cập nhật <thư mục>/latest/: tên cố định NEU-Agent-mac-arm64.dmg, NEU-Agent-mac-x64.dmg, NEU-Agent-win-x64.exe
# trỏ tới tệp của bản đang phát hành (theo latest.json), kèm SHA256SUMS.txt. Nginx phục vụ RIÊNG thư mục này công khai (nút tải trên trang giới thiệu).
# Gọi bởi install.sh (mỗi lần triển khai web) và neu-agent-deploy publish-desktop. Chưa có latest.json thì không làm gì.
set -euo pipefail
DL="${1:?Cách dùng: dl-links.sh <thư mục tải về>}"
[ -f "$DL/latest.json" ] || exit 0
L="$DL/latest"
install -d -m 0755 "$L"
rm -f "$L"/.tmp.* "$L"/.SHA256SUMS.new
# chỉ nhận tên tệp đúng dạng và đúng phiên bản khai trong latest.json (giống danh sách trắng của neu-agent-deploy)
pairs=$(python3 - "$DL/latest.json" <<'PY'
import json, re, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
v = j.get("version", "")
for n in j.get("files") or {}:
    m = re.fullmatch(r"NEU-Agent-" + re.escape(v) + r"-(mac-arm64\.dmg|mac-x64\.dmg|win-x64\.exe)", n)
    if m: print(n, m.group(1))
PY
)
while read -r f plat; do
  [ -n "${f:-}" ] && [ -f "$DL/$f" ] || continue
  # đổi liên kết nguyên tử: người đang tải không bao giờ gặp tên trống
  ln -sfn "../$f" "$L/.tmp.$plat"
  mv -fT "$L/.tmp.$plat" "$L/NEU-Agent-$plat"
done <<<"$pairs"
# bản phát hành thiếu một nền tảng: giữ liên kết tới bản trước nếu tệp còn; tệp đã bị dọn thì bỏ liên kết (404 thay vì liên kết hỏng)
for l in "$L"/NEU-Agent-*; do
  if [ -L "$l" ] && [ ! -e "$l" ]; then rm -f "$l"; fi
done
if ls "$L"/NEU-Agent-* >/dev/null 2>&1; then
  (cd "$L" && sha256sum NEU-Agent-* > .SHA256SUMS.new && chmod 644 .SHA256SUMS.new && mv -f .SHA256SUMS.new SHA256SUMS.txt)
else
  rm -f "$L/SHA256SUMS.txt"
fi
echo "Tải công khai (latest/): $(cd "$L" && ls NEU-Agent-* 2>/dev/null | tr '\n' ' ')"
