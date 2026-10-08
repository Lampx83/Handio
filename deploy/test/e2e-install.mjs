// Chạy THỬ các script cài (deploy/220/install.sh và deploy/222/install.sh) trong hai container Ubuntu 24.04 có nginx thật,
// với các site "khác" (kiểu OJ Judge ở 220, ứng dụng khác ở 222) để chắc chắn script không đụng tới và tự khôi phục khi lỗi.
//   node deploy/test/e2e-install.mjs        (cần Docker, mạng để apt-get)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`); };
const sh = (cmd, a) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const ex = (c, script) => { const r = sh("docker", ["exec", c, "bash", "-c", script]); return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() }; };
const cleanup = () => { sh("docker", ["rm", "-f", "neu-220", "neu-222"]); sh("docker", ["network", "rm", "neu-inst"]); };
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

try {
  sh("docker", ["network", "create", "neu-inst"]);
  for (const c of ["neu-220", "neu-222"]) {
    const r = sh("docker", ["run", "-d", "--name", c, "--network", "neu-inst", "ubuntu:24.04", "sleep", "infinity"]);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  console.log("Cài nginx trong container (apt)…");
  for (const c of ["neu-220", "neu-222"]) {
    const r = ex(c, "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq >/dev/null && apt-get install -y -qq nginx curl python3 openssl >/dev/null 2>&1; nginx -v 2>&1");
    if (!r.ok) throw new Error(c + ": " + r.out);
  }
  // gói thử: chỉ cấu hình + web.tar.gz (không chép bản cài nặng)
  const pkg = (name, files) => { ex(name, "mkdir -p /deploy/222"); for (const f of files) sh("docker", ["cp", path.join(deploy, f), `${name}:/deploy/${f}`]); };
  ex("neu-220", "mkdir -p /deploy/220/downloads");
  for (const f of ["install.sh", "neu-agent.http.conf", "neu-agent.server.conf", "neu-agent.locations.conf", "neu-agent-auth.conf", "web.tar.gz"]) sh("docker", ["cp", path.join(deploy, "220", f), `neu-220:/deploy/220/${f}`]);
  sh("docker", ["cp", path.join(deploy, "220/downloads/SHA256SUMS.txt"), "neu-220:/deploy/220/downloads/SHA256SUMS.txt"]);
  ex("neu-220", "echo -n x > /deploy/220/downloads/NEU-Agent-0.1.0-mac-arm64.dmg; cd /deploy/220/downloads && grep -v 'mac-x64\\|win-x64' SHA256SUMS.txt | sed 's/^[0-9a-f]*/'$(sha256sum NEU-Agent-0.1.0-mac-arm64.dmg | cut -d' ' -f1)'/' > S && mv S SHA256SUMS.txt");
  pkg("neu-222", ["222/install.sh", "222/neu-agent-locations.conf"]);

  // ================================================================ máy 220
  ex("neu-220", `cat > /usr/local/bin/systemctl <<'EOF'\n${STUB_SYSTEMCTL}\nEOF\nchmod +x /usr/local/bin/systemctl; cat > /tmp/oauth.py <<'EOF'\n${STUB_OAUTH}\nEOF\n(nohup python3 /tmp/oauth.py >/dev/null 2>&1 &)`);
  // site "khác" có sẵn trên 220: mặc định (cổng 80) và kiểu OJ Judge (cổng 8017)
  ex("neu-220", `rm -f /etc/nginx/sites-enabled/default; cat > /etc/nginx/sites-available/default <<'EOF'\nserver { listen 80 default_server; server_name _; location / { return 200 'OJ-DEFAULT'; } }\nEOF\ncat > /etc/nginx/sites-available/judge_servers_public <<'EOF'\nserver { listen 8017; server_name 192.0.2.20; location / { return 200 'JUDGE'; } }\nEOF\nln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default; ln -sf /etc/nginx/sites-available/judge_servers_public /etc/nginx/sites-enabled/judge_servers_public; nginx -t 2>&1 && nginx`);
  const c220 = (p, h = "ai.neu.edu.vn") => ex("neu-220", `curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ${h}' http://127.0.0.1${p}`).out;
  check("220 trước khi cài: site khác chạy bình thường", ex("neu-220", "curl -s -m 5 http://127.0.0.1/").out === "OJ-DEFAULT" && ex("neu-220", "curl -s -m 5 http://127.0.0.1:8017/").out === "JUDGE");

  const ins = ex("neu-220", "cd /deploy/220 && bash ./install.sh testkey123");
  console.log(ins.out.split("\n").slice(-4).join("\n"));
  check("220: install.sh chạy xong và báo OK", ins.ok && /OK: NEU Agent đã chạy/.test(ins.out));
  check("220: trang /agent/ yêu cầu đăng nhập, API trả 401 JSON", c220("/agent/") === "302" && ex("neu-220", "curl -s -H 'Host: ai.neu.edu.vn' http://127.0.0.1/agent/vllm/v1/models").out.includes("login_required"));
  check("220: site khác (mặc định cổng 80, Judge cổng 8017) KHÔNG bị ảnh hưởng", ex("neu-220", "curl -s http://127.0.0.1/").out === "OJ-DEFAULT" && ex("neu-220", "curl -s http://127.0.0.1:8017/").out === "JUDGE");
  check("220: key chỉ nằm ở conf.d (quyền 640), không nằm trong tệp web", ex("neu-220", "stat -c %a /etc/nginx/conf.d/neu-agent.conf && grep -rl testkey123 /var/www /etc/nginx/snippets /etc/nginx/sites-available 2>/dev/null | wc -l").out === "640\n0".replace("\n", "\n"));
  check("220: bản cài được chép và kiểm mã băm", ex("neu-220", "ls /var/www/neu-agent-dl").out.includes("SHA256SUMS.txt"));
  const again = ex("neu-220", "cd /deploy/220 && bash ./install.sh testkey123");
  check("220: chạy lại (cập nhật) vẫn OK — idempotent", again.ok && /OK:/.test(again.out));
  // lỗi giữa chừng phải tự khôi phục: key sai ký tự → dừng trước khi đụng cấu hình; oauth2 chưa chạy → dừng
  check("220: key có ký tự lạ bị từ chối ngay", !ex("neu-220", "cd /deploy/220 && bash ./install.sh 'bad key;rm'").ok);
  // ép lỗi sau khi sửa cấu hình để thử khôi phục: làm hỏng tệp locations rồi cài
  ex("neu-220", "cp /deploy/220/neu-agent.locations.conf /tmp/loc.bak; echo 'khong_hop_le {' >> /deploy/220/neu-agent.locations.conf");
  const broken = ex("neu-220", "cd /deploy/220 && bash ./install.sh testkey123");
  check("220: cấu hình hỏng → script thất bại và tự KHÔI PHỤC (trang vẫn đăng nhập được, site khác vẫn chạy)", !broken.ok && /khôi phục/i.test(broken.out) && c220("/agent/") === "302" && ex("neu-220", "curl -s http://127.0.0.1:8017/").out === "JUDGE");
  ex("neu-220", "cp /tmp/loc.bak /deploy/220/neu-agent.locations.conf");
  // kiểm soát nguồn: container 222 (IP docker, KHÔNG nằm trong danh sách) phải bị từ chối — kể cả khi giả mạo X-Forwarded-For bằng IP của 222 thật
  const ip220x = sh("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "neu-220"]).stdout.trim();
  const from222 = (xff) => ex("neu-222", `curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ai.neu.edu.vn' ${xff ? "-H 'X-Forwarded-For: " + xff + "'" : ""} http://${ip220x}/agent/vllm/v1/models`).out;
  check("220: máy lạ gọi vào bị 403; giả mạo X-Forwarded-For bằng IP của 222 cũng KHÔNG qua được", from222("") === "403" && from222("192.0.2.23") === "403" && from222("192.0.2.22") === "403", `${from222("")} ${from222("192.0.2.23")}`);
  // thêm dải docker làm "máy 222" như ngoài đời, rồi X-Forwarded-For của máy 222 phải được dùng làm IP người dùng
  ex("neu-220", "sed -i 's#default        0;#default        0;\\n    172.16.0.0/12  1;#' /etc/nginx/conf.d/neu-agent.conf && sed -i 's#set_real_ip_from 192.0.2.23;#set_real_ip_from 192.0.2.23;\\n    set_real_ip_from 172.16.0.0/12;#' /etc/nginx/sites-available/neu-agent && nginx -t 2>&1 && nginx -s reload; sleep 1");
  const viaFront = ex("neu-222", `curl -s -m 5 -w ' %{http_code}' -H 'Host: ai.neu.edu.vn' -H 'X-Forwarded-For: 203.0.113.7' http://${ip220x}/agent/vllm/v1/models`);
  check("220: máy 222 hợp lệ gọi được (dù X-Forwarded-For là IP người dùng khác) — đúng lỗi đã gặp ngoài đời", /login_required/.test(viaFront.out) && /401$/.test(viaFront.out), viaFront.out.slice(-60));
  check("220: cấu hình có kiểm soát nguồn", ex("neu-220", "grep -c 'neu_from_front' /etc/nginx/sites-available/neu-agent /etc/nginx/conf.d/neu-agent.conf").out.includes(":1"));

  // ================================================================ máy 222
  const ip220 = sh("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "neu-220"]).stdout.trim();
  ex("neu-222", `cat > /usr/local/bin/systemctl <<'EOF'\n${STUB_SYSTEMCTL}\nEOF\nchmod +x /usr/local/bin/systemctl; mkdir -p /etc/ssl/t && openssl req -x509 -newkey rsa:2048 -nodes -keyout /etc/ssl/t/k.pem -out /etc/ssl/t/c.pem -days 2 -subj /CN=ai.neu.edu.vn >/dev/null 2>&1`);
  ex("neu-222", `rm -f /etc/nginx/sites-enabled/default; cat > /etc/nginx/sites-available/ai.neu.edu.vn <<'EOF'\nserver {\n    listen 80;\n    server_name ai.cs.edu.vn;\n    return 301 https://ai.neu.edu.vn$request_uri;\n}\nserver {\n    listen 443 ssl;\n    server_name ai.neu.edu.vn www.ai.neu.edu.vn;  # ghi chú\n    ssl_certificate /etc/ssl/t/c.pem;\n    ssl_certificate_key /etc/ssl/t/k.pem;\n    location /apps/ { return 200 'APP-KHAC'; }\n}\nEOF\nln -sf /etc/nginx/sites-available/ai.neu.edu.vn /etc/nginx/sites-enabled/; nginx -t 2>&1 && nginx`);
  check("222 trước khi cài: ứng dụng khác chạy bình thường", ex("neu-222", "curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 https://ai.neu.edu.vn/apps/").out === "APP-KHAC");
  const noUp = ex("neu-222", "cd /deploy/222 && NEU_UPSTREAM=203.0.113.9 bash ./install.sh");
  check("222: máy 220 chưa sẵn sàng → script DỪNG TRƯỚC khi đụng cấu hình", !noUp.ok && /chưa sẵn sàng/.test(noUp.out) && ex("neu-222", "ls /etc/nginx/snippets/neu-agent-locations.conf 2>&1").out.includes("No such file"));
  const i222 = ex("neu-222", `cd /deploy/222 && NEU_UPSTREAM=${ip220} bash ./install.sh`);
  console.log(i222.out.split("\n").slice(-3).join("\n"));
  check("222: install.sh chạy xong, /agent/ chuyển tới đăng nhập, API 401 JSON, /apps/ vẫn chạy", i222.ok && /OK: https:\/\/ai\.neu\.edu\.vn\/agent\//.test(i222.out) && ex("neu-222", "curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 https://ai.neu.edu.vn/apps/").out === "APP-KHAC");
  check("222: include được chèn đúng vào khối 443 (không chèn vào khối cổng 80)", ex("neu-222", "awk '/listen 80;/{p=1} /listen 443/{p=2} /neu-agent-locations.conf/{print p}' /etc/nginx/sites-available/ai.neu.edu.vn").out === "2");
  const un = ex("neu-222", "cd /deploy/222 && bash ./install.sh --uninstall; sleep 2");
  check("222: --uninstall gỡ sạch, /apps/ vẫn chạy", un.ok && ex("neu-222", "curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://ai.neu.edu.vn/agent/").out === "404" && ex("neu-222", "curl -sk --resolve ai.neu.edu.vn:443:127.0.0.1 https://ai.neu.edu.vn/apps/").out === "APP-KHAC");
  const re = ex("neu-222", `cd /deploy/222 && NEU_UPSTREAM=${ip220} bash ./install.sh`);
  check("222: cài lại sau khi gỡ vẫn OK", re.ok);
} catch (e) {
  console.error("LỖI:", e.stack ?? e);
  results.push(false);
} finally {
  cleanup();
}
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad}/${results.length} kiểm tra THẤT BẠI` : `\nTất cả ${results.length} kiểm tra đạt`);
process.exit(bad ? 1 : 0);
