"""Kiểm thử kho chia sẻ cuộc trò chuyện (shares.py) và route của bộ thu (POST /share, GET /share/<id>, thu hồi, quản trị)."""
import http.client
import json
import os
import shutil
import tempfile
import threading
import unittest

import collector as C
import shares as SH

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = b"unit-test-secret-0123456789abcdef"
JSON_H = {"Content-Type": "application/json", "X-Neu-Admin": "1", "Origin": "https://ai.neu.edu.vn", "Sec-Fetch-Site": "same-origin"}


def payload(**kw):
    p = {"v": 1, "title": "Tạo bảng điểm", "profile": "work", "version": "0.7.0", "platform": "darwin arm64", "redactions": 2,
         "items": [{"k": "user", "t": "Tạo giúp tôi bảng điểm"}, {"k": "tool", "n": "create_xlsx", "t": "ok"}, {"k": "assistant", "t": "Xong <b>rồi</b> & hết"}]}
    p.update(kw)
    return p


class Clean(unittest.TestCase):
    def test_valid_and_scrubbed(self):
        p, e = SH.clean_payload(payload(items=[{"k": "user", "t": "key của tôi là sk-abcdefghijklmnop1234 và password: hunter2hunter2"}, {"k": "assistant", "t": "ok\x00"}]))
        self.assertIsNone(e)
        self.assertNotIn("sk-abcdef", p["items"][0]["t"])
        self.assertNotIn("hunter2", p["items"][0]["t"])
        self.assertEqual(p["items"][1]["t"], "ok")
        self.assertEqual((p["profile"], p["version"]), ("work", "0.7.0"))

    def test_rejects_bad(self):
        for raw in [None, {}, payload(v=3), payload(items=[]), payload(items=[{"k": "assistant", "t": "chỉ trả lời"}]), payload(items=[{"k": "evil", "t": "x"}]),
                    payload(items=[{"k": "user", "t": 5}]), payload(items=[{"k": "user", "t": "x"}] * (SH.MAX_ITEMS + 1))]:
            self.assertIsNone(SH.clean_payload(raw)[0], repr(raw)[:60])
        big = payload(items=[{"k": "user", "t": "a" * SH.MAX_ITEM_CHARS}] * 80)
        self.assertEqual(SH.clean_payload(big)[1], "too_big")

    def test_bad_metadata_dropped_not_fatal(self):
        p, _ = SH.clean_payload(payload(profile="hack", version="1.2", platform="<script>", redactions=-5))
        self.assertEqual((p["profile"], p["version"], p["platform"], p["redactions"]), ("", "", "", 0))

    def test_owner_label_masks(self):
        self.assertEqual(SH.owner_label("lan.nguyen@neu.edu.vn"), "l***@neu.edu.vn")
        self.assertEqual(SH.owner_label("khach01"), "k***")


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir="/tmp")
        self.t = [2_000_000]
        self.db = SH.ShareDB(os.path.join(self.tmp, "s.db"), now=lambda: self.t[0])

    def tearDown(self):
        shutil.rmtree(self.tmp, True)

    def make(self, owner="sv@st.neu.edu.vn", **kw):
        return self.db.create(owner, SH.clean_payload(payload(**kw))[0])

    def test_create_get_views_revoke(self):
        r = self.make()
        self.assertTrue(r["ok"])
        self.assertRegex(r["id"], SH.ID_RE.pattern)
        d = self.db.get(r["id"])
        self.assertEqual((d["title"], d["views"] + 1, len(d["items"])), ("Tạo bảng điểm", 1, 3))
        self.db.get(r["id"])
        self.assertEqual(self.db.mine("sv@st.neu.edu.vn")[0]["views"], 2)
        self.assertEqual(self.db.mine("khac@neu.edu.vn"), [])
        self.assertEqual(self.db.revoke(r["id"], "khac@neu.edu.vn")["error"], "not_found")   # người khác không thu hồi được
        self.assertTrue(self.db.revoke(r["id"], "sv@st.neu.edu.vn")["ok"])
        self.assertIsNone(self.db.get(r["id"]))
        self.assertEqual(self.db.admin_list()["total"], 0)

    def test_ids_are_unguessable_and_unique(self):
        ids = {self.make(owner="u%d@x.vn" % i)["id"] for i in range(30)}
        self.assertEqual(len(ids), 30)
        self.assertIsNone(self.db.get("a" * 22))
        self.assertIsNone(self.db.get("../etc/passwd"))
        self.assertIsNone(self.db.get("' OR 1=1 --"))

    def test_daily_limit_and_admin_revoke(self):
        ids = [self.make()["id"] for _ in range(SH.PER_DAY)]
        self.assertEqual(self.make()["error"], "rate")
        self.assertTrue(self.db.revoke(ids[0], None)["ok"])        # quản trị xoá bất kỳ
        self.t[0] += 86401
        self.assertTrue(self.make()["ok"])

    def test_admin_search_and_export(self):
        self.make(title="Làm bảng lương tháng 9")
        self.make(owner="gv@neu.edu.vn", title="Soát lỗi chính tả")
        self.assertEqual([r["title"] for r in self.db.admin_list(q="lương")["items"]], ["Làm bảng lương tháng 9"])
        self.assertEqual(self.db.admin_list(q="gv@")["total"], 1)
        self.assertEqual(self.db.admin_list(q="100%")["total"], 0)
        self.assertEqual(len(self.db.export()), 2)


class Page(unittest.TestCase):
    def test_render_escapes_everything(self):
        d = {"title": "<img src=x onerror=alert(1)>", "owner": "a@neu.edu.vn", "profile": "code", "version": "0.7.0", "ts": 2_000_000, "redactions": 3,
             "items": [{"k": "user", "t": "<script>alert(1)</script>"}, {"k": "tool", "n": "x\"><b>", "t": "<b>"}, {"k": "assistant", "t": "ok & ok"}]}
        h = SH.render_page(d)
        self.assertNotIn("<script>alert", h)
        self.assertNotIn("<img src=x", h)
        self.assertIn("&lt;script&gt;", h)
        self.assertIn("a***@neu.edu.vn", h)
        self.assertNotIn("a@neu.edu.vn", h)
        self.assertIn("Đã tự che 3", h)


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(dir="/tmp")
        d = cls.tmp
        cls.admins = os.path.join(d, "admins.txt")
        with open(cls.admins, "w") as f:
            f.write("Admin@NEU.edu.vn\n")
        web = os.path.join(d, "web")
        os.makedirs(web)
        for n in ("shares.html", "shares.js"):
            shutil.copy(os.path.join(HERE, n), os.path.join(web, n))
        cls.cfg = C.Config(diag_dir=os.path.join(d, "diag"), secret=SECRET, reports_dir=os.path.join(d, "r"), admins_file=cls.admins, web_dir=web,
                           shares=SH.ShareDB(os.path.join(d, "sh.db")))
        cls.srv = C.make_server(cls.cfg, "127.0.0.1", 0)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, True)

    def req(self, method, path, body=None, email="sv1@st.neu.edu.vn", headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        h = dict(headers or {})
        if email:
            h["X-User-Email"] = email
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        hd = {k.lower(): v for k, v in r.getheaders()}
        c.close()
        return r.status, data.decode("utf-8", "replace"), hd

    def test_full_flow(self):
        st, body, _ = self.req("POST", "/share", payload(), email=None)
        self.assertEqual(st, 401)
        st, body, _ = self.req("POST", "/share", payload())
        self.assertEqual(st, 200, body)
        sid = json.loads(body)["id"]
        # người khác (đã đăng nhập) đọc được trang; có CSP chặt
        st, page, h = self.req("GET", "/share/" + sid, email="gv2@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertIn("Tạo bảng điểm", page)
        self.assertIn("&lt;b&gt;rồi&lt;/b&gt;", page)
        self.assertIn("default-src 'none'", h["content-security-policy"])
        self.assertNotIn("script-src", h["content-security-policy"])
        self.assertEqual(self.req("GET", "/share/" + sid, email=None)[0], 401)
        self.assertEqual(self.req("GET", "/share/" + "x" * 22)[0], 404)
        # danh sách của tôi; người khác không thấy
        mine = json.loads(self.req("GET", "/shares")[1])["items"]
        self.assertEqual([i["id"] for i in mine], [sid])
        self.assertEqual(json.loads(self.req("GET", "/shares", email="gv2@neu.edu.vn")[1])["items"], [])
        # người khác không thu hồi được; chủ thu hồi được; sau đó 404
        self.assertEqual(self.req("POST", "/share/revoke", {"id": sid}, email="gv2@neu.edu.vn")[0], 404)
        self.assertEqual(self.req("POST", "/share/revoke", {"id": sid})[0], 200)
        self.assertEqual(self.req("GET", "/share/" + sid)[0], 404)

    def test_validation_and_size(self):
        self.assertEqual(self.req("POST", "/share", {"v": 1, "items": []})[0], 400)
        self.assertEqual(self.req("POST", "/share", b"{" + b"x" * (C.MAX_SHARE_BODY + 10))[0], 413)
        self.assertEqual(self.req("POST", "/share", b"not json")[0], 400)

    def test_admin_only(self):
        sid = json.loads(self.req("POST", "/share", payload(title="Cho quản trị xem"), email="sv9@st.neu.edu.vn")[1])["id"]
        self.assertEqual(self.req("GET", "/admin/api/shares", email="sv9@st.neu.edu.vn")[0], 403)
        self.assertEqual(self.req("GET", "/admin/shares", email="sv9@st.neu.edu.vn")[0], 403)
        st, body, _ = self.req("GET", "/admin/api/shares?q=qu%E1%BA%A3n%20tr%E1%BB%8B", email="admin@neu.edu.vn")
        self.assertEqual(st, 200)
        d = json.loads(body)
        self.assertTrue(any(i["id"] == sid and i["owner"] == "sv9@st.neu.edu.vn" for i in d["items"]))
        st, body, _ = self.req("GET", "/admin/api/shares?id=" + sid, email="admin@neu.edu.vn")
        self.assertEqual(len(json.loads(body)["item"]["items"]), 3)
        st, body, h = self.req("GET", "/admin/api/shares?format=jsonl", email="admin@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertNotIn("sv9@st.neu.edu.vn", body)          # xuất phân tích: không kèm email thật
        self.assertIn("ndjson", h["content-type"])
        self.assertEqual(self.req("POST", "/admin/api/shares", {"op": "delete", "id": sid}, email="admin@neu.edu.vn")[0], 403)  # thiếu tiêu đề chống CSRF
        self.assertEqual(self.req("POST", "/admin/api/shares", {"op": "delete", "id": sid}, email="admin@neu.edu.vn", headers=JSON_H)[0], 200)
        self.assertEqual(self.req("GET", "/share/" + sid)[0], 404)

    def test_admin_page_served(self):
        st, body, h = self.req("GET", "/admin/shares", email="admin@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertIn("Cuộc trò chuyện được chia sẻ", body)
        self.assertIn("script-src 'self'", h["content-security-policy"])


if __name__ == "__main__":
    unittest.main()


def payload_v2(**kw):
    p = {"v": 2, "title": "App trắc nghiệm", "profile": "code", "version": "0.8.20", "platform": "darwin arm64", "model": "qwen3.5-35b-a3b-int4", "mode": "bypass",
         "redactions": 1, "items": [
             {"k": "user", "t": "Làm app trắc nghiệm"},
             {"k": "tool", "n": "read_file", "t": '{"path":"khong-co.js"}', "r": "Lỗi: Không có file khong-co.js", "e": True},
             {"k": "tool", "n": "write_file", "t": '{"path":"app.js","content":"<script>alert(1)</script>"}', "r": "Đã tạo app.js"},
             {"k": "system", "t": "[Hệ thống] Bạn vừa tạo hoặc sửa tệp nhưng CHƯA chạy thử."},
             {"k": "summary", "t": "Người dùng muốn app trắc nghiệm."},
             {"k": "assistant", "t": "Xong rồi."}]}
    p.update(kw)
    return p


class V2(unittest.TestCase):
    """Bản chia sẻ v2: đủ thông tin (đối số + kết quả công cụ, lời nhắc hệ thống, tóm tắt, mô hình, chế độ) để cải tiến Handio."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir="/tmp")
        self.path = os.path.join(self.tmp, "s.db")
        self.db = SH.ShareDB(self.path, now=lambda: 2_000_000)

    def tearDown(self):
        shutil.rmtree(self.tmp, True)

    def test_clean_keeps_results_and_meta(self):
        p, e = SH.clean_payload(payload_v2())
        self.assertIsNone(e)
        self.assertEqual([i["k"] for i in p["items"]], ["user", "tool", "tool", "system", "summary", "assistant"])
        self.assertEqual(p["items"][1], {"k": "tool", "n": "read_file", "t": '{"path":"khong-co.js"}', "r": "Lỗi: Không có file khong-co.js", "e": True})
        self.assertNotIn("e", p["items"][2])
        self.assertEqual((p["model"], p["mode"]), ("qwen3.5-35b-a3b-int4", "bypass"))

    def test_clean_scrubs_results_and_rejects_bad_fields(self):
        p, _ = SH.clean_payload(payload_v2(items=[{"k": "user", "t": "x"}, {"k": "tool", "n": "bash", "t": "env", "r": "API_KEY=sk-abcdefghijklmnop1234", "e": "yes"}]))
        self.assertNotIn("sk-abcdef", p["items"][1]["r"])
        self.assertNotIn("e", p["items"][1])          # e không phải bool → bỏ
        self.assertIsNone(SH.clean_payload(payload_v2(items=[{"k": "user", "t": "x"}, {"k": "tool", "n": "bash", "t": "x", "r": 5}]))[0])
        p, _ = SH.clean_payload(payload_v2(model="<script>", mode="hack mode !!"))
        self.assertEqual((p["model"], p["mode"]), ("", ""))

    def test_store_and_render_v2(self):
        sid = self.db.create("sv@st.neu.edu.vn", SH.clean_payload(payload_v2())[0])["id"]
        d = self.db.get(sid, count_view=False)
        self.assertEqual((d["model"], d["mode"]), ("qwen3.5-35b-a3b-int4", "bypass"))
        page = SH.render_page(d)
        self.assertIn("<details", page)
        self.assertIn("Lỗi: Không có file khong-co.js", page)
        self.assertNotIn("<script>alert", page)
        self.assertIn("&lt;script&gt;", page)

    def test_old_db_gets_new_columns(self):
        import sqlite3
        old = os.path.join(self.tmp, "old.db")
        c = sqlite3.connect(old)
        c.execute("""CREATE TABLE shares (id TEXT PRIMARY KEY, owner TEXT NOT NULL, ts INTEGER NOT NULL, title TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '',
            version TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, nitems INTEGER NOT NULL, bytes INTEGER NOT NULL,
            redactions INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, last_view INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)""")
        c.commit(); c.close()
        db = SH.ShareDB(old)
        sid = db.create("a@neu.edu.vn", SH.clean_payload(payload_v2())[0])["id"]
        self.assertEqual(db.get(sid, count_view=False)["mode"], "bypass")


class Reader(unittest.TestCase):
    """neu-share-read: lệnh CHỈ ĐỌC để nhóm phát triển (và Claude) đọc một bản chia sẻ theo mã/liên kết, không lộ người chia sẻ."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir="/tmp")
        self.path = os.path.join(self.tmp, "s.db")
        db = SH.ShareDB(self.path, now=lambda: 2_000_000)
        self.sid = db.create("lan.nguyen@neu.edu.vn", SH.clean_payload(payload_v2())[0])["id"]

    def tearDown(self):
        shutil.rmtree(self.tmp, True)

    def run_reader(self, *args):
        import io
        import share_read as R
        out = io.StringIO()
        code = R.main(list(args) + ["--db", self.path], out=out)
        return code, out.getvalue()

    def test_reads_by_id_or_url_as_markdown(self):
        for ref in (self.sid, "https://ai.neu.edu.vn/agent/share/" + self.sid):
            code, text = self.run_reader(ref)
            self.assertEqual(code, 0)
            self.assertIn("Làm app trắc nghiệm", text)
            self.assertIn("read_file", text)
            self.assertIn("Lỗi: Không có file khong-co.js", text)
            self.assertIn("qwen3.5-35b-a3b-int4", text)
            self.assertIn("CHƯA chạy thử", text)
            self.assertNotIn("lan.nguyen", text)

    def test_json_and_list_without_owner(self):
        code, text = self.run_reader(self.sid, "--json")
        d = json.loads(text)
        self.assertEqual(d["id"], self.sid)
        self.assertNotIn("owner", d)
        code, text = self.run_reader("--list", "5")
        self.assertEqual(code, 0)
        self.assertIn(self.sid, text)
        self.assertNotIn("lan.nguyen", text)

    def test_rejects_bad_ref_and_missing(self):
        self.assertNotEqual(self.run_reader("../../etc/passwd")[0], 0)
        self.assertNotEqual(self.run_reader("A" * 22)[0], 0)
        self.assertNotEqual(self.run_reader("--list", "abc")[0], 0)

    def test_does_not_count_views_or_write(self):
        before = os.path.getmtime(self.path)
        self.run_reader(self.sid)
        db = SH.ShareDB(self.path)
        self.assertEqual(db.get(self.sid, count_view=False)["views"], 0)
