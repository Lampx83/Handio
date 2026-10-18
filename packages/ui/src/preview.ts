import { DESIGN_MD_FILE, type AgentController, type UiState } from "@neu/agent-core";
import { DESIGN_FORMATS } from "@neu/agent-core/design-templates";
import { clear, h } from "./dom";
import { icon } from "./icons";
import { buildBatchEditPrompt, describeElement, MAX_NOTES, QUICK_EDITS, summarize, type ElementDesc, type ElLike, type PickNote } from "./point-edit";

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
  // "Chỉ vào để sửa": bấm một phần của bản xem trước rồi nói ngắn muốn sửa gì
  private picking = false;
  private sel: ElementDesc | null = null;
  private selEl: Element | null = null;
  /** Ghi chú đã thêm (nhiều phần tử), gửi một lần. `el` chỉ để vẽ số thứ tự trên bản xem trước. */
  private notes: (PickNote & { el: Element | null })[] = [];
  private pickBtn = h("button", { class: "btn sm", type: "button", "aria-pressed": "false", title: "Bấm vào một phần của thiết kế rồi nói ngắn gọn muốn sửa gì", onclick: () => this.togglePick() }, icon("target", 15), "Chỉ vào để sửa");
  private pickInput = h("input", { type: "text", maxlength: "400", placeholder: "Muốn sửa gì? (vd: to hơn, đổi sang màu xanh)", "aria-label": "Yêu cầu sửa phần đã chọn" }) as HTMLInputElement;
  private pickBar = h("div", { class: "pv-pick", hidden: true });
  private dmBtn = h("button", { class: "btn sm", type: "button", onclick: () => void this.designMd() }, "DESIGN.md");

  constructor(private ctl: AgentController, private getState: () => UiState, private download: (path: string) => void, private ask: (text: string) => void = () => undefined, private openFile: (path: string) => void = () => undefined) {
    for (const f of DESIGN_FORMATS) this.fmtSel.append(h("option", { value: f.id }, f.label));
    this.fileSel.addEventListener("change", () => void this.show(this.fileSel.value, true));
    this.fmtSel.addEventListener("change", () => this.paint());
    this.el = h("aside", { class: "pv", "aria-label": "Xem trước thiết kế", hidden: true },
      h("div", { class: "pv-head" }, this.fileSel, this.fmtSel,
        h("button", { class: "btn sm", type: "button", title: "Tải lại", "aria-label": "Tải lại bản xem trước", onclick: () => void this.show(this.path, false) }, icon("refresh", 15))),
      h("div", { class: "pv-tools" },
        h("button", { class: "btn sm", type: "button", onclick: () => this.path && this.download(this.path) }, icon("download", 15), "Tải tệp"),
        h("button", { class: "btn sm", type: "button", title: "Xuất PDF: chọn thư mục lưu (không chọn thì lưu cạnh tệp thiết kế). Cần bản Desktop", onclick: () => void this.exp("pdf") }, "PDF"),
        h("button", { class: "btn sm", type: "button", title: "Xuất ảnh PNG cạnh tệp thiết kế (cần bản Desktop)", onclick: () => void this.exp("png") }, "PNG"),
        this.pickBtn, this.dmBtn, this.note),
      this.stage, this.pickBar);
    this.paintPickBar();
    this.paintDmBtn(false);
    this.pickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.pickInput.value.trim()) this.sendAll(this.pickInput.value);
      else if (e.key === "Escape") this.togglePick(false);
    });
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
    void this.checkDesignMd();
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
    else if (paths.includes(DESIGN_MD_FILE)) await this.checkDesignMd();
  }

  // ------------------------------------------------------------------ DESIGN.md
  private paintDmBtn(exists: boolean): void {
    this.dmBtn.textContent = exists ? "DESIGN.md" : "+ DESIGN.md";
    this.dmBtn.title = exists ? "Xem, sửa hệ thống thiết kế của dự án (DESIGN.md)" : "Nhờ agent tạo DESIGN.md (màu, phông, khoảng cách) cho dự án";
  }

  private async hasDesignMd(): Promise<boolean> {
    const r = await this.ctl.readFile(DESIGN_MD_FILE).catch(() => ({ error: "" }));
    return !("error" in r);
  }

  private async checkDesignMd(): Promise<void> {
    this.paintDmBtn(await this.hasDesignMd());
  }

  /** Có DESIGN.md thì mở để xem/sửa; chưa có thì gửi lệnh /designmd (đúng luồng của lệnh gõ tay, không cần kênh mới). */
  private async designMd(): Promise<void> {
    if (await this.hasDesignMd()) return this.openFile(DESIGN_MD_FILE);
    this.ask("/designmd");
    this.note.textContent = "Đã nhờ agent tạo DESIGN.md.";
  }

  async show(path: string, auto: boolean): Promise<void> {
    if (!path) return;
    const my = ++this.seq;
    const r = await this.ctl.readFile(path);
    if (my !== this.seq) return;
    if (path !== this.path) this.notes = []; // ghi chú thuộc về một tệp: đổi tệp thì bỏ
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
    // KHÔNG có allow-scripts: thiết kế vẫn không chạy được mã nào. allow-same-origin chỉ để mã của ứng dụng đọc cấu trúc trang khi bật "Chỉ vào để sửa".
    const frame = h("iframe", { class: "pv-frame", title: "Bản xem trước: " + this.path, sandbox: "allow-same-origin", referrerpolicy: "no-referrer", scrolling: "no" });
    this.sel = null;
    this.selEl = null;
    this.paintPickBar();
    frame.addEventListener("load", () => this.arm(frame as HTMLIFrameElement));
    (frame as HTMLIFrameElement).srcdoc = this.src;
    const wrap = h("div", { class: "pv-wrap" }, frame);
    this.stage.append(wrap);
    this.layout();
  }

  // ------------------------------------------------------------------ Chỉ vào để sửa
  private togglePick(on = !this.picking): void {
    this.picking = on;
    this.pickBtn.setAttribute("aria-pressed", String(on));
    this.pickBtn.classList.toggle("on", on);
    this.pickBar.hidden = !on;
    if (on) this.ctl.track?.("point_edit");
    this.sel = null;
    this.selEl = null;
    this.paintPickBar();
    const frame = this.stage.querySelector<HTMLIFrameElement>(".pv-frame");
    if (on && frame) this.arm(frame); // đang hiển thị sẵn: gắn bộ chọn ngay (không nạp lại, bấm lần đầu không bị trượt)
    else this.paint(); // tắt: nạp lại để bỏ bộ chọn và lớp phủ (ghi chú đã thêm vẫn giữ)
  }

  private paintPickBar(): void {
    clear(this.pickBar);
    const n = this.notes.length;
    this.pickBtn.replaceChildren(icon("target", 15), "Chỉ vào để sửa" + (n ? ` (${n})` : ""));
    if (n) {
      this.pickBar.append(h("ol", { class: "pk-notes", "aria-label": "Ghi chú đã thêm" }, ...this.notes.map((x, i) =>
        h("li", {}, h("b", { class: "pk-n", "aria-hidden": "true" }, String(i + 1)), h("span", { class: "pk-what" }, summarize(x.d)), h("span", { class: "pk-note" }, x.note),
          h("button", { class: "btn sm", type: "button", title: "Bỏ ghi chú này", "aria-label": `Bỏ ghi chú ${i + 1}`, onclick: () => this.removeNote(i) }, "✕")))));
    }
    const sendBtn = (label: string): HTMLElement => h("button", { class: "btn primary sm", type: "button", onclick: () => this.sendAll(this.pickInput.value) }, label);
    if (!this.sel) {
      this.pickBar.append(h("div", { class: "pk-sel" },
        h("span", { class: "pk-hint" }, n ? "Bấm phần tiếp theo để ghi chú, hoặc gửi." : "Bấm vào phần bạn muốn sửa trên bản xem trước."),
        n ? sendBtn(`Gửi ${n} ghi chú`) : null,
        h("button", { class: "btn sm", type: "button", onclick: () => this.togglePick(false) }, "Xong")));
      return;
    }
    const d = this.sel;
    // đã có ghi chú: sửa nhanh cũng thành ghi chú (gửi cả lô một lần); chưa có thì gửi ngay như trước
    const quick = (text: string): void => (n ? this.addNote(text) : this.sendAll(text));
    this.pickBar.append(
      h("div", { class: "pk-sel" }, h("b", {}, "Đã chọn: "), summarize(d), h("button", { class: "btn sm", type: "button", title: "Chọn phần khác", onclick: () => this.select(null) }, "Chọn lại")),
      h("div", { class: "pk-chips" }, ...QUICK_EDITS.map((q) => h("button", { class: "chip", type: "button", onclick: () => quick(q.text) }, q.label))),
      h("div", { class: "pk-row" }, this.pickInput,
        h("button", { class: "btn sm", type: "button", title: "Ghi chú phần này rồi chọn tiếp phần khác; cuối cùng gửi tất cả một lần", onclick: () => this.addNote(this.pickInput.value) }, "+ Ghi chú"),
        sendBtn(n ? `Gửi ${n + 1}` : "Gửi")));
    this.pickInput.focus({ preventScroll: true });
  }

  private select(d: ElementDesc | null, el: Element | null = null): void {
    this.sel = d;
    this.selEl = d ? el : null;
    if (!d) this.clearMarks();
    this.paintPickBar();
  }

  /** Thêm phần đang chọn + ghi chú vào danh sách, để chọn tiếp phần khác. */
  private addNote(text: string): void {
    if (!this.sel || !text.trim()) return void this.pickInput.focus();
    if (this.notes.length >= MAX_NOTES) return void (this.note.textContent = `Tối đa ${MAX_NOTES} ghi chú mỗi lần: hãy gửi trước.`);
    this.notes.push({ d: this.sel, note: text.trim().slice(0, 400), el: this.selEl });
    this.pickInput.value = "";
    this.sel = null;
    this.selEl = null;
    this.clearMarks();
    this.paintNoteMarks();
    this.paintPickBar();
  }

  private removeNote(i: number): void {
    this.notes.splice(i, 1);
    this.paintNoteMarks();
    this.paintPickBar();
  }

  /** Gửi một yêu cầu gộp: các ghi chú đã thêm + phần đang chọn (nếu đã gõ yêu cầu). */
  private sendAll(instruction: string): void {
    const all: PickNote[] = this.notes.map(({ d, note }) => ({ d, note }));
    if (this.sel && instruction.trim()) all.push({ d: this.sel, note: instruction });
    if (!all.length) return;
    this.ask(buildBatchEditPrompt(this.path, all));
    this.pickInput.value = "";
    this.note.textContent = (all.length > 1 ? `Đã gửi ${all.length} ghi chú cho agent` : "Đã gửi cho agent") + ": bản xem trước sẽ tự cập nhật khi sửa xong.";
    this.notes = [];
    this.sel = null;
    this.selEl = null;
    this.clearMarks();
    this.paintNoteMarks();
    this.paintPickBar();
  }

  private frameDoc(): Document | null {
    try {
      return this.stage.querySelector<HTMLIFrameElement>(".pv-frame")?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  /** Lớp phủ đặt dưới <html> (ngoài <body>): không lẫn vào mảnh HTML hay chữ của phần tử được chọn. */
  private overlay(doc: Document, key: string, css: string): HTMLElement {
    let ov = doc.querySelector<HTMLElement>(`[data-neu-pe="${key}"]`);
    if (!ov) {
      ov = doc.createElement("div");
      ov.setAttribute("data-neu-pe", key);
      ov.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;border-radius:3px;" + css;
      doc.documentElement.append(ov);
    }
    return ov;
  }

  private place(doc: Document, ov: HTMLElement, el: Element): void {
    const r = el.getBoundingClientRect();
    const w = doc.defaultView;
    ov.style.display = "block";
    ov.style.left = r.left + (w?.scrollX ?? 0) + "px";
    ov.style.top = r.top + (w?.scrollY ?? 0) + "px";
    ov.style.width = r.width + "px";
    ov.style.height = r.height + "px";
  }

  private mark(doc: Document, cls: "hover" | "sel", el: Element | null): void {
    if (!el) {
      const ov = doc.querySelector<HTMLElement>(`[data-neu-pe="${cls}"]`);
      return void (ov && (ov.style.display = "none"));
    }
    this.place(doc, this.overlay(doc, cls, cls === "sel" ? "outline:2px solid #2b6cb0;background:rgba(43,108,176,.16);" : "outline:2px dashed #2b6cb0;background:rgba(43,108,176,.08);"), el);
  }

  private clearMarks(): void {
    const doc = this.frameDoc();
    if (doc?.body) for (const c of ["hover", "sel"] as const) this.mark(doc, c, null);
  }

  /** Vẽ số thứ tự của các ghi chú lên bản xem trước. Khung đã nạp lại thì tìm lại phần tử theo đường đi CSS, chỉ khi khớp đúng một phần tử. */
  private paintNoteMarks(): void {
    const doc = this.frameDoc();
    if (!doc?.documentElement) return;
    for (const old of Array.from(doc.querySelectorAll('[data-neu-pe^="note"]'))) old.remove();
    if (!this.picking) return;
    this.notes.forEach((x, i) => {
      let el = x.el && x.el.ownerDocument === doc && x.el.isConnected ? x.el : null;
      if (!el) {
        try {
          const found = doc.querySelectorAll(x.d.path);
          el = found.length === 1 ? found[0] : null;
        } catch {
          el = null;
        }
        x.el = el;
      }
      if (!el) return;
      const ov = this.overlay(doc, "note" + i, "outline:2px solid #c05621;background:rgba(192,86,33,.10);");
      const badge = doc.createElement("span");
      badge.textContent = String(i + 1);
      badge.style.cssText = "position:absolute;left:-2px;top:-2px;transform:translate(-50%,-50%);min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#c05621;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;box-sizing:border-box;";
      ov.append(badge);
      this.place(doc, ov, el);
    });
  }

  /** Gắn bộ chọn vào khung xem trước (chỉ khi đang bật). Mã chạy ở phía ứng dụng; trong khung không chạy script nào. */
  private arm(frame: HTMLIFrameElement): void {
    if (!this.picking) return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc?.body) return;
    doc.documentElement.style.cursor = "crosshair";
    const target = (e: Event): Element | null => {
      const t = e.target as Element | null;
      return t && t.nodeType === 1 && t !== doc!.documentElement ? t : null;
    };
    doc.addEventListener("mouseover", (e) => {
      const t = target(e);
      if (t) this.mark(doc!, "hover", t);
    });
    doc.addEventListener("mouseleave", () => this.mark(doc!, "hover", null));
    doc.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = target(e);
      if (!t) return;
      this.mark(doc!, "hover", null);
      this.mark(doc!, "sel", t);
      this.select(describeElement(t as unknown as ElLike), t);
    }, true);
    this.paintNoteMarks();
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
