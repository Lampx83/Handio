#!/usr/bin/env python3
"""NEU Agent - dịch vụ phụ QUẢN LÝ TÀI KHOẢN tên + mật khẩu (máy 220). Chạy bằng root, chỉ dùng thư viện chuẩn của Python 3.

Vì sao có dịch vụ riêng: tệp /etc/neu-agent/users.htpasswd và việc khởi động lại dịch vụ đăng nhập cần quyền root, còn trang quản trị
(collector.py) chạy bằng tài khoản thường `neu-diag` đã bị cô lập. Dịch vụ này là CỔNG HẸP giữa hai bên: chỉ nghe trên một socket Unix
(quyền 0660, nhóm neu-diag, kiểm tra thêm uid người gọi), chỉ nhận đúng 5 việc, mọi tham số được kiểm tra chặt, rồi gọi lại chính
`users.sh` đã kiểm thử (băm bcrypt, ghi tệp nguyên tử, khởi động lại dịch vụ đăng nhập). Không có lệnh shell tự do, không nhận đường dẫn.

Giao thức: mỗi kết nối một yêu cầu JSON (một dòng, <= 2 KB), một phản hồi JSON (một dòng).
  {"op":"list"}                                        -> {"ok":true,"users":["a","b"],"max":500}
  {"op":"add","name":"...","password":"...","actor":""} -> {"ok":true,"created":true|false}   (tạo mới hoặc ĐỔI mật khẩu)
  {"op":"remove","name":"...","actor":""}              -> {"ok":true}
  {"op":"kick","actor":""}                              -> {"ok":true}   (huỷ mọi phiên đăng nhập trên trình duyệt)
  {"op":"audit"}                                        -> {"ok":true,"entries":[{"ts":..,"actor":"..","op":"..","name":"..","ok":true}]}
Lỗi: {"ok":false,"error":"<mã>","message":"<tiếng Việt, không chứa mật khẩu>"}.

Nhật ký thao tác (ai, lúc nào, làm gì, kết quả) ghi vào AUDIT_FILE (JSON mỗi dòng, quyền 0600) và journal. KHÔNG BAO GIỜ ghi mật khẩu.
"""
import json
import os
import re
import socket
import struct
import subprocess
import sys
import time

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
ACTOR_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}$")
CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
MAX_REQ = 2048
MIN_PW, MAX_PW = 6, 200
MAX_USERS = 500
AUDIT_KEEP = 50
OPS = ("list", "add", "remove", "kick", "audit")

ERR = {
    "bad_request": "Yêu cầu không hợp lệ.",
    "bad_name": "Tên không hợp lệ (3–32 ký tự: chữ thường, số, dấu . _ -; bắt đầu bằng chữ hoặc số).",
    "bad_password": "Mật khẩu phải từ %d đến %d ký tự, không có ký tự điều khiển." % (MIN_PW, MAX_PW),
    "weak_password": "Mật khẩu quá yếu (trùng tên hoặc toàn số).",
    "not_found": "Không có tài khoản này.",
    "limit": "Đã đủ số tài khoản tối đa (%d)." % MAX_USERS,
    "failed": "Không thực hiện được. Xem nhật ký dịch vụ neu-agent-accounts.",
}


def fail(code, message=None):
    return {"ok": False, "error": code, "message": message or ERR.get(code, ERR["failed"])}


class Accounts:
    def __init__(self, users_file, users_script, audit_file, run=subprocess.run, now=time.time, env=None):
        self.users_file = users_file
        self.users_script = users_script
        self.audit_file = audit_file
        self._run = run
        self._now = now
        self._env = env if env is not None else dict(os.environ)

    # ---------------------------------------------------------------- dữ liệu
    def names(self):
        try:
            with open(self.users_file, encoding="utf-8") as f:
                return sorted({ln.split(":", 1)[0] for ln in f if ":" in ln and NAME_RE.match(ln.split(":", 1)[0])})
        except OSError:
            return []

    def _audit(self, actor, op, name, ok, err=""):
        rec = {"ts": int(self._now()), "actor": actor or "?", "op": op, "name": name or "", "ok": bool(ok)}
        if err:
            rec["err"] = err
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        print("audit " + line, flush=True)  # journal
        try:
            os.makedirs(os.path.dirname(self.audit_file), exist_ok=True)
            fd = os.open(self.audit_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError as e:
            print("không ghi được nhật ký thao tác: %s" % e.strerror, file=sys.stderr, flush=True)

    def audit_entries(self):
        try:
            with open(self.audit_file, encoding="utf-8") as f:
                lines = f.readlines()[-AUDIT_KEEP:]
        except OSError:
            return []
        out = []
        for ln in lines:
            try:
                r = json.loads(ln)
                out.append({k: r[k] for k in ("ts", "actor", "op", "name", "ok") if k in r})
            except ValueError:
                continue
        return out[::-1]  # mới nhất trước

    # ---------------------------------------------------------------- gọi users.sh
    def _script(self, args, stdin=None):
        env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
        for k in ("NEU_USERS_FILE", "NEU_ENV_FILE"):  # chỉ để kiểm thử với tệp tạm
            if self._env.get(k):
                env[k] = self._env[k]
        r = self._run(["/bin/bash", self.users_script, *args], input=stdin, capture_output=True, text=True, timeout=60, env=env)
        return r.returncode == 0

    # ---------------------------------------------------------------- xử lý yêu cầu
    def handle(self, req):
        if not isinstance(req, dict):
            return fail("bad_request")
        op = req.get("op")
        actor = req.get("actor") if isinstance(req.get("actor"), str) and ACTOR_RE.match(req.get("actor", "")) else ""
        if op not in OPS:
            return fail("bad_request")
        if op == "list":
            return {"ok": True, "users": self.names(), "max": MAX_USERS}
        if op == "audit":
            return {"ok": True, "entries": self.audit_entries()}
        if op == "kick":
            ok = self._script(["kick"])
            self._audit(actor, "kick", "", ok, "" if ok else "failed")
            return {"ok": True} if ok else fail("failed")
        name = req.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name):
            return fail("bad_name")
        existing = self.names()
        if op == "remove":
            if name not in existing:
                self._audit(actor, "remove", name, False, "not_found")
                return fail("not_found")
            ok = self._script(["remove", name])
            self._audit(actor, "remove", name, ok, "" if ok else "failed")
            return {"ok": True} if ok else fail("failed")
        # add: tạo mới hoặc đổi mật khẩu
        pw = req.get("password")
        if not isinstance(pw, str) or not (MIN_PW <= len(pw) <= MAX_PW) or CTRL_RE.search(pw):
            return fail("bad_password")
        if pw == name or pw.isdigit():
            return fail("weak_password")
        created = name not in existing
        if created and len(existing) >= MAX_USERS:
            return fail("limit")
        ok = self._script(["add", name, "--stdin"], stdin=pw + "\n")
        self._audit(actor, "add" if created else "passwd", name, ok, "" if ok else "failed")
        return {"ok": True, "created": created} if ok else fail("failed")


# ---------------------------------------------------------------- máy chủ socket
def peer_uid(conn):
    """uid của tiến trình ở đầu kia (Linux SO_PEERCRED); None nếu không lấy được."""
    try:
        cred = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        return struct.unpack("3i", cred)[1]
    except (OSError, AttributeError):
        return None


def serve_one(conn, acc, allowed_uids):
    conn.settimeout(5)
    try:
        uid = peer_uid(conn)
        # Trên Linux (máy chủ thật) BẮT BUỘC đúng uid; nơi khác (máy dev) không có SO_PEERCRED thì chỉ dựa vào quyền tệp socket
        if allowed_uids is not None and sys.platform.startswith("linux") and uid not in allowed_uids:
            conn.sendall(json.dumps(fail("forbidden", "Không được phép."), ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
            return
        buf = b""
        while b"\n" not in buf and len(buf) <= MAX_REQ:
            chunk = conn.recv(1024)
            if not chunk:
                break
            buf += chunk
        if len(buf) > MAX_REQ or not buf.strip():
            res = fail("bad_request")
        else:
            try:
                res = acc.handle(json.loads(buf.split(b"\n", 1)[0].decode("utf-8")))
            except (ValueError, UnicodeDecodeError):
                res = fail("bad_request")
            except subprocess.TimeoutExpired:
                res = fail("failed")
            except Exception as e:  # không để một yêu cầu làm sập dịch vụ; KHÔNG in nội dung yêu cầu (có thể chứa mật khẩu)
                print("lỗi nội bộ: %s" % type(e).__name__, file=sys.stderr, flush=True)
                res = fail("failed")
        conn.sendall(json.dumps(res, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
    except OSError:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


def make_listener(path, gid=None):
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o750, exist_ok=True)
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o117)  # socket 0660
    try:
        s.bind(path)
    finally:
        os.umask(old)
    if gid is not None:
        os.chown(path, 0, gid)
        os.chown(d, 0, gid)
        os.chmod(d, 0o750)
    s.listen(16)
    return s


def main():
    import grp
    import pwd

    users_file = os.environ.get("NEU_USERS_FILE", "/etc/neu-agent/users.htpasswd")
    script = os.environ.get("NEU_USERS_SCRIPT", "/usr/local/lib/neu-agent-diag/users.sh")
    audit = os.environ.get("NEU_ACCOUNTS_AUDIT", "/var/lib/neu-agent-accounts/audit.jsonl")
    sock_path = os.environ.get("NEU_ACCOUNTS_SOCK", "/run/neu-agent-accounts/accounts.sock")
    user = os.environ.get("NEU_ACCOUNTS_CLIENT_USER", "neu-diag")
    try:
        gid = grp.getgrnam(user).gr_gid
        allowed = {0, pwd.getpwnam(user).pw_uid}
    except KeyError:
        sys.exit("Không có người dùng/nhóm %s." % user)
    acc = Accounts(users_file, script, audit)
    lst = make_listener(sock_path, gid)
    print("neu-agent-accounts nghe %s (nhóm %s)" % (sock_path, user), flush=True)
    while True:
        conn, _ = lst.accept()
        serve_one(conn, acc, allowed)


if __name__ == "__main__":
    main()
