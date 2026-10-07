import { clear, h } from "./dom";

interface Item {
  os: "mac-arm64" | "mac-x64" | "win";
  label: string;
  hint: string;
  re: RegExp;
}

const ITEMS: Item[] = [
  { os: "mac-arm64", label: "macOS · chip Apple (M1/M2/M3/M4)", hint: "Menu Apple → Giới thiệu về máy Mac: nếu ghi “Chip: Apple…” thì chọn bản này", re: /-mac-arm64\.dmg$/ },
  { os: "mac-x64", label: "macOS · chip Intel", hint: "Máy Mac đời cũ (ghi “Bộ xử lý: Intel…”)", re: /-mac-x64\.dmg$/ },
  { os: "win", label: "Windows 10/11 (64-bit)", hint: "Trình cài đặt, không cần quyền quản trị", re: /-win-x64\.exe$/ },
];

interface Platform {
  os: "mac" | "win" | "linux" | "mobile" | "other";
  /** arm = chip Apple/ARM, x64 = Intel/AMD, "" = chưa xác định được. */
  arch: "arm" | "x64" | "";
}

/** Nhận diện máy người dùng. Chip Apple/Intel: Chrome/Edge cho biết qua userAgentData; Safari/Firefox thì đoán theo card đồ hoạ, không chắc thì để trống. */
async function detectPlatform(): Promise<Platform> {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string; bitness?: string; platform?: string }> } };
  if (/iPhone|iPad|iPod|Android/i.test(ua) || nav.userAgentData?.mobile || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return { os: "mobile", arch: "" };
  const os: Platform["os"] = /Windows/i.test(ua) ? "win" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : /Linux|X11|CrOS/i.test(ua) ? "linux" : "other";
  let arch: Platform["arch"] = "";
  try {
    const v = await nav.userAgentData?.getHighEntropyValues?.(["architecture", "bitness"]);
    if (v?.architecture) arch = /arm/i.test(v.architecture) ? "arm" : /x86/i.test(v.architecture) ? "x64" : "";
  } catch {
    /* thử cách khác */
  }
  if (!arch && os === "mac") {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      const r = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      if (/Apple M\d/i.test(r)) arch = "arm";
      else if (/Intel|AMD|Radeon|NVIDIA/i.test(r)) arch = "x64";
    } catch {
      /* không xác định */
    }
  }
  return { os, arch };
}

/** Bản cài có phải bản phù hợp nhất với máy này không (mac + chưa rõ chip: cả hai bản Mac đều được đánh dấu “có thể”). */
function fit(os: Item["os"], me: Platform): "yes" | "maybe" | "no" {
  if (me.os === "win") return os === "win" ? "yes" : "no";
  if (me.os === "mac") {
    if (!os.startsWith("mac")) return "no";
    if (!me.arch) return "maybe";
    return (me.arch === "arm") === (os === "mac-arm64") ? "yes" : "no";
  }
  return "no";
}

const mb = (n: number): string => (n >= 1e8 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)) + " MB";

function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && !/[\\/]/.test(m[2])) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

const ICON: Record<Item["os"], string> = { "mac-arm64": "", "mac-x64": "", win: "" };
const SHORT: Record<Item["os"], string> = { "mac-arm64": "macOS · chip Apple", "mac-x64": "macOS · chip Intel", win: "Windows 10/11" };

/** Hộp “Tải ứng dụng Desktop”: một nút lớn cho đúng máy của bạn; bản khác và phần kiểm tra mã băm được thu gọn. */
export async function openDownload(base: string, install?: { available(): boolean; run(): void }): Promise<void> {
  const dlg = h("dialog", { class: "dl" });
  const body = h("div", { class: "dl-body" }, h("p", { class: "muted" }, "Đang tải…"));
  dlg.append(h("div", { class: "dh" }, h("span", {}, "Tải NEU Agent cho máy tính"), h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")), body);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  let sums = new Map<string, string>();
  try {
    const r = await fetch(new URL("SHA256SUMS.txt", base).href, { cache: "no-store" });
    if (r.ok && !/html/i.test(r.headers.get("content-type") ?? "")) sums = parseSums(await r.text());
  } catch {
    /* hiện thông báo bên dưới */
  }
  let signed: { mac?: boolean; win?: boolean } = {};
  let signer: { mac?: string; win?: string } = {};
  try {
    const r = await fetch(new URL("latest.json", base).href, { cache: "no-store" });
    if (r.ok && !/html/i.test(r.headers.get("content-type") ?? "")) {
      const j = (await r.json()) as { signed?: { mac?: boolean; win?: boolean }; signer?: { mac?: string; win?: string } };
      signed = j.signed ?? {};
      signer = j.signer ?? {};
    }
  } catch {
    /* không có latest.json: coi như chưa ký */
  }
  clear(body);
  if (!sums.size) return void body.append(h("p", { class: "dl-warn" }, "Máy chủ này chưa có bản cài đặt để tải. Hãy liên hệ người quản trị."));

  const me = await detectPlatform();
  const files = ITEMS.map((it) => ({ it, name: [...sums.keys()].find((n) => it.re.test(n)) })).filter((x): x is { it: Item; name: string } => !!x.name);
  const url = (n: string) => new URL(n, base).href;
  const sizeOf = (n: string, into: HTMLElement) => void fetch(url(n), { method: "HEAD" }).then((r) => { const len = Number(r.headers.get("content-length")); if (r.ok && len > 0) into.textContent = mb(len); }).catch(() => undefined);
  const dlBtn = (f: { it: Item; name: string }, label: string, big = false) => h("a", { class: "btn primary" + (big ? " lg" : ""), href: url(f.name), download: f.name, rel: "noopener" }, label);

  const yes = files.filter((f) => fit(f.it.os, me) === "yes");
  const maybe = files.filter((f) => fit(f.it.os, me) === "maybe");
  const others = files.filter((f) => !yes.includes(f) && !maybe.includes(f));
  const isSigned = (os: Item["os"]) => (os === "win" ? !!signed.win : !!signed.mac);
  const trust = (os: Item["os"]): HTMLElement | null => (isSigned(os) ? h("p", { class: "dl-ok" }, "✔ Đã ký số", (os === "win" ? signer.win : signer.mac) ? " bởi " + String(os === "win" ? signer.win : signer.mac).replace(/^Developer ID Application:\s*/, "").replace(/\s*\(\w+\)$/, "") : "") : null);
  const hero = h("div", { class: "dl-hero" });
  if (me.os === "mobile") hero.append(h("div", { class: "dl-big", "aria-hidden": "true" }, "💻"), h("h3", {}, "Ứng dụng dành cho máy tính"), h("p", { class: "muted" }, "Hãy mở trang này trên máy tính macOS hoặc Windows. Trên điện thoại, bạn dùng ngay bản web."));
  else if (me.os === "linux") hero.append(h("div", { class: "dl-big", "aria-hidden": "true" }, "🐧"), h("h3", {}, "Chưa có bản cho Linux"), h("p", { class: "muted" }, "Bạn vẫn dùng được bản web ngay trên trang này, hoặc tải bản Windows/macOS về máy khác."));
  else if (yes.length) {
    const f = yes[0];
    const size = h("span", {});
    sizeOf(f.name, size);
    hero.append(h("div", { class: "dl-big", "aria-hidden": "true" }, f.it.os === "win" ? "🪟" : "🍎"), h("h3", {}, "Tải cho " + SHORT[f.it.os]), h("p", { class: "muted" }, "Phù hợp với máy của bạn · ", size), dlBtn(f, "⬇ Tải xuống", true), ...(trust(f.it.os) ? [trust(f.it.os)!] : []));
  } else if (maybe.length) {
    hero.append(h("div", { class: "dl-big", "aria-hidden": "true" }, "🍎"), h("h3", {}, "Tải cho máy Mac"), h("p", { class: "muted" }, "Chọn đúng chip của máy (menu  → Giới thiệu về máy Mac)."),
      h("div", { class: "dl-duo" }, ...maybe.map((f) => h("div", {}, dlBtn(f, "⬇ " + (f.it.os === "mac-arm64" ? "Chip Apple (M1–M4)" : "Chip Intel"), true)))));
  } else hero.append(h("h3", {}, "Chọn bản đúng với máy của bạn"));
  body.append(hero);
  // cài ngay từ trình duyệt (PWA): không có tệp nào được tải về nên không có cảnh báo hệ điều hành
  if (install?.available()) body.append(h("div", { class: "dl-pwa" }, h("button", { class: "btn", type: "button", onclick: () => { install.run(); dlg.close(); } }, "Cài từ trình duyệt (không cảnh báo)")));

  const rest = me.os === "mobile" || me.os === "linux" || !(yes.length || maybe.length) ? files : others;
  if (rest.length)
    body.append(h("details", { class: "dl-more" }, h("summary", {}, "Bản cho máy khác"),
      ...rest.map((f) => { const size = h("span", { class: "muted" }); sizeOf(f.name, size); return h("div", { class: "dl-row2" }, h("span", {}, SHORT[f.it.os], " ", size), dlBtn(f, "Tải")); })));

  const verify = me.os === "win" ? "Get-FileHash .\\NEU-Agent-*-win-x64.exe -Algorithm SHA256" : "shasum -a 256 NEU-Agent-*.dmg";
  body.append(
    h("details", { class: "dl-more" }, h("summary", {}, "Kiểm tra tệp (khuyến nghị)"),
      h("p", { class: "muted" }, "So mã SHA-256 của tệp đã tải với mã dưới đây (tốt nhất so với mã do giảng viên gửi qua kênh khác):"),
      h("pre", {}, h("code", {}, verify)),
      ...files.map((f) => h("div", { class: "dl-hash" }, h("span", {}, SHORT[f.it.os]), h("code", {}, sums.get(f.name)!), h("button", { class: "btn sm", type: "button", onclick: (e: Event) => { void navigator.clipboard?.writeText(sums.get(f.name)!).then(() => { (e.target as HTMLElement).textContent = "Đã chép"; }).catch(() => undefined); } }, "Chép")))),
    h("p", { class: "dl-foot muted" }, (files.every((f) => isSigned(f.it.os)) ? "" : "Bản chưa ký số: lần đầu mở, hệ điều hành sẽ cảnh báo. "), h("a", { href: url("HUONG-DAN-CAI-DAT.md"), target: "_blank", rel: "noopener" }, "Cách mở an toàn"), " · ", h("a", { href: url("BAO-MAT.md"), target: "_blank", rel: "noopener" }, "Bảo mật")));
}

