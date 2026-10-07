#!/usr/bin/env python3
"""NEU Agent - bộ thu chẩn đoán (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Nghe 127.0.0.1:4190 (chỉ nginx gọi tới). Nhận gói chẩn đoán KHÔNG CHỨA NỘI DUNG từ ứng dụng (POST /diag, qua nginx + SSO),
kiểm tra chặt theo lược đồ (schema.json, dùng chung với mã TypeScript), gắn mã người dùng GIẢ DANH rồi ghi JSONL theo ngày.

  POST /diag            nginx đã xác thực SSO và gắn X-User-Email. Thân <=16 KB, <=200 sự kiện. Giới hạn tốc độ theo người dùng.
  GET  /healthz         {"ok":true} (bộ thu còn sống; chỉ cục bộ)
  GET  /public-healthz  200 {"ok":true} | 503 {"ok":false}  — dựa vào health.json do healthz.py ghi (cũ >15 phút = false)
  GET  /admin/[tệp]     báo cáo chất lượng (tĩnh) cho quản trị viên: chỉ khi X-User-Email nằm trong admins.txt

Định danh: uid = HMAC-SHA256(bí mật máy chủ, email viết thường)[:16 hex]. Email KHÔNG được lưu, KHÔNG được ghi nhật ký.
Dữ liệu: mỗi sự kiện một dòng {"ts_srv","uid","a":{app},"e":{event}} vào <DIAG_DIR>/YYYY-MM-DD.jsonl (UTC, quyền 0600); xoá sau 90 ngày.
"""
import datetime
import hashlib
import hmac
import json
import math
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.environ.get("NEU_DIAG_SCHEMA", os.path.join(HERE, "schema.json"))

VERSION_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$")
HEX_RE = re.compile(r"^[0-9a-f]+$")
MODEL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,60}(/[A-Za-z0-9._:-]{1,60})?$")
LOOKS_SECRET = re.compile(r"^(sk|pk|ghp|gho|ghu|ghs|xox.|akia|eyj|bearer|key|token|secret)[-_.:]|secret|token|passw|api[-_]?key|[A-Za-z0-9]{24,}", re.I)
FILE_EXT = re.compile(r"\.(xlsx?|docx?|pptx?|pdf|txt|csv|json|env|pem|key|py|js|ts|sh|zip)$", re.I)
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}$")
CTRL_RE = re.compile(r"[\x00-\x1f\x7f]+")
ADMIN_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(html|md|json)$")
DAY_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.jsonl$")


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


def pseudonym(secret, email):
    return hmac.new(secret, email.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def read_admins(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {ln.strip().lower() for ln in f if ln.strip() and not ln.lstrip().startswith("#") and EMAIL_RE.match(ln.strip())}
    except OSError:
        return set()


CT = {"html": "text/html; charset=utf-8", "md": "text/markdown; charset=utf-8", "json": "application/json"}


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

    # -- POST /diag
    def do_POST(self):
        c = self.cfg
        if self.path != "/diag" or not self._local():
            return self._send(404, {"ok": False})
        email = self._email()
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
        if name in ("", "latest"):
            name = "latest.html"
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
    )
    cfg.store.prune()
    srv = make_server(cfg, os.environ.get("NEU_DIAG_BIND", "127.0.0.1"), int(os.environ.get("NEU_DIAG_PORT", "4190")))

    def janitor():
        while True:
            time.sleep(3600)
            try:
                cfg.store.prune()
            except OSError:
                pass

    threading.Thread(target=janitor, daemon=True).start()
    print("neu-diag listening on %s:%s" % srv.server_address[:2], flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
