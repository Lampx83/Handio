"""Kiểm thử cổng hạn mức token:  python3 -m unittest discover -s deploy/220/quota -p 'test_*.py'  (không cần pytest)."""
import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "diag"))
import collector as COLL  # noqa: E402  (so khớp cách tạo mã giả danh với bộ thu chẩn đoán)
import quota as Q  # noqa: E402

SECRET = b"unit-test-secret-0123456789abcdef"
T0 = 1_800_000_000          # một thời điểm cố định
SV, GV = "sv.nguyen@st.neu.edu.vn", "gv.tran@neu.edu.vn"


def sse(prompt=10, completion=5, with_usage=True, text="xin chào"):
    ev = [{"choices": [{"delta": {"content": text}}]}, {"choices": [{"delta": {"content": " bạn"}}]}]
    if with_usage:
        ev.append({"choices": [], "usage": {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}})
    return b"".join(b"data: " + json.dumps(e, ensure_ascii=False).encode() + b"\n\n" for e in ev) + b"data: [DONE]\n\n"


class FakeUpstream:
    """Giả vLLM/Kong: ghi lại thân yêu cầu; trả SSE hoặc JSON có usage."""

    def __init__(self):
        self.requests, self.delay, self.status, self.stream_body = [], 0.0, 200, sse()
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers["Content-Length"])
                body = json.loads(self.rfile.read(n))
                outer.requests.append({"body": body, "headers": dict(self.headers)})
                time.sleep(outer.delay)
                if outer.status != 200:
                    out = b'{"error":"x"}'
                    self.send_response(outer.status)
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    return self.wfile.write(out)
                if body.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    self.wfile.write(outer.stream_body)
                else:
                    out = json.dumps({"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    self.wfile.write(out)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.srv.daemon_threads = True
        self.port = self.srv.server_address[1]
        threading.Thread(target=lambda: self.srv.serve_forever(poll_interval=0.02), daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class GatewayCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = self.tmp.name
        self.cfg_path, self.admins_path, self.db_path = os.path.join(d, "quota.json"), os.path.join(d, "admins.txt"), os.path.join(d, "q", "usage.db")
        self.write_cfg({})
        with open(self.admins_path, "w") as f:
            f.write("# quản trị\nadmin@neu.edu.vn\n")
        self.up = FakeUpstream()
        self.addCleanup(self.up.close)
        self.now = [T0]
        self.store = Q.Store(self.db_path)
        self.addCleanup(self.store.close)
        self.ctx = Q.Config(SECRET, self.store, self.cfg_path, self.admins_path, ("127.0.0.1", self.up.port), now=lambda: self.now[0])
        self.srv = Q.make_server(self.ctx, "127.0.0.1", 0)
        self.port = self.srv.server_address[1]
        threading.Thread(target=lambda: self.srv.serve_forever(poll_interval=0.02), daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def write_cfg(self, over):
        with open(self.cfg_path, "w") as f:
            json.dump(over, f)
        self._mt = getattr(self, "_mt", 1_700_000_000) + 10   # mtime tăng dần để cổng nạp lại cấu hình
        os.utime(self.cfg_path, (self._mt, self._mt))

    def post(self, ident=SV, body=None, headers=None, path=Q.CHAT_PATH):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Content-Type": "application/json"}
        if ident is not None:
            h["X-User-Email"] = ident
        h.update(headers or {})
        data = json.dumps(body if body is not None else {"model": "m", "messages": [{"role": "user", "content": "chào"}], "stream": True})
        c.request("POST", path, body=data, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        return r.status, out, {k.lower(): v for k, v in r.getheaders()}

    def get(self, path, ident=SV, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"X-User-Email": ident} if ident else {}
        h.update(headers or {})
        c.request("GET", path, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        return r.status, out, {k.lower(): v for k, v in r.getheaders()}

    def row(self, sql):
        with self.store.lock:
            return self.store.db.execute(sql).fetchone()

    def uid(self, ident):
        return COLL.pseudonym(SECRET, ident)

    def used(self, ident):
        return self.store.used(Q.vn_day(self.now[0]), self.uid(ident))


class PureTests(unittest.TestCase):
    def test_tiers_and_limits(self):
        cfg = Q.load_config("/không/có")
        self.assertEqual(Q.limit_for(cfg, SV, set()), (1_000_000, "student"))
        self.assertEqual(Q.limit_for(cfg, GV, set()), (10_000_000, "staff"))
        self.assertEqual(Q.limit_for(cfg, "khach01", set()), (1_000_000, "student"))        # tài khoản tên + mật khẩu
        self.assertEqual(Q.limit_for(cfg, "x@lop.st.neu.edu.vn", set())[1], "student")       # tên miền con
        self.assertEqual(Q.limit_for(cfg, "x@gmail.com", set())[1], "student")
        self.assertEqual(Q.limit_for(cfg, "admin@neu.edu.vn", {"admin@neu.edu.vn"}), (None, "admin"))
        cfg["overrides"] = {SV: 5_000_000, GV: "unlimited"}
        self.assertEqual(Q.limit_for(cfg, SV, set())[0], 5_000_000)
        self.assertIsNone(Q.limit_for(cfg, GV, set())[0])

    def test_assess_thresholds_and_grace(self):
        cfg = Q.load_config("/không/có")
        L = 1_000_000
        self.assertEqual([Q.assess(cfg, L, u) for u in (0, 799_999, 800_000, 999_999, 1_000_000, 1_099_999, 1_100_000, 5_000_000)],
                         ["ok", "ok", "warn", "warn", "grace", "grace", "exceeded", "exceeded"])
        self.assertEqual(Q.assess(cfg, None, 10 ** 12), "unlimited")

    def test_config_validation_ignores_garbage(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "q.json")
        with open(p, "w") as f:
            json.dump({"mode": "tùy tiện", "tiers": {"student": "nhiều", "staff": 7}, "grace_pct": -3, "overrides": {"a@b.vn": "vô hạn", "c@d.vn": 9}}, f)
        cfg = Q.load_config(p)
        self.assertEqual(cfg["mode"], "enforce")
        self.assertEqual(cfg["tiers"], {"staff": 7})
        self.assertEqual(cfg["grace_pct"], 10)
        self.assertEqual(cfg["overrides"], {"c@d.vn": 9})
        with open(p, "w") as f:
            f.write("{hỏng")
        self.assertEqual(Q.load_config(p)["tiers"]["student"], 1_000_000)  # hỏng → mặc định an toàn

    def test_day_and_reset_in_vietnam_time(self):
        ts = 1_800_000_000  # 2027-01-15 08:00 UTC = 15:00 giờ VN
        self.assertEqual(Q.vn_day(ts), "2027-01-15")
        self.assertEqual(Q.vn_day(ts + 9 * 3600), "2027-01-16")   # 17:00 UTC = 00:00 VN ngày sau
        self.assertEqual(Q.next_reset(ts), ts + 9 * 3600)

    def test_sniffer_split_chunks_and_junk(self):
        s = Q.UsageSniffer()
        data = sse(123, 45)
        for i in range(0, len(data), 7):
            s.feed(data[i:i + 7])
        self.assertEqual(Q.tokens_of(s.usage), (123, 45))
        self.assertGreater(s.out_chars, 0)
        s2 = Q.UsageSniffer()
        s2.feed(b"data: {khong json\n\nrac\n\ndata: [DONE]\n\n")
        self.assertIsNone(s2.usage)
        self.assertEqual(Q.tokens_of({"total_tokens": 9}), (9, 0))
        self.assertIsNone(Q.tokens_of({"prompt_tokens": "x"}))

    def test_pseudonym_matches_diagnostics_collector(self):
        self.assertEqual(Q.pseudonym(SECRET, "A@B.vn"), COLL.pseudonym(SECRET, "a@b.vn"))


class FlowTests(GatewayCase):
    def test_stream_passthrough_counts_tokens_and_injects_include_usage(self):
        st, out, h = self.post(body={"model": "m", "messages": [], "stream": True, "stream_options": {"x": 1}})
        self.assertEqual(st, 200)
        self.assertEqual(out, sse())                                                     # luồng đi qua nguyên vẹn
        sent = self.up.requests[0]["body"]
        self.assertEqual(sent["stream_options"], {"x": 1, "include_usage": True})          # cổng tự bật usage
        self.assertEqual(self.used(SV), 15)
        self.assertEqual((h["x-quota-state"], h["x-quota-limit"], h["x-quota-tier"]), ("ok", "1000000", "student"))
        self.post()
        self.assertEqual(self.used(SV), 30)
        row = self.row("select requests,prompt,completion,estimated,lim from usage")
        self.assertEqual(row, (2, 20, 10, 0, 1_000_000))

    def test_non_stream_response_counted(self):
        st, out, _ = self.post(body={"model": "m", "messages": [], "stream": False})
        self.assertEqual(st, 200)
        self.assertEqual(self.used(SV), 120)

    def test_headers_to_upstream_keep_key_and_identity_but_not_cookie(self):
        self.post(headers={"x-ollama-seckey": "khoa-may-chu", "Cookie": "sess=bi-mat", "Authorization": "Bearer abc"})
        h = {k.lower(): v for k, v in self.up.requests[0]["headers"].items()}
        self.assertEqual(h["x-ollama-seckey"], "khoa-may-chu")
        self.assertEqual(h["x-user-email"], SV)
        self.assertNotIn("cookie", h)
        self.assertNotIn("authorization", h)

    def test_grace_then_block_with_friendly_message(self):
        uid = self.uid(SV)
        self.store.add(Q.vn_day(T0), uid, "student", 1_000_000, 990_000, 5_000)       # 995.000
        st, _, h = self.post()
        self.assertEqual((st, h["x-quota-state"]), (200, "warn"))                         # còn ~5k: vẫn chạy; xong thành 995.015 → còn 'warn'
        self.store.add(Q.vn_day(T0), uid, "student", 1_000_000, 10_000, 0)              # ≥ 1.005.015 → vùng vượt thêm
        st, _, h = self.post()
        self.assertEqual((st, h["x-quota-state"]), (200, "grace"))                        # được hoàn tất việc đang làm
        self.store.add(Q.vn_day(T0), uid, "student", 1_000_000, 100_000, 0)             # ≥ 1.100.000 → chặn
        before = len(self.up.requests)
        st, out, h = self.post()
        self.assertEqual(st, 402)
        j = json.loads(out)
        self.assertEqual((j["error"], j["limit"], j["tier"]), ("quota_exceeded", 1_000_000, "student"))
        self.assertIn("1.000.000", j["message"])
        self.assertIn("00:00 ngày mai", j["message"])
        self.assertEqual(j["reset_at"], Q.next_reset(T0))
        self.assertEqual(len(self.up.requests), before)                                    # KHÔNG chuyển tiếp lên mô hình
        self.assertEqual(h["x-quota-state"], "exceeded")
        self.assertEqual(self.row("select blocked from usage")[0], 1)

    def test_staff_gets_ten_times_students(self):
        self.store.add(Q.vn_day(T0), self.uid(GV), "staff", 10_000_000, 5_000_000, 0)
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 5_000_000, 0)
        self.assertEqual(self.post(ident=GV)[0], 200)
        self.assertEqual(self.post(ident=SV)[0], 402)

    def test_quota_resets_next_vietnam_day(self):
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 2_000_000, 0)
        self.assertEqual(self.post()[0], 402)
        self.now[0] = Q.next_reset(T0) + 5                                                 # qua 00:00 giờ Việt Nam
        self.assertEqual(self.post()[0], 200)
        self.assertEqual(self.used(SV), 15)

    def test_observe_mode_counts_but_never_blocks(self):
        self.write_cfg({"mode": "observe"})
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 9_000_000, 0)
        self.assertEqual(self.post()[0], 200)
        self.assertEqual(self.used(SV), 9_000_015)

    def test_admin_and_own_key_unlimited_and_own_key_not_counted(self):
        self.store.add(Q.vn_day(T0), self.uid("admin@neu.edu.vn"), "admin", -1, 99_000_000, 0)
        self.assertEqual(self.post(ident="admin@neu.edu.vn")[0], 200)
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 5_000_000, 0)
        used = self.used(SV)
        self.assertEqual(self.post(headers={"X-Neu-Own-Key": "1"})[0], 200)                # tự dán key riêng
        self.assertEqual(self.used(SV), used)

    def test_override_applies(self):
        self.write_cfg({"overrides": {SV: 50}})
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 50, 60, 0)
        self.assertEqual(self.post()[0], 402)
        self.write_cfg({"overrides": {SV: "unlimited"}})
        self.assertEqual(self.post()[0], 200)

    def test_missing_usage_is_estimated_and_marked(self):
        self.up.stream_body = sse(with_usage=False, text="x" * 300)
        self.assertEqual(self.post()[0], 200)
        row = self.row("select tokens,estimated from usage")
        self.assertGreater(row[0], 0)
        self.assertEqual(row[1], 1)

    def test_upstream_error_is_passed_through_and_not_counted(self):
        self.up.status = 429
        st, _, _ = self.post()
        self.assertEqual(st, 429)
        self.assertEqual(self.used(SV), 0)

    def test_upstream_down_gives_502_not_counted(self):
        self.up.close()
        st, out, _ = self.post()
        self.assertEqual(st, 502)
        self.assertEqual(json.loads(out)["error"], "upstream")
        self.assertEqual(self.used(SV), 0)

    def test_concurrency_limit_per_user(self):
        self.write_cfg({"max_concurrent": 1})
        self.up.delay = 0.6
        res = []
        t = threading.Thread(target=lambda: res.append(self.post()[0]))
        t.start()
        time.sleep(0.2)
        st, out, h = self.post()
        t.join()
        self.assertEqual(st, 429)
        self.assertEqual(json.loads(out)["error"], "busy")
        self.assertEqual(res, [200])
        self.up.delay = 0
        self.assertEqual(self.post()[0], 200)                                              # xong rồi thì lại gửi được
        self.assertEqual(self.post(ident=GV)[0], 200)                                      # người khác không bị ảnh hưởng

    def test_bad_requests(self):
        self.assertEqual(self.post(ident=None)[0], 401)
        self.assertEqual(self.post(ident="khong phai email")[0], 401)
        self.assertEqual(self.post(path="/vllm/v1/models")[0], 404)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("POST", Q.CHAT_PATH, body=b"{hong", headers={"X-User-Email": SV})
        self.assertEqual(c.getresponse().status, 400)

    def test_quota_endpoint_and_health(self):
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 850_000, 0)
        st, out, h = self.get("/quota")
        j = json.loads(out)
        self.assertEqual(st, 200)
        self.assertEqual((j["state"], j["limit"], j["used"], j["remaining"], j["tier"]), ("warn", 1_000_000, 850_000, 150_000, "student"))
        self.assertEqual(j["pct"], 85.0)
        self.assertNotIn("uid", j)
        self.assertEqual(h["x-quota-state"], "warn")
        self.assertEqual(json.loads(self.get("/quota", headers={"X-Neu-Own-Key": "1"})[1])["unlimited"], True)
        self.assertEqual(self.get("/quota", ident=None)[0], 401)
        self.assertEqual(json.loads(self.get("/healthz", ident=None)[1]), {"ok": True, "mode": "enforce"})

    def test_privacy_no_email_or_content_in_database(self):
        self.post(body={"model": "m", "messages": [{"role": "user", "content": "BÍ-MẬT-NỘI-DUNG-123"}], "stream": True})
        raw = b"".join(open(os.path.join(os.path.dirname(self.db_path), f), "rb").read() for f in os.listdir(os.path.dirname(self.db_path)))
        self.assertNotIn(SV.encode(), raw)
        self.assertNotIn("BÍ-MẬT-NỘI-DUNG".encode(), raw)
        self.assertNotIn(b"st.neu.edu.vn", raw)

    def test_non_local_peer_is_refused(self):
        class Fake:
            client_address = ("10.1.2.3", 5)
        h = Q.Handler.__new__(Q.Handler)
        h.client_address = ("10.1.2.3", 5)
        self.assertFalse(Q.Handler._local(h))


if __name__ == "__main__":
    unittest.main()
