"""Kiểm thử dịch vụ phụ quản lý tài khoản (accounts.py) với users.sh THẬT trên tệp tạm (không cần root, không đụng hệ thống)."""
import json
import os
import shutil
import socket
import tempfile
import threading
import unittest

import accounts as A

HERE = os.path.dirname(os.path.abspath(__file__))
USERS_SH = os.path.abspath(os.path.join(HERE, "..", "users.sh"))
HAS_HASHER = shutil.which("htpasswd") is not None or shutil.which("python3") is not None


def make(tmp, now=lambda: 1_700_000_000):
    env = {"NEU_USERS_FILE": os.path.join(tmp, "users.htpasswd"), "NEU_ENV_FILE": os.path.join(tmp, "oauth2-proxy.env")}
    with open(env["NEU_ENV_FILE"], "w") as f:
        f.write("OAUTH2_PROXY_COOKIE_SECRET=0123456789abcdef0123456789abcdef\n")
    # users.sh nhận NEU_* qua môi trường của tiến trình con: Accounts truyền lại đúng hai biến này
    return A.Accounts(env["NEU_USERS_FILE"], USERS_SH, os.path.join(tmp, "audit.jsonl"), now=now, env=env), env


@unittest.skipUnless(os.path.exists(USERS_SH), "thiếu users.sh")
class AccountsLogic(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.acc, self.env = make(self.tmp)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def call(self, **r):
        return self.acc.handle(r)

    def test_tao_doi_mat_khau_liet_ke_xoa(self):
        r = self.call(op="add", name="khach01", password="mat-khau-dai-123", actor="admin@neu.edu.vn")
        self.assertEqual(r, {"ok": True, "created": True})
        self.assertEqual(self.call(op="list")["users"], ["khach01"])
        line = open(self.env["NEU_USERS_FILE"]).read()
        self.assertTrue(line.startswith("khach01:$2"), "phải là băm bcrypt")
        self.assertNotIn("mat-khau-dai-123", line)
        first = line
        r = self.call(op="add", name="khach01", password="mat-khau-moi-456", actor="admin@neu.edu.vn")
        self.assertEqual(r, {"ok": True, "created": False})
        self.assertEqual(self.call(op="list")["users"], ["khach01"])  # không nhân đôi
        self.assertNotEqual(open(self.env["NEU_USERS_FILE"]).read(), first)
        self.assertEqual(self.call(op="remove", name="khach01", actor="admin@neu.edu.vn"), {"ok": True})
        self.assertEqual(self.call(op="list")["users"], [])
        self.assertEqual(self.call(op="remove", name="khach01")["error"], "not_found")

    def test_tep_mat_khau_quyen_600(self):
        self.call(op="add", name="khach02", password="mat-khau-dai-123")
        self.assertEqual(oct(os.stat(self.env["NEU_USERS_FILE"]).st_mode & 0o777), "0o600")

    def test_tu_choi_ten_va_mat_khau_xau(self):
        for name in ["", "ab", "A" * 3, "Khach01", "khach 01", "kh/ach", "../etc", "a" * 40, ".khach", "khach;rm", None, 5, ["khach01"]]:
            self.assertEqual(self.call(op="add", name=name, password="mat-khau-dai-123")["error"], "bad_name", repr(name))
        for pw in ["", "ngan", "x" * 5, "x" * 201, "mat khau\nxuong dong", "co\x00null-khong-duoc", None, 12345678901234, ["x" * 12]]:
            self.assertEqual(self.call(op="add", name="khach01", password=pw)["error"], "bad_password", repr(pw))
        self.assertEqual(self.call(op="add", name="khach01khach", password="khach01khach")["error"], "weak_password")
        self.assertEqual(self.call(op="add", name="khach01", password="123456789012")["error"], "weak_password")
        self.assertEqual(self.call(op="list")["users"], [], "không tạo gì khi tham số sai")

    def test_mat_khau_toi_thieu_6_ky_tu(self):
        self.assertTrue(self.call(op="add", name="khach01", password="Zq7xKm")["ok"], "đúng 6 ký tự được chấp nhận")
        self.assertTrue(self.call(op="add", name="khach02", password="Zq7xKm123")["ok"])
        self.assertEqual(self.call(op="add", name="khach03", password="Zq7xK")["error"], "bad_password", "5 ký tự bị từ chối")
        self.assertEqual(self.call(op="add", name="khach04", password="123456")["error"], "weak_password", "toàn số vẫn bị coi là yếu")

    def test_khong_tiem_lenh_qua_ten_hoac_mat_khau(self):
        marker = os.path.join(self.tmp, "da-bi-chay")
        self.call(op="add", name="khach01", password="$(touch %s)aaaaaaaa" % marker)
        self.call(op="add", name="khach02", password="`touch %s`bbbbbbbb" % marker)
        self.call(op="add", name="khach03", password="x;touch %s;yyyyyyyyy" % marker)
        self.assertFalse(os.path.exists(marker))
        self.assertEqual(self.call(op="list")["users"], ["khach01", "khach02", "khach03"])

    def test_op_la_va_tham_so_la(self):
        for bad in [None, [], "list", 5, {}, {"op": "rm -rf /"}, {"op": "shell", "cmd": "id"}, {"op": ["list"]}]:
            self.assertEqual(self.acc.handle(bad)["error"], "bad_request", repr(bad))

    def test_gioi_han_so_tai_khoan(self):
        with open(self.env["NEU_USERS_FILE"], "w") as f:
            for i in range(A.MAX_USERS):
                f.write("u%04d:$2y$05$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345\n" % i)
        self.assertEqual(self.call(op="add", name="them-mot", password="mat-khau-dai-123")["error"], "limit")
        self.assertTrue(self.call(op="add", name="u0001", password="mat-khau-dai-123")["ok"], "đổi mật khẩu tài khoản có sẵn vẫn được")

    def test_kick_doi_khoa_phien(self):
        before = open(self.env["NEU_ENV_FILE"]).read()
        self.assertEqual(self.call(op="kick", actor="admin@neu.edu.vn"), {"ok": True})
        after = open(self.env["NEU_ENV_FILE"]).read()
        self.assertNotEqual(before, after)
        self.assertRegex(after, r"^OAUTH2_PROXY_COOKIE_SECRET=[0-9a-f]{32}\n$")

    def test_nhat_ky_co_nguoi_lam_va_khong_co_mat_khau(self):
        self.call(op="add", name="khach01", password="mat-khau-bi-mat-789", actor="admin@neu.edu.vn")
        self.call(op="add", name="khach01", password="mat-khau-bi-mat-000", actor="admin@neu.edu.vn")
        self.call(op="remove", name="khach01", actor="admin@neu.edu.vn")
        self.call(op="remove", name="khong-co", actor="admin@neu.edu.vn")
        self.call(op="kick", actor="kẻ-giả@")  # actor không đúng dạng email -> "?"
        raw = open(os.path.join(self.tmp, "audit.jsonl")).read()
        self.assertNotIn("mat-khau-bi-mat", raw)
        self.assertEqual(oct(os.stat(os.path.join(self.tmp, "audit.jsonl")).st_mode & 0o777), "0o600")
        ent = self.call(op="audit")["entries"]
        self.assertEqual([(e["op"], e["name"], e["ok"]) for e in ent], [("kick", "", True), ("remove", "khong-co", False), ("remove", "khach01", True), ("passwd", "khach01", True), ("add", "khach01", True)])
        self.assertEqual(ent[-1]["actor"], "admin@neu.edu.vn")
        self.assertEqual(ent[0]["actor"], "?")

    def test_lenh_script_hong_thi_bao_loi_chung(self):
        acc = A.Accounts(self.env["NEU_USERS_FILE"], os.path.join(self.tmp, "khong-co.sh"), os.path.join(self.tmp, "a.jsonl"), env=self.env)
        r = acc.handle({"op": "add", "name": "khach01", "password": "mat-khau-dai-123"})
        self.assertEqual(r["error"], "failed")
        self.assertNotIn("mat-khau", json.dumps(r))


@unittest.skipUnless(os.path.exists(USERS_SH), "thiếu users.sh")
class AccountsSocket(unittest.TestCase):
    """Qua socket Unix thật: giao thức một dòng, giới hạn kích thước, từ chối uid lạ."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir="/tmp")  # đường dẫn socket Unix phải ngắn
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.acc, self.env = make(self.tmp)
        self.path = os.path.join(self.tmp, "s", "a.sock")
        self.lst = A.make_listener(self.path)
        self.allowed = {os.getuid()}
        self.stop = False

        def loop():
            while not self.stop:
                try:
                    conn, _ = self.lst.accept()
                except OSError:
                    return
                A.serve_one(conn, self.acc, self.allowed)

        self.t = threading.Thread(target=loop, daemon=True)
        self.t.start()
        self.addCleanup(self.close)

    def close(self):
        self.stop = True
        self.lst.close()

    def rpc(self, raw):
        s = socket.socket(socket.AF_UNIX)
        s.settimeout(10)
        s.connect(self.path)
        s.sendall(raw if isinstance(raw, bytes) else json.dumps(raw).encode() + b"\n")
        out = b""
        while not out.endswith(b"\n"):
            c = s.recv(4096)
            if not c:
                break
            out += c
        s.close()
        return json.loads(out)

    def test_quyen_socket_0660(self):
        self.assertEqual(oct(os.stat(self.path).st_mode & 0o777), "0o660")

    def test_vong_doi_qua_socket(self):
        self.assertEqual(self.rpc({"op": "add", "name": "khach01", "password": "mat-khau-dai-123", "actor": "a@neu.edu.vn"}), {"ok": True, "created": True})
        self.assertEqual(self.rpc({"op": "list"})["users"], ["khach01"])
        self.assertTrue(self.rpc({"op": "remove", "name": "khach01"})["ok"])

    def test_du_lieu_rac_khong_lam_sap_dich_vu(self):
        for raw in [b"\n", b"khong phai json\n", b"{\n", b"[1,2]\n", b'{"op":"list"', b"\xff\xfe\n", b"x" * 5000 + b"\n"]:
            r = self.rpc(raw) if raw.endswith(b"\n") else None
            if r is not None:
                self.assertFalse(r["ok"], repr(raw[:20]))
        self.assertEqual(self.rpc({"op": "list"})["ok"], True, "vẫn phục vụ bình thường sau dữ liệu rác")

    @unittest.skipUnless(__import__("sys").platform.startswith("linux"), "SO_PEERCRED chỉ có trên Linux")
    def test_tu_choi_uid_la(self):
        self.allowed = {os.getuid() + 12345}
        r = self.rpc({"op": "list"})
        self.assertEqual(r["error"], "forbidden")
        self.allowed = {os.getuid()}
        self.assertTrue(self.rpc({"op": "list"})["ok"])


if __name__ == "__main__":
    unittest.main()
