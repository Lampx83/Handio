#!/usr/bin/env node
// Chụp lại ảnh demo của trang giới thiệu công khai: dựng bản web, chạy máy chủ dev (mô hình giả lập), chụp bằng Electron, đổi sang .webp.
//   node labs/landing-shots/run.mjs [--no-build] [--no-install]   (--no-install: chỉ chụp ra thư mục tạm, không ghi đè ảnh trong deploy/220/guide-public/img)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "landing-shots-"));
const port = 5000 + Math.floor(Math.random() * 900);
if (!process.argv.includes("--no-build")) {
  const b = spawnSync("node", ["build.mjs"], { cwd: path.join(root, "apps/web"), stdio: "inherit" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
// dữ liệu mẫu (Work/Code/Design) từ lõi: bản web không còn tự nạp, nên nạp sẵn vào IndexedDB trước khi chụp
const seedSrc = path.join(here, ".seed.ts"); // trong thư mục này để esbuild tìm được @neu/agent-core
fs.writeFileSync(seedSrc, `import { buildWorkSamples, SAMPLE_PROJECT, SAMPLE_DESIGN } from "@neu/agent-core";
const enc = new TextEncoder();
const b64 = (v: string | Uint8Array) => Buffer.from(typeof v === "string" ? enc.encode(v) : v).toString("base64");
const mk = (root: string, files: Record<string, string | Uint8Array>) => Object.entries(files).map(([p, v]) => ({ path: root + "/" + p, data: b64(v) }));
(async () => {
  const out = { work: mk("/work", await buildWorkSamples()), code: mk("/workspace", SAMPLE_PROJECT), design: mk("/design", SAMPLE_DESIGN) };
  process.stdout.write(JSON.stringify(out));
})();
`);
await build({ entryPoints: [seedSrc], outfile: path.join(out, "seed.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "error", absWorkingDir: root });
const seedJson = path.join(out, "seed.json");
fs.writeFileSync(seedJson, spawnSync("node", [path.join(out, "seed.cjs")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout);
const srv = spawn("node", ["dev/server.mjs"], { cwd: path.join(root, "apps/web"), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
const electron = createRequire(path.join(root, "apps/desktop/package.json"))("electron");
const r = spawnSync(electron, [path.join(here, "shoot.cjs"), `http://127.0.0.1:${port}`, out, seedJson], { stdio: "inherit", env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
srv.kill();
console.log("Ảnh PNG ở:", out);
if (r.status !== 0) process.exit(r.status ?? 1);
if (!process.argv.includes("--no-install")) {
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith(".png"))) {
    const dst = path.join(root, "deploy/220/guide-public/img", f.replace(/\.png$/, ".webp"));
    const c = spawnSync("cwebp", ["-quiet", "-q", "82", path.join(out, f), "-o", dst], { stdio: "inherit" });
    console.log(c.status === 0 ? "→ " + path.relative(root, dst) : "cwebp lỗi cho " + f);
  }
}
