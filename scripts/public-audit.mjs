// Kiểm tra "sẵn sàng công khai": tìm thông tin hạ tầng, định danh tổ chức và bí mật còn nằm trong kho.
//   node scripts/public-audit.mjs             quét các tệp đang theo dõi trong git; mã thoát 1 nếu có BẤT KỲ phát hiện nào (chạy trong CI)
//   node scripts/public-audit.mjs --history   quét cả LỊCH SỬ git (mọi nhánh/tag): cổng cuối trước khi công khai
// Phát hiện: IP máy chủ thật, GUID định danh tổ chức, khoá/token, email cá nhân thật, tệp bí mật. Xem docs/PUBLIC.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Không quét: tệp sinh ra, nhị phân, hoặc nơi chuỗi giống IP/GUID là ngẫu nhiên
const SKIP_FILE = /(^|\/)(package-lock\.json|scripts\/public-audit\.mjs)$|\.(png|jpe?g|gif|webp|ico|icns|svg|woff2?|ttf|otf|pdf|zip|gz|dmg|exe|docx|xlsx|pptx|gpl)$/i;
// Tệp không bao giờ được nằm trong kho công khai
const FORBIDDEN_PATH = [/(^|\/)\.env(\..+)?$/, /\.(p12|pfx|pem|key|keystore)$/i, /(^|\/)id_(rsa|ed25519)/, /(^|\/)captures[^/]*\.(db|sqlite)/i, /(^|\/)known_hosts$/];

const IP = /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])/g;
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const SECRET = [
  /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{30,}\b/, /\bsk-[A-Za-z0-9]{32,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
];
const PERSONAL_MAIL = /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|yahoo|outlook|hotmail|icloud|proton(?:mail)?)\.[a-z.]{2,}/gi;

/**
 * Địa chỉ riêng/CGNAT dùng làm ví dụ trong tài liệu và bài thử (không thuộc hạ tầng thật). MỌI địa chỉ riêng khác đều bị báo: công cụ
 * không biết (và không được ghi trong mã) địa chỉ thật của tổ chức; địa chỉ thật mới xuất hiện sẽ tự bị chặn thay vì phải nhớ thêm vào đâu đó.
 */
const EXAMPLE_PRIVATE = new Set([
  "10.0.0.1", "10.0.0.2", "10.0.0.51", "10.0.0.58", "10.1.2.3", "10.0.0.0",
  "192.168.0.0", "192.168.0.5", "192.168.1.1", "172.16.0.0", "172.16.0.5", "172.17.17.240", "172.20.0.1",
  "100.64.0.0", "100.64.0.1", "169.254.0.0", "169.254.169.254",
]);

/**
 * Địa chỉ được phép: loopback, dải tài liệu (RFC 5737), địa chỉ công khai quen thuộc làm ví dụ, và các địa chỉ riêng trong EXAMPLE_PRIVATE.
 * Mọi địa chỉ công khai khác và mọi địa chỉ riêng khác đều bị báo.
 */
export function ipAllowed(ip) {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return true; // không phải IP (số phiên bản…)
  const [a, b, c] = o;
  if (a === 127 || a === 0 || a === 255 || a >= 224) return true;            // loopback, "mọi địa chỉ", broadcast, multicast
  if (EXAMPLE_PRIVATE.has(ip)) return true;
  if (a === 192 && b === 0 && c === 2) return true;                           // 192.0.2.0/24
  if (a === 198 && b === 51 && c === 100) return true;                        // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true;                         // 203.0.113.0/24
  if (ip === "8.8.8.8" || ip === "1.1.1.1" || ip === "93.184.216.34" || ip === "93.184.216.35") return true;
  if (/^\d+\.0\.0\.0$/.test(ip)) return true;                                // Chrome/120.0.0.0, mặt nạ…
  return false;
}
const GUID_OK = new Set([
  "00000000-0000-0000-0000-000000000000", "11111111-1111-1111-1111-111111111111",
  "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002",   // giá trị ví dụ trong deploy/site.example.env
  "521415d9-36f7-43e2-ab2f-b90af26b5e84",                                           // hằng số OOXML (khoá mở rộng PowerPoint), không phải của tổ chức
]);
// Email giả dùng trong bài thử (đuôi nhà cung cấp công cộng). Địa chỉ cá nhân thật khác sẽ bị báo.
const EMAIL_OK = new Set(["x@gmail.com", "a@gmail.com", "ke-xau@gmail.com", "a@b.vn"]);

/** @param {{path:string,text:string}[]} files @returns {{rule:string,value:string,file:string,line:number}[]} */
export function scan(files) {
  const out = [];
  for (const { path: file, text } of files) {
    for (const re of FORBIDDEN_PATH) if (re.test(file)) out.push({ rule: "path", value: re.source, file, line: 0 });
    if (SKIP_FILE.test(file)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 4000) continue;
      for (const m of l.matchAll(IP)) if (!ipAllowed(m[1])) out.push({ rule: "ip", value: m[1], file, line: i + 1 });
      for (const m of l.matchAll(GUID)) if (!GUID_OK.has(m[0].toLowerCase())) out.push({ rule: "guid", value: m[0].toLowerCase(), file, line: i + 1 });
      for (const re of SECRET) { const m = re.exec(l); if (m) out.push({ rule: "secret", value: m[0].slice(0, 12) + "…", file, line: i + 1 }); }
      for (const m of l.matchAll(PERSONAL_MAIL)) if (!EMAIL_OK.has(m[0].toLowerCase())) out.push({ rule: "email", value: m[0].toLowerCase(), file, line: i + 1 });
    }
  }
  return out;
}

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 30, encoding: "utf8", ...opts });

function treeFiles() {
  const list = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  return list.map((p) => {
    try { return { path: p, text: fs.readFileSync(path.join(ROOT, p), "utf8") }; } catch { return { path: p, text: "" }; }
  }).filter((f) => !f.text.includes("\u0000"));
}

/** Dòng được THÊM vào ở mọi commit/nhánh/tag; chỉ báo giá trị khác nhau (kèm commit đầu tiên chứa nó). */
function historyFindings() {
  const raw = git(["log", "--all", "--no-color", "--no-ext-diff", "-p", "--pretty=format:@@COMMIT %h", "--", ".", ":(exclude)package-lock.json"]);
  const seen = new Map();
  let commit = "", file = "";
  const cur = [];
  const flush = () => {
    if (!cur.length) return;
    for (const f of scan([{ path: file, text: cur.join("\n") }])) {
      const k = `${f.rule} ${f.value}`;
      if (!seen.has(k)) seen.set(k, { commit, file, rule: f.rule, value: f.value });
    }
    cur.length = 0;
  };
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@COMMIT ")) { flush(); commit = line.slice(9); continue; }
    if (line.startsWith("+++ ")) { flush(); file = line.slice(6); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) cur.push(line.slice(1));
  }
  flush();
  return [...seen.values()];
}

function main() {
  if (process.argv.includes("--history")) {
    const found = historyFindings();
    for (const f of found) console.log(`${f.rule.padEnd(7)} ${f.value}   (${f.commit}, ${f.file})`);
    console.log(`\nLịch sử: ${found.length} giá trị khác nhau cần xử lý trước khi công khai.`);
    process.exit(found.length ? 1 : 0);
  }
  const found = scan(treeFiles());
  for (const f of found) console.error(`${f.rule.padEnd(7)} ${f.value}  ${f.file}${f.line ? ":" + f.line : ""}`);
  if (found.length) {
    console.error(`\n${found.length} phát hiện. Không đưa địa chỉ máy chủ/định danh tổ chức/bí mật vào kho: dùng biến cấu hình (SITE_CONF, xem docs/PUBLIC.md) hoặc địa chỉ ví dụ 192.0.2.x.`);
    process.exit(1);
  }
  console.log("Đạt: không có thông tin hạ tầng, định danh hay bí mật trong các tệp đang theo dõi.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
