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

    def test_tool_failure_reasons_exclude_user_program_errors(self):
        tool = lambda ok, err=None: {"t": "tool", "name": "run_javascript", "ok": ok, "dur": "lt1s", **({"err": err} if err else {})}
        recs = [rec(day_ts(0), tool(True)), rec(day_ts(0), tool(False, "program")), rec(day_ts(0), tool(False, "program")), rec(day_ts(0), tool(False, "sandbox")), rec(day_ts(0), tool(False)),
                rec(day_ts(0), {"t": "tool", "name": "read_file", "ok": False, "dur": "lt1s", "err": "not_found"})]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        rj = {x["name"]: x for x in j["tools"]}["run_javascript"]
        self.assertEqual((rj["calls"], rj["fails"], rj["prog"]), (5, 2, 2))          # chỉ sandbox + không rõ là lỗi công cụ
        self.assertEqual(j["tool_errors"], {"program": 2, "sandbox": 1, "unknown": 1, "not_found": 1})
        self.assertEqual(j["series"][-1]["tool_fails"], 3)
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Vì sao công cụ thất bại", h)
        self.assertIn("+2 chương trình lỗi", h)

    def test_token_quota_section(self):
        import sqlite3
        db = os.path.join(self.tmp.name, "usage.db")
        c = sqlite3.connect(db)
        c.execute("CREATE TABLE usage(day TEXT, uid TEXT, tier TEXT, lim INTEGER, tokens INTEGER, prompt INTEGER, completion INTEGER, requests INTEGER, estimated INTEGER, blocked INTEGER, PRIMARY KEY(day,uid))")
        today, yday = S.vn_day(T_NOW), S.vn_day(T_NOW - 86400)
        rows = [(today, "a" * 16, "student", 1_000_000, 850_000, 0, 0, 12, 0, 0), (today, "b" * 16, "student", 1_000_000, 1_150_000, 0, 0, 20, 0, 3),
                (today, "c" * 16, "staff", 10_000_000, 2_000_000, 0, 0, 5, 0, 0), (today, "d" * 16, "admin", -1, 99_000_000, 0, 0, 9, 0, 0), (yday, "a" * 16, "student", 1_000_000, 500_000, 0, 0, 4, 0, 0)]
        c.executemany("INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?)", rows)
        c.commit()
        c.close()
        write_diag(self.diag, [rec(day_ts(0), turn_ev())])
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW, None, db)
        q = j["quota"]
        self.assertEqual((q["users_today"], q["near"], q["over"], q["blocked_users"], q["blocked_requests"]), (4, 1, 1, 1, 3))
        self.assertEqual(q["tokens_today"], 850_000 + 1_150_000 + 2_000_000 + 99_000_000)
        self.assertEqual(q["series"][-1]["tokens"], q["tokens_today"])
        self.assertEqual(q["series"][-2]["tokens"], 500_000)
        self.assertEqual(q["tiers"]["student"], {"users": 2, "tokens": 2_000_000})
        users = {u["id"]: u for u in q["users"]}
        self.assertEqual((users["bbbbbbbb"]["pct"], users["dddddddd"]["limit"], users["dddddddd"]["pct"]), (115.0, None, None))
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn('id="han-muc"', h)
        self.assertIn("bị chặn", h)
        self.assertIn("bbbbbbbb", h)
        self.assertIn("đã bị chặn vì hết hạn mức", " ".join(m for _, m in S.insights(j)))
        # chưa cài cổng hạn mức: trang vẫn hiển thị, nói rõ
        j2 = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW, None, os.path.join(self.tmp.name, "khong-co.db"))
        self.assertIsNone(j2["quota"])
        self.assertIn("Chưa có dữ liệu hạn mức", slurp(os.path.join(self.out, "index.html")))

    def test_detail_pages_csv_and_links(self):
        a2 = dict(APP, version="0.2.0", platform="win", profile="work")
        recs = [rec(day_ts(0, 3), turn_ev(), uid="a" * 16), rec(day_ts(0, 4), turn_ev("error", prompt_tok=500, completion_tok=50), uid="a" * 16),
                rec(day_ts(1, 3), turn_ev(), uid="a" * 16), rec(day_ts(0, 5), turn_ev(), uid="b" * 16, app=a2),
                rec(day_ts(0, 3), {"t": "tool", "name": "read_file", "ok": False, "dur": "lt1s", "err": "not_found"}, uid="a" * 16),
                rec(day_ts(0, 3), {"t": "signal", "code": "loop", "tool": "bash"}, uid="a" * 16),
                rec(day_ts(0, 2), {"t": "report", "note": "<b>app lỗi</b> khi mở"}, uid="b" * 16, app=a2),
                rec(day_ts(40), turn_ev(), uid="z" * 16)]
        write_diag(self.diag, recs)
        # trang cũ còn sót phải bị dọn
        os.makedirs(self.out)
        for stale in ("u-deadbeef.html", "d-2020-01-01.html"):
            with open(os.path.join(self.out, stale), "w") as f:
                f.write("cũ")
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        files = set(os.listdir(self.out))
        self.assertTrue({"index.html", "data.html", "users.csv", "daily.csv", "tools.csv", "u-aaaaaaaa.html", "u-bbbbbbbb.html", "d-%s.html" % S.vn_day(T_NOW), "d-%s.html" % S.vn_day(T_NOW - 86400)} <= files)
        self.assertFalse({"u-deadbeef.html", "d-2020-01-01.html", "u-zzzzzzzz.html"} & files)    # dọn trang cũ; người dùng ngoài 30 ngày không có trang
        idx = slurp(os.path.join(self.out, "index.html"))
        self.assertIn('href="u-aaaaaaaa.html"', idx)                                              # mã người dùng dẫn tới trang chi tiết
        self.assertIn('href="d-%s.html"' % S.vn_day(T_NOW), idx)                                  # cột biểu đồ dẫn tới trang ngày
        for frag in ('id="f-near"', "Giữ chân theo tuần", 'id="he-thong"', "Báo lỗi do người dùng gửi", "Kiểm tra sức khoẻ" if False else "Dữ liệu chẩn đoán"):
            self.assertIn(frag, idx)
        self.assertNotIn("<b>app lỗi</b>", idx)                                                   # ghi chú người dùng được escape
        self.assertIn("&lt;b&gt;app lỗi&lt;/b&gt;", idx)
        up = slurp(os.path.join(self.out, "u-aaaaaaaa.html"))
        for frag in ("Người dùng", "30 lượt gần nhất", "Công cụ", "Không có file/thư mục", "loop"):
            self.assertIn(frag, up)
        dp = slurp(os.path.join(self.out, "d-%s.html" % S.vn_day(T_NOW)))
        for frag in ("Theo giờ", "Người dùng nhiều lượt nhất trong ngày", 'href="u-aaaaaaaa.html"', "Báo lỗi trong ngày"):
            self.assertIn(frag, dp)
        self.assertIn('href="d-%s.html"' % S.vn_day(T_NOW - 86400), dp)                           # chuyển sang ngày trước
        for page in (idx, up, dp, slurp(os.path.join(self.out, "data.html"))):
            self.assertNotIn("<script", page.lower())
        users_csv = slurp(os.path.join(self.out, "users.csv"))
        self.assertTrue(users_csv.startswith("\ufeffma,bac,"))
        self.assertIn("aaaaaaaa", users_csv)
        self.assertNotIn("@", users_csv)
        self.assertEqual(len(slurp(os.path.join(self.out, "daily.csv")).strip().split("\n")), 31)   # tiêu đề + 30 ngày
        self.assertIn("read_file", slurp(os.path.join(self.out, "tools.csv")))
        self.assertTrue(j["cohorts"] and j["cohorts"][-1]["n"] >= 2)
        self.assertGreaterEqual(j["system"]["diag_files"], 1)

    def test_cohort_table_weekly_retention(self):
        t = T_NOW
        wk = lambda days_ago: t - days_ago * 86400
        U = {"u1": {"first": wk(15), "days": {S.vn_day(wk(15)): 1, S.vn_day(wk(8)): 1, S.vn_day(wk(1)): 1}},
             "u2": {"first": wk(15), "days": {S.vn_day(wk(15)): 2}}}
        c = S.cohort_table(U, t)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["n"], 2)
        self.assertEqual(c[0]["ret"][0], 100.0)
        self.assertLessEqual(c[0]["ret"][1], 100.0)

    def test_gateway_latency_and_status_mix_in_daily(self):
        rows = [dict(nginx_row(day_ts(0), 200, "vllm_chat", rt=r), _ts=day_ts(0)) for r in (2.0, 4.0, 10.0)] + [dict(nginx_row(day_ts(0), 502, "vllm_chat"), _ts=day_ts(0)), dict(nginx_row(day_ts(0), 400, "diag"), _ts=day_ts(0))]
        d = S.nginx_daily(rows)[S.vn_day(day_ts(0))]
        self.assertEqual((d["chat"], d["chat_5xx"], d["chat_p50"], d["chat_st"], d["diag_st"]), (4, 1, 4.0, {"200": 3, "502": 1}, {"400": 1}))

    def test_new_token_metrics_features_and_feedback(self):
        recs = [rec(day_ts(0, 3), turn_ev(calls=4, peak_prompt_tok=9000, cached_tok=6000, tool_out_tok=3000, pruned=1, first_tool_s=3, prompt_tok=30000), uid="a" * 16),
                rec(day_ts(0, 4), turn_ev(calls=2, peak_prompt_tok=5000, cached_tok=0, tool_out_tok=1000, first_tool_s=5, prompt_tok=8000), uid="a" * 16),
                rec(day_ts(0, 4), turn_ev(prompt_tok=1000), uid="b" * 16),                                               # bản cũ: không có số đo mới
                rec(day_ts(0, 3), {"t": "ui", "act": "suggestion"}, uid="a" * 16), rec(day_ts(0, 3), {"t": "ui", "act": "suggestion"}, uid="b" * 16), rec(day_ts(0, 3), {"t": "ui", "act": "attach"}, uid="a" * 16),
                rec(day_ts(0, 3), {"t": "feedback", "v": "up"}, uid="a" * 16), rec(day_ts(0, 3), {"t": "feedback", "v": "down", "reason": "slow"}, uid="a" * 16), rec(day_ts(0, 3), {"t": "feedback", "v": "down"}, uid="b" * 16)]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        today = j["series"][-1]
        self.assertEqual((today["calls_per_turn"], today["peak_prompt_avg"], today["tool_out_per_turn"], today["pruned"], today["first_tool_p50"], today["turns_v2"]), (3.0, 7000.0, 2000.0, 1, 4.0, 2))
        self.assertAlmostEqual(today["cached_ratio"], 6000 / 39000)
        self.assertEqual(j["ui"], {"suggestion": 2, "attach": 1})
        self.assertEqual(j["feedback"], {"up": 1, "down": 2, "reasons": {"slow": 1, "none": 1}})
        h = slurp(os.path.join(self.out, "index.html"))
        for frag in ("Tính năng được dùng", "Bấm gợi ý trên màn hình chào", "Phản hồi của người dùng", "Chậm", "Token đi đâu"):
            self.assertIn(frag, h)

    def test_empty_data_still_renders(self):
        S.run(self.diag, self.log, self.out, os.path.join(self.tmp.name, "none.json"), NOW)
        h = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Quản trị Hando", h)
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
