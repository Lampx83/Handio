"""Kiểm thử sao lưu dữ liệu:  python3 -m unittest discover -s deploy/220/backup -p 'test_*.py'  (không cần root; gpg/age thật nếu có, thiếu thì bỏ qua bài đó).

Mọi đường dẫn hệ thống nằm dưới một thư mục tạm (NEU_BACKUP_PREFIX); systemctl và rsync là bản giả ghi lại lời gọi."""
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backup as B  # noqa: E402

GPG = shutil.which("gpg")
AGE = shutil.which("age")
SECRET = "0123456789abcdef" * 4
KEYS = {}
HTPASSWD = "khach01:$2b$12$6uU8iyrzPR5TDPA.F1mYJ.5HLjUN8.ynVbRqrP1MJarK1gQ/ZO/Hq\n"

FAKE_SYSTEMCTL = r'''#!/usr/bin/env python3
import os, sys
d = os.environ["FAKE_SYSTEMD"]
open(os.path.join(d, "calls.log"), "a").write(" ".join(sys.argv[1:]) + "\n")
a = [x for x in sys.argv[1:] if not x.startswith("--")]
unit = a[1] if len(a) > 1 else ""
act = os.path.join(d, "active", unit)
if a[0] == "is-active":
    sys.exit(0 if os.path.exists(act) else 3)
if a[0] == "stop":
    if os.path.exists(act): os.unlink(act)
elif a[0] == "start":
    if os.path.exists(os.path.join(d, "fail", unit)): sys.exit(1)
    open(act, "w").close()
'''
FAKE_RSYNC = r'''#!/usr/bin/env python3
import os, sys
d = os.environ["FAKE_SYSTEMD"]
open(os.path.join(d, "rsync.log"), "a").write("\0".join(sys.argv[1:]) + "\n")
sys.exit(int(os.environ.get("FAKE_RSYNC_RC", "0")))
'''


def gpg_short_home():
    return tempfile.mkdtemp(prefix="neu-t-", dir="/tmp" if os.path.isdir("/tmp") else None)   # gpg đặt socket trong thư mục: đường dẫn phải ngắn


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="neu-bk-")
        self.root = os.path.join(self.tmp, "root")
        self.fake = os.path.join(self.tmp, "fake")
        for d in ("active", "fail", "bin"):
            os.makedirs(os.path.join(self.fake, d))
        for p, body in (("bin/systemctl", FAKE_SYSTEMCTL), ("bin/rsync", FAKE_RSYNC)):
            with open(os.path.join(self.fake, p), "w") as f:
                f.write(body)
            os.chmod(os.path.join(self.fake, p), 0o755)
        self.env = {"NEU_BACKUP_PREFIX": self.root, "NEU_BACKUP_SYSTEMCTL": os.path.join(self.fake, "bin/systemctl"), "FAKE_SYSTEMD": self.fake}
        self.old_env = {k: os.environ.get(k) for k in list(self.env) + ["PATH", "FAKE_RSYNC_RC"]}
        os.environ.update(self.env)
        B.PREFIX, B.SYSTEMCTL = self.root, self.env["NEU_BACKUP_SYSTEMCTL"]

    def tearDown(self):
        for k, v in self.old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        B.PREFIX, B.SYSTEMCTL = "", "systemctl"
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- dữ liệu mẫu (giả, rõ ràng)
    def path(self, p):
        return self.root + p

    def write(self, p, data, mode=0o600):
        full = self.path(p)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb" if isinstance(data, bytes) else "w") as f:
            f.write(data)
        os.chmod(full, mode)

    def seed(self):
        for p in ("/var/lib/neu-agent/feedback/feedback.db", "/var/lib/neu-agent/feedback/shares.db"):
            os.makedirs(os.path.dirname(self.path(p)), exist_ok=True)
            db = sqlite3.connect(self.path(p))
            db.execute("CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, body TEXT)")
            db.executemany("INSERT INTO items(body) VALUES(?)", [("góp ý %d" % i,) for i in range(5)])
            db.commit()
            db.close()
        # CSDL hạn mức ở chế độ WAL, có người ghi đang mở và dữ liệu MỚI còn nằm trong -wal (chưa checkpoint)
        q = self.path("/var/lib/neu-agent/quota/usage.db")
        os.makedirs(os.path.dirname(q), exist_ok=True)
        self.writer = sqlite3.connect(q, isolation_level=None)
        self.writer.execute("PRAGMA journal_mode=WAL")
        self.writer.execute("PRAGMA wal_autocheckpoint=0")
        self.writer.execute("CREATE TABLE usage(day TEXT, user TEXT, tokens INT)")
        self.writer.execute("INSERT INTO usage VALUES('2026-10-15','u1',100)")
        self.writer.execute("INSERT INTO usage VALUES('2026-10-15','u2',250)")
        self.addCleanup(self.writer.close)
        self.assertTrue(os.path.getsize(q + "-wal") > 0)
        self.write("/var/lib/neu-agent/quota/grants.json", json.dumps({"days": {"2026-10-15": {"abcd": 1000}}, "audit": []}), 0o640)
        self.write("/var/lib/neu-agent/diag/users-seen.json", json.dumps({"users": {"a@neu.edu.vn": {"first": 1, "last": 2, "turns": 3}}}))
        self.write("/etc/neu-agent/users.htpasswd", HTPASSWD)
        self.write("/etc/neu-agent/diag-secret", SECRET + "\n")
        self.write("/etc/neu-agent/admins.txt", "# quản trị\na@neu.edu.vn\n", 0o640)
        self.write("/etc/neu-agent/quota.json", json.dumps({"tiers": {}}), 0o640)
        self.write("/var/lib/neu-agent-accounts/audit.jsonl", '{"op":"add","name":"khach01"}\n')

    def gpg_keys(self, fresh=False):
        """Cặp khoá gpg thử (tạo một lần cho cả bộ cho nhanh; fresh=True: cặp khác)."""
        if not GPG:
            self.skipTest("không có gpg")
        if fresh or "gpg" not in KEYS:
            home = gpg_short_home()
            try:
                r = subprocess.run(["gpg", "--batch", "--homedir", home, "--passphrase", "", "--quick-gen-key", "Sao luu thu <a@neu.edu.vn>",
                                    "default", "default", "never"], capture_output=True)
                self.assertEqual(r.returncode, 0, r.stderr)
                pub = subprocess.run(["gpg", "--homedir", home, "--armor", "--export"], capture_output=True).stdout
                sec = subprocess.run(["gpg", "--homedir", home, "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--armor",
                                      "--export-secret-keys"], capture_output=True).stdout
            finally:
                shutil.rmtree(home, ignore_errors=True)
            if fresh:
                return self._use_gpg(pub, sec)
            KEYS["gpg"] = (pub, sec)
        return self._use_gpg(*KEYS["gpg"])

    def _use_gpg(self, pub, sec):
        self.write(B.GPG_KEY, pub, 0o644)
        ident = os.path.join(self.tmp, "rieng-%d.asc" % len(os.listdir(self.tmp)))
        with open(ident, "wb") as f:
            f.write(sec)
        return ident

    def age_keys(self):
        if not AGE or not shutil.which("age-keygen"):
            self.skipTest("không có age")
        ident = os.path.join(self.tmp, "rieng.age")
        subprocess.run(["age-keygen", "-o", ident], check=True, capture_output=True)
        pub = subprocess.run(["age-keygen", "-y", ident], check=True, capture_output=True, text=True).stdout
        self.write(B.AGE_RECIPIENTS, "# khoá thử\n" + pub, 0o644)
        return ident

    def run_cmd(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = B.main(list(argv))
        return rc, buf.getvalue()

    def archives(self):
        return B.list_archives(self.path(B.OUT))

    def make_plain_tar(self, members, manifest=None, name="goi.tar.gz"):
        """Gói .tar.gz 'đã giải mã' tự dựng (verify/restore nhận dạng này): members = [(tên, bytes | TarInfo-tuỳ-chỉnh)]."""
        path = os.path.join(self.tmp, name)
        files = []
        with tarfile.open(path, "w:gz") as t:
            body = []
            for n, data in members:
                if isinstance(data, tarfile.TarInfo):
                    body.append((data, None))
                    continue
                ti = tarfile.TarInfo(n)
                ti.size = len(data)
                body.append((ti, data))
                files.append({"name": n, "kind": "x", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            m = json.dumps(manifest if manifest is not None else {"format": 1, "created": "2026-10-15T00:00:00Z", "files": files, "missing": []}).encode()
            mi = tarfile.TarInfo("manifest.json")
            mi.size = len(m)
            t.addfile(mi, io.BytesIO(m))
            for ti, data in body:
                t.addfile(ti, io.BytesIO(data) if data is not None else None)
        return path


class RunAndVerify(Base):
    def roundtrip(self, ident):
        self.seed()
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 0, out)
        arcs = self.archives()
        self.assertEqual(len(arcs), 1)
        arc = os.path.join(self.path(B.OUT), arcs[0])
        raw = B.read_bytes(arc)
        self.assertNotIn(SECRET.encode(), raw, "bí mật lộ dạng rõ trong bản sao lưu")
        self.assertNotIn(b"khach01", raw)
        self.assertNotEqual(raw[:2], b"\x1f\x8b", "chưa mã hoá")
        self.assertEqual(os.stat(arc).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.path(B.OUT)).st_mode & 0o777, 0o700)
        self.assertNotIn(SECRET, out)
        st = json.loads(B.read_text(os.path.join(self.path(B.OUT), "last.json")))
        self.assertTrue(st["ok"])
        self.assertEqual(st["files"], len(B.SOURCES))
        rc, out = self.run_cmd("verify", arc, "--identity", ident, "--keep")
        self.assertEqual(rc, 0, out)
        self.assertIn("THỬ KHÔI PHỤC: ĐẠT", out)
        stage = re.search(r"Đã giữ bản giải nén ở (\S+)", out).group(1)
        self.addCleanup(shutil.rmtree, os.path.dirname(stage), True)
        db = sqlite3.connect(os.path.join(stage, "quota/usage.db"))
        self.assertEqual(db.execute("SELECT SUM(tokens) FROM usage").fetchone()[0], 350, "thiếu dữ liệu còn trong -wal")
        self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        db.close()
        self.assertEqual(B.read_text(os.path.join(stage, "etc/diag-secret")).strip(), SECRET)
        return arc

    def test_gpg_roundtrip(self):
        self.roundtrip(self.gpg_keys())

    def test_age_roundtrip(self):
        self.roundtrip(self.age_keys())

    def test_wrong_key_fails_verify(self):
        self.gpg_keys()
        self.seed()
        self.assertEqual(self.run_cmd("run")[0], 0)
        arc = os.path.join(self.path(B.OUT), self.archives()[0])
        other = self.gpg_keys(fresh=True)              # cặp khoá khác: không giải mã được
        rc, out = self.run_cmd("verify", arc, "--identity", other)
        self.assertEqual(rc, 1)
        self.assertIn("KHÔNG ĐẠT", out)

    def test_missing_files_are_listed_not_fatal(self):
        self.gpg_keys()
        self.write("/etc/neu-agent/diag-secret", SECRET + "\n")
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 0, out)
        self.assertIn("chưa có: feedback/feedback.db", out)

    def test_retention_keeps_n(self):
        self.gpg_keys()
        self.seed()
        self.write(B.CONF, "KEEP=2\n", 0o640)
        for i in range(3):
            self.write(B.OUT + "/neu-agent-data-2026010%d-000000.tar.gz.gpg" % (i + 1), b"\x85old")
        self.write(B.OUT + "/khac.txt", b"giu")
        self.assertEqual(self.run_cmd("run")[0], 0)
        arcs = self.archives()
        self.assertEqual(len(arcs), 2)
        self.assertEqual(arcs[0], "neu-agent-data-20260103-000000.tar.gz.gpg")
        self.assertTrue(os.path.exists(self.path(B.OUT + "/khac.txt")), "không được xoá tệp lạ")

    def test_stale_partial_files_cleaned(self):
        self.gpg_keys()
        self.seed()
        self.write(B.OUT + "/neu-agent-data-20260101-000000.tar.gz.gpg.part", b"do dang")
        os.makedirs(self.path(B.OUT + "/.tmp-cu/stage"))
        self.assertEqual(self.run_cmd("run")[0], 0)
        left = os.listdir(self.path(B.OUT))
        self.assertFalse([n for n in left if n.endswith(".part") or n.startswith(".tmp-")], left)


class Config(Base):
    def expect_conf_error(self, needle):
        self.seed()
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 2, out)
        self.assertIn(needle, out)
        self.assertEqual(self.archives(), [])

    def test_no_key(self):
        self.expect_conf_error("Chưa khai khoá công khai")

    def test_private_age_key_refused(self):
        self.write(B.AGE_RECIPIENTS, "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ\n", 0o644)
        self.expect_conf_error("KHOÁ RIÊNG")

    def test_private_gpg_key_refused(self):
        self.write(B.GPG_KEY, "-----BEGIN PGP PRIVATE KEY BLOCK-----\nxx\n-----END PGP PRIVATE KEY BLOCK-----\n", 0o644)
        self.expect_conf_error("KHOÁ RIÊNG")

    def test_both_kinds_refused(self):
        self.write(B.AGE_RECIPIENTS, "age1" + "q" * 58 + "\n", 0o644)
        self.write(B.GPG_KEY, "-----BEGIN PGP PUBLIC KEY BLOCK-----\n", 0o644)
        self.expect_conf_error("MỘT loại")

    def test_garbage_recipient_refused(self):
        self.write(B.AGE_RECIPIENTS, "age1abc; rm -rf /\n", 0o644)
        self.expect_conf_error("không phải khoá công khai")

    def test_bad_remote_refused(self):
        self.write(B.AGE_RECIPIENTS, "age1" + "q" * 58 + "\n", 0o644)
        for bad in ("-oProxyCommand=sh@x:/a", "bk@x:/a;id", "bk@-x:/a", "bk@x:/a b", "bk@x"):
            self.write(B.CONF, "REMOTE=%s\n" % bad, 0o640)
            with self.subTest(bad=bad):
                self.assertRaises(B.ConfError, B.read_conf)
        self.write(B.CONF, "REMOTE=bk@kho.neu.edu.vn:/srv/neu-agent\nREMOTE_PORT=2222\n", 0o640)
        self.assertEqual(B.read_conf()["REMOTE_PORT"], 2222)

    def test_unknown_conf_key_refused(self):
        self.write(B.CONF, "KEEP=3\nPATH=/tmp\n", 0o640)
        self.assertRaises(B.ConfError, B.read_conf)

    def test_check_encrypts_sample(self):
        self.gpg_keys()
        rc, out = self.run_cmd("check")
        self.assertEqual(rc, 0, out)
        self.assertIn("mã hoá gpg", out)


class Push(Base):
    def setUp(self):
        super().setUp()
        os.environ["PATH"] = os.path.join(self.fake, "bin") + os.pathsep + self.old_env["PATH"]
        self.gpg_keys()
        self.seed()
        self.write(B.CONF, "REMOTE=bk@kho.neu.edu.vn:/srv/neu-agent\n", 0o640)
        self.write(B.SSH_KEY, "khoa-ssh-gia\n")
        self.write(B.KNOWN_HOSTS, "kho.neu.edu.vn ssh-ed25519 AAAAgia\n", 0o644)

    def test_push_uses_pinned_host_key(self):
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 0, out)
        args = B.read_text(os.path.join(self.fake, "rsync.log")).strip().split("\0")
        ssh = args[args.index("-e") + 1]
        self.assertIn("StrictHostKeyChecking=yes", ssh)
        self.assertIn("UserKnownHostsFile=" + self.path(B.KNOWN_HOSTS), ssh)
        self.assertIn("BatchMode=yes", ssh)
        self.assertEqual(args[-1], "bk@kho.neu.edu.vn:/srv/neu-agent")
        self.assertTrue(args[-2].endswith(".tar.gz.gpg"))
        self.assertTrue(json.loads(B.read_text(os.path.join(self.path(B.OUT), "last.json")))["pushed"])

    def test_push_failure_keeps_local_and_reports(self):
        os.environ["FAKE_RSYNC_RC"] = "12"
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 3, out)
        self.assertEqual(len(self.archives()), 1)
        st = json.loads(B.read_text(os.path.join(self.path(B.OUT), "last.json")))
        self.assertTrue(st["ok"])
        self.assertIs(st["pushed"], False)
        pub = B.read_text(self.path(B.PUBLIC_STATUS))
        self.assertIs(json.loads(pub)["pushed"], False)
        self.assertNotIn("rsync", pub, "trạng thái công khai không chứa lỗi chi tiết")

    def test_push_without_known_hosts_refused(self):
        os.unlink(self.path(B.KNOWN_HOSTS))
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 3)
        self.assertFalse(os.path.exists(os.path.join(self.fake, "rsync.log")), "không được đẩy khi chưa ghim khoá máy đích")


class HostileArchive(Base):
    """Gói khôi phục là đầu vào KHÔNG tin cậy: mọi kiểu gói xấu phải bị bác cả gói, không ghi gì ra ngoài thư mục tạm."""

    def setUp(self):
        super().setUp()
        self.seed()
        self.before = B.read_text(self.path("/etc/neu-agent/diag-secret"))

    def assert_rejected(self, path, needle=""):
        for argv in (("verify", path), ("restore", path, "--yes")):
            rc, out = self.run_cmd(*argv)
            self.assertEqual(rc, 1, out)
            self.assertIn(needle, out)
        self.assertEqual(B.read_text(self.path("/etc/neu-agent/diag-secret")), self.before)
        self.assertFalse(os.path.exists(os.path.join(self.fake, "calls.log")) and "stop" in B.read_text(os.path.join(self.fake, "calls.log")))

    def test_path_traversal(self):
        self.assert_rejected(self.make_plain_tar([("../../etc/neu-agent/diag-secret", b"x" * 64)]), "tệp lạ")
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "etc")))

    def test_absolute_path(self):
        self.assert_rejected(self.make_plain_tar([("/etc/neu-agent/diag-secret", b"x" * 64)]), "tệp lạ")

    def test_symlink_member(self):
        ti = tarfile.TarInfo("etc/diag-secret")
        ti.type, ti.linkname = tarfile.SYMTYPE, "/etc/shadow"
        self.assert_rejected(self.make_plain_tar([("etc/diag-secret", ti)], manifest={"format": 1, "files": [], "missing": []}), "không phải tệp thường")

    def test_unknown_name(self):
        self.assert_rejected(self.make_plain_tar([("etc/oauth2-proxy.env", b"OAUTH2_PROXY_CLIENT_SECRET=x")]), "tệp lạ")

    def test_duplicate_member(self):
        self.assert_rejected(self.make_plain_tar([("etc/diag-secret", b"a" * 64), ("etc/diag-secret", b"b" * 64)]), "trùng")

    def test_checksum_mismatch(self):
        man = {"format": 1, "files": [{"name": "etc/diag-secret", "sha256": "0" * 64}], "missing": []}
        self.assert_rejected(self.make_plain_tar([("etc/diag-secret", b"c" * 64)], manifest=man), "sai mã băm")

    def test_manifest_mismatch(self):
        man = {"format": 1, "files": [], "missing": []}
        self.assert_rejected(self.make_plain_tar([("etc/diag-secret", b"c" * 64)], manifest=man), "không khớp")

    def test_corrupt_sqlite(self):
        self.assert_rejected(self.make_plain_tar([("quota/usage.db", b"SQLite format 3\x00" + b"\xff" * 2000)]), "SQLite")

    def test_bad_htpasswd(self):
        self.assert_rejected(self.make_plain_tar([("etc/users.htpasswd", b"khach01:matkhau-ro\n")]), "bcrypt")

    def test_not_a_tar(self):
        p = os.path.join(self.tmp, "rac.tar.gz")
        with open(p, "wb") as f:
            f.write(b"khong phai tar")
        self.assert_rejected(p, "hỏng")


class Restore(Base):
    def setUp(self):
        super().setUp()
        self.seed()
        self.writer.close()
        for u in ("neu-agent-diag", "neu-agent-quota", "neu-agent-accounts", "neu-agent-oauth2"):
            open(os.path.join(self.fake, "active", u + ".service"), "w").close()
        # gói hợp lệ với dữ liệu KHÁC dữ liệu hiện tại
        db = os.path.join(self.tmp, "moi.db")
        c = sqlite3.connect(db)
        c.execute("CREATE TABLE usage(day TEXT, user TEXT, tokens INT)")
        c.execute("INSERT INTO usage VALUES('2026-10-01','u9',9)")
        c.commit()
        c.close()
        self.new_secret = "f" * 64 + "\n"
        self.pkg = self.make_plain_tar([("quota/usage.db", B.read_bytes(db)), ("etc/diag-secret", self.new_secret.encode()),
                                        ("diag/users-seen.json", b'{"users":{}}')])
        self.write("/var/lib/neu-agent/quota/usage.db-wal", b"wal cu con sot")

    def calls(self):
        p = os.path.join(self.fake, "calls.log")
        return B.read_text(p).splitlines() if os.path.exists(p) else []

    def test_dry_run_changes_nothing(self):
        rc, out = self.run_cmd("restore", self.pkg)
        self.assertEqual(rc, 0, out)
        self.assertIn("--yes", out)
        self.assertEqual(B.read_text(self.path("/etc/neu-agent/diag-secret")), SECRET + "\n")
        self.assertFalse(any(c.startswith(("stop", "start")) for c in self.calls()))

    def test_restore_replaces_and_restarts(self):
        os.chmod(self.path("/etc/neu-agent/diag-secret"), 0o600)
        rc, out = self.run_cmd("restore", self.pkg, "--yes")
        self.assertEqual(rc, 0, out)
        self.assertEqual(B.read_text(self.path("/etc/neu-agent/diag-secret")), self.new_secret)
        self.assertEqual(os.stat(self.path("/etc/neu-agent/diag-secret")).st_mode & 0o777, 0o600)
        self.assertFalse(os.path.exists(self.path("/var/lib/neu-agent/quota/usage.db-wal")), "-wal cũ phải bị bỏ")
        db = sqlite3.connect(self.path("/var/lib/neu-agent/quota/usage.db"))
        self.assertEqual(db.execute("SELECT user FROM usage").fetchall(), [("u9",)])
        db.close()
        calls = [c for c in self.calls() if c.startswith(("stop", "start"))]
        self.assertEqual(calls, ["stop neu-agent-diag.service", "stop neu-agent-quota.service", "start neu-agent-quota.service", "start neu-agent-diag.service"])
        safety = re.search(r"giữ ở (\S+)", out).group(1)
        self.assertEqual(B.read_text(os.path.join(safety, "etc/diag-secret")), SECRET + "\n")
        self.assertEqual(B.read_bytes(os.path.join(safety, "quota/usage.db-wal")), b"wal cu con sot")
        self.assertEqual(os.stat(safety).st_mode & 0o777, 0o700)

    def test_only(self):
        rc, out = self.run_cmd("restore", self.pkg, "--only", "diag/users-seen.json", "--yes")
        self.assertEqual(rc, 0, out)
        self.assertEqual(B.read_text(self.path("/etc/neu-agent/diag-secret")), SECRET + "\n")
        self.assertEqual(B.read_text(self.path("/var/lib/neu-agent/diag/users-seen.json")), '{"users":{}}')
        self.assertNotIn("stop neu-agent-quota.service", self.calls())
        rc, out = self.run_cmd("restore", self.pkg, "--only", "etc/oauth2-proxy.env", "--yes")
        self.assertEqual(rc, 1)

    def test_rollback_when_service_fails(self):
        open(os.path.join(self.fake, "fail", "neu-agent-quota.service"), "w").close()
        B.wait_active.__defaults__ = (1,)
        self.addCleanup(setattr, B.wait_active, "__defaults__", (20,))
        rc, out = self.run_cmd("restore", self.pkg, "--yes")
        self.assertEqual(rc, 1, out)
        self.assertIn("trả lại", out)
        self.assertEqual(B.read_text(self.path("/etc/neu-agent/diag-secret")), SECRET + "\n")
        self.assertEqual(B.read_bytes(self.path("/var/lib/neu-agent/quota/usage.db-wal")), b"wal cu con sot")
        self.assertFalse(os.path.exists(self.path("/var/lib/neu-agent/diag/users-seen.json.restore-tmp")))
        self.assertIn("neu-agent-quota", out)

    def test_rollback_removes_files_that_did_not_exist(self):
        os.unlink(self.path("/var/lib/neu-agent/diag/users-seen.json"))
        open(os.path.join(self.fake, "fail", "neu-agent-diag.service"), "w").close()
        B.wait_active.__defaults__ = (1,)
        self.addCleanup(setattr, B.wait_active, "__defaults__", (20,))
        rc, _ = self.run_cmd("restore", self.pkg, "--yes")
        self.assertEqual(rc, 1)
        self.assertFalse(os.path.exists(self.path("/var/lib/neu-agent/diag/users-seen.json")))


class PublicStatus(Base):
    """Tệp trạng thái CHỈ CÓ SỐ cho healthz/cảnh báo (chạy bằng neu-diag, không đọc được thư mục sao lưu 0700)."""

    def pub(self):
        p = self.path(B.PUBLIC_STATUS)
        self.assertEqual(os.stat(p).st_mode & 0o777, 0o644)
        self.assertEqual(os.stat(os.path.dirname(p)).st_mode & 0o777, 0o755)
        raw = B.read_text(p)
        self.assertNotIn("neu-agent-data-", raw, "không có tên tệp")
        st = json.loads(raw)
        self.assertEqual(set(st), {"time", "ok", "pushed", "size", "files", "last_ok"})
        for k, v in st.items():
            self.assertTrue(v is None or isinstance(v, (bool, int)), (k, v))
        return st

    def test_ok_run(self):
        self.gpg_keys()
        self.seed()
        self.assertEqual(self.run_cmd("run")[0], 0)
        st = self.pub()
        self.assertIs(st["ok"], True)
        self.assertIsNone(st["pushed"], "không có REMOTE")
        self.assertEqual(st["files"], len(B.SOURCES))
        self.assertGreater(st["size"], 0)
        self.assertEqual(st["last_ok"], st["time"])

    def test_failure_keeps_last_ok_and_no_error_text(self):
        self.gpg_keys()
        self.seed()
        self.assertEqual(self.run_cmd("run")[0], 0)
        first = self.pub()["last_ok"]
        for _arc, src, *_ in B.SOURCES:
            if os.path.exists(self.path(src)):
                os.unlink(self.path(src))
        rc, out = self.run_cmd("run")
        self.assertEqual(rc, 1, out)
        st = self.pub()
        self.assertIs(st["ok"], False)
        self.assertEqual(st["last_ok"], first)
        self.assertNotIn("không tìm thấy", B.read_text(self.path(B.PUBLIC_STATUS)))

    def test_conf_error_is_reported(self):
        self.seed()
        self.assertEqual(self.run_cmd("run")[0], 2)
        st = self.pub()
        self.assertIs(st["ok"], False)
        self.assertIsNone(st["last_ok"])

    def test_does_not_follow_planted_symlink(self):
        self.gpg_keys()
        self.seed()
        victim = os.path.join(self.tmp, "nan-nhan.txt")
        with open(victim, "w") as f:
            f.write("giu nguyen")
        d = os.path.dirname(self.path(B.PUBLIC_STATUS))
        os.makedirs(d)
        os.symlink(victim, self.path(B.PUBLIC_STATUS))
        os.symlink(victim, os.path.join(d, ".status.json.tmp"))
        self.assertEqual(self.run_cmd("run")[0], 0)
        self.assertEqual(B.read_text(victim), "giu nguyen")
        self.assertFalse(os.path.islink(self.path(B.PUBLIC_STATUS)))
        self.pub()


class Manifest(unittest.TestCase):
    """Đường dẫn trong SOURCES phải trùng đường dẫn các dịch vụ thật đang dùng (đổi chỗ lưu mà quên sửa ở đây = âm thầm không sao lưu)."""

    def test_sources_match_services(self):
        if not os.path.isdir(os.path.join(HERE, "..", "diag")):
            self.skipTest("chỉ có thư mục backup/ (chạy trong kho hoặc gói triển khai đầy đủ)")
        code = ""
        for d in ("diag", "quota", "auth"):
            for n in os.listdir(os.path.join(HERE, "..", d)):
                if n.endswith((".py", ".service", ".sh")) and not n.startswith("test_"):
                    code += B.read_text(os.path.join(HERE, "..", d, n))
        code += B.read_text(os.path.join(HERE, "..", "users.sh"))
        for name, path, *_ in B.SOURCES:
            with self.subTest(name=name):
                if name == "diag/users-seen.json":       # bộ thu ghép NEU_DIAG_DIR + "users-seen.json"
                    self.assertIn('"users-seen.json"', code)
                    self.assertIn("/var/lib/neu-agent/diag", code)
                else:
                    self.assertIn(path, code)

    def test_unit_is_sandboxed(self):
        u = B.read_text(os.path.join(HERE, "neu-agent-backup.service"))
        for line in ("ProtectSystem=strict", "PrivateNetwork=yes", "IPAddressDeny=any", "NoNewPrivileges=yes", "UMask=0077",
                     "CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_CHOWN CAP_FOWNER", "ReadWritePaths=/var/backups/neu-agent-data"):
            self.assertIn(line + "\n", u)
        self.assertNotIn("captures.db", B.read_text(os.path.join(HERE, "backup.py")).split('"""', 2)[2])
        self.assertIn("StateDirectory=neu-agent-backup\nStateDirectoryMode=0755\n", u, "trạng thái công khai: chỉ thư mục này, đọc được bởi neu-diag")
        self.assertEqual(os.path.dirname(B.PUBLIC_STATUS), "/var/lib/neu-agent-backup")


if __name__ == "__main__":
    unittest.main()
