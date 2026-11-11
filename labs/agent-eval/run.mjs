#!/usr/bin/env node
// Bộ eval hành vi của agent (xem README.md cùng thư mục).
//   node labs/agent-eval/run.mjs --self-test          kiểm chứng bộ chấm bằng lời giải mẫu, không gọi mô hình
//   node labs/agent-eval/run.mjs --k 3                chạy mọi bài, mỗi bài 3 lần (cần mô hình thật)
//   node labs/agent-eval/run.mjs --compare <a> <b>    so sánh hai lần chạy
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handio-agent-eval-build-"));
const bundle = path.join(tmp, "cli.mjs");
await build({ entryPoints: [path.join(here, "cli.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "error", external: ["electron"], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
const { main } = await import(pathToFileURL(bundle).href);
const code = await main(process.argv.slice(2), root);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(code);
