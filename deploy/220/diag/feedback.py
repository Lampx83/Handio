"""NEU Agent - kho GÓP Ý / BÁO LỖI của người dùng (SQLite, chỉ thư viện chuẩn).

Khác chẩn đoán (không chứa nội dung): đây là nội dung do CHÍNH NGƯỜI DÙNG viết và chủ động gửi để nhóm phát triển đọc, nên được lưu
kèm tên đăng nhập (để liên hệ lại). Ứng dụng nói rõ điều này ở hộp góp ý. Chỉ quản trị viên xem được (trang /agent/admin/feedback).

Bảng feedback: id, ts (giây UTC), ident (email/tên đăng nhập), kind (bug|idea|praise|other), text, version, platform, tab, model,
status (new|seen|planned|done|wontfix), note (ghi chú của quản trị), updated, updated_by.
"""
import json
import re
import sqlite3
import threading
import time

KINDS = ("bug", "idea", "praise", "other")
STATUSES = ("new", "seen", "planned", "done", "wontfix")
MAX_TEXT = 3000
MIN_TEXT = 5
MAX_NOTE = 1000
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
VERSION_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$")
SHORT_RE = re.compile(r"^[A-Za-z0-9 ._()/:+-]{1,40}$")
# chống gửi dồn: mỗi người tối đa PER_HOUR góp ý/giờ và PER_DAY/ngày; cả hệ thống tối đa GLOBAL_PER_HOUR
PER_HOUR, PER_DAY, GLOBAL_PER_HOUR = 6, 20, 400


def _clip(s, n):
    s = CTRL.sub("", s.replace("\r\n", "\n").replace("\r", "\n"))
    s = re.sub(r"\n{4,}", "\n\n\n", s).strip()
    return s[:n]


def clean_submission(raw):
    """Kiểm tra thân yêu cầu từ ứng dụng. Trả về (dict sạch, None) hoặc (None, mã lỗi)."""
    if not isinstance(raw, dict):
        return None, "bad_request"
    kind = raw.get("kind")
    if kind not in KINDS:
        return None, "bad_kind"
    text = raw.get("text")
    if not isinstance(text, str):
        return None, "bad_text"
    text = _clip(text, MAX_TEXT)
    if len(text) < MIN_TEXT:
        return None, "too_short"
    ctx = raw.get("ctx") if isinstance(raw.get("ctx"), dict) else {}

    def short(k):
        v = ctx.get(k)
        return v if isinstance(v, str) and SHORT_RE.match(v) else ""
    ver = ctx.get("version")
    return {"kind": kind, "text": text, "version": ver if isinstance(ver, str) and VERSION_RE.match(ver) else "",
            "platform": short("platform"), "tab": short("tab"), "model": short("model")}, None


class FeedbackDB:
    def __init__(self, path, now=time.time):
        self.path = path
        self.now = now
        self.lock = threading.Lock()
        self._init()

    def _conn(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def _init(self):
        with self.lock, self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, ident TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', tab TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new', note TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT '')""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_fb_ts ON feedback(ts)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_fb_status ON feedback(status)")

    def add(self, ident, sub):
        """Lưu một góp ý đã kiểm tra. Trả về {"ok":True,"id":n} hoặc {"ok":False,"error":mã,"retry":giây}."""
        now = int(self.now())
        ident = ident.strip()[:200]
        with self.lock, self._conn() as c:
            h = c.execute("SELECT COUNT(*), MIN(ts) FROM feedback WHERE ident=? AND ts>?", (ident, now - 3600)).fetchone()
            if h[0] >= PER_HOUR:
                return {"ok": False, "error": "rate", "retry": max(1, 3600 - (now - (h[1] or now)))}
            d = c.execute("SELECT COUNT(*) FROM feedback WHERE ident=? AND ts>?", (ident, now - 86400)).fetchone()
            if d[0] >= PER_DAY:
                return {"ok": False, "error": "rate", "retry": 3600}
            if c.execute("SELECT COUNT(*) FROM feedback WHERE ts>?", (now - 3600,)).fetchone()[0] >= GLOBAL_PER_HOUR:
                return {"ok": False, "error": "busy", "retry": 600}
            dup = c.execute("SELECT id FROM feedback WHERE ident=? AND text=? AND ts>?", (ident, sub["text"], now - 86400)).fetchone()
            if dup:
                return {"ok": True, "id": dup[0], "duplicate": True}
            cur = c.execute("INSERT INTO feedback (ts, ident, kind, text, version, platform, tab, model) VALUES (?,?,?,?,?,?,?,?)",
                            (now, ident, sub["kind"], sub["text"], sub["version"], sub["platform"], sub["tab"], sub["model"]))
            return {"ok": True, "id": cur.lastrowid}

    def list(self, status="", kind="", q="", limit=100, offset=0):
        limit = max(1, min(int(limit), 200))
        where, args = [], []
        if status in STATUSES:
            where.append("status=?")
            args.append(status)
        if kind in KINDS:
            where.append("kind=?")
            args.append(kind)
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(text LIKE ? ESCAPE '\\' OR ident LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')")
            args += [like, like, like]
        w = (" WHERE " + " AND ".join(where)) if where else ""
        with self.lock, self._conn() as c:
            total = c.execute("SELECT COUNT(*) FROM feedback" + w, args).fetchone()[0]
            rows = [dict(r) for r in c.execute("SELECT * FROM feedback" + w + " ORDER BY id DESC LIMIT ? OFFSET ?", args + [limit, max(0, int(offset))])]
            counts = {r[0]: r[1] for r in c.execute("SELECT status, COUNT(*) FROM feedback GROUP BY status")}
            kinds = {r[0]: r[1] for r in c.execute("SELECT kind, COUNT(*) FROM feedback GROUP BY kind")}
        return {"items": rows, "total": total, "by_status": counts, "by_kind": kinds}

    def update(self, fid, status, note, actor):
        if not isinstance(fid, int) or isinstance(fid, bool) or status not in STATUSES:
            return {"ok": False, "error": "bad_request"}
        note = _clip(note if isinstance(note, str) else "", MAX_NOTE)
        with self.lock, self._conn() as c:
            n = c.execute("UPDATE feedback SET status=?, note=?, updated=?, updated_by=? WHERE id=?", (status, note, int(self.now()), actor[:200], fid)).rowcount
        return {"ok": n == 1} if n == 1 else {"ok": False, "error": "not_found"}

    def delete(self, fid):
        if not isinstance(fid, int) or isinstance(fid, bool):
            return {"ok": False, "error": "bad_request"}
        with self.lock, self._conn() as c:
            n = c.execute("DELETE FROM feedback WHERE id=?", (fid,)).rowcount
        return {"ok": n == 1} if n == 1 else {"ok": False, "error": "not_found"}

    def summary(self):
        with self.lock, self._conn() as c:
            new = c.execute("SELECT COUNT(*) FROM feedback WHERE status='new'").fetchone()[0]
            total = c.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        return {"new": new, "total": total}


def to_json(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
