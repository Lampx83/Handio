#!/usr/bin/env python3
"""Hando - QUẢN LÝ HẠN MỨC TOKEN trên trang quản trị (máy 220): xem ai đã hết/gần hết hạn mức hôm nay và cấp thêm nhanh.

Chỉ thư viện chuẩn. Được collector.py gọi (đường /admin/api/quota, chỉ quản trị viên).

Cách làm: cổng hạn mức (deploy/220/quota/quota.py) đếm token theo mã giả danh và chặn khi hết. Quản trị viên cấp thêm bằng cách ghi
`grants.json` ({"days": {"YYYY-MM-DD": {"<uid 16 hex>": tổng token cấp thêm}}, "audit": [...]}); cổng chỉ ĐỌC tệp này và cộng vào hạn mức của
ĐÚNG ngày hôm nay (qua 00:00 giờ VN là hết). Không đụng /etc/neu-agent/quota.json, không đổi hạn mức mặc định hay ngoại lệ lâu dài
(việc đó vẫn do `quota.sh`).

Tên tài khoản (email/tên đăng nhập) lấy từ sổ "ai đã dùng" của collector (Registry; chỉ quản trị viên xem được); người chưa có trong sổ hiện
bằng mã giả danh nhưng vẫn cấp thêm được.
"""
import datetime
import json
import os
import re
import sqlite3
import threading

TZ = datetime.timezone(datetime.timedelta(hours=7))
UID_RE = re.compile(r"^[0-9a-f]{16}$")
MAX_STEP = 100_000_000          # mỗi lần bấm tối đa
MAX_EXTRA = 1_000_000_000       # tổng cấp thêm trong một ngày cho một người
AUDIT_KEEP = 50
KEEP_DAYS = 3                   # chỉ giữ phần cấp thêm của vài ngày gần đây
MAX_ROWS = 300

_lock = threading.Lock()


def vn_day(ts):
    return datetime.datetime.fromtimestamp(ts, TZ).date().isoformat()


def read_state(path):
    """{"days": {...}, "audit": [...]} đã kiểm tra kiểu; tệp thiếu/hỏng cho trạng thái rỗng."""
    out = {"days": {}, "audit": []}
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        for day, users in (d.get("days") or {}).items():
            if isinstance(day, str) and isinstance(users, dict):
                out["days"][day] = {u: v for u, v in users.items() if UID_RE.match(str(u)) and isinstance(v, int) and not isinstance(v, bool) and 0 < v <= MAX_EXTRA}
        out["audit"] = [a for a in (d.get("audit") or []) if isinstance(a, dict)][-AUDIT_KEEP:]
    except (OSError, ValueError, AttributeError):
        pass
    return out


def _write(path, state):
    tmp = path + ".tmp"
    data = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, path)


def grant(path, now, uid, amount, actor, label=""):
    """Cộng `amount` token cho `uid` trong ngày hôm nay (amount < 0 không hợp lệ; amount == 0 = bỏ phần đã cấp thêm hôm nay).
    Trả {"ok": True, "extra": tổng hôm nay} hoặc {"ok": False, "error": mã, "message": tiếng Việt}."""
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return {"ok": False, "error": "bad_uid", "message": "Mã người dùng không hợp lệ."}
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0 or amount > MAX_STEP:
        return {"ok": False, "error": "bad_amount", "message": "Số token cấp thêm phải từ 0 đến %s." % format(MAX_STEP, ",").replace(",", ".")}
    day = vn_day(now)
    with _lock:
        st = read_state(path)
        cur = st["days"].setdefault(day, {})
        old = cur.get(uid, 0)
        new = 0 if amount == 0 else old + amount
        if new > MAX_EXTRA:
            return {"ok": False, "error": "too_much", "message": "Tổng cấp thêm trong ngày cho một người tối đa %s token." % format(MAX_EXTRA, ",").replace(",", ".")}
        if new:
            cur[uid] = new
        else:
            cur.pop(uid, None)
        keep = {d for d in st["days"] if d >= vn_day(now - KEEP_DAYS * 86400)}
        st["days"] = {d: v for d, v in st["days"].items() if d in keep and v}
        st["audit"].append({"ts": int(now), "actor": str(actor)[:200], "uid": uid, "who": str(label)[:200], "add": amount, "total": new, "day": day})
        st["audit"] = st["audit"][-AUDIT_KEEP:]
        try:
            _write(path, st)
        except OSError:
            return {"ok": False, "error": "failed", "message": "Không ghi được tệp cấp thêm. Xem nhật ký dịch vụ neu-agent-diag."}
    return {"ok": True, "extra": new}


def list_users(db_path, grants_path, now, names):
    """Người dùng có đếm token HÔM NAY: hết/gần hết lên đầu. `names`: {uid: tên hiển thị} (từ sổ Registry; có thể thiếu).
    Hạn mức hiệu lực = hạn mức gốc (cổng ghi lúc yêu cầu gần nhất, đã trừ phần cấp thêm lúc đó) + phần cấp thêm hiện tại."""
    day = vn_day(now)
    extra_now = read_state(grants_path)["days"].get(day, {})
    try:
        db = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=3)
    except sqlite3.Error:
        return None
    try:
        try:
            rows = db.execute("SELECT uid,tier,lim,tokens,requests,blocked,extra FROM usage WHERE day=?", (day,)).fetchall()
        except sqlite3.OperationalError:   # CSDL cũ chưa có cột extra
            rows = [r + (0,) for r in db.execute("SELECT uid,tier,lim,tokens,requests,blocked FROM usage WHERE day=?", (day,)).fetchall()]
    except sqlite3.Error:
        return None
    finally:
        db.close()
    users = []
    for uid, tier, lim, tokens, req, blocked, stored_extra in rows:
        extra = extra_now.get(uid, 0)
        limit = None if lim < 0 else max(lim - stored_extra, 0) + extra
        pct = None if limit is None else (100.0 * tokens / limit if limit else 100.0)
        state = "unlimited" if limit is None else "over" if pct >= 100 else "near" if pct >= 80 else "ok"
        users.append({"uid": uid, "name": names.get(uid), "tier": tier, "tokens": tokens, "limit": limit, "extra": extra,
                      "pct": None if pct is None else round(pct, 1), "requests": req, "blocked": blocked, "state": state})
    order = {"over": 0, "near": 1, "ok": 2, "unlimited": 3}
    users.sort(key=lambda u: (order[u["state"]], -(u["pct"] or 0), -u["tokens"]))
    return {"day": day, "users": users[:MAX_ROWS], "total": len(users), "over": sum(1 for u in users if u["state"] == "over"),
            "near": sum(1 for u in users if u["state"] == "near")}
