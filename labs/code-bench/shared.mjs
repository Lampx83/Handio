// Phần dùng chung của các bài thử có mô hình thật (code-bench, agent-eval): kết nối mô hình, trình duyệt ẩn.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";

/**
 * Đọc cấu hình từ biến môi trường (thiếu thì hỏi trong terminal), đăng nhập, kiểm tra máy chủ trả lời.
 * Sai cấu hình thì in lý do và thoát mã 2. Mật khẩu chỉ nằm trong biến môi trường của người chạy, không ghi ra đâu.
 */
export async function connectModel({ retry = "node labs/code-bench/run.mjs --only 03,04" } = {}) {
  let cookie = "", cookieAt = 0, authHeaders = null;
  // biến môi trường còn sót chữ mẫu (export từ hướng dẫn cũ, giữ nguyên trong cửa sổ terminal): bỏ qua và hỏi lại / dùng mặc định
  for (const n of ["HANDIO_BENCH_BASE_URL", "HANDIO_BENCH_KEY", "HANDIO_BENCH_USER", "HANDIO_BENCH_PASSWORD"]) {
    if (process.env[n] && /[^\x20-\x7e]/.test(process.env[n])) {
      console.log(`(Bỏ qua ${n}: còn là chữ mẫu, không phải giá trị thật.)`);
      delete process.env[n];
    }
  }
  // mặc định là máy chủ của Handio; chỉ cần đặt biến khi dùng máy chủ khác
  const baseUrl = process.env.HANDIO_BENCH_BASE_URL || "https://ai.neu.edu.vn/agent/vllm/v1";
  process.env.HANDIO_BENCH_BASE_URL = baseUrl;
  const ask = (q, hidden) =>
    new Promise((res) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      if (hidden) rl._writeToOutput = (t) => { if (t.includes(q)) process.stdout.write(t); }; // không hiện ký tự gõ
      rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
    });
  if (!process.env.HANDIO_BENCH_KEY && !process.env.HANDIO_BENCH_USER) {
    if (!process.stdin.isTTY) {
      console.error("Chưa có thông tin đăng nhập: đặt HANDIO_BENCH_USER + HANDIO_BENCH_PASSWORD hoặc HANDIO_BENCH_KEY (hoặc chạy trong terminal để được hỏi).");
      process.exit(2);
    }
    console.log(`Máy chủ mô hình: ${baseUrl}\nĐăng nhập bằng: [1] tài khoản (tên + mật khẩu)   [2] khoá API`);
    const how = await ask("Chọn 1 hoặc 2: ");
    if (how === "2") process.env.HANDIO_BENCH_KEY = await ask("Khoá API (gõ không hiện): ", true);
    else {
      process.env.HANDIO_BENCH_USER = await ask("Tên tài khoản: ");
      process.env.HANDIO_BENCH_PASSWORD = await ask("Mật khẩu (gõ không hiện): ", true);
    }
  }
  // chữ mẫu trong hướng dẫn (ĐỊA-CHỈ…, …, KHOÁ-THẬT) mà chưa thay bằng giá trị thật → báo rõ, không để lỗi khó hiểu
  for (const [name, v] of [["HANDIO_BENCH_BASE_URL", baseUrl], ["HANDIO_BENCH_KEY", process.env.HANDIO_BENCH_KEY], ["HANDIO_BENCH_USER", process.env.HANDIO_BENCH_USER], ["HANDIO_BENCH_PASSWORD", process.env.HANDIO_BENCH_PASSWORD]]) {
    if (v && /[^\x20-\x7e]/.test(v)) {
      console.error(`${name} có ký tự không hợp lệ (có vẻ vẫn là chữ mẫu trong hướng dẫn, chưa thay bằng giá trị thật).\nChạy lại và để chương trình tự hỏi: ${retry}`);
      process.exit(2);
    }
  }
  // kiểm tra cấu hình TRƯỚC khi tốn thời gian: địa chỉ hợp lệ, máy chủ trả lời, khoá được nhận
  let u;
  try { u = new URL(baseUrl); } catch { /* bên dưới */ }
  if (!u || !/^https?:$/.test(u.protocol) || /[…<>]|\.\.\./.test(baseUrl)) {
    console.error(`HANDIO_BENCH_BASE_URL không hợp lệ: "${baseUrl}"\nĐặt địa chỉ THẬT của API (dạng https://máy-chủ/…/v1), không dùng dấu … làm ví dụ.`);
    process.exit(2);
  }
  if (process.env.HANDIO_BENCH_USER) {
    // như Handio Desktop: gửi form tên + mật khẩu một lần, giữ cookie phiên
    const signIn = baseUrl.replace(/\/vllm\/v1\/?$/, "/oauth2/sign_in");
    const login = async () => {
      const r = await fetch(signIn, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, body: new URLSearchParams({ username: process.env.HANDIO_BENCH_USER, password: process.env.HANDIO_BENCH_PASSWORD || "", rd: "/" }).toString() });
      const jar = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter((c) => c.startsWith("_neuagent_sso") && c.split("=")[1]);
      if (r.status === 429) throw new Error("đăng nhập thử quá nhiều lần, đợi một phút");
      if (![302, 303].includes(r.status) || !jar.length) throw new Error("tên hoặc mật khẩu không đúng");
      return jar.join("; ");
    };
    try { cookie = await login(); cookieAt = Date.now(); } catch (e) { console.error(`Đăng nhập thất bại (${new URL(signIn).host}): ${e.message}`); process.exit(2); }
    authHeaders = async () => {
      if (Date.now() - cookieAt > 20 * 60_000) { cookie = await login(); cookieAt = Date.now(); } // phiên làm mới định kỳ cho bài chạy lâu
      return { Cookie: cookie };
    };
    console.log(`Đã đăng nhập bằng tài khoản ${process.env.HANDIO_BENCH_USER}`);
  }
  const model = process.env.HANDIO_BENCH_MODEL || "qwen3.5-35b-a3b-int4";
  const h = cookie ? { Cookie: cookie } : {};
  if (process.env.HANDIO_BENCH_KEY) h[process.env.HANDIO_BENCH_KEY_HEADER || "x-ollama-seckey"] = process.env.HANDIO_BENCH_KEY;
  const r = await fetch(baseUrl.replace(/\/+$/, "") + "/models", { headers: h, signal: AbortSignal.timeout(20_000) }).catch((e) => ({ err: e }));
  if (r.err) { console.error(`Không kết nối được ${u.host}: ${r.err.cause?.code || r.err.message}`); process.exit(2); }
  if (r.status === 401 || r.status === 403) { console.error(`Máy chủ từ chối khoá (HTTP ${r.status}). Kiểm HANDIO_BENCH_KEY và HANDIO_BENCH_KEY_HEADER (ví dụ "Authorization" hoặc "x-ollama-seckey").`); process.exit(2); }
  console.log(`Kết nối ${u.host}: HTTP ${r.status}, mô hình ${model}`);
  return { baseUrl, model, key: process.env.HANDIO_BENCH_KEY, keyHeader: process.env.HANDIO_BENCH_KEY_HEADER, authHeaders };
}

/** Đường dẫn Electron trong node_modules của kho; chưa `npm ci` thì trả chuỗi rỗng. */
export function electronBin(root) {
  try { return createRequire(path.join(root, "apps/desktop/package.json"))("electron"); } catch { return ""; }
}

/** Chạy probe.cjs trong Electron ẩn với một cấu hình; trả kết quả JSON hoặc {error}. */
export function runProbe(cfg, { root, tmpDir }) {
  return new Promise((resolve) => {
    const bin = electronBin(root);
    if (!bin) return resolve({ error: "không tìm thấy Electron (npm ci ở gốc kho)" });
    const f = path.join(tmpDir, `.probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(f, JSON.stringify(cfg));
    const p = spawn(bin, [path.join(root, "labs/code-bench/probe.cjs"), f], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
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

/** Đổi bước của công cụ check_page (PageStep) sang bước của probe. */
export function toProbeSteps(steps = []) {
  return steps.map((s) => {
    const by = s.selector ? { selector: s.selector } : { text: s.text };
    if (s.action === "click") return { click: by };
    if (s.action === "type") return { fill: s.selector ? { selector: s.selector } : { placeholder: s.text }, value: s.value ?? "" };
    if (s.action === "wait") return { wait: s.ms ?? 500 };
    return { eval: `document.body.innerText.includes(${JSON.stringify(s.text ?? "")})`, label: `cần thấy “${s.text ?? ""}”`, note: "không thấy chữ này trên trang" };
  });
}

/** check_page cho agent trong lúc làm (như bản Desktop): cùng trình duyệt ẩn với bộ chấm. */
export async function probeCheckPage(url, o, { root, tmpDir }) {
  const r = await runProbe({ url, steps: toProbeSteps(o.steps), stopOnFail: true, settleMs: o.waitMs, root: o.root }, { root, tmpDir });
  if (r.error) return { url, title: "", loaded: false, error: r.error, errors: [], failedRequests: [], text: "", blank: false };
  // như bản Desktop: khi có steps, `errors` chỉ gồm lỗi lúc tải; lỗi sau mỗi bước nằm ở steps[i].errors
  const afterSteps = (r.steps || []).reduce((n, st) => n + (st.errors?.length || 0), 0);
  const errors = (r.errors || []).slice(0, (r.errors || []).length - afterSteps);
  return { url, title: r.title || "", loaded: r.loaded, errors, failedRequests: r.failedRequests || [], text: r.text || "", blank: !!r.blank, overlay: r.overlay || undefined, buttons: r.buttons, ...(o.steps?.length ? { steps: r.steps } : {}) };
}
