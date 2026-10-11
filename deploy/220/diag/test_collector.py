"""Kiểm thử bộ thu chẩn đoán:  python3 -m unittest discover -s deploy/220/diag -p 'test_*.py'  (không cần pytest)."""
import datetime
import http.client
import json
import os
import stat
import tempfile
import threading
import time
import unittest

import collector as C

SCHEMA = C.load_schema()
SECRET = b"unit-test-secret-0123456789abcdef"
INSTALL = "0123456789abcdef0123456789abcdef"
NOW = 1_800_000_000
SECRETS = ["sk-LIVE-SECRET-12345", "/Users/mac/Documents/luong-2026.xlsx", "alice.nguyen@neu.edu.vn", "https://intranet.neu.edu.vn/p?token=abc", "C:\\Users\\mac\\.ssh\\id_rsa", "rm -rf /home/secret"]


def app(**kw):
    a = {"install": INSTALL, "version": "0.1.0", "platform": "web", "profile": "code", "model": "qwen3.5-35b-a3b-int4"}
    a.update(kw)
    return a


def turn(i=0, **kw):
    e = {"t": "turn", "ts": NOW + i, "end": "ok", "dur_s": 5, "steps": 2, "tools": 1, "tool_fail": 0}
    e.update(kw)
    return e


def payload(events=None, **kw):
    p = {"v": 1, "app": app(), "sent": NOW, "events": events if events is not None else [turn()]}
    p.update(kw)
    return p


class ValidationTests(unittest.TestCase):
    def test_event_drops_unknown_fields_and_bad_values(self):
        e = C.validate_event({"t": "tool", "ts": NOW, "name": "bash", "ok": True, "dur": "lt1s", "path": SECRETS[1], "cmd": SECRETS[5]}, SCHEMA)
        self.assertEqual(e, {"t": "tool", "ts": NOW, "name": "bash", "ok": True, "dur": "lt1s"})
        self.assertIsNone(C.validate_event({"t": "tool", "ts": NOW, "name": "bash", "ok": 1, "dur": "lt1s"}, SCHEMA))  # bool phải là bool
        self.assertIsNone(C.validate_event({"t": "tool", "ts": NOW, "name": "bash", "ok": True, "dur": SECRETS[0]}, SCHEMA))
        self.assertIsNone(C.validate_event({"t": "nope", "ts": NOW}, SCHEMA))
        self.assertIsNone(C.validate_event({"t": "turn", "ts": 5, "end": "ok"}, SCHEMA))
        self.assertIsNone(C.validate_event({"t": "turn", "ts": True, "end": "ok"}, SCHEMA))
        self.assertIsNone(C.validate_event("turn", SCHEMA))
        self.assertEqual(C.validate_event({"t": "turn", "ts": NOW, "end": "ok", "dur_s": True, "steps": 1e99, "note": "x"}, SCHEMA), {"t": "turn", "ts": NOW, "end": "ok", "steps": 1000})

    def test_tool_error_code_is_enum_only(self):
        ok = C.validate_event({"t": "tool", "ts": NOW, "name": "read_file", "ok": False, "dur": "lt1s", "err": "not_found"}, SCHEMA)
        self.assertEqual(ok["err"], "not_found")
        for bad in (SECRETS[1], "Không có file luong-2026.xlsx", "x" * 50):  # lý do chỉ là mã trong danh sách; nội dung tự do bị bỏ khỏi sự kiện
            e = C.validate_event({"t": "tool", "ts": NOW, "name": "read_file", "ok": False, "dur": "lt1s", "err": bad}, SCHEMA)
            self.assertNotIn("err", e)
            self.assertNotIn(bad, json.dumps(e))

    def test_tool_name_secret_becomes_other(self):
        e = C.validate_event({"t": "signal", "ts": NOW, "code": "loop", "tool": SECRETS[0], "n": 3}, SCHEMA)
        self.assertEqual(e["tool"], "other")
        self.assertEqual(C.validate_event({"t": "signal", "ts": NOW, "code": "loop", "tool": "mcp", "n": 3}, SCHEMA)["tool"], "mcp")

    def test_note_only_on_report_and_truncated(self):
        e = C.validate_event({"t": "report", "ts": NOW, "note": "a\x00b" + "x" * 900}, SCHEMA)
        self.assertEqual(len(e["note"]), 500)
        self.assertNotIn("\x00", e["note"])
        self.assertNotIn("note", C.validate_event({"t": "llm_retry", "ts": NOW, "kind": "rate", "note": "x"}, SCHEMA))

    def test_app_validation(self):
        self.assertIsNone(C.validate_app(app(install="alice@neu.edu.vn"), SCHEMA))
        self.assertIsNone(C.validate_app(app(version="../../x"), SCHEMA))
        a = C.validate_app(app(platform=SECRETS[0], profile=SECRETS[1], model=SECRETS[2], build="zz", extra=SECRETS[3]), SCHEMA)
        self.assertEqual(a, {"install": INSTALL, "version": "0.1.0", "platform": "other", "profile": "code", "model": "other"})
        self.assertEqual(C.safe_model("Qwen/Qwen3-8B"), "Qwen3-8B")
        for s in SECRETS:
            self.assertEqual(C.safe_model(s), "other")

    def test_payload_rules(self):
        app_, evs, dropped = C.validate_payload(payload([turn(), {"t": "bad"}]), SCHEMA)
        self.assertEqual((len(evs), dropped), (1, 1))
        self.assertIsNone(C.validate_payload(payload([{"t": "bad"}]), SCHEMA)[0])  # toàn sự kiện rác
        self.assertIsNone(C.validate_payload(payload([turn()] * 201), SCHEMA)[0])
        self.assertIsNone(C.validate_payload(payload(v=2), SCHEMA)[0])
        self.assertIsNone(C.validate_payload([], SCHEMA)[0])
        self.assertEqual(C.validate_payload(payload([]), SCHEMA)[1], [])

    def test_no_secret_survives_fuzz(self):
        import random

        rnd = random.Random(7)
        vals = SECRETS + [1, -3, 1e99, float("nan"), True, None, [], {}, "bash", "ok", "loop"]
        keys = ["name", "ok", "dur", "end", "kind", "code", "tool", "note", "status", "n", "path", "text"] + SECRETS
        for _ in range(3000):
            o = {"t": rnd.choice(list(SCHEMA["events"]) + ["x", "__proto__"]), "ts": NOW}
            for _ in range(6):
                o[rnd.choice(keys)] = rnd.choice(vals)
            e = C.validate_event(o, SCHEMA)
            if e and e["t"] != "report":
                js = json.dumps(e)
                for s in SECRETS:
                    self.assertNotIn(s, js)


class LimiterTests(unittest.TestCase):
    def test_burst_refill_and_daily_cap(self):
        clock = [1000.0]
        lim = C.Limiter(burst=3, per_min=6, day_events=50, now=lambda: clock[0])
        self.assertTrue(all(lim.allow("u", 1)[0] for _ in range(3)))
        ok, retry = lim.allow("u", 1)
        self.assertFalse(ok)
        self.assertGreaterEqual(retry, 1)
        self.assertTrue(lim.allow("other", 1)[0])  # theo từng người dùng
        clock[0] += 10.5  # nạp 1 token (6/phút = 0,1/giây)
        self.assertTrue(lim.allow("u", 1)[0])
        clock[0] += 600
        self.assertFalse(lim.allow("u", 60)[0])  # vượt trần sự kiện/ngày
        self.assertTrue(lim.allow("u", 10)[0])


class StoreTests(unittest.TestCase):
    def test_rotation_and_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            now = datetime.datetime(2026, 10, 8, 12, tzinfo=datetime.timezone.utc).timestamp()
            st = C.Store(os.path.join(d, "diag"), retention_days=90, now=lambda: now)
            self.assertEqual(stat.S_IMODE(os.stat(st.dir).st_mode), 0o700)
            self.assertTrue(st.append(['{"a":1}']))
            f = os.path.join(st.dir, "2026-10-08.jsonl")
            self.assertEqual(stat.S_IMODE(os.stat(f).st_mode), 0o600)
            for name in ("2026-07-10.jsonl", "2026-07-09.jsonl", "2025-01-01.jsonl", "2026-10-01.jsonl", "notes.txt", "x.jsonl"):
                open(os.path.join(st.dir, name), "w").close()
            self.assertEqual(st.prune(), 2)  # 90 ngày trước 2026-10-08 là 2026-07-10: giữ ngày đó, xoá ngày trước đó
            left = sorted(os.listdir(st.dir))
            self.assertNotIn("2026-07-09.jsonl", left)
            self.assertNotIn("2025-01-01.jsonl", left)
            self.assertIn("2026-07-10.jsonl", left)
            self.assertIn("notes.txt", left)  # tệp lạ không đụng tới

    def test_file_size_cap(self):
        with tempfile.TemporaryDirectory() as d:
            st = C.Store(d, max_file_bytes=100)
            self.assertTrue(st.append(["x" * 50]))
            self.assertFalse(st.append(["y" * 80]))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = cls.tmp.name
        cls.diag, cls.reports = os.path.join(d, "diag"), os.path.join(d, "reports")
        os.makedirs(cls.reports)
        cls.admins, cls.health = os.path.join(d, "admins.txt"), os.path.join(d, "health.json")
        with open(cls.admins, "w") as f:
            f.write("# quản trị\nAdmin@NEU.edu.vn\nnot-an-email\n")
        with open(os.path.join(cls.reports, "latest.html"), "w") as f:
            f.write("<h1>báo cáo</h1>")
        with open(os.path.join(cls.reports, "2026-10-07.md"), "w") as f:
            f.write("# md")
        with open(os.path.join(d, "secret-outside.html"), "w") as f:
            f.write("SECRET")
        cls.lim = C.Limiter(burst=5, per_min=1, day_events=1000)
        cls.cfg = C.Config(diag_dir=cls.diag, secret=SECRET, reports_dir=cls.reports, health_file=cls.health, admins_file=cls.admins, schema=SCHEMA, limiter=cls.lim)
        cls.srv = C.make_server(cls.cfg, "127.0.0.1", 0)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def req(self, method, path, body=None, email=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = dict(headers or {})
        if email:
            h["X-User-Email"] = email
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
        if body is not None:
            h.setdefault("Content-Type", "application/json")
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data, dict(r.getheaders())

    def lines(self):
        out = []
        for n in sorted(os.listdir(self.diag)):
            with open(os.path.join(self.diag, n)) as f:
                out += [json.loads(x) for x in f if x.strip()]
        return out

    def test_valid_post_stores_pseudonymous_content_free_lines(self):
        before = len(self.lines())
        st, body, _ = self.req("POST", "/diag", payload([turn(), {"t": "tool", "ts": NOW, "name": "bash", "ok": False, "dur": "lt5s", "path": SECRETS[1]}, {"t": "junk"}]), email="alice.nguyen@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(body), {"ok": True, "accepted": 2, "dropped": 1})
        new = self.lines()[before:]
        self.assertEqual(len(new), 2)
        expect_uid = C.pseudonym(SECRET, "ALICE.nguyen@neu.edu.vn")  # không phân biệt hoa thường
        self.assertTrue(all(r["uid"] == expect_uid and len(r["uid"]) == 16 for r in new))
        with open(os.path.join(self.diag, os.listdir(self.diag)[0])) as fh:
            raw = fh.read()
        self.assertNotIn("alice", raw.lower())
        self.assertNotIn(SECRETS[1], raw)
        self.assertEqual(new[1]["e"], {"t": "tool", "ts": NOW, "name": "bash", "ok": False, "dur": "lt5s"})
        for n in os.listdir(self.diag):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.diag, n)).st_mode), 0o600)

    def test_rejections(self):
        e = "rej@neu.edu.vn"
        self.assertEqual(self.req("POST", "/diag", payload())[0], 401)  # thiếu X-User-Email (nginx luôn gắn)
        self.assertEqual(self.req("POST", "/diag", payload(), email="not an email")[0], 401)
        self.assertEqual(self.req("POST", "/diag", b"{nope", email=e)[0], 400)
        self.assertEqual(self.req("POST", "/diag", b"", email=e)[0], 400)
        self.assertEqual(self.req("POST", "/diag", payload(v=9), email=e)[0], 400)
        self.assertEqual(self.req("POST", "/diag", payload(app={"install": "x"}), email=e)[0], 400)
        retry = {"t": "llm_retry", "ts": NOW, "kind": "rate"}
        self.assertEqual(self.req("POST", "/diag", payload([retry] * 201), email=e)[0], 400)  # quá 200 sự kiện (thân vẫn <16 KB)
        self.assertEqual(self.req("POST", "/diag", payload([{"t": "x"}]), email=e)[0], 400)
        big = json.dumps(payload([turn(note="x" * 20000)])).encode()
        self.assertGreater(len(big), 16384)
        self.assertEqual(self.req("POST", "/diag", big, email=e)[0], 413)
        self.assertEqual(self.req("POST", "/other", payload(), email=e)[0], 404)
        self.assertEqual(self.req("GET", "/diag", email=e)[0], 404)
        self.assertEqual(self.req("PUT", "/diag", payload(), email=e)[0], 405)
        self.assertEqual(self.req("DELETE", "/diag", email=e)[0], 405)

    def test_chunked_rejected(self):
        st, _, _ = self.req("POST", "/diag", b"2\r\n{}\r\n0\r\n\r\n", email="c@neu.edu.vn", headers={"Transfer-Encoding": "chunked"})
        self.assertIn(st, (400, 411))

    def test_rate_limit_per_user(self):
        e = "ratelimit@neu.edu.vn"
        codes = [self.req("POST", "/diag", payload(), email=e)[0] for _ in range(8)]
        self.assertEqual(codes[:5], [200] * 5)
        self.assertEqual(set(codes[5:]), {429})
        st, _, h = self.req("POST", "/diag", payload(), email=e)
        self.assertEqual(st, 429)
        self.assertGreaterEqual(int(h["Retry-After"]), 1)
        self.assertEqual(self.req("POST", "/diag", payload(), email="someone.else@neu.edu.vn")[0], 200)  # người khác không bị ảnh hưởng

    def test_health(self):
        self.assertEqual(json.loads(self.req("GET", "/healthz")[1]), {"ok": True})
        st, body, _ = self.req("GET", "/public-healthz")
        self.assertEqual((st, json.loads(body)), (503, {"ok": False}))  # chưa có health.json
        with open(self.health, "w") as f:
            json.dump({"ok": True, "checks": {"secret": "không được lộ"}}, f)
        st, body, _ = self.req("GET", "/public-healthz")
        self.assertEqual((st, body), (200, b'{"ok":true}'))  # CHỈ {ok}
        old = time.time() - 3600
        os.utime(self.health, (old, old))
        self.assertEqual(self.req("GET", "/public-healthz")[0], 503)  # quá cũ
        with open(self.health, "w") as f:
            json.dump({"ok": False}, f)
        self.assertEqual(self.req("GET", "/public-healthz")[0], 503)

    def test_admin_access(self):
        self.assertEqual(self.req("GET", "/admin/")[0], 403)
        self.assertEqual(self.req("GET", "/admin/", email="user@neu.edu.vn")[0], 403)
        st, body, h = self.req("GET", "/admin/", email="admin@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertIn("báo cáo".encode(), body)
        csp = h["Content-Security-Policy"]
        self.assertIn("default-src 'none'", csp)
        self.assertIn("script-src 'self';", csp)                      # chỉ admin.js cùng nguồn; không nhúng, không eval
        self.assertNotIn("unsafe-eval", csp)
        self.assertNotIn("connect-src", csp.replace("default-src 'none'", ""))   # không ra mạng
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(h["Cache-Control"], "no-store")
        self.assertEqual(self.req("GET", "/admin/admin.js")[0], 403)
        self.assertEqual(self.req("GET", "/admin/admin.js", email="user@neu.edu.vn")[0], 403)
        st, js, jh = self.req("GET", "/admin/admin.js", email="admin@neu.edu.vn")
        self.assertEqual(st, 200)
        self.assertIn("text/javascript", jh["Content-Type"])
        self.assertNotRegex(js.decode(), r"innerHTML|outerHTML|eval\(|new Function|document\.write|fetch\(|XMLHttpRequest|localStorage")
        self.assertEqual(self.req("GET", "/admin/2026-10-07.md", email="ADMIN@neu.edu.vn")[0], 200)
        self.assertEqual(self.req("GET", "/admin/missing.html", email="admin@neu.edu.vn")[0], 404)
        for bad in ("/admin/../secret-outside.html", "/admin/%2e%2e/secret-outside.html", "/admin/..%2fsecret-outside.html", "/admin/.hidden.html", "/admin/a/b.html", "/admin/x.py"):
            st, body, _ = self.req("GET", bad, email="admin@neu.edu.vn")
            self.assertEqual(st, 404, bad)
            self.assertNotIn(b"SECRET", body)

    def test_admin_serves_detail_pages_and_csv_but_not_traversal(self):
        for name, ctype in (("u-1a2b3c4d.html", "text/html"), ("d-2026-10-08.html", "text/html"), ("users.csv", "text/csv")):
            with open(os.path.join(self.reports, name), "w") as f:
                f.write("x")
        try:
            for name, ctype in (("u-1a2b3c4d.html", "text/html"), ("d-2026-10-08.html", "text/html"), ("users.csv", "text/csv")):
                st, body, h = self.req("GET", "/admin/" + name, email="admin@neu.edu.vn")
                self.assertEqual(st, 200, name)
                self.assertTrue(h["Content-Type"].startswith(ctype))
                self.assertEqual(self.req("GET", "/admin/" + name, email="user@neu.edu.vn")[0], 403)   # người thường không xem được
            self.assertEqual(self.req("GET", "/admin/u-../x.csv", email="admin@neu.edu.vn")[0], 404)
        finally:
            for name in ("u-1a2b3c4d.html", "d-2026-10-08.html", "users.csv"):
                os.unlink(os.path.join(self.reports, name))

    def test_admin_root_prefers_index_html(self):
        idx = os.path.join(self.reports, "index.html")
        with open(idx, "w") as f:
            f.write("<h1>tong quan</h1>")
        try:
            self.assertIn(b"tong quan", self.req("GET", "/admin/", email="admin@neu.edu.vn")[1])
            self.assertIn("báo cáo".encode(), self.req("GET", "/admin/latest", email="admin@neu.edu.vn")[1])
        finally:
            os.unlink(idx)

    def test_admin_denied_when_no_admin_file(self):
        saved = self.cfg.admins_file
        try:
            self.cfg.admins_file = os.path.join(self.tmp.name, "nope.txt")
            self.assertEqual(self.req("GET", "/admin/", email="admin@neu.edu.vn")[0], 403)
        finally:
            self.cfg.admins_file = saved


if __name__ == "__main__":
    unittest.main()
