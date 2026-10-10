"""Kiểm thử kho góp ý (feedback.py) và các route của bộ thu (POST /feedback, /admin/api/feedback, trang /admin/feedback)."""
import http.client
import json
import os
import shutil
import tempfile
import threading
import unittest

import collector as C
import feedback as FB
from test_collector import app as diag_app  # noqa: F401  (đảm bảo lược đồ nạp được)

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = b"unit-test-secret-0123456789abcdef"
JSON_H = {"Content-Type": "application/json", "X-Neu-Admin": "1", "Origin": "https://ai.neu.edu.vn", "Sec-Fetch-Site": "same-origin"}


class Clean(unittest.TestCase):
    def test_valid_and_normalised(self):
        s, e = FB.clean_submission({"kind": "bug", "text": "  Nút gửi không bấm được \x00\x07 ở tab Work \r\n\r\n\r\n\r\n\r\nrất khó chịu  ",
                                    "ctx": {"version": "0.5.0", "platform": "darwin arm64", "tab": "work", "model": "qwen3.5-35b-a3b-int4", "evil": "x"}})
        self.assertIsNone(e)
        self.assertEqual(s["kind"], "bug")
        self.assertNotIn("\x00", s["text"])
        self.assertNotIn("\n\n\n\n", s["text"])
        self.assertEqual((s["version"], s["platform"], s["tab"]), ("0.5.0", "darwin arm64", "work"))
        self.assertNotIn("evil", s)

    def test_rejects_bad_input(self):
        for raw in [None, [], {"kind": "x", "text": "xin chào các bạn"}, {"kind": "bug"}, {"kind": "bug", "text": 5}, {"kind": "idea", "text": "ab"}, {"kind": "idea", "text": "   \n  "}]:
            self.assertIsNone(FB.clean_submission(raw)[0], repr(raw))

    def test_text_capped_and_bad_context_dropped(self):
        s, _ = FB.clean_submission({"kind": "other", "text": "x" * 10000, "ctx": {"version": "1.2", "platform": "<script>", "tab": "a" * 100, "model": "ok-model"}})
        self.assertEqual(len(s["text"]), FB.MAX_TEXT)
        self.assertEqual((s["version"], s["platform"], s["tab"], s["model"]), ("", "", "", "ok-model"))


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(dir="/tmp")
        self.t = [1_000_000]
        self.db = FB.FeedbackDB(os.path.join(self.tmp, "fb.db"), now=lambda: self.t[0])

    def tearDown(self):
        shutil.rmtree(self.tmp, True)

    def sub(self, text="Góp ý thử nghiệm số một", kind="idea"):
        return FB.clean_submission({"kind": kind, "text": text})[0]

    def test_add_list_filter_update_delete(self):
        a = self.db.add("sv1@st.neu.edu.vn", self.sub("Muốn có chế độ tối cho trang quản trị", "idea"))["id"]
        self.t[0] += 1
        b = self.db.add("gv1@neu.edu.vn", self.sub("Bấm Gửi mà không thấy gì xảy ra", "bug"))["id"]
        r = self.db.list()
        self.assertEqual([i["id"] for i in r["items"]], [b, a])
        self.assertEqual(r["by_status"], {"new": 2})
        self.assertEqual([i["id"] for i in self.db.list(kind="bug")["items"]], [b])
        self.assertEqual([i["id"] for i in self.db.list(q="chế độ tối")["items"]], [a])
        self.assertEqual([i["id"] for i in self.db.list(q="gv1")["items"]], [b])
        self.assertEqual(self.db.list(q="100%_")["total"], 0)  # ký tự đại diện LIKE không bị hiểu sai
        self.assertTrue(self.db.update(a, "planned", "Sẽ làm ở 0.6", "admin@neu.edu.vn")["ok"])
        it = self.db.list(status="planned")["items"][0]
        self.assertEqual((it["id"], it["note"], it["updated_by"]), (a, "Sẽ làm ở 0.6", "admin@neu.edu.vn"))
        self.assertFalse(self.db.update(a, "weird", "", "x")["ok"])
        self.assertEqual(self.db.update(9999, "done", "", "x")["error"], "not_found")
        self.assertTrue(self.db.delete(b)["ok"])
        self.assertEqual(self.db.list()["total"], 1)
        self.assertEqual(self.db.summary(), {"new": 0, "total": 1})

    def test_rate_limits_and_duplicates(self):
        for i in range(FB.PER_HOUR):
            self.assertTrue(self.db.add("sv@st.neu.edu.vn", self.sub("Góp ý khác nhau số %d ở đây" % i))["ok"])
        r = self.db.add("sv@st.neu.edu.vn", self.sub("Thêm một góp ý nữa vượt giờ"))
        self.assertEqual((r["ok"], r["error"]), (False, "rate"))
        self.assertTrue(self.db.add("khac@st.neu.edu.vn", self.sub("Người khác vẫn gửi được bình thường"))["ok"])
        self.t[0] += 3601
        self.assertTrue(self.db.add("sv@st.neu.edu.vn", self.sub("Sau một giờ đã gửi lại được rồi"))["ok"])
        d1 = self.db.add("sv@st.neu.edu.vn", self.sub("Nội dung giống hệt gửi hai lần"))
        d2 = self.db.add("sv@st.neu.edu.vn", self.sub("Nội dung giống hệt gửi hai lần"))
        self.assertEqual(d1["id"], d2["id"])
        self.assertTrue(d2.get("duplicate"))

    def test_sql_injection_is_inert(self):
        r = self.db.add("x'); DROP TABLE feedback;--@a.vn", self.sub("'); DROP TABLE feedback; -- chữ thường"))
        self.assertTrue(r["ok"])
        self.assertEqual(self.db.list(q="' OR '1'='1")["total"], 0)
        self.assertEqual(self.db.list()["total"], 1)


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
        for n in ("feedback.html", "feedback.js"):
            shutil.copy(os.path.join(HERE, n), os.path.join(web, n))
        cls.cfg = C.Config(diag_dir=os.path.join(d, "diag"), secret=SECRET, reports_dir=os.path.join(d, "r"), admins_file=cls.admins, web_dir=web,
                           feedback=FB.FeedbackDB(os.path.join(d, "fb.db")))
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
        c.close()
        return r.status, data

    def test_submit_requires_identity_and_validates(self):
        ok = {"kind": "bug", "text": "Không mở được tệp Word trong tab Work", "ctx": {"version": "0.5.0", "tab": "work"}}
        self.assertEqual(self.req("POST", "/feedback", ok, email=None)[0], 401)
        st, body = self.req("POST", "/feedback", ok, email="khach01")
        self.assertEqual(st, 200, body)
        self.assertGreater(json.loads(body)["id"], 0)
        self.assertEqual(self.req("POST", "/feedback", {"kind": "bug", "text": "ab"})[0], 400)
        self.assertEqual(self.req("POST", "/feedback", b"not json")[0], 400)
        self.assertEqual(self.req("POST", "/feedback", b"{" + b"x" * 9000)[0], 413)

    def test_admin_only_list_and_update(self):
        self.req("POST", "/feedback", {"kind": "idea", "text": "Nên có nút xuất toàn bộ lịch sử trò chuyện"}, email="gv9@neu.edu.vn")
        self.assertEqual(self.req("GET", "/admin/api/feedback", email="sv1@st.neu.edu.vn")[0], 403)
        self.assertEqual(self.req("GET", "/admin/feedback", email="sv1@st.neu.edu.vn")[0], 403)
        st, body = self.req("GET", "/admin/api/feedback?status=new&q=xu%E1%BA%A5t", email="admin@neu.edu.vn")
        d = json.loads(body)
        self.assertEqual(st, 200)
        self.assertTrue(any(i["ident"] == "gv9@neu.edu.vn" for i in d["items"]))
        fid = d["items"][0]["id"]
        # chống CSRF: thiếu tiêu đề tuỳ biến / sai nguồn bị từ chối
        self.assertEqual(self.req("POST", "/admin/api/feedback", {"op": "set", "id": fid, "status": "done"}, email="admin@neu.edu.vn", headers={"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.req("POST", "/admin/api/feedback", {"op": "set", "id": fid, "status": "done"}, email="sv1@st.neu.edu.vn", headers=JSON_H)[0], 403)
        st, body = self.req("POST", "/admin/api/feedback", {"op": "set", "id": fid, "status": "done", "note": "Đã có ở 0.5.0"}, email="admin@neu.edu.vn", headers=JSON_H)
        self.assertEqual(st, 200, body)
        self.assertEqual(self.req("POST", "/admin/api/feedback", {"op": "set", "id": fid, "status": "bogus"}, email="admin@neu.edu.vn", headers=JSON_H)[0], 400)
        self.assertEqual(self.req("POST", "/admin/api/feedback", {"op": "delete", "id": 424242}, email="admin@neu.edu.vn", headers=JSON_H)[0], 404)

    def test_admin_page_is_served_with_strict_csp(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/admin/feedback", headers={"X-User-Email": "admin@neu.edu.vn"})
        r = c.getresponse()
        body = r.read().decode()
        self.assertEqual(r.status, 200)
        self.assertIn("script-src 'self'", r.getheader("Content-Security-Policy"))
        self.assertIn("Góp ý của người dùng", body)
        c.close()


if __name__ == "__main__":
    unittest.main()
