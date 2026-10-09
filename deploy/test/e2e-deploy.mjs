// Chạy THỬ phần phía máy chủ của CI/CD (deploy/220/ci/setup-ci.sh + neu-agent-deploy) trong container Ubuntu 24.04 có nginx thật:
// cài người dùng/khoá SSH hạn chế/sudoers, nhận gói, từ chối gói xấu, áp dụng bằng install.sh thật, quay lại, khoá chống chạy song song.
//   node deploy/test/e2e-deploy.mjs        (cần Docker, mạng để apt-get)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + String(detail).slice(-420) : ""}`); };
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });
const C = "neu-deploy-test";
const ex = (script, o = {}) => { const r = sh("docker", ["exec", ...(o.user ? ["-u", o.user] : []), C, "bash", "-c", script]); return { ok: r.status === 0, code: r.status, out: (r.stdout + r.stderr).trim() }; };
const cleanup = () => sh("docker", ["rm", "-f", C]);
cleanup();

const STUB_SYSTEMCTL = `#!/bin/bash
case "$1" in is-active) exit 0;; reload) nginx -s reload;; *) exit 0;; esac`;
const STUB_OAUTH = `import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/agent/oauth2/auth'): self.send_response(401); self.end_headers()
        elif self.path.startswith('/agent/oauth2/start'):
            self.send_response(302); self.send_header('Location','https://login.microsoftonline.com/x/oauth2/v2.0/authorize'); self.end_headers()
        elif self.path=='/ping': self.send_response(200); self.end_headers(); self.wfile.write(b'OK')
        else: self.send_response(404); self.end_headers()
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1',4180),H).serve_forever()`;

// ---- gói thử trên máy này: deploy/220 (không có downloads/, tệp nặng, diag/ — diag cần systemd thật) + web.tar.gz nhỏ
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neu-dep-"));
const stage = path.join(tmp, "stage");
fs.cpSync(path.join(deploy, "220"), stage, { recursive: true, filter: (s) => !/\/(downloads|diag|ci)(\/|$)|\.tar\.gz$/.test(s) });
const webDir = path.join(tmp, "web");
fs.mkdirSync(webDir);
const mkWeb = (dir, body) => { fs.writeFileSync(path.join(dir, "index.html"), body); sh("tar", ["--no-xattrs", "-czf", path.join(stage, "web.tar.gz"), "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } }); };
const bundle = (name, dir = stage) => { const f = path.join(tmp, name); sh("tar", ["--no-xattrs", "-czf", f, "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } }); return f; };
const sha = (f) => sh("shasum", ["-a", "256", f]).stdout.split(" ")[0];
const put = (f, dest) => sh("docker", ["cp", f, `${C}:${dest}`]);
const deployCmd = (f, h = sha(f)) => { put(f, "/tmp/b.tgz"); return ex(`/usr/local/sbin/neu-agent-deploy '${h}' < /tmp/b.tgz`); };
const http = (p, extra = "") => ex(`curl -s -m 5 -o /dev/null -w '%{http_code}' ${extra} -H 'Host: ai.neu.edu.vn' http://127.0.0.1${p}`).out;

const STUB_DIAG = `import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def log_message(self,*a): pass
http.server.HTTPServer(('127.0.0.1',4190),H).serve_forever()`;

try {
  sh("docker", ["run", "-d", "--name", C, "ubuntu:24.04", "sleep", "infinity"]);
  console.log("Cài nginx + sudo trong container (apt)…");
  const ap = ex("export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null && apt-get install -y -qq nginx curl python3 openssl sudo util-linux >/dev/null 2>&1; nginx -v 2>&1; sudo -V | head -1");
  if (!ap.ok) throw new Error(ap.out);
  ex(`cat > /usr/local/bin/systemctl <<'EOF'\n${STUB_SYSTEMCTL}\nEOF\nchmod +x /usr/local/bin/systemctl; cat > /opt/oauth.py <<'EOF'\n${STUB_OAUTH}\nEOF\ncat > /opt/diag.py <<'EOF'\n${STUB_DIAG}\nEOF\n(nohup python3 /opt/oauth.py >/dev/null 2>&1 &) ; (nohup python3 /opt/diag.py >/dev/null 2>&1 &) ; rm -f /etc/nginx/sites-enabled/default; cat > /etc/nginx/sites-available/default <<'EOF'\nserver { listen 80 default_server; server_name _; location / { return 200 'OJ-DEFAULT'; } }\nEOF\nln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default; nginx; sleep 1`);
  sh("docker", ["cp", path.join(deploy, "220", "ci"), `${C}:/ci`]);
  ex("mkdir -p /srv/220/ci && cp -r /ci/. /srv/220/ci/");

  // ================================================================ setup-ci.sh
  ex("ssh-keygen -q -t ed25519 -N '' -f /tmp/k 2>/dev/null || (apt-get install -y -qq openssh-client >/dev/null 2>&1 && ssh-keygen -q -t ed25519 -N '' -f /tmp/k)");
  const pub = ex("cat /tmp/k.pub").out;
  for (const bad of ['command="id" ' + pub, "ssh-rsa AAAA" + "B".repeat(80) + " x", pub + "\nssh-ed25519 AAAA" + "C".repeat(70), 'restrict ' + pub, ""]) {
    const r = ex(`bash /srv/220/ci/setup-ci.sh --pubkey '${bad.replace(/'/g, "")}'`);
    check("setup-ci: khoá không hợp lệ/có tuỳ chọn đi kèm/nhiều dòng bị từ chối", !r.ok && /pubkey/.test(r.out) && !ex("id neu-deploy").ok, bad.slice(0, 30));
  }
  const su = ex(`bash /srv/220/ci/setup-ci.sh --pubkey '${pub}'`);
  check("setup-ci: cài xong, tự kiểm tra đạt (sudo đúng lệnh được, lệnh khác bị chặn)", su.ok && /sudo đúng lệnh=ok \| sudo lệnh khác bị chặn=ok/.test(su.out), su.out.split("\n").slice(-3).join(" | "));
  const ak = ex("cat /home/neu-deploy/.ssh/authorized_keys").out;
  check("authorized_keys: hạn chế (restrict + command), đúng một dòng, quyền 600 thuộc neu-deploy", /^restrict,command="sudo -n \/usr\/local\/sbin\/neu-agent-deploy \\"\$SSH_ORIGINAL_COMMAND\\"" ssh-ed25519 /.test(ak) && ak.split("\n").length === 1 && ex("stat -c '%a %U' /home/neu-deploy/.ssh/authorized_keys").out === "600 neu-deploy");
  const sd = ex("cat /etc/sudoers.d/neu-agent-ci; stat -c %a /etc/sudoers.d/neu-agent-ci; visudo -cf /etc/sudoers.d/neu-agent-ci");
  check("sudoers: chỉ cho neu-deploy chạy đúng /usr/local/sbin/neu-agent-deploy, hợp lệ, quyền 440", /neu-deploy ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/neu-agent-deploy\n/.test(sd.out) && /\n440\n/.test(sd.out) && /parsed OK/.test(sd.out) && (sd.out.match(/NOPASSWD/g) || []).length === 1, sd.out.split("\n").join(" | "));
  check("script cài đặt thuộc root và không ai khác ghi được", ex("stat -c '%U:%G %a' /usr/local/sbin/neu-agent-deploy").out === "root:root 755");
  const re = ex(`bash /srv/220/ci/setup-ci.sh --pubkey '${pub}' && grep -c ssh-ed25519 /home/neu-deploy/.ssh/authorized_keys`);
  check("setup-ci: chạy lại (đổi khoá/cập nhật) vẫn OK, không nhân đôi khoá", re.ok && /\n1$/.test(re.out));

  // ================================================================ cài nginx lần đầu để có "bản đang chạy" (key phải được nhập tay lần đầu)
  mkWeb(webDir, "<html>WEB-V1</html>");
  const b1 = bundle("b1.tgz");
  put(b1, "/tmp/b1.tgz");
  const first = ex("rm -rf /srv/220/inst && mkdir /srv/220/inst && tar -xzf /tmp/b1.tgz -C /srv/220/inst && cd /srv/220/inst && bash ./install.sh keyDeTest123 2>&1 | tail -12");
  check("nền: install.sh lần đầu (có key) chạy được", /OK: NEU Agent đã chạy/.test(first.out), first.out);
  check("nền: key nằm trong cấu hình nginx (640), web v1 đang chạy", ex("stat -c %a /etc/nginx/conf.d/neu-agent.conf; grep -c keyDeTest123 /etc/nginx/conf.d/neu-agent.conf; cat /var/www/neu-agent/index.html").out.includes("640\n1\n<html>WEB-V1"));

  // ================================================================ triển khai hợp lệ (khoá được dùng lại, KHÔNG cần nhập key)
  put(b1, "/tmp/b.tgz");
  check("trước khi triển khai: status chưa có bản nào", /đang chạy: *$/m.test(ex("sudo -u neu-deploy sudo -n /usr/local/sbin/neu-agent-deploy status").out));
  mkWeb(webDir, "<html>WEB-V2</html>");
  const b2 = bundle("b2.tgz");
  const d2 = deployCmd(b2);
  check("triển khai hợp lệ: DEPLOYED, web v2 đang chạy, /agent/ chuyển tới đăng nhập", d2.ok && /DEPLOYED \d{8}-\d{6}-/.test(d2.out) && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V2") && http("/agent/") === "302", d2.out.split("\n").slice(-4).join(" | "));
  check("key mô hình được dùng lại từ cấu hình đang chạy (không cần gửi key)", ex("grep -c keyDeTest123 /etc/nginx/conf.d/neu-agent.conf").out === "1");
  const rel = ex("ls /opt/neu-agent-deploy/releases | head -1").out;
  check("bản đã nhận thuộc root, nhóm/ai khác không ghi được; có liên kết current", ex(`stat -c '%U:%G' /opt/neu-agent-deploy/releases/${rel}; find /opt/neu-agent-deploy/releases/${rel} -perm /022 | wc -l; readlink /opt/neu-agent-deploy/current`).out.startsWith("root:root\n0\n/opt/neu-agent-deploy/releases/"));
  check("thư mục triển khai không đọc/ghi được bởi người dùng thường", !ex("ls /opt/neu-agent-deploy", { user: "nobody" }).ok);

  // ================================================================ gói xấu bị từ chối, bản đang chạy không đổi
  const cur = () => ex("readlink /opt/neu-agent-deploy/current").out;
  const before = cur();
  const bad = (name, fn, re) => { const r = fn(); check(name, !r.ok && re.test(r.out) && cur() === before && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V2"), r.out.split("\n").slice(-1)[0]); };
  bad("mã băm sai bị từ chối", () => deployCmd(b2, "0".repeat(64)), /Mã băm không khớp/);
  bad("mã băm không đúng dạng bị từ chối", () => deployCmd(b2, "abc; id"), /Cách dùng/);
  const py = (code) => ex(`python3 - <<'PY'\nimport tarfile, io\n${code}\nPY`);
  py(`t=tarfile.open('/tmp/trav.tgz','w:gz'); i=tarfile.TarInfo('../evil.txt'); d=b'x'; i.size=len(d); t.addfile(i, io.BytesIO(d)); t.close()`);
  bad("gói có đường dẫn '..' bị từ chối", () => ex(`/usr/local/sbin/neu-agent-deploy $(sha256sum /tmp/trav.tgz | cut -d' ' -f1) < /tmp/trav.tgz`), /nguy hiểm/);
  py(`t=tarfile.open('/tmp/abs.tgz','w:gz'); i=tarfile.TarInfo('/etc/evil.txt'); d=b'x'; i.size=len(d); t.addfile(i, io.BytesIO(d)); t.close()`);
  bad("gói có đường dẫn tuyệt đối bị từ chối", () => ex(`/usr/local/sbin/neu-agent-deploy $(sha256sum /tmp/abs.tgz | cut -d' ' -f1) < /tmp/abs.tgz`), /nguy hiểm/);
  py(`t=tarfile.open('/tmp/sym.tgz','w:gz'); i=tarfile.TarInfo('install.sh'); i.type=tarfile.SYMTYPE; i.linkname='/etc/passwd'; t.addfile(i); t.close()`);
  bad("gói chứa liên kết tượng trưng bị từ chối", () => ex(`/usr/local/sbin/neu-agent-deploy $(sha256sum /tmp/sym.tgz | cut -d' ' -f1) < /tmp/sym.tgz`), /liên kết/);
  ex("echo 'khong phai tar' > /tmp/junk.tgz");
  bad("tệp không phải tar.gz bị từ chối", () => ex(`/usr/local/sbin/neu-agent-deploy $(sha256sum /tmp/junk.tgz | cut -d' ' -f1) < /tmp/junk.tgz`), /không phải tar\.gz/);
  const noInst = fs.mkdtempSync(path.join(tmp, "noinst-"));
  fs.cpSync(stage, noInst, { recursive: true });
  fs.rmSync(path.join(noInst, "install.sh"));
  bad("gói thiếu install.sh bị từ chối", () => deployCmd(bundle("noinst.tgz", noInst)), /thiếu install\.sh/);
  bad("gói quá lớn bị từ chối (giới hạn đặt nhỏ để thử)", () => { put(b2, "/tmp/b.tgz"); return ex(`NEU_DEPLOY_MAX_BYTES=1000 /usr/local/sbin/neu-agent-deploy ${sha(b2)} < /tmp/b.tgz`); }, /quá lớn/);
  bad("gói rỗng bị từ chối", () => ex(`/usr/local/sbin/neu-agent-deploy ${"a".repeat(64)} < /dev/null`), /rỗng hoặc quá lớn/);
  const asNobody = ex(`/usr/local/sbin/neu-agent-deploy status`, { user: "nobody" });
  check("người dùng thường không chạy được script triển khai", !asNobody.ok && /root/.test(asNobody.out));

  // ================================================================ khoá SSH hạn chế: lệnh lạ không chạy được
  const cmdLine = ak.match(/command="((?:[^"\\]|\\.)*)"/)[1].replace(/\\"/g, '"');
  // mô phỏng sshd: đặt SSH_ORIGINAL_COMMAND ĐÚNG NGUYÊN VĂN chuỗi do máy khách gửi (đọc từ tệp để harness không tự diễn giải), rồi chạy chuỗi command= của authorized_keys
  const forced = (orig) => {
    sh("docker", ["exec", "-i", C, "bash", "-c", "cat > /tmp/evil.txt && chmod 644 /tmp/evil.txt"], { input: orig });
    return ex(`su -s /bin/bash neu-deploy -c 'export SSH_ORIGINAL_COMMAND="$(cat /tmp/evil.txt)"; bash -c "$0"' '${cmdLine.replace(/'/g, "")}'`);
  };
  for (const evil of ["status; touch /tmp/pwned", "$(touch /tmp/pwned)", "`touch /tmp/pwned`", "status && id", "bash -i", "cat /etc/shadow", "-c id"]) {
    const r = forced(evil);
    check(`khoá hạn chế: lệnh lạ "${evil}" KHÔNG được chạy`, !ex("test -e /tmp/pwned").ok && !/uid=0/.test(r.out) && !/root:/.test(r.out) && r.code !== 0);
  }
  check("khoá hạn chế: lệnh hợp lệ (status) chạy được", /đang chạy: \/opt\/neu-agent-deploy\/releases\//.test(forced("status").out));

  // ================================================================ web hỏng → triển khai thất bại, tự đưa về bản trước, site vẫn chạy
  fs.rmSync(path.join(stage, "web.tar.gz"));
  const empty = path.join(tmp, "emptyweb"); fs.mkdirSync(empty); fs.writeFileSync(path.join(empty, "README"), "khong co index.html");
  sh("tar", ["--no-xattrs", "-czf", path.join(stage, "web.tar.gz"), "-C", empty, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const bBad = bundle("bbad.tgz");
  const dbad = deployCmd(bBad);
  check("web hỏng (không có index.html): THẤT BẠI, bản đang chạy giữ nguyên, site vẫn phục vụ web v2", !dbad.ok && /THẤT BẠI/.test(dbad.out) && cur() === before && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V2") && http("/agent/") === "302", dbad.out.split("\n").slice(-3).join(" | "));
  check("bản hỏng bị dọn, không để lại thư mục", ex("ls /opt/neu-agent-deploy/releases | wc -l").out === "1");

  // ================================================================ bản mới, rồi rollback
  mkWeb(webDir, "<html>WEB-V3</html>");
  const b3 = bundle("b3.tgz");
  const d3 = deployCmd(b3);
  check("triển khai bản v3 thành công; liên kết previous = bản v2", d3.ok && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V3") && ex("readlink /opt/neu-agent-deploy/previous").out === before);
  const rb = ex("/usr/local/sbin/neu-agent-deploy rollback");
  check("rollback: quay về web v2, current ↔ previous đổi chỗ", rb.ok && /ROLLED_BACK/.test(rb.out) && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V2") && cur() === before, rb.out.split("\n").slice(-2).join(" | "));
  const rb2 = ex("/usr/local/sbin/neu-agent-deploy rollback");
  check("rollback lần nữa: quay lại v3 (đảo chiều được)", rb2.ok && ex("cat /var/www/neu-agent/index.html").out.includes("WEB-V3"));

  // ================================================================ chỉ một lần triển khai tại một thời điểm
  put(b3, "/tmp/b3.tgz");
  const h3 = sha(b3);
  sh("docker", ["exec", "-d", C, "bash", "-c", `(sleep 6) | /usr/local/sbin/neu-agent-deploy ${h3} > /tmp/hold.out 2>&1`]);
  sh("sleep", ["1"]);
  const second = ex(`/usr/local/sbin/neu-agent-deploy ${h3} < /tmp/b3.tgz`);
  check("đang có lần triển khai khác: lần thứ hai bị từ chối ngay (mã 75), không chạy song song", second.code === 75 && /khác/.test(second.out), second.out);
  sh("sleep", ["7"]);

  // ================================================================ dọn bản cũ: giữ 5 bản gần nhất
  for (let i = 4; i <= 9; i++) {
    mkWeb(webDir, `<html>WEB-V${i}</html>`);
    const r = deployCmd(bundle(`b${i}.tgz`));
    if (!r.ok) { check(`triển khai v${i}`, false, r.out); break; }
    sh("sleep", ["1"]);
  }
  check("giữ 5 bản mới nhất (+ current/previous được ghim, không bị xoá dù cũ)", Number(ex("ls /opt/neu-agent-deploy/releases | wc -l").out) <= 7 && ex("test -d $(readlink /opt/neu-agent-deploy/current) && test -d $(readlink /opt/neu-agent-deploy/previous)").ok, ex("ls /opt/neu-agent-deploy/releases | wc -l").out);

  // ================================================================ phát hành bản cài Desktop (publish-desktop)
  const crypto = await import("node:crypto");
  const mkDesktop = (version, o = {}) => {
    const dir = fs.mkdtempSync(path.join(tmp, `desk-${version}-`));
    const names = [`NEU-Agent-${version}-mac-arm64.dmg`, `NEU-Agent-${version}-mac-x64.dmg`, `NEU-Agent-${version}-win-x64.exe`];
    const files = {};
    for (const n of names) { const b = crypto.randomBytes(40_000); fs.writeFileSync(path.join(dir, n), b); files[n] = { sha256: crypto.createHash("sha256").update(b).digest("hex"), size: b.length }; }
    fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), names.map((n) => `${files[n].sha256}  ${n}`).join("\n") + "\n");
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version: o.jsonVersion ?? version, released: "2026-10-09", notes: "Thêm\n• thử nghiệm", files: o.files ?? files, signed: { mac: false, win: false } }));
    fs.writeFileSync(path.join(dir, "HUONG-DAN-CAI-DAT.md"), "# hướng dẫn");
    fs.writeFileSync(path.join(dir, "BAO-MAT.md"), "# bảo mật");
    fs.writeFileSync(path.join(dir, "MANIFEST"), "commit=0123456789abcdef0123\nrun=4242\nactor=ci-bot\n");
    o.mutate?.(dir, files);
    return dir;
  };
  const pubCmd = (dir, h) => { const f = bundle(path.basename(dir) + ".tgz", dir); put(f, "/tmp/d.tgz"); return ex(`/usr/local/sbin/neu-agent-deploy 'publish-desktop ${h ?? sha(f)}' < /tmp/d.tgz`); };
  const dl = (cmd) => ex(`cd /var/www/neu-agent-dl && ${cmd}`).out;
  const dlVersion = () => dl("python3 -c \"import json;print(json.load(open('latest.json'))['version'])\"");

  const p1 = pubCmd(mkDesktop("9.1.0"));
  check("publish-desktop 9.1.0: PUBLISHED, tệp + latest.json + SHA256SUMS có mặt, quyền 644", p1.ok && /PUBLISHED_DESKTOP 9\.1\.0/.test(p1.out) && dlVersion() === "9.1.0" && dl("ls NEU-Agent-9.1.0-* | wc -l") === "3" && dl("stat -c %a latest.json SHA256SUMS.txt NEU-Agent-9.1.0-win-x64.exe | tr '\\n' ' '") === "644 644 644" && dl("sha256sum -c SHA256SUMS.txt >/dev/null && echo OK") === "OK", p1.out.split("\n").slice(-2).join(" | "));
  const p2 = pubCmd(mkDesktop("9.2.0"));
  check("publish-desktop 9.2.0: giữ cả 9.1.0 (để quay lui); SHA256SUMS liệt kê cả hai bản", p2.ok && dlVersion() === "9.2.0" && dl("ls NEU-Agent-* | wc -l") === "6" && dl("grep -c 'NEU-Agent-' SHA256SUMS.txt") === "6");
  const p3 = pubCmd(mkDesktop("9.3.0"));
  check("publish-desktop 9.3.0: chỉ giữ 2 bản mới nhất (9.1.0 bị dọn)", p3.ok && dlVersion() === "9.3.0" && dl("ls NEU-Agent-* | wc -l") === "6" && dl("ls NEU-Agent-9.1.0-* 2>/dev/null | wc -l") === "0" && dl("sha256sum -c SHA256SUMS.txt >/dev/null && echo OK") === "OK");
  const keepSums = dl("sha256sum latest.json SHA256SUMS.txt NEU-Agent-9.3.0-mac-arm64.dmg");
  const rejectDesk = (name, dir, re) => { const r = pubCmd(dir); check(name, !r.ok && re.test(r.out) && dl("sha256sum latest.json SHA256SUMS.txt NEU-Agent-9.3.0-mac-arm64.dmg") === keepSums && dl("ls .tmp.* 2>/dev/null | wc -l") === "0", r.out.split("\n").slice(-2).join(" | ")); };
  rejectDesk("hạ phiên bản (9.0.0 < 9.3.0) bị từ chối, trang tải không đổi", mkDesktop("9.0.0"), /Không hạ phiên bản/);
  rejectDesk("tệp cài bị sửa so với mã băm khai trong latest.json bị từ chối", mkDesktop("9.4.0", { mutate: (d) => fs.appendFileSync(path.join(d, "NEU-Agent-9.4.0-win-x64.exe"), "x") }), /không hợp lệ.*(sai kích thước|sai SHA)|SHA256SUMS|sai/);
  rejectDesk("latest.json khai sai SHA-256 bị từ chối", mkDesktop("9.4.0", { mutate: (d, f) => { const j = JSON.parse(fs.readFileSync(path.join(d, "latest.json"))); Object.values(j.files)[0].sha256 = "0".repeat(64); fs.writeFileSync(path.join(d, "latest.json"), JSON.stringify(j)); } }), /sai SHA-256/);
  rejectDesk("SHA256SUMS.txt không khớp tệp bị từ chối", mkDesktop("9.4.0", { mutate: (d) => fs.writeFileSync(path.join(d, "SHA256SUMS.txt"), `${"1".repeat(64)}  NEU-Agent-9.4.0-mac-arm64.dmg\n`) }), /SHA256SUMS\.txt không khớp/);
  rejectDesk("tên tệp ngoài danh sách (evil.sh) bị từ chối", mkDesktop("9.4.0", { mutate: (d) => fs.writeFileSync(path.join(d, "evil.sh"), "id") }), /Tên tệp không được phép: evil\.sh/);
  rejectDesk("tệp cài của phiên bản KHÁC với latest.json bị từ chối", mkDesktop("9.4.0", { jsonVersion: "9.5.0" }), /tên tệp sai phiên bản/);
  rejectDesk("gói thiếu latest.json bị từ chối", mkDesktop("9.4.0", { mutate: (d) => fs.rmSync(path.join(d, "latest.json")) }), /Thiếu latest\.json/);
  rejectDesk("gói có thư mục con bị từ chối", mkDesktop("9.4.0", { mutate: (d) => { fs.mkdirSync(path.join(d, "sub")); fs.writeFileSync(path.join(d, "sub", "x.dmg"), "x"); } }), /chỉ được chứa tệp ở cấp trên cùng/);
  const dsha = sha(bundle("dd.tgz", mkDesktop("9.4.0")));
  put(path.join(tmp, "dd.tgz"), "/tmp/d.tgz");
  check("publish-desktop: mã băm sai bị từ chối; tham số thừa/sai dạng bị từ chối", !ex(`/usr/local/sbin/neu-agent-deploy 'publish-desktop ${"0".repeat(64)}' < /tmp/d.tgz`).ok && /Thừa tham số/.test(ex(`/usr/local/sbin/neu-agent-deploy 'publish-desktop ${dsha} thừa' < /tmp/d.tgz`).out) && /Thừa tham số|Cách dùng/.test(ex(`/usr/local/sbin/neu-agent-deploy 'publish-desktop abc; id' < /tmp/d.tgz`).out) && !/uid=0/.test(ex(`/usr/local/sbin/neu-agent-deploy 'publish-desktop abc; id' < /tmp/d.tgz`).out) && dlVersion() === "9.3.0");
  check("bản cài Desktop quá lớn bị từ chối (giới hạn đặt nhỏ để thử)", /quá lớn/.test(ex(`NEU_DEPLOY_MAX_DESKTOP_BYTES=1000 /usr/local/sbin/neu-agent-deploy 'publish-desktop ${dsha}' < /tmp/d.tgz`).out) && dlVersion() === "9.3.0");
  const dep10 = deployCmd(bundle("b10.tgz"));
  check("triển khai web KHÔNG đụng tới trang tải Desktop (vẫn 9.3.0, mã băm không đổi)", dep10.ok && dl("sha256sum latest.json SHA256SUMS.txt NEU-Agent-9.3.0-mac-arm64.dmg") === keepSums);
  const stt = ex("/usr/local/sbin/neu-agent-deploy status").out;
  check("status in phiên bản Desktop đang phát hành và lịch sử có đủ: ai, commit, kết quả (kể cả bị từ chối)", /Desktop đang phát hành: 9\.3\.0/.test(stt) && /\| publish-desktop \| ok +\| Desktop 9\.3\.0 \| commit 0123456789ab \| ci-bot \| run 4242/.test(ex("cat /opt/neu-agent-deploy/history.log").out) && /lịch sử gần nhất/.test(stt) && /REJECT|FAIL/.test(ex("cat /opt/neu-agent-deploy/history.log").out), stt.split("\n").slice(-4).join(" | "));
  check("lịch sử chỉ root đọc được (quyền 640 root)", ex("stat -c '%a %U' /opt/neu-agent-deploy/history.log").out === "640 root");

  // ================================================================ gỡ
  const un = ex("bash /srv/220/ci/setup-ci.sh --uninstall");
  check("setup-ci --uninstall: gỡ người dùng, sudoers, script; giữ các bản đã triển khai", un.ok && !ex("id neu-deploy").ok && !ex("test -e /etc/sudoers.d/neu-agent-ci || test -e /usr/local/sbin/neu-agent-deploy").ok && ex("test -d /opt/neu-agent-deploy/releases").ok);
} catch (e) {
  console.error("LỖI:", e.stack ?? e);
  results.push(false);
} finally {
  cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const badN = results.filter((x) => !x).length;
console.log(badN ? `\n${badN}/${results.length} kiểm tra THẤT BẠI` : `\nTất cả ${results.length} kiểm tra đạt`);
process.exit(badN ? 1 : 0);
