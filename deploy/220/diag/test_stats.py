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

    def only_admin_js(self, page):
        """Không có script nhúng; thẻ script duy nhất là tệp admin.js cùng nguồn (CSP script-src 'self')."""
        import re
        tags = re.findall(r"<script[^>]*>.*?</script>", page.lower(), flags=re.S)
        self.assertTrue(all(t == '<script src="admin.js" defer></script>' for t in tags), tags)

    def write_log(self, rows):
        with open(self.log, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    def test_work_profile_by_kind_stack_and_redo(self):
        """Hồ sơ công việc (chỉ mã) gom được theo loại việc/bộ khung, tính tỷ lệ nói chưa đạt và kiểm chứng hỏng; bản cũ không có trường thì bị bỏ qua."""
        recs = [rec(day_ts(0, h), turn_ev(kind="build", stack="react", ui="chakra", art="web", nth=1, verify="pass", files_new=3)) for h in range(1, 4)]
        recs += [rec(day_ts(0, 4), turn_ev(kind="fix", stack="react", ui="chakra", art="web", nth=2, redo=True, verify="fail")),
                 rec(day_ts(0, 5), turn_ev(kind="fix", stack="react", ui="chakra", art="web", nth=3, redo=True, verify="fail")),
                 rec(day_ts(0, 6), turn_ev())]   # bản cũ: không có hồ sơ
        write_diag(self.diag, recs)
        S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        j = jload(os.path.join(self.out, "stats.json"))
        w = j["work"]
        kind = {r["value"]: r for r in w["kind"]}
        self.assertEqual(kind["build"]["turns"], 3)
        self.assertEqual(kind["fix"]["turns"], 2)
        self.assertEqual(kind["fix"]["redo_rate"], 1.0)
        self.assertEqual(kind["build"]["verify_fail_rate"], 0.0)
        st = {r["value"]: r for r in w["stack"]}
        self.assertEqual((st["react"]["turns"], st["react"]["verify_n"], st["react"]["verify_fail_rate"]), (5, 5, 0.4))
        self.assertEqual(st["react"]["files_new"], 9)
        self.assertEqual([r["value"] for r in w["nth"]], ["1", "2", "3–5"])
        page = slurp(os.path.join(self.out, "index.html"))
        self.assertIn("Công việc người dùng làm", page)

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
        self.only_admin_js(h)
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

    def test_range_pages_split_by_hour_and_by_day(self):
        recs = [rec(T_NOW - 1800, turn_ev(), uid="a" * 16), rec(T_NOW - 5 * 3600 - 600, turn_ev(), uid="a" * 16),      # trong 1 ngày
                rec(T_NOW - 30 * 3600, turn_ev(), uid="b" * 16),                                                       # trong 3 ngày, ngoài 1 ngày
                rec(day_ts(5), turn_ev(), uid="c" * 16),                                                               # trong 7 ngày, ngoài 3 ngày
                rec(day_ts(40), turn_ev(), uid="d" * 16)]                                                              # chỉ trong 90 ngày
        write_diag(self.diag, recs)
        self.write_log([nginx_row(T_NOW - 1800), nginx_row(T_NOW - 1900, 502), nginx_row(T_NOW - 30 * 3600)])
        S.run(self.diag, self.log, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        for name in ("index.html", "index-1d.html", "index-3d.html", "index-7d.html", "index-90d.html"):
            self.assertTrue(os.path.isfile(os.path.join(self.out, name)), name)
        h1, h30 = slurp(os.path.join(self.out, "index-1d.html")), slurp(os.path.join(self.out, "index.html"))
        self.assertIn("24 giờ gần nhất, theo giờ", h1)
        self.assertIn("Người dùng hoạt động mỗi giờ", h1)
        self.assertIn('class="on" aria-current="page">1 ngày</a>', h1)
        self.assertIn("30 ngày gần nhất", h30)
        self.assertIn("Người dùng hoạt động mỗi ngày", h30)
        self.assertIn('href="index-3d.html"', h30)                       # nút chọn khoảng có ở mọi trang
        # số liệu: tính trực tiếp từ dữ liệu đã ghi
        got = S.compute_all(R.load_diag(self.diag, T_NOW - 90 * 86400, T_NOW + 1), {}, NOW,
                            hourly=S.nginx_daily(R.load_nginx(self.log, T_NOW - 15 * 86400, T_NOW + 1), S.vn_hour))
        self.assertEqual({k: len(v["series"]) for k, v in got.items()}, {"1d": 24, "3d": 72, "7d": 7, "30d": 30, "90d": 90})
        self.assertEqual({k: v["range"]["turns"] for k, v in got.items()}, {"1d": 2, "3d": 3, "7d": 4, "30d": 4, "90d": 5})
        self.assertEqual({k: v["range"]["users"] for k, v in got.items()}, {"1d": 1, "3d": 2, "7d": 3, "30d": 3, "90d": 4})
        d1 = got["1d"]["series"]
        self.assertEqual((d1[-1]["day"], d1[0]["day"]), (S.vn_hour(T_NOW), S.vn_hour(T_NOW - 23 * 3600)))   # giờ VN, cũ → mới
        by_hour = {x["day"]: x for x in d1}
        self.assertEqual(by_hour[S.vn_hour(T_NOW - 1800)]["turns"], 1)
        self.assertEqual(by_hour[S.vn_hour(T_NOW - 5 * 3600 - 600)]["turns"], 1)
        self.assertEqual((by_hour[S.vn_hour(T_NOW - 1800)]["chat"], by_hour[S.vn_hour(T_NOW - 1800)]["chat_5xx"]), (2, 1))   # nginx theo giờ
        self.assertEqual(sum(x["chat"] for x in got["3d"]["series"]), 3)
        self.assertEqual(sum(x["chat"] for x in d1), 2)
        a = {u["id"]: u["turns30"] for u in got["1d"]["users"]}                                  # lượt tính theo khoảng đang xem
        self.assertEqual((a["a" * 8], a["b" * 8]), (2, 0))
        self.assertEqual({u["id"]: u["turns30"] for u in got["3d"]["users"]}["b" * 8], 1)
        self.assertEqual(sum(map(sum, got["1d"]["heat"])), 2)

    def test_quality_by_version_prev_period_and_marks(self):
        v1, v2 = dict(APP, version="0.1.0"), dict(APP, version="0.2.0")
        recs = []
        for i in range(30):                                                       # kỳ trước (7 ngày: 7–14 ngày trước), bản 0.1.0: 10% lỗi
            recs.append(rec(day_ts(8 + i % 5, 2 + i % 3), turn_ev("error" if i % 10 == 0 else "ok", dur_s=10), uid="a%015d" % (i % 4), app=v1))
        for i in range(40):                                                       # khoảng hiện tại, bản 0.2.0 xuất hiện ở ngày thứ 3: 50% lỗi
            recs.append(rec(day_ts(i % 3, 2 + i % 3), turn_ev("error" if i % 2 == 0 else "ok", dur_s=90), uid="b%015d" % (i % 4), app=v2))
        recs += [rec(day_ts(3, 4), turn_ev(), uid="a%015d" % (i % 4), app=v1) for i in range(12)]
        write_diag(self.diag, recs)
        got = S.compute_all(R.load_diag(self.diag, T_NOW - 90 * 86400, T_NOW + 1), {}, NOW, keys=("7d",))["7d"]
        q = {r["value"]: r for r in got["quality"]["version"]}
        self.assertEqual(q["0.2.0"]["turns"], 40)
        self.assertAlmostEqual(q["0.2.0"]["error_rate"], 0.5)
        self.assertEqual(q["0.2.0"]["dur_p95"], 90)
        self.assertEqual(q["0.1.0"]["turns"], 12)                                  # chỉ các lượt trong khoảng, không lẫn kỳ trước
        self.assertIsNotNone(got["prev_series"])
        self.assertEqual(sum(x["turns"] for x in got["prev_series"]), 30)
        self.assertEqual(got["range"]["prev"]["turns"], 30)
        self.assertEqual(len(got["prev_series"]), len(got["series"]))
        self.assertEqual(got["version_first"]["0.2.0"], S.vn_day(min(r["ts_srv"] for r in recs if r["a"]["version"] == "0.2.0")))
        self.assertEqual(got["version_first"]["0.1.0"], S.vn_day(min(r["ts_srv"] for r in recs if r["a"]["version"] == "0.1.0")))
        out = S.compute_all(R.load_diag(self.diag, T_NOW - 90 * 86400, T_NOW + 1), {}, NOW, keys=("90d",))["90d"]
        self.assertIsNone(out["prev_series"], "kỳ trước vượt thời hạn giữ dữ liệu: không có")
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        h = slurp(os.path.join(self.out, "index-7d.html"))
        self.assertIn("Chất lượng theo phiên bản", h)
        self.assertIn("so với kỳ trước", h)
        self.assertIn('class="pv"', h)                                             # đường kỳ trước vẽ ra

    def test_tool_error_rate_ignores_versions_without_error_codes(self):
        old, new = dict(APP, version="0.1.0"), dict(APP, version="0.9.0")
        tool = lambda ok, err=None: {"t": "tool", "name": "bash", "ok": ok, "dur": "lt1s", **({"err": err} if err else {})}
        recs = [rec(day_ts(0), tool(True), app=old) for _ in range(5)] + [rec(day_ts(0), tool(False), app=old) for _ in range(5)]          # bản cũ: lỗi không có mã
        recs += [rec(day_ts(0), tool(True), app=new) for _ in range(8)] + [rec(day_ts(0), tool(False, "not_found"), app=new), rec(day_ts(0), tool(False, "program"), app=new)]
        write_diag(self.diag, recs)
        j = S.compute(R.load_diag(self.diag, T_NOW - 90 * 86400, T_NOW + 1), {}, NOW)
        b = {x["name"]: x for x in j["tools"]}["bash"]
        self.assertEqual((b["calls"], b["rated"], b["fails"], b["prog"], b["unk"]), (20, 10, 1, 1, 5))
        self.assertEqual(j["tool_errors"], {"not_found": 1, "program": 1})        # không có "chưa rõ" của bản cũ
        self.assertEqual((j["tool_unknown"], j["tool_unknown_versions"]), (5, ["0.1.0"]))
        self.assertEqual(j["tool_reasons"], {"bash": {"not_found": 1, "program": 1}})

    def test_new_signals_ctx_perm_slow_tools_and_concentration(self):
        ev = lambda **kw: turn_ev(**dict({"steps": 4, "ctx_pct": 50, "compactions": 0, "perm_allow": 2, "perm_deny": 0, "prompt_tok": 100, "completion_tok": 10}, **kw))
        recs = [rec(day_ts(0, 2), ev(ctx_pct=90, compactions=1, perm_deny=1), uid="a" * 16), rec(day_ts(0, 3), ev(), uid="a" * 16),
                rec(day_ts(0, 3), ev(prompt_tok=5000), uid="b" * 16)] + [rec(day_ts(0), ev(prompt_tok=10), uid="%016d" % i) for i in range(10)]
        recs += [rec(day_ts(0), {"t": "tool", "name": "web_fetch", "ok": True, "dur": "lt30s"}) for _ in range(8)] + [rec(day_ts(0), {"t": "tool", "name": "web_fetch", "ok": True, "dur": "lt1s"}) for _ in range(4)]
        recs += [rec(day_ts(0), {"t": "signal", "code": "repeat_tool_fail", "tool": "bash", "n": 3}), rec(day_ts(0), {"t": "llm_error", "kind": "rate", "status": 429})]
        write_diag(self.diag, recs)
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        today = j["series"][-1]
        self.assertEqual((today["perm_allow"], today["perm_deny"], today["compactions"], today["ctx_n"], today["steps_p50"]), (26, 1, 1, 13, 4))
        self.assertAlmostEqual(today["ctx_hi_ratio"], 1 / 13)
        self.assertEqual(j["tool_slow"][0]["name"], "web_fetch")
        self.assertAlmostEqual(j["tool_slow"][0]["ratio"], 8 / 12)
        self.assertEqual(j["signals_by_tool"], [{"code": "repeat_tool_fail", "tool": "bash", "n": 1}])
        self.assertEqual(j["llm_status"], [{"kind": "rate", "status": 429, "n": 1}])
        c = j["concentration"]
        self.assertEqual((c["users"], c["top_n"]), (12, 2))
        self.assertGreater(c["top_share"], 0.9)
        h = slurp(os.path.join(self.out, "index.html"))
        for frag in ("Công cụ chạy chậm", "Hỏi quyền", "Tín hiệu theo công cụ", "Lỗi gọi mô hình theo mã HTTP", "Mức tập trung", "Ngữ cảnh gần đầy"):
            self.assertIn(frag, h)

    def test_anomalies_group_baseline_and_flag_outliers(self):
        row = lambda d, turns, err, chat=0, c5=0: {"day": d, "turns": turns, "errors": err, "error_rate": err / turns if turns else None, "dur_p95": 20.0, "chat": chat, "chat_5xx": c5}
        calm = [row("2026-10-%02d" % i, 40, 2) for i in range(1, 21)]
        calm[10] = row("2026-10-11", 40, 20)                                       # một ngày lỗi vọt 50%
        got = S.find_anomalies(calm, False)
        self.assertEqual([(a["idx"], a["kind"]) for a in got], [(10, "error")])
        base = [row("2026-10-%02d" % i, 40, 2, chat=100, c5=8) for i in range(1, 21)]  # 5xx 8% mọi ngày: mức nền, gộp một dòng
        got = S.find_anomalies(base, False)
        self.assertEqual([a["kind"] for a in got], ["5xx_base"])
        self.assertIsNone(got[0]["idx"])
        self.assertEqual(S.find_anomalies([row("2026-10-01", 5, 5)], False), [], "ít lượt: không kết luận")

    def test_default_page_matches_compute(self):
        write_diag(self.diag, [rec(day_ts(0), turn_ev(), uid="a" * 16), rec(day_ts(2), turn_ev("error"), uid="b" * 16)])
        j = S.run(self.diag, None, self.out, os.path.join(self.tmp.name, "h.json"), NOW)
        self.assertEqual(j["range"]["key"], "30d")
        self.assertEqual(len(j["series"]), 30)
        again = S.compute(R.load_diag(self.diag, T_NOW - 90 * 86400, T_NOW + 1), {}, NOW)
        self.assertEqual((again["kpi"], again["series"][-1]["turns"]), (j["kpi"], j["series"][-1]["turns"]))

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
            self.only_admin_js(page)
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
