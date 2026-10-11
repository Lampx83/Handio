"""Hando - kho CUỘC TRÒ CHUYỆN ĐƯỢC CHIA SẺ (SQLite, chỉ thư viện chuẩn).

Người dùng chủ động bấm "Chia sẻ" một cuộc trò chuyện: ứng dụng che thông tin nhạy cảm rồi gửi bản chụp lên đây, nhận một liên kết
(/agent/share/<mã ngẫu nhiên 22 ký tự>) để đưa cho người khác ĐÃ ĐĂNG NHẬP đọc. Cùng bản chụp đó giúp nhóm phát triển hiểu người dùng
gặp gì để cải tiến (hộp chia sẻ nói rõ điều này). Chỉ quản trị viên xem được toàn bộ ở /agent/admin/shares.

Bảng shares: id (mã công khai khó đoán), owner (email/tên đăng nhập người chia sẻ), ts, title, profile, version, platform,
items (JSON: [{k: user|assistant|tool, t: chữ, n: tên công cụ}]), nitems, bytes, views, last_view, revoked, redactions.
"""
import html
import json
import re
import secrets
import sqlite3
import threading
import time

MAX_ITEMS = 400
MAX_ITEM_CHARS = 6000
MAX_TOTAL_BYTES = 300 * 1024
MAX_TITLE = 120
PER_DAY, ACTIVE_MAX = 20, 200
PROFILES = ("work", "code", "design")
KINDS = ("user", "assistant", "tool")
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")
VERSION_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$")
SHORT_RE = re.compile(r"^[A-Za-z0-9 ._()/:+-]{1,40}$")
TOOL_RE = re.compile(r"^[A-Za-z0-9_:.-]{1,60}$")
# lớp phòng thủ thứ hai (ứng dụng đã che trước): khoá/mật khẩu còn sót thì che nốt phía máy chủ
SECRET_RES = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b"),
    re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{20,}"),
    re.compile(r"(?i)\b(password|passwd|mat khau|mật khẩu|secret|api[_-]?key|token)\b\s*[:=]\s*\S{6,}"),
]
MASK = "[đã ẩn]"


def scrub(text):
    for r in SECRET_RES:
        text = r.sub(MASK, text)
    return text


def clean_payload(raw):
    """Kiểm tra bản chụp từ ứng dụng. Trả về (dict sạch, None) hoặc (None, mã lỗi)."""
    if not isinstance(raw, dict) or raw.get("v") != 1:
        return None, "bad_request"
    items_in = raw.get("items")
    if not isinstance(items_in, list) or not items_in:
        return None, "empty"
    if len(items_in) > MAX_ITEMS:
        return None, "too_many"
    items, total = [], 0
    for it in items_in:
        if not isinstance(it, dict) or it.get("k") not in KINDS or not isinstance(it.get("t"), str):
            return None, "bad_item"
        t = scrub(CTRL.sub("", it["t"]))[:MAX_ITEM_CHARS]
        n = it.get("n")
        rec = {"k": it["k"], "t": t}
        if it["k"] == "tool" and isinstance(n, str) and TOOL_RE.match(n):
            rec["n"] = n
        total += len(t.encode("utf-8")) + 24
        if total > MAX_TOTAL_BYTES:
            return None, "too_big"
        items.append(rec)
    if not any(i["k"] == "user" for i in items):
        return None, "empty"
    title = CTRL.sub(" ", raw.get("title") if isinstance(raw.get("title"), str) else "").strip()
    title = scrub(re.sub(r"\s+", " ", title))[:MAX_TITLE] or "Cuộc trò chuyện"

    def short(k):
        v = raw.get(k)
        return v if isinstance(v, str) and SHORT_RE.match(v) else ""
    ver = raw.get("version")
    red = raw.get("redactions")
    return {"title": title, "profile": raw.get("profile") if raw.get("profile") in PROFILES else "", "version": ver if isinstance(ver, str) and VERSION_RE.match(ver) else "",
            "platform": short("platform"), "items": items, "bytes": total,
            "redactions": red if isinstance(red, int) and not isinstance(red, bool) and 0 <= red <= 100000 else 0}, None


def owner_label(ident):
    """Nhãn hiển thị cho người xem (che bớt): l***@neu.edu.vn hoặc k***."""
    if "@" in ident:
        local, _, dom = ident.partition("@")
        return (local[:1] or "?") + "***@" + dom
    return (ident[:1] or "?") + "***"


class ShareDB:
    def __init__(self, path, now=time.time):
        self.path = path
        self.now = now
        self.lock = threading.Lock()
        with self.lock, self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS shares (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, ts INTEGER NOT NULL, title TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, nitems INTEGER NOT NULL, bytes INTEGER NOT NULL,
                redactions INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, last_view INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_sh_owner ON shares(owner, ts)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_sh_ts ON shares(ts)")

    def _conn(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def create(self, owner, p):
        now = int(self.now())
        owner = owner.strip()[:200]
        with self.lock, self._conn() as c:
            if c.execute("SELECT COUNT(*) FROM shares WHERE owner=? AND ts>?", (owner, now - 86400)).fetchone()[0] >= PER_DAY:
                return {"ok": False, "error": "rate"}
            if c.execute("SELECT COUNT(*) FROM shares WHERE owner=? AND revoked=0", (owner,)).fetchone()[0] >= ACTIVE_MAX:
                return {"ok": False, "error": "too_many_active"}
            sid = secrets.token_urlsafe(16)[:22]
            c.execute("INSERT INTO shares (id, owner, ts, title, profile, version, platform, items, nitems, bytes, redactions) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                      (sid, owner, now, p["title"], p["profile"], p["version"], p["platform"], json.dumps(p["items"], ensure_ascii=False, separators=(",", ":")), len(p["items"]), p["bytes"], p["redactions"]))
            return {"ok": True, "id": sid}

    def get(self, sid, count_view=True):
        if not ID_RE.match(sid or ""):
            return None
        with self.lock, self._conn() as c:
            r = c.execute("SELECT * FROM shares WHERE id=? AND revoked=0", (sid,)).fetchone()
            if r is None:
                return None
            if count_view:
                c.execute("UPDATE shares SET views=views+1, last_view=? WHERE id=?", (int(self.now()), sid))
            d = dict(r)
        d["items"] = json.loads(d["items"])
        return d

    def mine(self, owner):
        with self.lock, self._conn() as c:
            return [dict(r) for r in c.execute("SELECT id, ts, title, nitems, views, redactions FROM shares WHERE owner=? AND revoked=0 ORDER BY ts DESC LIMIT 100", (owner.strip()[:200],))]

    def revoke(self, sid, owner=None):
        """Thu hồi: chủ sở hữu thu hồi của mình; quản trị (owner=None) thu hồi bất kỳ. Dữ liệu được xoá hẳn."""
        if not ID_RE.match(sid or ""):
            return {"ok": False, "error": "bad_request"}
        with self.lock, self._conn() as c:
            if owner is None:
                n = c.execute("DELETE FROM shares WHERE id=?", (sid,)).rowcount
            else:
                n = c.execute("DELETE FROM shares WHERE id=? AND owner=?", (sid, owner.strip()[:200])).rowcount
        return {"ok": True} if n == 1 else {"ok": False, "error": "not_found"}

    def admin_list(self, q="", limit=50, offset=0):
        limit = max(1, min(int(limit), 200))
        where, args = [], []
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(title LIKE ? ESCAPE '\\' OR owner LIKE ? ESCAPE '\\' OR items LIKE ? ESCAPE '\\')")
            args += [like, like, like]
        w = (" WHERE " + " AND ".join(where)) if where else ""
        with self.lock, self._conn() as c:
            total = c.execute("SELECT COUNT(*) FROM shares" + w, args).fetchone()[0]
            rows = [dict(r) for r in c.execute("SELECT id, owner, ts, title, profile, version, platform, nitems, bytes, redactions, views, last_view FROM shares" + w + " ORDER BY ts DESC LIMIT ? OFFSET ?", args + [limit, max(0, int(offset))])]
        return {"items": rows, "total": total}

    def export(self, limit=1000):
        """JSONL cho phân tích cải tiến: KHÔNG kèm tên người chia sẻ (chỉ mã giả danh do bên gọi tạo)."""
        with self.lock, self._conn() as c:
            rows = [dict(r) for r in c.execute("SELECT id, owner, ts, title, profile, version, platform, items, redactions FROM shares ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 5000)),))]
        for r in rows:
            r["items"] = json.loads(r["items"])
        return rows


# ---------------------------------------------------------------- trang đọc (HTML tĩnh, không script)
def render_page(d):
    e = html.escape
    parts = []
    for it in d["items"]:
        if it["k"] == "user":
            parts.append('<div class="m u"><div class="r">Người dùng</div><div class="t">%s</div></div>' % e(it["t"]))
        elif it["k"] == "assistant":
            parts.append('<div class="m a"><div class="r">Hando</div><div class="t">%s</div></div>' % e(it["t"]))
        else:
            parts.append('<div class="m c"><div class="r">Công cụ <code>%s</code></div><div class="t">%s</div></div>' % (e(it.get("n", "")), e(it["t"])))
    meta = " · ".join(x for x in [owner_label(d["owner"]), "tab " + d["profile"] if d["profile"] else "", "v" + d["version"] if d["version"] else "", time.strftime("%d/%m/%Y", time.gmtime(d["ts"] + 7 * 3600))] if x)
    note = ("Đã tự che %d thông tin nhạy cảm (khoá, mật khẩu, CCCD, số điện thoại…). " % d["redactions"]) if d["redactions"] else ""
    return ("""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>%s · Hando</title>
<style>:root{--bg:#f6f6f3;--panel:#fff;--text:#1f2328;--muted:#6b7078;--line:#dedcd3;--accent:#0b4a9e;--soft:#e4edfa}
@media (prefers-color-scheme:dark){:root{--bg:#17181a;--panel:#1f2023;--text:#e8e6e1;--muted:#9a9ea6;--line:#34363b;--accent:#5b9bff;--soft:#1b2a45}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:820px;margin:0 auto;padding:20px 16px 60px}h1{font-size:21px;margin:4px 0}.meta{color:var(--muted);font-size:13px;margin-bottom:6px}
.note{border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:8px 12px;font-size:13px;margin:10px 0 16px}
.m{border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:10px 0;background:var(--panel)}.m.u{background:var(--soft)}
.m.c{font-size:13px;color:var(--muted)}.r{font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600}
.t{white-space:pre-wrap;word-break:break-word}code{font-family:ui-monospace,Menlo,Consolas,monospace}footer{color:var(--muted);font-size:12.5px;margin-top:24px}</style></head>
<body><main><h1>%s</h1><div class="meta">Chia sẻ bởi %s</div>
<div class="note">%sĐây là bản chụp tại thời điểm chia sẻ, chỉ người đã đăng nhập Hando mới xem được. Nội dung do AI tạo ra có thể chưa chính xác.</div>
%s<footer>Hando · Khoa CNTT, Trường ĐH Kinh tế Quốc dân</footer></main></body></html>""" % (e(d["title"]), e(d["title"]), e(meta), e(note), "\n".join(parts)))
