// check_page (tab Code): mở một trang của chính dự án (máy chủ dev trên localhost hoặc tệp HTML trong dự án) trong một cửa sổ ẨN và cách ly,
// rồi báo lại lỗi console, yêu cầu hỏng, trang trắng, để agent tự thấy lỗi mà không phải nhờ người dùng chép từ trình duyệt.
//
// Cô lập: phiên trong bộ nhớ riêng cho từng lần kiểm tra, sandbox, không preload, không Node, từ chối mọi quyền (camera, thông báo…), chỉ cho
// nạp tài nguyên từ localhost/127.0.0.1/[::1] hoặc tệp nằm trong thư mục dự án; MỌI yêu cầu ra ngoài bị chặn (và được ghi lại). Điều hướng và
// cửa sổ mới bị chặn. Có giới hạn thời gian cứng.
//
// `steps` (bấm/gõ/chờ/kiểm chữ): lệnh của ỨNG DỤNG tạo sẵn (giá trị của mô hình chỉ đi vào dưới dạng chuỗi JSON), chạy trong chính trang cách ly đó
// như một người bấm chuột; không cấp thêm quyền gì cho trang. Hộp thoại alert/confirm/prompt không bật lên màn hình (confirm tự đồng ý, được ghi lại).
import { BrowserWindow, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_PAGE_STEPS, MAX_STEP_WAIT_MS, pageStepLabel, type PageReport, type PageStep, type PageStepResult } from "@neu/agent-core";

// ws/wss loopback: Vite (HMR) mở ws://localhost:<cổng>; chặn nó làm MỌI trang Vite báo lỗi "WebSocket failed" giả và agent sửa nhầm cấu hình
const LOOPBACK = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;
const MAX_ERRORS = 15;
/** Sau mỗi bước chờ chừng này để lỗi console của bước (đến qua IPC, không đồng bộ) được tính đúng cho bước đó. */
const STEP_SETTLE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

/**
 * Thay alert/confirm/prompt trong trang: không hiện hộp thoại (cửa sổ ẩn sẽ treo hoặc bật lên màn hình người dùng), confirm tự đồng ý
 * (để đi tiếp được luồng "Nộp bài?"), nội dung được ghi lại để báo cho agent.
 */
const DIALOG_HOOK = `(() => {
  if (window.__hcDialogs) return true;
  window.__hcDialogs = [];
  const note = (k, m) => { if (window.__hcDialogs.length < 20) window.__hcDialogs.push(k + ": " + String(m ?? "").replace(/\\s+/g, " ").slice(0, 160)); };
  window.alert = (m) => { note("alert", m); };
  window.confirm = (m) => { note("confirm", m); return true; };
  window.prompt = (m, d) => { note("prompt", m); return d ?? ""; };
  return true;
})()`;

/** Mã chạy một bước trong trang. Giá trị của mô hình chỉ đi vào qua JSON.stringify (không ghép chuỗi mã). */
export function stepScript(st: PageStep): string {
  return `(() => {
  const st = ${JSON.stringify(st)};
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const norm = (x) => (x || "").replace(/[\\p{Extended_Pictographic}\\uFE0F\\u200d]/gu, "").replace(/\\s+/g, " ").trim().toLowerCase();
  const pick = (sel) => { try { return document.querySelector(sel); } catch { throw new Error("bộ chọn CSS không hợp lệ: " + sel); } };
  const buttons = () => [...document.querySelectorAll("button,[role=button],input[type=submit],input[type=button]")].filter(vis).map((e) => (e.textContent || e.value || e.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  const miss = (what) => ({ ok: false, note: what + (buttons().length ? "; nút đang hiện: " + buttons().map((b) => "“" + b + "”").join(", ") : "; trang không có nút nào đang hiện") });
  if (st.action === "click") {
    let el = null;
    if (st.selector) el = pick(st.selector);
    else {
      const t = norm(st.text);
      const labels = (e) => [e.textContent, e.value, e.getAttribute("aria-label"), e.getAttribute("title")].map(norm).filter(Boolean);
      const inter = [...document.querySelectorAll("button,a,[role=button],[role=tab],[role=link],[role=option],[role=radio],[role=checkbox],input[type=button],input[type=submit],input[type=radio],input[type=checkbox],summary,label,[onclick]")].filter(vis);
      const generic = [...document.querySelectorAll("li,span,div,p,td,h1,h2,h3,h4")].filter((e) => vis(e) && e.children.length <= 3);
      el = inter.find((e) => labels(e).includes(t)) || inter.find((e) => labels(e).some((l) => l.includes(t))) ||
        generic.find((e) => norm(e.textContent) === t) || generic.find((e) => norm(e.textContent).includes(t));
    }
    if (!el) return miss("không tìm thấy " + (st.selector ? "phần tử " + st.selector : "nút “" + st.text + "”"));
    if (el.disabled) return { ok: false, note: "nút đang bị vô hiệu (disabled)" };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true };
  }
  if (st.action === "type") {
    let el = null;
    const fields = [...document.querySelectorAll("input,textarea,select,[contenteditable=true]")].filter(vis);
    if (st.selector) el = pick(st.selector);
    else {
      const t = norm(st.text);
      el = fields.find((e) => norm(e.placeholder) === t || norm(e.getAttribute("aria-label")) === t || norm(e.name) === t) ||
        fields.find((e) => norm(e.placeholder).includes(t) || norm(e.getAttribute("aria-label")).includes(t));
      if (!el) { const l = [...document.querySelectorAll("label")].find((x) => norm(x.textContent).includes(t)); el = l && (l.control || l.querySelector("input,textarea,select")); }
    }
    if (!el) return { ok: false, note: "không tìm thấy ô nhập " + (st.selector || "“" + st.text + "”") + (fields.length ? "; ô đang hiện: " + fields.slice(0, 8).map((e) => e.placeholder || e.name || e.id || e.tagName.toLowerCase()).join(", ") : "") };
    el.focus();
    if (el.isContentEditable) el.textContent = st.value;
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value").set;
      set.call(el, st.value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  if (st.action === "expect_text") {
    const has = norm(document.body && document.body.innerText).includes(norm(st.text));
    return has ? { ok: true } : { ok: false, note: "không thấy chữ “" + st.text + "” trên trang" };
  }
  return { ok: true };
})()`;
}

export async function checkPage(url: string, o: { waitMs: number; steps?: PageStep[]; root?: string; signal?: AbortSignal }): Promise<PageReport> {
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
    // disableDialogs: hộp thoại lúc tải trang (trước khi kịp thay alert/confirm) không bật lên màn hình người dùng
    webPreferences: { partition: part, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, disableDialogs: true },
  });
  const wc = w.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e, to) => {
    if (!allowedUrl(to, o.root)) e.preventDefault();
  });
  const seen = new Set<string>();
  // lỗi đang được tính cho đâu: lúc tải (rep.errors) hay bước đang chạy
  let sink = rep.errors;
  let total = 0;
  const addError = (msg: string) => {
    const m = shorten(msg);
    if (!m || seen.has(m) || total >= MAX_ERRORS * 2 || sink.length >= MAX_ERRORS) return;
    if (BENIGN.some((re) => re.test(m))) return;
    seen.add(m);
    total++;
    sink.push(m);
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
  const steps = (o.steps ?? []).slice(0, MAX_PAGE_STEPS);
  // hạn cứng: 20 s cho lúc tải, thêm cho các bước (mỗi bước tối đa chờ 3 s + thời gian lắng) — vẫn có trần
  const hard = setTimeout(abort, 20_000 + steps.length * (MAX_STEP_WAIT_MS + STEP_SETTLE_MS + 1000));
  try {
    try {
      await wc.loadURL(url);
    } catch (e) {
      const msg = loadFail || (e as Error).message || "không tải được";
      return { ...rep, error: shorten(msg.replace(/^ERR_/, "ERR_"), 200) };
    }
    rep.loaded = true;
    await sleep(Math.max(0, Math.min(o.waitMs, 8000)));
    if (w.isDestroyed()) return { ...rep, loaded: false, error: "Đã dừng." };
    if (steps.length) {
      rep.steps = [];
      for (const st of steps) {
        const res: PageStepResult = { label: pageStepLabel(st), ok: true, errors: [] };
        rep.steps.push(res);
        sink = res.errors;
        try {
          await wc.executeJavaScript(DIALOG_HOOK, true); // trang có thể vừa điều hướng sang trang khác: gắn lại
          if (st.action === "wait") await sleep(Math.max(0, Math.min(st.ms ?? 500, MAX_STEP_WAIT_MS)));
          else {
            const r = (await wc.executeJavaScript(stepScript(st), true)) as { ok: boolean; note?: string } | null;
            res.ok = !!r?.ok;
            if (r?.note) res.note = shorten(String(r.note), 400);
          }
          await sleep(STEP_SETTLE_MS);
          const dialogs = (await wc.executeJavaScript(`(() => { const d = window.__hcDialogs || []; window.__hcDialogs = []; return d; })()`, true).catch(() => [])) as unknown;
          if (Array.isArray(dialogs) && dialogs.length) res.dialogs = dialogs.slice(0, 5).map((d) => shorten(String(d), 160));
        } catch (e) {
          if (w.isDestroyed()) {
            res.ok = false;
            res.note = o.signal?.aborted ? "đã dừng" : "quá thời gian cho phép";
            break;
          }
          res.ok = false;
          res.note = shorten(String((e as Error).message || e).replace(/^Error: /, ""), 200);
        }
        if (!res.ok) break; // bước sau phụ thuộc bước này: dừng, báo đúng chỗ hỏng
      }
      sink = rep.errors;
      if (w.isDestroyed()) {
        if (blocked.size) rep.failedRequests.push(`đã chặn yêu cầu ra ngoài máy: ${[...blocked].slice(0, 4).join(", ")}`);
        return rep;
      }
    }
    // lệnh đo do ỨNG DỤNG chạy (chỉ đọc DOM); mã của trang vẫn chạy bình thường trong cửa sổ cách ly
    const dom = (await wc.executeJavaScript(`(() => {
      const body = document.body;
      const text = ((body && body.innerText) || "").replace(/\\s+/g, " ").trim();
      const shown = body ? [...body.querySelectorAll("img,canvas,svg,video,iframe,input,button,select,textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).length : 0;
      let overlay = "";
      const o = document.querySelector("vite-error-overlay");
      if (o && o.shadowRoot) overlay = (o.shadowRoot.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 700);
      const buttons = body ? [...body.querySelectorAll("button,[role=button],input[type=submit],input[type=button]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.disabled; }).map((e) => (e.textContent || e.value || e.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 40)).filter(Boolean) : [];
      return { title: document.title || "", text: text.slice(0, 600), blank: text.length === 0 && shown === 0, overlay, buttons: [...new Set(buttons)].slice(0, 12) };
    })()`, true).catch(() => null)) as { title: string; text: string; blank: boolean; overlay: string; buttons: string[] } | null;
    if (dom) {
      rep.title = shorten(dom.title, 120);
      rep.text = dom.text;
      rep.blank = dom.blank;
      if (dom.overlay) rep.overlay = dom.overlay;
      if (Array.isArray(dom.buttons) && dom.buttons.length) rep.buttons = dom.buttons.map((b) => shorten(String(b), 40));
    }
    if (blocked.size) rep.failedRequests.push(`đã chặn yêu cầu ra ngoài máy: ${[...blocked].slice(0, 4).join(", ")}`);
    return rep;
  } finally {
    clearTimeout(hard);
    o.signal?.removeEventListener("abort", abort);
    if (!w.isDestroyed()) w.destroy();
  }
}
