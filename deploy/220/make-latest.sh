#!/usr/bin/env bash
# Tạo deploy/220/downloads/latest.json (để ứng dụng Desktop biết có bản mới) từ SHA256SUMS.txt + phiên bản gói.
#   ./make-latest.sh [-v 0.2.0] [-n "Ghi chú phát hành"] [-m 0.1.5] [-d thư-mục-downloads]
# -n: ghi chú (mặc định lấy từ CHANGELOG.md của phiên bản). -m: phiên bản thấp nhất còn được hỗ trợ — bản cũ hơn sẽ bị ứng dụng yêu cầu cập nhật.
# Phiên bản mặc định lấy từ apps/desktop/package.json. Chạy SAU khi đã tạo SHA256SUMS.txt cho các bản cài mới, TRƯỚC khi chạy install.sh.
# Định dạng: {"version","released","notes","files":{"<tên tệp>":{"sha256","size"}}}  — ứng dụng đọc bằng checkForUpdate() (packages/core/src/updates.ts).
# Chỉ cần python3 (không cần Node). Không tải, không ký: người dùng vẫn phải so mã băm trước khi cài.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DL="$HERE/downloads"; VERSION=""; NOTES=""; MINV=""
while getopts "v:n:m:d:" o; do case $o in v) VERSION=$OPTARG;; n) NOTES=$OPTARG;; m) MINV=$OPTARG;; d) DL=$OPTARG;; *) exit 1;; esac; done
[ -f "$DL/SHA256SUMS.txt" ] || { echo "Thiếu $DL/SHA256SUMS.txt"; exit 1; }
PKG="$HERE/../../apps/desktop/package.json"
CL="$HERE/../../CHANGELOG.md"
exec python3 - "$DL" "$VERSION" "$NOTES" "$PKG" "$MINV" "$CL" <<'PY'
import datetime, json, os, re, sys
dl, version, notes, pkg, minv, cl = sys.argv[1:7]
if not version:
    version = json.load(open(pkg, encoding="utf-8"))["version"]
if not re.fullmatch(r"\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,16})?", version):
    sys.exit("Phiên bản không hợp lệ: " + version)
files = {}
for ln in open(os.path.join(dl, "SHA256SUMS.txt"), encoding="utf-8"):
    ln = ln.strip()
    if not ln or ln.startswith("#"):
        continue
    m = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(\S+)", ln)
    if not m or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", m.group(2)):
        sys.exit("Dòng không hợp lệ trong SHA256SUMS.txt: " + ln[:80])
    name = m.group(2)
    entry = {"sha256": m.group(1).lower()}
    p = os.path.join(dl, name)
    if os.path.isfile(p):
        entry["size"] = os.path.getsize(p)
    files[name] = entry
if not files:
    sys.exit("SHA256SUMS.txt trống")
bad = [n for n in files if version not in n]
if bad:
    print("Cảnh báo: tên tệp không chứa phiên bản %s: %s" % (version, ", ".join(bad)), file=sys.stderr)
if not notes and os.path.isfile(cl):  # mặc định: ghi chú của phiên bản này trong CHANGELOG.md
    with open(cl, encoding="utf-8") as f:
        m = re.search(r"^## \[" + re.escape(version) + r"\][^\n]*\n(.*?)(?=^## \[|\Z)", f.read(), re.M | re.S)
    if m:
        lines = []
        for ln in m.group(1).splitlines():
            ln = re.sub(r"`([^`]+)`", r"\1", re.sub(r"\*\*(.+?)\*\*", r"\1", re.sub(r"^\s*[-*]\s+", "• ", re.sub(r"^###\s*", "", ln)))).rstrip()
            if ln.strip():
                lines.append(ln)
        notes = "\n".join(lines)
if minv and not re.fullmatch(r"\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,16})?", minv):
    sys.exit("Phiên bản tối thiểu (-m) không hợp lệ: " + minv)
out = {"version": version, "released": datetime.date.today().isoformat(), "notes": notes[:2000], **({"minVersion": minv} if minv else {}), "files": files}
dst = os.path.join(dl, "latest.json")
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("Đã ghi %s (phiên bản %s, %d tệp)" % (dst, version, len(files)))
PY
