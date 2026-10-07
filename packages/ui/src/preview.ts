import type { AgentController, UiState } from "@neu/agent-core";
import { DESIGN_FORMATS } from "@neu/agent-core/design-templates";
import { clear, h } from "./dom";

const DESIGN_FILE = /\.(html?|svg)$/i;

/** Đoán khổ thiết kế từ nội dung (để khung xem trước mở đúng cỡ). */
export function guessFormat(src: string): string {
  if (/<svg[\s>]/i.test(src.slice(0, 400)) && !/<html/i.test(src.slice(0, 400))) return "square";
  if (/class=["'][^"']*\bslide\b/.test(src) && /1280px/.test(src)) return "slide";
  if (/1050px/.test(src) && /600px/.test(src)) return "card";
  if (/1080px/.test(src) && /1920px/.test(src)) return "story";
  if (/1080px/.test(src)) return "square";
  if (/794px|size:\s*A4/i.test(src)) return "a4";
  return "web";
}

/** Khung xem trước thiết kế (.html/.svg) của tab Design: hiển thị trong iframe cách ly (không script, không mạng), chọn khổ, xuất PDF/PNG. */
export class DesignPreview {
  readonly el: HTMLElement;
  private fileSel = h("select", { "aria-label": "Chọn thiết kế" });
  private fmtSel = h("select", { "aria-label": "Khổ xem trước" });
  private stage = h("div", { class: "pv-stage" });
  private note = h("span", { class: "pv-note", role: "status" });
  private path = "";
  private src = "";
  private seq = 0;
  private ro: ResizeObserver | null = null;

  constructor(private ctl: AgentController, private getState: () => UiState, private download: (path: string) => void) {
    for (const f of DESIGN_FORMATS) this.fmtSel.append(h("option", { value: f.id }, f.label));
    this.fileSel.addEventListener("change", () => void this.show(this.fileSel.value, true));
    this.fmtSel.addEventListener("change", () => this.paint());
    this.el = h("aside", { class: "pv", "aria-label": "Xem trước thiết kế", hidden: true },
      h("div", { class: "pv-head" }, this.fileSel, this.fmtSel,
        h("button", { class: "btn sm", type: "button", title: "Tải lại", "aria-label": "Tải lại bản xem trước", onclick: () => void this.show(this.path, false) }, "↻")),
      h("div", { class: "pv-tools" },
        h("button", { class: "btn sm", type: "button", onclick: () => this.path && this.download(this.path) }, "⬇ Tải tệp"),
        h("button", { class: "btn sm", type: "button", title: "Xuất PDF cạnh tệp thiết kế (cần bản Desktop)", onclick: () => void this.exp("pdf") }, "PDF"),
        h("button", { class: "btn sm", type: "button", title: "Xuất ảnh PNG cạnh tệp thiết kế (cần bản Desktop)", onclick: () => void this.exp("png") }, "PNG"),
        this.note),
      this.stage);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.stage);
    }
    this.empty();
  }

  setVisible(v: boolean): void {
    this.el.hidden = !v;
    if (v) this.layout();
  }

  private empty(): void {
    clear(this.stage);
    this.stage.append(h("div", { class: "pv-empty" }, h("b", {}, "Chưa có thiết kế"), h("div", {}, "Nhờ agent tạo, hoặc gõ / để chọn mẫu.")));
  }

  /** Nạp lại danh sách thiết kế trong dự án; mở tệp mới nhất (hoặc `prefer`). */
  async refreshFiles(prefer?: string): Promise<void> {
    const found = [...(await this.ctl.searchFiles?.(".htm") ?? []), ...(await this.ctl.searchFiles?.(".svg") ?? [])].filter((p) => DESIGN_FILE.test(p) && !p.split("/").some((x) => x.startsWith(".")));
    const files = [...new Set(found)].sort();
    clear(this.fileSel);
    for (const f of files) this.fileSel.append(h("option", { value: f }, f));
    if (!files.length) {
      this.path = "";
      this.src = "";
      return this.empty();
    }
    const pick = prefer && files.includes(prefer) ? prefer : files.includes(this.path) ? this.path : files[0];
    await this.show(pick, true);
  }

  /** Có tệp vừa đổi: nếu là thiết kế thì mở nó. */
  async onFilesChanged(paths: string[]): Promise<void> {
    const d = [...paths].reverse().find((p) => DESIGN_FILE.test(p));
    if (d) await this.refreshFiles(d);
  }

  async show(path: string, auto: boolean): Promise<void> {
    if (!path) return;
    const my = ++this.seq;
    const r = await this.ctl.readFile(path);
    if (my !== this.seq) return;
    this.path = path;
    if (![...this.fileSel.options].some((o) => o.value === path)) this.fileSel.append(h("option", { value: path }, path));
    this.fileSel.value = path;
    if ("error" in r) {
      this.src = "";
      clear(this.stage);
      this.stage.append(h("div", { class: "pv-empty" }, r.error));
      return;
    }
    this.src = /\.svg$/i.test(path) ? `<!doctype html><meta charset="utf-8"><body style="margin:0">${r.text}</body>` : r.text;
    if (auto) this.fmtSel.value = guessFormat(r.text);
    this.paint();
  }

  private fmt() {
    return DESIGN_FORMATS.find((f) => f.id === this.fmtSel.value) ?? DESIGN_FORMATS[0];
  }

  private paint(): void {
    if (!this.src) return;
    clear(this.stage);
    const frame = h("iframe", { class: "pv-frame", title: "Bản xem trước: " + this.path, sandbox: "", referrerpolicy: "no-referrer", scrolling: "no" });
    (frame as HTMLIFrameElement).srcdoc = this.src;
    const wrap = h("div", { class: "pv-wrap" }, frame);
    this.stage.append(wrap);
    this.layout();
  }

  /** Thu phóng khung cho vừa chiều ngang của vùng xem trước. */
  private layout(): void {
    const wrap = this.stage.querySelector<HTMLElement>(".pv-wrap");
    const frame = wrap?.querySelector<HTMLElement>(".pv-frame");
    if (!wrap || !frame) return;
    const f = this.fmt();
    const avail = Math.max(120, this.stage.clientWidth - 24);
    const scale = Math.min(1, avail / f.width);
    const height = f.height ?? Math.max(400, Math.round((this.stage.clientHeight - 24) / scale));
    frame.style.width = f.width + "px";
    frame.style.height = height + "px";
    frame.style.transform = `scale(${scale})`;
    wrap.style.width = Math.round(f.width * scale) + "px";
    wrap.style.height = Math.round(height * scale) + "px";
  }

  private async exp(format: "pdf" | "png"): Promise<void> {
    if (!this.path) return void (this.note.textContent = "Chưa có thiết kế để xuất.");
    if (!this.getState().capabilities.renderDesign) return void (this.note.textContent = "Xuất PDF/PNG cần bản Desktop. Ở bản web hãy tải tệp HTML.");
    const f = this.fmt();
    this.note.textContent = "Đang xuất " + format.toUpperCase() + "…";
    const r = await this.ctl.exportDesign!(this.path, format, f.width, f.height);
    this.note.textContent = "error" in r ? r.error : "Đã lưu: " + r.saved;
  }
}
