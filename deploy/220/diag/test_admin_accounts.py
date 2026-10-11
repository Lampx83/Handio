"""Kiểm thử API quản lý tài khoản của trang quản trị (collector.py) nối với dịch vụ phụ accounts.py qua socket Unix thật, users.sh thật trên tệp tạm."""
import http.client
import json
import os
import shutil
import tempfile
import threading
import unittest

import accounts as A
import collector as C
from test_collector import app as diag_app, payload as diag_payload, turn as diag_turn

HERE = os.path.dirname(os.path.abspath(__file__))
USERS_SH = os.path.abspath(os.path.join(HERE, "..", "users.sh"))
SECRET = b"unit-test-secret-0123456789abcdef"
PW = "mat-khau-rat-bi-mat-2026"
JSON_H = {"Content-Type": "application/json", "X-Neu-Admin": "1", "Origin": "https://ai.neu.edu.vn", "Sec-Fetch-Site": "same-origin"}


@unittest.skipUnless(os.path.exists(USERS_SH), "thiếu users.sh")
class AdminAccounts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(dir="/tmp")
        d = cls.tmp
        env = {"NEU_USERS_FILE": os.path.join(d, "users.htpasswd"), "NEU_ENV_FILE": os.path.join(d, "oauth2.env")}
        with open(env["NEU_ENV_FILE"], "w") as f:
            f.write("OAUTH2_PROXY_COOKIE_SECRET=0123456789abcdef0123456789abcdef\n")
        cls.acc = A.Accounts(env["NEU_USERS_FILE"], USERS_SH, os.path.join(d, "audit.jsonl"), env=env)
        cls.sock = os.path.join(d, "s", "a.sock")
        cls.lst = A.make_listener(cls.sock)
        cls.stop = False

        def loop():
            while not cls.stop:
                try:
                    conn, _ = cls.lst.accept()
                except OSError:
                    return
                A.serve_one(conn, cls.acc, {os.getuid()})

        threading.Thread(target=loop, daemon=True).start()
        cls.admins = os.path.join(d, "admins.txt")
        with open(cls.admins, "w") as f:
            f.write("Admin@NEU.edu.vn\n")
        web = os.path.join(d, "web")
        os.makedirs(web)
        for n in ("accounts.html", "accounts.js"):
            shutil.copy(os.path.join(HERE, n), os.path.join(web, n))
        cls.cfg = C.Config(diag_dir=os.path.join(d, "diag"), secret=SECRET, reports_dir=os.path.join(d, "r"), admins_file=cls.admins, accounts_sock=cls.sock, web_dir=web, schema=C.load_schema(), registry=C.Registry(os.path.join(d, "seen.json"), flush_every=0))
        cls.srv = C.make_server(cls.cfg, "127.0.0.1", 0)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.env = env

    @classmethod
    def tearDownClass(cls):
        cls.stop = True
        cls.lst.close()
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, True)

    def req(self, method, path, body=None, email="admin@neu.edu.vn", headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        h = dict(headers or {})
        if email:
            h["X-User-Email"] = email
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data, {k.lower(): v for k, v in r.getheaders()}

    def post(self, body, **kw):
        h = dict(JSON_H)
        h.update(kw.pop("headers", {}))
        return self.req("POST", "/admin/api/accounts", body, headers=h, **kw)

    def users(self):
        return json.loads(self.req("GET", "/admin/api/accounts")[1])["users"]

    def tearDown(self):
        for u in self.users():
            self.acc.handle({"op": "remove", "name": u})
        self.cfg.admin_hits.clear()
        self.cfg.registry.users.clear()
        self.cfg.limiter.__dict__.get("hits", {}).clear() if hasattr(self.cfg.limiter, "hits") else None

    # ---------------------------------------------------------------- quyền
    # ---------------------------------------------------------------- ai đã dùng: web / Desktop
    def diag(self, ident, platform, n_turns=1):
        h = {"Content-Type": "application/json"}
        body = diag_payload([diag_turn(i) for i in range(n_turns)], app=diag_app(platform=platform, install=("%032x" % abs(hash(ident + platform))).ljust(32, "0")[:32]))
        return self.req("POST", "/diag", body, email=ident, headers=h)

    def seen(self):
        d = json.loads(self.req("GET", "/admin/api/accounts")[1])
        return {r["email"]: r for r in d["seen"]["users"]}, d["seen"]

    def test_so_nguoi_dung_theo_nen_tang(self):
        self.assertEqual(self.diag("gv.web@neu.edu.vn", "web", 2)[0], 200)
        self.assertEqual(self.diag("sv.mac@st.neu.edu.vn", "mac")[0], 200)
        self.assertEqual(self.diag("sv.win@st.neu.edu.vn", "win")[0], 200)
        self.assertEqual(self.diag("ca.hai@neu.edu.vn", "web")[0], 200)
        self.assertEqual(self.diag("ca.hai@neu.edu.vn", "mac")[0], 200)
        self.assertEqual(self.diag("khach01", "web")[0], 200, "tài khoản tên + mật khẩu (không có @) cũng được thống kê")
        rows, sm = self.seen()
        self.assertEqual({k: rows[k]["kind"] for k in rows}, {"gv.web@neu.edu.vn": "gv", "sv.mac@st.neu.edu.vn": "sv", "sv.win@st.neu.edu.vn": "sv", "ca.hai@neu.edu.vn": "gv", "khach01": "mk"})
        self.assertEqual(rows["gv.web@neu.edu.vn"]["turns"], 2)
        self.assertEqual(sorted(rows["ca.hai@neu.edu.vn"]["plat"]), ["mac", "web"])
        d1 = sm["summary"]["d1"]
        self.assertEqual((d1["all"], d1["web"], d1["desktop"], d1["mac"], d1["win"], d1["both"]), (5, 3, 3, 2, 1, 1))
        self.assertEqual(sm["kinds"], {"gv": 2, "sv": 2, "mk": 1})

    def test_so_ai_da_dung_chi_cho_quan_tri_vien_va_khong_ghi_khi_bi_tu_choi(self):
        for email in ("nguoi.thuong@neu.edu.vn", "khach01", None):
            self.assertEqual(self.req("GET", "/admin/api/accounts", email=email)[0], 403)
        n = len(self.seen()[0])
        self.assertEqual(self.diag("a b@neu.edu.vn", "web")[0], 401, "danh tính sai dạng")
        self.assertEqual(self.diag("", "web")[0], 401)
        self.assertEqual(self.req("POST", "/diag", b'{"junk":1}', email="rac.schema@neu.edu.vn", headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(len(self.seen()[0]), n, "gói bị từ chối không được vào sổ")
        self.assertNotIn("rac.schema@neu.edu.vn", self.seen()[0])

    def test_so_ai_da_dung_kem_ma_gia_danh_de_mo_trang_hoat_dong(self):
        self.diag("lien.ket@neu.edu.vn", "web")
        rows, _ = self.seen()
        self.assertEqual(rows["lien.ket@neu.edu.vn"]["uid8"], C.pseudonym(SECRET, "lien.ket@neu.edu.vn")[:8])
        self.assertRegex(rows["lien.ket@neu.edu.vn"]["uid8"], r"^[0-9a-f]{8}$")

    def test_so_luu_xuong_dia_quyen_600_va_nap_lai(self):
        self.diag("luu.dia@neu.edu.vn", "win")
        self.cfg.registry.flush()
        path = self.cfg.registry.path
        self.assertEqual(oct(os.stat(path).st_mode & 0o777), "0o600")
        again = C.Registry(path)
        self.assertIn("luu.dia@neu.edu.vn", again.users)
        self.assertEqual(again.users["luu.dia@neu.edu.vn"]["plat"]["win"]["turns"], 1)

    def test_chi_quan_tri_vien_dung_duoc(self):
        for email in (None, "", "nguoi.thuong@neu.edu.vn", "khach01", "admin@neu.edu.vn.evil.com", "root"):
            self.assertEqual(self.req("GET", "/admin/accounts", email=email)[0], 403, repr(email))
            self.assertEqual(self.req("GET", "/admin/accounts.js", email=email)[0], 403, repr(email))
            self.assertEqual(self.req("GET", "/admin/api/accounts", email=email)[0], 403, repr(email))
            self.assertEqual(self.post({"op": "kick"}, email=email)[0], 403, repr(email))
        self.assertEqual(self.users(), [], "không có gì thay đổi")

    def test_tai_khoan_mat_khau_chi_la_quan_tri_vien_khi_duoc_liet_ke_ten(self):
        # nginx đặt X-User-Email = tên đăng nhập (không có @) cho tài khoản mật khẩu
        self.assertEqual(self.post({"op": "add", "name": "khach01", "password": PW})[0], 200)
        self.assertEqual(self.post({"op": "add", "name": "test01", "password": PW})[0], 200)
        self.assertEqual(self.req("GET", "/admin/api/accounts", email="khach01")[0], 403, "chưa liệt kê: bị từ chối")
        self.assertEqual(self.req("GET", "/admin/api/accounts", email="test01")[0], 403, "chưa liệt kê: bị từ chối")
        with open(self.admins, "a") as f:
            f.write("# tài khoản mật khẩu được cấp quyền\ntest01\n")
        try:
            self.assertEqual(self.req("GET", "/admin/api/accounts", email="test01")[0], 200)
            self.assertEqual(self.req("GET", "/admin/accounts", email="test01")[0], 200)
            self.assertEqual(self.post({"op": "kick"}, email="test01")[0], 200)
            self.assertEqual(self.req("GET", "/admin/api/accounts", email="khach01")[0], 403, "chỉ đúng tên được liệt kê")
            self.assertEqual(self.req("GET", "/admin/api/accounts", email="test010")[0], 403)
            self.assertEqual(self.req("GET", "/admin/api/accounts", email="TEST01")[0], 403, "tên đăng nhập luôn chữ thường")
            self.assertEqual(self.req("GET", "/admin/api/accounts", email="test01@neu.edu.vn")[0], 403, "email cùng tên không thừa quyền")
            self.assertEqual(self.post({"op": "kick"}, email="test01", headers={"X-Neu-Admin": "1", "Content-Type": "text/plain"})[0], 403, "vẫn chống CSRF")
            audit = self.req("GET", "/admin/api/accounts", email="test01")[1]
            self.assertIn("test01", {e.get("actor") for e in json.loads(audit)["audit"]}, "nhật ký ghi đúng người làm")
        finally:
            with open(self.admins, "w") as f:
                f.write("Admin@NEU.edu.vn\n")
        self.assertEqual(self.req("GET", "/admin/api/accounts", email="test01")[0], 403, "gỡ khỏi danh sách là mất quyền")

    def test_trang_va_tep_tinh_voi_csp_chat(self):
        st, body, h = self.req("GET", "/admin/accounts")
        self.assertEqual(st, 200)
        self.assertIn("script-src 'self'", h["content-security-policy"])
        self.assertIn("frame-ancestors 'none'", h["content-security-policy"])
        self.assertNotIn(b"<script>", body.replace(b'<script src="accounts.js"></script>', b""), "không script nhúng trong trang")
        st, js, h = self.req("GET", "/admin/accounts.js")
        self.assertEqual((st, h["content-type"].split(";")[0]), (200, "text/javascript"))
        for bad in (b".innerHTML", b"outerHTML", b"insertAdjacentHTML", b"document.write", b"eval(", b"new Function"):
            self.assertNotIn(bad, js, "chống XSS: không dùng " + bad.decode())

    # ---------------------------------------------------------------- chức năng
    def test_tao_doi_xoa_va_nhat_ky(self):
        st, body, _ = self.post({"op": "add", "name": "khach01", "password": PW})
        self.assertEqual((st, json.loads(body)), (200, {"ok": True, "created": True}))
        self.assertNotIn(PW.encode(), body, "không phản hồi lại mật khẩu")
        self.assertEqual(self.users(), ["khach01"])
        self.assertEqual(json.loads(self.post({"op": "add", "name": "khach01", "password": PW + "-moi"})[1]), {"ok": True, "created": False})
        d = json.loads(self.req("GET", "/admin/api/accounts")[1])
        self.assertEqual(d["me"], "admin@neu.edu.vn")
        self.assertEqual([(a["op"], a["actor"]) for a in d["audit"][:2]], [("passwd", "admin@neu.edu.vn"), ("add", "admin@neu.edu.vn")])
        self.assertNotIn(PW, json.dumps(d))
        self.assertEqual(self.post({"op": "remove", "name": "khach01"})[0], 200)
        self.assertEqual(self.users(), [])
        st, body, _ = self.post({"op": "remove", "name": "khach01"})
        self.assertEqual((st, json.loads(body)["error"]), (404, "not_found"))

    def test_kick(self):
        before = open(self.env["NEU_ENV_FILE"]).read()
        self.assertEqual(self.post({"op": "kick"})[0], 200)
        self.assertNotEqual(open(self.env["NEU_ENV_FILE"]).read(), before)

    def test_nguoi_thao_tac_do_may_chu_gan_khong_gia_mao_duoc(self):
        self.post({"op": "add", "name": "khach01", "password": PW, "actor": "nguoi.khac@neu.edu.vn"})
        last = json.loads(self.req("GET", "/admin/api/accounts")[1])["audit"][0]
        self.assertEqual(last["actor"], "admin@neu.edu.vn")

    def test_tham_so_xau_bi_tu_choi_voi_thong_bao_tieng_viet(self):
        st, body, _ = self.post({"op": "add", "name": "Khach 01", "password": PW})
        self.assertEqual(st, 400)
        self.assertIn("Tên không hợp lệ", json.loads(body)["message"])
        st, body, _ = self.post({"op": "add", "name": "khach01", "password": "ngan"})
        self.assertEqual(st, 400)
        self.assertIn("6", json.loads(body)["message"])
        for bad in [{"op": "list"}, {"op": "audit"}, {"op": "rm -rf"}, {"name": "x"}, [], "x", {"op": ["add"]}]:
            self.assertEqual(self.post(bad)[0], 400, repr(bad))
        self.assertEqual(self.post(b"{not json")[0], 400)
        self.assertEqual(self.users(), [])

    # ---------------------------------------------------------------- chống CSRF / lạm dụng
    def test_chong_csrf(self):
        ok = {"op": "add", "name": "khach01", "password": PW}
        cases = [
            ("thiếu X-Neu-Admin", {"X-Neu-Admin": ""}),
            ("Origin lạ", {"Origin": "https://evil.example"}),
            ("Origin giả tên miền", {"Origin": "https://ai.neu.edu.vn.evil.example"}),
            ("Sec-Fetch-Site cross-site", {"Sec-Fetch-Site": "cross-site"}),
            ("Sec-Fetch-Site same-site", {"Sec-Fetch-Site": "same-site"}),
            ("form thay vì JSON", {"Content-Type": "application/x-www-form-urlencoded"}),
            ("text/plain", {"Content-Type": "text/plain"}),
        ]
        for label, hdr in cases:
            h = dict(JSON_H)
            h.update(hdr)
            if hdr.get("X-Neu-Admin") == "":
                h.pop("X-Neu-Admin")
            self.assertEqual(self.req("POST", "/admin/api/accounts", ok, headers=h)[0], 403, label)
        self.assertEqual(self.users(), [], "không tạo được gì khi vi phạm")
        h = dict(JSON_H)
        h.pop("Origin")
        h.pop("Sec-Fetch-Site")
        self.assertEqual(self.req("POST", "/admin/api/accounts", ok, headers=h)[0], 200, "máy khách không phải trình duyệt (không có Origin) vẫn dùng được nếu có tiêu đề tuỳ biến")

    def test_gioi_han_kich_thuoc_va_phuong_thuc(self):
        self.assertEqual(self.post(b"x" * 2000)[0], 413)
        for m in ("PUT", "DELETE", "PATCH"):
            self.assertEqual(self.req(m, "/admin/api/accounts", b"{}", headers=JSON_H)[0], 405, m)

    def test_gioi_han_toc_do(self):
        old = C.ADMIN_POSTS_PER_MIN
        C.ADMIN_POSTS_PER_MIN = 3
        try:
            codes = [self.post({"op": "add", "name": "khach0%d" % i, "password": PW + str(i)})[0] for i in range(5)]
        finally:
            C.ADMIN_POSTS_PER_MIN = old
        self.assertEqual(codes, [200, 200, 200, 429, 429])

    def test_dich_vu_phu_chua_chay_thi_bao_503_ro_rang(self):
        saved = self.cfg.accounts_sock
        self.cfg.accounts_sock = os.path.join(self.tmp, "khong-co.sock")
        try:
            st, body, _ = self.req("GET", "/admin/api/accounts")
            self.assertEqual(st, 503)
            self.assertIn("install-diag", json.loads(body)["message"])
            self.assertEqual(self.post({"op": "kick"})[0], 503)
        finally:
            self.cfg.accounts_sock = saved


if __name__ == "__main__":
    unittest.main()
