#!/usr/bin/env python3
"""NEU Agent - kiểm tra sức khoẻ máy 220 (chạy mỗi 5 phút bằng systemd timer). Chỉ dùng thư viện chuẩn của Python 3.

Kiểm tra: oauth2-proxy /ping, cổng mô hình (TCP + HTTP trả lời), dung lượng đĩa, bộ thu chẩn đoán còn sống,
và kết quả sao lưu dữ liệu (nếu đã cài backup/: lần gần nhất lỗi, quá 36 giờ chưa có bản mới, đẩy sang máy ngoài lỗi).
Ghi /var/lib/neu-agent/health.json (chi tiết, quyền 0640, KHÔNG phục vụ ra ngoài) và thêm một dòng vào health.log mỗi lần có lỗi.
nginx /agent/healthz chỉ trả {"ok":true|false} (do bộ thu đọc health.json; file cũ >15 phút => false).
Sao lưu chỉ là cảnh báo ("warn"): không làm "ok" thành false, vì dịch vụ vẫn chạy bình thường; alerts.py báo riêng.
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
BACKUP_STATUS = E("NEU_HEALTH_BACKUP_STATUS", "/var/lib/neu-agent-backup/status.json")   # backup.py ghi, chỉ có số
BACKUP_MAX_AGE_H = float(E("NEU_HEALTH_BACKUP_MAX_AGE_H", "36"))
WARN_ONLY = ("backup",)  # báo trong health.json/nhật ký/cảnh báo nhưng không làm /agent/healthz đỏ
BACKUP_DETAIL = {"failed": "lần gần nhất lỗi", "stale": "quá hạn, chưa có bản mới", "push_failed": "đẩy sang máy ngoài lỗi",
                 "unreadable": "không đọc được trạng thái"}


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


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def backup_check(path=None, now=None):
    """Kết quả sao lưu dữ liệu. Chưa cài sao lưu (không có tệp trạng thái) → None: bỏ qua."""
    now = time.time() if now is None else now
    try:
        with open(path or BACKUP_STATUS, encoding="utf-8") as f:
            st = json.load(f)
        if not isinstance(st, dict):
            raise ValueError
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return {"ok": False, "reason": "unreadable", "age_h": None, "detail": BACKUP_DETAIL["unreadable"]}
    last_ok = _num(st.get("last_ok"))
    age_h = round((now - last_ok) / 3600, 1) if last_ok is not None else None
    if st.get("ok") is not True:
        reason = "failed"
    elif age_h is None or age_h > BACKUP_MAX_AGE_H:
        reason = "stale"
    elif st.get("pushed") is False:
        reason = "push_failed"
    else:
        reason = "ok"
    since = "bản tốt gần nhất cách %d giờ" % age_h if age_h is not None else "chưa có bản tốt"
    detail = since if reason == "ok" else BACKUP_DETAIL[reason] + "; " + since
    return {"ok": reason == "ok", "reason": reason, "age_h": age_h, "detail": detail}


def run():
    checks = {
        "oauth2": http_check(CHECKS["oauth2"]),
        "gateway": http_check(CHECKS["gateway"], accept_any_status=True),  # chỉ cần máy chủ trả lời HTTP (có thể 401/404 vì không kèm key)
        "collector": http_check(CHECKS["collector"], want_ok_json=True),
        "quota": http_check(CHECKS["quota"], want_ok_json=True),
        "disk": disk_check(),
    }
    b = backup_check()
    if b is not None:
        checks["backup"] = b
    return {"ts": int(time.time()), "ok": all(c["ok"] for k, c in checks.items() if k not in WARN_ONLY), "checks": checks,
            "warn": [k for k in WARN_ONLY if k in checks and not checks[k]["ok"]]}


def write_health(h):
    os.makedirs(os.path.dirname(HEALTH_FILE), exist_ok=True)
    tmp = HEALTH_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f)
    os.chmod(tmp, 0o640)
    os.replace(tmp, HEALTH_FILE)


def log_failure(h, max_bytes=1_000_000):
    bad = ", ".join("%s(%s)" % (k, v.get("detail", "")) for k, v in h["checks"].items() if not v["ok"])
    line = "%s %s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(h["ts"])), "FAIL" if not h["ok"] else "WARN", bad)
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
        if not h["ok"] or h["warn"]:
            log_failure(h)
    except OSError as e:
        print("healthz: không ghi được kết quả: %s" % e.strerror, file=sys.stderr)
        return 2
    print(json.dumps({"ok": h["ok"], "failed": [k for k, v in h["checks"].items() if not v["ok"] and k not in WARN_ONLY], "warn": h["warn"]}))
    return 0 if h["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
