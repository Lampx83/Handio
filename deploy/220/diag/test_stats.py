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

    def test_funnel_segments_histograms_and_heatmap(self):
        recs = []
        for i in range(6):                                   # u0 dùng 6 lượt trong 1 ngày
            recs.append(rec(day_ts(0, 2 + i), turn_ev(dur_s=10 + i), uid="0" * 16))
        recs += [rec(day_ts(d), turn_ev(), uid="1" * 16) for d in (0, 1, 2, 3, 4, 5)]       # u1 dùng 6 ngày liên tiếp
        recs += [rec(day_ts(20), turn_ev(), uid="2" * 16)]                                  # u2 ngủ đông: 1 lượt cách đây 20 ngày
        recs += [rec(day_ts(0), {"t": "signal", "code": "loop"}, uid="0" * 16), rec(day_ts(0), {"t": "llm_error", "kind": "rate", "status": 429}, uid="0" * 16)]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        self.assertEqual(j["segments"], {"new": 2, "active": 0, "dormant": 1})
        fn = dict(j["funnel"])
        self.assertEqual((fn["Người dùng"], fn["Có ≥ 1 lượt làm việc"], fn["Có ≥ 5 lượt"], fn["Dùng ≥ 2 ngày khác nhau"], fn["Dùng ≥ 5 ngày khác nhau"]), (3, 3, 2, 1, 1))
        self.assertEqual(dict(j["hist_turns"])["1"], 1)
        self.assertEqual(dict(j["hist_days"])["≥ 14 ngày"], 0)
        self.assertEqual(sum(sum(r) for r in j["heat"]), j["kpi"]["turns_30d"])
        self.assertEqual(j["signals"], {"loop": 1})
        self.assertEqual(j["llm_errors"], {"rate": 1})
        today = j["series"][-1]
        self.assertEqual((today["turns"], today["outcomes"]["ok"], today["dur_p95"] > 10), (7, 7, True))
        self.assertTrue(all(len(u["spark"]) == S.SPARK_DAYS for u in j["users"]))
        h = slurp(os.path.join(self.out, "index.html"))
        for frag in ("Phễu sử dụng", "Bản đồ nhiệt", "Tình trạng người dùng", "badge bn", 'id="nguoi-dung"'):
            self.assertIn(frag, h)

    def test_prior_period_delta_and_insights(self):
        recs = [rec(day_ts(0), turn_ev("error"), uid="a" * 16), rec(day_ts(0), turn_ev(), uid="b" * 16), rec(day_ts(0), turn_ev(), uid="c" * 16),
                rec(day_ts(1, 8), turn_ev(), uid="a" * 16)]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        self.assertEqual((j["kpi"]["users_24h"], j["kpi"]["prev"]["users_24h"]), (3, 1))
        msgs = " ".join(m for _, m in S.insights(j))
        self.assertIn("tăng", msgs)
        self.assertIn("Tỷ lệ lượt kết thúc bằng lỗi", msgs)
        self.assertIn("▲", slurp(os.path.join(self.out, "index.html")))

    def test_findings_are_read_from_latest_json(self):
        os.makedirs(self.out)
        jdump({"findings": [{"sev": "cao", "title": "Mô hình lỗi", "evidence": "5xx 10%"}, "bậy", {"sev": "thấp", "title": "x", "evidence": ""}]}, os.path.join(self.out, "latest.json"))
        write_diag(self.diag, [rec(day_ts(0), turn_ev())])
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        self.assertEqual([f["sev"] for f in j["findings"]], ["cao", "thấp"])
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Mô hình lỗi", h)
        self.assertIn("1 mức cao", h)

    def test_untrusted_strings_are_escaped(self):
        write_diag(self.diag, [rec(day_ts(0), turn_ev(), app=dict(APP, model="<img src=x>"))])
        S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertNotIn("<img src=x>", h)

    def test_release_adoption(self):
        dl = os.path.join(self.tmp.name, "dl")
        os.makedirs(dl)
        jdump({"version": "0.2.0", "released": "2026-10-20", "minVersion": "0.1.5", "notes": "• Mới"}, os.path.join(dl, "latest.json"))
        recs = [rec(day_ts(0), turn_ev(), uid="a" * 16, app=dict(APP, version="0.2.0")), rec(day_ts(0), turn_ev(), uid="b" * 16, app=dict(APP, version="0.1.0")),
                rec(day_ts(0), turn_ev(), uid="c" * 16, app=dict(APP, version="0.1.9")), rec(day_ts(0), turn_ev(), uid="d" * 16, app=dict(APP, version="0.2.1"))]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW, dl)
        r = j["release"]
        self.assertEqual((r["version"], r["min"], r["on_latest"], r["below_min"], r["adoption"]), ("0.2.0", "0.1.5", 2, 1, 0.5))
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Phát hành", h)
        self.assertIn("đã dùng bản mới nhất đang phát hành (0.2.0)", " ".join(m for _, m in S.insights(j)))
        # latest.json hỏng/độc hại: bỏ qua, không làm hỏng trang
        jdump({"version": "<script>", "notes": 5}, os.path.join(dl, "latest.json"))
        self.assertIsNone(S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW, dl)["release"])
        self.assertIsNone(S.read_release(os.path.join(self.tmp.name, "nope")))

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
