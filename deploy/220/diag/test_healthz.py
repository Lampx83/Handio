"""Kiểm thử healthz.py bằng máy chủ giả cục bộ."""
import http.server
import importlib
import json
import os
import tempfile
import threading
import unittest


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def serve(status, body=b"{}"):
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


class HealthzTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.servers = []

    def tearDown(self):
        for k in [k for k in os.environ if k.startswith("NEU_HEALTH_")]:
            del os.environ[k]
        for s in self.servers:
            s.shutdown()
            s.server_close()
        self.tmp.cleanup()

    def load(self, oauth, gw, coll, **env):
        self.servers += [oauth, gw, coll]
        e = {"NEU_HEALTH_OAUTH2": "http://127.0.0.1:%d/ping" % oauth.server_address[1], "NEU_HEALTH_GATEWAY": "http://127.0.0.1:%d/" % gw.server_address[1],
             "NEU_HEALTH_COLLECTOR": "http://127.0.0.1:%d/healthz" % coll.server_address[1], "NEU_HEALTH_FILE": os.path.join(self.tmp.name, "h", "health.json"),
             "NEU_HEALTH_LOG": os.path.join(self.tmp.name, "log", "health.log"), "NEU_HEALTH_DISK_PATHS": self.tmp.name, "NEU_HEALTH_TIMEOUT": "1"}
        e.update(env)
        for k, v in e.items():
            os.environ[k] = v
        import healthz

        return importlib.reload(healthz)

    def test_all_ok(self):
        H = self.load(serve(200, b"OK"), serve(401), serve(200, b'{"ok":true}'))  # cổng trả 401 vẫn là "đang sống"
        self.assertEqual(H.main(), 0)
        h = json.loads(read(H.HEALTH_FILE))
        self.assertTrue(h["ok"])
        self.assertEqual(set(h["checks"]), {"oauth2", "gateway", "collector", "disk"})
        self.assertFalse(os.path.exists(H.LOG_FILE))
        self.assertEqual(oct(os.stat(H.HEALTH_FILE).st_mode & 0o777), oct(0o640))

    def test_failures_logged_and_exit_1(self):
        dead = serve(200)
        dead.shutdown()
        dead.server_close()  # cổng đóng
        H = self.load(serve(503), dead, serve(200, b'{"ok":false}'))
        self.assertEqual(H.main(), 1)
        h = json.loads(read(H.HEALTH_FILE))
        self.assertFalse(h["ok"])
        self.assertEqual([k for k, v in h["checks"].items() if not v["ok"]], ["oauth2", "gateway", "collector"])
        line = read(H.LOG_FILE)
        self.assertIn("FAIL", line)
        self.assertIn("gateway", line)
        H.main()
        self.assertEqual(len(read(H.LOG_FILE).splitlines()), 2)  # mỗi lần lỗi thêm một dòng

    def test_disk_low(self):
        H = self.load(serve(200), serve(200), serve(200, b'{"ok":true}'), NEU_HEALTH_MIN_FREE_GB="999999")
        self.assertEqual(H.main(), 1)
        self.assertFalse(json.loads(read(H.HEALTH_FILE))["checks"]["disk"]["ok"])


if __name__ == "__main__":
    unittest.main()
