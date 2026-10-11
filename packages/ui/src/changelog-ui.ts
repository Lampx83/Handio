import { h } from "./dom";

export interface ChangelogView {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
}

/** Nhật ký thay đổi nhúng lúc dựng (mới nhất trước). Rỗng nếu bản dựng không nhúng. */
export function changelogEntries(): ChangelogView[] {
  try {
    return typeof __CHANGELOG__ !== "undefined" && Array.isArray(__CHANGELOG__) ? __CHANGELOG__ : [];
  } catch {
    return [];
  }
}

export function appVersion(): string {
  try {
    return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
  } catch {
    return "";
  }
}

export type Span = { text: string; kind: "text" | "b" | "code" };

/** Tách **đậm** và `mã` thành các đoạn (không bao giờ dùng innerHTML: nội dung chỉ là chữ). */
export function inlineSpans(t: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m.index > last) out.push({ text: t.slice(last, m.index), kind: "text" });
    out.push(m[1] !== undefined ? { text: m[1], kind: "b" } : { text: m[2], kind: "code" });
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push({ text: t.slice(last), kind: "text" });
  return out;
}

const spanEl = (s: Span): Node => (s.kind === "b" ? h("b", {}, s.text) : s.kind === "code" ? h("code", {}, s.text) : document.createTextNode(s.text));

/** Một phiên bản của nhật ký (dùng trong hộp Nhật ký thay đổi và mục "Có gì mới" của hướng dẫn). */
export function changelogEntryEl(e: ChangelogView, current: string): HTMLElement {
  return h("section", { class: "cl-ver" },
    h("h3", {}, "Phiên bản " + e.version, e.date ? h("small", {}, e.date) : null, e.version === current ? h("span", { class: "cl-cur" }, "đang dùng") : null),
    ...e.sections.map((s) => h("div", { class: "cl-sec" }, h("div", { class: "cl-st" }, s.title), h("ul", {}, ...s.items.map((i) => h("li", {}, ...inlineSpans(i).map(spanEl)))))));
}

/** Bản Desktop đăng ký hàm kiểm tra cập nhật; hộp Nhật ký thay đổi hiện nút "Kiểm tra cập nhật" khi có. */
let updateChecker: (() => Promise<string>) | null = null;
export function setUpdateChecker(fn: (() => Promise<string>) | null | undefined): void {
  updateChecker = fn ?? null;
}

/** Nút "Kiểm tra cập nhật" trong hộp: bấm để hỏi máy chủ, kết quả hiện ngay bên cạnh. */
function updateRow(): HTMLElement | null {
  const check = updateChecker;
  if (!check) return null;
  const out = h("span", { class: "muted", role: "status", "aria-live": "polite", style: { marginLeft: "10px" } });
  const btn = h("button", { class: "btn sm", type: "button", title: "Hỏi máy chủ xem có bản mới không" }, "Kiểm tra cập nhật") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    out.textContent = "Đang kiểm tra…";
    try {
      out.textContent = await check();
    } catch {
      out.textContent = "Không kiểm tra được lúc này.";
    }
    btn.disabled = false;
  });
  return h("div", { class: "cl-update", style: { margin: "6px 0 12px" } }, btn, out);
}

/** Hộp "Nhật ký thay đổi": mỗi phiên bản sửa gì, thêm gì (đọc từ CHANGELOG.md lúc dựng). */
export function openChangelog(): void {
  const dlg = h("dialog", { class: "chlog" });
  const cur = appVersion();
  const list = changelogEntries();
  dlg.append(
    h("div", { class: "dh" }, "Nhật ký thay đổi", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "cl-body" }, cur ? h("p", { class: "muted" }, "Bạn đang dùng phiên bản " + cur + ". Mỗi phiên bản sửa gì, thêm gì đều được ghi ở đây.") : null,
      updateRow(),
      ...(list.length ? list.map((e) => changelogEntryEl(e, cur)) : [h("p", { class: "muted" }, "Chưa có nhật ký thay đổi trong bản này.")])));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** Nút nhỏ "v0.3.0 · Nhật ký thay đổi" ở cuối thanh bên. */
export function versionLink(): HTMLElement | null {
  const v = appVersion();
  if (!v && !changelogEntries().length) return null;
  return h("button", { class: "ver-link", type: "button", title: "Xem mỗi phiên bản sửa gì, thêm gì", onclick: () => openChangelog() }, (v ? "v" + v + " · " : "") + "Nhật ký thay đổi");
}
