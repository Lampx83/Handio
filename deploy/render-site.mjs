// Điền cấu hình RIÊNG của từng nơi triển khai (địa chỉ máy, cổng gateway…) vào các tệp mẫu trong deploy/.
// Mã nguồn công khai chỉ chứa dấu giữ chỗ @@SITE_TÊN@@; giá trị thật nằm ở SECRET repo `SITE_CONF` (GitHub → Settings → Secrets and variables → Actions)
// hoặc tệp site.env của quản trị viên (mẫu: deploy/site.example.env). Xem docs/PUBLIC.md.
//
//   node deploy/render-site.mjs <thư-mục> [--env site.env] [--out <thư-mục-đích>]   điền tại chỗ (hoặc ghi ra --out)
//   node deploy/render-site.mjs <thư-mục> --check                                  chỉ kiểm tra còn dấu giữ chỗ nào chưa điền
//   thêm --mask: in lệnh ::add-mask:: cho từng giá trị (GitHub Actions che chúng trong nhật ký, kể cả khi repo công khai)
// Giá trị lấy từ --env hoặc biến môi trường SITE_CONF (nhiều dòng KEY=VALUE). Thiếu khoá → dừng, không điền dở.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TOKEN = /@@(SITE_[A-Z0-9_]+)@@/g;
// Giá trị chỉ gồm ký tự an toàn khi chèn vào nginx/systemd/shell/python (không dấu cách, nháy, $, ;, xuống dòng…)
const SAFE_VALUE = /^[A-Za-z0-9._:/-]+$/;

/** KEY=VALUE theo dòng; bỏ dòng trống và chú thích (#). Ném lỗi nếu khoá/giá trị không hợp lệ. */
export function parseSiteConf(text) {
  const out = {};
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(SITE_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) throw new Error(`Dòng ${i + 1}: cần dạng SITE_TÊN=giá-trị`);
    const v = m[2].trim();
    if (!SAFE_VALUE.test(v)) throw new Error(`${m[1]}: giá trị có ký tự không cho phép (chỉ chữ, số, . : / _ -)`);
    out[m[1]] = v;
  }
  return out;
}

/** Điền dấu giữ chỗ trong một chuỗi; trả về {text, missing}. */
export function renderText(text, values) {
  const missing = new Set();
  const out = text.replace(TOKEN, (_, k) => {
    if (Object.prototype.hasOwnProperty.call(values, k)) return values[k];
    missing.add(k);
    return `@@${k}@@`;
  });
  return { text: out, missing: [...missing] };
}

const SKIP_DIR = new Set(["node_modules", ".git", "__pycache__", "downloads"]);
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) yield* walk(path.join(dir, e.name)); }
    else if (e.isFile()) yield path.join(dir, e.name);
  }
}
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

/** Điền cả cây thư mục. @returns {{files:string[], missing:string[]}} files = tệp đã có dấu giữ chỗ */
export function renderTree(dir, values, { out, check = false } = {}) {
  const src = path.resolve(dir);
  const dst = out ? path.resolve(out) : src;
  if (out) fs.cpSync(src, dst, { recursive: true, filter: (p) => !SKIP_DIR.has(path.basename(p)) });
  const files = [], missing = new Set();
  for (const f of walk(dst)) {
    const buf = fs.readFileSync(f);
    if (!isText(buf)) continue;
    const s = buf.toString("utf8");
    if (!s.includes("@@SITE_")) continue;
    const r = renderText(s, check ? {} : values);
    r.missing.forEach((k) => missing.add(k));
    if (check) { if (r.missing.length) files.push(f); continue; } // chỉ kiểm tra: tệp còn dấu giữ chỗ THẬT (không tính chữ "@@SITE_…@@" trong chú thích)
    if (r.missing.length) { files.push(f); continue; }           // còn thiếu khoá: không ghi dở
    fs.writeFileSync(f, r.text);
    files.push(f);
  }
  return { files, missing: [...missing] };
}

function main() {
  const a = process.argv.slice(2);
  const dir = a.find((x) => !x.startsWith("--") && a[a.indexOf(x) - 1] !== "--env" && a[a.indexOf(x) - 1] !== "--out");
  const opt = (n) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  if (!dir) { console.error("Dùng: node deploy/render-site.mjs <thư-mục> [--env site.env] [--out DIR] [--check]"); process.exit(2); }
  if (a.includes("--check")) {
    const r = renderTree(dir, {}, { check: true });
    if (r.files.length) { console.error("Còn dấu giữ chỗ @@SITE_…@@ chưa điền trong:\n  " + r.files.join("\n  ")); process.exit(1); }
    console.log("Đạt: không còn dấu giữ chỗ."); return;
  }
  const envFile = opt("--env");
  const src = envFile ? fs.readFileSync(envFile, "utf8") : process.env.SITE_CONF;
  if (!src || !src.trim()) {
    console.error("Thiếu cấu hình site: đặt secret repo SITE_CONF (CD) hoặc truyền --env site.env (mẫu: deploy/site.example.env). Xem docs/PUBLIC.md.");
    process.exit(2);
  }
  let values;
  try { values = parseSiteConf(src); } catch (e) { console.error("Cấu hình site sai: " + e.message); process.exit(2); }
  if (a.includes("--mask")) for (const v of new Set(Object.values(values))) console.log(`::add-mask::${v}`);
  const r = renderTree(dir, values, { out: opt("--out") });
  if (r.missing.length) { console.error("Cấu hình site thiếu khoá: " + r.missing.join(", ")); process.exit(2); }
  console.log(`Đã điền ${r.files.length} tệp.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
