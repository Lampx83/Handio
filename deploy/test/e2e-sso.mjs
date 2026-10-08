// Kiểm thử đầu-cuối ĐĂNG NHẬP SSO phía máy chủ bằng Docker: nginx "222" (đầu vào HTTPS) → nginx "220" (cấu hình thật trong deploy/220)
// → oauth2-proxy thật (cấu hình giống install-auth.sh) → máy chủ OIDC giả (deploy/test/mock-idp.mjs); gateway mô hình được giả bằng nginx.
//   node deploy/test/e2e-sso.mjs        (cần Docker, ảnh nginx:1.24 và quay.io/oauth2-proxy/oauth2-proxy:v7.15.5)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockIdp } from "./mock-idp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NET = "neu-e2e";
const PORT = 18081;
const CLIENT = "client-e2e";
const dk = (...a) => spawnSync("docker", a, { encoding: "utf8" });
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " — " + detail : ""}`); };

function req(p, { headers = {}, method = "GET", body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { Host: "ai.neu.edu.vn", ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on("error", reject);
    r.end(body);
  });
}
const cookiesOf = (res) => (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]);
const jar = (...lists) => lists.flat().join("; ");

const idp = await startMockIdp({ host: "0.0.0.0", issuerHost: "host.docker.internal", clientId: CLIENT });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neu-e2e-"));
const cleanup = () => { for (const c of ["e2e-front", "e2e-220", "e2e-gw", "e2e-oauth"]) dk("rm", "-f", c); dk("network", "rm", NET); };
cleanup();

try {
  // ---------------------------------------------------------------- cấu hình thử (sinh từ tệp THẬT trong deploy/)
  const d220 = path.join(root, "220");
  const t = path.join(tmp, "t");
  fs.mkdirSync(path.join(t, "conf.d"), { recursive: true });
  fs.mkdirSync(path.join(t, "snippets"), { recursive: true });
  fs.mkdirSync(path.join(t, "web"), { recursive: true });
  fs.mkdirSync(path.join(t, "dl"), { recursive: true });
  const rd = (f) => fs.readFileSync(path.join(d220, f), "utf8");
  fs.writeFileSync(path.join(t, "conf.d/neu-agent.conf"), rd("neu-agent.http.conf").replace("__NEU_AGENT_KEY__", "testkey").replace("default        0;", "default        0;\n    172.16.0.0/12  1;"));
  const fix = (s) => s.replaceAll("/etc/nginx/snippets/", "/t/snippets/").replaceAll("/var/www/neu-agent-dl/", "/t/dl/").replaceAll("/var/www/neu-agent/", "/t/web/").replaceAll("127.0.0.1:4180", "e2e-oauth:4180").replaceAll("http://192.0.2.10:8037", "http://e2e-gw:80");
  fs.writeFileSync(path.join(t, "snippets/neu-agent-locations.conf"), fix(rd("neu-agent.locations.conf")));
  fs.writeFileSync(path.join(t, "snippets/neu-agent-auth.conf"), fix(rd("neu-agent-auth.conf")));
  fs.writeFileSync(path.join(t, "server.conf"), fix(rd("neu-agent.server.conf")));
  fs.writeFileSync(path.join(t, "nginx.conf"), `pid /tmp/n.pid; error_log /dev/stderr info;\nevents {}\nhttp { access_log off; resolver 127.0.0.11; include /t/conf.d/*.conf; include /t/server.conf; }\n`);
  fs.writeFileSync(path.join(t, "web/index.html"), "<html>NEU-AGENT-APP</html>");
  fs.writeFileSync(path.join(t, "dl/SHA256SUMS.txt"), "0000  x.dmg\n");
  // gateway giả: trả lại những gì nó nhận được
  const gw = path.join(tmp, "gw");
  fs.mkdirSync(gw);
  fs.writeFileSync(path.join(gw, "nginx.conf"), `pid /tmp/g.pid;\nevents {}\nhttp { server { listen 80; location / { default_type application/json; return 200 '{"key":"$http_x_ollama_seckey","auth":"$http_authorization","user":"$http_x_user_email","uri":"$request_uri"}'; } } }\n`);
  // "222": chuyển tiếp /agent/ tới 220
  const f222 = path.join(tmp, "f");
  fs.mkdirSync(f222);
  fs.writeFileSync(path.join(f222, "loc.conf"), fs.readFileSync(path.join(root, "222/neu-agent-locations.conf"), "utf8").replace("http://192.0.2.21:80", "http://e2e-220:80"));
  fs.writeFileSync(path.join(f222, "nginx.conf"), `pid /tmp/f.pid; error_log /dev/stderr info;\nevents {}\nhttp { access_log off; resolver 127.0.0.11; server { listen 80; server_name ai.neu.edu.vn; include /f/loc.conf; location /apps/ { return 200 'app-khac'; } } }\n`);

  // tài khoản tên + mật khẩu: một băm kiểu máy chủ Ubuntu tạo ($2b$, python crypt) và một băm kiểu htpasswd -B ($2y$)
  const hp = path.join(tmp, "hp");
  fs.mkdirSync(hp);
  fs.writeFileSync(path.join(hp, "users.htpasswd"), "khach01:$2b$12$6uU8iyrzPR5TDPA.F1mYJ.5HLjUN8.ynVbRqrP1MJarK1gQ/ZO/Hq\nnguoi.dung2:$2y$05$l8RNB70J76l2/FiHtWQVg.YwpLSGrZPTnFDPF8irR9QWm9uyDlIXO\n", { mode: 0o644 });
  dk("network", "create", NET);
  const run = (name, args) => { const r = dk("run", "-d", "--name", name, "--network", NET, ...args); if (r.status !== 0) throw new Error(name + ": " + r.stderr); };
  run("e2e-gw", ["-v", `${gw}:/g:ro`, "nginx:1.24", "nginx", "-c", "/g/nginx.conf", "-g", "daemon off;"]);
  run("e2e-oauth", ["--add-host", "host.docker.internal:host-gateway", "-v", `${path.join(root, "220/auth/templates")}:/tpl:ro`, "-v", `${hp}:/hp:ro`, ...Object.entries({
    PROVIDER: "oidc", OIDC_ISSUER_URL: idp.issuer, CLIENT_ID: CLIENT, CLIENT_SECRET: "bi-mat-thu", REDIRECT_URL: "https://ai.neu.edu.vn/agent/oauth2/callback",
    PROXY_PREFIX: "/agent/oauth2", HTTP_ADDRESS: "0.0.0.0:4180", UPSTREAMS: "static://202", EMAIL_DOMAINS: "neu.edu.vn,st.neu.edu.vn", OIDC_EMAIL_CLAIM: "preferred_username",
    SCOPE: "openid profile email", CODE_CHALLENGE_METHOD: "S256", COOKIE_NAME: "_neuagent_sso", COOKIE_PATH: "/agent", COOKIE_SECRET: "0123456789abcdef0123456789abcdef",
    COOKIE_SECURE: "false", COOKIE_HTTPONLY: "true", COOKIE_SAMESITE: "lax", COOKIE_EXPIRE: "8h", REVERSE_PROXY: "true", SKIP_JWT_BEARER_TOKENS: "true",
    SET_XAUTHREQUEST: "true", SKIP_PROVIDER_BUTTON: "false", DISPLAY_HTPASSWD_FORM: "true", PREFER_EMAIL_TO_USER: "true", USER_ID_CLAIM: "preferred_username", CUSTOM_TEMPLATES_DIR: "/tpl", WHITELIST_DOMAINS: "ai.neu.edu.vn", PASS_ACCESS_TOKEN: "false", REAL_CLIENT_IP_HEADER: "X-Real-IP",
    INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL: "true", HTPASSWD_FILE: "/hp/users.htpasswd",
  }).flatMap(([k, v]) => ["-e", `OAUTH2_PROXY_${k}=${v}`]), "quay.io/oauth2-proxy/oauth2-proxy:v7.15.5"]);
  run("e2e-220", ["-v", `${t}:/t:ro`, "nginx:1.24", "nginx", "-c", "/t/nginx.conf", "-g", "daemon off;"]);
  run("e2e-front", ["-p", `${PORT}:80`, "-v", `${f222}:/f:ro`, "nginx:1.24", "nginx", "-c", "/f/nginx.conf", "-g", "daemon off;"]);
  for (let i = 0; i < 40; i++) { const r = await req("/apps/").catch(() => null); if (r?.status === 200) break; await new Promise((x) => setTimeout(x, 500)); }
  for (let i = 0; i < 60; i++) { const r = await req("/agent/oauth2/start?rd=/agent/").catch(() => null); if (r && r.status < 500) break; await new Promise((x) => setTimeout(x, 500)); }
  const up = dk("logs", "e2e-oauth").stdout + dk("logs", "e2e-oauth").stderr;
  if (/error|fatal|failed/i.test(up) && !/OAuthProxy configured/.test(up)) console.log("oauth2-proxy log:\n" + up.slice(-800));

  // ---------------------------------------------------------------- kịch bản
  // trình duyệt giả: đăng nhập qua máy chủ OIDC giả, trả về cookie phiên (hoặc kết quả bị từ chối)
  async function browserLogin(hint) {
    const a = await req("/agent/");
    const start = await req("/agent/oauth2/start?rd=/agent/");
    const csrf = cookiesOf(start);
    const authUrl = new URL(start.headers.location.replace("host.docker.internal", "127.0.0.1"));
    if (hint) authUrl.searchParams.set("login_hint", hint);
    const au = await fetch(authUrl, { redirect: "manual" });
    const back = new URL(au.headers.get("location"));
    const cb = await req(back.pathname + back.search, { headers: { Cookie: jar(csrf) } });
    return { a, start, cb, session: cookiesOf(cb), authUrl };
  }

  const r1 = await req("/agent/");
  check("chưa đăng nhập: trang /agent/ chuyển tới trang chọn cách đăng nhập (302)", r1.status === 302 && r1.headers.location.startsWith("/agent/oauth2/sign_in"), r1.headers.location);
  const s1 = await req("/agent/oauth2/start?rd=/agent/");
  check("/agent/oauth2/start chuyển tới nhà cấp danh tính với PKCE S256 và redirect_uri đúng", s1.status === 302 && /code_challenge_method=S256/.test(s1.headers.location) && s1.headers.location.includes(encodeURIComponent("https://ai.neu.edu.vn/agent/oauth2/callback")), s1.headers.location?.slice(0, 90));
  const api0 = await req("/agent/vllm/v1/models");
  check("chưa đăng nhập: API trả 401 JSON login_required (không chuyển hướng)", api0.status === 401 && /login_required/.test(api0.body) && /json/.test(api0.headers["content-type"]), api0.body.slice(0, 60));
  const dl0 = await req("/agent/download/SHA256SUMS.txt");
  check("chưa đăng nhập: trang tải về cũng phải đăng nhập", dl0.status === 302);
  const w0 = await req("/agent/sandbox-worker.js");
  check("chưa đăng nhập: tệp web (worker) không đọc được", w0.status === 302);
  check("đường dẫn nội bộ /agent/oauth2/auth không gọi trực tiếp được từ ngoài", (await req("/agent/oauth2/auth")).status === 404);
  check("chuyển hướng dạng tương đối (không bị đẩy sang http://)", r1.headers.location.startsWith("/agent/oauth2/sign_in"));
  check("máy 222 vẫn giữ ứng dụng khác (/apps/) không bị ảnh hưởng", (await req("/apps/")).body === "app-khac");

  const ok = await browserLogin("lan@neu.edu.vn");
  check("đăng nhập giảng viên (@neu.edu.vn): callback cấp cookie phiên rồi chuyển về /agent/", ok.cb.status === 302 && ok.cb.headers.location === "/agent/" && ok.session.some((c) => c.startsWith("_neuagent_sso")), `${ok.cb.status} ${ok.cb.headers.location}`);
  const cookie = jar(ok.session);
  const page = await req("/agent/", { headers: { Cookie: cookie } });
  check("đã đăng nhập: vào được giao diện", page.status === 200 && /NEU-AGENT-APP/.test(page.body));
  check("đã đăng nhập: tải về được SHA256SUMS", (await req("/agent/download/SHA256SUMS.txt", { headers: { Cookie: cookie } })).status === 200);
  const api1 = await req("/agent/vllm/v1/models", { headers: { Cookie: cookie } });
  const j1 = JSON.parse(api1.body || "{}");
  check("đã đăng nhập: API tới gateway; key do MÁY CHỦ gắn, Authorization bị gỡ, gửi kèm email người dùng", api1.status === 200 && j1.key === "testkey" && j1.auth === "" && j1.user === "lan@neu.edu.vn" && j1.uri === "/vllm/v1/models", JSON.stringify(j1));
  const api2 = await req("/agent/vllm/v1/models", { headers: { Cookie: cookie, "x-ollama-seckey": "key-rieng" } });
  check("người dùng tự dán key riêng thì dùng key của họ", JSON.parse(api2.body).key === "key-rieng");
  check("đường dẫn lạ / embeddings bị chặn", (await req("/agent/vllm/v1/embeddings", { headers: { Cookie: cookie } })).status !== 200 && (await req("/agent/vllm/v1/models", { headers: { Cookie: cookie }, method: "DELETE" })).status !== 200);

  const ui = await req("/agent/oauth2/userinfo", { headers: { Cookie: cookie } });
  check("bản web đọc được người đang đăng nhập (/agent/oauth2/userinfo)", ui.status === 200 && /json/.test(ui.headers["content-type"]) && /lan@neu\.edu\.vn/.test(ui.body), ui.body.slice(0, 80));
  check("chưa đăng nhập thì /agent/oauth2/userinfo không lộ thông tin", (await req("/agent/oauth2/userinfo")).status === 401);
  const so = await req("/agent/oauth2/sign_out?rd=%2Fagent%2F", { headers: { Cookie: cookie } });
  check("đăng xuất: xoá cookie phiên và chuyển về /agent/", so.status === 302 && so.headers.location === "/agent/" && cookiesOf(so).some((c) => /^_neuagent_sso=\s*$/.test(c) || c.startsWith("_neuagent_sso=;") || /_neuagent_sso=$/.test(c)), `${so.status} ${so.headers.location} ${cookiesOf(so)}`);
  const stu = await browserLogin("11230001@st.neu.edu.vn");
  check("đăng nhập sinh viên (@st.neu.edu.vn) được chấp nhận", stu.cb.status === 302 && stu.session.some((c) => c.startsWith("_neuagent_sso")));
  // tài khoản Microsoft 365 thật có nhiều nhóm → id_token dài → cookie phiên lớn: từng gây 502 "upstream sent too big header" sau khi đăng nhập
  idp.state.bigClaims = true;
  const big = await browserLogin("nhieu.nhom@neu.edu.vn");
  idp.state.bigClaims = false;
  const bigCookie = jar(big.session);
  check("đăng nhập với phiên LỚN (id_token nhiều nhóm): callback không bị 502, cookie phiên > 4 KB vẫn dùng được", big.cb.status === 302 && big.cb.headers.location === "/agent/" && bigCookie.length > 4200 && (await req("/agent/", { headers: { Cookie: bigCookie } })).status === 200, `${big.cb.status} cookie=${bigCookie.length}B`);
  const bad = await browserLogin("ke-xau@gmail.com");
  check("tài khoản ngoài miền (gmail.com) bị từ chối, không cấp phiên", !bad.session.some((c) => c.startsWith("_neuagent_sso=")) && bad.cb.status >= 400, `${bad.cb.status}`);
  const evil = await browserLogin("a@neu.edu.vn.evil.com");
  check("miền giả mạo (neu.edu.vn.evil.com) bị từ chối", !evil.session.some((c) => c.startsWith("_neuagent_sso=")) && evil.cb.status >= 400);

  // ---------------------------------------------------------------- đăng nhập bằng tên + mật khẩu (tài khoản do quản trị tạo)
  const si = await req("/agent/oauth2/sign_in?rd=/agent/");
  check("trang đăng nhập (tiếng Việt) có nút Microsoft và form tên + mật khẩu", si.status === 200 && /Đăng nhập Microsoft/.test(si.body) && /name="username"/.test(si.body) && /name="password"/.test(si.body) && /autocomplete="current-password"/.test(si.body));
  const siBare = await req("/agent/oauth2/sign_in");
  const siRd = await req("/agent/oauth2/sign_in?rd=/agent/download/");
  check("vào trang đăng nhập không kèm đích: sau khi đăng nhập về /agent/ (không phải trang chủ /)", (siBare.body.match(/name="rd" value="\/agent\/"/g) ?? []).length === 2 && !/name="rd" value="\/"/.test(siBare.body), (siBare.body.match(/name="rd"[^>]*>/g) ?? []).join(" "));
  check("đích do trang gửi tới (rd=/agent/download/) được giữ nguyên", (siRd.body.match(/name="rd" value="\/agent\/download\/"/g) ?? []).length === 2);
  const form = (u, p) => req("/agent/oauth2/sign_in", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: u, password: p, rd: "/agent/" }).toString() });
  const okPw = await form("khach01", "mat-khau-thu-nghiem-1");
  const pwCookie = jar(cookiesOf(okPw));
  check("tên + mật khẩu đúng (băm $2b$ của máy chủ): cấp cookie phiên", okPw.status === 302 && /_neuagent_sso/.test(pwCookie), `${okPw.status} ${okPw.headers.location}`);
  const pwPage = await req("/agent/", { headers: { Cookie: pwCookie } });
  check("tài khoản mật khẩu vào được giao diện", pwPage.status === 200 && /NEU-AGENT-APP/.test(pwPage.body));
  const pwApi = await req("/agent/vllm/v1/models", { headers: { Cookie: pwCookie } });
  const pj = JSON.parse(pwApi.body || "{}");
  check("tài khoản mật khẩu gọi được API; danh tính chuyển cho gateway là tên đăng nhập; key do máy chủ gắn", pwApi.status === 200 && pj.user === "khach01" && pj.key === "testkey" && pj.auth === "", JSON.stringify(pj));
  const okPw2 = await form("nguoi.dung2", "mat-khau-thu-nghiem-2");
  check("băm kiểu htpasswd -B ($2y$) cũng dùng được", okPw2.status === 302 && /_neuagent_sso/.test(jar(cookiesOf(okPw2))));
  const badPw = await form("khach01", "sai-mat-khau-hoan-toan");
  const noUser = await form("khong-ton-tai", "mat-khau-thu-nghiem-1");
  check("sai mật khẩu / sai tên: không cấp phiên và phản hồi GIỐNG nhau (không lộ tên nào tồn tại)", !/_neuagent_sso=./.test(jar(cookiesOf(badPw))) && !/_neuagent_sso=./.test(jar(cookiesOf(noUser))) && badPw.status === noUser.status && badPw.status !== 302, `${badPw.status}/${noUser.status}`);
  const basic = await req("/agent/vllm/v1/models", { headers: { Authorization: "Basic " + Buffer.from("khach01:mat-khau-thu-nghiem-1").toString("base64") } });
  check("không nhận Authorization: Basic trên API (kể cả đúng mật khẩu): chỉ form có giới hạn tốc độ", basic.status === 401, String(basic.status));
  check("trang đăng nhập không đếm vào hạn mức (xem trang nhiều lần vẫn 200)", (await Promise.all(Array.from({ length: 12 }, () => req("/agent/oauth2/sign_in")))).every((r) => r.status === 200));

  // ứng dụng Desktop: Authorization: Bearer <id_token>
  const bearer = async (tok) => req("/agent/vllm/v1/models", { headers: { Authorization: "Bearer " + tok } });
  const good = await bearer(await idp.sign("lan@neu.edu.vn", undefined, CLIENT));
  const gj = JSON.parse(good.body || "{}");
  check("Desktop: id_token hợp lệ được chấp nhận; Authorization KHÔNG chuyển sang gateway", good.status === 200 && gj.auth === "" && gj.key === "testkey" && gj.user === "lan@neu.edu.vn", `${good.status} ${good.body.slice(0, 80)}`);
  check("Desktop: sinh viên dùng Bearer được", (await bearer(await idp.sign("11230001@st.neu.edu.vn", undefined, CLIENT))).status === 200);
  const wrongAud = await bearer(await idp.sign("lan@neu.edu.vn", undefined, "ung-dung-khac"));
  check("Desktop: token cấp cho ứng dụng KHÁC (sai audience) bị từ chối", wrongAud.status === 401, String(wrongAud.status));
  check("Desktop: token của tài khoản ngoài miền bị từ chối", (await bearer(await idp.sign("ke-xau@gmail.com", undefined, CLIENT))).status !== 200);
  idp.state.ttlSeconds = -120;
  const expired = await bearer(await idp.sign("lan@neu.edu.vn", undefined, CLIENT));
  idp.state.ttlSeconds = 3600;
  check("Desktop: token đã hết hạn bị từ chối", expired.status === 401, String(expired.status));
  const [h, p, s] = (await idp.sign("lan@neu.edu.vn", undefined, CLIENT)).split(".");
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), preferred_username: "admin@neu.edu.vn" })).toString("base64url")}.${s}`;
  check("Desktop: token bị sửa nội dung (chữ ký sai) bị từ chối", (await bearer(forged)).status === 401);
  check("Desktop: chuỗi bậy / không có token bị từ chối", (await bearer("khong-phai-jwt")).status === 401 && (await req("/agent/vllm/v1/models", { headers: { Authorization: "Basic YTpi" } })).status === 401);
  const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => form("khach01", "doan-mat-khau-" + i)));
  const limited = burst.filter((r) => r.status === 429).length;
  check("dò mật khẩu liên tục bị chặn (HTTP 429 sau vài lần)", limited >= 5 && !burst.some((r) => r.status === 302), `${limited}/14 bị chặn`);
  const after = await form("khach01", "mat-khau-thu-nghiem-1");
  check("đang bị giới hạn thì kể cả mật khẩu đúng cũng phải chờ", after.status === 429, String(after.status));
} catch (e) {
  console.error("LỖI:", e.stack ?? e);
  results.push(false);
} finally {
  cleanup();
  await idp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad}/${results.length} kiểm tra THẤT BẠI` : `\nTất cả ${results.length} kiểm tra đạt`);
process.exit(bad ? 1 : 0);
