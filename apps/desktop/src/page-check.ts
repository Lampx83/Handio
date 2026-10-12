// check_page (tab Code): mở một trang của chính dự án (máy chủ dev trên localhost hoặc tệp HTML trong dự án) trong một cửa sổ ẨN và cách ly,
// rồi báo lại lỗi console, yêu cầu hỏng, trang trắng, để agent tự thấy lỗi mà không phải nhờ người dùng chép từ trình duyệt.
//
// Cô lập: phiên trong bộ nhớ riêng cho từng lần kiểm tra, sandbox, không preload, không Node, từ chối mọi quyền (camera, thông báo…), chỉ cho
// nạp tài nguyên từ localhost/127.0.0.1/[::1] hoặc tệp nằm trong thư mục dự án; MỌI yêu cầu ra ngoài bị chặn (và được ghi lại). Điều hướng và
// cửa sổ mới bị chặn. Có giới hạn thời gian cứng.
import { BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageReport } from "@neu/agent-core";

// ws/wss loopback: Vite (HMR) mở ws://localhost:<cổng>; chặn nó làm MỌI trang Vite báo lỗi "WebSocket failed" giả và agent sửa nhầm cấu hình
const LOOPBACK = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;
const MAX_ERRORS = 15;
/** Lỗi console không ảnh hưởng ứng dụng đang làm (công cụ dựng báo về chính nó): không để agent đi "sửa" chúng. */
export const BENIGN = [/\[vite\] failed to connect to websocket/i, /\[vite\] server connection lost/i];

/** URL được phép tải: loopback, tệp trong thư mục dự án, data:/blob:/devtools: nội bộ. */
export function allowedUrl(url: string, root?: string): boolean {
  if (LOOPBACK.test(url)) return true;
  if (/^(data|blob|about):/i.test(url)) return true;
  if (/^file:/i.test(url) && root) {
    try {
      const p = path.resolve(fileURLToPath(url));
      const r = path.resolve(root);
      return p === r || p.startsWith(r + path.sep);
    } catch {
      return false;
    }
  }
  return false;
}

const shorten = (s: string, n = 320) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const where = (src?: string, line?: number) => {
  if (!src) return "";
  try {
    const u = new URL(src);
    return ` (${path.basename(u.pathname)}${line ? ":" + line : ""})`;
  } catch {
    return ` (${path.basename(src)}${line ? ":" + line : ""})`;
  }
};
const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + (x.search ? "?…" : "");
  } catch {
    return u.slice(0, 80);
  }
};

export async function checkPage(url: string, o: { waitMs: number; root?: string; signal?: AbortSignal }): Promise<PageReport> {
  const rep: PageReport = { url, title: "", loaded: false, errors: [], failedRequests: [], text: "", blank: false };
  if (!allowedUrl(url, o.root)) return { ...rep, error: "Chỉ mở được trang trên máy này (localhost) hoặc tệp trong dự án." };

  const part = "page-check-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // không có tiền tố "persist:" → trong bộ nhớ
  const ses = session.fromPartition(part);
  const blocked = new Set<string>();
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (allowedUrl(d.url, o.root)) return cb({});
    try {
      blocked.add(new URL(d.url).host || d.url.slice(0, 40));
    } catch {
      blocked.add(d.url.slice(0, 40));
    }
    cb({ cancel: true });
  });
  ses.webRequest.onCompleted((d) => {
    if (d.statusCode >= 400 && rep.failedRequests.length < 12) rep.failedRequests.push(`${d.statusCode} ${pathOf(d.url)}`);
  });
  ses.webRequest.onErrorOccurred((d) => {
    if (d.error === "net::ERR_ABORTED" || d.error === "net::ERR_BLOCKED_BY_CLIENT") return;
    if (rep.failedRequests.length < 12) rep.failedRequests.push(`${d.error.replace(/^net::/, "")} ${pathOf(d.url)}`);
  });
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));

  const w = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { partition: part, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  const wc = w.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e, to) => {
    if (!allowedUrl(to, o.root)) e.preventDefault();
  });
  const seen = new Set<string>();
  const addError = (msg: string) => {
    const m = shorten(msg);
    if (!m || seen.has(m) || rep.errors.length >= MAX_ERRORS) return;
    if (BENIGN.some((re) => re.test(m))) return;
    seen.add(m);
    rep.errors.push(m);
  };
  // Electron ≥ 35: một đối tượng sự kiện có level/message/lineNumber/sourceId; bản cũ truyền (event, level, message, line, sourceId)
  wc.on("console-message", ((e: { level?: string | number; message?: string; lineNumber?: number; sourceId?: string }, ...legacy: unknown[]) => {
    const level = e.level ?? legacy[0];
    const message = e.message ?? (legacy[1] as string | undefined) ?? "";
    const line = e.lineNumber ?? (legacy[2] as number | undefined);
    const src = e.sourceId ?? (legacy[3] as string | undefined);
    if (level === "error" || level === 3) addError(message + where(src, line));
  }) as never);
  wc.on("render-process-gone", (_e, d) => addError("Tiến trình vẽ trang bị sập: " + d.reason));
  let loadFail = "";
  wc.on("did-fail-load", (_e, code, desc, _u, isMain) => {
    if (isMain && code !== -3) loadFail = desc || String(code);
  });

  const abort = () => {
    if (!w.isDestroyed()) w.destroy();
  };
  o.signal?.addEventListener("abort", abort, { once: true });
  const hard = setTimeout(abort, 20_000);
  try {
    try {
      await wc.loadURL(url);
    } catch (e) {
      const msg = loadFail || (e as Error).message || "không tải được";
      return { ...rep, error: shorten(msg.replace(/^ERR_/, "ERR_"), 200) };
    }
    rep.loaded = true;
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(o.waitMs, 8000))));
    if (w.isDestroyed()) return { ...rep, loaded: false, error: "Đã dừng." };
    // lệnh đo do ỨNG DỤNG chạy (chỉ đọc DOM); mã của trang vẫn chạy bình thường trong cửa sổ cách ly
    const dom = (await wc.executeJavaScript(`(() => {
      const body = document.body;
      const text = ((body && body.innerText) || "").replace(/\\s+/g, " ").trim();
      const shown = body ? [...body.querySelectorAll("img,canvas,svg,video,iframe,input,button,select,textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).length : 0;
      let overlay = "";
      const o = document.querySelector("vite-error-overlay");
      if (o && o.shadowRoot) overlay = (o.shadowRoot.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 700);
      return { title: document.title || "", text: text.slice(0, 600), blank: text.length === 0 && shown === 0, overlay };
    })()`, true).catch(() => null)) as { title: string; text: string; blank: boolean; overlay: string } | null;
    if (dom) {
      rep.title = shorten(dom.title, 120);
      rep.text = dom.text;
      rep.blank = dom.blank;
      if (dom.overlay) rep.overlay = dom.overlay;
    }
    if (blocked.size) rep.failedRequests.push(`đã chặn yêu cầu ra ngoài máy: ${[...blocked].slice(0, 4).join(", ")}`);
    return rep;
  } finally {
    clearTimeout(hard);
    o.signal?.removeEventListener("abort", abort);
    if (!w.isDestroyed()) w.destroy();
  }
}
