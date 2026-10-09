import { build } from "esbuild";
import fs from "node:fs";
import { changelogData } from "../../scripts/version.mjs";

// nhật ký thay đổi và phiên bản được nhúng lúc dựng: người dùng xem được cả khi không có mạng
const pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const changelog = changelogData(fs.readFileSync("../../CHANGELOG.md", "utf8"));

fs.mkdirSync("dist", { recursive: true });
const common = { bundle: true, target: "es2022", sourcemap: process.env.NODE_ENV !== "production", minify: process.env.NODE_ENV === "production", logLevel: "info" };
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });
await build({ ...common, entryPoints: ["src/main.ts"], outdir: "dist", entryNames: "app", chunkNames: "chunks/[name]-[hash]", splitting: true, format: "esm", loader: { ".css": "css" }, define: { "process.env.NODE_ENV": '"production"', __CHANGELOG__: JSON.stringify(changelog), __APP_VERSION__: JSON.stringify(pkgVersion) } });
await build({ ...common, entryPoints: ["src/sandbox-worker.ts"], outfile: "dist/sandbox-worker.js", format: "iife" });
for (const f of ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"]) fs.copyFileSync(f, "dist/" + f);
