"""Kiểm thử trang tổng quan quản trị:  python3 -m unittest discover -s deploy/220/diag -p 'test_*.py'"""
import datetime
import json
import os
import tempfile
import unittest

import report as R
import stats as S
from test_report import APP, NOW, T_NOW, nginx_row, rec, turn_ev, write_diag


def jload(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def jdump(o, p):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(o, f)


def slurp(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def day_ts(days_ago, hour=5):
    return T_NOW - days_ago * 86400 - hour * 3600


class StatsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.diag, self.out = os.path.join(self.tmp.name, "diag"), os.path.join(self.tmp.name, "out")
        os.makedirs(self.diag)
        self.log = os.path.join(self.tmp.name, "n.json.log")
        self.addCleanup(self.tmp.cleanup)

    def write_log(self, rows):
        with open(self.log, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    def test_counts_users_windows_and_new(self):
        a2 = dict(APP, install="f" * 32, version="0.2.0", platform="mac", profile="work")
        recs = [rec(day_ts(0), turn_ev(), uid="a" * 16), rec(day_ts(0), turn_ev("error"), uid="b" * 16, app=a2),   # hôm nay
                rec(day_ts(3), turn_ev(), uid="a" * 16), rec(day_ts(20), turn_ev(), uid="c" * 16),                 # c chỉ trong 30 ngày
                rec(day_ts(60), turn_ev(), uid="d" * 16), rec(day_ts(10, 0), {"t": "tool", "name": "bash", "ok": True}, uid="a" * 16)]
        write_diag(self.diag, recs)
        S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        j = jload(os.path.join(self.out, "stats.json"))
        k = j["kpi"]
        self.assertEqual((k["users_24h"], k["users_7d"], k["users_30d"], k["users_total"]), (2, 2, 3, 4))
        self.assertEqual((k["turns_24h"], k["turns_30d"], k["turns_total"]), (2, 4, 5))
        self.assertEqual(k["new_users_7d"], 1)                      # b lần đầu xuất hiện trong 7 ngày
        self.assertEqual(k["installs_30d"], 2)
        top = {u["id"]: u for u in j["users"]}
        self.assertEqual(top["a" * 8]["turns30"], 2)
        self.assertEqual(top["b" * 8]["platform"], "mac")
        self.assertTrue(all(len(u["id"]) == 8 for u in j["users"]))
        self.assertEqual(sum(j["hours"]), 4)
        self.assertEqual(len(j["series"]), 30)
        self.assertEqual(j["series"][-1]["errors"], 1)

    def test_page_is_static_and_has_no_secrets(self):
        write_diag(self.diag, [rec(day_ts(0), turn_ev(), uid="a" * 16)])
        S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertNotIn("<script", h.lower())
        self.assertNotIn("http://", h)
        self.assertNotIn("https://", h)
        self.assertIn("aaaaaaaa", h)
        self.assertNotIn("a" * 16, h)                                # chỉ 8 ký tự đầu của mã
        self.assertEqual(oct(os.stat(os.path.join(self.out, "index.html")).st_mode & 0o777), "0o640")

    def test_nginx_daily_accumulates_beyond_log_window(self):
        d_old = S.vn_day(day_ts(20))
        os.makedirs(self.out)
        jdump({d_old: {"chat": 7, "pkg": 2}}, os.path.join(self.out, "nginx-daily.json"))
        self.write_log([nginx_row(day_ts(0), 200, "vllm_chat"), nginx_row(day_ts(0), 502, "vllm_chat"), nginx_row(day_ts(0), 200, "download_pkg"),
                        nginx_row(day_ts(0), 206, "download_pkg"), nginx_row(day_ts(0), 200, "download"), nginx_row(day_ts(0), 200, "ui")])
        write_diag(self.diag, [rec(day_ts(0), turn_ev())])
        S.run(self.diag, self.log, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        daily = jload(os.path.join(self.out, "nginx-daily.json"))
        self.assertEqual(daily[d_old], {"chat": 7, "pkg": 2})        # ngày cũ được giữ
        t = daily[S.vn_day(T_NOW)]
        self.assertEqual((t["chat"], t["chat_ok"], t["chat_5xx"], t["pkg"], t["update_check"], t["req"]), (2, 1, 1, 1, 1, 6))
        j = jload(os.path.join(self.out, "stats.json"))
        self.assertEqual(j["downloads_total"], 3)
        self.assertEqual(j["series"][-1]["chat"], 2)

    def test_empty_data_still_renders(self):
        S.run(self.diag, self.log, self.out, os.path.join(self.tmp.name, "none.json"), NOW)
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Quản trị NEU Agent", h)
        self.assertIn("chưa có dữ liệu kiểm tra sức khoẻ", h)

    def test_health_states(self):
        p = os.path.join(self.tmp.name, "h.json")
        jdump({"ok": False, "failed": ["disk"]}, p)
        self.assertEqual(S.read_health(p, os.path.getmtime(p) + 10)[:2], (False, ["disk"]))
        jdump({"ok": True}, p)
        self.assertTrue(S.read_health(p, os.path.getmtime(p) + 10)[0])
        self.assertFalse(S.read_health(p, os.path.getmtime(p) + 5000)[0])   # quá cũ
        self.assertIsNone(S.read_health(p + ".x", 0)[0])

    def test_main(self):
        write_diag(self.diag, [rec(day_ts(0), turn_ev())])
        self.assertEqual(S.main(["--diag-dir", self.diag, "--nginx-log", self.log, "--out", self.out, "--health", os.path.join(self.tmp.name, "h"), "--now", str(T_NOW)]), 0)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "index.html")))


if __name__ == "__main__":
    unittest.main()
