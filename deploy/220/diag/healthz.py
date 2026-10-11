#!/usr/bin/env python3
"""Handio - kiểm tra sức khoẻ máy 220 (chạy mỗi 5 phút bằng systemd timer). Chỉ dùng thư viện chuẩn của Python 3.

Kiểm tra: oauth2-proxy /ping, cổng mô hình (TCP + HTTP trả lời), dung lượng đĩa, bộ thu chẩn đoán còn sống.
Ghi /var/lib/neu-agent/health.json (chi tiết, quyền 0640, KHÔNG phục vụ ra ngoài) và thêm một dòng vào health.log mỗi lần có lỗi.
nginx /agent/healthz chỉ trả {"ok":true|false} (do bộ thu đọc health.json; file cũ >15 phút => false).
Thoát mã 1 nếu có lỗi (systemctl --failed sẽ hiện; timer vẫn tiếp tục).
"""
import http.client
import json
import os
import shutil
import sys
import time
import urllib.parse

E = os.environ.get
CHECKS = {
    "oauth2": E("NEU_HEALTH_OAUTH2", "http://127.0.0.1:4180/ping"),
    "gateway": E("NEU_HEALTH_GATEWAY", "http://192.0.2.10:8037/"),
    "collector": E("NEU_HEALTH_COLLECTOR", "http://127.0.0.1:4190/healthz"),
    "quota": E("NEU_HEALTH_QUOTA", "http://127.0.0.1:4191/healthz"),
}
HEALTH_FILE = E("NEU_HEALTH_FILE", "/var/lib/neu-agent/health.json")
LOG_FILE = E("NEU_HEALTH_LOG", "/var/log/neu-agent/health.log")
DISK_PATHS = [p for p in E("NEU_HEALTH_DISK_PATHS", "/,/var/lib/neu-agent,/var/log").split(",") if p]
MIN_FREE_PCT = float(E("NEU_HEALTH_MIN_FREE_PCT", "10"))
MIN_FREE_GB = float(E("NEU_HEALTH_MIN_FREE_GB", "1"))
TIMEOUT = float(E("NEU_HEALTH_TIMEOUT", "3"))


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


def run():
    checks = {
        "oauth2": http_check(CHECKS["oauth2"]),
        "gateway": http_check(CHECKS["gateway"], accept_any_status=True),  # chỉ cần máy chủ trả lời HTTP (có thể 401/404 vì không kèm key)
        "collector": http_check(CHECKS["collector"], want_ok_json=True),
        "quota": http_check(CHECKS["quota"], want_ok_json=True),
        "disk": disk_check(),
    }
    return {"ts": int(time.time()), "ok": all(c["ok"] for c in checks.values()), "checks": checks}


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
    print(json.dumps({"ok": h["ok"], "failed": [k for k, v in h["checks"].items() if not v["ok"]]}))
    return 0 if h["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
