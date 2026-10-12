#!/usr/bin/env python3
"""NEU Agent - cổng hạn mức token theo người dùng (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

  nginx (đã xác thực SSO, gắn X-User-Email) ──▶ 127.0.0.1:4191 (cổng này) ──▶ Kong (máy 232) ──▶ vLLM

Mỗi người có hạn mức token MỖI NGÀY (giờ Việt Nam; làm mới lúc 00:00). Số token lấy từ phần `usage` do mô hình trả về (cổng tự bật
`stream_options.include_usage`, không dựa vào máy khách). Khi dùng hết: cho vượt thêm `grace_pct` (mặc định 10%) để HOÀN TẤT việc đang làm, sau đó
từ chối yêu cầu mới bằng HTTP 402 {"error":"quota_exceeded",...}. Ở chế độ "observe" chỉ đếm, không chặn.

  POST /vllm/v1/chat/completions   kiểm tra hạn mức → chuyển tiếp (giữ nguyên luồng SSE) → cộng token
  GET  /quota                      hạn mức/đã dùng của chính người gọi (JSON)
  GET  /healthz                    {"ok":true,"mode":...}

Riêng tư: định danh lưu là MÃ GIẢ DANH (HMAC-SHA256(bí mật máy chủ, email viết thường)[:16], cùng cách với bộ thu chẩn đoán); KHÔNG lưu email, nội dung câu hỏi/trả lời.
Cấu hình: /etc/neu-agent/quota.json (xem quota.default.json). Người dùng tự dán key riêng (nginx gắn X-Neu-Own-Key: 1) và quản trị viên (admins.txt) không bị giới hạn.
"""
import datetime
import hashlib
import hmac
import http.client
import json
import os
import re
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TZ = datetime.timezone(datetime.timedelta(hours=7))
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}$")
USER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")  # tài khoản tên + mật khẩu (không có email)
PREFIX_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,30}\*$")  # "test0*": mọi tài khoản tên (không email) bắt đầu bằng "test0"; tối thiểu 3 ký tự trước dấu *


def capture_wanted(users, ident):
    """Tài khoản có nằm trong danh sách ghi nội dung không. Mẫu tiền tố chỉ áp cho tài khoản tên (không có "@"):
    sinh viên có email dạng test0123@st.neu.edu.vn không bao giờ bị khớp nhầm."""
    if ident in users:
        return True
    return "@" not in ident and any(u.endswith("*") and ident.startswith(u[:-1]) for u in users)
CHAT_PATH = "/vllm/v1/chat/completions"
MAX_BODY = 4 * 1024 * 1024
MAX_NONSTREAM = 16 * 1024 * 1024
KEEP_DAYS = 400

DEFAULT_CONFIG = {
    "mode": "enforce",                      # enforce | observe (chỉ đếm)
    "tiers": {"student": 5_000_000, "staff": 10_000_000},
    "domains": {"st.neu.edu.vn": "student", "neu.edu.vn": "staff"},
    "default_tier": "student",              # tên đăng nhập không có email và tên miền lạ
    "grace_pct": 10,                        # được vượt thêm để hoàn tất việc đang làm
    "warn_pct": 80,                         # từ mức này giao diện nhắc người dùng
    "max_concurrent": 6,                    # số yêu cầu đang chạy đồng thời tối đa của một người
    "overrides": {},                        # {"email hoặc tên đăng nhập viết thường": số token | "unlimited"}
    # GHI LẠI NỘI DUNG hội thoại (yêu cầu gửi lên + lời mô hình trả) của CHÍNH các tài khoản liệt kê ở đây, để quản trị nghiên cứu.
    # Mặc định TẮT (danh sách rỗng). Chỉ dùng cho tài khoản thử nghiệm của nhóm phát triển; người dùng thật phải được báo trước.
    "capture": {"users": [], "keep_days": 90},
}


# ---------------------------------------------------------------- thời gian / định danh
def vn_day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


def next_reset(ts):
    d = datetime.datetime.fromtimestamp(ts, TZ).date() + datetime.timedelta(days=1)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=TZ).timestamp())


def pseudonym(secret, ident):
    return hmac.new(secret, ident.lower().encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def clean_ident(raw):
    s = (raw or "").strip().lower()
    return s if (EMAIL_RE.match(s) or USER_RE.match(s)) else ""


# ---------------------------------------------------------------- cấu hình
def load_config(path):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for k in ("mode", "default_tier"):
                if isinstance(raw.get(k), str):
                    cfg[k] = raw[k]
            for k in ("grace_pct", "warn_pct", "max_concurrent"):
                if isinstance(raw.get(k), (int, float)) and not isinstance(raw.get(k), bool) and raw[k] >= 0:
                    cfg[k] = raw[k]
            if isinstance(raw.get("tiers"), dict):
                cfg["tiers"] = {str(k): int(v) for k, v in raw["tiers"].items() if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0}
            if isinstance(raw.get("domains"), dict):
                cfg["domains"] = {str(k).lower(): str(v) for k, v in raw["domains"].items()}
            if isinstance(raw.get("overrides"), dict):
                cfg["overrides"] = {str(k).lower(): v for k, v in raw["overrides"].items() if v == "unlimited" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0)}
            cap = raw.get("capture")
            if isinstance(cap, dict):
                users = [str(u).strip().lower() for u in (cap.get("users") or []) if isinstance(u, str)]
                cfg["capture"]["users"] = [u for u in users if EMAIL_RE.match(u) or USER_RE.match(u) or PREFIX_RE.match(u)][:50]
                kd = cap.get("keep_days")
                if isinstance(kd, (int, float)) and not isinstance(kd, bool) and 1 <= kd <= 365:
                    cfg["capture"]["keep_days"] = int(kd)
    except (OSError, ValueError):
        pass
    if cfg["mode"] not in ("enforce", "observe"):
        cfg["mode"] = "enforce"
    return cfg


def load_admins(path):
    try:
        with open(path, encoding="utf-8") as f:
            return {ln.strip().lower() for ln in f if ln.strip() and not ln.lstrip().startswith("#")}
    except OSError:
        return set()


def tier_for(cfg, ident):
    if "@" in ident:
        dom = ident.rsplit("@", 1)[1]
        for d, t in cfg["domains"].items():
            if dom == d or dom.endswith("." + d):
                return t
    return cfg["default_tier"]


def limit_for(cfg, ident, admins):
    """(hạn mức token/ngày hoặc None = không giới hạn, tên bậc)."""
    t = tier_for(cfg, ident)
    if ident in admins:
        return None, "admin"
    ov = cfg["overrides"].get(ident)
    if ov == "unlimited":
        return None, t
    if ov is not None:
        return int(ov), t
    lim = cfg["tiers"].get(t)
    return (int(lim) if lim is not None else None), t


def assess(cfg, limit, used):
    """Trạng thái theo mức đã dùng: ok | warn | grace | exceeded | unlimited."""
    if limit is None:
        return "unlimited"
    hard = limit * (1 + cfg["grace_pct"] / 100.0)
    if used >= hard:
        return "exceeded"
    if used >= limit:
        return "grace"
    if used >= limit * cfg["warn_pct"] / 100.0:
        return "warn"
    return "ok"


# ---------------------------------------------------------------- kho đếm
class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS usage(
            day TEXT NOT NULL, uid TEXT NOT NULL, tier TEXT NOT NULL DEFAULT '', lim INTEGER NOT NULL DEFAULT -1,
            tokens INTEGER NOT NULL DEFAULT 0, prompt INTEGER NOT NULL DEFAULT 0, completion INTEGER NOT NULL DEFAULT 0,
            requests INTEGER NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(day, uid))""")
        cols = {r[1] for r in self.db.execute("PRAGMA table_info(usage)")}
        if "cached" not in cols:  # nâng cấp CSDL cũ (chưa có cột token bộ nhớ đệm)
            self.db.execute("ALTER TABLE usage ADD COLUMN cached INTEGER NOT NULL DEFAULT 0")
        if "extra" not in cols:  # phần token quản trị viên cấp thêm đã nằm trong `lim` ở lần ghi gần nhất (để trang quản trị tính lại hạn mức)
            self.db.execute("ALTER TABLE usage ADD COLUMN extra INTEGER NOT NULL DEFAULT 0")
        self.lock = threading.Lock()
        self.last_prune = 0

    def used(self, day, uid):
        with self.lock:
            r = self.db.execute("SELECT tokens FROM usage WHERE day=? AND uid=?", (day, uid)).fetchone()
        return r[0] if r else 0

    def add(self, day, uid, tier, lim, prompt, completion, estimated=False, cached=0, extra=0):
        with self.lock:
            self.db.execute(
                "INSERT INTO usage(day,uid,tier,lim,tokens,prompt,completion,requests,estimated,cached,extra) VALUES(?,?,?,?,?,?,?,1,?,?,?) "
                "ON CONFLICT(day,uid) DO UPDATE SET tier=excluded.tier, lim=excluded.lim, tokens=tokens+excluded.tokens, prompt=prompt+excluded.prompt, "
                "completion=completion+excluded.completion, requests=requests+1, estimated=estimated+excluded.estimated, cached=cached+excluded.cached, extra=excluded.extra",
                (day, uid, tier, -1 if lim is None else lim, prompt + completion, prompt, completion, 1 if estimated else 0, cached, extra))

    def block(self, day, uid, tier, lim, extra=0):
        with self.lock:
            self.db.execute(
                "INSERT INTO usage(day,uid,tier,lim,blocked,extra) VALUES(?,?,?,?,1,?) ON CONFLICT(day,uid) DO UPDATE SET blocked=blocked+1, tier=excluded.tier, lim=excluded.lim, extra=excluded.extra",
                (day, uid, tier, -1 if lim is None else lim, extra))

    def refresh_limits(self, day, cfg, secret):
        """Ghi lại `lim` của các dòng HÔM NAY theo cấu hình hiện tại (bậc + ngoại lệ), giữ phần cấp thêm. Dòng `lim` vốn chỉ được ghi lúc
        yêu cầu gần nhất, nên đổi hạn mức xong trang quản trị vẫn hiện số cũ cho tới khi người đó gửi yêu cầu mới. Trả số dòng đã đổi."""
        n = 0
        with self.lock:
            for tier, base in (cfg.get("tiers") or {}).items():
                if isinstance(base, int) and not isinstance(base, bool):
                    n += self.db.execute("UPDATE usage SET lim=?+extra WHERE day=? AND tier=? AND lim>=0", (base, day, tier)).rowcount
            for ident, val in (cfg.get("overrides") or {}).items():
                uid = pseudonym(secret, ident)
                if val == "unlimited":
                    n += self.db.execute("UPDATE usage SET lim=-1 WHERE day=? AND uid=? AND lim<>-1", (day, uid)).rowcount
                elif isinstance(val, int) and not isinstance(val, bool):
                    n += self.db.execute("UPDATE usage SET lim=?+extra WHERE day=? AND uid=?", (val, day, uid)).rowcount
        return n

    def close(self):
        with self.lock:
            self.db.close()

    def prune(self, now):
        if now - self.last_prune < 3600:
            return
        self.last_prune = now
        cutoff = vn_day(now - KEEP_DAYS * 86400)
        with self.lock:
            self.db.execute("DELETE FROM usage WHERE day < ?", (cutoff,))


class CaptureStore:
    """Ghi NỘI DUNG yêu cầu + câu trả lời của các tài khoản được liệt kê trong cấu hình (`capture.users`). Tệp riêng, quyền 640: chỉ người dùng dịch vụ và nhóm của nó đọc được (nhóm đó chỉ có người được `quota.sh capture grant` thêm vào).
    Dùng chế độ nhật ký DELETE (không WAL) để người đọc trong nhóm mở thẳng tệp .db mà không cần quyền ghi thư mục.

    Mỗi dòng = một lần gọi mô hình: phần MỚI của yêu cầu (các tin sau lần trả lời gần nhất của trợ lý), lời trả lời (chữ + lệnh công cụ),
    cùng token và thời gian. `conv` nhóm các lượt của một cuộc trò chuyện. Không ghi IP, không ghi khoá."""

    def __init__(self, path):
        self.path = path
        self.db = None
        self.lock = threading.Lock()
        self.last_prune = 0

    def _open(self):
        if self.db is None:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            old = os.umask(0o027)
            try:
                self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
            finally:
                os.umask(old)
            self.db.execute("PRAGMA journal_mode=DELETE")
            try:
                os.chmod(self.path, 0o640)
            except OSError:
                pass
            self.db.execute("""CREATE TABLE IF NOT EXISTS captures(
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, user TEXT NOT NULL, conv TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '', n_messages INTEGER NOT NULL DEFAULT 0, new_messages TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '',
                tool_calls TEXT NOT NULL DEFAULT '', finish TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 0,
                prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0)""")
            self.db.execute("CREATE INDEX IF NOT EXISTS captures_user_ts ON captures(user, ts)")
        return self.db

    def warm(self):
        with self.lock:
            self._open()

    def add(self, now, user, rec, keep_days):
        with self.lock:
            db = self._open()
            db.execute(
                "INSERT INTO captures(ts,day,user,conv,model,n_messages,new_messages,reply,tool_calls,finish,status,prompt_tokens,completion_tokens,ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (int(now), vn_day(now), user, rec["conv"], rec["model"], rec["n_messages"], rec["new_messages"], rec["reply"], rec["tool_calls"], rec["finish"],
                 rec["status"], rec["prompt"], rec["completion"], rec["ms"]))
            if now - self.last_prune >= 3600:
                self.last_prune = now
                db.execute("DELETE FROM captures WHERE ts < ?", (int(now) - keep_days * 86400,))

    def close(self):
        with self.lock:
            if self.db is not None:
                self.db.close()
                self.db = None


def capture_record(req, status, reply_text, tool_calls, finish, usage, ms):
    """Dựng một dòng ghi từ yêu cầu và phản hồi (đã gom)."""
    msgs = req.get("messages") if isinstance(req.get("messages"), list) else []
    last_a = max((i for i, m in enumerate(msgs) if isinstance(m, dict) and m.get("role") == "assistant"), default=-1)
    new = msgs[last_a + 1:]
    first = next((m for m in msgs if isinstance(m, dict) and m.get("role") == "user"), {})
    sysm = next((m for m in msgs if isinstance(m, dict) and m.get("role") == "system"), {})
    key = json.dumps([str(sysm.get("content", ""))[:200], str(first.get("content", ""))[:400]], ensure_ascii=False)
    t = tokens_of(usage) or (0, 0)
    return {
        "conv": hashlib.sha1(key.encode("utf-8")).hexdigest()[:12], "model": str(req.get("model") or "")[:80], "n_messages": len(msgs),
        "new_messages": json.dumps(new, ensure_ascii=False), "reply": reply_text, "tool_calls": json.dumps(tool_calls, ensure_ascii=False) if tool_calls else "",
        "finish": finish or "", "status": status, "prompt": t[0], "completion": t[1], "ms": ms,
    }


class Grants:
    """Token CẤP THÊM CHO HÔM NAY (quản trị viên bấm ở trang quản trị `/admin/quota`).

    Tệp JSON do trang quản trị (collector) ghi nguyên tử, cổng chỉ ĐỌC: {"days": {"YYYY-MM-DD": {"<uid 16 hex>": số token}}, "audit": [...]}.
    Phần cấp thêm chỉ có hiệu lực đúng ngày ghi (làm mới 00:00 giờ VN cùng hạn mức); tệp hỏng/thiếu = không có cấp thêm (an toàn)."""

    MAX_EXTRA = 1_000_000_000
    UID_RE = re.compile(r"^[0-9a-f]{16}$")

    def __init__(self, path):
        self.path = path
        self._m = None
        self._days = {}

    def _load(self):
        try:
            m = os.path.getmtime(self.path)
        except OSError:
            self._m, self._days = None, {}
            return
        if m == self._m:
            return
        days = {}
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
            for day, users in (d.get("days") or {}).items():
                if isinstance(day, str) and isinstance(users, dict):
                    days[day] = {u: int(v) for u, v in users.items() if self.UID_RE.match(str(u)) and isinstance(v, int) and not isinstance(v, bool) and 0 < v <= self.MAX_EXTRA}
        except (OSError, ValueError, AttributeError):
            days = {}
        self._m, self._days = m, days

    def extra(self, day, uid):
        if not self.path:
            return 0
        self._load()
        return self._days.get(day, {}).get(uid, 0)


class Config:
    def __init__(self, secret, store, config_path, admins_path, upstream, now=time.time, grants_path="", capture_path=""):
        self.secret, self.store, self.config_path, self.admins_path, self.upstream, self.now = secret, store, config_path, admins_path, upstream, now
        self.capture = CaptureStore(capture_path) if capture_path else None
        self.grants = Grants(grants_path)
        self._cfg = (None, None)
        self.active = {}          # uid -> số yêu cầu đang chạy
        self.active_lock = threading.Lock()

    def cfg(self):
        try:
            m = os.path.getmtime(self.config_path)
        except OSError:
            m = None
        if self._cfg[0] != m or self._cfg[1] is None:
            self._cfg = (m, load_config(self.config_path))
        return self._cfg[1]

    def admins(self):
        return load_admins(self.admins_path)


def quota_info(c, ident, own_key=False):
    """Mô tả hạn mức hiện tại của một người (dùng cho /quota và tiêu đề phản hồi)."""
    cfg, now = c.cfg(), int(c.now())
    uid = pseudonym(c.secret, ident)
    limit, tier = limit_for(cfg, ident, c.admins())
    extra = 0
    if limit is not None:
        extra = c.grants.extra(vn_day(now), uid)   # token quản trị viên cấp thêm cho hôm nay
        limit += extra
    if own_key:
        limit = None
    used = c.store.used(vn_day(now), uid)
    state = assess(cfg, limit, used)
    return {
        "uid": uid, "tier": tier, "mode": cfg["mode"], "limit": 0 if limit is None else limit, "unlimited": limit is None, "used": used,
        "remaining": None if limit is None else max(limit - used, 0), "pct": None if limit is None else round(100.0 * used / limit, 1) if limit else 100.0,
        "state": state, "extra": extra, "grace_pct": cfg["grace_pct"], "warn_pct": cfg["warn_pct"], "reset_at": next_reset(now), "own_key": own_key,
    }


def quota_headers(q):
    h = {"X-Quota-State": q["state"], "X-Quota-Used": str(q["used"]), "X-Quota-Limit": str(q["limit"]), "X-Quota-Reset": str(q["reset_at"]), "X-Quota-Tier": q["tier"]}
    if q["remaining"] is not None:
        h["X-Quota-Remaining"] = str(q["remaining"])
    return h


# ---------------------------------------------------------------- đọc phần usage trong luồng SSE / phản hồi JSON
class UsageSniffer:
    """Nhận từng mảnh luồng SSE, giữ `usage` cuối cùng và tổng số ký tự sinh ra (để ước lượng khi mô hình không trả usage)."""

    def __init__(self):
        self.buf = b""
        self.usage = None
        self.out_chars = 0
        self.text = []           # chữ trả lời (chỉ dùng khi ghi nội dung)
        self.calls = {}          # chỉ số -> {"name","arguments"}
        self.finish = ""

    def feed(self, chunk):
        self.buf += chunk
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            self._line(line.strip())
        if len(self.buf) > 1_000_000:  # một dòng dài bất thường: bỏ
            self.buf = b""

    def _line(self, line):
        if not line.startswith(b"data:"):
            return
        data = line[5:].strip()
        if not data or data == b"[DONE]":
            return
        try:
            j = json.loads(data)
        except ValueError:
            return
        if not isinstance(j, dict):
            return
        if isinstance(j.get("usage"), dict):
            self.usage = j["usage"]
        for ch in j.get("choices") or []:
            if isinstance(ch, dict) and isinstance(ch.get("finish_reason"), str):
                self.finish = ch["finish_reason"]
            d = (ch or {}).get("delta") or {}
            for k in ("content", "reasoning_content", "reasoning"):
                if isinstance(d.get(k), str):
                    self.out_chars += len(d[k])
            if isinstance(d.get("content"), str) and sum(len(x) for x in self.text) < 400_000:
                self.text.append(d["content"])
            for tc in d.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                cur = self.calls.setdefault(tc.get("index", 0), {"name": "", "arguments": ""})
                fn = tc.get("function") or {}
                if isinstance(fn.get("name"), str):
                    cur["name"] += fn["name"]
                if isinstance(fn.get("arguments"), str) and len(cur["arguments"]) < 200_000:
                    cur["arguments"] += fn["arguments"]


def cached_of(usage):
    """Số token lời nhắc được dùng lại từ bộ nhớ đệm tiền tố (vLLM/OpenAI: prompt_tokens_details.cached_tokens); 0 nếu máy chủ không báo."""
    try:
        v = usage["prompt_tokens_details"]["cached_tokens"]
        return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else 0
    except (TypeError, KeyError):
        return 0


def tokens_of(usage):
    """(prompt, completion) từ khối usage của OpenAI/vLLM; None nếu không đọc được."""
    if not isinstance(usage, dict):
        return None
    p, c = usage.get("prompt_tokens"), usage.get("completion_tokens")
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0
    if ok(p) and ok(c):
        return int(p), int(c)
    t = usage.get("total_tokens")
    if ok(t):
        return int(t), 0
    return None


HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "content-length", "server", "date"}
FORWARD_REQ = ("content-type", "accept", "x-ollama-seckey", "x-user-email", "x-real-ip", "x-forwarded-for", "x-forwarded-proto")


class Handler(BaseHTTPRequestHandler):
    server_version = "neu-quota"
    sys_version = ""
    protocol_version = "HTTP/1.0"   # kết thúc luồng bằng đóng kết nối: đơn giản và đúng với SSE
    timeout = 330
    ctx = None

    def log_message(self, *a):
        pass

    def _local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def _json(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _ident(self):
        return clean_ident(self.headers.get("X-User-Email"))

    # -- GET
    def do_GET(self):
        c = self.ctx
        p = self.path.split("?", 1)[0]
        if not self._local():
            return self._json(404, {"ok": False})
        if p == "/healthz":
            return self._json(200, {"ok": True, "mode": c.cfg()["mode"]})
        if p == "/quota":
            ident = self._ident()
            if not ident:
                return self._json(401, {"error": "no_identity"})
            q = quota_info(c, ident, own_key=self.headers.get("X-Neu-Own-Key") == "1")
            q.pop("uid", None)
            return self._json(200, q, quota_headers(q))
        return self._json(404, {"ok": False})

    do_HEAD = do_GET

    # -- POST chat
    def do_POST(self):
        c = self.ctx
        if self.path.split("?", 1)[0] != CHAT_PATH or not self._local():
            return self._json(404, {"ok": False})
        ident = self._ident()
        if not ident:
            return self._json(401, {"error": "no_identity"})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._json(411, {"error": "length_required"})
        if n < 2 or n > MAX_BODY:
            return self._json(413 if n > MAX_BODY else 400, {"error": "size"})
        raw = self.rfile.read(n)
        try:
            req = json.loads(raw.decode("utf-8"))
            if not isinstance(req, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {"error": "json"})

        own = self.headers.get("X-Neu-Own-Key") == "1"
        q = quota_info(c, ident, own_key=own)
        cfg, now = c.cfg(), int(c.now())
        day, uid = vn_day(now), q["uid"]
        limit = None if q["unlimited"] else q["limit"]
        # đồng thời: một người không được mở quá nhiều yêu cầu cùng lúc (chống chương trình lỗi/lặp)
        with c.active_lock:
            cur = c.active.get(uid, 0)
            if cfg["max_concurrent"] and cur >= cfg["max_concurrent"] and not own:
                return self._json(429, {"error": "busy", "message": "Bạn đang gửi quá nhiều yêu cầu cùng lúc. Hãy đợi các yêu cầu đang chạy xong."}, {"Retry-After": "5"})
            c.active[uid] = cur + 1
        try:
            if q["state"] == "exceeded" and cfg["mode"] == "enforce":
                c.store.block(day, uid, q["tier"], limit, q["extra"])
                return self._json(402, {
                    "error": "quota_exceeded",
                    "message": "Bạn đã dùng hết hạn mức token hôm nay (%s token). Hạn mức sẽ làm mới lúc 00:00 ngày mai." % format(q["limit"], ",").replace(",", "."),
                    "limit": q["limit"], "used": q["used"], "reset_at": q["reset_at"], "tier": q["tier"],
                }, quota_headers(q))
            self._forward(c, req, raw, q, own, uid, day, limit)
        finally:
            with c.active_lock:
                c.active[uid] = max(c.active.get(uid, 1) - 1, 0)
                if not c.active[uid]:
                    c.active.pop(uid, None)
            c.store.prune(now)

    def _forward(self, c, req, raw, q, own, uid, day, limit):
        if req.get("stream"):  # luôn bắt mô hình trả usage ở cuối luồng: số đếm không phụ thuộc máy khách
            so = req.get("stream_options") if isinstance(req.get("stream_options"), dict) else {}
            so["include_usage"] = True
            req["stream_options"] = so
        body = json.dumps(req, ensure_ascii=False).encode("utf-8")
        headers = {k: v for k in FORWARD_REQ for v in [self.headers.get(k)] if v}
        headers["Content-Length"] = str(len(body))
        host, port = c.upstream
        up = http.client.HTTPConnection(host, port, timeout=300)
        try:
            up.request("POST", CHAT_PATH, body=body, headers=headers)
            r = up.getresponse()
        except (OSError, http.client.HTTPException):
            up.close()
            return self._json(502, {"error": "upstream", "message": "Không kết nối được máy chủ mô hình."})
        sniff, stream = UsageSniffer(), "event-stream" in (r.getheader("Content-Type") or "")
        t_start = time.time()
        qh = quota_headers(q)
        try:
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in HOP and not k.lower().startswith("x-quota"):
                    self.send_header(k, v)
            for k, v in qh.items():
                self.send_header(k, v)
            self.send_header("Cache-Control", "no-store")
            if stream:
                self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            full = b""
            while True:
                chunk = r.read1(65536)
                if not chunk:
                    break
                if stream:
                    sniff.feed(chunk)
                elif len(full) < MAX_NONSTREAM:
                    full += chunk
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass  # máy khách ngắt: dừng đọc từ mô hình (kết thúc việc sinh) nhưng vẫn tính phần đã dùng
        finally:
            up.close()
        if not stream:
            try:
                j = json.loads(full.decode("utf-8"))
                sniff.usage = j.get("usage") if isinstance(j, dict) else None
                sniff.out_chars = len(full)
                msg = ((j.get("choices") or [{}])[0] or {}).get("message") or {}
                sniff.text = [msg["content"]] if isinstance(msg.get("content"), str) else []
                sniff.finish = str(((j.get("choices") or [{}])[0] or {}).get("finish_reason") or "")
                for i, tc in enumerate(msg.get("tool_calls") or []):
                    fn = (tc or {}).get("function") or {}
                    sniff.calls[i] = {"name": str(fn.get("name", "")), "arguments": str(fn.get("arguments", ""))}
            except ValueError:
                pass
        self._capture(c, req, r.status, sniff, t_start)
        if own or not (200 <= r.status < 300):
            return
        t = tokens_of(sniff.usage)
        est = False
        if t is None:  # không có usage (ngắt giữa chừng hoặc mô hình không trả): ước lượng từ kích thước, đánh dấu
            t, est = (len(raw) // 3, sniff.out_chars // 3), True
        c.store.add(day, uid, q["tier"], limit, t[0], t[1], est, 0 if est else cached_of(sniff.usage), q["extra"])


def _capture(self, c, req, status, sniff, t_start):
    """Ghi nội dung nếu tài khoản nằm trong danh sách `capture.users` (mặc định rỗng = không ghi gì)."""
    if c.capture is None:
        return
    cap = c.cfg()["capture"]
    ident = self._ident()
    if not ident or not capture_wanted(cap["users"], ident):
        return
    try:
        rec = capture_record(req, status, "".join(sniff.text), [sniff.calls[k] for k in sorted(sniff.calls)], sniff.finish, sniff.usage, int((time.time() - t_start) * 1000))
        c.capture.add(c.now(), ident, rec, cap["keep_days"])
    except (sqlite3.Error, OSError, ValueError, TypeError):
        pass  # ghi nội dung không bao giờ được làm hỏng yêu cầu của người dùng


Handler._capture = _capture


def make_server(ctx, host="127.0.0.1", port=4191):
    handler = type("BoundHandler", (Handler,), {"ctx": ctx})
    srv = ThreadingHTTPServer((host, port), handler)
    srv.daemon_threads = True
    srv.request_queue_size = 128
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
    up = os.environ.get("NEU_QUOTA_UPSTREAM", "127.0.0.1:8037").rsplit(":", 1)
    ctx = Config(
        secret=_read_secret(),
        store=Store(os.environ.get("NEU_QUOTA_DB", "/var/lib/neu-agent/quota/usage.db")),
        config_path=os.environ.get("NEU_QUOTA_CONFIG") or os.path.join(cred, "quota-config"),
        admins_path=os.environ.get("NEU_QUOTA_ADMINS") or os.path.join(cred, "admins"),
        upstream=(up[0], int(up[1])),
        grants_path=os.environ.get("NEU_QUOTA_GRANTS", "/var/lib/neu-agent/quota/grants.json"),
        capture_path=os.environ.get("NEU_QUOTA_CAPTURE_DB", "/var/lib/neu-agent/quota/captures.db"),
    )
    srv = make_server(ctx, os.environ.get("NEU_QUOTA_BIND", "127.0.0.1"), int(os.environ.get("NEU_QUOTA_PORT", "4191")))
    cfg = ctx.cfg()
    try:  # đổi hạn mức (quota.sh tier/set khởi động lại cổng) có hiệu lực ngay trên trang quản trị
        ctx.store.refresh_limits(vn_day(time.time()), cfg, ctx.secret)
    except sqlite3.Error:
        pass
    if ctx.capture is not None and cfg["capture"]["users"]:
        # mở CSDL ghi nội dung ngay lúc khởi động (không đợi yêu cầu đầu tiên): chuyển chế độ nhật ký, đặt quyền 640 để đọc được ngay
        try:
            ctx.capture.warm()
        except (sqlite3.Error, OSError):
            pass
    print("neu-quota listening on %s:%s mode=%s tiers=%s" % (srv.server_address[0], srv.server_address[1], cfg["mode"], cfg["tiers"]), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
