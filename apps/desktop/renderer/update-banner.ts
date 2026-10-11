import "./update-banner.css";
import type { UpdateState } from "../src/updater";

export interface UpdateBridge {
  status(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  dismiss(): Promise<UpdateState>;
  openFolder(): Promise<UpdateState>;
  onChange(cb: (s: UpdateState) => void): () => void;
}

export function formatSize(n?: number): string {
  if (!n) return "";
  return n >= 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // luôn textContent: ghi chú phát hành đến từ máy chủ, không được chèn HTML
  return e;
};

/** Dựng thanh thông báo từ trạng thái (hàm thuần theo DOM, dễ kiểm thử). Trả null khi không cần hiện. */
export function buildBanner(s: UpdateState, api: Pick<UpdateBridge, "download" | "dismiss" | "openFolder" | "check">, state: { showNotes: boolean; closed: boolean }, rerender: () => void): HTMLElement | null {
  const visible = s.phase === "available" || s.phase === "downloading" || s.phase === "ready" || (s.phase === "error" && !!s.latest);
  if (!visible || (state.closed && s.phase === "ready")) return null;
  const box = el("div", "neu-upd" + (s.required ? " nu-required" : ""));
  box.setAttribute("role", s.required ? "alertdialog" : "status");
  box.setAttribute("aria-live", "polite");
  const row = el("div", "nu-row");
  const btn = (label: string, fn: () => void, primary = false) => {
    const b = el("button", primary ? "nu-go" : "", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  if (s.phase === "available" || (s.phase === "error" && !s.savedPath)) {
    box.append(el("h3", "", s.required ? "Cần cập nhật Hando" : `Có bản mới Hando ${s.latest}`));
    box.append(el("p", "", s.required ? `Phiên bản ${s.current} không còn được hỗ trợ. Hãy cập nhật lên ${s.latest} để tiếp tục.` : `Bạn đang dùng ${s.current}${s.released ? ` · phát hành ${s.released}` : ""}.`));
    if (s.error) box.append(el("p", "nu-err", s.error));
    if (state.showNotes && s.notes) box.append(el("div", "nu-notes", s.notes));
    if (s.file) {
      const size = formatSize(s.file.size);
      row.append(btn(s.error ? "Thử lại" : size ? `Tải về (${size})` : "Tải về", () => void api.download(), true));
    } else row.append(el("span", "nu-err", "Chưa có tệp cài đặt cho máy này."));
    if (s.notes) row.append(btn(state.showNotes ? "Ẩn chi tiết" : "Có gì mới", () => { state.showNotes = !state.showNotes; rerender(); }));
    if (!s.required) row.append(btn("Để sau", () => void api.dismiss()));
  } else if (s.phase === "downloading") {
    box.append(el("h3", "", `Đang tải Hando ${s.latest}…`));
    const bar = el("div", "nu-bar");
    const fill = el("i");
    fill.style.width = `${Math.round((s.progress ?? 0) * 100)}%`;
    bar.append(fill);
    box.append(bar, el("p", "", "Sau khi tải xong, ứng dụng sẽ kiểm tra mã băm SHA-256 của tệp."));
  } else {
    box.append(el("h3", "", `Đã tải Hando ${s.latest}`));
    box.append(el("p", "", "Đã kiểm tra mã băm SHA-256 khớp với máy chủ. Hãy đóng Hando rồi mở tệp vừa tải để cài (chưa có gì bị thay đổi cho tới lúc bạn mở nó)."));
    row.append(btn("Mở thư mục chứa tệp", () => void api.openFolder(), true));
    if (!s.required) row.append(btn("Đóng", () => { state.closed = true; rerender(); }));
  }
  box.append(row);
  return box;
}

/** Gắn thanh thông báo cập nhật vào trang; trả hàm gỡ. */
export function mountUpdateBanner(api: UpdateBridge, host: HTMLElement = document.body): () => void {
  const ui = { showNotes: false, closed: false };
  let cur: UpdateState | null = null;
  let node: HTMLElement | null = null;
  const render = () => {
    node?.remove();
    node = cur ? buildBanner(cur, api, ui, render) : null;
    if (node) host.append(node);
  };
  const off = api.onChange((s) => {
    if (s.phase !== "ready") ui.closed = false;
    cur = s;
    render();
  });
  void api.status().then((s) => { cur = s; render(); }).catch(() => undefined);
  return () => {
    off();
    node?.remove();
  };
}
