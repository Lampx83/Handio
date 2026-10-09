import type { AgentController, ChangeFile, DiffLine, HistoryItem, RewindPoint, RunSuggestion, SessionEvent, UiState } from "@neu/agent-core";
import { clear, h } from "./dom";

/** Những gì CodeTools cần từ khung chat (App) — tránh phụ thuộc vòng. */
export interface CodeToolsHost {
  append(el: HTMLElement): void;
  repaint(history: HistoryItem[]): void;
  setInput(text: string): void;
  submit(text: string): void;
  refreshState(): void;
  renderDiff(diff: DiffLine[]): HTMLElement;
}

const STATUS: Record<ChangeFile["status"], { ic: string; title: string }> = {
  new: { ic: "＋", title: "Tệp mới" },
  modified: { ic: "✎", title: "Đã sửa" },
  deleted: { ic: "−", title: "Đã xoá" },
};

const stat = (f: ChangeFile): (HTMLElement | string)[] => (f.sensitive ? [h("span", { title: "Tệp nhạy cảm: không hiện nội dung" }, "🔒")] : f.binary || f.large ? [h("span", { class: "ch-mut" }, f.binary ? "nhị phân" : "lớn")] : [h("b", { class: "a" }, "+" + f.added), " ", h("b", { class: "d" }, "−" + f.removed)]);

/**
 * Công cụ riêng của tab Code, học theo Cursor / Claude Code / Codex / Antigravity:
 * bảng "Thay đổi" (xem diff, hoàn tác từng tệp), /rewind, thẻ tổng kết cuối lượt, chọn mô hình, nút chạy thử.
 */
export class CodeTools {
  readonly buttons: HTMLElement[];
  readonly panel = h("aside", { class: "ch-host", hidden: true, "aria-label": "Thay đổi" });
  private chBtn = h("button", { class: "iconbtn chbtn", type: "button", hidden: true, "aria-label": "Thay đổi", title: "Các tệp agent đã đổi (/diff)", onclick: () => (this.ctl.track?.("changes_open"), this.togglePanel()) });
  private rwBtn = h("button", { class: "iconbtn", type: "button", hidden: true, "aria-label": "Quay lại", title: "Quay lại một lượt trước (/rewind, Esc hai lần)", onclick: () => void this.openRewind() }, "↶");
  private runBtn = h("button", { class: "iconbtn", type: "button", hidden: true, "aria-label": "Chạy", title: "Chạy / kiểm thử dự án", onclick: () => void this.toggleRun() }, "▶");
  private modelBtn = h("button", { class: "iconbtn modelbtn", type: "button", hidden: true, "aria-label": "Mô hình", "aria-haspopup": "menu", title: "Đổi mô hình", onclick: () => void this.toggleModels() });
  private wrap = h("span", { class: "ct-wrap", style: { position: "relative", display: "inline-flex", gap: "6px" } });
  /** Nút chọn mô hình: đặt dưới ô nhập prompt (do app.ts gắn), menu mở lên phía trên. */
  readonly modelEl = h("span", { class: "ct-model", style: { position: "relative", display: "inline-flex" } });
  private pop: HTMLElement | null = null;
  private files: ChangeFile[] = [];
  private on = false;
  private exec = false;
  private timer = 0;
  private lastEsc = 0;
  private open = new Set<string>();
  private seq = 0;

  constructor(private ctl: AgentController, private host: CodeToolsHost) {
    this.wrap.append(this.chBtn, this.rwBtn, this.runBtn);
    this.modelEl.append(this.modelBtn);
    this.buttons = [this.wrap];
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (this.pop && !t.closest(".ct-pop") && !t.closest(".ct-wrap") && !t.closest(".ct-model")) this.closePop();
    });
  }

  /** Gọi mỗi khi trạng thái giao diện được nạp lại. */
  update(state: UiState): void {
    // chọn mô hình có ở mọi tab (nằm dưới ô nhập prompt); phần còn lại (thay đổi, quay lại, chạy) chỉ ở tab Code
    this.modelBtn.hidden = !state.model;
    this.modelBtn.textContent = state.model.length > 24 ? state.model.slice(0, 23) + "…" : state.model;
    this.modelBtn.title = "Mô hình: " + state.model + " (bấm để đổi)";
    this.on = state.profile === "code" && !!this.ctl.changesList;
    this.exec = !!state.capabilities.exec;
    this.wrap.hidden = !this.on;
    for (const b of [this.chBtn, this.rwBtn]) b.hidden = !this.on;
    if (!this.on) {
      this.panel.hidden = true;
      this.runBtn.hidden = true;
      return;
    }
    void this.refreshRun();
    this.schedule();
  }

  onEvent(e: SessionEvent): void {
    if (!this.on) return;
    if (e.type === "files_changed" || e.type === "turn_end" || e.type === "reset") this.schedule();
    if (e.type === "turn_end" || e.type === "reset") void this.refreshRun();
    if (e.type === "summary") this.card(e);
  }

  /** `/diff`, `/changes`, `/rewind` do giao diện tự xử lý. */
  handleSlash(text: string): boolean {
    if (!this.on) return false;
    if (/^\/(diff|changes)\s*$/.test(text)) return this.togglePanel(true), true;
    if (/^\/rewind\s*$/.test(text)) return void this.openRewind(), true;
    return false;
  }

  /** Nhấn Esc: lần thứ hai trong 0,7 giây thì mở "Quay lại". */
  escTap(): boolean {
    if (!this.on) return false;
    const now = Date.now();
    const twice = now - this.lastEsc < 700;
    this.lastEsc = twice ? 0 : now;
    if (twice) void this.openRewind();
    return twice;
  }

  // ------------------------------------------------------------------ bảng "Thay đổi"
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refreshChanges(), 150);
  }

  private async refreshChanges(): Promise<void> {
    if (!this.on || !this.ctl.changesList) return;
    try {
      this.files = await this.ctl.changesList();
    } catch {
      return;
    }
    clear(this.chBtn);
    this.chBtn.append("±");
    if (this.files.length) this.chBtn.append(h("span", { class: "ch-n" }, String(this.files.length)));
    this.chBtn.classList.toggle("has", this.files.length > 0);
    if (!this.panel.hidden) this.paintPanel();
  }

  togglePanel(force?: boolean): void {
    const show = force ?? this.panel.hidden;
    this.panel.hidden = !show;
    if (show) void this.refreshChanges().then(() => this.paintPanel());
  }

  private paintPanel(): void {
    clear(this.panel);
    const revertAll = h("button", { class: "btn sm danger", type: "button", disabled: !this.files.length, title: "Hoàn tác mọi thay đổi của agent trong cuộc trò chuyện này", onclick: () => void this.revert() }, "↩ Hết");
    this.panel.append(h("div", { class: "ch-h" }, h("b", {}, "Thay đổi"), h("span", { class: "ch-mut" }, String(this.files.length)), h("span", { class: "grow" }), revertAll, h("button", { class: "iconbtn", type: "button", "aria-label": "Đóng", onclick: () => this.togglePanel(false) }, "✕")));
    if (!this.files.length) return void this.panel.append(h("div", { class: "ch-empty" }, "Chưa có thay đổi"));
    const list = h("div", { class: "ch-list" });
    for (const f of this.files) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
      const body = h("div", { class: "ch-diff", hidden: !this.open.has(f.path) });
      const head = h("div", { class: "ch-row", role: "button", tabindex: "0", "aria-expanded": String(this.open.has(f.path)), title: f.path },
        h("span", { class: "ch-st " + f.status, title: STATUS[f.status].title }, STATUS[f.status].ic),
        h("span", { class: "ch-nm" }, h("span", { class: "ch-dir" }, dir), f.path.slice(dir.length)),
        h("span", { class: "ch-stat" }, ...stat(f)),
        h("button", { class: "iconbtn ch-rv", type: "button", disabled: !!f.sensitive, title: f.sensitive ? "Tệp nhạy cảm: hãy tự xử lý" : "Hoàn tác tệp này", "aria-label": "Hoàn tác " + f.path, onclick: (ev: Event) => { ev.stopPropagation(); void this.revert(f.path); } }, "↩"));
      const toggle = () => {
        const show = body.hidden;
        body.hidden = !show;
        head.setAttribute("aria-expanded", String(show));
        if (show) this.open.add(f.path);
        else this.open.delete(f.path);
        if (show) void this.loadDiff(f.path, body);
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), toggle()));
      list.append(h("div", { class: "ch-item" }, head, body));
      if (this.open.has(f.path)) void this.loadDiff(f.path, body);
    }
    this.panel.append(list);
  }

  private async loadDiff(path: string, into: HTMLElement): Promise<void> {
    const r = await this.ctl.changeDiff!(path);
    clear(into);
    if ("error" in r) return void into.append(h("div", { class: "ch-empty" }, r.error));
    if (r.sensitive) into.append(h("div", { class: "ch-empty" }, "🔒 Tệp nhạy cảm"));
    else if (r.binary) into.append(h("div", { class: "ch-empty" }, "Tệp nhị phân"));
    else if (r.large) into.append(h("div", { class: "ch-empty" }, "Tệp quá lớn để so sánh"));
    else into.append(this.host.renderDiff(r.diff));
  }

  private async revert(path?: string): Promise<void> {
    if (!path && !confirm("Hoàn tác mọi thay đổi của agent trong cuộc trò chuyện này?")) return;
    const r = await this.ctl.changesRevert!(path);
    if ("error" in r) this.host.append(h("div", { class: "notice warn" }, r.error));
    else if (r.skipped.length) this.host.append(h("div", { class: "notice warn" }, "Không hoàn tác được: " + r.skipped.join(", ")));
    await this.refreshChanges();
  }

  // ------------------------------------------------------------------ thẻ tổng kết cuối lượt
  private card(e: Extract<SessionEvent, { type: "summary" }>): void {
    const a = e.files.reduce((n, f) => n + f.added, 0);
    const d = e.files.reduce((n, f) => n + f.removed, 0);
    const v = { ok: ["ok", "✔ Đã chạy kiểm tra", ""], fail: ["fail", "✘ Kiểm tra lỗi", "Lần chạy kiểm tra sau lần sửa cuối bị lỗi"], none: ["none", "⚠ Chưa kiểm tra", "Agent chưa chạy test/chương trình sau lần sửa cuối"] }[e.verify];
    const names = e.files.slice(0, 4).map((f) => h("code", { title: f.path }, f.path.split("/").pop()));
    this.host.append(h("div", { class: "sumcard", role: "status" },
      h("div", { class: "sc-top" },
        h("b", {}, e.files.length + " tệp"), h("span", { class: "ch-stat" }, h("b", { class: "a" }, "+" + a), " ", h("b", { class: "d" }, "−" + d)),
        h("span", { class: "sc-v " + v[0], title: v[2] }, v[1]),
        h("span", { class: "grow" }),
        e.verify !== "ok" && this.exec ? h("button", { class: "btn sm", type: "button", title: "Nhờ agent chạy test/chương trình", onclick: () => this.host.submit("Hãy chạy kiểm tra (test hoặc chạy chương trình) để xác nhận các thay đổi vừa rồi, rồi báo kết quả thật.") }, "Kiểm tra") : null,
        h("button", { class: "btn sm", type: "button", onclick: () => this.togglePanel(true) }, "Xem")),
      h("div", { class: "sc-files" }, ...names, e.files.length > 4 ? h("span", { class: "ch-mut" }, "+" + (e.files.length - 4)) : null)));
  }

  // ------------------------------------------------------------------ /rewind
  async openRewind(): Promise<void> {
    if (!this.ctl.rewindPoints || !this.ctl.rewind) return;
    const pts: RewindPoint[] = await this.ctl.rewindPoints();
    const dlg = h("dialog", { class: "rewind" });
    let sel = -1;
    const withFiles = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
    const go = h("button", { class: "btn primary", type: "button", disabled: true }, "Quay lại") as HTMLButtonElement;
    const rows = pts.slice().reverse().map((p) => {
      const row = h("div", { class: "rw-row", role: "option", tabindex: "0", "aria-selected": "false" },
        h("span", { class: "rw-n" }, "#" + (p.index + 1)), h("span", { class: "rw-t" }, p.text || "(trống)"), p.files ? h("span", { class: "ch-mut", title: "Số tệp agent đã đụng tới từ đây" }, p.files + " tệp") : null);
      const pick = () => {
        sel = p.index;
        for (const r of rows) {
          r.setAttribute("aria-selected", String(r === row));
          r.classList.toggle("sel", r === row);
        }
        go.disabled = false;
        withFiles.disabled = !p.files;
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", (k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), pick()));
      return row;
    });
    go.addEventListener("click", async () => {
      if (sel < 0) return;
      go.disabled = true;
      const r = await this.ctl.rewind!(sel, withFiles.checked && !withFiles.disabled);
      dlg.close();
      if ("error" in r) return void this.host.append(h("div", { class: "notice warn" }, r.error));
      this.host.repaint(r.history);
      this.host.setInput(r.text);
      this.host.append(h("div", { class: "notice" }, "↶ Đã quay lại" + (r.reverted.length ? ` · khôi phục ${r.reverted.length} tệp` : "") + (r.skipped.length ? ` · bỏ qua ${r.skipped.join(", ")}` : "")));
      await this.refreshChanges();
    });
    dlg.append(
      h("div", { class: "dh" }, "Quay lại", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
      h("div", { class: "db" }, rows.length ? h("div", { class: "rw-list", role: "listbox" }, ...rows) : h("div", { class: "ch-empty" }, "Chưa có lượt nào")),
      h("div", { class: "df" }, h("label", { class: "chk", title: "Khôi phục cả các tệp agent đã đổi từ lượt đó" }, withFiles, "Cả tệp"), h("span", { class: "grow" }), go));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ------------------------------------------------------------------ chọn mô hình, nút chạy
  private closePop(): void {
    this.pop?.remove();
    this.pop = null;
  }

  private showPop(items: { label: string; title?: string; sel?: boolean; on: () => void }[], cls = "", anchor: HTMLElement = this.wrap): void {
    this.closePop();
    const pop = h("div", { class: "menu ct-pop " + cls, role: "menu" }, ...items.map((it) => h("div", { class: "it" + (it.sel ? " sel" : ""), role: "menuitem", tabindex: "0", title: it.title, onclick: () => { this.closePop(); it.on(); }, onkeydown: (k: KeyboardEvent) => k.key === "Enter" && (k.target as HTMLElement).click() }, h("span", { class: "k" }, it.label))));
    anchor.append(pop);
    this.pop = pop;
  }

  private async toggleModels(): Promise<void> {
    this.ctl.track?.("model_change");
    if (this.pop?.classList.contains("modelmenu2")) return this.closePop();
    const cur = (await this.ctl.getState()).model;
    let list: string[] = [];
    try {
      list = (await this.ctl.listModels?.()) ?? [];
    } catch {
      /* không lấy được */
    }
    if (!list.includes(cur)) list = [cur, ...list];
    this.showPop(list.map((m) => ({ label: (m === cur ? "✓ " : "") + m, sel: m === cur, on: () => void this.ctl.saveSettings({ model: m }).then(() => this.host.refreshState()) })), "modelmenu2 up", this.modelEl);
  }

  private suggestions: RunSuggestion[] = [];
  private async refreshRun(): Promise<void> {
    if (!this.on || !this.exec || !this.ctl.runSuggestions) return void (this.runBtn.hidden = true);
    const my = ++this.seq;
    let s: RunSuggestion[] = [];
    try {
      s = await this.ctl.runSuggestions();
    } catch {
      /* bỏ qua */
    }
    if (my !== this.seq) return;
    this.suggestions = s;
    this.runBtn.hidden = !s.length;
  }

  private async toggleRun(): Promise<void> {
    this.ctl.track?.("run_click");
    if (this.pop?.classList.contains("runmenu")) return this.closePop();
    this.showPop(this.suggestions.map((s) => ({
      label: (s.kind === "test" ? "✓ " : "▶ ") + s.command,
      title: s.background ? "Chạy nền" : s.kind === "test" ? "Chạy kiểm thử" : "Chạy",
      on: () => this.host.submit(s.kind === "test" ? `Chạy \`${s.command}\`. Nếu có test lỗi, tìm nguyên nhân và sửa mã (đừng sửa test cho khớp lỗi), rồi chạy lại.` : s.background ? `Chạy \`${s.command}\` ở chế độ nền, rồi cho tôi biết địa chỉ để mở hoặc lỗi nếu có.` : `Chạy \`${s.command}\` và cho tôi biết kết quả. Nếu lỗi, tìm nguyên nhân và sửa.`),
    })), "runmenu");
  }
}
