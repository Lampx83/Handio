#!/usr/bin/env python3
"""neu-share-read: đọc MỘT cuộc trò chuyện được chia sẻ (theo mã hoặc liên kết) để nhóm phát triển, kể cả trợ lý AI như Claude, phân tích và
cải tiến Handio. CHỈ ĐỌC: mở CSDL ở chế độ ro, không tăng lượt xem, không in người chia sẻ (email/tên đăng nhập).

  neu-share-read <mã 22 ký tự | https://…/agent/share/<mã>>        bản đọc dạng Markdown (người dùng, agent, công cụ + kết quả, nhắc hệ thống)
  neu-share-read <mã> --json                                       JSON (không có owner)
  neu-share-read --list [N]                                        N bản chia sẻ gần nhất (mã, ngày, tab, phiên bản, mô hình, tiêu đề)

Cài ở /usr/local/sbin/neu-share-read; nhóm neu-diag chạy được bằng `sudo -n -u neu-diag /usr/local/sbin/neu-share-read …` (sudoers chỉ cho
đúng lệnh này, xem install-diag.sh). Khi chạy qua sudo, --db bị bỏ qua (chỉ đọc đúng CSDL chia sẻ).
"""
import json
import os
import re
import sqlite3
import sys
import time

DEFAULT_DB = "/var/lib/neu-agent/feedback/shares.db"
ID_RE = re.compile(r"(?:^|/share/)([A-Za-z0-9_-]{22})/?$")
FIELDS = "id, ts, title, profile, version, platform, model, mode, items, nitems, redactions"


def _open(path):
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=5)


def _day(ts):
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(ts) + 7 * 3600))


def to_markdown(d):
    out = ["# %s" % d["title"], "",
           "- Mã: `%s` · %s (giờ VN)" % (d["id"], _day(d["ts"])),
           "- Tab: %s · Phiên bản: %s · Nền tảng: %s" % (d["profile"] or "?", d["version"] or "?", d["platform"] or "?"),
           "- Mô hình: %s · Chế độ quyền: %s · Đã che %d chỗ nhạy cảm" % (d.get("model") or "?", d.get("mode") or "?", d["redactions"]), ""]
    for i, it in enumerate(d["items"], 1):
        k = it["k"]
        if k == "user":
            out += ["## [%d] Người dùng" % i, it["t"], ""]
        elif k == "assistant":
            out += ["## [%d] Agent" % i, it["t"], ""]
        elif k == "tool":
            out += ["### [%d] Công cụ `%s`%s" % (i, it.get("n", "?"), " — LỖI" if it.get("e") else ""), "```", it["t"], "```"]
            if it.get("r"):
                out += ["Kết quả:", "```", it["r"], "```"]
            out.append("")
        elif k == "summary":
            out += ["## [%d] Tóm tắt ngữ cảnh (agent không còn thấy phần trước)" % i, it["t"], ""]
        else:
            out += ["> [%d] Nhắc của hệ thống: %s" % (i, it["t"].replace("\n", "\n> ")), ""]
    return "\n".join(out)


def main(argv=None, out=sys.stdout):
    args = list(sys.argv[1:] if argv is None else argv)
    db = os.environ.get("NEU_SHARES_DB", DEFAULT_DB)
    if "--db" in args:
        i = args.index("--db")
        val = args[i + 1] if i + 1 < len(args) else ""
        del args[i:i + 2]
        if not os.environ.get("SUDO_USER") and val:
            db = val
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    try:
        c = _open(db)
        c.row_factory = sqlite3.Row
    except sqlite3.Error:
        print("Không mở được CSDL chia sẻ.", file=sys.stderr)
        return 2
    if args[:1] == ["--list"]:
        n = args[1] if len(args) > 1 else "20"
        if not n.isdigit() or not 1 <= int(n) <= 500:
            print("Số lượng phải từ 1 đến 500.", file=sys.stderr)
            return 2
        rows = c.execute("SELECT id, ts, title, profile, version, model, nitems FROM shares WHERE revoked=0 ORDER BY ts DESC LIMIT ?", (int(n),)).fetchall()
        for r in rows:
            out.write("%s\t%s\t%s\tv%s\t%s\t%d mục\t%s\n" % (r["id"], _day(r["ts"]), r["profile"] or "?", r["version"] or "?", r["model"] or "?", r["nitems"], r["title"]))
        return 0
    m = ID_RE.search(args[0]) if len(args) == 1 else None
    if not m:
        print(__doc__.strip().split("\n\n")[1], file=sys.stderr)
        return 2
    r = c.execute("SELECT %s FROM shares WHERE id=? AND revoked=0" % FIELDS, (m.group(1),)).fetchone()
    if r is None:
        print("Không có bản chia sẻ này (sai mã hoặc đã thu hồi).", file=sys.stderr)
        return 1
    d = dict(r)
    d["items"] = json.loads(d["items"])
    out.write(json.dumps(d, ensure_ascii=False, indent=1) + "\n" if as_json else to_markdown(d) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
