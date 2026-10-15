#!/usr/bin/env python3
"""NEU Agent - kiểm tra sức khoẻ máy 220 (chạy mỗi 5 phút bằng systemd timer). Chỉ dùng thư viện chuẩn của Python 3.

Kiểm tra: oauth2-proxy /ping, cổng mô hình (TCP + HTTP trả lời), CHAT THẬT (một lệnh rất ngắn 220 → Kong → vLLM, đo thời gian
token đầu; 15 phút/lần khi đang tốt), dung lượng đĩa, bộ thu chẩn đoán còn sống; tuỳ cấu hình: hạn chứng chỉ HTTPS của tên miền
công khai (NEU_HEALTH_TLS_HOSTS) và hạn client secret Entra (tệp quản trị viên khai, YYYY-MM-DD).
Còn < 30 ngày = CẢNH BÁO (danh sách "warn", không làm healthz đỏ); đã hết hạn = lỗi.
Ghi /var/lib/neu-agent/health.json (chi tiết, quyền 0640, KHÔNG phục vụ ra ngoài) và thêm một dòng vào health.log mỗi lần có lỗi.
nginx /agent/healthz chỉ trả {"ok":true|false} (do bộ thu đọc health.json; file cũ >15 phút => false).
Thoát mã 1 nếu có lỗi (systemctl --failed sẽ hiện; timer vẫn tiếp tục).
Key mô hình: tệp credential "model-key" của systemd (install-diag.sh nạp tệp conf.d của nginx, nơi install.sh giữ key) — không ghi ra đâu cả.
"""
import datetime
import http.client
import json
import os
import re
import shutil
import socket
import ssl
import sys
import time
import urllib.parse

E = os.environ.get
CHECKS = {
    "oauth2": E("NEU_HEALTH_OAUTH2", "http://127.0.0.1:4180/ping"),
    "gateway": E("NEU_HEALTH_GATEWAY", "http://127.0.0.1:8037/"),
    "collector": E("NEU_HEALTH_COLLECTOR", "http://127.0.0.1:4190/healthz"),
    "quota": E("NEU_HEALTH_QUOTA", "http://127.0.0.1:4191/healthz"),
}
HEALTH_FILE = E("NEU_HEALTH_FILE", "/var/lib/neu-agent/health.json")
LOG_FILE = E("NEU_HEALTH_LOG", "/var/log/neu-agent/health.log")
DISK_PATHS = [p for p in E("NEU_HEALTH_DISK_PATHS", "/,/var/lib/neu-agent,/var/log").split(",") if p]
MIN_FREE_PCT = float(E("NEU_HEALTH_MIN_FREE_PCT", "10"))
MIN_FREE_GB = float(E("NEU_HEALTH_MIN_FREE_GB", "1"))
TIMEOUT = float(E("NEU_HEALTH_TIMEOUT", "3"))
CHAT_URL = E("NEU_HEALTH_CHAT_URL") or urllib.parse.urljoin(CHECKS["gateway"], "vllm/v1/chat/completions")
CHAT_MODEL = E("NEU_HEALTH_CHAT_MODEL", "qwen3.5-35b-a3b-int4")
CHAT_MAX_MS = float(E("NEU_HEALTH_CHAT_MAX_MS", "20000"))   # token đầu chậm hơn ngưỡng này = lỗi
CHAT_EVERY_S = float(E("NEU_HEALTH_CHAT_EVERY_S", "900"))   # đang tốt thì 15 phút mới gọi lại (ít tốn token); đang lỗi thì gọi mỗi lần
KEY_FILE = E("NEU_HEALTH_KEY_FILE", "")                      # trống = $CREDENTIALS_DIRECTORY/model-key
ENTRA_FILE = E("NEU_HEALTH_ENTRA_EXPIRES", "/etc/neu-agent/entra-secret-expires")
TLS_HOSTS = E("NEU_HEALTH_TLS_HOSTS", "")                    # "tên.miền@ip:cổng,…" (ip:cổng tuỳ chọn), do install-diag.sh điền từ cấu hình nơi triển khai
WARN_DAYS = int(E("NEU_HEALTH_WARN_DAYS", "30"))


def http_check(url, accept_any_status=False, want_ok_json=False):
    u = urllib.parse.urlsplit(url)
    t0 = time.time()
    try:
        c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=TIMEOUT)
        c.request("GET", (u.path or "/") + ("?" + u.query if u.query else ""), headers={"Host": u.netloc, "User-Agent": "neu-healthz"})
        r = c.getresponse()
        body = r.read(2048)
        c.close()
    except Exception as e:  # noqa: BLE001 (mọi lỗi mạng đều là "không ổn")
        return {"ok": False, "ms": int((time.time() - t0) * 1000), "detail": type(e).__name__}
    ok = accept_any_status or r.status == 200
    if ok and want_ok_json:
        try:
            ok = json.loads(body).get("ok") is True
        except ValueError:
            ok = False
    return {"ok": ok, "ms": int((time.time() - t0) * 1000), "detail": "HTTP %d" % r.status}


def _cred(name, fallback=""):
    d = os.environ.get("CREDENTIALS_DIRECTORY")
    if d and os.path.isfile(os.path.join(d, name)):
        return os.path.join(d, name)
    return fallback


def parse_key(text):
    """Key từ tệp chỉ chứa key, hoặc từ tệp conf.d của nginx (dòng `""  "<key>";` của map $neu_agent_key). Không hợp lệ → None."""
    m = re.search(r'^[ \t]*""[ \t]*"([A-Za-z0-9._-]{1,200})";', text, re.M)
    if m:
        return m.group(1)
    t = text.strip()
    return t if re.fullmatch(r"[A-Za-z0-9._-]{1,200}", t) else None


def read_key():
    p = KEY_FILE or _cred("model-key")
    try:
        with open(p, encoding="utf-8") as f:
            return parse_key(f.read(65536))
    except (OSError, ValueError):
        return None


def chat_check(key):
    """Lệnh chat rất ngắn (max_tokens 1, stream) qua đúng đường người dùng: đo tới khi có token đầu. Không ghi key/nội dung."""
    if not key:
        return {"ok": True, "warn": True, "detail": "chưa có key mô hình (chạy lại install-diag.sh)"}
    u = urllib.parse.urlsplit(CHAT_URL)
    body = json.dumps({"model": CHAT_MODEL, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "temperature": 0, "stream": True,
                       "chat_template_kwargs": {"enable_thinking": False}}).encode()
    t0 = time.time()
    ms = lambda: int((time.time() - t0) * 1000)  # noqa: E731
    first = None
    try:
        c = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=TIMEOUT)
        c.connect()                                  # kết nối: hạn ngắn như các mục khác; chờ token: tới ngưỡng + 1 giây
        c.sock.settimeout(CHAT_MAX_MS / 1000 + 1)
        c.request("POST", (u.path or "/") + ("?" + u.query if u.query else ""), body=body,
                  headers={"Content-Type": "application/json", "Accept": "text/event-stream", "x-ollama-seckey": key, "User-Agent": "neu-healthz"})
        r = c.getresponse()
        if r.status != 200:
            r.read(2048)
            c.close()
            return {"ok": False, "ms": ms(), "detail": "HTTP %d" % r.status, "at": int(t0)}
        if "json" in (r.getheader("Content-Type") or ""):   # máy chủ không stream: cả câu trả lời là "token đầu"
            if (json.loads(r.read(65536) or b"{}").get("choices")):
                first = ms()
        else:
            while time.time() - t0 < CHAT_MAX_MS / 1000 + 1:
                line = r.readline(65536)
                if not line:
                    break
                if not line.startswith(b"data:"):
                    continue
                d = line[5:].strip()
                if d == b"[DONE]":
                    break
                try:
                    j = json.loads(d)
                except ValueError:
                    continue
                if isinstance(j, dict) and j.get("choices"):
                    first = ms()
                    break
        c.close()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "ms": ms(), "detail": type(e).__name__, "at": int(t0)}
    if first is None:
        return {"ok": False, "ms": ms(), "detail": "không có token", "at": int(t0)}
    ok = first <= CHAT_MAX_MS
    return {"ok": ok, "ms": first, "detail": "token đầu %d ms" % first + ("" if ok else " > ngưỡng %d" % CHAT_MAX_MS), "at": int(t0)}


def _days_level(days, what):
    if days < 0:
        return {"ok": False, "warn": False, "days": days, "detail": "%s đã hết hạn" % what}
    return {"ok": True, "warn": days < WARN_DAYS, "days": days, "detail": "%s còn %d ngày" % (what, days)}


def entra_check(now):
    """Hạn client secret Entra từ tệp quản trị viên khai (dòng đầu không phải chú thích: YYYY-MM-DD). Chưa khai → None (bỏ qua)."""
    p = _cred("entra-secret-expires", ENTRA_FILE)
    try:
        with open(p, encoding="utf-8") as f:
            lines = [x.strip() for x in f.read(4096).splitlines() if x.strip() and not x.strip().startswith("#")]
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {"ok": True, "warn": True, "detail": "không đọc được tệp hạn secret (cần YYYY-MM-DD)"}
    try:
        if not lines or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", lines[0]):
            raise ValueError
        exp = datetime.date.fromisoformat(lines[0])
    except ValueError:
        return {"ok": True, "warn": True, "detail": "tệp hạn secret sai định dạng (cần YYYY-MM-DD)"}
    return _days_level((exp - datetime.date.fromtimestamp(now)).days, "secret Entra")


_HOST = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}\.)*[A-Za-z0-9-]{1,63}"


def parse_targets(spec):
    """"tên@ip:cổng,…" → [(tên, địa chỉ kết nối, cổng)]. Kết nối thẳng tới ip (không cần DNS), SNI = tên. Mục sai bị bỏ."""
    out = []
    for item in (x.strip() for x in (spec or "").split(",")):
        m = re.fullmatch(r"(%s)(?:@([0-9A-Fa-f.:]+?|%s)(?::(\d{1,5}))?)?" % (_HOST, _HOST), item)
        if not m or (m.group(3) and not 0 < int(m.group(3)) < 65536):
            continue
        out.append((m.group(1), m.group(2) or m.group(1), int(m.group(3) or 443)))
    return out


def fetch_not_after(host, ip, port, cafile=None):
    ctx = ssl.create_default_context(cafile=cafile)
    with socket.create_connection((ip, port), timeout=TIMEOUT) as s:
        with ctx.wrap_socket(s, server_hostname=host) as ss:
            return ss.getpeercert()["notAfter"]


def tls_check(targets, now, fetch=fetch_not_after):
    """Hạn chứng chỉ HTTPS (lấy tên miền sắp hết nhất). Hết hạn = lỗi; không kiểm được (mạng, chứng chỉ lạ) = cảnh báo. Không ghi tên miền/IP."""
    if not targets:
        return None
    worst, problem = None, None
    for host, ip, port in targets:
        try:
            days = int((ssl.cert_time_to_seconds(fetch(host, ip, port)) - now) // 86400)
        except ssl.SSLCertVerificationError as e:
            if getattr(e, "verify_code", None) == 10:  # X509_V_ERR_CERT_HAS_EXPIRED
                days = -1
            else:
                problem = "chứng chỉ không xác minh được (mã %s)" % getattr(e, "verify_code", "?")
                continue
        except (OSError, ValueError, KeyError) as e:
            problem = "không kết nối được (%s)" % type(e).__name__
            continue
        if worst is None or days < worst:
            worst = days
    if worst is not None and (worst < 0 or problem is None):
        return _days_level(worst, "chứng chỉ HTTPS")
    r = _days_level(worst, "chứng chỉ HTTPS") if worst is not None else {"ok": True, "detail": ""}
    r.update(warn=True, detail=(problem + ("; " + r["detail"] if r["detail"] else "")))
    return r


def disk_check(paths=None):
    worst, bad = None, []
    for p in paths or DISK_PATHS:
        try:
            u = shutil.disk_usage(p)
        except OSError:
            continue
        free_pct = 100.0 * u.free / u.total if u.total else 100.0
        if free_pct < MIN_FREE_PCT or u.free < MIN_FREE_GB * 1024 ** 3:
            bad.append(p)
        if worst is None or free_pct < worst:
            worst = free_pct
    return {"ok": not bad, "detail": ("free min %.0f%%" % worst if worst is not None else "no path") + (" LOW:" + ",".join(bad) if bad else "")}


def _previous_chat(now):
    """Kết quả chat lần trước nếu còn tốt và chưa quá CHAT_EVERY_S (khỏi gọi mô hình mỗi 5 phút)."""
    try:
        with open(HEALTH_FILE, encoding="utf-8") as f:
            c = json.load(f)["checks"]["chat"]
        if c.get("ok") is True and not c.get("warn") and 0 <= now - float(c["at"]) < CHAT_EVERY_S:
            return c
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return None


def run():
    now = time.time()
    checks = {
        "oauth2": http_check(CHECKS["oauth2"]),
        "gateway": http_check(CHECKS["gateway"], accept_any_status=True),  # chỉ cần máy chủ trả lời HTTP (có thể 401/404 vì không kèm key)
        "chat": _previous_chat(now) or chat_check(read_key()),            # còn vLLM trả lời thật hay không thì xem mục này
        "collector": http_check(CHECKS["collector"], want_ok_json=True),
        "quota": http_check(CHECKS["quota"], want_ok_json=True),
        "disk": disk_check(),
    }
    for name, c in (("entra_secret", entra_check(now)), ("tls", tls_check(parse_targets(TLS_HOSTS), now))):
        if c is not None:
            checks[name] = c
    return {"ts": int(now), "ok": all(c["ok"] for c in checks.values()), "checks": checks, "warn": [k for k, c in checks.items() if c["ok"] and c.get("warn")]}


def write_health(h):
    os.makedirs(os.path.dirname(HEALTH_FILE), exist_ok=True)
    tmp = HEALTH_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f)
    os.chmod(tmp, 0o640)
    os.replace(tmp, HEALTH_FILE)


def log_failure(h, max_bytes=1_000_000):
    bad = ", ".join("%s(%s)" % (k, v.get("detail", "")) for k, v in h["checks"].items() if not v["ok"])
    line = "%s FAIL %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(h["ts"])), bad)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    try:
        if os.path.getsize(LOG_FILE) > max_bytes:  # giữ ~200 KB cuối
            with open(LOG_FILE, "rb") as f:
                f.seek(-200_000, os.SEEK_END)
                tail = f.read().split(b"\n", 1)[-1]
            with open(LOG_FILE, "wb") as f:
                f.write(tail)
    except OSError:
        pass
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line)


def main():
    h = run()
    try:
        write_health(h)
        if not h["ok"]:
            log_failure(h)
    except OSError as e:
        print("healthz: không ghi được kết quả: %s" % e.strerror, file=sys.stderr)
        return 2
    print(json.dumps({"ok": h["ok"], "failed": [k for k, v in h["checks"].items() if not v["ok"]], "warn": h["warn"]}))
    return 0 if h["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
