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

/** Bộ nạp CommonJS tối thiểu trên các tệp của dự án: require("./src/x"), module.exports, process.exit (giống `node`). */
function makeRequire(files: Record<string, string>, cwd: string) {
  const cache = new Map<string, { exports: unknown }>();
  const norm = (p: string) => {
    const out: string[] = [];
    for (const seg of p.split("/")) if (seg && seg !== ".") seg === ".." ? out.pop() : out.push(seg);
    return out.join("/");
  };
  const proc = { argv: ["node", "script"], env: {}, platform: "browser", cwd: () => "/" + cwd, exit: (c?: number) => { throw new ExitSignal(c ?? 0); } };
  const here = (p: string) => norm(p.startsWith("/") ? p : cwd + "/" + p);
  // fs CHỈ ĐỌC trên các tệp của dự án (đủ cho bài chấm đọc index.html…)
  const fsShim = {
    readFileSync: (p: string) => {
      const k = here(String(p));
      if (!(k in files)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
      return files[k];
    },
    existsSync: (p: string) => here(String(p)) in files,
  };
  const pathShim = {
    join: (...a: string[]) => norm(a.join("/")),
    resolve: (...a: string[]) => "/" + norm(a.join("/")),
    basename: (p: string) => String(p).split("/").pop() ?? "",
    dirname: (p: string) => String(p).split("/").slice(0, -1).join("/") || ".",
    extname: (p: string) => /\.[^./]+$/.exec(String(p))?.[0] ?? "",
  };
  const load = (from: string) => (name: string): unknown => {
    if (name === "fs") return fsShim;
    if (name === "path") return pathShim;
    if (!name.startsWith(".") && !name.startsWith("/")) throw new Error(`Cannot find module '${name}' (hộp cát chỉ nạp được tệp của dự án, không có thư viện ngoài)`);
    const base = name.startsWith("/") ? norm(name) : norm(from.split("/").slice(0, -1).join("/") + "/" + name);
    const path = [base, base + ".js", base + "/index.js"].find((p) => p in files);
    if (!path) throw new Error(`Cannot find module '${name}' (các tệp có sẵn: ${Object.keys(files).filter((f) => f.endsWith(".js")).slice(0, 8).join(", ")})`);
    let m = cache.get(path);
    if (!m) {
      m = { exports: {} };
      cache.set(path, m);
      new Function("module", "exports", "require", "process", "__dirname", "__filename", files[path])(m, m.exports, load(path), proc, "/" + path.split("/").slice(0, -1).join("/"), "/" + path);
    }
    return m.exports;
  };
  return { require: load(""), process: proc };
}

onmsg(async (e) => {
  const { id, code, files, cwd } = e.data as { id: string; code: string; files: Record<string, string>; cwd?: string };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const sys = makeRequire(files, cwd ?? "");
    const r = await new AsyncFunction("files", "require", "process", code)(files, sys.require, sys.process);
    post({ id, ok: true, logs, result: r === undefined ? undefined : fmt([r]) });
  } catch (err) {
    if (err instanceof ExitSignal) post({ id, ok: err.code === 0, logs, result: err.code === 0 ? undefined : undefined, error: err.code === 0 ? undefined : `process.exit(${err.code})` });
    else post({ id, ok: false, logs, error: String((err && (err as Error).stack) || err) });
  }
});
