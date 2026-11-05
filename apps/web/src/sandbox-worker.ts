// Chạy trong Web Worker riêng (file tĩnh sandbox-worker.js, nên có CSP riêng từ header phản hồi: không mạng).
// Worker không có DOM/localStorage. Ngoài ra gỡ các API có thể đọc/ghi dữ liệu hoặc ra mạng (lớp phòng thủ thêm).
const post = self.postMessage.bind(self);
const onmsg = (cb: (e: MessageEvent) => void) => (self.onmessage = cb);
const logs: string[] = [];
const fmt = (a: unknown[]) => a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");
console.log = console.info = console.debug = (...a: unknown[]) => void logs.push(fmt(a));
console.error = console.warn = (...a: unknown[]) => void logs.push("[lỗi] " + fmt(a));

for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "WebTransport", "navigator"]) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* một số thuộc tính không gỡ được */
  }
}

class ExitSignal {
  constructor(public code: number) {}
}

/** assert tối thiểu (đủ cho các bài kiểm thử sinh viên hay viết): không đụng gì ngoài giá trị được truyền vào. */
const assertShim = (() => {
  const fail = (msg: unknown, fallback: string) => {
    throw Object.assign(new Error(msg === undefined ? fallback : String(msg)), { name: "AssertionError" });
  };
  const show = (v: unknown) => fmt([v]);
  const deep = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  };
  const ok = (v: unknown, m?: unknown) => void (v || fail(m, `Expected truthy, got ${show(v)}`));
  return Object.assign((v: unknown, m?: unknown) => ok(v, m), {
    ok,
    equal: (a: unknown, b: unknown, m?: unknown) => void (a == b || fail(m, `Expected ${show(b)}, got ${show(a)}`)),
    notEqual: (a: unknown, b: unknown, m?: unknown) => void (a != b || fail(m, `Expected not ${show(b)}`)),
    strictEqual: (a: unknown, b: unknown, m?: unknown) => void (Object.is(a, b) || fail(m, `Expected ${show(b)}, got ${show(a)}`)),
    notStrictEqual: (a: unknown, b: unknown, m?: unknown) => void (!Object.is(a, b) || fail(m, `Expected not ${show(b)}`)),
    deepEqual: (a: unknown, b: unknown, m?: unknown) => void (deep(a, b) || fail(m, `Expected ${show(b)}, got ${show(a)}`)),
    deepStrictEqual: (a: unknown, b: unknown, m?: unknown) => void (deep(a, b) || fail(m, `Expected ${show(b)}, got ${show(a)}`)),
    throws: (fn: () => unknown, m?: unknown) => {
      try {
        fn();
      } catch {
        return;
      }
      fail(typeof m === "string" ? m : undefined, "Expected function to throw");
    },
  });
})();

/** Bộ nạp CommonJS tối thiểu trên các tệp của dự án: require("./src/x"), module.exports, process.exit (giống `node`). */
function makeRequire(files: Record<string, string>, cwd: string) {
  const cache = new Map<string, { exports: unknown }>();
  const norm = (p: string) => {
    const out: string[] = [];
    for (const seg of p.split("/")) if (seg && seg !== ".") seg === ".." ? out.pop() : out.push(seg);
    return out.join("/");
  };
  const out = { write: (t: unknown) => (logs.push(String(t).replace(/\n$/, "")), true) };
  const proc = { argv: ["node", "script"], env: {}, platform: "browser", cwd: () => "/" + cwd, stdout: out, stderr: out, exit: (c?: number) => { throw new ExitSignal(c ?? 0); } };
  const here = (p: string) => norm(p.startsWith("/") ? p : cwd + "/" + p);
  const isDir = (k: string) => !k || Object.keys(files).some((f) => f.startsWith(k + "/"));
  // fs CHỈ ĐỌC trên các tệp của dự án (đủ cho bài chấm đọc index.html…)
  const fsShim = {
    readFileSync: (p: string) => {
      const k = here(String(p));
      if (!(k in files)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
      return files[k];
    },
    existsSync: (p: string) => here(String(p)) in files || isDir(here(String(p))),
    readdirSync: (p: string) => {
      const k = here(String(p));
      if (!isDir(k)) throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${p}'`), { code: "ENOENT" });
      return [...new Set(Object.keys(files).filter((f) => !k || f.startsWith(k + "/")).map((f) => f.slice(k ? k.length + 1 : 0).split("/")[0]))].sort();
    },
    statSync: (p: string) => {
      const k = here(String(p));
      if (!(k in files) && !isDir(k)) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: "ENOENT" });
      return { isFile: () => k in files, isDirectory: () => !(k in files), size: files[k]?.length ?? 0 };
    },
  };
  const pathShim = {
    join: (...a: string[]) => norm(a.join("/")),
    resolve: (...a: string[]) => "/" + norm(a.join("/")),
    basename: (p: string) => String(p).split("/").pop() ?? "",
    dirname: (p: string) => String(p).split("/").slice(0, -1).join("/") || ".",
    extname: (p: string) => /\.[^./]+$/.exec(String(p))?.[0] ?? "",
  };
  const load = (from: string) => (rawName: string): unknown => {
    const name = rawName.replace(/^node:/, "");
    if (name === "fs") return fsShim;
    if (name === "path") return pathShim;
    if (name === "assert") return assertShim;
    if (!name.startsWith(".") && !name.startsWith("/")) throw new Error(`Cannot find module '${name}' (hộp cát chỉ nạp được tệp của dự án, không có thư viện ngoài)`);
    const base = name.startsWith("/") ? norm(name) : norm(from.split("/").slice(0, -1).join("/") + "/" + name);
    const path = [base, base + ".js", base + ".json", base + "/index.js"].find((p) => p in files);
    if (!path) throw new Error(`Cannot find module '${name}' (các tệp có sẵn: ${Object.keys(files).filter((f) => f.endsWith(".js")).slice(0, 8).join(", ")})`);
    if (path.endsWith(".json")) return JSON.parse(files[path]);
    let m = cache.get(path);
    if (!m) {
      m = { exports: {} };
      cache.set(path, m);
      new Function("module", "exports", "require", "process", "__dirname", "__filename", files[path])(m, m.exports, load(path), proc, "/" + path.split("/").slice(0, -1).join("/"), "/" + path);
    }
    return m.exports;
  };
  return { require: load(""), process: proc, dir: "/" + cwd };
}

onmsg(async (e) => {
  const { id, code, files, cwd } = e.data as { id: string; code: string; files: Record<string, string>; cwd?: string };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const sys = makeRequire(files, cwd ?? "");
    const mod = { exports: {} };
    const r = await new AsyncFunction("files", "require", "process", "module", "exports", "__dirname", "__filename", code)(files, sys.require, sys.process, mod, mod.exports, sys.dir, sys.dir + "/script.js");
    post({ id, ok: true, logs, result: r === undefined ? undefined : fmt([r]) });
  } catch (err) {
    if (err instanceof ExitSignal) post({ id, ok: err.code === 0, logs, result: err.code === 0 ? undefined : undefined, error: err.code === 0 ? undefined : `process.exit(${err.code})` });
    else post({ id, ok: false, logs, error: String((err && (err as Error).stack) || err) });
  }
});
