import type { Env } from "./env";
import { join } from "./path";
import { IGNORE_DIRS } from "./tools";

/** Gợi ý cách chạy dự án (chỉ là gợi ý: lệnh vẫn do agent chạy và phải được người dùng duyệt). */
export interface RunSuggestion {
  command: string;
  /** Chương trình chạy mãi (máy chủ web…): nên chạy nền. */
  background: boolean;
  kind: "run" | "test";
}

const dec = new TextDecoder();
/** Tên tệp/script an toàn để ghép vào lệnh (không có ký tự đặc biệt của shell). */
const SAFE_NAME = /^[A-Za-z0-9_][\w.-]*(\/[A-Za-z0-9_][\w.-]*)*$/;

async function readSmall(env: Env, path: string): Promise<string | null> {
  try {
    const st = await env.stat(path);
    if (!st?.isFile || st.size > 200_000) return null;
    return dec.decode(await env.readBytes(path));
  } catch {
    return null;
  }
}

/** Đọc thư mục gốc (và src/) của dự án rồi đoán lệnh chạy/kiểm thử. Tối đa 5 gợi ý. */
export async function detectRun(env: Env, root: string): Promise<RunSuggestion[]> {
  const out: RunSuggestion[] = [];
  const add = (s: RunSuggestion) => {
    if (!out.some((x) => x.command === s.command)) out.push(s);
  };
  const names = async (dir: string): Promise<string[]> => {
    try {
      return (await env.readdir(dir)).filter((e) => !e.isDir && !IGNORE_DIRS.has(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const top = await names(root);
  const has = (n: string) => top.includes(n);

  // ---- Node: package.json
  const pkgText = has("package.json") ? await readSmall(env, join(root, "package.json")) : null;
  let hasTestScript = false;
  if (pkgText) {
    try {
      const scripts = (JSON.parse(pkgText) as { scripts?: Record<string, unknown> }).scripts ?? {};
      const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
      const run = (n: string) => (pm === "npm" ? (n === "start" ? "npm start" : `npm run ${n}`) : `${pm} ${n}`);
      for (const n of ["dev", "start", "serve"]) if (typeof scripts[n] === "string" && SAFE_NAME.test(n)) add({ command: run(n), background: true, kind: "run" });
      if (typeof scripts.test === "string" && !/no test specified/.test(scripts.test as string)) {
        hasTestScript = true;
        add({ command: pm === "npm" ? "npm test" : `${pm} test`, background: false, kind: "test" });
      }
    } catch {
      /* package.json hỏng: bỏ qua */
    }
  }

  // ---- Python
  const srcNames = await names(join(root, "src"));
  const py = [...top.filter((n) => n.endsWith(".py")), ...srcNames.filter((n) => n.endsWith(".py")).map((n) => "src/" + n)];
  for (const f of py.filter((n) => SAFE_NAME.test(n) && !/(^|\/)(test_.*|.*_test)\.py$/.test(n)).slice(0, 12)) {
    const text = (await readSmall(env, join(root, f))) ?? "";
    if (/^\s*(import|from)\s+streamlit\b/m.test(text)) add({ command: `streamlit run ${f}`, background: true, kind: "run" });
  }
  const pyMain = ["main.py", "app.py", "run.py", "src/main.py"].find((n) => py.includes(n));
  if (pyMain && !out.some((x) => x.command.startsWith("streamlit run " + pyMain))) {
    const text = (await readSmall(env, join(root, pyMain))) ?? "";
    add({ command: `python3 ${pyMain}`, background: /\b(app|server)\.run\(|uvicorn\.run\(|http\.server|serve_forever/.test(text), kind: "run" });
  }
  if (py.some((n) => /(^|\/)test_.*\.py$/.test(n)) || (await names(join(root, "tests"))).some((n) => n.endsWith(".py"))) add({ command: "python3 -m pytest", background: false, kind: "test" });

  // ---- JavaScript thuần (không có package.json scripts)
  const jsTests = [...top.filter((n) => /\.test\.[cm]?js$/.test(n)), ...srcNames.filter((n) => /\.test\.[cm]?js$/.test(n)).map((n) => "src/" + n)].filter((n) => SAFE_NAME.test(n));
  if (!hasTestScript) for (const f of jsTests.slice(0, 2)) add({ command: `node ${f}`, background: false, kind: "test" });
  const jsMain = ["index.js", "main.js", "app.js", "server.js"].find((n) => has(n));
  if (jsMain && !out.some((x) => x.kind === "run")) add({ command: `node ${jsMain}`, background: /\b(listen|createServer)\(/.test((await readSmall(env, join(root, jsMain))) ?? ""), kind: "run" });

  // ---- Trang web tĩnh
  if (has("index.html") && !out.some((x) => x.kind === "run" && x.background)) add({ command: "python3 -m http.server 8000 --bind 127.0.0.1", background: true, kind: "run" });

  // chạy trước, kiểm thử sau
  return out.sort((a, b) => Number(b.kind === "run") - Number(a.kind === "run")).slice(0, 5);
}
