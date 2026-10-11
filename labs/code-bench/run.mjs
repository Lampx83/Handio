#!/usr/bin/env node
// Bài thử 10 ứng dụng cho tab Code của Handio (xem README.md cùng thư mục).
//   node labs/code-bench/run.mjs                 chạy cả 10 bài (cần mô hình thật, xem biến môi trường)
//   node labs/code-bench/run.mjs --only 03,04    chỉ chạy bài có mã bắt đầu bằng 03 hoặc 04
//   node labs/code-bench/run.mjs --regrade out/<lần-chạy>   chấm lại các thư mục đã có (không gọi mô hình)
//   node labs/code-bench/run.mjs --list          in đề bài để dán tay vào Handio
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { TASKS } from "./tasks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const only = (opt("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const tasks = TASKS.filter((t) => !only.length || only.some((p) => t.id.startsWith(p)));

if (args.includes("--list")) {
  for (const t of tasks) console.log(`\n### ${t.id} — ${t.title}  [${t.stack}]\nBẫy: ${t.trap}\n\n${t.prompt}\n${t.seed ? "(cần sẵn: " + Object.keys(t.seed).join(", ") + ")\n" : ""}`);
  process.exit(0);
}

const regrade = opt("--regrade", "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(regrade || path.join(here, "out", stamp));
fs.mkdirSync(outDir, { recursive: true });
const timeoutMs = Number(opt("--timeout-min", "25")) * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };

function staticServer(dir) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    let f = path.join(dir, p);
    if (!f.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f) && !path.extname(p)) f = path.join(dir, "index.html"); // SPA
    if (!fs.existsSync(f)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ port: srv.address().port, stop: () => srv.close() })));
}

function sh(cmd, cwd, ms = 600_000, env = {}) {
  return new Promise((resolve) => {
    const p = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env, CI: "1", ...env }, detached: true });
    let out = "";
    const add = (d) => { out += d; if (out.length > 20_000) out = out.slice(-12_000); };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const t = setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch { /* đã thoát */ } out += "\n[quá hạn]"; }, ms);
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
  });
}

async function waitPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((r) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

const electronBin = (() => {
  try { return createRequire(path.join(root, "apps/desktop/package.json"))("electron"); } catch { return ""; }
})();

function probe(cfg) {
  return new Promise((resolve) => {
    if (!electronBin) return resolve({ error: "không tìm thấy Electron (npm ci ở gốc kho)" });
    const f = path.join(outDir, `.probe-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(cfg));
    const p = spawn(electronBin, [path.join(here, "probe.cjs"), f], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill("SIGKILL"), 90_000);
    p.on("close", () => {
      clearTimeout(t);
      fs.rmSync(f, { force: true });
      const m = out.match(/PROBE_RESULT:(.*)/);
      resolve(m ? JSON.parse(m[1]) : { error: "trình duyệt ẩn không trả kết quả" });
    });
  });
}

/** Chấm một bài: trả [{name, ok, detail}] */
async function grade(task, appDir) {
  const res = [];
  const add = (name, ok, detail = "") => res.push({ name, ok, detail });
  let server = null; // máy chủ đang chạy cho các kiểm tra page/http
  const ensureServer = async () => {
    if (server) return server;
    if (task.serve?.kind === "static") {
      const dir = path.resolve(appDir, task.serve.dir || ".");
      if (!fs.existsSync(dir)) throw new Error(`không có thư mục ${task.serve.dir}/ (chưa build?)`);
      const s = await staticServer(dir);
      server = { port: s.port, stop: s.stop };
    } else if (task.serve?.kind === "cmd") {
      const port = await freePort();
      const p = spawn("bash", ["-lc", task.serve.start], { cwd: appDir, env: { ...process.env, PORT: String(port), NODE_ENV: "production" }, detached: true, stdio: "ignore" });
      if (!(await waitPort(port))) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* */ } throw new Error(`"${task.serve.start}" không mở cổng PORT=${port} sau 60s`); }
      server = { port, stop: () => { try { process.kill(-p.pid, "SIGKILL"); } catch { /* */ } } };
    } else throw new Error("bài không khai báo serve");
    return server;
  };
  try {
    for (const c of task.checks) {
      try {
        if (c.kind === "pkg") {
          const pj = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
          const have = { ...pj.dependencies, ...pj.devDependencies };
          const miss = c.has.filter((d) => !have[d]);
          add(`package.json có ${c.has.join(", ")}`, !miss.length, miss.length ? "thiếu " + miss.join(", ") : c.has.map((d) => `${d}@${have[d]}`).join(" "));
        } else if (c.kind === "files") {
          const miss = c.paths.filter((f) => !fs.existsSync(path.join(appDir, f)));
          add(`có ${c.paths.join(", ")}`, !miss.length, miss.join(", "));
        } else if (c.kind === "cmd") {
          const r = await sh(c.run, appDir);
          add(c.label || c.run, r.code === 0, r.code === 0 ? "" : r.out.split("\n").filter(Boolean).slice(-6).join(" ⏎ ").slice(0, 500));
        } else if (c.kind === "page") {
          const s = await ensureServer();
          const r = await probe({ url: `http://127.0.0.1:${s.port}${c.path || "/"}`, steps: c.steps });
          if (r.error) { add("mở trang " + (c.path || "/"), false, r.error); continue; }
          add("trang tải được, không lỗi console", r.loaded && !r.errors.length && !r.overlay, [r.errors.slice(0, 3).join(" | "), r.overlay].filter(Boolean).join(" | ").slice(0, 500));
          add("trang không trắng", !r.blank, "");
          for (const st of r.steps) add(st.label, st.ok, st.note || "");
        } else if (c.kind === "http") {
          const s = await ensureServer();
          const r = await fetch(`http://127.0.0.1:${s.port}${c.path}`, { method: c.method, headers: c.body ? { "content-type": "application/json" } : {}, body: c.body ? JSON.stringify(c.body) : undefined }).catch((e) => ({ err: e }));
          const want = [].concat(c.status);
          const label = `${c.method} ${c.path}${c.body ? " " + JSON.stringify(c.body) : ""} → ${want.join("/")}`;
          if (r.err) { add(label, false, String(r.err.message || r.err)); continue; }
          let okj = true, detail = `nhận ${r.status}`;
          if (c.json) {
            const d = await r.json().catch(() => undefined);
            okj = !!new Function("d", `return (${c.json})`)(d);
            if (!okj) detail += ` · JSON không khớp: ${JSON.stringify(d)?.slice(0, 160)}`;
          }
          add(label, want.includes(r.status) && okj, want.includes(r.status) && okj ? "" : detail);
        }
      } catch (e) {
        add(c.label || c.kind, false, String(e.message || e).slice(0, 300));
      }
    }
  } finally {
    server?.stop();
  }
  return res;
}

let runAgent = null;
if (!regrade) {
  const baseUrl = process.env.HANDIO_BENCH_BASE_URL;
  if (!baseUrl) {
    console.error("Thiếu HANDIO_BENCH_BASE_URL (địa chỉ API tương thích OpenAI, vd https://…/v1). Xem labs/code-bench/README.md.\nChỉ muốn xem đề: node labs/code-bench/run.mjs --list");
    process.exit(2);
  }
  // kiểm tra cấu hình TRƯỚC khi tốn thời gian: địa chỉ hợp lệ, máy chủ trả lời, khoá được nhận
  let u;
  try { u = new URL(baseUrl); } catch { /* bên dưới */ }
  if (!u || !/^https?:$/.test(u.protocol) || /[…<>]|\.\.\./.test(baseUrl)) {
    console.error(`HANDIO_BENCH_BASE_URL không hợp lệ: "${baseUrl}"\nĐặt địa chỉ THẬT của API (dạng https://máy-chủ/…/v1), không dùng dấu … làm ví dụ.`);
    process.exit(2);
  }
  {
    const h = {};
    if (process.env.HANDIO_BENCH_KEY) h[process.env.HANDIO_BENCH_KEY_HEADER || "x-ollama-seckey"] = process.env.HANDIO_BENCH_KEY;
    const r = await fetch(baseUrl.replace(/\/+$/, "") + "/models", { headers: h, signal: AbortSignal.timeout(20_000) }).catch((e) => ({ err: e }));
    if (r.err) { console.error(`Không kết nối được ${u.host}: ${r.err.cause?.code || r.err.message}`); process.exit(2); }
    if (r.status === 401 || r.status === 403) { console.error(`Máy chủ từ chối khoá (HTTP ${r.status}). Kiểm HANDIO_BENCH_KEY và HANDIO_BENCH_KEY_HEADER (ví dụ "Authorization" hoặc "x-ollama-seckey").`); process.exit(2); }
    console.log(`Kết nối ${u.host}: HTTP ${r.status}, mô hình ${process.env.HANDIO_BENCH_MODEL || "(mặc định)"}`);
  }
  const bundle = path.join(outDir, ".harness.mjs");
  await build({ entryPoints: [path.join(here, "harness.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "error", external: ["electron"], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  ({ runAgent } = await import(pathToFileURL(bundle).href));
}

const summary = [];
for (const task of tasks) {
  const tdir = path.join(outDir, task.id);
  const appDir = path.join(tdir, "app");
  console.log(`\n▶ ${task.id} — ${task.title}`);
  let agent = null;
  if (!regrade) {
    fs.rmSync(tdir, { recursive: true, force: true });
    fs.mkdirSync(appDir, { recursive: true });
    for (const [f, text] of Object.entries(task.seed || {})) {
      fs.mkdirSync(path.dirname(path.join(appDir, f)), { recursive: true });
      fs.writeFileSync(path.join(appDir, f), text);
    }
    agent = await runAgent({ dir: appDir, prompt: task.prompt, baseUrl: process.env.HANDIO_BENCH_BASE_URL, model: process.env.HANDIO_BENCH_MODEL || "qwen3.5-35b-a3b-int4", key: process.env.HANDIO_BENCH_KEY, keyHeader: process.env.HANDIO_BENCH_KEY_HEADER, timeoutMs });
    fs.writeFileSync(path.join(tdir, "agent.json"), JSON.stringify(agent, null, 2));
    fs.writeFileSync(path.join(tdir, "agent.log"), [`# ${task.id} · ${agent.endedBy} · ${agent.seconds}s · ${agent.steps} bước · ${agent.toolErrors} lỗi công cụ`, "", ...agent.trace, "", "## Lời cuối", agent.final, "", "## Thông báo", ...agent.notices].join("\n"));
    console.log(`  agent: ${agent.endedBy}, ${agent.seconds}s, ${agent.steps} bước, ${agent.toolErrors} lỗi công cụ, ${agent.calls} lượt gọi mô hình`);
    if (agent.endedBy === "error" && agent.steps === 0) {
      console.error(`\nAgent không làm được bước nào: ${agent.notices.concat(agent.errors).join(" | ") || "không rõ lý do"}\nDừng cả lượt chạy (lỗi cấu hình/kết nối, không phải lỗi ứng dụng).`);
      process.exit(2);
    }
  } else if (fs.existsSync(path.join(tdir, "agent.json"))) agent = JSON.parse(fs.readFileSync(path.join(tdir, "agent.json"), "utf8"));
  if (!fs.existsSync(appDir)) { console.log("  (không có thư mục app, bỏ qua)"); continue; }
  const checks = await grade(task, appDir);
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok || !c.detail ? "" : "  — " + c.detail}`);
  const pass = checks.filter((c) => c.ok).length;
  summary.push({ id: task.id, title: task.title, stack: task.stack, trap: task.trap, pass, total: checks.length, ok: pass === checks.length, checks, agent });
  fs.writeFileSync(path.join(tdir, "checks.json"), JSON.stringify(checks, null, 2));
}

const rows = summary.map((s) => `| ${s.ok ? "✅" : "❌"} | ${s.id} | ${s.stack} | ${s.pass}/${s.total} | ${s.agent ? `${s.agent.steps} bước · ${s.agent.toolErrors} lỗi · ${s.agent.seconds}s · ${s.agent.calls} lượt` : "—"} |`);
const failed = summary.filter((s) => !s.ok);
const md = [
  `# Kết quả bài thử Code — ${stamp}`, "",
  `Đạt hoàn toàn: **${summary.length - failed.length}/${summary.length}**`, "",
  "| | Bài | Khung | Kiểm tra | Agent |", "|---|---|---|---|---|", ...rows, "",
  ...failed.flatMap((s) => [`## ❌ ${s.id}`, `Bẫy: ${s.trap}`, ...s.checks.filter((c) => !c.ok).map((c) => `- ${c.name}${c.detail ? ": " + c.detail : ""}`), ...(s.agent?.errors.length ? ["Lỗi công cụ của agent:", ...s.agent.errors.slice(0, 6).map((e) => "  - " + e)] : []), ""]),
].join("\n");
fs.writeFileSync(path.join(outDir, "report.md"), md);
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary.map(({ agent, ...s }) => ({ ...s, agent: agent && { ...agent, trace: undefined } })), null, 2));
fs.rmSync(path.join(outDir, ".harness.mjs"), { force: true });
console.log(`\n${md}\n\nChi tiết: ${path.relative(process.cwd(), outDir)}/ (report.md, <bài>/agent.log, <bài>/app/)`);
process.exit(failed.length ? 1 : 0);
