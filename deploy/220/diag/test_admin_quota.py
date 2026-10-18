"""Kiểm thử trang quản lý hạn mức token (collector.py + quota_admin.py): xem ai đã hết hạn mức và cấp thêm cho hôm nay."""
import http.client
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest

import collector as C
import quota_admin as QA

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = b"unit-test-secret-0123456789abcdef"
JSON_H = {"Content-Type": "application/json", "X-Neu-Admin": "1", "Origin": "https://ai.neu.edu.vn", "Sec-Fetch-Site": "same-origin"}
SV, GV = "sv.nguyen@st.neu.edu.vn", "gv.tran@neu.edu.vn"
UNKNOWN = "0123456789abcdef"


def make_db(path, day, rows):
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE usage(day TEXT NOT NULL, uid TEXT NOT NULL, tier TEXT NOT NULL DEFAULT '', lim INTEGER NOT NULL DEFAULT -1,
        tokens INTEGER NOT NULL DEFAULT 0, prompt INTEGER NOT NULL DEFAULT 0, completion INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
        estimated INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, extra INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, uid))""")
    for r in rows:
        db.execute("INSERT INTO usage(day,uid,tier,lim,tokens,requests,blocked,extra) VALUES(?,?,?,?,?,?,?,?)", (day,) + r)
    db.commit()
    db.close()


class AdminQuota(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(dir="/tmp")
        d = cls.tmp
        cls.now = time.time()
        cls.day = QA.vn_day(cls.now)
        cls.uid_sv, cls.uid_gv = C.pseudonym(SECRET, SV), C.pseudonym(SECRET, GV)
        cls.uid_ok = C.pseudonym(SECRET, "sv.ok@st.neu.edu.vn")
        cls.db = os.path.join(d, "usage.db")
        make_db(cls.db, cls.day, [
            (cls.uid_sv, "student", 1_000_000, 1_050_000, 9, 3, 0),         # hết hạn mức (đã bị chặn 3 lần)
            (cls.uid_gv, "staff", 10_000_000, 8_500_000, 40, 0, 0),          # gần hết
            (cls.uid_ok, "student", 1_000_000, 100_000, 2, 0, 0),            # còn nhiều
            (UNKNOWN, "student", 1_000_000, 1_000_000, 5, 1, 0),             # chưa có trong sổ tên
            ("ffffffffffffffff", "admin", -1, 5_000_000, 20, 0, 0),          # không giới hạn
        ])
        cls.grants = os.path.join(d, "grants.json")
        cls.admins = os.path.join(d, "admins.txt")
        with open(cls.admins, "w") as f:
            f.write("Admin@NEU.edu.vn\n")
        web = os.path.join(d, "web")
        os.makedirs(web)
        for n in ("quota.html", "quota.js"):
            shutil.copy(os.path.join(HERE, n), os.path.join(web, n))
        reg = C.Registry(os.path.join(d, "seen.json"))
        for ident in (SV, GV, "sv.ok@st.neu.edu.vn"):
            reg.touch(ident, {"platform": "web"}, [], 1)
        cls.cfg = C.Config(diag_dir=os.path.join(d, "diag"), secret=SECRET, reports_dir=os.path.join(d, "r"), admins_file=cls.admins, web_dir=web,
                           schema=C.load_schema(), registry=reg, quota_db=cls.db, grants_file=cls.grants,
                           groups_file=os.path.join(d, "groups.json"), policy_file=os.path.join(d, "policy.json"))
        cls.groups = cls.cfg.groups_file
        cls.srv = C.make_server(cls.cfg, "127.0.0.1", 0)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, True)

    def setUp(self):
        for p in (self.grants, self.grants + ".tmp", self.groups, self.cfg.policy_file):
            if os.path.lexists(p):
                os.remove(p)
        self.cfg.admin_hits.clear()

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

    def get(self, **kw):
        st, data, _ = self.req("GET", "/admin/api/quota", **kw)
        return st, json.loads(data)

    def grant(self, uid, amount, **kw):
        h = dict(JSON_H)
        h.update(kw.pop("headers", {}))
        st, data, _ = self.req("POST", "/admin/api/quota", {"op": "grant", "uid": uid, "amount": amount}, headers=h, **kw)
        return st, json.loads(data)

    # ---------------------------------------------------------------- quyền
    def test_only_admins_can_see_or_grant(self):
        self.assertEqual(self.get(email="sv.nguyen@st.neu.edu.vn")[0], 403)
        self.assertEqual(self.get(email=None)[0], 403)
        self.assertEqual(self.grant(self.uid_sv, 1_000_000, email="sv.nguyen@st.neu.edu.vn")[0], 403)
        self.assertEqual(self.req("GET", "/admin/quota", email="sv.nguyen@st.neu.edu.vn")[0], 403)
        self.assertFalse(os.path.exists(self.grants))

    def test_pages_are_served_to_admins_with_strict_csp(self):
        st, body, h = self.req("GET", "/admin/quota")
        self.assertEqual(st, 200)
        self.assertIn(b"quota.js", body)
        self.assertIn("script-src 'self'", h["content-security-policy"])
        st, body, h = self.req("GET", "/admin/quota.js")
        self.assertEqual((st, h["content-type"].split(";")[0]), (200, "text/javascript"))
        self.assertNotIn(b".innerHTML", body)

    def test_post_requires_csrf_protections(self):
        body = {"op": "grant", "uid": self.uid_sv, "amount": 1_000_000}
        base = dict(JSON_H)
        for bad in ({"X-Neu-Admin": "0"}, {"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}, {"Content-Type": "text/plain"}):
            h = dict(base)
            h.update(bad)
            self.assertEqual(self.req("POST", "/admin/api/quota", body, headers=h)[0], 403, bad)
        self.assertFalse(os.path.exists(self.grants))

    # ---------------------------------------------------------------- xem
    def test_lists_exhausted_first_with_names_and_counts(self):
        st, j = self.get()
        self.assertEqual(st, 200)
        self.assertEqual((j["total"], j["over"], j["near"]), (5, 2, 1))
        states = [u["state"] for u in j["users"]]
        self.assertEqual(states, ["over", "over", "near", "ok", "unlimited"])
        top = j["users"][0]
        self.assertEqual((top["name"], top["state"], top["blocked"], top["limit"], top["pct"]), (SV, "over", 3, 1_000_000, 105.0))
        unknown = next(u for u in j["users"] if u["uid"] == UNKNOWN)
        self.assertIsNone(unknown["name"])                                      # chưa có trong sổ: hiện mã
        self.assertIsNone(next(u for u in j["users"] if u["state"] == "unlimited")["limit"])

    # ---------------------------------------------------------------- cấp thêm
    def test_grant_raises_effective_limit_and_is_cumulative_and_audited(self):
        st, j = self.grant(self.uid_sv, 1_000_000)
        self.assertEqual((st, j["ok"], j["extra"]), (200, True, 1_000_000))
        self.assertEqual(self.grant(self.uid_sv, 5_000_000)[1]["extra"], 6_000_000)
        row = next(u for u in self.get()[1]["users"] if u["uid"] == self.uid_sv)
        self.assertEqual((row["limit"], row["extra"], row["state"]), (7_000_000, 6_000_000, "ok"))      # 1,05 / 7 triệu: hết trạng thái "hết"
        self.assertEqual(self.get()[1]["over"], 1)
        # cổng hạn mức đọc đúng tệp này
        with open(self.grants) as f:
            raw = json.load(f)
        self.assertEqual(raw["days"][self.day][self.uid_sv], 6_000_000)
        aud = self.get()[1]["audit"]
        self.assertEqual((aud[0]["actor"], aud[0]["uid"], aud[0]["add"], aud[0]["total"], aud[0]["who"]), ("admin@neu.edu.vn", self.uid_sv, 5_000_000, 6_000_000, SV))
        self.assertEqual(len(aud), 2)

    def test_stored_extra_in_db_is_not_counted_twice(self):
        db = sqlite3.connect(self.db)
        db.execute("UPDATE usage SET lim=1500000, extra=500000 WHERE uid=?", (self.uid_sv,))   # cổng ghi lại: hạn mức 1,5 triệu gồm 500k đã cấp
        db.commit()
        db.close()
        try:
            self.grant(self.uid_sv, 1_000_000)
            row = next(u for u in self.get()[1]["users"] if u["uid"] == self.uid_sv)
            self.assertEqual(row["limit"], 2_000_000)           # gốc 1 triệu + tổng cấp thêm hiện tại 1 triệu
        finally:
            db = sqlite3.connect(self.db)
            db.execute("UPDATE usage SET lim=1000000, extra=0 WHERE uid=?", (self.uid_sv,))
            db.commit()
            db.close()

    def test_zero_removes_todays_extra(self):
        self.grant(self.uid_sv, 5_000_000)
        st, j = self.grant(self.uid_sv, 0)
        self.assertEqual((st, j["extra"]), (200, 0))
        row = next(u for u in self.get()[1]["users"] if u["uid"] == self.uid_sv)
        self.assertEqual((row["extra"], row["limit"], row["state"]), (0, 1_000_000, "over"))

    def test_grant_can_be_given_to_person_not_in_name_book(self):
        st, j = self.grant(UNKNOWN, 1_000_000)
        self.assertEqual((st, j["extra"]), (200, 1_000_000))

    def test_validation(self):
        for amount in (-1, 100_000_001, "5", 1.5, True, None):
            self.assertEqual(self.grant(self.uid_sv, amount)[0], 400, amount)
        self.assertEqual(self.grant("khong-phai-uid", 1_000_000)[0], 404)
        self.assertEqual(self.grant("aaaaaaaaaaaaaaaa", 1_000_000)[0], 404)      # đúng dạng nhưng không có số liệu hôm nay
        self.assertEqual(self.grant(self.uid_sv, 1)[0], 200)
        h = dict(JSON_H)
        self.assertEqual(self.req("POST", "/admin/api/quota", {"op": "xoa-het"}, headers=h)[0], 400)
        self.assertEqual(self.req("POST", "/admin/api/quota", b"{khong json", headers=h)[0], 400)

    def test_total_per_day_is_capped(self):
        for _ in range(10):
            self.assertEqual(self.grant(self.uid_sv, 100_000_000)[0], 200)        # 1 tỷ = mức trần
        st, j = self.grant(self.uid_sv, 1)
        self.assertEqual((st, j["error"]), (400, "too_much"))

    def test_rate_limit_applies(self):
        codes = [self.grant(self.uid_sv, 1)[0] for _ in range(C.ADMIN_POSTS_PER_MIN + 3)]
        self.assertEqual(codes[:C.ADMIN_POSTS_PER_MIN], [200] * C.ADMIN_POSTS_PER_MIN)
        self.assertEqual(codes[-1], 429)

    def test_old_days_are_pruned_and_garbage_state_is_ignored(self):
        with open(self.grants, "w") as f:
            json.dump({"days": {"2000-01-01": {self.uid_sv: 5}, self.day: {self.uid_sv: 7, "bad": 3, self.uid_gv: -4}}, "audit": ["x", {"ts": 1}]}, f)
        self.assertEqual(self.grant(self.uid_sv, 1)[1]["extra"], 8)
        with open(self.grants) as f:
            raw = json.load(f)
        self.assertNotIn("2000-01-01", raw["days"])
        self.assertEqual(raw["days"][self.day], {self.uid_sv: 8})
        with open(self.grants, "w") as f:
            f.write("{hỏng")
        self.assertEqual(self.grant(self.uid_sv, 2)[1]["extra"], 2)               # tệp hỏng coi như chưa có gì

    # ---------------------------------------------------------------- nhóm tuỳ tạo
    def gop(self, body, **kw):
        h = dict(JSON_H)
        h.update(kw.pop("headers", {}))
        st, data, _ = self.req("POST", "/admin/api/quota", body, headers=h, **kw)
        return st, json.loads(data)

    def test_groups_need_admin_and_csrf(self):
        body = {"op": "group_create", "name": "lop-k66-cntt"}
        self.assertEqual(self.gop(body, email="sv.nguyen@st.neu.edu.vn")[0], 403)
        self.assertEqual(self.gop(body, email=None)[0], 403)
        for bad in ({"X-Neu-Admin": "0"}, {"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"}, {"Content-Type": "text/plain"}):
            self.assertEqual(self.gop(body, headers=bad)[0], 403, bad)
        self.assertFalse(os.path.exists(self.groups))

    def test_group_lifecycle_via_page_and_listing(self):
        self.assertEqual(self.gop({"op": "group_create", "name": "lop-k66-cntt"})[0], 200)
        st, j = self.gop({"op": "group_add", "name": "lop-k66-cntt", "idents": "Sv.Nguyen@st.neu.edu.vn, khach01\nsv.ok@st.neu.edu.vn"})
        self.assertEqual((st, j["members"]), (200, 3))
        for field, value in (("limit", 2_000_000), ("tabs", ["work", "code"]), ("models", ["qwen3.5-35b-a3b-int4"]), ("tab_limits", {"code": 500_000})):
            self.assertEqual(self.gop({"op": "group_set", "name": "lop-k66-cntt", "field": field, "value": value})[0], 200, field)
        with open(self.cfg.policy_file, "w") as f:
            json.dump({"mode": "enforce", "tiers": {"student": 5_000_000}, "tabs": {}, "models": {}, "overrides": 2, "lạ": "bỏ"}, f)
        st, j = self.get()
        g = j["groups"][0]
        self.assertEqual((g["name"], g["members"], g["limit"], g["tabs"], g["tab_limits"]), ("lop-k66-cntt", ["khach01", "sv.nguyen@st.neu.edu.vn", "sv.ok@st.neu.edu.vn"], 2_000_000, ["work", "code"], {"code": 500_000}))
        self.assertEqual({u["uid"]: u["group"] for u in j["users"]}[self.uid_sv], "lop-k66-cntt")
        self.assertIsNone({u["uid"]: u["group"] for u in j["users"]}[self.uid_gv])
        self.assertEqual(j["policy"], {"mode": "enforce", "tiers": {"student": 5_000_000}, "tabs": {}, "models": {}, "overrides": 2})
        self.assertEqual(j["groups_audit"][0]["actor"], "admin@neu.edu.vn")       # người sửa do máy chủ gắn
        self.assertEqual(os.stat(self.groups).st_mode & 0o777, 0o600)
        self.assertEqual(self.gop({"op": "group_set", "name": "lop-k66-cntt", "field": "limit", "value": None})[0], 200)   # trở về theo bậc
        self.assertNotIn("limit", self.get()[1]["groups"][0])
        self.assertEqual(self.gop({"op": "group_remove", "name": "lop-k66-cntt", "idents": ["khach01"]})[1]["members"], 2)
        self.assertEqual(self.gop({"op": "group_delete", "name": "lop-k66-cntt"})[0], 200)
        self.assertEqual(self.get()[1]["groups"], [])

    def test_group_validation_rejects_bad_input(self):
        self.gop({"op": "group_create", "name": "lop-a"})
        self.gop({"op": "group_create", "name": "lop-b"})
        self.gop({"op": "group_add", "name": "lop-a", "idents": ["khach01"]})
        bad = [
            ({"op": "group_create", "name": "Lớp A"}, 400), ({"op": "group_create", "name": "../x"}, 400), ({"op": "group_create", "name": "lop-a"}, 409),
            ({"op": "group_add", "name": "lop-b", "idents": ["khach01"]}, 409),                          # mỗi người một nhóm
            ({"op": "group_add", "name": "lop-b", "idents": ["không phải email"]}, 400), ({"op": "group_add", "name": "lop-b", "idents": []}, 400),
            ({"op": "group_add", "name": "lop-b", "idents": ["a%d@neu.edu.vn" % i for i in range(501)]}, 400),
            ({"op": "group_add", "name": "khong-co", "idents": ["a@neu.edu.vn"]}, 404),
            ({"op": "group_set", "name": "lop-a", "field": "limit", "value": -5}, 400), ({"op": "group_set", "name": "lop-a", "field": "limit", "value": "5"}, 400),
            ({"op": "group_set", "name": "lop-a", "field": "limit", "value": True}, 400), ({"op": "group_set", "name": "lop-a", "field": "tabs", "value": ["admin"]}, 400),
            ({"op": "group_set", "name": "lop-a", "field": "models", "value": ["bad model"]}, 400), ({"op": "group_set", "name": "lop-a", "field": "models", "value": []}, 400),
            ({"op": "group_set", "name": "lop-a", "field": "tab_limits", "value": {"khac": 5}}, 400), ({"op": "group_set", "name": "lop-a", "field": "members", "value": ["x@y.vn"]}, 400),
        ]
        for body, code in bad:
            self.assertEqual(self.gop(body)[0], code, body)
        st, j = self.get()
        self.assertEqual([(g["name"], g["members"]) for g in j["groups"]], [("lop-a", ["khach01"]), ("lop-b", [])])
        self.assertNotIn("limit", j["groups"][0])

    def test_broken_or_symlinked_groups_file_is_never_overwritten(self):
        with open(self.groups, "w") as f:
            f.write("{hỏng")
        st, j = self.gop({"op": "group_create", "name": "lop-a"})
        self.assertEqual((st, j["error"]), (409, "broken"))
        self.assertTrue(self.get()[1]["groups_error"])
        with open(self.groups) as f:
            self.assertEqual(f.read(), "{hỏng")
        os.remove(self.groups)
        target = os.path.join(self.tmp, "victim.json")
        with open(target, "w") as f:
            f.write('{"groups": {}}')
        os.symlink(target, self.groups)
        self.assertEqual(self.gop({"op": "group_create", "name": "lop-a"})[1]["error"], "broken")
        with open(target) as f:
            self.assertEqual(f.read(), '{"groups": {}}')

    def test_cli_used_by_quota_sh(self):
        out = []
        p = self.groups
        self.assertEqual(QA.cli(["create", "giang-vien-fit"], p, out.append), 0)
        self.assertEqual(QA.cli(["add", "giang-vien-fit", "a@neu.edu.vn", "khach01"], p, out.append), 0)
        self.assertEqual(QA.cli(["limit", "giang-vien-fit", "20.000.000"], p, out.append), 0)
        self.assertEqual(QA.cli(["tabs", "giang-vien-fit", "work,code"], p, out.append), 0)
        self.assertEqual(QA.cli(["models", "giang-vien-fit", "*"], p, out.append), 0)
        self.assertEqual(QA.cli(["tablimit", "giang-vien-fit", "code", "1,000,000"], p, out.append), 0)
        g = QA.read_groups(p)["groups"]["giang-vien-fit"]
        self.assertEqual((g["limit"], g["tabs"], g["models"], g["tab_limits"], g["members"]), (20_000_000, ["work", "code"], ["*"], {"code": 1_000_000}, ["a@neu.edu.vn", "khach01"]))
        self.assertEqual(QA.cli(["tablimit", "giang-vien-fit", "code", "default"], p, out.append), 0)
        self.assertNotIn("tab_limits", QA.read_groups(p)["groups"]["giang-vien-fit"])
        out.clear()
        self.assertEqual(QA.cli(["of", "KHACH01"], p, out.append), 0)
        self.assertIn("giang-vien-fit", out[0])
        for bad in (["limit", "giang-vien-fit", "nhiều"], ["tabs", "giang-vien-fit", "admin"], ["tablimit", "giang-vien-fit", "khac", "5"], ["add", "khong-co", "a@b.vn"], ["xoa-het"]):
            self.assertEqual(QA.cli(bad, p, out.append), 1, bad)

    def test_unavailable_without_quota_db(self):
        old = self.cfg.quota_db
        self.cfg.quota_db = os.path.join(self.tmp, "khong-co.db")
        try:
            self.assertEqual(self.get()[0], 503)
            self.assertEqual(self.grant(self.uid_sv, 1)[0], 503)
        finally:
            self.cfg.quota_db = old


if __name__ == "__main__":
    unittest.main()
