"""Kiểm thử cảnh báo chủ động:  python3 -m unittest discover -s deploy/220/diag -p 'test_*.py'"""
import json
import os
import tempfile
import unittest

import alerts as A

NOW = 1_800_000_000.0


def stats(**kw):
    s = {"kpi": {"turns_24h": 100, "errors_24h": 5, "error_rate_24h": 0.05, "turns_7d": 700}, "recent": {"chat_24h": 400, "chat_5xx_24h": 2}, "quota": {"blocked_users": 0, "blocked_requests": 0},
         "system": {"newest_event_age_s": 60}}
    for k, v in kw.items():
        s[k].update(v) if isinstance(v, dict) else s.__setitem__(k, v)
    return s


class Evaluate(unittest.TestCase):
    def keys(self, st, health=None, **kw):
        return {a["key"] for a in A.evaluate(st, health or {"ok": True, "failed": []}, NOW, **kw)}

    def test_healthy_has_no_alerts(self):
        self.assertEqual(self.keys(stats()), set())

    def test_thresholds(self):
        self.assertEqual(self.keys(stats(kpi={"error_rate_24h": 0.30, "errors_24h": 30})), {"turn_errors"})
        self.assertEqual(self.keys(stats(kpi={"turns_24h": 10, "error_rate_24h": 0.9})), set(), "ít lượt: không kết luận")
        self.assertEqual(self.keys(stats(recent={"chat_5xx_24h": 40})), {"gateway_5xx"})
        self.assertEqual(self.keys(stats(recent={"chat_24h": 10, "chat_5xx_24h": 10})), set(), "ít lệnh: không kết luận")
        self.assertEqual(self.keys(stats(quota={"blocked_users": 6, "blocked_requests": 20})), {"quota_blocked"})
        self.assertEqual(self.keys(stats(system={"newest_event_age_s": 8 * 3600})), {"data_stale"})
        self.assertEqual(self.keys(stats(), {"ok": False, "failed": ["disk", "gateway"]}), {"health"})
        self.assertEqual(self.keys(stats(), health_age=3600), {"health_stale"})
        self.assertEqual(self.keys(stats(), stats_age=7200), {"stats_stale"})
        self.assertEqual({a["key"] for a in A.evaluate(None, None, NOW)}, {"stats_missing"})

    def test_text_has_only_aggregates(self):
        st = stats(kpi={"error_rate_24h": 0.30, "errors_24h": 30})
        st["users"] = [{"id": "deadbeef"}]
        txt = A.message(*A.decide(A.evaluate(st, {"ok": False, "failed": ["disk"]}, NOW), {}, NOW)[:2])
        self.assertIn("30%", txt)
        self.assertNotIn("deadbeef", txt)
        self.assertNotIn("@", txt)


    def test_health_json_format_names_failed_checks(self):
        h = {"ts": 1, "ok": False, "checks": {"disk": {"ok": False, "detail": "x"}, "oauth2": {"ok": True}}, "warn": []}
        a = A.evaluate(stats(), h, NOW)
        self.assertEqual([x["key"] for x in a], ["health"])
        self.assertIn("disk", a[0]["text"])
        self.assertNotIn("không rõ", a[0]["text"])


class Backup(unittest.TestCase):
    """Sao lưu dữ liệu: healthz ghi checks.backup (chỉ số), alerts báo theo nguyên nhân; không lẫn vào cảnh báo "health"."""

    def ev(self, b):
        return A.evaluate(stats(), {"ok": True, "checks": {"disk": {"ok": True}, "backup": b}, "warn": [] if b["ok"] else ["backup"]}, NOW)

    def test_ok_no_alert(self):
        self.assertEqual(self.ev({"ok": True, "reason": "ok", "age_h": 5.0}), [])

    def test_reasons(self):
        for reason, key, needle in (("failed", "backup_failed", "26 giờ"), ("stale", "backup_stale", "40 giờ"),
                                    ("push_failed", "backup_push", "máy ngoài"), ("unreadable", "backup_status", "trạng thái")):
            with self.subTest(reason=reason):
                age = 40.2 if reason == "stale" else 26.0
                a = self.ev({"ok": False, "reason": reason, "age_h": age})
                self.assertEqual([x["key"] for x in a], [key])
                self.assertIn(needle, a[0]["text"])

    def test_failed_never_succeeded(self):
        a = self.ev({"ok": False, "reason": "failed", "age_h": None})
        self.assertIn("chưa có bản nào", a[0]["text"])

    def test_resolves_when_backup_ok_again(self):
        fire, done, st = A.decide(self.ev({"ok": False, "reason": "stale", "age_h": 40}), {}, NOW)
        self.assertEqual(len(fire), 1)
        fire, done, st = A.decide(self.ev({"ok": True, "reason": "ok", "age_h": 1}), st, NOW + 600)
        self.assertEqual([d["key"] for d in done], ["backup_stale"])


class Decide(unittest.TestCase):
    def test_first_repeat_after_cooldown_and_resolve(self):
        a = [{"key": "turn_errors", "sev": "cao", "text": "x"}]
        fire, done, st = A.decide(a, {}, NOW)
        self.assertEqual((len(fire), len(done)), (1, 0))
        fire, done, st2 = A.decide(a, st, NOW + 600)
        self.assertEqual((len(fire), len(done)), (0, 0), "chưa hết thời gian chờ: không nhắc lại")
        self.assertEqual(st2["firing"]["turn_errors"]["since"], NOW)
        fire, done, st3 = A.decide(a, st2, NOW + A.COOLDOWN_S + 1)
        self.assertEqual(len(fire), 1)
        fire, done, st4 = A.decide([], st3, NOW + A.COOLDOWN_S + 700)
        self.assertEqual([d["key"] for d in done], ["turn_errors"])
        self.assertEqual(st4, {"firing": {}})
        self.assertEqual(A.decide([], st4, NOW + 99999)[:2], ([], []), "đã báo hết một lần thì thôi")


class Webhook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.old = os.environ.pop("CREDENTIALS_DIRECTORY", None)
        self.addCleanup(lambda: os.environ.__setitem__("CREDENTIALS_DIRECTORY", self.old) if self.old is not None else None)

    def write(self, name, content):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return p

    def test_only_https_without_whitespace(self):
        self.assertEqual(A.read_webhook(self.write("a", "https://hooks.example.vn/x?y=1\n")), "https://hooks.example.vn/x?y=1")
        for bad in ("http://hooks.example.vn/x", "ftp://x", "https://a b", "", "https://x\nhttps://y", "javascript:alert(1)"):
            self.assertIsNone(A.read_webhook(self.write("b", bad)), repr(bad))
        self.assertIsNone(A.read_webhook(os.path.join(self.tmp.name, "khong-co")))

    def test_run_sends_once_and_keeps_state_when_send_fails(self):
        st, hl, state = self.write("stats.json", json.dumps(stats(kpi={"error_rate_24h": 0.5, "errors_24h": 50}))), self.write("health.json", '{"ok": true}'), os.path.join(self.tmp.name, "al", "state.json")
        os.utime(st, (NOW, NOW))
        os.utime(hl, (NOW, NOW))
        sent = []
        r = A.run(st, hl, state, "https://hooks.example.vn/x", NOW, sender=lambda u, t: sent.append((u, t)) or True)
        self.assertEqual((r["sent"], len(sent)), (True, 1))
        self.assertIn("turn_errors", json.load(open(state))["firing"])
        r = A.run(st, hl, state, "https://hooks.example.vn/x", NOW + 60, sender=lambda u, t: sent.append((u, t)) or True)
        self.assertEqual(len(sent), 1, "không gửi lặp trong thời gian chờ")
        # gửi lỗi: trạng thái không đổi nên lần sau thử lại
        os.remove(state)
        def boom(u, t):
            raise OSError("mạng")
        r = A.run(st, hl, state, "https://hooks.example.vn/x", NOW, sender=boom)
        self.assertEqual(r["sent"], False)
        self.assertFalse(os.path.exists(state))
        # chưa cấu hình webhook: không gửi, vẫn ghi trạng thái, không lỗi
        r = A.run(st, hl, state, None, NOW, sender=boom)
        self.assertIsNone(r["sent"])
        self.assertTrue(os.path.exists(state))

    def test_dry_run_writes_nothing(self):
        st = self.write("stats.json", json.dumps(stats(kpi={"error_rate_24h": 0.5, "errors_24h": 50})))
        state = os.path.join(self.tmp.name, "state.json")
        r = A.run(st, os.path.join(self.tmp.name, "none.json"), state, "https://hooks.example.vn/x", NOW, dry_run=True, sender=lambda u, t: 1 / 0)
        self.assertTrue(r["alerts"])
        self.assertFalse(os.path.exists(state))


class HealthChecks(unittest.TestCase):
    """Cảnh báo từ health.json do healthz.py ghi (checks + warn)."""
    def ev(self, checks, ok=None):
        h = {"ok": all(c["ok"] for c in checks.values()) if ok is None else ok, "checks": checks, "warn": [k for k, c in checks.items() if c["ok"] and c.get("warn")]}
        return {a["key"]: a for a in A.evaluate(stats(), h, NOW)}

    def test_failed_components_are_named(self):
        # health.json có "checks", không có "failed": trước đây tin luôn ghi "không rõ thành phần"
        a = self.ev({"chat": {"ok": False, "detail": "HTTP 502"}, "disk": {"ok": False, "detail": "free min 3% LOW:/var/log"}, "oauth2": {"ok": True}})
        self.assertEqual(set(a), {"health"})
        t = a["health"]["text"]
        self.assertIn("chat (HTTP 502)", t)
        self.assertIn("disk", t)
        self.assertNotIn("/var/log", t, "không đưa đường dẫn vào tin")

    def test_expiry_warnings_are_medium_and_remind_daily(self):
        a = self.ev({"tls": {"ok": True, "warn": True, "days": 12, "detail": "chứng chỉ HTTPS còn 12 ngày"},
                     "entra_secret": {"ok": True, "warn": True, "days": 20, "detail": "secret Entra còn 20 ngày"}, "chat": {"ok": True}})
        self.assertEqual(set(a), {"tls_expiring", "entra_secret_expiring"})
        self.assertEqual({x["sev"] for x in a.values()}, {"trung bình"})
        self.assertIn("12 ngày", a["tls_expiring"]["text"])
        self.assertIn("20 ngày", a["entra_secret_expiring"]["text"])
        al = list(a.values())
        fire, _, st = A.decide(al, {}, NOW)
        self.assertEqual(len(fire), 2)
        self.assertEqual(A.decide(al, st, NOW + 7 * 3600)[0], [], "cảnh báo hạn: nhắc mỗi ngày một lần, không phải 6 giờ")
        self.assertEqual(len(A.decide(al, st, NOW + 25 * 3600)[0]), 2)

    def test_expired_is_high(self):
        a = self.ev({"tls": {"ok": False, "warn": False, "days": -1, "detail": "x"}, "entra_secret": {"ok": False, "warn": False, "days": -3, "detail": "x"}})
        self.assertEqual(set(a), {"tls_expired", "entra_secret_expired"}, "không lặp thêm cảnh báo 'health' chung")
        self.assertEqual({x["sev"] for x in a.values()}, {"cao"})

    def test_cannot_check_is_reported(self):
        a = self.ev({"tls": {"ok": True, "warn": True, "detail": "không kết nối được (ConnectionRefusedError)"},
                     "entra_secret": {"ok": True, "warn": True, "detail": "tệp hạn secret sai định dạng (cần YYYY-MM-DD)"},
                     "chat": {"ok": True, "warn": True, "detail": "chưa có key mô hình (chạy lại install-diag.sh)"}})
        self.assertEqual(set(a), {"tls_unchecked", "entra_secret_unchecked", "chat_unchecked"})
        self.assertIn("YYYY-MM-DD", a["entra_secret_unchecked"]["text"])

    def test_texts_have_no_host_or_ip(self):
        a = self.ev({"tls": {"ok": True, "warn": True, "days": 5, "detail": "ai.example.vn@192.0.2.22"}, "chat": {"ok": False, "detail": "x@192.0.2.22"}})
        txt = A.message(list(a.values()), [])
        for bad in ("example", "192.0.2", "@"):
            self.assertNotIn(bad, txt)


if __name__ == "__main__":
    unittest.main()
