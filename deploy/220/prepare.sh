#!/usr/bin/env bash
# Chuẩn bị gói để upload lên máy 220 (chạy trên máy dựng, sau khi đã `npm run dist -w @neu/agent-desktop`):
#   ./prepare.sh          dựng lại web, nén web.tar.gz, gom bản cài (dmg/exe) + mã băm + latest.json vào downloads/
# Rồi: scp -r deploy/220 220:~/neu-agent-220   (xem docs/DEPLOY.md)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; REL="$ROOT/apps/desktop/release"
(cd "$ROOT" && NODE_ENV=production npm run build -w @neu/agent-web >/dev/null)
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$HERE/web.tar.gz" -C "$ROOT/apps/web/dist" .
echo "web.tar.gz: $(du -h "$HERE/web.tar.gz" | cut -f1)"
[ -f "$REL/SHA256SUMS.txt" ] || { echo "Chưa có $REL/SHA256SUMS.txt: chạy npm run dist -w @neu/agent-desktop trước."; exit 1; }
DL="$HERE/downloads"; rm -rf "$DL"; mkdir -p "$DL"
for f in "$REL"/NEU-Agent-*-mac-arm64.dmg "$REL"/NEU-Agent-*-mac-x64.dmg "$REL"/NEU-Agent-*-win-x64.exe; do cp "$f" "$DL/"; done
cp "$REL/HUONG-DAN-CAI-DAT.md" "$REL/BAO-MAT.md" "$DL/"
(cd "$DL" && shasum -a 256 NEU-Agent-* | sed 's#  #  #' > SHA256SUMS.txt && cat SHA256SUMS.txt)
python3 - "$DL" "$REL" <<'PY'
import datetime, json, os, sys
dl, rel = sys.argv[1:3]
src = json.load(open(os.path.join(rel, "latest.json"), encoding="utf-8"))
files = {n: v for n, v in src["files"].items() if os.path.exists(os.path.join(dl, n))}
out = {"version": src["version"], "released": datetime.date.today().isoformat(), "notes": "", "files": files, "signed": src.get("signed", {}), "signer": src.get("signer", {})}
json.dump(out, open(os.path.join(dl, "latest.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("latest.json:", out["version"], "ký số:", out["signed"])
PY
echo "Sẵn sàng: $(du -sh "$HERE" | cut -f1) trong deploy/220"
