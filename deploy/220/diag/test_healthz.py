"""Kiểm thử healthz.py bằng máy chủ giả cục bộ."""
import http.server
import importlib
import json
import os
import tempfile
import threading
import time
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


class Base(unittest.TestCase):
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

    def load(self, oauth, gw, coll, quota=None, **env):
        quota = quota or serve(200, b'{"ok":true}')
        self.servers += [oauth, gw, coll, quota]
        e = {"NEU_HEALTH_OAUTH2": "http://127.0.0.1:%d/ping" % oauth.server_address[1], "NEU_HEALTH_GATEWAY": "http://127.0.0.1:%d/" % gw.server_address[1],
             "NEU_HEALTH_COLLECTOR": "http://127.0.0.1:%d/healthz" % coll.server_address[1], "NEU_HEALTH_QUOTA": "http://127.0.0.1:%d/healthz" % quota.server_address[1], "NEU_HEALTH_FILE": os.path.join(self.tmp.name, "h", "health.json"),
             "NEU_HEALTH_LOG": os.path.join(self.tmp.name, "log", "health.log"), "NEU_HEALTH_DISK_PATHS": self.tmp.name, "NEU_HEALTH_TIMEOUT": "1",
             "NEU_HEALTH_BACKUP_STATUS": os.path.join(self.tmp.name, "bk", "status.json")}
        e.update(env)
        for k, v in e.items():
            os.environ[k] = v
        import healthz

        return importlib.reload(healthz)


class HealthzTests(Base):
    def test_all_ok(self):
        H = self.load(serve(200, b"OK"), serve(401), serve(200, b'{"ok":true}'))  # cổng trả 401 vẫn là "đang sống"
        self.assertEqual(H.main(), 0)
        h = json.loads(read(H.HEALTH_FILE))
        self.assertTrue(h["ok"])
        self.assertEqual(set(h["checks"]), {"oauth2", "gateway", "collector", "quota", "disk"})
        self.assertFalse(os.path.exists(H.LOG_FILE))
        self.assertEqual(oct(os.stat(H.HEALTH_FILE).st_mode & 0o777), oct(0o640))

    def test_quota_gateway_down_is_reported(self):
        H = self.load(serve(200, b"OK"), serve(401), serve(200, b'{"ok":true}'), quota=serve(503, b'{"ok":false}'))
        self.assertEqual(H.main(), 1)
        self.assertEqual([k for k, v in json.loads(read(H.HEALTH_FILE))["checks"].items() if not v["ok"]], ["quota"])

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


class BackupTests(Base):
    """Kết quả sao lưu dữ liệu (tệp chỉ có số do backup.py ghi): báo ở health.json + nhật ký, KHÔNG làm /agent/healthz đỏ."""

    def ok_services(self, status=None):
        H = self.load(serve(200, b"OK"), serve(401), serve(200, b'{"ok":true}'))
        if status is not None:
            os.makedirs(os.path.dirname(os.environ["NEU_HEALTH_BACKUP_STATUS"]), exist_ok=True)
            with open(os.environ["NEU_HEALTH_BACKUP_STATUS"], "w") as f:
                f.write(status if isinstance(status, str) else json.dumps(status))
        return H

    def status(self, hours_ago=5, ok=True, pushed=None, last_ok_hours_ago=None):
        t = int(time.time() - hours_ago * 3600)
        lo = t if ok else None
        if last_ok_hours_ago is not None:
            lo = int(time.time() - last_ok_hours_ago * 3600)
        return {"time": t, "ok": ok, "pushed": pushed, "size": 12345, "files": 10, "last_ok": lo}

    def health(self, H, _status):
        rc = H.main()
        return rc, json.loads(read(H.HEALTH_FILE))

    def test_not_installed_is_skipped(self):
        rc, h = self.health(self.ok_services(), None)
        self.assertEqual(rc, 0)
        self.assertNotIn("backup", h["checks"])

    def test_recent_ok(self):
        rc, h = self.health(self.ok_services(self.status(hours_ago=5)), None)
        self.assertEqual(rc, 0)
        self.assertTrue(h["checks"]["backup"]["ok"])
        self.assertEqual(h["warn"], [])
        self.assertFalse(os.path.exists(os.environ["NEU_HEALTH_LOG"]))

    def expect_warn(self, status, reason):
        H = self.ok_services(status)
        rc, h = self.health(H, status)
        self.assertEqual(rc, 0, "sao lưu lỗi không làm healthz thất bại")
        self.assertTrue(h["ok"], "/agent/healthz vẫn xanh: dịch vụ vẫn chạy")
        b = h["checks"]["backup"]
        self.assertFalse(b["ok"])
        self.assertEqual(b["reason"], reason)
        self.assertEqual(h["warn"], ["backup"])
        self.assertIn("WARN backup(", read(H.LOG_FILE))
        return b

    def test_last_run_failed(self):
        b = self.expect_warn(self.status(hours_ago=2, ok=False, last_ok_hours_ago=26), "failed")
        self.assertEqual(round(b["age_h"]), 26)

    def test_failed_never_ok(self):
        b = self.expect_warn(self.status(hours_ago=2, ok=False), "failed")
        self.assertIsNone(b["age_h"])

    def test_stale_over_36h(self):
        b = self.expect_warn(self.status(hours_ago=37), "stale")
        self.assertEqual(round(b["age_h"]), 37)

    def test_push_failed(self):
        self.expect_warn(self.status(hours_ago=3, pushed=False), "push_failed")

    def test_pushed_ok(self):
        rc, h = self.health(self.ok_services(self.status(hours_ago=3, pushed=True)), None)
        self.assertTrue(h["checks"]["backup"]["ok"])

    def test_unreadable(self):
        self.expect_warn("{hong", "unreadable")

    def test_not_a_dict(self):
        self.expect_warn('["khong-phai-dict"]', "unreadable")

    def test_service_failure_still_fails_with_backup_warning(self):
        H = self.load(serve(503), serve(401), serve(200, b'{"ok":true}'))
        os.makedirs(os.path.dirname(os.environ["NEU_HEALTH_BACKUP_STATUS"]))
        with open(os.environ["NEU_HEALTH_BACKUP_STATUS"], "w") as f:
            json.dump(self.status(hours_ago=40), f)
        self.assertEqual(H.main(), 1)
        h = json.loads(read(H.HEALTH_FILE))
        self.assertFalse(h["ok"])
        self.assertIn("FAIL", read(H.LOG_FILE))


if __name__ == "__main__":
    unittest.main()
