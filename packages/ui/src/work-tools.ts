import { CITATION_RE, type AgentController, type Procedure, type SessionEvent, type UiState } from "@neu/agent-core";
import { h } from "./dom";
import { icon } from "./icons";

/** Những gì WorkTools cần từ khung chat (App). */
export interface WorkToolsHost {
  append(el: HTMLElement): void;
  setInput(text: string): void;
  refreshState(): void;
  openDoc(path: string, loc: string): void;
}

const MARK = "⁣"; // ký tự vô hình bao quanh vị trí chip khi đi qua bộ dựng Markdown (bảng chứa "|" không làm vỡ trích dẫn)
const MARK_RE = new RegExp(`${MARK}c(\\d+)${MARK}`, "g");
const slug = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/**
 * Công cụ riêng của tab Work, học theo NotebookLM/ChatGPT Projects/Claude:
 * trích dẫn bấm xem được (chip số → khung xem tài liệu) và “Quy trình của tôi” (lưu việc vừa làm thành lệnh /tên).
 */
export class WorkTools {
  readonly buttons: HTMLElement[];
  private btn = h("button", { class: "iconbtn", type: "button", hidden: true, "aria-label": "Quy trình của tôi", "aria-haspopup": "menu", title: "Quy trình của tôi", onclick: () => void this.toggle() }, icon("zap"));
  private wrap = h("span", { class: "wt-wrap", style: { position: "relative", display: "inline-flex" } });
  private pop: HTMLElement | null = null;
  private on = false;
  private used = false;
  private lastReq = "";
  private bar: HTMLElement | null = null;
  private cites: { file: string; loc: string }[] = [];

  constructor(private ctl: AgentController, private host: WorkToolsHost) {
    this.wrap.append(this.btn);
    this.buttons = [this.wrap];
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (this.pop && !t.closest(".wt-pop") && !t.closest(".wt-wrap")) this.closePop();
    });
  }

  get active(): boolean {
    return this.on;
  }

  update(state: UiState): void {
    this.on = state.profile === "work";
    this.btn.hidden = !(this.on && !!this.ctl.procedureList);
    if (!this.on) this.closePop();
  }

  noteRequest(text: string): void {
    this.lastReq = text;
    this.bar?.remove();
    this.bar = null;
  }

  onEvent(e: SessionEvent): void {
    if (!this.on) return;
    if (e.type === "turn_start") this.used = false;
    else if (e.type === "tool_start" && e.depth === 0) this.used = true;
    else if (e.type === "reset") {
      this.bar?.remove();
      this.bar = null;
    } else if (e.type === "turn_end" && !e.interrupted && this.used && this.ctl.procedureSave && !this.lastReq.startsWith("/")) this.offer();
  }

  // ------------------------------------------------------------------ trích dẫn
  /** Thay các [[tệp|vị trí]] bằng ký hiệu an toàn trước khi dựng Markdown; `decorate` biến chúng thành chip sau khi dựng. */
  prepare(raw: string): string {
    this.cites = [];
    if (!this.on || !raw.includes("[[")) return raw;
    return raw.replace(CITATION_RE, (_m, file: string, loc: string) => {
      const f = file.trim();
      const l = loc.trim();
      let i = this.cites.findIndex((c) => c.file === f && c.loc === l);
      if (i < 0) i = this.cites.push({ file: f, loc: l }) - 1;
      return `${MARK}c${i}${MARK}`;
    });
  }

  /** Biến các ký hiệu do `prepare` để lại thành chip số (bấm để xem nguồn) và thêm một hàng nguồn gọn ở cuối. */
  decorate(root: HTMLElement): void {
    if (!this.on || !this.cites.length) return;
    const order: number[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes(MARK) && !(n.parentElement?.closest("code, pre"))) nodes.push(n as Text);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of node.data.matchAll(MARK_RE)) {
        frag.append(node.data.slice(last, m.index));
        const idx = +m[1];
        if (!order.includes(idx)) order.push(idx);
        frag.append(this.chip(idx, order.indexOf(idx) + 1));
        last = m.index! + m[0].length;
      }
      frag.append(node.data.slice(last));
      node.replaceWith(frag);
    }
    if (!order.length) return;
    root.append(h("div", { class: "cite-row" }, ...order.map((idx, i) => {
      const c = this.cites[idx];
      return h("button", { class: "cite-src", type: "button", title: c.file + " · " + c.loc, onclick: () => this.host.openDoc(c.file, c.loc) }, h("b", {}, String(i + 1)), c.file.split("/").pop() + " · " + c.loc);
    })));
  }

  private chip(idx: number, n: number): HTMLElement {
    const c = this.cites[idx];
    return h("button", { class: "cite", type: "button", title: c.file + " · " + c.loc, "aria-label": `Nguồn ${n}: ${c.file}, ${c.loc}`, onclick: () => this.host.openDoc(c.file, c.loc) }, String(n));
  }

  // ------------------------------------------------------------------ Quy trình của tôi
  private offer(): void {
    this.bar?.remove();
    this.bar = h("div", { class: "wt-offer" }, h("button", { class: "btn sm", type: "button", title: "Lưu việc vừa làm thành lệnh dùng lại", onclick: () => this.askName() }, icon("zap", 14), "Lưu quy trình"));
    this.host.append(this.bar);
  }

  private askName(): void {
    const dlg = h("dialog", { class: "wt-dlg" });
    const name = h("input", { type: "text", maxlength: "40", value: slug(this.lastReq.split(/\s+/).slice(0, 4).join(" ")), "aria-label": "Tên lệnh" }) as HTMLInputElement;
    const err = h("div", { class: "res bad", role: "alert" });
    const save = async () => {
      err.textContent = "";
      const r = await this.ctl.procedureSave!(name.value, this.lastReq.replace(/\s+/g, " ").slice(0, 80));
      if ("error" in r) err.textContent = r.error;
      else {
        dlg.close();
        this.bar?.remove();
        this.bar = null;
        this.host.append(h("div", { class: "notice" }, "⚡ /" + r.name));
        this.host.refreshState();
      }
    };
    dlg.append(h("div", { class: "dh" }, "⚡ Quy trình", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "✕")),
      h("div", { class: "db" }, h("label", {}, "/", name), err),
      h("div", { class: "df" }, h("button", { class: "btn primary", type: "button", onclick: () => void save() }, "Lưu")));
    name.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), void save()));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    name.select();
  }

  private closePop(): void {
    this.pop?.remove();
    this.pop = null;
  }

  private async toggle(): Promise<void> {
    if (this.pop) return this.closePop();
    let list: Procedure[] = [];
    try {
      list = (await this.ctl.procedureList?.()) ?? [];
    } catch {
      /* bỏ qua */
    }
    const pop = h("div", { class: "menu wt-pop", role: "menu" });
    pop.append(h("div", { class: "it", role: "menuitem", tabindex: "0", onclick: () => { this.closePop(); this.lastReq ? this.askName() : void 0; }, onkeydown: (k: KeyboardEvent) => k.key === "Enter" && (k.target as HTMLElement).click() }, h("span", { class: "k" }, "＋ Lưu việc vừa làm")));
    if (!this.lastReq) pop.firstElementChild?.setAttribute("aria-disabled", "true");
    for (const p of list)
      pop.append(h("div", { class: "it wt-it", role: "menuitem", tabindex: "0", title: p.description,
        onclick: () => { this.closePop(); this.host.setInput("/" + p.name + " "); },
        onkeydown: (k: KeyboardEvent) => k.key === "Enter" && (k.target as HTMLElement).click() },
      h("span", { class: "k" }, "/" + p.name),
      h("button", { class: "iconbtn wt-x", type: "button", title: "Xoá", "aria-label": "Xoá " + p.name, onclick: async (ev: Event) => { ev.stopPropagation(); if (confirm("Xoá /" + p.name + "?")) { await this.ctl.procedureRemove?.(p.name); this.closePop(); this.host.refreshState(); } } }, "×")));
    this.wrap.append(pop);
    this.pop = pop;
  }
}
