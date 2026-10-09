// Nén lại các .dmg bằng LZMA (ULMO): nhỏ hơn ~17% so với bzip2 mà electron-builder dùng (UDBZ).
// electron-builder chưa cho chọn ULMO trong cấu hình nên chuyển đổi sau khi dựng. Cần macOS 10.15+ (Electron đã đòi macOS 12+).
//   node scripts/recompress-dmg.mjs            (mọi *.dmg của phiên bản hiện tại trong release/)
// Không có hdiutil (máy không phải macOS) hoặc chuyển đổi lỗi: giữ nguyên tệp gốc, chỉ cảnh báo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "release");
const version = JSON.parse(fs.readFileSync(path.join(out, "..", "package.json"), "utf8")).version;
const dmgs = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith(".dmg") && f.includes(`-${version}-`)) : [];
if (process.platform !== "darwin" || !dmgs.length) process.exit(0);

for (const name of dmgs) {
  const src = path.join(out, name);
  const tmp = path.join(out, `.${name}.ulmo`);
  fs.rmSync(`${tmp}.dmg`, { force: true });
  const r = spawnSync("hdiutil", ["convert", src, "-format", "ULMO", "-o", tmp, "-quiet"], { stdio: "inherit" });
  const done = `${tmp}.dmg`;
  if (r.status !== 0 || !fs.existsSync(done)) {
    console.warn(`recompress-dmg: không nén lại được ${name}, giữ bản gốc`);
    fs.rmSync(done, { force: true });
    continue;
  }
  const before = fs.statSync(src).size;
  const after = fs.statSync(done).size;
  if (after >= before || spawnSync("hdiutil", ["verify", done, "-quiet"]).status !== 0) {
    console.warn(`recompress-dmg: ${name} không nhỏ hơn hoặc không qua kiểm tra, giữ bản gốc`);
    fs.rmSync(done, { force: true });
    continue;
  }
  fs.renameSync(done, src);
  fs.rmSync(`${src}.blockmap`, { force: true }); // blockmap cũ không còn khớp tệp; ứng dụng không dùng cập nhật vi sai
  console.log(`recompress-dmg: ${name} ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB`);
}
