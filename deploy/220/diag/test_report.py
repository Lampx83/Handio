"""Kiểm thử báo cáo chất lượng với dữ liệu tổng hợp:  python3 -m unittest discover -s deploy/220/diag -p 'test_*.py'"""
import datetime
import gzip
import json
import os
import random
import tempfile
import unittest

import report as R

NOW = datetime.datetime(2026, 10, 8, 12, 0, tzinfo=datetime.timezone.utc)
T_NOW = NOW.timestamp()
APP = {"install": "0123456789abcdef0123456789abcdef", "version": "0.1.0", "platform": "web", "profile": "code", "model": "qwen"}


def rec(ts, e, uid="u1", app=None, lost=None):
    r = {"ts_srv": int(ts), "uid": uid, "a": app or APP, "e": dict(e, ts=int(ts))}
    if lost:
        r["lost"] = lost
    return r


def turn_ev(end="ok", **kw):
    e = {"t": "turn", "end": end, "dur_s": 20, "ttft_ms": 1500, "steps": 3, "tools": 2, "tool_fail": 0, "prompt_tok": 1000, "completion_tok": 100, "ctx_pct": 30}
    e.update(kw)
    return e


def write_diag(d, recs):
    by = {}
    for r in recs:
        by.setdefault(datetime.datetime.fromtimestamp(r["ts_srv"], datetime.timezone.utc).strftime("%Y-%m-%d"), []).append(r)
    for day, rs in by.items():
        with open(os.path.join(d, day + ".jsonl"), "w") as f:
            for r in rs:
                f.write(json.dumps(r) + "\n")


def nginx_row(ts, status=200, route="vllm_chat", rt=5.0, urt="4.9"):
    return {"ts": datetime.datetime.fromtimestamp(ts, R.TZ).isoformat(), "status": status, "method": "POST", "route": route, "rt": rt, "urt": urt, "bytes": 100}


def healthy_baseline(rnd, days=7, per_day=40):
    out = []
    for dday in range(1, days + 1):
        for i in range(per_day):
            ts = T_NOW - dday * 86400 - 5000 - i * 100
            out.append(rec(ts, turn_ev("error" if rnd.random() < 0.01 else "ok", dur_s=rnd.randint(5, 40), ttft_ms=rnd.randint(500, 3000)), uid="u%d" % (i % 8)))
            out.append(rec(ts, {"t": "tool", "name": "read_file", "ok": True, "dur": "lt1s"}))
    return out


def sick_window(rnd, n=100):
    out = []
    for i in range(n):
        ts = T_NOW - 3600 - i * 60
        uid = "u%d" % (i % 10)
        end = "error" if i % 5 == 0 else ("step_limit" if i % 12 == 0 else ("loop" if i % 7 == 0 else "ok"))
        out.append(rec(ts, turn_ev(end, ttft_ms=25000 if i % 4 == 0 else 2000, dur_s=250 if i % 4 == 0 else 20, ctx_pct=90 if i % 6 == 0 else 20), uid=uid, app=dict(APP, version="0.2.0") if i % 2 else APP))
        if end == "error":
            out.append(rec(ts, {"t": "llm_error", "kind": "server", "status": 503}, uid=uid))
        out.append(rec(ts, {"t": "tool", "name": "bash", "ok": i % 3 == 0, "dur": "lt5s"}, uid=uid))
        if end == "loop":
            out.append(rec(ts, {"t": "signal", "code": "loop", "tool": "list_dir", "n": 3}, uid=uid))
        if i % 10 == 0:
            out.append(rec(ts, {"t": "signal", "code": "empty_output"}, uid=uid))
    out.append(rec(T_NOW - 100, {"t": "report", "note": "x"}))
    return out


class StatsTests(unittest.TestCase):
    def test_percentile(self):
        self.assertEqual(R.pct([1, 2, 3, 4, 5], 50), 3)
        self.assertEqual(R.pct([10], 95), 10)
        self.assertIsNone(R.pct([], 50))
        self.assertAlmostEqual(R.pct([0, 10], 95), 9.5)

    def test_nginx_urt_forms(self):
        self.assertEqual(R._last_num("0.123"), 0.123)
        self.assertEqual(R._last_num("0.100, 0.250"), 0.25)
        self.assertIsNone(R._last_num("-"))
        self.assertIsNone(R._last_num(""))

    def test_summarize(self):
        recs = [rec(T_NOW - 10, turn_ev("ok")), rec(T_NOW - 9, turn_ev("error")), rec(T_NOW - 8, {"t": "llm_error", "kind": "rate", "status": 429}), rec(T_NOW - 7, {"t": "tool", "name": "bash", "ok": False, "dur": "lt1s"}),
                rec(T_NOW - 6, {"t": "tool", "name": "bash", "ok": True, "dur": "lt1s"}, uid="u2"), rec(T_NOW - 5, {"t": "signal", "code": "loop", "tool": "bash", "n": 3}, lost=7)]
        rows = [nginx_row(T_NOW - 10, 200, rt=10, urt="9.5"), nginx_row(T_NOW - 9, 200, rt=20, urt="19, 18"), nginx_row(T_NOW - 8, 503, rt=1), nginx_row(T_NOW - 7, 429), nginx_row(T_NOW - 6, 401), nginx_row(T_NOW - 5, 200, route="ui"), nginx_row(T_NOW - 4, 400, route="diag")]
        for r in rows:
            r["_ts"] = T_NOW
        S = R.summarize(recs, rows)
        self.assertEqual((S["turns"], S["users"], S["lost_events"]), (2, 2, 7))
        self.assertEqual(S["rates"]["error"], 0.5)
        self.assertEqual(S["tools"]["bash"], {"calls": 2, "fails": 1})
        self.assertEqual(S["llm_errors_by_kind"], {"rate": 1})
        self.assertEqual(S["llm_errors_by_status"], {"429": 1})
        self.assertEqual(S["signals_by_tool"], {"loop:bash": 1})
        v = S["nginx"]["vllm"]
        self.assertEqual(v["n"], 5)
        self.assertAlmostEqual(v["rate_5xx"], 0.2)
        self.assertEqual(v["rt_s"]["p50"], 15)  # chỉ tính các lệnh 200
        self.assertEqual(v["urt_s"]["p50"], (9.5 + 18) / 2)
        self.assertEqual(S["nginx"]["diag"], {"n": 1, "rate_rejected": 1.0})


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.diag = os.path.join(self.d, "diag")
        os.makedirs(self.diag)
        self.log = os.path.join(self.d, "neu-agent-access.json.log")
        self.out = os.path.join(self.d, "reports")

    def tearDown(self):
        self.tmp.cleanup()

    def run_report(self, **kw):
        W, B, fs, an, lt, le = R.build(self.diag, self.log, NOW, R.THRESHOLDS, **kw)
        return W, B, fs, an, lt, le

    def test_sick_day_triggers_findings_and_anomalies(self):
        rnd = random.Random(1)
        write_diag(self.diag, healthy_baseline(rnd) + sick_window(rnd))
        rows = [nginx_row(T_NOW - 7200 + i * 30, 503 if i % 10 == 0 else 200, rt=95 if i % 3 == 0 else 8) for i in range(120)]
        rows += [nginx_row(T_NOW - 3 * 86400 + i * 30, 200, rt=8) for i in range(120)]
        with open(self.log, "w") as f:
            f.write("\n".join(json.dumps(r) for r in rows) + "\nnot json\n")
        W, B, fs, an, _, _ = self.run_report()
        ids = {f["id"] for f in fs}
        self.assertTrue({"turn_errors", "step_limit", "loop", "tool_fail", "latency", "gateway_5xx", "context", "empty_output"} <= ids, ids)
        self.assertEqual(fs[0]["sev"], "cao")
        self.assertEqual([f["sev"] for f in fs], sorted((f["sev"] for f in fs), key=lambda s: R.SEV_ORDER[s]))  # sắp theo mức độ
        whats = " | ".join(a["what"] for a in an)
        self.assertIn("tỷ lệ lượt lỗi", whats)
        self.assertIn("mới xuất hiện", " ".join(a["kind"] for a in an))
        self.assertIn("phiên bản 0.2.0", whats)
        self.assertIn("công cụ thất bại bash", whats)
        self.assertEqual(W["turns"], 100)
        self.assertEqual(B["turns"], 280)

    def test_work_profile_rules(self):
        """Quy tắc: làm lại nhiều → rework; bộ khung kiểm chứng hỏng nhiều → verify_fail. Không dựa vào nội dung."""
        T = R.DEFAULT_THRESHOLDS if hasattr(R, "DEFAULT_THRESHOLDS") else None
        turns = [turn_ev(kind="build", stack="react", ui="chakra", nth=1, verify="fail") for _ in range(6)]
        turns += [turn_ev(kind="fix", stack="react", ui="chakra", nth=2 + i % 3, redo=True, verify="fail") for i in range(8)]
        turns += [turn_ev(kind="edit", stack="vite", ui="none", nth=2, verify="pass") for _ in range(4)]
        W = R.summarize([rec(T_NOW - 100, t) for t in turns], [])
        self.assertEqual(W["work"]["kind"]["fix"]["redo"], 8)
        self.assertEqual(W["work"]["chat_turns"], {"first": 6, "later": 12})
        thr = T or {"min_turns": 5}
        ids = {f["id"] for f in [x for x in (R.rule_rework(W, thr), R.rule_verify_fail(W, thr)) if x]}
        self.assertEqual(ids, {"rework", "verify_fail"})
        names = [t[0] for t in R.tables(W)]
        self.assertIn("Công việc người dùng làm (chỉ mã, không nội dung)", names)

    def test_healthy_day_has_no_findings(self):
        rnd = random.Random(2)
        recs = healthy_baseline(rnd, days=8, per_day=60)
        # cửa sổ 24h cuối cũng khoẻ
        for i in range(60):
            recs.append(rec(T_NOW - 3600 - i * 60, turn_ev("ok"), uid="u%d" % (i % 8)))
        write_diag(self.diag, recs)
        _, _, fs, an, _, _ = self.run_report()
        self.assertEqual([f["title"] for f in fs], [])
        self.assertEqual(an, [])

    def test_small_samples_dont_conclude(self):
        write_diag(self.diag, [rec(T_NOW - 100, turn_ev("error")) for _ in range(5)])
        _, _, fs, _, _, _ = self.run_report()
        self.assertNotIn("turn_errors", {f["id"] for f in fs})

    def test_no_data_finding(self):
        _, _, fs, _, _, _ = self.run_report()
        self.assertEqual([f["id"] for f in fs], ["no_data"])

    def test_output_files(self):
        rnd = random.Random(3)
        write_diag(self.diag, healthy_baseline(rnd) + sick_window(rnd))
        W, B, fs, an, _, _ = self.run_report()
        os.makedirs(self.out)
        for old in ("2026-10-07.html", "2026-01-01.html", "2026-01-01.md"):
            open(os.path.join(self.out, old), "w").close()
        path = R.write_reports(self.out, "2026-10-08", W, B, fs, an, "- gợi ý <script>alert(1)</script>", None)
        names = set(os.listdir(self.out))
        self.assertTrue({"2026-10-08.md", "2026-10-08.html", "latest.html", "latest.md", "latest.json", "2026-10-07.html"} <= names)
        self.assertNotIn("2026-01-01.html", names)  # quá 90 ngày: xoá
        self.assertEqual(path, os.path.join(self.out, "2026-10-08.html"))
        with open(path, encoding="utf-8") as f:
            h = f.read()
        self.assertIn("Phát hiện &amp; đề xuất cải tiến", h)
        self.assertNotIn("<script>", h)  # thoát HTML
        self.assertNotRegex(h, r"(src|href)=\"https?:")  # không tài nguyên ngoài
        self.assertNotIn("<link", h)
        self.assertIn("2026-10-07.html", h)
        with open(os.path.join(self.out, "2026-10-08.md"), encoding="utf-8") as f:
            md = f.read()
        self.assertIn("## Phát hiện & đề xuất cải tiến", md)
        self.assertIn("[CAO]", md)
        self.assertEqual(oct(os.stat(path).st_mode & 0o777), oct(0o640))
        with open(os.path.join(self.out, "latest.json"), encoding="utf-8") as fh:
            json.load(fh)

    def test_reads_rotated_and_gz_nginx_logs(self):
        row = nginx_row(T_NOW - 100, 200)
        with open(self.log, "w") as f:
            f.write(json.dumps(row) + "\n")
        with gzip.open(self.log + ".2.gz", "wt") as f:
            f.write(json.dumps(nginx_row(T_NOW - 200, 503)) + "\n")
        rows = R.load_nginx(self.log, T_NOW - 86400, T_NOW)
        self.assertEqual(sorted(r["status"] for r in rows), [200, 503])

    def test_window_boundaries(self):
        write_diag(self.diag, [rec(T_NOW - 86400 - 1, turn_ev()), rec(T_NOW - 86400, turn_ev()), rec(T_NOW, turn_ev())])
        W, B, *_ = self.run_report()
        self.assertEqual((W["turns"], B["turns"]), (1, 1))  # [t-24h, t) và (trước đó)


class LlmTests(unittest.TestCase):
    def test_llm_input_has_only_numbers(self):
        rnd = random.Random(4)
        recs = healthy_baseline(rnd) + sick_window(rnd)
        recs.append(rec(T_NOW - 50, {"t": "report", "note": "BI MAT: luong cua Alice alice@neu.edu.vn"}))
        recs.append(rec(T_NOW - 50, {"t": "signal", "code": "loop", "tool": "sk-LIVE-SECRET"}, app=dict(APP, model="sk-LIVE-SECRET")))
        with tempfile.TemporaryDirectory() as d:
            write_diag(d, recs)
            W, B, fs, an, _, _ = R.build(d, None, NOW, R.THRESHOLDS)
        data = R.llm_input(W, B, fs, an)
        js = json.dumps(data, ensure_ascii=False)
        self.assertNotIn("BI MAT", js)
        self.assertNotIn("alice", js.lower())
        self.assertNotIn("Alice", js)

        def only_numbers(o):
            if isinstance(o, dict):
                return all(isinstance(k, str) and only_numbers(v) for k, v in o.items())
            if isinstance(o, list):
                return all(only_numbers(v) for v in o)
            return isinstance(o, (int, float, bool))

        self.assertTrue(only_numbers(data))
        self.assertNotIn("uid", js)
        self.assertNotIn("sk-LIVE", js)

    def test_numeric_only_drops_strings_and_bad_keys(self):
        self.assertEqual(R.numeric_only({"a": 1, "b": "secret", "c d": 2, "e": {"f": "x", "g": 1.23456789}, "h": [1, "z", 2]}), {"a": 1, "e": {"g": 1.2346}, "h": [1, 2]})

    def test_llm_failure_is_not_fatal_and_text_is_embedded(self):
        orig = R.call_llm
        try:
            R.call_llm = lambda *a, **k: (_ for _ in ()).throw(OSError("no route"))
            with tempfile.TemporaryDirectory() as d:
                W, B, fs, an, lt, le = R.build(d, None, NOW, R.THRESHOLDS, llm={"url": "http://x", "model": "m", "key": "k"})
            self.assertEqual((lt, le), (None, "OSError"))
            seen = {}

            def fake(data, url, model, key):
                seen.update(data=data, url=url, model=model, key=key)
                return "- Gợi ý: kiểm tra Kong"

            R.call_llm = fake
            with tempfile.TemporaryDirectory() as d:
                W, B, fs, an, lt, le = R.build(d, None, NOW, R.THRESHOLDS, llm={"url": "http://gw", "model": "m", "key": "k"})
            self.assertEqual(lt, "- Gợi ý: kiểm tra Kong")
            self.assertEqual(seen["url"], "http://gw")
            self.assertIn("Gợi ý của mô hình", R.render_md("2026-10-08", W, B, fs, an, lt, le, []))
        finally:
            R.call_llm = orig


class CliTests(unittest.TestCase):
    def test_main_end_to_end(self):
        rnd = random.Random(5)
        with tempfile.TemporaryDirectory() as d:
            diag = os.path.join(d, "diag")
            os.makedirs(diag)
            write_diag(diag, healthy_baseline(rnd) + sick_window(rnd))
            thr = os.path.join(d, "t.json")
            with open(thr, "w") as f:
                json.dump({"turn_error_rate": 0.9, "turn_error_rate_high": 0.95, "bogus": 1}, f)
            rc = R.main(["--diag-dir", diag, "--nginx-log", os.path.join(d, "none.log"), "--out", os.path.join(d, "out"), "--now", str(T_NOW), "--thresholds", thr])
            self.assertEqual(rc, 0)
            with open(os.path.join(d, "out", "latest.json"), encoding="utf-8") as fh:
                j = json.load(fh)
            self.assertNotIn("turn_errors", {f["id"] for f in j["findings"]})  # ngưỡng đã được nâng lên


if __name__ == "__main__":
    unittest.main()


class GenerationFaultRule(unittest.TestCase):
    def test_flags_truncated_and_repeating_generation(self):
        S = {"turns": 100, "signals": {"args_truncated": 3, "text_repeat": 2}}
        T = dict(R.THRESHOLDS)
        f = R.rule_generation_faults(S, T)
        self.assertEqual(f["id"], "generation_faults")
        self.assertIn("3", f["evidence"])
        self.assertIn("write_file", f["suggestion"])

    def test_quiet_when_rare(self):
        T = dict(R.THRESHOLDS)
        self.assertIsNone(R.rule_generation_faults({"turns": 100, "signals": {"args_truncated": 1}}, T))
        self.assertIsNone(R.rule_generation_faults({"turns": 1000, "signals": {"text_repeat": 5}}, T))
