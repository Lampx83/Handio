#!/usr/bin/env python3
"""Hando - bộ thu chẩn đoán (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Nghe 127.0.0.1:4190 (chỉ nginx gọi tới). Nhận gói chẩn đoán KHÔNG CHỨA NỘI DUNG từ ứng dụng (POST /diag, qua nginx + SSO),
kiểm tra chặt theo lược đồ (schema.json, dùng chung với mã TypeScript), gắn mã người dùng GIẢ DANH rồi ghi JSONL theo ngày.

  POST /diag            nginx đã xác thực SSO và gắn X-User-Email. Thân <=16 KB, <=200 sự kiện. Giới hạn tốc độ theo người dùng.
  GET  /healthz         {"ok":true} (bộ thu còn sống; chỉ cục bộ)
  GET  /public-healthz  200 {"ok":true} | 503 {"ok":false}  — dựa vào health.json do healthz.py ghi (cũ >15 phút = false)
  GET  /admin/[tệp]     trang tổng quan (index.html) + báo cáo chất lượng (tĩnh) cho quản trị viên: chỉ khi X-User-Email nằm trong admins.txt
  GET  /admin/accounts           trang QUẢN LÝ TÀI KHOẢN tên + mật khẩu (accounts.html + accounts.js), cũng chỉ quản trị viên
  GET/POST /admin/api/accounts   danh sách + nhật ký thao tác / tạo, đổi mật khẩu, xoá, huỷ mọi phiên. Gọi dịch vụ phụ root `accounts.py` qua socket Unix
                                 (collector KHÔNG tự ghi tệp mật khẩu). POST cần tiêu đề X-Neu-Admin: 1, Origin cùng nguồn, Content-Type JSON (chống CSRF).
  GET  /admin/quota              trang HẠN MỨC TOKEN (quota.html + quota.js): ai đã hết/gần hết hôm nay, cấp thêm nhanh
  GET/POST /admin/api/quota      danh sách (tên lấy từ sổ "ai đã dùng") / {"op":"grant","uid","amount"}: cộng token cho HÔM NAY vào grants.json (cổng hạn mức đọc).
                                 Cùng cơ chế chống CSRF; người cấp (actor) do máy chủ gắn và ghi vào nhật ký trong grants.json. Xem quota_admin.py.

Định danh: uid = HMAC-SHA256(bí mật máy chủ, email viết thường)[:16 hex]. Trong các tệp chẩn đoán JSONL email KHÔNG được lưu, KHÔNG được ghi nhật ký.
Ngoại lệ có chủ đích: sổ "ai đã dùng" users-seen.json (Registry) giữ email/tên đăng nhập thật + nền tảng để quản trị viên xem; chỉ qua /admin/api/accounts.
Dữ liệu: mỗi sự kiện một dòng {"ts_srv","uid","a":{app},"e":{event}} vào <DIAG_DIR>/YYYY-MM-DD.jsonl (UTC, quyền 0600); xoá sau 90 ngày.
"""
import datetime
import hashlib
import hmac
import json
import math
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import feedback as FB
import shares as SH
import quota_admin as QA

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.environ.get("NEU_DIAG_SCHEMA", os.path.join(HERE, "schema.json"))

VERSION_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$")
HEX_RE = re.compile(r"^[0-9a-f]+$")
MODEL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,60}(/[A-Za-z0-9._:-]{1,60})?$")
LOOKS_SECRET = re.compile(r"^(sk|pk|ghp|gho|ghu|ghs|xox.|akia|eyj|bearer|key|token|secret)[-_.:]|secret|token|passw|api[-_]?key|[A-Za-z0-9]{24,}", re.I)
FILE_EXT = re.compile(r"\.(xlsx?|docx?|pptx?|pdf|txt|csv|json|env|pem|key|py|js|ts|sh|zip)$", re.I)
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}$")
CTRL_RE = re.compile(r"[\x00-\x1f\x7f]+")
ADMIN_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(html|md|json|csv)$")
DAY_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.jsonl$")
MAX_ADMIN_BODY = 1024
ADMIN_PAGES = {"accounts": ("accounts.html", "text/html; charset=utf-8"), "accounts.js": ("accounts.js", "text/javascript; charset=utf-8"),
               "quota": ("quota.html", "text/html; charset=utf-8"), "quota.js": ("quota.js", "text/javascript; charset=utf-8"),
               "feedback": ("feedback.html", "text/html; charset=utf-8"), "feedback.js": ("feedback.js", "text/javascript; charset=utf-8"),
               "shares": ("shares.html", "text/html; charset=utf-8"), "shares.js": ("shares.js", "text/javascript; charset=utf-8")}
MAX_SHARE_BODY = 400 * 1024         # bản chụp cuộc trò chuyện (≤ 300 KB chữ + JSON)
MAX_FEEDBACK_BODY = 8 * 1024        # góp ý của người dùng (chữ ≤ 3000 ký tự, có dấu tiếng Việt → tối đa ~9 KB UTF-8, cắt ở 8 KB)
MAX_ADMIN_FEEDBACK_BODY = 4096
ADMIN_POSTS_PER_MIN = 30


def load_schema(path=SCHEMA_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- kiểm tra theo lược đồ (danh sách cho phép)
def safe_model(model):
    if not isinstance(model, str) or not MODEL_RE.match(model):
        return "other"
    last = model.split("/")[-1]
    return "other" if LOOKS_SECRET.search(last) or FILE_EXT.search(last) else last


def _clean_field(spec, v, tools):
    k = spec["k"]
    if k == "int":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
            return None
        return max(spec["min"], min(spec["max"], int(round(v))))
    if k == "enum":
        return v if isinstance(v, str) and v in spec["v"] else None
    if k == "bool":
        return v if isinstance(v, bool) else None
    if k == "tool":
        if not isinstance(v, str):
            return None
        return v if v in tools else "other"
    if k == "text":
        return CTRL_RE.sub(" ", v).strip()[: spec["max"]] if isinstance(v, str) else None
    return None


def validate_event(raw, schema):
    """Trả về sự kiện đã lọc (chỉ các trường trong lược đồ) hoặc None."""
    if not isinstance(raw, dict):
        return None
    t = raw.get("t")
    spec = schema["events"].get(t) if isinstance(t, str) else None
    if spec is None:
        return None
    ts = raw.get("ts")
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or not math.isfinite(ts) or ts < 1_000_000_000 or ts > 4_000_000_000:
        return None
    out = {"t": t, "ts": int(round(ts))}
    for name, fs in spec.items():
        v = _clean_field(fs, raw.get(name), schema["tools"])
        if v is None or (fs["k"] == "text" and v == ""):
            if fs.get("req"):
                return None
            continue
        out[name] = v
    return out


def validate_app(raw, schema):
    if not isinstance(raw, dict):
        return None
    s = lambda k: raw.get(k) if isinstance(raw.get(k), str) else ""  # noqa: E731
    install, version = s("install"), s("version")
    if len(install) != 32 or not HEX_RE.match(install) or not VERSION_RE.match(version):
        return None
    a = schema["app"]
    app = {
        "install": install,
        "version": version,
        "platform": s("platform") if s("platform") in a["platform"]["v"] else "other",
        "profile": s("profile") if s("profile") in a["profile"]["v"] else "code",
        "model": safe_model(raw.get("model")),
    }
    b = s("build")
    if 4 <= len(b) <= 16 and HEX_RE.match(b):
        app["build"] = b
    return app


def validate_payload(raw, schema):
    """-> (app, [events], n_dropped) hoặc (None, [], 0) nếu gói không hợp lệ."""
    if not isinstance(raw, dict) or raw.get("v") != schema["version"]:
        return None, [], 0
    app = validate_app(raw.get("app"), schema)
    evs = raw.get("events")
    if app is None or not isinstance(evs, list) or len(evs) > schema["limits"]["maxEvents"]:
        return None, [], 0
    good = [e for e in (validate_event(x, schema) for x in evs) if e]
    if evs and not good:
        return None, [], 0
    return app, good, len(evs) - len(good)


# ---------------------------------------------------------------- giới hạn tốc độ theo người dùng giả danh
class Limiter:
    """Thùng token: `burst` yêu cầu tức thì, nạp `per_min` mỗi phút; thêm trần số sự kiện mỗi ngày."""

    def __init__(self, burst=20, per_min=12, day_events=20000, now=time.time):
        self.burst, self.rate, self.day_events, self.now = burst, per_min / 60.0, day_events, now
        self.m = {}
        self.lock = threading.Lock()

    def allow(self, uid, n_events):
        t = self.now()
        day = int(t // 86400)
        with self.lock:
            if len(self.m) > 20000:  # bộ nhớ có giới hạn: bỏ nửa cũ nhất
                for k, _ in sorted(self.m.items(), key=lambda kv: kv[1][1])[: len(self.m) // 2]:
                    del self.m[k]
            tok, last, d, cnt = self.m.get(uid, (float(self.burst), t, day, 0))
            tok = min(float(self.burst), tok + (t - last) * self.rate)
            if d != day:
                d, cnt = day, 0
            if tok < 1.0:
                self.m[uid] = (tok, t, d, cnt)
                return False, max(1, int(math.ceil((1.0 - tok) / self.rate)))
            if cnt + n_events > self.day_events:
                self.m[uid] = (tok, t, d, cnt)
                return False, 3600
            self.m[uid] = (tok - 1.0, t, d, cnt + n_events)
            return True, 0


# ---------------------------------------------------------------- lưu trữ JSONL theo ngày
class Store:
    def __init__(self, directory, retention_days=90, max_file_bytes=100 * 1024 * 1024, now=time.time):
        self.dir, self.retention, self.max_bytes, self.now = directory, retention_days, max_file_bytes, now
        self.lock = threading.Lock()
        os.makedirs(self.dir, mode=0o700, exist_ok=True)
        try:
            os.chmod(self.dir, 0o700)
        except OSError:
            pass
        self.last_prune = 0.0

    def path_for(self, ts):
        return os.path.join(self.dir, datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%d") + ".jsonl")

    def append(self, lines):
        data = ("\n".join(lines) + "\n").encode("utf-8")
        p = self.path_for(self.now())
        with self.lock:
            try:
                if os.path.getsize(p) + len(data) > self.max_bytes:
                    return False
            except OSError:
                pass
            fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.write(fd, data)
            finally:
                os.close(fd)
        return True

    def prune(self):
        """Xoá tệp ngày quá hạn (mặc định 90 ngày). Trả về số tệp đã xoá."""
        cutoff = datetime.datetime.fromtimestamp(self.now(), datetime.timezone.utc).date() - datetime.timedelta(days=self.retention)
        n = 0
        for name in os.listdir(self.dir):
            if not DAY_FILE_RE.match(name):
                continue
            try:
                if datetime.date.fromisoformat(name[:10]) < cutoff:
                    os.unlink(os.path.join(self.dir, name))
                    n += 1
            except (ValueError, OSError):
                pass
        self.last_prune = self.now()
        return n


# ---------------------------------------------------------------- cấu hình + máy chủ
# ---------------------------------------------------------------- sổ "ai đã dùng" (chỉ quản trị viên xem)
IDENT_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")  # tên tài khoản tên + mật khẩu (không có @)
PLATFORMS = ("web", "mac", "win", "linux")
MAX_SEEN = 5000


def ident_kind(ident):
    """Phân loại tài khoản theo tên miền email; tên không có @ là tài khoản tên + mật khẩu."""
    if "@" not in ident:
        return "mk"
    if ident.endswith("@st.neu.edu.vn"):
        return "sv"
    if ident.endswith("@neu.edu.vn"):
        return "gv"
    return "khac"


class Registry:
    """Ghi nhớ MỖI TÀI KHOẢN đã dùng Hando: lần đầu, gần nhất, số lượt làm việc, nền tảng (web/mac/win).

    KHÁC các tệp chẩn đoán (chỉ có mã giả danh): sổ này giữ email/tên đăng nhập THẬT để quản trị viên biết ai đang dùng và dùng ở đâu.
    Chỉ đọc được qua /admin/api/accounts (quản trị viên). Không chứa nội dung hội thoại. Tắt bằng NEU_DIAG_KEEP_IDENTITIES=0.
    """

    def __init__(self, path, now=time.time, flush_every=30):
        self.path = path
        self.now = now
        self.flush_every = flush_every
        self.lock = threading.Lock()
        self.users = {}
        self.dirty = False
        self.last_flush = 0.0
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            u = d.get("users") if isinstance(d, dict) else None
            if isinstance(u, dict):
                self.users = {k: v for k, v in u.items() if isinstance(k, str) and isinstance(v, dict)}
        except (OSError, ValueError):
            pass

    def touch(self, ident, app, events, ts):
        plat = app.get("platform") if app.get("platform") in PLATFORMS else "khac"
        turns = sum(1 for e in events if isinstance(e, dict) and e.get("t") == "turn")
        with self.lock:
            u = self.users.get(ident)
            if u is None:
                if len(self.users) >= MAX_SEEN:
                    return
                u = self.users[ident] = {"first": ts, "last": ts, "turns": 0, "plat": {}, "profile": {}}
            u["last"] = ts
            u["turns"] = int(u.get("turns", 0)) + turns
            p = u["plat"].setdefault(plat, {"first": ts, "last": ts, "turns": 0})
            p["last"] = ts
            p["turns"] = int(p.get("turns", 0)) + turns
            prof = app.get("profile")
            if isinstance(prof, str):
                u["profile"][prof[:12]] = ts
            if isinstance(app.get("version"), str):
                u["ver"] = app["version"][:20]
            self.dirty = True
        if ts - self.last_flush >= self.flush_every:
            self.flush()

    def flush(self):
        with self.lock:
            if not self.dirty:
                return
            data = json.dumps({"users": self.users}, separators=(",", ":"), ensure_ascii=False)
            self.dirty = False
            self.last_flush = self.now()
        tmp = self.path + ".tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(data)
            os.replace(tmp, self.path)
        except OSError:
            with self.lock:
                self.dirty = True

    def snapshot(self):
        """Danh sách (mới dùng gần nhất trước) và số liệu theo cửa sổ 24 giờ / 7 / 30 ngày, tách web và Desktop."""
        now = self.now()
        with self.lock:
            rows = [dict(email=k, kind=ident_kind(k), first=v.get("first", 0), last=v.get("last", 0), turns=v.get("turns", 0), ver=v.get("ver", ""),
                         plat={pk: {"last": pv.get("last", 0), "turns": pv.get("turns", 0)} for pk, pv in (v.get("plat") or {}).items()}) for k, v in self.users.items()]
        rows.sort(key=lambda r: -r["last"])
        summ = {}
        for label, secs in (("d1", 86400), ("d7", 7 * 86400), ("d30", 30 * 86400)):
            lim = now - secs
            def has(r, plats):
                return any(r["plat"].get(p, {}).get("last", 0) >= lim for p in plats)
            summ[label] = {
                "all": sum(1 for r in rows if r["last"] >= lim),
                "web": sum(1 for r in rows if has(r, ("web",))),
                "desktop": sum(1 for r in rows if has(r, ("mac", "win", "linux"))),
                "mac": sum(1 for r in rows if has(r, ("mac",))),
                "win": sum(1 for r in rows if has(r, ("win",))),
                "both": sum(1 for r in rows if has(r, ("web",)) and has(r, ("mac", "win", "linux"))),
            }
        kinds = {}
        for r in rows:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        return {"users": rows[:2000], "total": len(rows), "summary": summ, "kinds": kinds}


class Config:
    def __init__(self, **kw):
        self.diag_dir = kw["diag_dir"]
        self.secret = kw["secret"]
        self.reports_dir = kw.get("reports_dir", "")
        self.health_file = kw.get("health_file", "")
        self.admins_file = kw.get("admins_file", "")
        self.retention_days = kw.get("retention_days", 90)
        self.schema = kw.get("schema") or load_schema()
        self.limiter = kw.get("limiter") or Limiter()
        self.store = kw.get("store") or Store(self.diag_dir, self.retention_days)
        self.now = kw.get("now", time.time)
        self.health_max_age = kw.get("health_max_age", 900)
        self.accounts_sock = kw.get("accounts_sock", "")          # socket của dịch vụ phụ accounts.py (rỗng = tắt quản lý tài khoản)
        self.web_dir = kw.get("web_dir", HERE)                    # nơi có accounts.html / accounts.js
        self.public_host = kw.get("public_host", "ai.neu.edu.vn")  # để kiểm tra Origin của POST quản trị
        self.registry = kw.get("registry")                        # sổ "ai đã dùng" (None = tắt)
        self.feedback = kw.get("feedback")                        # FeedbackDB (None = tắt góp ý)
        self.shares = kw.get("shares")                            # ShareDB (None = tắt chia sẻ cuộc trò chuyện)
        self.feedback_hits = kw.get("feedback_hits") or {}
        self.quota_db = kw.get("quota_db", "")                    # CSDL đếm token của cổng hạn mức (rỗng = tắt trang quản lý hạn mức)
        self.grants_file = kw.get("grants_file", "")              # tệp "cấp thêm hôm nay" mà cổng hạn mức đọc
        self.admin_hits = {}                                      # email quản trị -> thời điểm các POST gần đây (giới hạn tốc độ)
        self.admin_lock = threading.Lock()


def accounts_rpc(path, req, timeout=40):
    """Gọi dịch vụ phụ quản lý tài khoản. Trả về dict phản hồi, hoặc None nếu dịch vụ không chạy / lỗi giao tiếp."""
    if not path:
        return None
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect(path)
        s.sendall(json.dumps(req, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
        buf = b""
        while b"\n" not in buf and len(buf) < 65536:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        s.close()
        res = json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))
        return res if isinstance(res, dict) else None
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def pseudonym(secret, email):
    return hmac.new(secret, email.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def read_admins(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {ln.strip().lower() for ln in f if ln.strip() and not ln.lstrip().startswith("#") and EMAIL_RE.match(ln.strip())}
    except OSError:
        return set()


CT = {"html": "text/html; charset=utf-8", "md": "text/markdown; charset=utf-8", "json": "application/json", "csv": "text/csv; charset=utf-8"}


class Handler(BaseHTTPRequestHandler):
    server_version = "neu-diag"
    sys_version = ""
    timeout = 10  # chống kết nối treo (slowloris)
    cfg = None  # gán bởi make_server

    def log_message(self, *a):  # KHÔNG ghi nhật ký yêu cầu (tránh lộ email/IP); lỗi nội bộ vẫn ra stderr
        pass

    # -- tiện ích trả lời
    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def _email(self):
        e = (self.headers.get("X-User-Email") or "").strip()
        return e if EMAIL_RE.match(e) else ""

    def _ident(self):
        """Danh tính do nginx gắn: email (Microsoft) HOẶC tên đăng nhập (tài khoản tên + mật khẩu). Rỗng nếu không hợp lệ."""
        e = (self.headers.get("X-User-Email") or "").strip()
        if EMAIL_RE.match(e):
            return e
        return e if IDENT_RE.match(e) else ""

    # -- POST /diag
    def do_POST(self):
        c = self.cfg
        if self.path.split("?", 1)[0] == "/admin/api/accounts" and self._local():
            return self._admin_accounts_post()
        if self.path.split("?", 1)[0] == "/admin/api/quota" and self._local():
            return self._admin_quota_post()
        if self.path.split("?", 1)[0] == "/admin/api/feedback" and self._local():
            return self._admin_feedback_post()
        if self.path == "/feedback" and self._local():
            return self._feedback_submit()
        if self.path.split("?", 1)[0] == "/admin/api/shares" and self._local():
            return self._admin_shares_post()
        if self.path in ("/share", "/share/revoke") and self._local():
            return self._share_post()
        if self.path != "/diag" or not self._local():
            return self._send(404, {"ok": False})
        email = self._ident()
        if not email:
            return self._send(401, {"ok": False, "error": "no_identity"})
        if self.headers.get("Transfer-Encoding"):
            return self._send(411, {"ok": False, "error": "length_required"})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._send(411, {"ok": False, "error": "length_required"})
        if n > c.schema["limits"]["maxBodyBytes"]:
            return self._send(413, {"ok": False, "error": "size"})
        if n < 2:
            return self._send(400, {"ok": False, "error": "size"})
        try:
            raw = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"ok": False, "error": "json"})
        app, events, dropped = validate_payload(raw, c.schema)
        if app is None:
            return self._send(400, {"ok": False, "error": "schema"})
        uid = pseudonym(c.secret, email)
        ok, retry = c.limiter.allow(uid, len(events))
        if not ok:
            return self._send(429, {"ok": False, "error": "rate"}, extra={"Retry-After": str(retry)})
        now = int(c.now())
        if c.registry is not None:
            c.registry.touch(email.lower(), app, events, now)
        extra_drop = raw.get("dropped") if isinstance(raw.get("dropped"), int) and not isinstance(raw.get("dropped"), bool) else 0
        lines = []
        for i, e in enumerate(events):
            rec = {"ts_srv": now, "uid": uid, "a": app, "e": e}
            if i == 0 and extra_drop > 0:
                rec["lost"] = min(extra_drop, 100000)  # số sự kiện máy khách phải bỏ vì bộ đệm đầy / mạng lỗi
            lines.append(json.dumps(rec, separators=(",", ":"), ensure_ascii=False))
        if lines:
            try:
                if not c.store.append(lines):
                    return self._send(507, {"ok": False, "error": "full"})
            except OSError:
                return self._send(500, {"ok": False})
        if now - c.store.last_prune > 3600:
            try:
                c.store.prune()
            except OSError:
                pass
        return self._send(200, {"ok": True, "accepted": len(events), "dropped": dropped})

    # -- GET
    def do_GET(self):
        c = self.cfg
        p = self.path.split("?", 1)[0]
        if p == "/healthz" and self._local():
            return self._send(200, {"ok": True})
        if p == "/public-healthz" and self._local():
            ok = self._health_ok()
            return self._send(200 if ok else 503, {"ok": ok})
        if (p == "/admin" or p.startswith("/admin/")) and self._local():
            return self._admin(p)
        if (p == "/shares" or p.startswith("/share/")) and self._local():
            return self._share_get(p)
        return self._send(404, {"ok": False})

    do_HEAD = do_GET

    def _health_ok(self):
        c = self.cfg
        try:
            with open(c.health_file, encoding="utf-8") as f:
                h = json.load(f)
            return bool(h.get("ok")) and c.now() - os.path.getmtime(c.health_file) < c.health_max_age
        except (OSError, ValueError):
            return False

    def _admin(self, p):
        c = self.cfg
        email = self._email().lower()
        if not email or email not in read_admins(c.admins_file):
            return self._send(403, {"ok": False, "error": "forbidden"})
        name = p[len("/admin/"):] if p.startswith("/admin/") else ""
        if name == "api/accounts":
            return self._admin_accounts_get()
        if name == "api/quota":
            return self._admin_quota_get()
        if name == "api/feedback":
            return self._admin_feedback_get()
        if name == "api/shares":
            return self._admin_shares_get()
        if name in ADMIN_PAGES:
            return self._admin_static(name)
        if name in ("", "latest"):
            name = "index.html" if name == "" and os.path.isfile(os.path.join(c.reports_dir, "index.html")) else "latest.html"
        if not ADMIN_FILE_RE.match(name):
            return self._send(404, {"ok": False})
        full = os.path.realpath(os.path.join(c.reports_dir, name))
        if os.path.dirname(full) != os.path.realpath(c.reports_dir):
            return self._send(404, {"ok": False})
        try:
            with open(full, "rb") as f:
                body = f.read(8 * 1024 * 1024)
        except OSError:
            return self._send(404, b"Chua co bao cao.", "text/plain; charset=utf-8")
        extra = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:", "Referrer-Policy": "no-referrer"}
        return self._send(200, body, CT[name.rsplit(".", 1)[1]], extra)

    # -- quản lý tài khoản (chỉ quản trị viên; việc ghi do dịch vụ phụ root làm)
    def _admin_email(self):
        """Email quản trị viên hợp lệ, hoặc "" (đã trả lời 403)."""
        email = self._email().lower()
        if not email or email not in read_admins(self.cfg.admins_file):
            self._send(403, {"ok": False, "error": "forbidden"})
            return ""
        return email

    def _admin_static(self, name):
        c = self.cfg
        fname, ctype = ADMIN_PAGES[name]
        try:
            with open(os.path.join(c.web_dir, fname), "rb") as f:
                body = f.read(1024 * 1024)
        except OSError:
            return self._send(404, {"ok": False})
        csp = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        return self._send(200, body, ctype, {"Content-Security-Policy": csp, "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"})

    def _unavailable(self):
        return self._send(503, {"ok": False, "error": "unavailable", "message": "Dịch vụ quản lý tài khoản chưa chạy trên máy chủ (cần cài: sudo ./diag/install-diag.sh)."})

    def _admin_accounts_get(self):
        c = self.cfg
        email = self._admin_email()
        if not email:
            return
        lst = accounts_rpc(c.accounts_sock, {"op": "list"})
        if not lst or not lst.get("ok"):
            return self._unavailable()
        aud = accounts_rpc(c.accounts_sock, {"op": "audit"}) or {}
        out = {"ok": True, "users": lst.get("users", []), "max": lst.get("max"), "audit": aud.get("entries", []), "me": email}
        if c.registry is not None:
            out["seen"] = c.registry.snapshot()
        return self._send(200, out)

    def _admin_post_json(self, max_body=MAX_ADMIN_BODY):
        """Phần chung của mọi POST quản trị: quản trị viên, chống CSRF, giới hạn tốc độ, đọc JSON. Trả (email, dict) hoặc None (đã trả lời lỗi)."""
        c = self.cfg
        email = self._admin_email()
        if not email:
            return None
        # chống CSRF: tiêu đề tuỳ biến (buộc trình duyệt kiểm tra trước), cùng nguồn, đúng kiểu nội dung
        origin = self.headers.get("Origin")
        site = self.headers.get("Sec-Fetch-Site")
        ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if self.headers.get("X-Neu-Admin") != "1" or (origin is not None and origin != "https://" + c.public_host) or (site is not None and site != "same-origin") or ct != "application/json":
            self._send(403, {"ok": False, "error": "csrf"})
            return None
        if self.headers.get("Transfer-Encoding"):
            self._send(411, {"ok": False, "error": "length_required"})
            return None
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send(411, {"ok": False, "error": "length_required"})
            return None
        if n > max_body or n < 2:
            self._send(413, {"ok": False, "error": "size"})
            return None
        now = c.now()
        with c.admin_lock:
            hits = [t for t in c.admin_hits.get(email, []) if now - t < 60]
            if len(hits) >= ADMIN_POSTS_PER_MIN:
                c.admin_hits[email] = hits
                self._send(429, {"ok": False, "error": "rate", "message": "Thao tác quá nhanh, hãy đợi một phút."}, extra={"Retry-After": "30"})
                return None
            hits.append(now)
            c.admin_hits[email] = hits
        try:
            raw = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"ok": False, "error": "json"})
            return None
        return email, raw

    def _admin_accounts_post(self):
        c = self.cfg
        got = self._admin_post_json()
        if got is None:
            return
        email, raw = got
        if not isinstance(raw, dict) or raw.get("op") not in ("add", "remove", "kick"):
            return self._send(400, {"ok": False, "error": "bad_request", "message": "Yêu cầu không hợp lệ."})
        # chỉ chuyển đúng các trường cần thiết; người thao tác (actor) do MÁY CHỦ gắn, không nhận từ trình duyệt
        req = {"op": raw["op"], "actor": email}
        if raw["op"] in ("add", "remove"):
            req["name"] = raw.get("name")
        if raw["op"] == "add":
            req["password"] = raw.get("password")
        res = accounts_rpc(c.accounts_sock, req)
        if res is None:
            return self._unavailable()
        code = 200 if res.get("ok") else (404 if res.get("error") == "not_found" else 400 if res.get("error") != "failed" else 500)
        return self._send(code, {k: v for k, v in res.items() if k in ("ok", "error", "message", "created")})

    # -- hạn mức token: xem ai đã hết/gần hết hôm nay và cấp thêm (chỉ quản trị viên; ghi grants.json, cổng hạn mức đọc)
    def _quota_names(self):
        """{uid: tên hiển thị} từ sổ "ai đã dùng" (chỉ quản trị viên được xem)."""
        reg = self.cfg.registry
        if reg is None:
            return {}
        with reg.lock:
            idents = list(reg.users)
        return {pseudonym(self.cfg.secret, i): i for i in idents}

    def _quota_unavailable(self):
        return self._send(503, {"ok": False, "error": "unavailable", "message": "Chưa có dữ liệu hạn mức: cổng hạn mức chưa cài hoặc chưa có yêu cầu nào đi qua (cài: sudo ./quota/install-quota.sh)."})

    def _admin_quota_get(self):
        c = self.cfg
        email = self._admin_email()
        if not email:
            return
        if not c.quota_db:
            return self._quota_unavailable()
        res = QA.list_users(c.quota_db, c.grants_file, c.now(), self._quota_names())
        if res is None:
            return self._quota_unavailable()
        res.update({"ok": True, "me": email, "audit": QA.read_state(c.grants_file)["audit"][::-1], "max_step": QA.MAX_STEP})
        return self._send(200, res)

    def _admin_quota_post(self):
        c = self.cfg
        got = self._admin_post_json()
        if got is None:
            return
        email, raw = got
        if not isinstance(raw, dict) or raw.get("op") != "grant":
            return self._send(400, {"ok": False, "error": "bad_request", "message": "Yêu cầu không hợp lệ."})
        if not c.quota_db or not c.grants_file:
            return self._quota_unavailable()
        uid, amount = raw.get("uid"), raw.get("amount")
        names = self._quota_names()
        cur = QA.list_users(c.quota_db, c.grants_file, c.now(), names)
        if cur is None:
            return self._quota_unavailable()
        # chỉ cấp cho người đang có số liệu hôm nay (không cấp cho mã tuỳ ý)
        if not isinstance(uid, str) or uid not in {u["uid"] for u in cur["users"]}:
            return self._send(404, {"ok": False, "error": "not_found", "message": "Không thấy người dùng này trong số liệu hôm nay."})
        res = QA.grant(c.grants_file, c.now(), uid, amount, email, names.get(uid, ""))
        return self._send(200 if res.get("ok") else 400 if res.get("error") != "failed" else 500, res)

    # -- góp ý / báo lỗi của người dùng
    def _feedback_submit(self):
        """POST /feedback: người dùng đã đăng nhập (nginx gắn X-User-Email) gửi góp ý. Nội dung do CHÍNH họ viết và chủ động gửi."""
        c = self.cfg
        ident = self._ident()
        if not ident:
            return self._send(401, {"ok": False, "error": "no_identity"})
        if c.feedback is None:
            return self._send(503, {"ok": False, "error": "unavailable", "message": "Chưa bật tính năng góp ý trên máy chủ."})
        if self.headers.get("Transfer-Encoding"):
            return self._send(411, {"ok": False, "error": "length_required"})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._send(411, {"ok": False, "error": "length_required"})
        if n > MAX_FEEDBACK_BODY:
            return self._send(413, {"ok": False, "error": "size", "message": "Góp ý quá dài (tối đa 3000 ký tự)."})
        if n < 2:
            return self._send(400, {"ok": False, "error": "size"})
        try:
            raw = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"ok": False, "error": "json"})
        sub, err = FB.clean_submission(raw)
        if sub is None:
            msg = {"too_short": "Hãy viết rõ hơn một chút (ít nhất vài chữ).", "bad_kind": "Loại góp ý không hợp lệ."}.get(err, "Góp ý không hợp lệ.")
            return self._send(400, {"ok": False, "error": err, "message": msg})
        res = c.feedback.add(ident, sub)
        if not res.get("ok"):
            wait = res.get("retry", 60)
            msg = "Bạn đã gửi khá nhiều góp ý. Thử lại sau khoảng %d phút." % max(1, wait // 60) if res["error"] == "rate" else "Hệ thống đang nhận nhiều góp ý, thử lại sau ít phút."
            return self._send(429, {"ok": False, "error": res["error"], "message": msg}, extra={"Retry-After": str(wait)})
        return self._send(200, {"ok": True, "id": res["id"]})

    def _admin_feedback_get(self):
        c = self.cfg
        email = self._admin_email()
        if not email:
            return
        if c.feedback is None:
            return self._send(503, {"ok": False, "error": "unavailable", "message": "Kho góp ý chưa chạy (cài: sudo ./diag/install-diag.sh)."})
        qs = dict(p.split("=", 1) for p in (self.path.split("?", 1)[1] if "?" in self.path else "").split("&") if "=" in p)
        from urllib.parse import unquote_plus

        def arg(k):
            return unquote_plus(qs.get(k, ""))[:100]
        try:
            limit, offset = int(arg("limit") or 100), int(arg("offset") or 0)
        except ValueError:
            limit, offset = 100, 0
        res = c.feedback.list(arg("status"), arg("kind"), arg("q"), limit, offset)
        res.update({"ok": True, "me": email, "statuses": list(FB.STATUSES), "kinds": list(FB.KINDS)})
        return self._send(200, res)

    def _admin_feedback_post(self):
        c = self.cfg
        got = self._admin_post_json(MAX_ADMIN_FEEDBACK_BODY)
        if got is None:
            return
        email, raw = got
        if c.feedback is None:
            return self._send(503, {"ok": False, "error": "unavailable", "message": "Kho góp ý chưa chạy."})
        if not isinstance(raw, dict):
            return self._send(400, {"ok": False, "error": "bad_request", "message": "Yêu cầu không hợp lệ."})
        op = raw.get("op")
        if op == "set":
            res = c.feedback.update(raw.get("id"), raw.get("status"), raw.get("note", ""), email)
        elif op == "delete":
            res = c.feedback.delete(raw.get("id"))
        else:
            return self._send(400, {"ok": False, "error": "bad_request", "message": "Yêu cầu không hợp lệ."})
        return self._send(200 if res.get("ok") else 404 if res.get("error") == "not_found" else 400, res)

    # -- chia sẻ cuộc trò chuyện
    def _read_json_body(self, limit):
        """Đọc thân JSON có giới hạn. Trả (dict|None); đã tự trả lời lỗi khi None."""
        if self.headers.get("Transfer-Encoding"):
            self._send(411, {"ok": False, "error": "length_required"})
            return None
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send(411, {"ok": False, "error": "length_required"})
            return None
        if n > limit:
            self._send(413, {"ok": False, "error": "size", "message": "Cuộc trò chuyện quá dài để chia sẻ."})
            return None
        if n < 2:
            self._send(400, {"ok": False, "error": "size"})
            return None
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"ok": False, "error": "json"})
            return None

    def _share_post(self):
        """POST /share (tạo) và /share/revoke (thu hồi của chính mình). Danh tính do nginx gắn."""
        c = self.cfg
        ident = self._ident()
        if not ident:
            return self._send(401, {"ok": False, "error": "no_identity"})
        if c.shares is None:
            return self._send(503, {"ok": False, "error": "unavailable", "message": "Chưa bật chia sẻ cuộc trò chuyện trên máy chủ."})
        raw = self._read_json_body(MAX_SHARE_BODY)
        if raw is None:
            return
        if self.path == "/share/revoke":
            res = c.shares.revoke(raw.get("id") if isinstance(raw, dict) else None, ident)
            return self._send(200 if res.get("ok") else 404, res)
        p, err = SH.clean_payload(raw)
        if p is None:
            msg = {"empty": "Cuộc trò chuyện chưa có nội dung để chia sẻ.", "too_many": "Cuộc trò chuyện quá dài (tối đa %d mục)." % SH.MAX_ITEMS,
                   "too_big": "Cuộc trò chuyện quá dài để chia sẻ."}.get(err, "Dữ liệu chia sẻ không hợp lệ.")
            return self._send(400, {"ok": False, "error": err, "message": msg})
        res = c.shares.create(ident, p)
        if not res.get("ok"):
            msg = "Bạn đã chia sẻ khá nhiều trong hôm nay. Hãy thu hồi bớt hoặc thử lại ngày mai." if res["error"] == "rate" else "Bạn đang có quá nhiều liên kết chia sẻ. Hãy thu hồi bớt."
            return self._send(429, {"ok": False, "error": res["error"], "message": msg})
        return self._send(200, {"ok": True, "id": res["id"], "path": "share/" + res["id"]})

    def _share_get(self, p):
        c = self.cfg
        if not self._ident():
            return self._send(401, {"ok": False, "error": "no_identity"})
        if c.shares is None:
            return self._send(503, {"ok": False, "error": "unavailable"})
        if p == "/shares":
            return self._send(200, {"ok": True, "items": c.shares.mine(self._ident())})
        d = c.shares.get(p[len("/share/"):])
        if d is None:
            body = "<!doctype html><meta charset=utf-8><title>Không có</title><p style='font:16px system-ui;padding:24px'>Liên kết này không còn hiệu lực (đã bị thu hồi hoặc không đúng).</p>".encode("utf-8")
            return self._send(404, body, "text/html; charset=utf-8", {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer"})
        csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        return self._send(200, SH.render_page(d).encode("utf-8"), "text/html; charset=utf-8", {"Content-Security-Policy": csp, "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"})

    def _admin_shares_get(self):
        c = self.cfg
        email = self._admin_email()
        if not email:
            return
        if c.shares is None:
            return self._send(503, {"ok": False, "error": "unavailable", "message": "Kho chia sẻ chưa chạy (cài: sudo ./diag/install-diag.sh)."})
        from urllib.parse import parse_qs
        qs = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
        arg = lambda k, d="": (qs.get(k) or [d])[0][:100]
        if arg("id"):
            d = c.shares.get(arg("id"), count_view=False)
            if d is None:
                return self._send(404, {"ok": False, "error": "not_found"})
            return self._send(200, {"ok": True, "item": d})
        if arg("format") == "jsonl":
            rows = c.shares.export()
            lines = []
            for r in rows:
                r["owner"] = pseudonym(c.secret, r["owner"])      # xuất để phân tích: KHÔNG kèm email thật
                lines.append(json.dumps(r, ensure_ascii=False, separators=(",", ":")))
            return self._send(200, "\n".join(lines).encode("utf-8"), "application/x-ndjson; charset=utf-8", {"Content-Disposition": 'attachment; filename="neu-agent-shared-chats.jsonl"'})
        try:
            limit, offset = int(arg("limit") or 50), int(arg("offset") or 0)
        except ValueError:
            limit, offset = 50, 0
        res = c.shares.admin_list(arg("q"), limit, offset)
        res.update({"ok": True, "me": email})
        return self._send(200, res)

    def _admin_shares_post(self):
        c = self.cfg
        got = self._admin_post_json(1024)
        if got is None:
            return
        _email, raw = got
        if c.shares is None:
            return self._send(503, {"ok": False, "error": "unavailable"})
        if not isinstance(raw, dict) or raw.get("op") != "delete":
            return self._send(400, {"ok": False, "error": "bad_request", "message": "Yêu cầu không hợp lệ."})
        res = c.shares.revoke(raw.get("id"), None)
        return self._send(200 if res.get("ok") else 404, res)

    def _nope(self):
        self._send(405, {"ok": False}, extra={"Allow": "GET, HEAD, POST"})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _nope


def make_server(cfg, host="127.0.0.1", port=4190):
    handler = type("BoundHandler", (Handler,), {"cfg": cfg})
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    srv.request_queue_size = 64
    return srv


def _read_secret():
    path = os.environ.get("NEU_DIAG_SECRET_FILE") or os.path.join(os.environ.get("CREDENTIALS_DIRECTORY", ""), "diag-secret")
    try:
        with open(path, "rb") as f:
            s = f.read().strip()
    except OSError as e:
        sys.exit("Không đọc được bí mật HMAC (%s): %s" % (path, e.strerror))
    if len(s) < 16:
        sys.exit("Bí mật HMAC quá ngắn (cần >=16 byte).")
    return s


def main():
    cred = os.environ.get("CREDENTIALS_DIRECTORY", "")
    cfg = Config(
        diag_dir=os.environ.get("NEU_DIAG_DIR", "/var/lib/neu-agent/diag"),
        reports_dir=os.environ.get("NEU_DIAG_REPORTS", "/var/lib/neu-agent/reports"),
        health_file=os.environ.get("NEU_DIAG_HEALTH", "/var/lib/neu-agent/health.json"),
        admins_file=os.environ.get("NEU_DIAG_ADMINS_FILE") or os.path.join(cred, "admins"),
        retention_days=int(os.environ.get("NEU_DIAG_RETENTION_DAYS", "90")),
        secret=_read_secret(),
        accounts_sock=os.environ.get("NEU_ACCOUNTS_SOCK", "/run/neu-agent-accounts/accounts.sock"),
        public_host=os.environ.get("NEU_PUBLIC_HOST", "ai.neu.edu.vn"),
        quota_db=os.environ.get("NEU_QUOTA_DB", "/var/lib/neu-agent/quota/usage.db"),
        grants_file=os.environ.get("NEU_QUOTA_GRANTS", "/var/lib/neu-agent/quota/grants.json"),
    )
    fb_path = os.environ.get("NEU_FEEDBACK_DB", "/var/lib/neu-agent/feedback/feedback.db")
    try:
        if fb_path:
            cfg.feedback = FB.FeedbackDB(fb_path)
    except Exception as e:  # noqa: BLE001 (kho góp ý hỏng không được làm chết bộ thu chẩn đoán)
        print("Không mở được kho góp ý (%s): %s" % (fb_path, e), file=sys.stderr, flush=True)
    sh_path = os.environ.get("NEU_SHARES_DB", "/var/lib/neu-agent/feedback/shares.db")
    try:
        if sh_path:
            cfg.shares = SH.ShareDB(sh_path)
    except Exception as e:  # noqa: BLE001
        print("Không mở được kho chia sẻ (%s): %s" % (sh_path, e), file=sys.stderr, flush=True)
    if os.environ.get("NEU_DIAG_KEEP_IDENTITIES", "1") != "0":
        cfg.registry = Registry(os.path.join(cfg.diag_dir, "users-seen.json"))
    cfg.store.prune()
    srv = make_server(cfg, os.environ.get("NEU_DIAG_BIND", "127.0.0.1"), int(os.environ.get("NEU_DIAG_PORT", "4190")))

    def janitor():
        while True:
            time.sleep(3600)
            try:
                cfg.store.prune()
            except OSError:
                pass

    def flusher():
        while True:
            time.sleep(60)
            if cfg.registry is not None:
                cfg.registry.flush()

    threading.Thread(target=janitor, daemon=True).start()
    threading.Thread(target=flusher, daemon=True).start()

    def on_term(*_):  # systemd dừng dịch vụ: ghi nốt sổ rồi thoát
        if cfg.registry is not None:
            cfg.registry.flush()
        os._exit(0)

    import signal
    signal.signal(signal.SIGTERM, on_term)
    print("neu-diag listening on %s:%s" % srv.server_address[:2], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
