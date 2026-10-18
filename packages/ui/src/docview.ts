import type { AgentController, DocView, ViewBlock, ViewSection } from "@neu/agent-core";
import { clear, h } from "./dom";
import { icon, treeIcon } from "./icons";

const base = (p: string): string => p.split("/").pop() ?? p;

/**
 * Khung xem tài liệu (chỉ đọc) của tab Work: mở khi bấm chip trích dẫn hoặc tệp Word/Excel/PowerPoint/PDF trong cây tệp.
 * Chữ trích xuất luôn được đưa vào bằng textContent (không bao giờ là HTML); vị trí được trích dẫn được tô sáng và cuộn tới.
 */
export class DocPane {
  readonly el: HTMLElement;
  private title = h("b", { class: "dv-nm" });
  private icon = h("span", { class: "dv-ic" });
  private body = h("div", { class: "dv-body" });
  private path = "";
  private seq = 0;
  private sheetIdx = 0;
  private view: DocView | null = null;
  private loc: string | undefined;

  constructor(private ctl: AgentController, private actions: { download(path: string): void; external?(path: string): void }) {
    this.el = h("aside", { class: "dv", "aria-label": "Xem tài liệu", hidden: true },
      h("div", { class: "dv-head" }, this.icon, this.title,
        h("span", { class: "grow" }),
        h("button", { class: "iconbtn", type: "button", title: "Tải xuống", "aria-label": "Tải xuống", onclick: () => this.path && this.actions.download(this.path) }, icon("download")),
        actions.external ? h("button", { class: "iconbtn", type: "button", title: "Mở bằng ứng dụng", "aria-label": "Mở bằng ứng dụng", onclick: () => this.path && this.actions.external!(this.path) }, icon("external")) : null,
        h("button", { class: "iconbtn", type: "button", title: "Đóng", "aria-label": "Đóng", onclick: () => this.close() }, icon("x"))),
      this.body);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
    this.seq++;
  }

  /** Nạp lại khi tệp đang xem vừa bị đổi. */
  onFilesChanged(paths: string[]): void {
    if (this.isOpen && this.path && paths.some((p) => p === this.path)) void this.open(this.path, this.loc);
  }

  async open(path: string, loc?: string): Promise<void> {
    if (!this.ctl.docView) return;
    const my = ++this.seq;
    this.path = path;
    this.loc = loc;
    this.sheetIdx = 0;
    this.el.hidden = false;
    this.title.textContent = base(path);
    this.title.title = path + (loc ? " · " + loc : "");
    clear(this.icon);
    this.icon.append(...treeIcon(path, false, false).slice(1));
    clear(this.body);
    this.body.append(h("div", { class: "dv-msg" }, "…"));
    let r: DocView | { error: string };
    try {
      r = await this.ctl.docView(path, loc);
    } catch (e) {
      r = { error: (e as Error).message };
    }
    if (my !== this.seq) return;
    if ("error" in r) {
      this.view = null;
      clear(this.body);
      this.body.append(h("div", { class: "dv-msg" }, r.error));
      return;
    }
    this.view = r;
    if (r.kind === "Excel") this.sheetIdx = Math.max(0, r.sections.findIndex((s) => s.hit));
    this.paint();
  }

  private paint(): void {
    const v = this.view;
    if (!v) return;
    clear(this.body);
    if (this.loc && !v.found) this.body.append(h("div", { class: "dv-warn", role: "alert" }, "⚠ Không thấy vị trí “" + this.loc + "” trong tệp này"));
    if (v.note) this.body.append(h("div", { class: "dv-note" }, v.note));
    if (v.kind === "Excel" && v.sections.length > 1)
      this.body.append(h("div", { class: "dv-tabs", role: "tablist" }, ...v.sections.map((s, i) =>
        h("button", { class: "dv-tab" + (i === this.sheetIdx ? " on" : ""), type: "button", role: "tab", "aria-selected": String(i === this.sheetIdx), onclick: () => { this.sheetIdx = i; this.paint(); } }, s.label))));
    const secs = v.kind === "Excel" ? [v.sections[this.sheetIdx]].filter(Boolean) : v.sections;
    for (const s of secs) this.body.append(this.section(s, v.kind));
    requestAnimationFrame(() => this.body.querySelector(".hit, .hitc, tr.hit")?.scrollIntoView({ block: "center" }));
  }

  private section(s: ViewSection, kind: string): HTMLElement {
    const box = h("section", { class: "dv-sec" + (s.hit ? " hit" : "") });
    if (s.label && kind !== "Excel") box.append(h("h5", { class: "dv-sh" }, s.label));
    if (s.note) box.append(h("div", { class: "dv-note" }, s.note));
    for (const b of s.blocks) box.append(this.block(b));
    return box;
  }

  private block(b: ViewBlock): HTMLElement {
    const hit = "hit" in b && b.hit ? " hit" : "";
    switch (b.t) {
      case "h":
        return h("h4", { class: "dv-h" + hit, title: "đoạn " + b.n }, b.text);
      case "list":
        return h("ul", { class: "dv-ul" + hit, title: "đoạn " + b.n }, ...b.items.map((t) => h("li", {}, t)));
      case "table":
        return h("table", { class: "dv-t" + hit, title: "đoạn " + b.n }, ...b.rows.map((r, i) => h("tr", {}, ...r.map((c) => h(i === 0 ? "th" : "td", {}, c)))));
      case "grid":
        return h("div", { class: "dv-gw" }, h("table", { class: "dv-grid" },
          h("thead", {}, h("tr", {}, h("th", { class: "rn" }), ...b.cols.map((c) => h("th", {}, c)))),
          h("tbody", {}, ...b.rows.map((r) => h("tr", { class: r.r === b.hitRow ? "hit" : "" }, h("th", { class: "rn" }, String(r.r)), ...r.cells.map((c, i) => h("td", { class: r.r === b.hitRow && b.hitCol === i + 1 ? "hitc" : "" }, c)))))));
      default:
        return h("p", { class: "dv-p" + hit, title: "đoạn " + b.n }, b.text);
    }
  }
}
