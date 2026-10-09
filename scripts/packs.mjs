// Gom các gói mở rộng (thư mục packs/<tên>/…) thành dữ liệu cho bản web (packs.json) và cho bản cài Desktop.
// Đổi tổ chức: đặt NEU_PACKS_DIR trỏ tới thư mục gói của tổ chức đó; mã nguồn lõi không đổi. Xem docs/EXTENSIONS.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultPacksDir = () => process.env.NEU_PACKS_DIR || path.join(here, "..", "packs");
const TEXT = /\.(md|json|txt|csv|html|css|js|mjs)$/i;
const MAX_FILE = 100_000;

/** Đọc mọi gói trong `dir` (chỉ tệp chữ ≤ 100 KB, sâu ≤ 4 cấp). Trả về [{dir, files}] theo thứ tự tên. */
export function collectPacks(dir = defaultPacksDir()) {
  if (!fs.existsSync(dir)) return [];
  const packs = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = {};
    const walk = (abs, rel, depth) => {
      for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) depth < 4 && walk(path.join(abs, e.name), r, depth + 1);
        else if (e.isFile() && TEXT.test(e.name) && fs.statSync(path.join(abs, e.name)).size <= MAX_FILE) files[r] = fs.readFileSync(path.join(abs, e.name), "utf8");
      }
    };
    walk(path.join(dir, d.name), "", 0);
    if (files["pack.json"]) packs.push({ dir: d.name, files });
  }
  return packs;
}

/** Ghi `packs.json` cho bản web. */
export function writePacksJson(outFile, dir = defaultPacksDir()) {
  const packs = collectPacks(dir);
  fs.writeFileSync(outFile, JSON.stringify({ packs }));
  return packs.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packs = collectPacks();
  for (const p of packs) console.log(`${p.dir}: ${Object.keys(p.files).length} tệp`);
  console.log(`${packs.length} gói`);
}
