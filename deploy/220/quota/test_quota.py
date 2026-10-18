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
        self.models_body = json.dumps({"object": "list", "data": [{"id": "m", "object": "model"}, {"id": "qwen-lon", "object": "model"}, {"id": "M", "object": "model"}]}).encode()
        self.model_gets = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.model_gets.append({"path": self.path, "headers": dict(self.headers)})
                out = outer.models_body if outer.status == 200 else b'{"error":"x"}'
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

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
        self.write_cfg({"tiers": {"student": 1_000_000, "staff": 10_000_000}})   # cố định thang 1 triệu để các bài thử cơ chế không phụ thuộc mặc định
        with open(self.admins_path, "w") as f:
            f.write("# quản trị\nadmin@neu.edu.vn\n")
        self.up = FakeUpstream()
        self.addCleanup(self.up.close)
        self.now = [T0]
        self.store = Q.Store(self.db_path)
        self.addCleanup(self.store.close)
        self.grants_path = os.path.join(d, "grants.json")
        self.ctx = Q.Config(SECRET, self.store, self.cfg_path, self.admins_path, ("127.0.0.1", self.up.port), now=lambda: self.now[0], grants_path=self.grants_path)
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


class CaptureTests(GatewayCase):
    """Ghi NỘI DUNG hội thoại: chỉ đúng tài khoản được liệt kê, mặc định tắt, không làm hỏng yêu cầu."""

    def setUp(self):
        super().setUp()
        self.cap_path = os.path.join(self.tmp.name, "q", "captures.db")
        self.ctx.capture = Q.CaptureStore(self.cap_path)
        self.addCleanup(self.ctx.capture.close)

    def rows(self):
        if not os.path.exists(self.cap_path):
            return []
        db = sqlite3.connect(self.cap_path)
        db.row_factory = sqlite3.Row
        out = [dict(r) for r in db.execute("select * from captures order by id")]
        db.close()
        return out

    BODY = {"model": "m", "stream": True, "messages": [
        {"role": "system", "content": "Bạn là trợ lý"}, {"role": "user", "content": "câu hỏi 1"},
        {"role": "assistant", "content": "trả lời 1"}, {"role": "user", "content": "câu hỏi 2"}]}

    def test_off_by_default_writes_nothing(self):
        self.assertEqual(self.post(ident="test01", body=self.BODY)[0], 200)
        self.assertEqual(self.rows(), [])
        self.assertFalse(os.path.exists(self.cap_path))          # không tạo cả tệp khi tính năng tắt

    def test_only_listed_account_is_captured_with_request_and_reply(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "capture": {"users": ["Test01 ", "bad user!"], "keep_days": 30}})
        self.post(ident="test01", body=self.BODY)
        self.post(ident=SV, body=self.BODY)                       # tài khoản khác: không ghi
        r = self.rows()
        self.assertEqual(len(r), 1)
        self.assertEqual((r[0]["user"], r[0]["model"], r[0]["n_messages"], r[0]["status"]), ("test01", "m", 4, 200))
        self.assertEqual(json.loads(r[0]["new_messages"]), [{"role": "user", "content": "câu hỏi 2"}])   # chỉ phần MỚI của lượt này
        self.assertEqual(r[0]["reply"], "xin chào bạn")
        self.assertEqual((r[0]["prompt_tokens"], r[0]["completion_tokens"]), (10, 5))
        self.assertEqual(len(r[0]["conv"]), 12)

    def test_capture_db_is_group_readable_not_world_and_not_wal(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "capture": {"users": ["test01"]}})
        self.post(ident="test01", body=self.BODY)
        self.assertEqual(os.stat(self.cap_path).st_mode & 0o777, 0o640)   # nhóm đọc được (để người được grant xem), người lạ thì không
        db = sqlite3.connect(self.cap_path)
        self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        db.close()
        self.assertFalse(os.path.exists(self.cap_path + "-wal"))

    def test_warm_opens_db_with_group_permissions_before_any_request(self):
        self.assertFalse(os.path.exists(self.cap_path))
        self.ctx.capture.warm()
        self.assertEqual(os.stat(self.cap_path).st_mode & 0o777, 0o640)

    def test_prefix_pattern_captures_named_accounts_but_never_emails(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "capture": {"users": ["test0*", "ab*", "*", "x*", "tes*t"]}})
        self.assertEqual(Q.load_config(self.cfg_path)["capture"]["users"], ["test0*"])   # mẫu quá ngắn / có * giữa bị bỏ
        for who in ("test02", "test09"):
            self.post(ident=who, body=self.BODY)
        self.post(ident="test0123@st.neu.edu.vn", body=self.BODY)   # email sinh viên giống tiền tố: không ghi
        self.post(ident="khach01", body=self.BODY)
        self.assertEqual([r["user"] for r in self.rows()], ["test02", "test09"])

    def test_tool_calls_and_nonstream_reply_are_captured(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "capture": {"users": ["test01"]}})
        ev = [{"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "read_file", "arguments": "{\"path\""}}]}}]},
              {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": ": \"a.md\"}"}}]}, "finish_reason": "tool_calls"}]},
              {"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}]
        self.up.stream_body = b"".join(b"data: " + json.dumps(e).encode() + b"\n\n" for e in ev) + b"data: [DONE]\n\n"
        self.post(ident="test01", body=self.BODY)
        self.post(ident="test01", body={"model": "m", "messages": [{"role": "user", "content": "x"}], "stream": False})
        r = self.rows()
        self.assertEqual(json.loads(r[0]["tool_calls"]), [{"name": "read_file", "arguments": "{\"path\": \"a.md\"}"}])
        self.assertEqual(r[0]["finish"], "tool_calls")
        self.assertEqual(r[1]["reply"], "ok")

    def test_capture_failure_never_breaks_the_user_request(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "capture": {"users": ["test01"]}})
        self.ctx.capture = Q.CaptureStore("/proc/khong-ghi-duoc/captures.db")
        st, out, _ = self.post(ident="test01", body=self.BODY)
        self.assertEqual((st, out), (200, sse()))

    def test_retention_prunes_old_rows(self):
        db = Q.CaptureStore(os.path.join(self.tmp.name, "r", "c.db"))
        rec = Q.capture_record(self.BODY, 200, "x", [], "stop", None, 1)
        db.add(T0 - 100 * 86400, "test01", rec, 90)
        db.last_prune = 0
        db.add(T0, "test01", rec, 90)
        n = db.db.execute("select count(*) from captures").fetchone()[0]
        db.close()
        self.assertEqual(n, 1)


class RefreshLimitsTests(unittest.TestCase):
    """Đổi hạn mức bậc/ngoại lệ phải có hiệu lực NGAY trên trang quản trị, không đợi người dùng gửi yêu cầu kế tiếp (trước đây trang hiện hạn mức cũ)."""

    def test_refresh_rewrites_today_limits(self):
        d = tempfile.mkdtemp()
        st = Q.Store(os.path.join(d, "u.db"))
        self.addCleanup(st.close)
        day = Q.vn_day(T0)
        old = Q.vn_day(T0 - 3 * 86400)
        sv, gv = COLL.pseudonym(SECRET, "11256857@st.neu.edu.vn"), COLL.pseudonym(SECRET, "nhungdt@neu.edu.vn")
        st.add(day, "uid-a", "student", 1_000_000, 1_000_000, 109_751)                    # sinh viên, hạn mức cũ 1 triệu
        st.add(day, "uid-b", "student", 3_000_000, 2_000_000, 100_000, extra=2_000_000)   # đã được cấp thêm 2 triệu
        st.add(day, sv, "student", 1_000_000, 10, 10)                                     # có ngoại lệ riêng
        st.add(day, gv, "staff", 10_000_000, 9_973_470, 111_748)
        st.add(day, "uid-admin", "admin", None, 5, 5)                                     # không giới hạn: giữ nguyên
        st.add(old, "uid-a", "student", 1_000_000, 5, 5)                                  # ngày cũ: không đụng
        cfg = {"tiers": {"student": 5_000_000, "staff": 10_000_000}, "overrides": {"nhungdt@neu.edu.vn": 100_000_000, "11256857@st.neu.edu.vn": "unlimited"}}
        n = st.refresh_limits(day, cfg, SECRET)
        lim = lambda day_, uid: st.db.execute("SELECT lim FROM usage WHERE day=? AND uid=?", (day_, uid)).fetchone()[0]
        self.assertEqual(lim(day, "uid-a"), 5_000_000)
        self.assertEqual(lim(day, "uid-b"), 7_000_000)           # 5 triệu + 2 triệu cấp thêm
        self.assertEqual(lim(day, gv), 100_000_000)              # ngoại lệ số
        self.assertEqual(lim(day, sv), -1)                       # ngoại lệ unlimited
        self.assertEqual(lim(day, "uid-admin"), -1)
        self.assertEqual(lim(old, "uid-a"), 1_000_000)
        self.assertGreaterEqual(n, 4)


class TabAccessTests(GatewayCase):
    """Phân quyền theo nhóm (bậc theo miền email): tab nào được dùng. Mặc định không cấu hình = mọi người dùng mọi tab."""

    def tab_post(self, ident, tab=None, **kw):
        return self.post(ident, headers={"X-Neu-Tab": tab} if tab is not None else None, **kw)

    def test_default_has_no_restriction_and_old_clients_without_header_still_work(self):
        for who in (SV, GV, "khach01"):
            self.assertEqual(json.loads(self.get("/quota", ident=who)[1])["tabs"], ["work", "code", "design"])
            self.assertEqual(self.tab_post(who)[0], 200)                  # bản ứng dụng cũ không gửi X-Neu-Tab
            self.assertEqual(self.tab_post(who, "design")[0], 200)
        self.assertEqual(Q.load_config("/không/có")["tabs"], {})

    def test_student_limited_staff_untouched(self):
        self.write_cfg({"tiers": {"student": 1_000_000, "staff": 10_000_000}, "tabs": {"student": ["work"]}})
        self.assertEqual(json.loads(self.get("/quota", ident=SV)[1])["tabs"], ["work"])
        self.assertEqual(json.loads(self.get("/quota", ident=GV)[1])["tabs"], ["work", "code", "design"])
        self.assertEqual(self.tab_post(SV, "work")[0], 200)
        n_ok = len(self.up.requests)
        for tab in ("code", "design"):                                     # bị TỪ CHỐI ở máy chủ, không tới mô hình
            st, out, _ = self.tab_post(SV, tab)
            self.assertEqual(st, 403)
            j = json.loads(out)
            self.assertEqual(j["error"], "tab_not_allowed")
            self.assertIn("không được dùng tab", j["message"])
            self.assertEqual(j["tabs"], ["work"])
        self.assertEqual(len(self.up.requests), n_ok)
        self.assertEqual(self.tab_post(GV, "code")[0], 200)

    def test_restricted_group_must_declare_a_valid_tab(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tabs": {"student": ["code"]}})
        n = len(self.up.requests)
        for bad in (None, "", "CODE ", "khac", "work,code", "code;design", "../code"):
            st, out, _ = self.tab_post(SV, bad)
            if bad == "CODE ":     # chữ hoa/khoảng trắng thừa được chuẩn hoá, vẫn là tab được phép
                self.assertEqual(st, 200)
                n += 1
            else:
                self.assertEqual((st, json.loads(out)["error"]), (403, "tab_required"), bad)
        self.assertEqual(len(self.up.requests), n)

    def test_denied_request_leaves_no_trace_and_costs_no_quota(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tabs": {"student": ["work"]}})
        self.assertEqual(self.tab_post(SV, "design")[0], 403)
        self.assertEqual(self.used(SV), 0)
        self.assertIsNone(self.row("select 1 from usage"))   # không ghi cả dòng chặn: không thêm dữ liệu nào về người dùng

    def test_admin_and_own_key_keep_all_tabs(self):
        self.write_cfg({"tiers": {"staff": 1_000_000}, "tabs": {"staff": []}})
        self.assertEqual(self.tab_post("admin@neu.edu.vn", "design")[0], 200)
        self.assertEqual(self.tab_post(GV, "design")[0], 403)
        self.assertEqual(self.post(GV, headers={"X-Neu-Tab": "design", "X-Neu-Own-Key": "1"})[0], 200)

    def test_empty_list_means_no_tab_and_typos_fail_closed(self):
        self.write_cfg({"tabs": {"student": [], "staff": ["wrok", "Code!"]}})
        cfg = Q.load_config(self.cfg_path)
        self.assertEqual(cfg["tabs"], {"student": [], "staff": []})   # tên lạ bị bỏ, hết sạch = không tab nào (không mở rộng quyền)
        st, out, _ = self.tab_post(SV, "work")
        self.assertEqual(st, 403)
        self.assertIn("không được dùng tab Work", json.loads(out)["message"])

    def test_garbage_tabs_config_is_ignored(self):
        self.write_cfg({"tabs": ["work"]})
        self.assertEqual(Q.load_config(self.cfg_path)["tabs"], {})
        self.write_cfg({"tabs": {"student": "work", "staff": {"work": 1}, "x": ["design", "design", "work"]}})
        self.assertEqual(Q.load_config(self.cfg_path)["tabs"], {"x": ["work", "design"]})

    def test_observe_mode_never_blocks_and_reports_all_tabs(self):
        self.write_cfg({"mode": "observe", "tabs": {"student": ["work"]}})
        self.assertEqual(json.loads(self.get("/quota")[1])["tabs"], ["work", "code", "design"])
        self.assertEqual(self.tab_post(SV, "design")[0], 200)

    def test_tabs_follow_email_domain_and_tab_check_runs_before_quota(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tabs": {"student": ["work", "design"]}})
        self.assertEqual(Q.tier_for(Q.load_config(self.cfg_path), "x@lop.st.neu.edu.vn"), "student")
        self.assertEqual(self.tab_post("x@lop.st.neu.edu.vn", "code")[0], 403)
        self.assertEqual(self.tab_post("x@lop.st.neu.edu.vn", "design")[0], 200)
        self.assertEqual(self.tab_post("khach01", "code")[0], 403)        # tài khoản tên + mật khẩu thuộc bậc mặc định (student)
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 1_200_000, 0)
        self.assertEqual(self.tab_post(SV, "code")[0], 403)               # vừa hết hạn mức vừa sai tab: báo tab
        self.assertEqual(self.tab_post(SV, "work")[0], 402)

    def test_tab_header_is_not_forwarded_and_tabs_not_in_database(self):
        self.write_cfg({"tabs": {"student": ["work"]}})
        self.assertEqual(self.tab_post(SV, "work")[0], 200)
        self.assertNotIn("X-Neu-Tab", self.up.requests[-1]["headers"])
        self.assertNotIn("x-neu-tab", {k.lower() for k in self.up.requests[-1]["headers"]})


import quota_admin as QA  # noqa: E402  (nơi ghi groups.json duy nhất: trang quản trị + quota.sh group)


class GroupTests(GatewayCase):
    """Nhóm tuỳ tạo (groups.json) ghi đè bậc; phân quyền mô hình; hạn mức theo tab; bộ đếm từ chối. Ghi bằng chính mã của trang quản trị (QA)."""

    def setUp(self):
        super().setUp()
        self.groups_path = os.path.join(self.tmp.name, "q", "groups.json")
        self.policy_path = os.path.join(self.tmp.name, "q", "policy.json")
        self.ctx.group_file = Q.Groups(self.groups_path)
        self.ctx.policy_path = self.policy_path

    def op(self, op, name, **kw):
        res = QA.group_op(self.groups_path, T0, "admin@neu.edu.vn", op, name, **kw)
        self.assertTrue(res["ok"], res)
        return res

    def q(self, ident=SV, **kw):
        return json.loads(self.get("/quota", ident=ident, **kw)[1])

    def chat(self, ident=SV, tab="work", model="m", **kw):
        h = {"X-Neu-Tab": tab} if tab is not None else {}
        h.update(kw.pop("headers", {}))
        body = {"messages": [{"role": "user", "content": "chào"}], "stream": True}
        if model is not None:
            body["model"] = model
        return self.post(ident, body=body, headers=h, **kw)

    def denials(self):
        with self.store.lock:
            return dict(self.store.db.execute("select code, n from denials").fetchall())

    def test_no_groups_file_keeps_old_behavior(self):
        j = self.q()
        self.assertEqual((j["limit"], j["group"], j["tabs"], j["models"], j["tab_quota"]), (1_000_000, None, ["work", "code", "design"], None, {}))
        self.assertEqual(self.chat(tab=None, model="bat-ky")[0], 200)          # ứng dụng cũ, mô hình bất kỳ: như trước
        self.assertFalse(os.path.exists(self.groups_path))

    def test_group_overrides_tier_for_limit_tabs_and_models(self):
        self.op("create", "lop-k66-cntt")
        self.op("add", "lop-k66-cntt", idents=[SV.upper(), "khach01"])
        self.op("set", "lop-k66-cntt", field="limit", value=2_000_000)
        self.op("set", "lop-k66-cntt", field="tabs", value=["work"])
        self.op("set", "lop-k66-cntt", field="models", value=["m"])
        j = self.q()
        self.assertEqual((j["limit"], j["group"], j["tabs"], j["models"], j["tier"]), (2_000_000, "lop-k66-cntt", ["work"], ["m"], "student"))
        self.assertEqual(self.q("khach01")["group"], "lop-k66-cntt")
        n = len(self.up.requests)
        st, out, _ = self.chat(tab="code")
        self.assertEqual((st, json.loads(out)["error"]), (403, "tab_not_allowed"))
        st, out, _ = self.chat(model="qwen-khac")
        j = json.loads(out)
        self.assertEqual((st, j["error"], j["models"]), (403, "model_not_allowed", ["m"]))
        self.assertIn("không được dùng mô hình qwen-khac", j["message"])
        for bad in (None, "M", " m", "m\n", ["m"], 5):                       # so khớp đúng nguyên chuỗi; thiếu/sai kiểu = từ chối
            self.assertEqual(self.chat(model=bad)[0], 403, bad)
        self.assertEqual(len(self.up.requests), n)                           # không yêu cầu nào tới mô hình
        self.assertEqual(self.chat()[0], 200)
        self.assertEqual(self.q(GV)["group"], None)                          # người ngoài nhóm: theo bậc
        self.assertEqual(self.chat(GV, tab="code", model="khac")[0], 200)

    def test_group_change_applies_without_restart_and_refreshes_admin_view(self):
        self.op("create", "giang-vien-fit")
        self.op("add", "giang-vien-fit", idents=[SV])
        self.op("set", "giang-vien-fit", field="limit", value="unlimited")
        self.assertEqual(self.chat()[0], 200)
        self.assertEqual(self.row("select lim from usage")[0], -1)
        self.op("set", "giang-vien-fit", field="limit", value=3_000_000)
        self.assertEqual(self.q()["limit"], 3_000_000)
        self.assertEqual(self.row("select lim from usage")[0], 3_000_000)     # CSDL cập nhật ngay khi tệp nhóm đổi (trang quản trị hiện đúng)
        self.op("remove", "giang-vien-fit", idents=[SV])
        self.assertEqual((self.q()["limit"], self.q()["group"]), (1_000_000, None))
        self.op("add", "giang-vien-fit", idents=[SV])
        self.op("delete", "giang-vien-fit")
        self.assertEqual(self.q()["limit"], 1_000_000)

    def test_override_beats_group_and_admin_own_key_are_exempt(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "overrides": {SV: 50}})
        self.op("create", "lop-a")
        self.op("add", "lop-a", idents=[SV, "admin@neu.edu.vn"])
        self.op("set", "lop-a", field="limit", value=9_000_000)
        self.op("set", "lop-a", field="tabs", value=[])
        self.op("set", "lop-a", field="models", value=["m"])
        self.assertEqual(self.q()["limit"], 50)                              # đặt riêng từng người thắng nhóm
        a = self.q("admin@neu.edu.vn")
        self.assertEqual((a["unlimited"], a["tabs"], a["models"], a["group"]), (True, ["work", "code", "design"], None, None))
        self.assertEqual(self.chat("admin@neu.edu.vn", tab="design", model="khac")[0], 200)
        self.assertEqual(self.chat(tab="design", model="khac", headers={"X-Neu-Own-Key": "1"})[0], 200)
        self.assertEqual(self.chat(tab="work")[0], 403)                      # nhóm không được tab nào

    def test_group_can_loosen_tier_and_star_means_any_model(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tabs": {"student": ["work"]}, "models": {"student": ["m"]}})
        self.assertEqual(self.chat(tab="code")[0], 403)
        self.assertEqual(self.chat(model="lon")[0], 403)
        self.op("create", "lop-chuyen")
        self.op("add", "lop-chuyen", idents=[SV])
        self.op("set", "lop-chuyen", field="tabs", value=["work", "code", "design"])
        self.op("set", "lop-chuyen", field="models", value=["*"])
        self.assertEqual(self.chat(tab="code", model="lon")[0], 200)
        self.assertEqual(self.q()["models"], None)
        self.op("set", "lop-chuyen", field="models", value=None)             # trở về theo bậc
        self.assertEqual(self.chat(tab="code", model="lon")[0], 403)

    def test_broken_groups_file_keeps_last_good_and_health_reports_it(self):
        self.op("create", "lop-a")
        self.op("add", "lop-a", idents=[SV])
        self.op("set", "lop-a", field="tabs", value=["work"])
        self.assertEqual(self.chat(tab="code")[0], 403)
        with open(self.groups_path, "w") as f:
            f.write("{hỏng")
        self.assertEqual(self.chat(tab="code")[0], 403)                      # tệp hỏng: vẫn dùng bản đúng gần nhất (không nới quyền)
        self.assertEqual(json.loads(self.get("/healthz", ident=None)[1]).get("groups_error"), True)
        self.assertEqual(QA.group_op(self.groups_path, T0, "a", "add", "lop-a", idents=[GV])["error"], "broken")   # không ghi đè tệp hỏng
        os.remove(self.groups_path)                                           # xoá hẳn = không còn nhóm
        self.assertEqual(self.chat(tab="code")[0], 200)
        self.assertNotIn("groups_error", json.loads(self.get("/healthz", ident=None)[1]))

    def test_symlinked_groups_file_is_not_followed(self):
        target = os.path.join(self.tmp.name, "khac.json")
        with open(target, "w") as f:
            json.dump({"groups": {"lop-a": {"members": [SV], "tabs": []}}}, f)
        os.symlink(target, self.groups_path)
        self.assertEqual(self.chat()[0], 200)                                 # không đọc qua liên kết tượng trưng
        self.assertTrue(self.ctx.group_file.error)
        self.assertEqual(QA.group_op(self.groups_path, T0, "a", "create", "lop-b")["error"], "broken")
        with open(target) as f:
            self.assertNotIn("lop-b", f.read())

    def test_bad_values_fail_closed(self):
        g = Q.parse_groups({"groups": {
            "b-nhom": {"members": [SV, "x y", 5, "KHACH01"], "limit": "nhiều", "tabs": "work", "models": "m", "tab_limits": "x"},
            "a-nhom": {"members": [SV], "limit": None, "tabs": ["wrok"], "models": ["", "bad model"], "tab_limits": {"code": -1, "khac": 5, "work": 10}},
            "Sai Ten": {"members": [GV]}, "c": {"members": [GV]}, "d-nhom": "x"}})
        self.assertEqual(sorted(g["groups"]), ["a-nhom", "b-nhom"])
        self.assertEqual(g["groups"]["b-nhom"], {"limit": 0, "tabs": [], "models": [], "tab_limits": {"work": 0, "code": 0, "design": 0}, "members": ["khach01"]})
        self.assertEqual(g["groups"]["a-nhom"], {"tabs": [], "models": [], "tab_limits": {"code": 0, "work": 10}, "members": [SV]})
        self.assertEqual(g["index"], {SV: "a-nhom", "khach01": "b-nhom"})   # trùng: nhóm tên đứng trước thắng
        for bad in ([], {"groups": []}, "x", {"khac": {}}):
            with self.assertRaises(ValueError):
                Q.parse_groups(bad)

    def test_config_models_and_tab_limits_fail_closed(self):
        self.write_cfg({"models": {"student": "m", "staff": ["m", "bad model", "m"], "x": ["*"], "y": None}, "tab_limits": {"student": [1], "staff": {"code": "x", "design": 5, "zz": 1}}})
        cfg = Q.load_config(self.cfg_path)
        self.assertEqual(cfg["models"], {"student": [], "staff": ["m"], "x": None})
        self.assertEqual(cfg["tab_limits"], {"student": {"work": 0, "code": 0, "design": 0}, "staff": {"code": 0, "design": 5}})
        self.assertEqual(Q.load_config("/không/có")["models"], {})

    def test_tier_models_restrict_and_observe_mode_does_not(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "models": {"student": ["qwen3.5-35b-a3b-int4"]}})
        self.assertEqual(self.chat(model="qwen3.5-35b-a3b-int4")[0], 200)
        st, out, _ = self.chat(model="<script>")
        self.assertEqual(st, 403)
        self.assertIn("(không hợp lệ)", json.loads(out)["message"])          # không vọng lại chuỗi lạ
        self.assertEqual(self.chat(GV, model="khac")[0], 200)
        self.write_cfg({"mode": "observe", "tiers": {"student": 1_000_000}, "models": {"student": []}})
        self.assertEqual(self.chat(model="khac")[0], 200)

    def test_tab_limit_blocks_only_that_tab_and_requires_declared_tab(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tab_limits": {"student": {"code": 100}}})
        for _ in range(8):                                                    # mỗi lượt 15 token → 120 ≥ 100 × 110%
            self.assertEqual(self.chat(tab="code")[0], 200)
        tq = self.q()["tab_quota"]["code"]
        self.assertEqual((tq["limit"], tq["used"], tq["state"]), (100, 120, "exceeded"))
        n = len(self.up.requests)
        st, out, h = self.chat(tab="code")
        j = json.loads(out)
        self.assertEqual((st, j["error"], j["tab"]), (402, "tab_quota_exceeded", "code"))
        self.assertIn("tab Code", j["message"])
        self.assertEqual(h["x-quota-state"], "ok")                            # hạn mức chung vẫn còn
        self.assertEqual(len(self.up.requests), n)
        self.assertEqual(self.chat(tab="work")[0], 200)                       # tab khác vẫn dùng được
        self.assertEqual(json.loads(self.chat(tab=None)[1])["error"], "tab_required")   # có hạn mức theo tab: phải khai tab
        self.assertEqual(self.row("select blocked from usage")[0], 0)         # không tính là "hết hạn mức ngày"
        self.op("create", "lop-a")
        self.op("add", "lop-a", idents=[SV])
        self.op("set", "lop-a", field="tab_limits", value={"code": 1_000})    # nhóm ghi đè hạn mức theo tab của bậc
        self.assertEqual(self.chat(tab="code")[0], 200)
        self.now[0] = Q.next_reset(T0) + 5
        self.assertEqual(self.q()["tab_quota"]["code"]["used"], 0)           # sang ngày mới

    def test_denials_are_counted_by_code_only(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "tabs": {"student": ["work"]}, "models": {"student": ["m"]}})
        self.chat(tab="code")
        self.chat(tab="code")
        self.chat(tab=None)
        self.chat(model="khac")
        self.store.add(Q.vn_day(T0), self.uid(SV), "student", 1_000_000, 2_000_000, 0)
        self.chat()
        self.assertEqual(self.denials(), {"tab_not_allowed": 2, "tab_required": 1, "model_not_allowed": 1, "quota_exceeded": 1})
        with self.store.lock:
            cols = [r[1] for r in self.store.db.execute("PRAGMA table_info(denials)")]
        self.assertEqual(cols, ["day", "code", "n"])                          # không mã người dùng, không nhóm
        self.store.deny(Q.vn_day(T0), "x'; drop table usage;--")              # chỉ mã trong danh sách cố định
        self.assertNotIn("x'; drop table usage;--", self.denials())

    def test_policy_view_has_settings_but_no_emails(self):
        self.write_cfg({"tiers": {"student": 1_000_000}, "models": {"student": ["m"]}, "overrides": {SV: 5}, "capture": {"users": ["test01"]}})
        self.q()
        with open(self.policy_path) as f:
            raw = f.read()
        p = json.loads(raw)
        self.assertEqual((p["models"], p["overrides"], p["capture"]), ({"student": ["m"]}, 1, 1))
        self.assertNotIn(SV, raw)
        self.assertNotIn("test01", raw)
        self.assertEqual(os.stat(self.policy_path).st_mode & 0o777, 0o600)

    def test_group_file_written_by_admin_code_is_private(self):
        self.op("create", "lop-a")
        self.op("add", "lop-a", idents=[SV])
        self.assertEqual(os.stat(self.groups_path).st_mode & 0o777, 0o600)  # chứa email: chỉ người dùng dịch vụ đọc
        with open(self.groups_path) as f:
            self.assertEqual(Q.parse_groups(json.load(f))["index"], {SV: "lop-a"})


class PureTests(unittest.TestCase):
    def test_tiers_and_limits(self):
        cfg = Q.load_config("/không/có")
        self.assertEqual(Q.limit_for(cfg, SV, set()), (5_000_000, "student"))
        self.assertEqual(Q.limit_for(cfg, GV, set()), (10_000_000, "staff"))
        self.assertEqual(Q.limit_for(cfg, "khach01", set()), (5_000_000, "student"))        # tài khoản tên + mật khẩu
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
        self.assertEqual(Q.load_config(p)["tiers"]["student"], 5_000_000)  # hỏng → mặc định an toàn

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

    def test_cached_prompt_tokens_are_recorded(self):
        usage = {"prompt_tokens": 1000, "completion_tokens": 50, "prompt_tokens_details": {"cached_tokens": 800}}
        self.up.stream_body = b"".join(b"data: " + json.dumps(e).encode() + b"\n\n" for e in ({"choices": [{"delta": {"content": "x"}}]}, {"choices": [], "usage": usage})) + b"data: [DONE]\n\n"
        self.assertEqual(self.post()[0], 200)
        self.assertEqual(self.row("select tokens,prompt,cached from usage"), (1050, 1000, 800))
        self.assertEqual(Q.cached_of({"prompt_tokens_details": None}), 0)
        self.assertEqual(Q.cached_of({"prompt_tokens_details": {"cached_tokens": "x"}}), 0)

    def test_old_database_is_upgraded_with_cached_column(self):
        import sqlite3 as sq
        p = os.path.join(self.tmp.name, "old", "u.db")
        os.makedirs(os.path.dirname(p))
        c = sq.connect(p)
        c.execute("CREATE TABLE usage(day TEXT, uid TEXT, tier TEXT NOT NULL DEFAULT '', lim INTEGER NOT NULL DEFAULT -1, tokens INTEGER NOT NULL DEFAULT 0, prompt INTEGER NOT NULL DEFAULT 0, completion INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,uid))")
        c.execute("INSERT INTO usage(day,uid,tokens) VALUES('2026-01-01','x',5)")
        c.commit()
        c.close()
        st = Q.Store(p)
        self.addCleanup(st.close)
        st.add("2026-01-02", "y", "student", 1, 10, 5, cached=7)
        self.assertEqual(st.db.execute("select cached from usage where uid='y'").fetchone()[0], 7)
        self.assertEqual(st.used("2026-01-01", "x"), 5)

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

    def write_grants(self, days):
        with open(self.grants_path, "w") as f:
            json.dump({"days": days, "audit": []}, f)
        self._gm = getattr(self, "_gm", 1_700_000_000) + 10   # mtime tăng dần để cổng nạp lại tệp
        os.utime(self.grants_path, (self._gm, self._gm))

    def test_admin_grant_unblocks_today_and_raises_limit(self):
        uid, day = self.uid(SV), Q.vn_day(T0)
        self.store.add(day, uid, "student", 1_000_000, 1_100_000, 0)                       # đã bị chặn
        self.assertEqual(self.post()[0], 402)
        self.write_grants({day: {uid: 500_000}})                                            # quản trị viên cấp thêm 500k
        st, _, h = self.post()
        self.assertEqual(st, 200)
        self.assertEqual((h["x-quota-limit"], h["x-quota-state"]), ("1500000", "ok"))        # 1,1 triệu / 1,5 triệu
        self.assertEqual(self.row("select lim, extra from usage")[0:2], (1_500_000, 500_000))  # ghi lại để trang quản trị tính lại hạn mức
        self.write_grants({day: {uid: 1_500_000}})                                          # cấp thêm tiếp: cộng dồn do trang quản trị làm, cổng chỉ đọc tổng
        self.assertEqual(self.get("/quota")[0], 200)

    def test_grants_are_per_day_per_person_and_ignore_garbage(self):
        uid, other, day = self.uid(SV), self.uid(GV), Q.vn_day(T0)
        yesterday = Q.vn_day(T0 - 86400)
        self.write_grants({yesterday: {uid: 9_000_000}, day: {other: 9_000_000, "khong-phai-uid": 5, uid + "x": 5}})
        self.assertEqual(self.post()[2]["x-quota-limit"], "1000000")                        # hôm qua / người khác / uid sai: không có tác dụng
        with open(self.grants_path, "w") as f:
            f.write("{hỏng")
        os.utime(self.grants_path, (self._gm + 10, self._gm + 10))
        self.assertEqual(self.post()[2]["x-quota-limit"], "1000000")                        # tệp hỏng = không cấp thêm
        self.write_grants({day: {uid: -5, other: True}})
        self.assertEqual(self.post()[2]["x-quota-limit"], "1000000")                        # số âm / không phải số nguyên bị bỏ
        self.write_grants({day: {uid: 250_000}})
        os.utime(self.grants_path, (self._gm + 1, self._gm + 1))
        self.assertEqual(self.post()[2]["x-quota-limit"], "1250000")
        self.now[0] = T0 + 86400                                                            # sang ngày sau: tự hết hiệu lực
        self.assertEqual(self.post()[2]["x-quota-limit"], "1000000")

    def test_grants_do_not_change_unlimited_or_admin(self):
        day = Q.vn_day(T0)
        self.write_grants({day: {self.uid("admin@neu.edu.vn"): 5_000_000}})
        st, _, h = self.post(ident="admin@neu.edu.vn")
        self.assertEqual((st, h.get("x-quota-state")), (200, "unlimited"))

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


class ModelListTests(GatewayCase):
    """GET /vllm/v1/models: cổng lấy danh sách từ gateway rồi chỉ giữ mô hình người gọi được dùng (theo bậc/nhóm)."""

    def setUp(self):
        super().setUp()
        self.groups_path = os.path.join(self.tmp.name, "q", "groups.json")
        self.ctx.group_file = Q.Groups(self.groups_path)

    def ids(self, ident=SV, headers=None):
        st, out, h = self.get(Q.MODELS_PATH, ident=ident, headers=headers)
        self.assertEqual(st, 200, out)
        return [m["id"] for m in json.loads(out)["data"]], h

    def group(self, op, **kw):
        res = QA.group_op(self.groups_path, T0, "admin@neu.edu.vn", op, "lop-a", **kw)
        self.assertTrue(res["ok"], res)

    def test_no_model_limit_returns_listing_unchanged(self):
        st, out, h = self.get(Q.MODELS_PATH)
        self.assertEqual((st, out), (200, self.up.models_body))                 # nguyên từng byte như gateway trả
        self.assertNotIn("x-neu-models", h)
        self.assertEqual(self.up.model_gets[0]["path"], "/vllm/v1/models")

    def test_tier_limit_filters_by_exact_id(self):
        self.write_cfg({"models": {"student": ["m", "khong-co-tren-gateway"]}})
        ids, h = self.ids()
        self.assertEqual(ids, ["m"])                                            # "M" khác "m"; mô hình không có trên gateway không tự thêm
        self.assertEqual(h["x-neu-models"], "filtered")
        self.assertEqual(self.ids(GV)[0], ["m", "qwen-lon", "M"])                # bậc khác không cấu hình: nguyên danh sách

    def test_group_overrides_tier_and_empty_list(self):
        self.write_cfg({"models": {"student": ["m"]}})
        self.group("create")
        self.group("add", idents=[SV])
        self.group("set", field="models", value=["qwen-lon"])
        self.assertEqual(self.ids()[0], ["qwen-lon"])
        self.group("set", field="models", value=["da-go-khoi-gateway"])
        ids, h = self.ids()
        self.assertEqual((ids, h["x-neu-models"]), ([], "filtered"))           # không còn mô hình nào dùng được: danh sách rỗng (ứng dụng báo rõ)
        self.group("set", field="models", value=["*"])
        self.assertEqual(self.ids()[0], ["m", "qwen-lon", "M"])

    def test_admin_own_key_and_observe_are_not_filtered(self):
        self.write_cfg({"models": {"student": [], "staff": []}})
        self.assertEqual(self.ids("admin@neu.edu.vn")[0], ["m", "qwen-lon", "M"])
        self.assertEqual(self.ids(headers={"X-Neu-Own-Key": "1"})[0], ["m", "qwen-lon", "M"])
        self.assertEqual(self.ids()[0], [])
        self.write_cfg({"mode": "observe", "models": {"student": []}})
        self.assertEqual(self.ids()[0], ["m", "qwen-lon", "M"])

    def test_identity_required_and_secrets_not_forwarded(self):
        self.assertEqual(self.get(Q.MODELS_PATH, ident=None)[0], 401)
        self.assertEqual(self.get(Q.MODELS_PATH, ident="khong phai email")[0], 401)
        self.assertEqual(self.up.model_gets, [])
        self.get(Q.MODELS_PATH, headers={"x-ollama-seckey": "khoa-may-chu", "Cookie": "sess=bi-mat", "Authorization": "Bearer abc", "X-Neu-Own-Key": "0"})
        h = {k.lower(): v for k, v in self.up.model_gets[0]["headers"].items()}
        self.assertEqual((h["x-ollama-seckey"], h["x-user-email"]), ("khoa-may-chu", SV))
        for k in ("cookie", "authorization", "x-neu-own-key"):
            self.assertNotIn(k, h)

    def test_upstream_error_passthrough_and_bad_listing_is_not_leaked(self):
        self.write_cfg({"models": {"student": ["m"]}})
        self.up.status = 401                                                   # key riêng sai: lỗi của gateway đi nguyên (ứng dụng báo "Key sai")
        self.assertEqual(self.get(Q.MODELS_PATH)[0], 401)
        self.up.status = 200
        for bad in (b"{hong", b'{"data": "x"}', b"[]", b'{"data":[{"id":"m"}],"x":"' + b"a" * Q.MAX_MODELS_BODY + b'"}'):
            self.up.models_body = bad
            st, out, _ = self.get(Q.MODELS_PATH)
            self.assertEqual(st, 500, bad[:20])                                # lỗi rõ, không trả nguyên (và không 404: nginx sẽ gọi thẳng Kong = bỏ lọc)
            self.assertEqual(json.loads(out)["error"], "upstream_format")
        self.up.models_body = json.dumps({"data": [{"id": "m"}, "rac", {"id": 5}, {"khong": "id"}]}).encode()
        self.assertEqual(self.ids()[0], ["m"])                                 # phần tử lạ bị bỏ

    def test_upstream_down_gives_502(self):
        self.up.close()
        st, out, _ = self.get(Q.MODELS_PATH)
        self.assertEqual((st, json.loads(out)["error"]), (502, "upstream"))

    def test_models_listing_is_not_counted_or_denied(self):
        self.write_cfg({"models": {"student": []}})
        self.ids()
        self.assertEqual(self.used(SV), 0)
        with self.store.lock:
            self.assertEqual(self.store.db.execute("select count(*) from denials").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
