// Chạy THỬ sao lưu dữ liệu máy 220 (deploy/220/backup) trong container Ubuntu 24.04 có systemd THẬT (để thử cả sandbox của dịch vụ),
// age thật, và một container "máy đích" nhận bản sao qua rsync/SSH với rrsync chỉ-cho-ghi.
//   node deploy/test/e2e-backup.mjs        (cần Docker chạy được container --privileged, mạng để apt-get)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderedDeploy } from "./site.mjs";

const deploy = renderedDeploy();
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`); };
const sh = (cmd, a, input) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, input });
const ex = (c, script) => { const r = sh("docker", ["exec", "-i", c, "bash", "-c", script]); return { ok: r.status === 0, code: r.status, out: (r.stdout + r.stderr).trim() }; };
const N = "neu-bk-220", K = "neu-bk-kho", NET = "neu-bk";
const cleanup = () => { sh("docker", ["rm", "-f", N, K]); sh("docker", ["network", "rm", NET]); };
const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "neu-bk-key-"));   // khoá riêng age: chỉ ở máy "quản trị" (ở đây: máy chạy bài thử), không ở 220
cleanup();

// dịch vụ giả cùng tên với dịch vụ thật (chạy bằng neu-diag): "quota" giữ CSDL WAL mở với dữ liệu MỚI chưa checkpoint, như cổng hạn mức thật
const WRITER = `import sqlite3, time
db = sqlite3.connect("/var/lib/neu-agent/quota/usage.db", isolation_level=None)
db.execute("PRAGMA journal_mode=WAL"); db.execute("PRAGMA wal_autocheckpoint=0")
db.execute("CREATE TABLE IF NOT EXISTS usage(day TEXT, user TEXT, tokens INT)")
if db.execute("SELECT COUNT(*) FROM usage").fetchone()[0] == 0:
    db.execute("INSERT INTO usage VALUES('2026-10-15','u1',100)"); db.execute("INSERT INTO usage VALUES('2026-10-15','u2',250)")
while True: time.sleep(60)`;
const UNIT_QUOTA = `[Service]\nUser=neu-diag\nExecStartPre=/bin/sh -c '! test -e /run/fail-quota'\nExecStart=/usr/bin/python3 /opt/writer.py\n[Install]\nWantedBy=multi-user.target\n`;
const UNIT_DIAG = `[Service]\nUser=neu-diag\nExecStart=/bin/sleep infinity\n`;
const HT = "khach01:$2b$12$6uU8iyrzPR5TDPA.F1mYJ.5HLjUN8.ynVbRqrP1MJarK1gQ/ZO/Hq";
const asNeu = (sql, db) => `runuser -u neu-diag -- python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()' ${db} "${sql}"`;
const q = (c, sql, db) => ex(c, `python3 -c 'import sqlite3,sys; print(sqlite3.connect("file:"+sys.argv[1]+"?mode=ro", uri=True).execute(sys.argv[2]).fetchone()[0])' ${db} "${sql}"`).out;
const FB = "/var/lib/neu-agent/feedback/feedback.db";
const OUT = "/var/backups/neu-agent-data";
const newest = () => ex(N, `ls -1 ${OUT} | grep -E '^neu-agent-data-.*\\.age$' | tail -1`).out;
const notOwned = () => ex(N, "find /var/lib/neu-agent ! -user neu-diag | wc -l").out;

try {
  sh("docker", ["network", "create", NET]);
  const apt = "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null && apt-get install -y -qq";
  let r = sh("docker", ["run", "-d", "--name", N, "--hostname", "may220", "--network", NET, "--privileged", "--tmpfs", "/run", "--tmpfs", "/run/lock", "ubuntu:24.04", "bash", "-c",
    `${apt} systemd systemd-sysv python3 age rsync openssh-client sqlite3 >/dev/null 2>&1; touch /apt-done; exec /lib/systemd/systemd`]);
  if (r.status !== 0) throw new Error(r.stderr);
  r = sh("docker", ["run", "-d", "--name", K, "--network", NET, "ubuntu:24.04", "bash", "-c",
    `${apt} openssh-server rsync python3 >/dev/null 2>&1; useradd -m bk; install -d -o bk -g bk -m 700 /home/bk/.ssh /srv/neu-agent-backup; mkdir -p /run/sshd; ssh-keygen -A >/dev/null; touch /apt-done; exec /usr/sbin/sshd -D`]);
  if (r.status !== 0) throw new Error(r.stderr);
  console.log("Cài gói trong container (apt)…");
  for (const c of [N, K]) {
    let up = false;
    for (let i = 0; i < 200 && !up; i++) { up = ex(c, "test -e /apt-done").ok; if (!up) sh("sleep", ["3"]); }
    if (!up) throw new Error(c + ": apt-get chưa xong");
  }
  for (let i = 0; i < 30 && !/running|degraded/.test(ex(N, "systemctl is-system-running").out); i++) sh("sleep", ["1"]);

  // ---- dữ liệu giống máy thật: thư mục của neu-diag, tệp chỉ-root ở /etc/neu-agent
  ex(N, `useradd --system --no-create-home --shell /usr/sbin/nologin neu-diag
install -d -m 0750 -o neu-diag -g neu-diag /var/lib/neu-agent /var/lib/neu-agent/quota; install -d -m 0700 -o neu-diag -g neu-diag /var/lib/neu-agent/feedback /var/lib/neu-agent/diag
install -d -m 0750 /etc/neu-agent; install -d -m 0700 /var/lib/neu-agent-accounts
(umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n' > /etc/neu-agent/diag-secret; echo '${HT}' > /etc/neu-agent/users.htpasswd)
echo a@neu.edu.vn > /etc/neu-agent/admins.txt; echo '{"tiers":{}}' > /etc/neu-agent/quota.json; chmod 640 /etc/neu-agent/admins.txt /etc/neu-agent/quota.json
echo '{"op":"add","name":"khach01"}' > /var/lib/neu-agent-accounts/audit.jsonl
runuser -u neu-diag -- sh -c 'umask 077; echo "{\\"days\\":{}}" > /var/lib/neu-agent/quota/grants.json; echo "{\\"users\\":{}}" > /var/lib/neu-agent/diag/users-seen.json'`);
  ex(N, asNeu("CREATE TABLE fb(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO fb(body) VALUES('gop y 1'),('gop y 2'),('gop y 3');", FB));
  ex(N, asNeu("CREATE TABLE s(id TEXT);", "/var/lib/neu-agent/feedback/shares.db"));
  sh("docker", ["exec", "-i", N, "bash", "-c", "cat > /opt/writer.py"], WRITER);
  sh("docker", ["exec", "-i", N, "bash", "-c", "cat > /etc/systemd/system/neu-agent-quota.service"], UNIT_QUOTA);
  sh("docker", ["exec", "-i", N, "bash", "-c", "cat > /etc/systemd/system/neu-agent-diag.service"], UNIT_DIAG);
  ex(N, "systemctl daemon-reload && systemctl start neu-agent-quota neu-agent-diag; sleep 2");
  check("chuẩn bị: CSDL hạn mức WAL đang mở, có dữ liệu chưa checkpoint", ex(N, "test -s /var/lib/neu-agent/quota/usage.db-wal && systemctl is-active neu-agent-quota").ok);

  // ---- khoá age: tạo rồi lấy khoá riêng RA KHỎI máy 220 ngay
  ex(N, "age-keygen -o /root/rieng.age 2>/dev/null");
  sh("docker", ["cp", `${N}:/root/rieng.age`, path.join(keyDir, "rieng.age")]);
  const pub = ex(N, "age-keygen -y /root/rieng.age").out;
  const priv = fs.readFileSync(path.join(keyDir, "rieng.age"), "utf8").match(/AGE-SECRET-KEY-\S+/)[0];
  ex(N, "shred -u /root/rieng.age 2>/dev/null || rm -f /root/rieng.age");
  ex(N, "mkdir -p /deploy/220");
  for (const d of ["backup", "diag", "quota", "auth", "users.sh"]) sh("docker", ["cp", path.join(deploy, "220", d), `${N}:/deploy/220/${d}`]);   // backup/ + các thư mục bài thử của nó đối chiếu

  const bad = ex(N, `cd /deploy/220 && bash ./backup/install-backup.sh --recipient '${priv}'`);
  check("đưa KHOÁ RIÊNG vào --recipient bị từ chối trước khi cài gì", !bad.ok && /KHOÁ RIÊNG/.test(bad.out) && !ex(N, "test -e /etc/systemd/system/neu-agent-backup.service || test -e /etc/neu-agent/backup-recipients.txt").ok);

  const ins = ex(N, `cd /deploy/220 && bash ./backup/install-backup.sh --recipient '${pub}' --keep 3 --remote bk@${K}:`);
  console.log(ins.out.split("\n").slice(-7).join("\n"));
  check("cài: chạy xong, báo OK (máy đích chưa nhận khoá → chỉ cảnh báo)", ins.ok && /OK: sao lưu hằng đêm/.test(ins.out) && /CẢNH BÁO: chưa đẩy được/.test(ins.out));
  const warn = ins.out.split("\n").filter((l) => l.includes("[systemd-analyze]") && l.includes("neu-agent-backup"));
  check("systemd-analyze verify không cảnh báo gì về đơn vị sao lưu", warn.length === 0, warn.join(" | ").slice(0, 300));
  check("lịch hằng đêm đã bật", ex(N, "systemctl is-enabled neu-agent-backup.timer && systemctl is-active neu-agent-backup.timer").ok);
  let arc = newest();
  check("bản sao lưu: tệp .age quyền 600 trong thư mục 700, đúng dạng age", !!arc && ex(N, `[ "$(stat -c %a ${OUT})" = 700 ] && [ "$(stat -c %a ${OUT}/${arc})" = 600 ] && head -c 21 ${OUT}/${arc} | grep -q age-encryption.org`).ok, arc);
  check("bản sao lưu không chứa bí mật/băm mật khẩu ở dạng rõ", !!arc && !ex(N, `grep -aqF "$(cat /etc/neu-agent/diag-secret)" ${OUT}/${arc} || grep -aqF khach01 ${OUT}/${arc}`).ok);
  check("chạy bằng root trong sandbox nhưng KHÔNG để lại tệp root trong thư mục dữ liệu (-shm của SQLite trả về neu-diag)", !!arc && notOwned() === "0", notOwned());
  check("dịch vụ đang chạy không bị ảnh hưởng", ex(N, "systemctl is-active neu-agent-quota neu-agent-diag").ok);
  check("nhật ký dịch vụ không in bí mật", !ex(N, `journalctl -u neu-agent-backup --no-pager | grep -qF "$(cat /etc/neu-agent/diag-secret)"`).ok);

  // ---- máy đích: chỉ cho ghi (rrsync -wo -no-del), khoá máy đích đã ghim lúc cài
  const ak = ins.out.split("\n").find((l) => l.includes("rrsync -wo -no-del"))?.trim() ?? "";
  sh("docker", ["exec", "-i", K, "bash", "-c", "cat > /home/bk/.ssh/authorized_keys && chown bk:bk /home/bk/.ssh/authorized_keys && chmod 600 /home/bk/.ssh/authorized_keys"], ak + "\n");
  sh("sleep", ["1.1"]);
  const pushed = ex(N, "systemctl start neu-agent-backup.service && cat /var/backups/neu-agent-data/last.json");
  check("đẩy sang máy đích qua rsync/SSH (chỉ mở mạng tới đúng máy đó)", pushed.ok && /"pushed": true/.test(pushed.out) && Number(ex(K, `ls /srv/neu-agent-backup | grep -c '\\.age$'`).out) >= 1, ex(K, "ls /srv/neu-agent-backup").out.replace(/\n/g, " "));
  check("drop-in mạng chỉ cho phép máy đích", /IPAddressAllow=localhost \d/.test(ex(N, "cat /etc/systemd/system/neu-agent-backup.service.d/remote.conf").out));
  check("máy đích không cho 220 đọc lại bản sao (rrsync chỉ-ghi)", pushed.ok && !ex(N, `rsync -e "ssh -F none -i /etc/neu-agent/backup-ssh-key -o BatchMode=yes -o UserKnownHostsFile=/etc/neu-agent/backup-known_hosts" bk@${K}:${newest()} /tmp/x`).ok);

  // ---- thử khôi phục vào thư mục tạm (khoá riêng chép tạm vào rồi xoá)
  arc = newest();
  sh("docker", ["cp", path.join(keyDir, "rieng.age"), `${N}:/root/tam.age`]);
  const ver = ex(N, `neu-agent-backup verify ${OUT}/${arc} --identity /root/tam.age`);
  console.log(ver.out);
  check("thử khôi phục: ĐẠT, đủ 10 tệp, gồm dữ liệu còn nằm trong -wal", ver.ok && /THỬ KHÔI PHỤC: ĐẠT/.test(ver.out) && /quota\/usage\.db\s+1 bảng, 2 dòng/.test(ver.out) && /10 tệp/.test(ver.out));
  check("thử khôi phục không để lại gì trong /tmp", ver.ok && ex(N, "ls /tmp | grep -c neu-agent-restore-test").out === "0");
  const wrong = ex(N, `age-keygen -o /root/khac.age 2>/dev/null; neu-agent-backup verify ${OUT}/${arc} --identity /root/khac.age`);
  check("khoá sai → KHÔNG ĐẠT", !wrong.ok && /KHÔNG ĐẠT/.test(wrong.out));

  // ---- khôi phục thật: làm hỏng dữ liệu rồi khôi phục
  ex(N, asNeu("DELETE FROM fb;", FB) + "; echo hong > /etc/neu-agent/diag-secret");
  const dry = ex(N, `neu-agent-backup restore ${OUT}/${arc} --identity /root/tam.age`);
  check("khôi phục không có --yes: chỉ in kế hoạch, không đổi gì", dry.ok && /--yes/.test(dry.out) && q(N, "SELECT COUNT(*) FROM fb", FB) === "0");
  const rs = ex(N, `neu-agent-backup restore ${OUT}/${arc} --identity /root/tam.age --yes`);
  console.log(rs.out.split("\n").slice(-2).join("\n"));
  check("khôi phục: dữ liệu về như bản sao lưu, dịch vụ chạy lại", rs.ok && q(N, "SELECT COUNT(*) FROM fb", FB) === "3" && ex(N, "grep -qv hong /etc/neu-agent/diag-secret && systemctl is-active neu-agent-quota neu-agent-diag").ok);
  check("khôi phục: chủ/quyền tệp đúng (neu-diag cho dữ liệu, root 600 cho bí mật)", rs.ok && notOwned() === "0" && ex(N, `[ "$(stat -c %U ${FB})" = neu-diag ] && [ "$(stat -c %U:%a /etc/neu-agent/diag-secret)" = root:600 ]`).ok);
  check("khôi phục: dữ liệu trong -wal của bản sao cũng về", rs.ok && q(N, "SELECT SUM(tokens) FROM usage", "/var/lib/neu-agent/quota/usage.db") === "350");

  // ---- khôi phục lỗi giữa chừng (dịch vụ không chạy lại) → tự trả lại dữ liệu trước khi khôi phục
  ex(N, "echo truoc-khi-khoi-phuc > /etc/neu-agent/diag-secret; touch /run/fail-quota");
  const rb = ex(N, `neu-agent-backup restore ${OUT}/${arc} --identity /root/tam.age --yes`);
  check("dịch vụ không chạy lại sau khôi phục → tự trả lại dữ liệu cũ", !rb.ok && /trả lại/.test(rb.out) && ex(N, "grep -qx truoc-khi-khoi-phuc /etc/neu-agent/diag-secret").ok);
  ex(N, "rm -f /run/fail-quota; systemctl start neu-agent-quota; shred -u /root/tam.age /root/khac.age 2>/dev/null; rm -f /root/tam.age /root/khac.age");

  // ---- giữ N bản trên máy; máy đích giữ hết (không xoá được)
  for (let i = 0; i < 4; i++) { sh("sleep", ["1.1"]); ex(N, "systemctl start neu-agent-backup.service"); }
  const local = ex(N, `ls ${OUT} | grep -c '\\.age$'`).out, remote = ex(K, `ls /srv/neu-agent-backup | grep -c '\\.age$'`).out;
  check("giữ đúng KEEP=3 bản trên máy, máy đích vẫn còn các bản cũ", local === "3" && Number(remote) >= 5, `máy: ${local}, đích: ${remote}`);

  // ---- chạy lại, cấu hình xấu, gỡ
  const again = ex(N, "cd /deploy/220 && bash ./backup/install-backup.sh");
  check("chạy lại không tham số: OK, giữ cấu hình (idempotent)", again.ok && /Đã đẩy sang/.test(again.out) && /KEEP=3/.test(ex(N, "cat /etc/neu-agent/backup.conf").out));
  ex(N, "printf -- '-----BEGIN PGP PRIVATE KEY BLOCK-----\\nx\\n-----END PGP PRIVATE KEY BLOCK-----\\n' > /tmp/rieng.asc");
  const badg = ex(N, "cd /deploy/220 && bash ./backup/install-backup.sh --gpg-key /tmp/rieng.asc");
  check("khoá riêng gpg bị từ chối, cấu hình cũ giữ nguyên", !badg.ok && ex(N, "test -s /etc/neu-agent/backup-recipients.txt && ! test -e /etc/neu-agent/backup-recipient.asc").ok);
  ex(N, "sed -i 's/^KEEP=.*/KEEP=khong-phai-so/' /etc/neu-agent/backup.conf");
  const badc = ex(N, "cd /deploy/220 && bash ./backup/install-backup.sh");
  check("cấu hình hỏng → cài thất bại và tự khôi phục tệp cấu hình cũ", !badc.ok && /khôi phục/.test(badc.out) && /KEEP=khong-phai-so/.test(ex(N, "cat /etc/neu-agent/backup.conf").out) && ex(N, "systemctl is-enabled neu-agent-backup.timer").ok);
  ex(N, "sed -i 's/^KEEP=.*/KEEP=3/' /etc/neu-agent/backup.conf");
  const nr = ex(N, "cd /deploy/220 && bash ./backup/install-backup.sh --no-remote");
  check("--no-remote: bỏ drop-in, dịch vụ quay về không có mạng", nr.ok && ex(N, "! test -e /etc/systemd/system/neu-agent-backup.service.d/remote.conf && systemctl show neu-agent-backup -p PrivateNetwork | grep -q yes").ok);
  const un = ex(N, "cd /deploy/220 && bash ./backup/install-backup.sh --uninstall");
  check("--uninstall: gỡ lịch, GIỮ các bản sao lưu", un.ok && !ex(N, "systemctl is-enabled neu-agent-backup.timer").ok && Number(ex(N, `ls ${OUT} | grep -c '\\.age$'`).out) >= 1);
} catch (e) {
  console.error("LỖI:", e.stack ?? e);
  results.push(false);
} finally {
  cleanup();
  fs.rmSync(keyDir, { recursive: true, force: true });
}
const nbad = results.filter((x) => !x).length;
console.log(nbad ? `\n${nbad}/${results.length} kiểm tra THẤT BẠI` : `\nTất cả ${results.length} kiểm tra đạt`);
process.exit(nbad ? 1 : 0);
