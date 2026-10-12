// Chạy bằng Electron: mở một URL localhost trong cửa sổ ẨN, thực hiện các bước (nhập/bấm/chờ/kiểm biểu thức) và in kết quả JSON.
// Dùng: electron probe.cjs <tệp-cấu-hình.json>   → in một dòng "PROBE_RESULT:{...}"
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");

const cfg = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
const LOOPBACK = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const allowed = (u) => {
  if (LOOPBACK.test(u) || /^(data|blob|about|devtools):/.test(u)) return true;
  if (/^file:/i.test(u) && cfg.root) {
    try { const p = path.resolve(fileURLToPath(u)); const r = path.resolve(cfg.root); return p === r || p.startsWith(r + path.sep); } catch { return false; }
  }
  return false;
};

const FILL = (sel, value) => `(() => {
  const s = ${JSON.stringify(sel)};
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let el = null;
  if (s.placeholder) el = [...document.querySelectorAll("input,textarea")].find((e) => (e.placeholder || "") === s.placeholder && vis(e)) || [...document.querySelectorAll("input,textarea")].find((e) => (e.placeholder || "").toLowerCase().includes(s.placeholder.toLowerCase()) && vis(e));
  else if (s.label) { const l = [...document.querySelectorAll("label")].find((x) => x.textContent.trim().toLowerCase().includes(s.label.toLowerCase())); el = l && (l.control || l.querySelector("input,textarea")); }
  else if (s.selector) el = document.querySelector(s.selector);
  if (!el) return false;
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

const CLICK = (sel) => `(() => {
  const s = ${JSON.stringify(sel)};
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  let el = null;
  if (s.selector) el = document.querySelector(s.selector);
  else {
    const strip = (x) => (x || "").replace(/[\\p{Extended_Pictographic}\\uFE0F\\u200d]/gu, "").replace(/\\s+/g, " ").trim().toLowerCase();
    const t = strip(s.text);
    const labels = (e) => [e.textContent, e.value, e.getAttribute("aria-label"), e.getAttribute("title")].map(strip).filter(Boolean);
    const inter = [...document.querySelectorAll("button,a,[role=button],[role=tab],[role=link],input[type=button],input[type=submit],summary,label")].filter(vis);
    const generic = [...document.querySelectorAll("li,span,div,p,h1,h2,h3")].filter((e) => vis(e) && e.children.length <= 2);
    el = inter.find((e) => labels(e).includes(t)) || inter.find((e) => labels(e).some((l) => l.includes(t))) ||
         generic.find((e) => strip(e.textContent) === t) || generic.find((e) => strip(e.textContent).includes(t));
  }
  if (!el) return false;
  el.click();
  return true;
})()`;

app.whenReady().then(async () => {
  const out = { loaded: false, errors: [], failedRequests: [], blank: false, overlay: "", steps: [] };
  const part = "bench-" + Date.now();
  const ses = session.fromPartition(part);
  ses.webRequest.onBeforeRequest((d, cb) => cb(allowed(d.url) ? {} : { cancel: true }));
  ses.webRequest.onCompleted((d) => { if (d.statusCode >= 400 && out.failedRequests.length < 12) out.failedRequests.push(`${d.statusCode} ${new URL(d.url).pathname}`); });
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { partition: part, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
  const wc = w.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("console-message", (e, ...legacy) => {
    const level = (e && e.level) ?? legacy[0];
    const message = (e && e.message) ?? legacy[1] ?? "";
    if ((level === "error" || level === 3) && out.errors.length < 15) out.errors.push(String(message).replace(/\s+/g, " ").slice(0, 300));
  });
  wc.on("render-process-gone", (_e, d) => out.errors.push("render-process-gone: " + d.reason));
  const hard = setTimeout(() => { out.errors.push("quá hạn 60s"); finish(); }, 60000);
  const finish = () => {
    clearTimeout(hard);
    console.log("PROBE_RESULT:" + JSON.stringify(out));
    app.exit(0);
  };
  try {
    await wc.loadURL(cfg.url);
    out.loaded = true;
    await sleep(cfg.settleMs ?? 1500);
    for (const st of cfg.steps || []) {
      const rec = { label: st.label || (st.fill ? `nhập "${st.fill.placeholder || st.fill.label || st.fill.selector}"` : st.click ? `bấm "${st.click.text || st.click.selector}"` : st.wait ? `chờ ${st.wait}ms` : "kiểm tra"), ok: true };
      try {
        if (st.wait) await sleep(st.wait);
        else if (st.fill) rec.ok = !!(await wc.executeJavaScript(FILL(st.fill, st.value), true));
        else if (st.click) rec.ok = !!(await wc.executeJavaScript(CLICK(st.click), true));
        else if (st.dump) {
          rec.note = JSON.stringify(await wc.executeJavaScript(`(() => ({ path: location.pathname, buttons: [...document.querySelectorAll("button,a,[role=button],input")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.textContent || e.value || e.placeholder || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40)).slice(0, 25), text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 500) }))()`, true));
        }
        else if (st.eval) rec.ok = !!(await wc.executeJavaScript(`(async () => !!(${st.eval}))()`, true));
        if (!rec.ok && (st.fill || st.click)) rec.note = "không tìm thấy phần tử";
      } catch (e) {
        rec.ok = false;
        rec.note = String(e.message || e).slice(0, 200);
      }
      out.steps.push(rec);
      await sleep(150);
    }
    const dom = await wc.executeJavaScript(`(() => {
      const t = ((document.body && document.body.innerText) || "").trim();
      const o = document.querySelector("vite-error-overlay");
      return { title: document.title || "", text: t.replace(/\\s+/g, " ").slice(0, 400), textLen: t.length, overlay: o && o.shadowRoot ? o.shadowRoot.textContent.replace(/\\s+/g, " ").slice(0, 400) : "", shown: [...document.body.querySelectorAll("img,canvas,svg,input,button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).length };
    })()`, true);
    out.blank = dom.textLen === 0 && dom.shown === 0;
    out.overlay = dom.overlay;
    out.title = dom.title;
    out.text = dom.text;
  } catch (e) {
    out.errors.push("không tải được: " + String(e.message || e).slice(0, 200));
  }
  finish();
});
