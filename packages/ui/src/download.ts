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

/** Hộp “Tải ứng dụng Desktop”: các bản cài do máy chủ phục vụ ở `base` (kèm SHA256SUMS.txt để kiểm tra). */
export async function openDownload(base: string): Promise<void> {
  const dlg = h("dialog", { class: "dl" });
  const body = h("div", { class: "dl-body" }, h("p", { class: "muted" }, "Đang tải danh sách…"));
  const close = () => dlg.close();
  dlg.append(h("div", { class: "dh" }, h("span", {}, "⬇ Tải ứng dụng NEU Agent (Desktop)"), h("button", { class: "btn sm", type: "button", onclick: close }, "Đóng")), body);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  let sums = new Map<string, string>();
  try {
    const r = await fetch(new URL("SHA256SUMS.txt", base).href, { cache: "no-store" });
    const ct = r.headers.get("content-type") ?? "";
    if (r.ok && !/html/i.test(ct)) sums = parseSums(await r.text());
  } catch {
    /* hiện thông báo bên dưới */
  }

  clear(body);
  body.append(h("p", {}, "Bản Desktop làm việc trên thư mục thật của bạn (tab Code chạy lệnh thật, tab Work đọc/ghi tệp Word, Excel, PowerPoint, PDF) và luôn hỏi trước khi sửa tệp hay chạy lệnh."));
  if (!sums.size) {
    body.append(h("p", { class: "dl-warn" }, "Máy chủ này chưa có bản cài đặt để tải. Hãy liên hệ người quản trị."));
    return;
  }

  const me = await detectPlatform();
  const files = ITEMS.map((it) => ({ it, name: [...sums.keys()].find((n) => it.re.test(n)) })).filter((x): x is { it: Item; name: string } => !!x.name);
  const rank = { yes: 0, maybe: 1, no: 2 } as const;
  files.sort((a, b) => rank[fit(a.it.os, me)] - rank[fit(b.it.os, me)]);
  const best = files.filter((f) => fit(f.it.os, me) === "yes");
  body.append(advice(me, best.map((f) => f.it.label)));

  const list = h("div", { class: "dl-list" });
  for (const { it, name } of files) {
    const url = new URL(name, base).href;
    const hash = sums.get(name)!;
    const size = h("span", { class: "muted" }, "");
    void fetch(url, { method: "HEAD" }).then((r) => {
      const n = Number(r.headers.get("content-length"));
      if (r.ok && n > 0) size.textContent = " · " + mb(n);
    }).catch(() => undefined);
    list.append(
      h("div", { class: "dl-card" + (fit(it.os, me) === "yes" ? " rec" : fit(it.os, me) === "maybe" ? " maybe" : "") },
        h("div", { class: "dl-row" },
          h("div", {},
            h("strong", {}, it.label), fit(it.os, me) === "yes" ? h("span", { class: "lp ok" }, "Phù hợp với máy bạn") : fit(it.os, me) === "maybe" ? h("span", { class: "lp" }, "Có thể phù hợp") : null,
            h("div", { class: "muted" }, it.hint)),
          h("a", { class: "btn primary", href: url, download: name, rel: "noopener" }, "Tải xuống")),
        h("div", { class: "dl-meta muted" }, name, size),
        h("div", { class: "dl-hash" }, h("span", {}, "SHA-256: "), h("code", {}, hash), h("button", { class: "btn sm", type: "button", onclick: (e: Event) => { void navigator.clipboard?.writeText(hash).then(() => { (e.target as HTMLElement).textContent = "Đã chép"; }).catch(() => undefined); } }, "Chép"))));
  }
  body.append(list);

  const verify = me.os === "win" ? `Get-FileHash .\\${files.find((f) => f.it.os === "win")?.name ?? "NEU-Agent-….exe"} -Algorithm SHA256` : "shasum -a 256 NEU-Agent-*.dmg";
  body.append(
    h("h4", {}, "Trước khi mở"),
    h("ol", { class: "dl-steps" },
      h("li", {}, "Kiểm tra mã băm của tệp đã tải rồi so với dòng SHA-256 ở trên (tốt nhất so với mã do giảng viên gửi qua kênh khác):"),
      h("pre", {}, h("code", {}, verify)),
      h("li", {}, "Bản này ", h("strong", {}, "chưa được Apple/Microsoft ký số"), ", nên lần đầu mở hệ điều hành sẽ cảnh báo “nhà phát hành không xác định”. Chỉ bỏ qua cảnh báo khi mã băm khớp. Cách mở: xem hướng dẫn bên dưới."),
      h("li", {}, "Mở ứng dụng, vào ⚙ Cài đặt nếu được yêu cầu nhập key do người quản trị cấp.")),
    h("p", {}, h("a", { href: new URL("HUONG-DAN-CAI-DAT.md", base).href, target: "_blank", rel: "noopener" }, "Hướng dẫn cài đặt chi tiết"), " · ", h("a", { href: new URL("BAO-MAT.md", base).href, target: "_blank", rel: "noopener" }, "Giải thích về bảo mật"), " · ", h("a", { href: new URL("SHA256SUMS.txt", base).href, target: "_blank", rel: "noopener" }, "SHA256SUMS.txt")));
}

/** Lời khuyên đầu hộp, theo máy đang dùng. */
function advice(me: Platform, bestLabels: string[]): HTMLElement {
  if (me.os === "mobile") return h("p", { class: "dl-warn" }, "Bạn đang dùng điện thoại/máy tính bảng. Ứng dụng Desktop chỉ dành cho máy tính (macOS, Windows): hãy mở trang này trên máy tính, hoặc dùng ngay bản web ở trang này.");
  if (me.os === "linux") return h("p", { class: "dl-warn" }, "Chưa có bản cho Linux. Bạn vẫn dùng được bản web ngay trên trang này; hoặc tải bản Windows/macOS về máy khác.");
  if (me.os === "mac" && !me.arch) return h("p", { class: "dl-note" }, "Đã nhận ra máy Mac nhưng trình duyệt không cho biết chip. Xem menu Apple → Giới thiệu về máy Mac: ghi “Chip: Apple M…” thì tải bản chip Apple, ghi “Bộ xử lý: Intel” thì tải bản Intel.");
  if (bestLabels.length) return h("p", { class: "dl-note" }, "Máy của bạn: ", h("strong", {}, bestLabels[0]), ". Bản phù hợp được xếp trên cùng.");
  return h("p", { class: "dl-note" }, "Không nhận ra hệ điều hành. Hãy chọn bản đúng với máy của bạn bên dưới.");
}
