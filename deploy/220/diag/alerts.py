#!/usr/bin/env python3
"""NEU Agent - cảnh báo chủ động (máy 220). Chỉ dùng thư viện chuẩn của Python 3.

Đọc stats.json (số liệu TỔNG HỢP do stats.py tạo) và health.json (gồm cả kết quả sao lưu dữ liệu), so với ngưỡng, rồi gửi một tin ngắn tới webhook
(Microsoft Teams / Slack / Mattermost… nhận {"text": "..."}) khi có vấn đề, và một tin khi vấn đề hết. KHÔNG có webhook thì không làm gì.

Tin chỉ có số liệu tổng hợp: không nội dung hội thoại, không mã người dùng, không email, không đường dẫn.
URL webhook là bí mật: nằm ở /etc/neu-agent/alert-webhook (0600, root), nạp qua LoadCredential, không bao giờ vào kho hay nhật ký.
Mỗi cảnh báo chỉ nhắc lại sau 6 giờ nếu vẫn còn; trạng thái ở /var/lib/neu-agent/alerts/state.json.

  python3 alerts.py [--stats F] [--health F] [--state F] [--webhook-file F] [--dry-run] [--now epoch]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

COOLDOWN_S = 6 * 3600
WARN_ONLY = ("backup",)  # healthz: chỉ cảnh báo, báo riêng bên dưới (không gộp vào "health")
BACKUP_ALERTS = {
    "failed": ("backup_failed", "cao", "Sao lưu dữ liệu lần gần nhất THẤT BẠI (%s). Xem: sudo neu-agent-backup list; journalctl -u neu-agent-backup."),
    "stale": ("backup_stale", "cao", "Đã %s chưa có bản sao lưu dữ liệu mới (lịch neu-agent-backup.timer có thể đã dừng)."),
    "push_failed": ("backup_push", "trung bình", "Bản sao lưu dữ liệu mới chưa đẩy được sang máy ngoài (bản trên máy vẫn có; %s)."),
    "unreadable": ("backup_status", "trung bình", "Không đọc được trạng thái sao lưu dữ liệu (tệp hỏng hoặc sai quyền). Xem: sudo neu-agent-backup list."),
}
TH = {"turns_min": 20, "error_rate": 0.20, "chat_min": 50, "gateway_5xx": 0.05, "blocked_users": 5, "stale_events_s": 6 * 3600, "stats_stale_s": 3600, "health_stale_s": 900}


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def evaluate(stats, health, now, health_age=None, stats_age=None):
    """Danh sách cảnh báo đang xảy ra: [{"key", "sev", "text"}]. Chỉ số liệu tổng hợp."""
    out = []
    if not isinstance(stats, dict):
        return [{"key": "stats_missing", "sev": "cao", "text": "Không đọc được stats.json: trang quản trị không được làm mới."}]
    k = stats.get("kpi") or {}
    turns, er = k.get("turns_24h") or 0, k.get("error_rate_24h")
    if turns >= TH["turns_min"] and er is not None and er >= TH["error_rate"]:
        out.append({"key": "turn_errors", "sev": "cao", "text": "Tỷ lệ lượt kết thúc bằng lỗi 24 giờ qua: %d%% (%d trên %d lượt)." % (round(100 * er), k.get("errors_24h") or 0, turns)})
    r = stats.get("recent") or {}
    if (r.get("chat_24h") or 0) >= TH["chat_min"] and r.get("chat_5xx_24h", 0) / r["chat_24h"] >= TH["gateway_5xx"]:
        out.append({"key": "gateway_5xx", "sev": "cao", "text": "Cổng mô hình lỗi 5xx: %d trên %d lệnh trong 24 giờ qua (%d%%)." % (r["chat_5xx_24h"], r["chat_24h"], round(100 * r["chat_5xx_24h"] / r["chat_24h"]))})
    q = stats.get("quota") or {}
    if (q.get("blocked_users") or 0) >= TH["blocked_users"]:
        out.append({"key": "quota_blocked", "sev": "trung bình", "text": "%d người đã bị chặn vì hết hạn mức token hôm nay (%d yêu cầu bị từ chối)." % (q["blocked_users"], q.get("blocked_requests") or 0)})
    sysinfo = stats.get("system") or {}
    age = sysinfo.get("newest_event_age_s")
    if age is not None and age > TH["stale_events_s"] and (k.get("turns_7d") or 0) > 50:
        out.append({"key": "data_stale", "sev": "trung bình", "text": "Không nhận được dữ liệu chẩn đoán mới trong %d giờ (bộ thu hoặc ứng dụng có vấn đề?)." % (age // 3600)})
    if stats_age is not None and stats_age > TH["stats_stale_s"]:
        out.append({"key": "stats_stale", "sev": "trung bình", "text": "Trang quản trị không được làm mới trong %d phút (timer thống kê có thể đã dừng)." % (stats_age // 60)})
    if isinstance(health, dict):
        checks = health.get("checks") if isinstance(health.get("checks"), dict) else {}
        bad = [str(k)[:24] for k, v in checks.items() if isinstance(v, dict) and not v.get("ok") and k not in WARN_ONLY][:6] \
            or [str(x)[:24] for x in (health.get("failed") or [])][:6]
        if health.get("ok") is False or bad:
            out.append({"key": "health", "sev": "cao", "text": "Kiểm tra sức khoẻ hệ thống có lỗi: %s." % (", ".join(bad) or "không rõ thành phần")})
        b = checks.get("backup")
        if isinstance(b, dict) and not b.get("ok"):
            key, sev, text = BACKUP_ALERTS.get(b.get("reason"), BACKUP_ALERTS["unreadable"])
            age = b.get("age_h")
            age = "%d giờ" % age if isinstance(age, (int, float)) and not isinstance(age, bool) else None
            arg = (age or "nhiều giờ") if b.get("reason") == "stale" else ("bản tốt gần nhất cách " + age) if age else "chưa có bản nào thành công"
            out.append({"key": key, "sev": sev, "text": text % arg if "%s" in text else text})
    if health_age is not None and health_age > TH["health_stale_s"]:
        out.append({"key": "health_stale", "sev": "trung bình", "text": "Dữ liệu kiểm tra sức khoẻ đã cũ (%d phút): dịch vụ healthz có thể đã dừng." % (health_age // 60)})
    return out


def decide(alerts, state, now, cooldown=COOLDOWN_S):
    """Trả (cần báo, đã hết, trạng thái mới). Báo lần đầu và nhắc lại sau cooldown; báo 'đã hết' một lần khi một cảnh báo đã gửi biến mất."""
    old = (state or {}).get("firing") or {}
    new, fire, done = {}, [], []
    for a in alerts:
        prev = old.get(a["key"])
        if prev is None:
            new[a["key"]] = {"since": now, "notified": now}
            fire.append(a)
        elif now - prev.get("notified", 0) >= cooldown:
            new[a["key"]] = {"since": prev.get("since", now), "notified": now}
            fire.append(a)
        else:
            new[a["key"]] = prev
    for key, prev in old.items():
        if key not in new:
            done.append({"key": key, "since": prev.get("since", now)})
    return fire, done, {"firing": new}


def message(fire, done, host="NEU Agent"):
    lines = []
    if fire:
        lines.append("⚠️ %s: %d cảnh báo" % (host, len(fire)))
        lines += ["• [%s] %s" % (a["sev"], a["text"]) for a in fire]
    if done:
        lines.append("✅ %s: đã hết — %s" % (host, ", ".join(d["key"] for d in done)))
    return "\n".join(lines)


def read_webhook(path):
    """URL https hợp lệ hoặc None. Ưu tiên tệp credential của systemd."""
    cands = []
    cred = os.environ.get("CREDENTIALS_DIRECTORY")
    if cred:
        cands.append(os.path.join(cred, "alert-webhook"))
    if path:
        cands.append(path)
    for p in cands:
        try:
            with open(p, encoding="utf-8") as f:
                url = f.read().strip()
        except OSError:
            continue
        if url.startswith("https://") and len(url) <= 2000 and not any(c.isspace() or ord(c) < 32 for c in url):
            return url
    return None


def send(url, text, timeout=8, opener=urllib.request.urlopen):
    req = urllib.request.Request(url, data=json.dumps({"text": text}).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    with opener(req, timeout=timeout) as r:
        return 200 <= r.status < 300


def run(stats_path, health_path, state_path, webhook, now, dry_run=False, sender=send):
    stats = _load(stats_path)
    health = _load(health_path)
    health_age = stats_age = None
    try:
        health_age = now - os.path.getmtime(health_path)
    except OSError:
        pass
    try:
        stats_age = now - os.path.getmtime(stats_path)
    except OSError:
        pass
    alerts = evaluate(stats, health, now, health_age, stats_age)
    fire, done, state = decide(alerts, _load(state_path), now)
    text = message(fire, done)
    sent = False
    if text and not dry_run:
        if webhook:
            try:
                sent = bool(sender(webhook, text))
            except (OSError, urllib.error.URLError, ValueError):
                sent = False
            if not sent:                    # gửi lỗi: giữ trạng thái cũ để lần sau thử lại
                return {"alerts": alerts, "sent": False, "text": text}
        else:
            sent = None                     # chưa cấu hình webhook: chỉ cập nhật trạng thái, không gửi
    if not dry_run:
        try:
            os.makedirs(os.path.dirname(state_path), exist_ok=True)
            tmp = state_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.replace(tmp, state_path)
        except OSError:
            pass
    return {"alerts": alerts, "sent": sent, "text": text}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stats", default=os.environ.get("NEU_ALERT_STATS", "/var/lib/neu-agent/reports/stats.json"))
    ap.add_argument("--health", default=os.environ.get("NEU_DIAG_HEALTH", "/var/lib/neu-agent/health.json"))
    ap.add_argument("--state", default=os.environ.get("NEU_ALERT_STATE", "/var/lib/neu-agent/alerts/state.json"))
    ap.add_argument("--webhook-file", default=os.environ.get("NEU_ALERT_WEBHOOK_FILE", "/etc/neu-agent/alert-webhook"))
    ap.add_argument("--dry-run", action="store_true", help="chỉ in, không gửi, không ghi trạng thái")
    ap.add_argument("--now", type=float)
    a = ap.parse_args(argv)
    now = a.now if a.now is not None else time.time()
    url = read_webhook(a.webhook_file)
    res = run(a.stats, a.health, a.state, url, now, a.dry_run)
    if a.dry_run or url is None:
        print(res["text"] or "Không có cảnh báo.")
    print("Cảnh báo đang có: %d · đã gửi: %s" % (len(res["alerts"]), {True: "có", False: "LỖI (sẽ thử lại)", None: "chưa cấu hình webhook"}.get(res["sent"], "không cần")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
