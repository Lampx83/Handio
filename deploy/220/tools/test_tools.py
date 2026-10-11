import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tools


class UrlSafety(unittest.TestCase):
    def blocked(self, url, resolve=None):
        with self.assertRaises(tools.UrlError, msg=url):
            tools.check_url(url, resolve or (lambda h: ["93.184.216.34"]))

    def test_rejects_unsafe_addresses(self):
        for u in [
            "file:///etc/passwd", "ftp://example.com/x", "gopher://example.com", "javascript:alert(1)",
            "http://user:pw@example.com/", "http://localhost/", "http://a.localhost/", "http://printer.local/", "http://db.internal/",
            "http://intranet/", "http://2130706433/", "http://example.com:22/", "http://example.com:6379/", "http:///x", "",
            "http://exa mple.com/", "http://example.com/\r\nHost: evil", "x" * 2100,
        ]:
            self.blocked(u)

    def test_rejects_private_resolutions(self):
        for ip in ["127.0.0.1", "10.0.0.58", "10.0.0.51", "192.168.1.1", "172.16.0.5", "169.254.169.254", "100.64.0.1", "0.0.0.0",
                   "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1"]:
            self.blocked("http://example.com/", lambda h, ip=ip: [ip])

    def test_one_private_address_among_many_is_enough_to_block(self):
        self.blocked("http://example.com/", lambda h: ["93.184.216.34", "10.0.0.1"])

    def test_accepts_public(self):
        s, h, p, path, ip = tools.check_url("https://Example.com/a/b?x=1#f", lambda h: ["93.184.216.34"])
        self.assertEqual((s, h, p, path, ip), ("https", "example.com", 443, "/a/b?x=1", "93.184.216.34"))
        self.assertEqual(tools.check_url("http://example.com:8080", lambda h: ["93.184.216.34"])[2:4], (8080, "/"))
        self.assertTrue(tools.is_public_ip("8.8.8.8"))
        self.assertTrue(tools.is_public_ip("2606:4700:4700::1111"))


class FakeConn:
    """Kết nối giả: trả về kịch bản theo (host, path)."""
    script = {}
    seen = []

    def __init__(self, host, port, ip, tls, timeout):
        self.host, self.port, self.ip = host, port, ip

    def request(self, method, path, headers=None):
        FakeConn.seen.append((self.host, self.ip, path, headers))
        self.resp = FakeConn.script[(self.host, path)]

    def getresponse(self):
        status, hdrs, body = self.resp

        class R:
            def __init__(s):
                s.status = status

            def getheader(s, k, d=None):
                return hdrs.get(k, d)

            def read(s, n=-1):
                return body[:n] if n >= 0 else body
        return R()

    def close(self):
        pass


PUBLIC = {"a.example": "93.184.216.34", "b.example": "93.184.216.35", "evil.example": "10.0.0.58"}
resolve = lambda h: [PUBLIC[h]]


class Fetch(unittest.TestCase):
    def setUp(self):
        FakeConn.seen = []

    def go(self, url, **kw):
        return tools.fetch_url(url, resolve=resolve, connect=FakeConn, **kw)

    def test_follows_redirect_and_pins_ip(self):
        FakeConn.script = {("a.example", "/"): (302, {"Location": "https://b.example/page"}, b""), ("b.example", "/page"): (200, {"Content-Type": "text/html; charset=utf-8"}, "<p>Xin chào</p>".encode())}
        final, ctype, body, _ = self.go("http://a.example/")
        self.assertEqual((final, ctype, body), ("https://b.example/page", "text/html", b"<p>Xin ch\xc3\xa0o</p>"))
        self.assertEqual([s[1] for s in FakeConn.seen], ["93.184.216.34", "93.184.216.35"])  # kết nối tới IP đã kiểm tra
        self.assertNotIn("Cookie", FakeConn.seen[0][3])
        self.assertNotIn("Authorization", FakeConn.seen[0][3])

    def test_redirect_into_private_network_is_blocked(self):
        FakeConn.script = {("a.example", "/"): (302, {"Location": "http://evil.example/admin"}, b"")}
        with self.assertRaises(tools.UrlError):
            self.go("http://a.example/")
        self.assertEqual(len(FakeConn.seen), 1)

    def test_redirect_loop_and_errors(self):
        FakeConn.script = {("a.example", "/"): (302, {"Location": "/"}, b"")}
        with self.assertRaisesRegex(tools.FetchError, "quá nhiều"):
            self.go("http://a.example/")
        FakeConn.script = {("a.example", "/"): (404, {}, b"")}
        with self.assertRaisesRegex(tools.FetchError, "404"):
            self.go("http://a.example/")
        FakeConn.script = {("a.example", "/"): (200, {"Content-Type": "application/pdf"}, b"%PDF")}
        with self.assertRaisesRegex(tools.FetchError, "PDF"):
            self.go("http://a.example/")

    def test_body_size_capped(self):
        FakeConn.script = {("a.example", "/"): (200, {"Content-Type": "text/plain"}, b"x" * (tools.MAX_BODY + 500))}
        self.assertEqual(len(self.go("http://a.example/")[2]), tools.MAX_BODY)


class Render(unittest.TestCase):
    PAGE = """<html><head><title>Học phí &amp; lệ phí</title><style>.a{}</style><script>alert(1)</script></head>
    <body><nav>Trang chủ | Liên hệ</nav><header>LOGO</header>
    <main><h1>Học phí 2026</h1><p>Mức thu <b>tăng</b> 10%.</p><ul><li>Chuẩn</li><li>CLC</li></ul>
    <table><tr><td>Ngành</td><td>Giá</td></tr></table>""" + ("<p>Nội dung dài để vượt ngưỡng chọn vùng chính. " * 20) + """</p></main>
    <footer>Bản quyền</footer><button>Gửi</button></body></html>"""

    def test_main_content_extracted_without_noise(self):
        title, text = tools.html_to_text(self.PAGE)
        self.assertEqual(title, "Học phí & lệ phí")
        self.assertIn("# Học phí 2026", text)
        self.assertIn("- Chuẩn\n- CLC", text)
        self.assertIn("Ngành | Giá", text.replace("  ", " "))
        for noise in ["alert(1)", "Trang chủ", "LOGO", "Bản quyền", "Gửi"]:
            self.assertNotIn(noise, text)

    def test_small_page_falls_back_to_whole_body(self):
        _, text = tools.html_to_text("<html><body><nav>Menu</nav><p>Chỉ có một dòng.</p><div>Thêm</div></body></html>")
        self.assertIn("Chỉ có một dòng.", text)

    def test_render_page_header_cut_and_empty(self):
        out = tools.render_page("https://a.example/x", "text/html", self.PAGE.encode(), "text/html; charset=utf-8", 600)
        self.assertTrue(out.startswith("Nguồn: https://a.example/x\nTiêu đề: Học phí & lệ phí\n"))
        self.assertTrue(out.endswith("(đã cắt bớt)"))
        with self.assertRaisesRegex(tools.FetchError, "không có nội dung"):
            tools.render_page("u", "text/html", b"<html><script>x</script></html>", "", 1000)

    def test_decodes_declared_charset(self):
        raw = "<p>Việt Nam</p>".encode("utf-16")
        self.assertIn("Việt Nam", tools.decode_body(raw, "text/html; charset=utf-16"))


class Search(unittest.TestCase):
    DATA = {"results": [
        {"title": "Học phí <b>NEU</b>", "url": "https://fit.neu.edu.vn/hp", "content": "Mức thu &amp; miễn giảm"},
        {"title": "Trùng", "url": "https://fit.neu.edu.vn/hp", "content": "x"},
        {"title": "javascript", "url": "javascript:alert(1)", "content": "x"},
        {"title": "Báo", "url": "https://laodong.vn/a", "content": "tin " * 200},
    ]}

    def test_format_dedup_filters_and_truncates(self):
        out = tools.format_results("học phí", self.DATA, 5)
        self.assertIn("2 kết quả", out)
        self.assertIn("1. Học phí NEU\n   https://fit.neu.edu.vn/hp\n   Mức thu & miễn giảm", out)
        self.assertNotIn("javascript:", out)
        self.assertLess(len(out.split("\n")[-3]), 400)
        self.assertEqual(tools.format_results("zz", {"results": []}, 5).startswith("Không tìm thấy"), True)

    def test_search_builds_query_and_handles_bad_json(self):
        got = []
        out = tools.search("học phí 2026", 3, "month", get=lambda u: (got.append(u), json.dumps(self.DATA).encode())[1])
        self.assertIn("language=vi-VN", got[0])
        self.assertIn("time_range=month", got[0])
        self.assertIn("format=json", got[0])
        self.assertIn("Học phí NEU", out)
        self.assertIn("language=auto", (tools.search("python", 3, "", get=lambda u: (got.append(u), b'{"results":[]}')[1]), got[-1])[1])
        with self.assertRaises(tools.FetchError):
            tools.search("x", 3, "", get=lambda u: b"<html>")


class Limits(unittest.TestCase):
    def test_sliding_window(self):
        lim = tools.Limiter()
        self.assertTrue(all(lim.allow("u", 3, 60, now=t)[0] for t in (0, 1, 2)))
        ok, wait = lim.allow("u", 3, 60, now=3)
        self.assertFalse(ok)
        self.assertEqual(wait, 58)
        self.assertTrue(lim.allow("u", 3, 60, now=61)[0])
        self.assertTrue(lim.allow("other", 3, 60, now=3)[0])


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Fake(BaseHTTPRequestHandler):  # SearXNG giả
            def do_GET(s):
                body = json.dumps({"results": [{"title": "Kết quả", "url": "https://a.example/", "content": "nội dung"}]}).encode()
                s.send_response(200); s.send_header("Content-Type", "application/json"); s.send_header("Content-Length", str(len(body))); s.end_headers(); s.wfile.write(body)

            def log_message(s, *a):
                pass
        cls.fake = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        tools.SEARX = f"http://127.0.0.1:{cls.fake.server_address[1]}"
        tools.search.__defaults__ = (tools.SEARX, None)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), tools.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.fake.shutdown()

    def call(self, path, user="sv@st.neu.edu.vn"):
        req = urllib.request.Request(self.base + path, headers={"X-User-Email": user} if user else {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.read().decode(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), dict(e.headers)

    def test_search_ok_and_requires_identity(self):
        st, body, h = self.call("/tools/search?q=h%E1%BB%8Dc+ph%C3%AD")
        self.assertEqual(st, 200)
        self.assertIn("1. Kết quả\n   https://a.example/", body)
        self.assertEqual(h["Cache-Control"], "no-store")
        self.assertEqual(self.call("/tools/search?q=abc", user=None)[0], 401)
        self.assertEqual(self.call("/tools/search?q=a")[0], 400)
        self.assertEqual(self.call("/tools/other")[0], 404)

    def test_fetch_refuses_internal_targets(self):
        for target in ["http://127.0.0.1:4191/healthz", "http://10.0.0.58:8037/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "http://localhost/"]:
            st, body, _ = self.call("/tools/fetch?url=" + urllib.parse.quote(target, safe=""))
            self.assertEqual(st, 400, target)
            self.assertIn("error", json.loads(body))

    def test_per_user_rate_limit(self):
        tools.LIMITER.hits.clear()
        old = tools.SEARCH_PER_10MIN
        tools.SEARCH_PER_10MIN = 2
        try:
            codes = [self.call("/tools/search?q=hello", user="a@x.vn")[0] for _ in range(3)]
            self.assertEqual(codes, [200, 200, 429])
            self.assertEqual(self.call("/tools/search?q=hello", user="b@x.vn")[0], 200)
        finally:
            tools.SEARCH_PER_10MIN = old
            tools.LIMITER.hits.clear()

    def test_healthz_has_counts_only(self):
        st, body, _ = self.call("/healthz", user=None)
        d = json.loads(body)
        self.assertTrue(d["ok"])
        self.assertEqual(set(d), {"ok", "search", "fetch", "errors", "limited"})


import urllib.parse  # noqa: E402

if __name__ == "__main__":
    unittest.main()
