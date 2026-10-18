"""Kiểm thử healthz.py bằng máy chủ giả cục bộ."""
import datetime
import http.server
import importlib
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

KEY = "khoa-thu-gia-123"


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def serve(status, body=b"{}", chat="sse", chat_status=200, delay=0.0):
    """Máy chủ giả: GET trả `status`; POST (chat) trả SSE / JSON / treo tuỳ `chat`. Ghi lại các lệnh chat đã nhận."""
    seen = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            seen.append({"path": self.path, "key": self.headers.get("x-ollama-seckey"), "body": req})
            time.sleep(delay)
            if chat_status != 200:
                b = b'{"error":"x"}'
                self.send_response(chat_status)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return
            if chat == "json":
                b = json.dumps({"choices": [{"message": {"content": "p"}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if chat == "empty":                  # trả 200 nhưng không sinh token nào
                self.wfile.write(b"data: [DONE]\n\n")
                return
            self.wfile.write(b': keep-alive\n\ndata: {"choices":[{"delta":{"content":"p"}}]}\n\ndata: [DONE]\n\n')

        def log_message(self, *a):
            pass

    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    s.seen = seen
    s.daemon_threads = True  # không chờ luồng đang "treo" khi đóng
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.servers = []
        self.old_cred = os.environ.pop("CREDENTIALS_DIRECTORY", None)

    def tearDown(self):
        for k in [k for k in os.environ if k.startswith("NEU_HEALTH_")]:
            del os.environ[k]
        os.environ.pop("CREDENTIALS_DIRECTORY", None)
        if self.old_cred is not None:
            os.environ["CREDENTIALS_DIRECTORY"] = self.old_cred
        ts = [threading.Thread(target=s.shutdown) for s in self.servers]  # song song: mỗi shutdown chờ tới 0,5 s
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        for s in self.servers:
            s.server_close()
        self.tmp.cleanup()

    def path(self, *p):
        return os.path.join(self.tmp.name, *p)

    def write(self, name, content):
        with open(self.path(name), "w", encoding="utf-8") as f:
            f.write(content)
        return self.path(name)

    def load(self, oauth=None, gw=None, coll=None, quota=None, key=KEY, **env):
        oauth = oauth or serve(200, b"OK")
        gw = gw or serve(401)
        coll = coll or serve(200, b'{"ok":true}')
        quota = quota or serve(200, b'{"ok":true}')
        self.servers += [oauth, gw, coll, quota]
        e = {"NEU_HEALTH_OAUTH2": "http://127.0.0.1:%d/ping" % oauth.server_address[1], "NEU_HEALTH_GATEWAY": "http://127.0.0.1:%d/" % gw.server_address[1],
             "NEU_HEALTH_COLLECTOR": "http://127.0.0.1:%d/healthz" % coll.server_address[1], "NEU_HEALTH_QUOTA": "http://127.0.0.1:%d/healthz" % quota.server_address[1], "NEU_HEALTH_FILE": self.path("h", "health.json"),
             "NEU_HEALTH_LOG": self.path("log", "health.log"), "NEU_HEALTH_DISK_PATHS": self.tmp.name, "NEU_HEALTH_TIMEOUT": "1",
             "NEU_HEALTH_ENTRA_EXPIRES": self.path("khong-co-tep")}
        if key is not None:
            e["NEU_HEALTH_KEY_FILE"] = self.write("model-key", key + "\n")
        e.update(env)
        for k, v in e.items():
            os.environ[k] = v
        import healthz

        self.gw = gw
        return importlib.reload(healthz)

    def health(self, H):
        return json.loads(read(H.HEALTH_FILE))


class HealthzTests(Base):
    def test_all_ok(self):
        H = self.load()  # cổng trả 401 cho GET vẫn là "đang sống"
        self.assertEqual(H.main(), 0)
        h = self.health(H)
        self.assertTrue(h["ok"])
        self.assertEqual(set(h["checks"]), {"oauth2", "gateway", "chat", "collector", "quota", "disk"})
        self.assertEqual(h["warn"], [])
        self.assertFalse(os.path.exists(H.LOG_FILE))
        self.assertEqual(oct(os.stat(H.HEALTH_FILE).st_mode & 0o777), oct(0o640))

    def test_quota_gateway_down_is_reported(self):
        H = self.load(quota=serve(503, b'{"ok":false}'))
        self.assertEqual(H.main(), 1)
        self.assertEqual([k for k, v in self.health(H)["checks"].items() if not v["ok"]], ["quota"])

    def test_failures_logged_and_exit_1(self):
        dead = serve(200)
        dead.shutdown()
        dead.server_close()  # cổng đóng
        H = self.load(serve(503), dead, serve(200, b'{"ok":false}'))
        self.assertEqual(H.main(), 1)
        h = self.health(H)
        self.assertFalse(h["ok"])
        self.assertEqual([k for k, v in h["checks"].items() if not v["ok"]], ["oauth2", "gateway", "chat", "collector"])
        line = read(H.LOG_FILE)
        self.assertIn("FAIL", line)
        self.assertIn("gateway", line)
        H.main()
        self.assertEqual(len(read(H.LOG_FILE).splitlines()), 2)  # mỗi lần lỗi thêm một dòng

    def test_disk_low(self):
        H = self.load(NEU_HEALTH_MIN_FREE_GB="999999")
        self.assertEqual(H.main(), 1)
        self.assertFalse(self.health(H)["checks"]["disk"]["ok"])


class ChatProbe(Base):
    def test_real_chat_sends_tiny_request_with_key(self):
        H = self.load()
        self.assertEqual(H.main(), 0)
        c = self.health(H)["checks"]["chat"]
        self.assertTrue(c["ok"])
        self.assertIsInstance(c["ms"], int)
        (req,) = self.gw.seen
        self.assertEqual(req["path"], "/vllm/v1/chat/completions")
        self.assertEqual(req["key"], KEY)
        self.assertLessEqual(req["body"]["max_tokens"], 4, "chỉ tốn vài token")
        self.assertTrue(req["body"]["stream"])
        self.assertNotIn(KEY, read(H.HEALTH_FILE), "key không bao giờ vào health.json")

    def test_gateway_alive_but_vllm_broken_is_red(self):
        # trước đây mục gateway chấp nhận mọi mã nên vLLM hỏng vẫn xanh
        for gw, why in ((serve(401, chat_status=502), "HTTP 502"), (serve(401, chat="empty"), "không có token"), (serve(401, chat_status=401), "HTTP 401")):
            with self.subTest(why):
                H = self.load(gw=gw)
                self.assertEqual(H.main(), 1)
                h = self.health(H)
                self.assertTrue(h["checks"]["gateway"]["ok"])
                self.assertFalse(h["checks"]["chat"]["ok"])
                self.assertIn(why, h["checks"]["chat"]["detail"])
                self.assertIn("chat", read(H.LOG_FILE))
                os.remove(H.HEALTH_FILE)

    def test_slow_first_token_is_red(self):
        H = self.load(gw=serve(401, delay=0.6), NEU_HEALTH_CHAT_MAX_MS="300")
        self.assertEqual(H.main(), 1)
        c = self.health(H)["checks"]["chat"]
        self.assertFalse(c["ok"])
        self.assertGreaterEqual(c["ms"], 300)

    def test_hung_vllm_times_out(self):
        H = self.load(gw=serve(401, delay=2.5), NEU_HEALTH_CHAT_MAX_MS="300")
        t0 = time.time()
        self.assertEqual(H.main(), 1)
        self.assertLess(time.time() - t0, 2.4, "không chờ quá ngưỡng + chút dư")
        self.assertFalse(self.health(H)["checks"]["chat"]["ok"])

    def test_non_stream_json_answer_is_accepted(self):
        H = self.load(gw=serve(401, chat="json"))
        self.assertEqual(H.main(), 0)

    def test_probe_runs_every_15_minutes_but_retries_after_failure(self):
        H = self.load()
        H.main()
        H.main()
        self.assertEqual(len(self.gw.seen), 1, "kết quả tốt được dùng lại trong 15 phút")
        h = self.health(H)
        h["checks"]["chat"]["at"] -= 16 * 60
        with open(H.HEALTH_FILE, "w", encoding="utf-8") as f:
            json.dump(h, f)
        H.main()
        self.assertEqual(len(self.gw.seen), 2, "quá 15 phút: thử lại")
        h = self.health(H)
        h["checks"]["chat"]["ok"] = False
        with open(H.HEALTH_FILE, "w", encoding="utf-8") as f:
            json.dump(h, f)
        H.main()
        self.assertEqual(len(self.gw.seen), 3, "lần trước lỗi: thử lại ngay, không chờ 15 phút")

    def test_no_key_is_warning_not_red(self):
        H = self.load(key=None, NEU_HEALTH_KEY_FILE=self.path("khong-co"))
        self.assertEqual(H.main(), 0)
        h = self.health(H)
        self.assertTrue(h["ok"])
        self.assertEqual(h["warn"], ["chat"])
        self.assertEqual(self.gw.seen, [])

    def test_key_from_systemd_credential_nginx_conf(self):
        # install-diag.sh nạp tệp conf.d của nginx (nơi install.sh giữ key) qua LoadCredential; healthz tự tách key
        cred = self.path("cred")
        os.makedirs(cred)
        with open(os.path.join(cred, "model-key"), "w", encoding="utf-8") as f:
            f.write('map $http_x_ollama_seckey $neu_agent_key {\n    default $http_x_ollama_seckey;\n    ""      "%s";\n}\n' % KEY)
        H = self.load(key=None)
        os.environ["CREDENTIALS_DIRECTORY"] = cred
        self.assertEqual(H.main(), 0)
        self.assertEqual(self.gw.seen[0]["key"], KEY)
        for bad in ("", "co dau cach", "a\"b", "x" * 300):
            self.assertIsNone(H.parse_key(bad), repr(bad))


TODAY = datetime.date(2026, 10, 15)
NOW = time.mktime(TODAY.timetuple()) + 12 * 3600


class EntraSecret(Base):
    def check(self, content):
        H = self.load()
        if content is not None:
            os.environ["NEU_HEALTH_ENTRA_EXPIRES"] = self.write("entra", content)
            H = importlib.reload(H)
        return H.entra_check(NOW)

    def test_days_left(self):
        self.assertIsNone(self.check(None), "chưa khai thì bỏ qua")
        c = self.check("2027-03-01\n")
        self.assertEqual((c["ok"], c.get("warn"), c["days"]), (True, False, 137))
        c = self.check("# hạn secret Entra\n2026-11-05\n")
        self.assertEqual((c["ok"], c["warn"], c["days"]), (True, True, 21))
        c = self.check("2026-10-15")
        self.assertEqual((c["ok"], c["warn"], c["days"]), (True, True, 0))
        c = self.check("2026-10-14")
        self.assertEqual((c["ok"], c["days"]), (False, -1))
        for bad in ("15/10/2026", "2026-13-01", "ngày mai", ""):
            c = self.check(bad)
            self.assertEqual((c["ok"], c["warn"]), (True, True), repr(bad))
            self.assertIn("YYYY-MM-DD", c["detail"])

    def test_warning_keeps_healthz_green_expired_turns_red(self):
        H = self.load(NEU_HEALTH_ENTRA_EXPIRES=self.write("entra", (datetime.date.today() + datetime.timedelta(days=10)).isoformat()))
        self.assertEqual(H.main(), 0)
        h = self.health(H)
        self.assertTrue(h["ok"])
        self.assertEqual(h["warn"], ["entra_secret"])
        self.write("entra", (datetime.date.today() - datetime.timedelta(days=2)).isoformat())
        self.assertEqual(H.main(), 1)
        h = self.health(H)
        self.assertFalse(h["checks"]["entra_secret"]["ok"])

    def test_from_systemd_credential(self):
        cred = self.path("cred")
        os.makedirs(cred)
        with open(os.path.join(cred, "entra-secret-expires"), "w", encoding="utf-8") as f:
            f.write("2026-11-01\n")
        H = self.load()
        os.environ["CREDENTIALS_DIRECTORY"] = cred
        self.assertEqual(H.entra_check(NOW)["days"], 17)


class TlsCert(Base):
    def test_targets_parsing(self):
        H = self.load()
        self.assertEqual(H.parse_targets("ai.example.vn@192.0.2.22:443, b.example.vn@192.0.2.23, c.example.vn"),
                         [("ai.example.vn", "192.0.2.22", 443), ("b.example.vn", "192.0.2.23", 443), ("c.example.vn", "c.example.vn", 443)])
        for bad in ("ai example", "ai.example.vn@x y", "a.vn@192.0.2.4:99999", "-a.vn"):
            self.assertEqual(H.parse_targets(bad), [], repr(bad))

    def test_days_and_levels(self):
        H = self.load()
        def at(days):
            return lambda host, ip, port: time.strftime("%b %d %H:%M:%S %Y GMT", time.gmtime(NOW + days * 86400))
        c = H.tls_check([("a.vn", "192.0.2.22", 443)], NOW, fetch=at(80))
        self.assertEqual((c["ok"], c["warn"], c["days"]), (True, False, 80))
        c = H.tls_check([("a.vn", "192.0.2.22", 443), ("b.vn", "192.0.2.22", 443)], NOW, fetch=lambda h, i, p: at(80)(h, i, p) if h == "a.vn" else at(12)(h, i, p))
        self.assertEqual((c["ok"], c["warn"], c["days"]), (True, True, 12), "lấy tên miền sắp hết hạn nhất")
        self.assertNotIn("b.vn", json.dumps(c), "không ghi tên miền/IP vào kết quả")

        def expired(host, ip, port):
            e = ssl.SSLCertVerificationError("certificate has expired")
            e.verify_code = 10
            raise e
        c = H.tls_check([("a.vn", "192.0.2.22", 443)], NOW, fetch=expired)
        self.assertEqual((c["ok"], c["days"]), (False, -1))

        def untrusted(host, ip, port):
            e = ssl.SSLCertVerificationError("self signed")
            e.verify_code = 18
            raise e
        def refused(host, ip, port):
            raise ConnectionRefusedError()
        for f in (untrusted, refused):
            c = H.tls_check([("a.vn", "192.0.2.22", 443)], NOW, fetch=f)
            self.assertEqual((c["ok"], c["warn"]), (True, True), "không kiểm được thì cảnh báo, không làm healthz đỏ")
        self.assertIsNone(H.tls_check([], NOW), "chưa cấu hình thì bỏ qua")

    def test_in_run_from_env(self):
        H = self.load(NEU_HEALTH_TLS_HOSTS="a.vn@127.0.0.1:1")  # cổng 1: không kết nối được
        self.assertEqual(H.main(), 0)
        h = self.health(H)
        self.assertIn("tls", h["checks"])
        self.assertEqual(h["warn"], ["tls"])

    @unittest.skipUnless(shutil.which("openssl"), "cần openssl để tạo chứng chỉ thử")
    def test_real_handshake_reads_not_after(self):
        H = self.load()
        crt, key = self.path("c.pem"), self.path("k.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "40", "-subj", "/CN=a.example.vn",
                        "-addext", "subjectAltName=DNS:a.example.vn"], check=True, capture_output=True)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)

        class H2(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass
        s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H2)
        s.socket = ctx.wrap_socket(s.socket, server_side=True)
        s.handle_error = lambda *a: None  # máy khách từ chối chứng chỉ tự ký thì ngắt: không in vết lỗi
        threading.Thread(target=s.serve_forever, daemon=True).start()
        self.servers.append(s)
        port = s.server_address[1]
        c = H.tls_check([("a.example.vn", "127.0.0.1", port)], time.time(), fetch=lambda h, i, p: H.fetch_not_after(h, i, p, cafile=crt))
        self.assertEqual((c["ok"], c["warn"]), (True, False))
        self.assertIn(c["days"], (39, 40))
        c = H.tls_check([("a.example.vn", "127.0.0.1", port)], time.time())  # chứng chỉ tự ký: không xác minh được → cảnh báo
        self.assertEqual((c["ok"], c["warn"]), (True, True))


if __name__ == "__main__":
    unittest.main()
