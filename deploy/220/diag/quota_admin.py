#!/usr/bin/env python3
"""NEU Agent - QUẢN LÝ HẠN MỨC TOKEN trên trang quản trị (máy 220): xem ai đã hết/gần hết hạn mức hôm nay và cấp thêm nhanh.

Chỉ thư viện chuẩn. Được collector.py gọi (đường /admin/api/quota, chỉ quản trị viên).

Cách làm: cổng hạn mức (deploy/220/quota/quota.py) đếm token theo mã giả danh và chặn khi hết. Quản trị viên cấp thêm bằng cách ghi
`grants.json` ({"days": {"YYYY-MM-DD": {"<uid 16 hex>": tổng token cấp thêm}}, "audit": [...]}); cổng chỉ ĐỌC tệp này và cộng vào hạn mức của
ĐÚNG ngày hôm nay (qua 00:00 giờ VN là hết). Không đụng /etc/neu-agent/quota.json, không đổi hạn mức mặc định hay ngoại lệ lâu dài
(việc đó vẫn do `quota.sh`).

Tên tài khoản (email/tên đăng nhập) lấy từ sổ "ai đã dùng" của collector (Registry; chỉ quản trị viên xem được); người chưa có trong sổ hiện
bằng mã giả danh nhưng vẫn cấp thêm được.

NHÓM TUỲ TẠO (groups.json, cùng thư mục): quản trị viên gán email/tài khoản vào nhóm ("lop-k66-cntt"); nhóm ghi đè bậc theo miền email về hạn mức,
tab, mô hình và hạn mức theo tab. Tệp này là nơi ghi DUY NHẤT cho cả trang quản trị lẫn `quota.sh group …` (gọi `python3 -I quota_admin.py group …`
bằng root); cổng hạn mức chỉ đọc (quota.py: parse_groups) và nạp lại khi tệp đổi. Ghi nguyên tử, có khoá tệp, quyền 0600, an toàn với liên kết tượng trưng
(root ghi vào thư mục của neu-diag). Tệp đang hỏng thì từ chối ghi (không xoá mất danh sách).
"""
import datetime
import fcntl
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time

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


# ---------------------------------------------------------------- nhóm tuỳ tạo (groups.json)
GROUP_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,39}$")
EMAIL_RE = re.compile(r"^[a-z0-9._%+'-]{1,64}@[a-z0-9.-]{1,190}$")      # như quota.py (đã viết thường)
USER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
MODEL_ID_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,100}$")
TABS = ("work", "code", "design")
MAX_GROUPS = 200
MAX_MEMBERS = 20000
MAX_PER_CALL = 500
MAX_TOKENS = 10 ** 12
GROUP_AUDIT_KEEP = 100
GROUP_FIELDS = ("limit", "tabs", "models", "tab_limits")
_glock = threading.Lock()


def _fail(error, message):
    return {"ok": False, "error": error, "message": message}


def norm_ident(s):
    i = s.strip().lower() if isinstance(s, str) else ""
    return i if (EMAIL_RE.match(i) or USER_RE.match(i)) else ""


def _count(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_TOKENS


def check_field(field, v):
    """Kiểm tra giá trị một trường của nhóm (None = theo bậc). Trả (giá trị đã chuẩn hoá, lỗi hoặc None)."""
    if v is None:
        return None, None
    if field == "limit":
        return (v, None) if v == "unlimited" or _count(v) else (None, "Hạn mức phải là số token/ngày (0 đến 10^12) hoặc unlimited.")
    if field == "tabs":
        if not isinstance(v, list) or any(t not in TABS for t in v):
            return None, "Danh sách tab chỉ gồm work, code, design."
        return [t for t in TABS if t in v], None
    if field == "models":
        if not isinstance(v, list) or not v or len(v) > 50:
            return None, "Danh sách mô hình phải có 1 đến 50 tên (hoặc * = mọi mô hình)."
        if "*" in v:
            return ["*"], None
        if any(not isinstance(m, str) or not MODEL_ID_RE.match(m) for m in v):
            return None, "Tên mô hình không hợp lệ (chỉ chữ, số và . _ : / -)."
        out = []
        for m in v:
            if m not in out:
                out.append(m)
        return out, None
    if field == "tab_limits":
        if not isinstance(v, dict) or any(t not in TABS for t in v) or any(x is not None and not _count(x) for x in v.values()):
            return None, "Hạn mức theo tab: {work|code|design: số token/ngày}."
        out = {t: v[t] for t in TABS if v.get(t) is not None}
        return (out or None), None
    return None, "Trường không hợp lệ."


def _open_nofollow(path, flags, mode=0o600):
    return os.open(path, flags | getattr(os, "O_NOFOLLOW", 0), mode)


def read_groups(path):
    """{"groups": {...}, "audit": [...], "error": bool}. Tệp thiếu = rỗng; tệp hỏng = rỗng + error (không ghi đè được)."""
    out = {"groups": {}, "audit": [], "error": False}
    if not path:
        return out
    try:
        fd = _open_nofollow(path, os.O_RDONLY)
    except FileNotFoundError:
        return out
    except OSError:
        out["error"] = True
        return out
    try:
        with os.fdopen(fd, encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict) or not isinstance(d.get("groups"), dict):
            raise ValueError
        for name, spec in d["groups"].items():
            if isinstance(name, str) and GROUP_RE.match(name) and isinstance(spec, dict):
                mem = spec.get("members") if isinstance(spec.get("members"), list) else []
                g = {"members": [m for m in mem if isinstance(m, str) and norm_ident(m) == m]}
                for k in GROUP_FIELDS:
                    if spec.get(k) is not None:
                        g[k] = spec[k]
                out["groups"][name] = g
        out["audit"] = [a for a in (d.get("audit") or []) if isinstance(a, dict)][-GROUP_AUDIT_KEEP:]
    except (OSError, ValueError, AttributeError, TypeError):
        return {"groups": {}, "audit": [], "error": True}
    return out


def _write_groups(path, state):
    """Ghi nguyên tử: tệp tạm ngẫu nhiên (O_EXCL, không theo liên kết) cùng thư mục, 0600; khi chạy bằng root thì trao lại cho chủ thư mục (neu-diag)."""
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".groups-")
    try:
        os.fchmod(fd, 0o600)
        if os.geteuid() == 0:
            st = os.stat(d)
            os.fchown(fd, st.st_uid, st.st_gid)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"v": 1, "groups": state["groups"], "audit": state["audit"][-GROUP_AUDIT_KEEP:]}, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class _FileLock:
    """Khoá giữa các tiến trình (trang quản trị và quota.sh) để không ghi đè thay đổi của nhau."""

    def __init__(self, path):
        self.path = os.path.join(os.path.dirname(path) or ".", ".groups.lock")

    def __enter__(self):
        self.fd = _open_nofollow(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        if os.geteuid() == 0:
            st = os.stat(os.path.dirname(self.path) or ".")
            os.fchown(self.fd, st.st_uid, st.st_gid)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        os.close(self.fd)


def group_op(path, now, actor, op, name, idents=None, field=None, value=None):
    """Một thao tác trên nhóm: create | delete | add | remove | set. Trả {"ok": True, ...} hoặc {"ok": False, "error", "message"}."""
    if op not in ("create", "delete", "add", "remove", "set"):
        return _fail("bad_request", "Thao tác không hợp lệ.")
    if not isinstance(name, str) or not GROUP_RE.match(name):
        return _fail("bad_name", "Tên nhóm: 2–40 ký tự thường, số, - hoặc _ (ví dụ lop-k66-cntt).")
    norm = []
    if op in ("add", "remove"):
        if not isinstance(idents, list) or not idents or len(idents) > MAX_PER_CALL:
            return _fail("bad_ident", "Cần 1 đến %d email/tên đăng nhập." % MAX_PER_CALL)
        bad = [str(i)[:80] for i in idents if not norm_ident(i)]
        if bad:
            return _fail("bad_ident", "Email/tên đăng nhập không hợp lệ: %s" % ", ".join(bad[:5]))
        for i in idents:
            if norm_ident(i) not in norm:
                norm.append(norm_ident(i))
    if op == "set":
        if field not in GROUP_FIELDS:
            return _fail("bad_field", "Trường không hợp lệ.")
        value, err = check_field(field, value)
        if err:
            return _fail("bad_value", err)
    with _glock, _FileLock(path):
        st = read_groups(path)
        if st["error"]:
            return _fail("broken", "Tệp nhóm đang hỏng (groups.json): sửa hoặc khôi phục trước khi ghi, để không mất danh sách.")
        gs = st["groups"]
        detail = ""
        if op == "create":
            if name in gs:
                return _fail("exists", "Nhóm %s đã có." % name)
            if len(gs) >= MAX_GROUPS:
                return _fail("too_many", "Tối đa %d nhóm." % MAX_GROUPS)
            gs[name] = {"members": []}
        elif name not in gs:
            return _fail("not_found", "Không có nhóm %s." % name)
        elif op == "delete":
            detail = "%d thành viên" % len(gs[name]["members"])
            del gs[name]
        elif op == "add":
            other = {m: g for g, s in gs.items() if g != name for m in s["members"]}
            clash = [m for m in norm if m in other]
            if clash:
                return _fail("in_other_group", "Đã thuộc nhóm khác (mỗi người một nhóm; bỏ khỏi nhóm cũ trước): %s" % ", ".join("%s (%s)" % (m, other[m]) for m in clash[:5]))
            new = [m for m in norm if m not in gs[name]["members"]]
            if sum(len(s["members"]) for s in gs.values()) + len(new) > MAX_MEMBERS:
                return _fail("too_many", "Tổng số thành viên các nhóm tối đa %d." % MAX_MEMBERS)
            gs[name]["members"] = sorted(gs[name]["members"] + new)
            detail = ", ".join(new)
        elif op == "remove":
            gone = [m for m in norm if m in gs[name]["members"]]
            gs[name]["members"] = [m for m in gs[name]["members"] if m not in norm]
            detail = ", ".join(gone)
        else:
            if value is None:
                gs[name].pop(field, None)
            else:
                gs[name][field] = value
            detail = "%s=%s" % (field, "theo bậc" if value is None else json.dumps(value, ensure_ascii=False))
        st["audit"].append({"ts": int(now), "actor": str(actor)[:200], "op": op, "group": name, "detail": detail[:2000]})
        try:
            _write_groups(path, st)
        except OSError:
            return _fail("failed", "Không ghi được tệp nhóm. Xem nhật ký dịch vụ.")
    return {"ok": True, "group": name, "members": len(gs[name]["members"]) if name in gs else 0}


def group_index(groups):
    """{danh tính: tên nhóm} (nhóm tên đứng trước theo chữ cái thắng nếu trùng, giống cổng hạn mức)."""
    idx = {}
    for name in sorted(groups):
        for m in groups[name]["members"]:
            idx.setdefault(m, name)
    return idx


def read_policy(path):
    """Bản xem cấu hình bậc do cổng hạn mức ghi (policy.json; không có email). None nếu chưa có."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(d, dict):
        return None
    keep = ("mode", "tiers", "domains", "default_tier", "tabs", "models", "tab_limits", "grace_pct", "warn_pct", "max_concurrent", "overrides", "capture", "groups_error")
    return {k: d[k] for k in keep if k in d}


# ---------------------------------------------------------------- dòng lệnh (quota.sh group …, chạy bằng root)
CLI_HELP = """Nhóm tuỳ tạo (ghi đè bậc theo miền email; áp dụng ngay, không cần khởi động lại):
  quota.sh group list                                  các nhóm + số thành viên + cấu hình
  quota.sh group show <nhóm>                           thành viên của một nhóm
  quota.sh group of <email|tên>                        người này thuộc nhóm nào
  quota.sh group create <nhóm> | delete <nhóm>
  quota.sh group add <nhóm> <email|tên> [...]          thêm (mỗi người một nhóm)
  quota.sh group remove <nhóm> <email|tên> [...]
  quota.sh group limit <nhóm> <số|unlimited|default>   hạn mức token/ngày; default = theo bậc
  quota.sh group tabs <nhóm> <work,code,design|none|default>
  quota.sh group models <nhóm> <tên1,tên2|*|default>   * = mọi mô hình
  quota.sh group tablimit <nhóm> <work|code|design> <số|default>"""


def _num(s):
    if not re.fullmatch(r"[0-9][0-9.,]*", s):
        raise ValueError(s)
    return int(s.replace(".", "").replace(",", ""))


def _fmt(g):
    parts = []
    if "limit" in g:
        parts.append("hạn mức " + ("không giới hạn" if g["limit"] == "unlimited" else format(g["limit"], ",").replace(",", ".")))
    if "tabs" in g:
        parts.append("tab " + (",".join(g["tabs"]) or "(không tab nào)"))
    if "models" in g:
        parts.append("mô hình " + ",".join(g["models"]))
    if "tab_limits" in g:
        parts.append("hạn mức theo tab " + ", ".join("%s %s" % (t, format(v, ",").replace(",", ".")) for t, v in g["tab_limits"].items()))
    return "; ".join(parts) or "theo bậc"


def cli(argv, path, out=print):
    """`quota.sh group …`. Trả mã thoát."""
    if not argv or argv[0] in ("-h", "--help", "help"):
        out(CLI_HELP)
        return 1
    op, a = argv[0], argv[1:]
    actor = "quota.sh" + (" (%s)" % os.environ["SUDO_USER"] if os.environ.get("SUDO_USER") else "")
    if op in ("list", "show", "of"):
        st = read_groups(path)
        if st["error"]:
            out("Tệp nhóm đang hỏng: " + path)
            return 1
        gs = st["groups"]
        if op == "list":
            if not gs:
                out("Chưa có nhóm nào. Tạo: quota.sh group create <nhóm>")
            for n in sorted(gs):
                out("  %-28s %5d người  %s" % (n, len(gs[n]["members"]), _fmt(gs[n])))
            return 0
        if not a:
            out(CLI_HELP)
            return 1
        if op == "of":
            i = norm_ident(a[0])
            g = group_index(gs).get(i)
            out("%s thuộc nhóm %s (%s)." % (i, g, _fmt(gs[g])) if g else "%s không thuộc nhóm nào (dùng cấu hình theo bậc)." % (i or a[0]))
            return 0
        if a[0] not in gs:
            out("Không có nhóm %s." % a[0])
            return 1
        out("%s: %s" % (a[0], _fmt(gs[a[0]])))
        for m in gs[a[0]]["members"]:
            out("  " + m)
        return 0
    try:
        if op in ("create", "delete") and len(a) == 1:
            res = group_op(path, time.time(), actor, op, a[0])
        elif op in ("add", "remove") and len(a) >= 2:
            res = group_op(path, time.time(), actor, op, a[0], idents=a[1:])
        elif op == "limit" and len(a) == 2:
            v = None if a[1] == "default" else "unlimited" if a[1] == "unlimited" else _num(a[1])
            res = group_op(path, time.time(), actor, "set", a[0], field="limit", value=v)
        elif op == "tabs" and len(a) == 2:
            v = None if a[1] == "default" else [] if a[1] == "none" else [x for x in a[1].lower().split(",") if x]
            res = group_op(path, time.time(), actor, "set", a[0], field="tabs", value=v)
        elif op == "models" and len(a) == 2:
            v = None if a[1] == "default" else [x.strip() for x in a[1].split(",") if x.strip()]
            res = group_op(path, time.time(), actor, "set", a[0], field="models", value=v)
        elif op == "tablimit" and len(a) == 3:
            if a[1] not in TABS:
                raise ValueError(a[1])
            cur = dict(read_groups(path)["groups"].get(a[0], {}).get("tab_limits") or {})
            cur[a[1]] = None if a[2] == "default" else _num(a[2])
            res = group_op(path, time.time(), actor, "set", a[0], field="tab_limits", value=cur)
        else:
            out(CLI_HELP)
            return 1
    except ValueError as e:
        out("Giá trị không hợp lệ: %s" % e)
        return 1
    if not res["ok"]:
        out(res["message"])
        return 1
    out("Đã xoá nhóm %s." % res["group"] if op == "delete" else "Đã lưu (%s: %d thành viên). Cổng hạn mức áp dụng ngay từ yêu cầu kế tiếp." % (res["group"], res["members"]))
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "group":
        sys.exit(cli(sys.argv[2:], os.environ.get("NEU_QUOTA_GROUPS", "/var/lib/neu-agent/quota/groups.json")))
    print(CLI_HELP)
    sys.exit(1)
