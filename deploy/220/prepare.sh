#!/usr/bin/env bash
# Chuẩn bị gói để upload lên máy 220 (chạy trên máy dựng, sau khi đã `npm run dist -w @neu/agent-desktop`):
#   ./prepare.sh          dựng lại web, nén web.tar.gz, gom bản cài (dmg/exe) + mã băm + latest.json vào downloads/
# Rồi: scp -r deploy/220 220:~/neu-agent-220   (xem docs/DEPLOY.md)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; REL="$ROOT/apps/desktop/release"
(cd "$ROOT" && NODE_ENV=production npm run build -w @neu/agent-web >/dev/null)
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$HERE/web.tar.gz" -C "$ROOT/apps/web/dist" .
echo "web.tar.gz: $(du -h "$HERE/web.tar.gz" | cut -f1)"
# trang nhật ký thay đổi công khai (/agent/guide/changelog.html) lấy từ CHANGELOG.md
(cd "$ROOT" && node scripts/version.mjs changelog-html deploy/220/guide-public/changelog.html >/dev/null)
[ -f "$REL/SHA256SUMS.txt" ] || { echo "Chưa có $REL/SHA256SUMS.txt: chạy npm run dist -w @neu/agent-desktop trước."; exit 1; }
DL="$HERE/downloads"; mkdir -p "$DL"
VER=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$REL/latest.json")
# chép bản cài của phiên bản HIỆN TẠI; giữ lại bản cài của các phiên bản trước trong downloads/ (để thu hồi khi cần) nhưng chỉ 2 phiên bản mới nhất
for f in "$REL"/NEU-Agent-"$VER"-mac-arm64.dmg "$REL"/NEU-Agent-"$VER"-mac-x64.dmg "$REL"/NEU-Agent-"$VER"-win-x64.exe; do cp "$f" "$DL/"; done
KEEP=$( (cd "$DL" && ls NEU-Agent-*-*.* 2>/dev/null | sed -E 's/^NEU-Agent-([0-9][^-]*(-[A-Za-z0-9.]+)?)-(mac|win)-.*/\1/' | sort -uV | tail -2) )
for f in "$DL"/NEU-Agent-*; do v=$(basename "$f" | sed -E 's/^NEU-Agent-([0-9][^-]*(-[A-Za-z0-9.]+)?)-(mac|win)-.*/\1/'); echo "$KEEP" | grep -qxF "$v" || rm -f "$f"; done
cp "$REL/HUONG-DAN-CAI-DAT.md" "$REL/BAO-MAT.md" "$DL/"
(cd "$DL" && shasum -a 256 NEU-Agent-* | sed 's#  #  #' > SHA256SUMS.txt && cat SHA256SUMS.txt)
python3 - "$DL" "$REL" <<'PY'
import datetime, json, os, sys
dl, rel = sys.argv[1:3]
src = json.load(open(os.path.join(rel, "latest.json"), encoding="utf-8"))
files = {n: v for n, v in src["files"].items() if os.path.exists(os.path.join(dl, n)) and src["version"] in n}
out = {"version": src["version"], "released": datetime.date.today().isoformat(), "notes": src.get("notes", ""), **({"minVersion": src["minVersion"]} if src.get("minVersion") else {}), "files": files, "signed": src.get("signed", {}), "signer": src.get("signer", {})}
json.dump(out, open(os.path.join(dl, "latest.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("latest.json:", out["version"], "ký số:", out["signed"])
PY
echo "Sẵn sàng: $(du -sh "$HERE" | cut -f1) trong deploy/220"
