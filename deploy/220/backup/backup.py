#!/usr/bin/env python3
"""Sao lưu dữ liệu không tái tạo được của NEU Agent trên máy 220 (neu-agent-backup.timer chạy hằng đêm, bằng root trong sandbox systemd).

  backup.py run                                             tạo một bản mã hoá trong /var/backups/neu-agent-data, giữ KEEP bản, đẩy sang REMOTE nếu có
  backup.py list                                            liệt kê các bản + kết quả lần chạy gần nhất
  backup.py check                                           kiểm tra cấu hình + thử mã hoá một mẩu nhỏ (install-backup.sh dùng)
  backup.py verify <tệp> [--identity khoá] [--keep]         THỬ khôi phục vào thư mục tạm: giải mã, kiểm mã băm, SQLite/JSON; không đụng hệ thống
  backup.py restore <tệp> [--identity khoá] [--only a,b] [--yes]
                                                            khôi phục thật: dừng dịch vụ, giữ bản hiện tại, thay tệp, chạy lại; lỗi thì tự trả lại

Nhất quán: SQLite chép bằng API backup (một ảnh chụp trọn vẹn kể cả khi dịch vụ đang ghi, gồm phần còn trong -wal); JSON đọc rồi kiểm cú pháp
(các dịch vụ ghi JSON bằng os.replace nên luôn đọc được bản trọn vẹn). Mã hoá bằng KHOÁ CÔNG KHAI (age hoặc gpg) do quản trị khai: trên máy không
có khoá giải mã, nên ai lấy được ổ đĩa/bản sao cũng không đọc được. Nhật ký chỉ có tên tệp cố định, kích thước, số dòng; không in nội dung.
Khi khôi phục, gói được coi là KHÔNG tin cậy (ai có khoá công khai cũng tạo được gói): chỉ nhận đúng các tên trong SOURCES, tệp thường, có giới hạn cỡ.
Không gồm captures.db (nội dung hội thoại tạm, tự xoá theo hạn) và các tệp sinh lại được (báo cáo, health.json).
"""
import argparse
import atexit
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse

PREFIX = os.environ.get("NEU_BACKUP_PREFIX", "")            # CHỈ để kiểm thử: coi thư mục này là "/" (không cần root, không đụng hệ thống)
SYSTEMCTL = os.environ.get("NEU_BACKUP_SYSTEMCTL", "systemctl")


def P(p):
    return PREFIX + p


ETC = "/etc/neu-agent"
OUT = "/var/backups/neu-agent-data"
CONF = ETC + "/backup.conf"
AGE_RECIPIENTS = ETC + "/backup-recipients.txt"
GPG_KEY = ETC + "/backup-recipient.asc"
SSH_KEY = ETC + "/backup-ssh-key"
KNOWN_HOSTS = ETC + "/backup-known_hosts"

# (tên trong gói, đường dẫn, loại, quyền khi tệp chưa có lúc khôi phục, dịch vụ dùng tệp — dừng khi khôi phục)
# Chủ sở hữu khi khôi phục: giữ như tệp hiện có; chưa có thì lấy chủ của thư mục chứa (KHÔNG lấy từ gói).
SOURCES = [
    ("feedback/feedback.db", "/var/lib/neu-agent/feedback/feedback.db", "sqlite", 0o600, ["neu-agent-diag"]),
    ("feedback/shares.db", "/var/lib/neu-agent/feedback/shares.db", "sqlite", 0o600, ["neu-agent-diag"]),
    ("quota/usage.db", "/var/lib/neu-agent/quota/usage.db", "sqlite", 0o600, ["neu-agent-quota", "neu-agent-diag"]),
    ("quota/grants.json", "/var/lib/neu-agent/quota/grants.json", "json", 0o640, ["neu-agent-quota", "neu-agent-diag"]),
    ("diag/users-seen.json", "/var/lib/neu-agent/diag/users-seen.json", "json", 0o600, ["neu-agent-diag"]),
    ("etc/users.htpasswd", "/etc/neu-agent/users.htpasswd", "htpasswd", 0o600, ["neu-agent-accounts", "neu-agent-oauth2"]),
    ("etc/diag-secret", "/etc/neu-agent/diag-secret", "secret", 0o600, ["neu-agent-diag", "neu-agent-quota"]),
    ("etc/admins.txt", "/etc/neu-agent/admins.txt", "file", 0o640, ["neu-agent-diag", "neu-agent-quota"]),
    ("etc/quota.json", "/etc/neu-agent/quota.json", "json", 0o640, ["neu-agent-quota"]),
    ("accounts/audit.jsonl", "/var/lib/neu-agent-accounts/audit.jsonl", "file", 0o600, ["neu-agent-accounts"]),
]
BY_NAME = {s[0]: s for s in SOURCES}
# thứ tự dừng (ngược lại khi chạy lại): người ghi trước, dịch vụ đăng nhập sau cùng
UNIT_ORDER = ["neu-agent-diag", "neu-agent-accounts", "neu-agent-quota", "neu-agent-oauth2"]
ARCHIVE_RE = re.compile(r"^neu-agent-data-\d{8}-\d{6}\.tar\.gz\.(age|gpg)$")
AGE_RE = re.compile(r"^age1[0-9a-z]{58}$")
SSH_PUB_RE = re.compile(r"^(ssh-ed25519|ssh-rsa) AAAA[0-9A-Za-z+/]+=*( [^\s]+)?$")
REMOTE_RE = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}@[A-Za-z0-9][A-Za-z0-9.-]{0,252}:[A-Za-z0-9._/-]{0,200}$")
MAX_MEMBER = 4 << 30
MAX_MEMBERS = 64


class ConfError(Exception):
    pass


class BadArchive(Exception):
    pass


def log(msg):
    print(msg, flush=True)


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return ("%d %s" % (n, u)) if u == "B" else ("%.1f %s" % (n, u))
        n /= 1024.0


def read_text(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ------------------------------------------------------------------ cấu hình
def read_conf():
    c = {"KEEP": "14", "REMOTE": "", "REMOTE_PORT": "22"}
    try:
        lines = read_text(P(CONF)).splitlines()
    except FileNotFoundError:
        lines = []
    for i, ln in enumerate(lines, 1):
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^([A-Z_]+)=(.*)$", ln)
        if not m or m.group(1) not in c:
            raise ConfError("%s dòng %d: không hiểu (chỉ có KEEP=, REMOTE=, REMOTE_PORT=)" % (CONF, i))
        c[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    if not re.match(r"^\d{1,3}$", c["KEEP"]) or not 1 <= int(c["KEEP"]) <= 365:
        raise ConfError("KEEP phải là số bản giữ lại, 1–365")
    if c["REMOTE"] and not REMOTE_RE.match(c["REMOTE"]):
        raise ConfError("REMOTE phải dạng người_dùng@máy:thư/mục (chữ, số, . _ - /)")
    if not re.match(r"^\d{1,5}$", c["REMOTE_PORT"]) or not 1 <= int(c["REMOTE_PORT"]) <= 65535:
        raise ConfError("REMOTE_PORT không hợp lệ")
    c["KEEP"] = int(c["KEEP"])
    c["REMOTE_PORT"] = int(c["REMOTE_PORT"])
    return c


def check_no_private(path, text):
    if "AGE-SECRET-KEY-" in text.upper() or "PRIVATE KEY" in text:
        raise ConfError("%s chứa KHOÁ RIÊNG. Xoá khỏi máy ngay; trên máy chủ chỉ để khoá CÔNG KHAI." % path)


def encryption_kind():
    """'age' hoặc 'gpg' tuỳ tệp khoá công khai quản trị đã khai; lỗi nếu chưa khai, khai cả hai, hoặc lỡ để khoá riêng."""
    has_age, has_gpg = os.path.exists(P(AGE_RECIPIENTS)), os.path.exists(P(GPG_KEY))
    if has_age and has_gpg:
        raise ConfError("Chỉ khai MỘT loại khoá: %s (age) hoặc %s (gpg)." % (AGE_RECIPIENTS, GPG_KEY))
    if not has_age and not has_gpg:
        raise ConfError("Chưa khai khoá công khai để mã hoá (%s hoặc %s). Xem docs/DEPLOY.md." % (AGE_RECIPIENTS, GPG_KEY))
    if has_age:
        text = read_text(P(AGE_RECIPIENTS))
        check_no_private(AGE_RECIPIENTS, text)
        keys = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
        if not keys:
            raise ConfError("%s chưa có khoá nào." % AGE_RECIPIENTS)
        for i, k in enumerate(keys, 1):
            if not AGE_RE.match(k) and not SSH_PUB_RE.match(k):
                raise ConfError("%s: khoá thứ %d không phải khoá công khai age (age1…) hoặc ssh-ed25519/ssh-rsa." % (AGE_RECIPIENTS, i))
        return "age"
    text = read_text(P(GPG_KEY))
    check_no_private(GPG_KEY, text)
    if "-----BEGIN PGP PUBLIC KEY BLOCK-----" not in text:
        raise ConfError("%s không phải khoá công khai gpg dạng ASCII (gpg --armor --export <khoá>)." % GPG_KEY)
    return "gpg"


# ------------------------------------------------------------------ chụp dữ liệu
def snapshot_sqlite(src, dst):
    """API backup của SQLite: bản sao nhất quán ở một thời điểm, không chặn dịch vụ đang ghi lâu; nguồn mở chỉ đọc."""
    s = sqlite3.connect("file:%s?mode=ro" % urllib.parse.quote(src), uri=True, timeout=30)
    try:
        d = sqlite3.connect(dst)
        try:
            s.backup(d)
            d.execute("PRAGMA journal_mode=DELETE")       # bản sao gọn trong MỘT tệp (không -wal); dịch vụ tự bật lại WAL khi mở
            ok = d.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            d.close()
    finally:
        s.close()
    if ok != "ok":
        raise RuntimeError("bản chụp SQLite hỏng (integrity_check)")


def snapshot_file(src, dst, kind):
    for attempt in range(5):
        with open(src, "rb") as f:
            data = f.read()
        if kind != "json":
            break
        try:
            json.loads(data.decode("utf-8"))
            break
        except ValueError:
            if attempt == 4:
                raise RuntimeError("JSON không đọc được")
            time.sleep(0.5)
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)


def clean_stale(out):
    for n in os.listdir(out):
        p = os.path.join(out, n)
        if n.startswith(".tmp-") and os.path.isdir(p):
            shutil.rmtree(p, ignore_errors=True)
        elif n.endswith(".part"):
            os.unlink(p)


def list_archives(out):
    try:
        return sorted(n for n in os.listdir(out) if ARCHIVE_RE.match(n))
    except FileNotFoundError:
        return []


def gpg_home():
    """Thư mục gpg tạm, đường dẫn ngắn (gpg đặt socket trong đó; giới hạn ~100 ký tự) — xoá khi thoát."""
    home = tempfile.mkdtemp(prefix="neu-gpg-")
    atexit.register(shutil.rmtree, home, True)
    return home


def encrypt_cmd(kind, dst):
    if kind == "age":
        return ["age", "-R", P(AGE_RECIPIENTS), "-o", dst]
    home = gpg_home()
    return ["gpg", "--batch", "--no-tty", "--quiet", "--homedir", home, "--trust-model", "always",
            "--recipient-file", P(GPG_KEY), "--output", dst, "--encrypt"]


def looks_encrypted(path, kind):
    with open(path, "rb") as f:
        head = f.read(32)
    if head[:2] == b"\x1f\x8b":
        return False
    return head.startswith(b"age-encryption.org/v1\n") if kind == "age" else bool(head) and bool(head[0] & 0x80)


def contains_any(path, needles):
    needles = [n for n in needles if len(n) >= 16]
    if not needles:
        return False
    overlap = max(len(n) for n in needles)
    prev = b""
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            chunk = prev + b
            if any(n in chunk for n in needles):
                return True
            prev = chunk[-overlap:]
    return False


def push(conf, out, names):
    """Đẩy các bản hiện có sang máy khác qua rsync/SSH (khoá SSH riêng của việc sao lưu, máy đích phải có trong known_hosts)."""
    for f in (SSH_KEY, KNOWN_HOSTS):
        if not os.path.exists(P(f)):
            raise ConfError("Có REMOTE nhưng thiếu %s: chạy lại ./backup/install-backup.sh --remote …" % f)
    ssh = ("ssh -F none -i %s -p %d -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%s "
           "-o ConnectTimeout=20 -o ServerAliveInterval=15" % (P(SSH_KEY), conf["REMOTE_PORT"], P(KNOWN_HOSTS)))
    cmd = ["rsync", "-t", "--timeout=300", "-e", ssh] + [os.path.join(out, n) for n in names] + [conf["REMOTE"]]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3 * 3600)
    if r.returncode != 0:
        raise RuntimeError("rsync lỗi %d: %s" % (r.returncode, (r.stderr.strip().splitlines() or [""])[-1][:200]))


def write_status(out, st):
    tmp = os.path.join(out, ".last.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False)
    os.chmod(tmp, 0o640)
    os.replace(tmp, os.path.join(out, "last.json"))


def cmd_run(args):
    if not PREFIX and os.geteuid() != 0:
        log("Cần chạy bằng root (sudo).")
        return 2
    try:
        conf = read_conf()
        kind = encryption_kind()
    except ConfError as e:
        log("Cấu hình sao lưu SAI: %s" % e)
        return 2
    out = P(OUT)
    os.makedirs(out, mode=0o700, exist_ok=True)
    os.chmod(out, 0o700)
    lock = open(os.path.join(out, ".lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        log("Đang có một lần sao lưu khác chạy; bỏ qua.")
        return 1
    try:
        return run_locked(conf, kind, out)
    finally:
        lock.close()


def run_locked(conf, kind, out):
    clean_stale(out)
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    name = "neu-agent-data-%s.tar.gz.%s" % (stamp, kind)
    final = os.path.join(out, name)
    status = {"time": int(now.timestamp()), "ok": False, "archive": name, "kind": kind, "pushed": None}
    tmp = tempfile.mkdtemp(prefix=".tmp-", dir=out)
    try:
        need = sum(os.path.getsize(P(s[1])) for s in SOURCES if os.path.isfile(P(s[1])))
        st = os.statvfs(out)
        if st.f_bavail * st.f_frsize < 2 * need + (50 << 20):
            raise RuntimeError("không đủ chỗ trống ở %s (cần ~%s)" % (OUT, human(2 * need + (50 << 20))))
        stage = os.path.join(tmp, "stage")
        files, missing, secrets = [], [], []
        for arc, src, kd, _mode, _units in SOURCES:
            if not os.path.isfile(P(src)):
                missing.append(arc)
                continue
            dst = os.path.join(stage, arc)
            os.makedirs(os.path.dirname(dst), mode=0o700, exist_ok=True)
            try:
                if kd == "sqlite":
                    snapshot_sqlite(P(src), dst)
                else:
                    snapshot_file(P(src), dst, kd)
            except (sqlite3.Error, OSError, RuntimeError) as e:
                raise RuntimeError("%s: %s" % (arc, e))
            if kd in ("secret", "htpasswd"):
                with open(dst, "rb") as f:
                    secrets.extend(x for x in f.read().splitlines() if x.strip())
            files.append({"name": arc, "kind": kd, "size": os.path.getsize(dst), "sha256": sha256_file(dst)})
        if not files:
            raise RuntimeError("không tìm thấy tệp dữ liệu nào để sao lưu")
        manifest = {"format": 1, "created": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "files": files, "missing": missing}
        mpath = os.path.join(stage, "manifest.json")
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1)
        part = final + ".part"
        proc = subprocess.Popen(encrypt_cmd(kind, part), stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=proc.stdin, mode="w|gz") as t:
                for arc in ["manifest.json"] + [f["name"] for f in files]:
                    ti = t.gettarinfo(os.path.join(stage, arc), arcname=arc)
                    ti.uid = ti.gid = 0
                    ti.uname = ti.gname = "root"
                    with open(os.path.join(stage, arc), "rb") as fh:
                        t.addfile(ti, fh)
        except BrokenPipeError:
            pass
        finally:
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass
        err = proc.stderr.read().decode("utf-8", "replace").strip()
        proc.stderr.close()
        if proc.wait() != 0 or not os.path.exists(part):
            raise RuntimeError("mã hoá (%s) lỗi: %s" % (kind, (err.splitlines() or [""])[-1][:200]))
        if not looks_encrypted(part, kind) or contains_any(part, secrets):
            raise RuntimeError("tệp ra không phải dạng đã mã hoá; huỷ")
        with open(part, "rb") as f:
            os.fsync(f.fileno())
        os.chmod(part, 0o600)
        os.replace(part, final)
        size = os.path.getsize(final)
        status.update(ok=True, size=size, files=len(files), missing=len(missing))
        log("Sao lưu xong: %s (%s, %d tệp%s)." % (name, human(size), len(files), ("; chưa có: " + ", ".join(missing)) if missing else ""))
    except Exception as e:  # noqa: BLE001 — mọi lỗi đều phải ghi trạng thái và trả mã lỗi
        status["error"] = str(e)[:300]
        log("Sao lưu THẤT BẠI: %s" % status["error"])
        write_status(out, status)
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    archives = list_archives(out)
    for old in archives[:-conf["KEEP"]]:
        if old != name:
            os.unlink(os.path.join(out, old))
            log("Đã xoá bản cũ: %s" % old)
    rc = 0
    if conf["REMOTE"]:
        try:
            push(conf, out, list_archives(out))
            status["pushed"] = True
            log("Đã đẩy %d bản sang máy ngoài." % len(list_archives(out)))
        except (ConfError, RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            status["pushed"] = False
            status["error"] = ("đẩy sang máy ngoài: %s" % e)[:300]
            log("Đẩy sang máy ngoài THẤT BẠI (bản trên máy vẫn có): %s" % e)
            rc = 3
    write_status(out, status)
    return rc


def cmd_check(args):
    """Cho install-backup.sh: cấu hình đúng, đủ công cụ, khoá công khai mã hoá được (thử một mẩu nhỏ)."""
    try:
        conf = read_conf()
        kind = encryption_kind()
        need = [kind] + (["rsync", "ssh"] if conf["REMOTE"] else [])
        miss = [t for t in need if not shutil.which(t)]
        if miss:
            raise ConfError("thiếu chương trình: %s (sudo apt-get install %s)" % (", ".join(miss), " ".join("openssh-client" if t == "ssh" else t for t in miss)))
        tmp = tempfile.mkdtemp(prefix="neu-check-")
        try:
            dst = os.path.join(tmp, "x")
            r = subprocess.run(encrypt_cmd(kind, dst), input=b"neu-agent-backup-check", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode != 0 or not looks_encrypted(dst, kind):
                raise ConfError("không mã hoá được bằng khoá đã khai (%s): %s" % (kind, (r.stderr.decode("utf-8", "replace").strip().splitlines() or [""])[-1][:200]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    except ConfError as e:
        log("Cấu hình sao lưu SAI: %s" % e)
        return 2
    log("Cấu hình: mã hoá %s, giữ %d bản, %s." % (kind, conf["KEEP"], ("đẩy sang " + conf["REMOTE"]) if conf["REMOTE"] else "không đẩy sang máy ngoài"))
    return 0


def cmd_list(args):
    out = P(OUT)
    names = list_archives(out)
    for n in names:
        p = os.path.join(out, n)
        log("%s  %9s  %s" % (time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p))), human(os.path.getsize(p)), p))
    log("(%d bản)" % len(names))
    try:
        st = json.loads(read_text(os.path.join(out, "last.json")))
        log("Lần chạy gần nhất: %s — %s%s" % (time.strftime("%Y-%m-%d %H:%M", time.localtime(st.get("time", 0))),
                                             "OK" if st.get("ok") else "LỖI",
                                             (" — " + st["error"]) if st.get("error") else ""))
    except (OSError, ValueError):
        log("Chưa có lần chạy nào.")
    return 0


# ------------------------------------------------------------------ giải mã + kiểm tra (dùng cho verify và restore)
def decrypt(archive, identity, tmp):
    base = os.path.basename(archive)
    if base.endswith(".tar.gz"):                                  # đã giải mã ở máy khác (khuyến nghị: khoá riêng không lên máy chủ)
        return archive
    out = os.path.join(tmp, "data.tar.gz")
    if base.endswith(".age"):
        if not identity:
            raise ConfError("Cần --identity <tệp khoá riêng age>. Đừng để khoá riêng trên máy chủ: chép tạm, dùng xong xoá.")
        cmd = ["age", "-d", "-i", identity, "-o", out, archive]
    elif base.endswith(".gpg"):
        cmd = ["gpg", "--quiet", "--yes", "--pinentry-mode", "loopback"]
        if identity:                                              # khoá riêng gpg trong tệp: nhập vào thư mục gpg tạm, xoá cùng thư mục tạm
            home = gpg_home()
            r = subprocess.run(["gpg", "--batch", "--quiet", "--homedir", home, "--import", identity], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if r.returncode != 0:
                raise ConfError("không nhập được khoá gpg từ --identity")
            cmd += ["--homedir", home]
        cmd += ["--output", out, "--decrypt", archive]
    else:
        raise ConfError("Không nhận ra loại tệp (cần .tar.gz.age, .tar.gz.gpg hoặc .tar.gz đã giải mã).")
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0 or not os.path.exists(out):
        raise BadArchive("giải mã lỗi (sai khoá hoặc tệp hỏng): %s" % ((r.stderr.decode("utf-8", "replace").strip().splitlines() or [""])[-1][:200]))
    return out


def safe_extract(tarpath, stage):
    """Chỉ lấy đúng các tên đã biết, tệp thường, một lần mỗi tên; bất kỳ thứ gì khác => bác cả gói (không giải nén 'thử')."""
    seen = set()
    try:
        with tarfile.open(tarpath, "r:gz") as t:
            for i, m in enumerate(t):
                if i >= MAX_MEMBERS:
                    raise BadArchive("gói có quá nhiều tệp")
                if m.name != "manifest.json" and m.name not in BY_NAME:
                    raise BadArchive("gói có tệp lạ: %r" % m.name[:80])
                if m.name in seen:
                    raise BadArchive("gói có tệp trùng tên: %r" % m.name)
                if not m.isreg():
                    raise BadArchive("gói có mục không phải tệp thường: %r" % m.name)
                if m.size > (1 << 20 if m.name == "manifest.json" else MAX_MEMBER):
                    raise BadArchive("tệp quá lớn trong gói: %r" % m.name)
                seen.add(m.name)
                dst = os.path.join(stage, m.name)
                os.makedirs(os.path.dirname(dst), mode=0o700, exist_ok=True)
                src = t.extractfile(m)
                fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with src, os.fdopen(fd, "wb") as f:
                    shutil.copyfileobj(src, f, 1 << 20)
    except (tarfile.TarError, EOFError, OSError) as e:
        raise BadArchive("gói hỏng: %s" % e)
    if "manifest.json" not in seen:
        raise BadArchive("gói thiếu manifest.json")
    try:
        man = json.loads(read_text(os.path.join(stage, "manifest.json")))
        files = man["files"]
        assert man.get("format") == 1 and isinstance(files, list)
        names = [f["name"] for f in files]
    except (ValueError, KeyError, TypeError, AssertionError):
        raise BadArchive("manifest.json không hợp lệ")
    if sorted(names) != sorted(seen - {"manifest.json"}) or len(set(names)) != len(names):
        raise BadArchive("manifest.json không khớp nội dung gói")
    for f in files:
        if sha256_file(os.path.join(stage, f["name"])) != f.get("sha256"):
            raise BadArchive("sai mã băm: %s" % f["name"])
    return man


def check_file(path, kind):
    """Kiểm tra từng tệp dùng được; trả mô tả ngắn (chỉ số đếm, không nội dung)."""
    if kind == "sqlite":
        db = sqlite3.connect("file:%s?mode=ro" % urllib.parse.quote(path), uri=True)
        try:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise BadArchive("SQLite hỏng")
            tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            rows = sum(db.execute('SELECT COUNT(*) FROM "%s"' % t.replace('"', '""')).fetchone()[0] for t in tables)
        except sqlite3.Error as e:
            raise BadArchive("SQLite không đọc được: %s" % e)
        finally:
            db.close()
        return "%d bảng, %d dòng" % (len(tables), rows)
    data = read_bytes(path)
    if kind == "json":
        try:
            json.loads(data.decode("utf-8"))
        except ValueError:
            raise BadArchive("JSON hỏng")
        return "JSON hợp lệ, %s" % human(len(data))
    if kind == "htpasswd":
        lines = [x for x in data.decode("utf-8", "replace").splitlines() if x.strip()]
        if any(not re.match(r"^[a-z0-9][a-z0-9._-]{2,31}:\$2[aby]\$\d\d\$.{53}$", x) for x in lines):
            raise BadArchive("tệp mật khẩu có dòng không phải băm bcrypt")
        return "%d tài khoản" % len(lines)
    if kind == "secret":
        if len(data.strip()) < 32:
            raise BadArchive("bí mật quá ngắn")
        return "có (%d ký tự)" % len(data.strip())
    return "%d dòng" % len(data.splitlines())


def open_and_check(archive, identity, tmp):
    stage = os.path.join(tmp, "stage")
    os.makedirs(stage, mode=0o700)
    man = safe_extract(decrypt(archive, identity, tmp), stage)
    report = []
    for f in man["files"]:
        kind = BY_NAME[f["name"]][2]                                  # loại theo bảng cố định, không theo gói
        report.append((f["name"], check_file(os.path.join(stage, f["name"]), kind)))
    return stage, man, report


def cmd_verify(args):
    tmp = tempfile.mkdtemp(prefix="neu-agent-restore-test-")
    keep = False
    try:
        stage, man, report = open_and_check(args.archive, args.identity, tmp)
        log("Gói tạo lúc %s, %d tệp:" % (man.get("created", "?"), len(report)))
        for n, d in report:
            log("  ✔ %-22s %s" % (n, d))
        if man.get("missing"):
            log("  (lúc sao lưu chưa có: %s)" % ", ".join(str(x)[:40] for x in man["missing"][:20]))
        log("THỬ KHÔI PHỤC: ĐẠT.")
        if args.keep:
            keep = True
            log("Đã giữ bản giải nén ở %s (có bí mật: xem xong xoá: rm -rf %s)" % (stage, tmp))
        return 0
    except (ConfError, BadArchive) as e:
        log("THỬ KHÔI PHỤC: KHÔNG ĐẠT — %s" % e)
        return 1
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------ khôi phục thật
def systemctl(*a):
    return subprocess.run([SYSTEMCTL] + list(a), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def is_active(unit):
    return systemctl("is-active", "--quiet", unit + ".service") == 0


def wait_active(unit, secs=20):
    for _ in range(secs * 2):
        if is_active(unit):
            return True
        time.sleep(0.5)
    return False


def related(path):
    return [path + s for s in ("-wal", "-shm", "-journal")]


def place(src, target, mode):
    """Thay tệp nguyên tử: chép cạnh tệp đích, đặt chủ/quyền (như tệp cũ, hoặc theo thư mục chứa), rồi os.replace."""
    d = os.path.dirname(target)
    os.makedirs(d, mode=0o750, exist_ok=True)
    if os.path.exists(target):
        st = os.stat(target)
        uid, gid, mode = st.st_uid, st.st_gid, st.st_mode & 0o777
    else:
        st = os.stat(d)
        uid, gid = st.st_uid, st.st_gid
    tmp = target + ".restore-tmp"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f, open(src, "rb") as s:
        shutil.copyfileobj(s, f, 1 << 20)
        f.flush()
        os.fsync(f.fileno())
    if os.geteuid() == 0:
        os.chown(tmp, uid, gid)
    os.chmod(tmp, mode)
    for r in related(target):                                         # -wal/-shm cũ còn sót sẽ bị SQLite áp lên tệp mới => phải bỏ
        if os.path.lexists(r):
            os.unlink(r)
    os.replace(tmp, target)


def cmd_restore(args):
    if not PREFIX and os.geteuid() != 0:
        log("Cần chạy bằng sudo.")
        return 2
    os.makedirs(P(OUT), mode=0o700, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=".restore-", dir=P(OUT))
    try:
        try:
            stage, man, report = open_and_check(args.archive, args.identity, tmp)
        except (ConfError, BadArchive) as e:
            log("Không khôi phục: %s" % e)
            return 1
        names = [n for n, _ in report]
        if args.only:
            want = [x.strip() for x in args.only.split(",") if x.strip()]
            bad = [x for x in want if x not in names]
            if bad:
                log("Không có trong gói: %s. Có: %s" % (", ".join(x[:40] for x in bad), ", ".join(names)))
                return 1
            names = [n for n in names if n in want]
        log("Gói tạo lúc %s. Sẽ khôi phục:" % man.get("created", "?"))
        for n, d in report:
            if n in names:
                tgt = BY_NAME[n][1]
                log("  %-22s → %s (%s; %s)" % (n, tgt, "thay tệp hiện có" if os.path.exists(P(tgt)) else "tạo mới", d))
        units = [u for u in UNIT_ORDER if any(u in BY_NAME[n][4] for n in names)]
        if not args.yes:
            log("Chưa thay đổi gì. Kiểm tra lại rồi chạy thêm --yes (sẽ tạm dừng: %s)." % ", ".join(units))
            return 0

        active = [u for u in units if is_active(u)]
        safety = os.path.join(P(OUT), "before-restore-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        os.makedirs(safety, mode=0o700)
        existed = {}
        for u in active:
            systemctl("stop", u + ".service")
        try:
            for n in names:                                           # dịch vụ đã dừng: chép thẳng tệp hiện tại (kể cả -wal/-shm) làm bản giữ lại
                tgt = P(BY_NAME[n][1])
                existed[n] = os.path.exists(tgt)
                for f in [tgt] + related(tgt):
                    if os.path.exists(f):
                        dst = os.path.join(safety, n + f[len(tgt):])
                        os.makedirs(os.path.dirname(dst), mode=0o700, exist_ok=True)
                        shutil.copy2(f, dst)
            for n in names:
                place(os.path.join(stage, n), P(BY_NAME[n][1]), BY_NAME[n][3])
            for u in reversed(active):
                systemctl("start", u + ".service")
            failed = [u for u in active if not wait_active(u)]
            if failed:
                raise RuntimeError("dịch vụ không chạy lại: %s" % ", ".join(failed))
        except Exception as e:  # noqa: BLE001 — mọi lỗi đều trả lại như cũ
            log("!! Khôi phục lỗi (%s), đang trả lại như trước…" % e)
            for u in active:
                systemctl("stop", u + ".service")
            for n in names:
                tgt = P(BY_NAME[n][1])
                if n not in existed:
                    continue
                for r in related(tgt):
                    if os.path.lexists(r):
                        os.unlink(r)
                if existed[n]:
                    for f in [tgt] + related(tgt):
                        s = os.path.join(safety, n + f[len(tgt):])
                        if os.path.exists(s):
                            shutil.copy2(s, f + ".restore-tmp")
                            os.replace(f + ".restore-tmp", f)
                elif os.path.lexists(tgt):
                    os.unlink(tgt)
            for u in reversed(active):
                systemctl("start", u + ".service")
            still = [u for u in active if not wait_active(u)]
            log("Đã trả lại dữ liệu cũ%s. Bản giữ lại: %s" % ((" (dịch vụ VẪN chưa chạy: %s)" % ", ".join(still)) if still else "", safety))
            return 1
        log("KHÔI PHỤC XONG (%d tệp; dịch vụ đã chạy lại: %s). Dữ liệu trước khi khôi phục giữ ở %s (có bí mật, chỉ root đọc; xoá khi không cần)."
            % (len(names), ", ".join(active) or "không có", safety))
        if "etc/diag-secret" in names:
            log("Lưu ý: đã khôi phục diag-secret — mã giả danh người dùng quay về theo bí mật trong gói.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="neu-agent-backup", description="Sao lưu / khôi phục dữ liệu NEU Agent (máy 220).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="tạo bản sao lưu ngay")
    sub.add_parser("list", help="liệt kê bản sao lưu")
    sub.add_parser("check", help="kiểm tra cấu hình (dùng khi cài)")
    v = sub.add_parser("verify", help="thử khôi phục vào thư mục tạm (không đụng hệ thống)")
    v.add_argument("archive")
    v.add_argument("--identity", help="tệp khoá riêng (age hoặc gpg) để giải mã")
    v.add_argument("--keep", action="store_true", help="giữ bản giải nén để xem")
    r = sub.add_parser("restore", help="khôi phục thật (cần --yes)")
    r.add_argument("archive")
    r.add_argument("--identity", help="tệp khoá riêng (age hoặc gpg) để giải mã")
    r.add_argument("--only", help="chỉ khôi phục các tệp này (tên trong gói, cách nhau dấu phẩy)")
    r.add_argument("--yes", action="store_true", help="thực sự thay tệp")
    a = ap.parse_args(argv)
    os.umask(0o077)
    return {"run": cmd_run, "list": cmd_list, "check": cmd_check, "verify": cmd_verify, "restore": cmd_restore}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
