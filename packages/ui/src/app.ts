import type { AgentController, DiffLine, DiffPreview, Mode, PermissionRequest, PublicSettings, SessionEvent, SlashCommandInfo, Todo, UiState } from "@neu/agent-core";
import { clear, h, store } from "./dom";
import { escapeHtml, renderMarkdown } from "./markdown";
import { openLearn } from "./learn";
import { PROMPT_TEMPLATE, promptTips } from "./prompt-tips";

const MODE_INFO: Record<Mode, { label: string; desc: string }> = {
  default: { label: "Hỏi trước", desc: "Đọc tự do. Sửa file và chạy lệnh phải được bạn duyệt." },
  acceptEdits: { label: "Tự sửa file", desc: "Tự duyệt sửa file trong dự án. Lệnh vẫn hỏi." },
  plan: { label: "Lập kế hoạch", desc: "Chỉ đọc. Agent đề xuất kế hoạch để bạn duyệt trước khi làm." },
  bypass: { label: "Tự động hết", desc: "Tự duyệt mọi thứ (vẫn chặn lệnh phá hoại nặng). Chỉ dùng trong thư mục thử nghiệm!" },
};
const TOOL_LABEL: Record<string, string> = { read_document: "Đọc tài liệu", find_in_documents: "Tìm trong tài liệu", create_docx: "Tạo Word", docx_replace: "Sửa Word", create_xlsx: "Tạo Excel", xlsx_edit: "Sửa Excel", create_pptx: "Tạo PowerPoint", convert_to_pdf: "Xuất PDF", read_file: "Đọc", list_dir: "Liệt kê", glob: "Tìm file", grep: "Tìm nội dung", edit_file: "Sửa", write_file: "Ghi", bash: "Lệnh", todo_write: "Việc cần làm", task: "Subagent", run_javascript: "Chạy JS", web_fetch: "Tải web", exit_plan_mode: "Kế hoạch" };

interface ToolCard {
  id: string;
  name: string;
  el: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  res: HTMLElement;
  depth: number;
}

export interface MountOptions {
  /** Gọi khi agent cần người dùng chú ý (xin quyền) hoặc làm xong khi tab đang ẩn. */
  onAttention?: (kind: "permission" | "done" | "clear") => void;
}

export function saveBlob(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function renderDiff(diff: DiffLine[], max = 160): HTMLElement {
  const box = h("div", { class: "diff", role: "region", "aria-label": "Thay đổi" });
  diff.slice(0, max).forEach((l) => box.append(h("div", { class: "l " + l.kind }, h("span", { class: "n" }, l.kind === "gap" ? "" : String(l.kind === "del" ? l.oldNo ?? "" : l.newNo ?? "")), h("span", {}, (l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ") + l.text))));
  if (diff.length > max) box.append(h("div", { class: "l gap" }, h("span", { class: "n" }), h("span", {}, `… còn ${diff.length - max} dòng`)));
  return box;
}

export const previewBlock = (d: DiffPreview): HTMLElement[] =>
  d.outline
    ? [h("div", { class: "diff-stat" }, d.isNew ? "Tạo tệp mới " : "Ghi vào tệp ", h("b", {}, d.path)), h("pre", { class: "outline" }, d.outline)]
    : [diffStat(d), renderDiff(d.diff)];

const fileIcon = (name: string): string => {
  const e = name.toLowerCase().split(".").pop() ?? "";
  return ({ docx: "W", doc: "W", xlsx: "X", xls: "X", csv: "X", pptx: "P", ppt: "P", pdf: "▤", md: "¶", txt: "¶" } as Record<string, string>)[e] ?? "·";
};

const diffStat = (d: DiffPreview): HTMLElement => {
  const a = d.diff.filter((l) => l.kind === "add").length;
  const r = d.diff.filter((l) => l.kind === "del").length;
  return h("div", { class: "diff-stat" }, d.isNew ? "Tạo file mới " : "Sửa ", h("b", {}, d.path), " · ", h("b", { class: "a" }, "+" + a), " ", h("b", { class: "d" }, "−" + r));
};

export interface AppHandle {
  /** Gọi khi tab được hiện ra. */
  shown(): void;
  hidden(): void;
}

export function mountApp(root: HTMLElement, ctl: AgentController, opts: MountOptions = {}): AppHandle {
  const app = new App(root, ctl, opts);
  return { shown: () => app.setVisible(true), hidden: () => app.setVisible(false) };
}

class App {
  private state!: UiState;
  private busy = false;
  private feedInner = h("div", { class: "feed-inner" });
  private feed = h("div", { class: "feed", tabindex: "-1" }, this.feedInner);
  private input = h("textarea", { rows: "1", placeholder: "Nhập yêu cầu… (Enter gửi · Shift+Enter xuống dòng · / để xem lệnh)", "aria-label": "Yêu cầu cho agent" });
  private sendBtn = h("button", { class: "btn primary", type: "button", onclick: () => this.onSendClick() }, "Gửi");
  private modePill = h("button", { class: "pill", type: "button", "aria-haspopup": "menu", onclick: () => this.toggleModeMenu() });
  private modeMenu: HTMLElement | null = null;
  private slashMenu: HTMLElement | null = null;
  private slashItems: SlashCommandInfo[] = [];
  private slashSel = 0;
  private mentionMenu: HTMLElement | null = null;
  private mentionItems: string[] = [];
  private mentionSel = 0;
  private mentionSeq = 0;
  private procBar = h("div", { class: "procbar", "aria-live": "polite" });
  private procs = new Map<string, { command: string; alive: boolean; url?: string }>();
  private tipEl = h("div", { class: "mention-note", "aria-live": "polite" });
  private tree = h("div", { class: "tree", role: "tree", "aria-label": "Tệp trong dự án" });
  private todosEl = h("div", { class: "todos" });
  private wsEl = h("span", { class: "ws" });
  private meterBar = h("i");
  private meterTxt = h("span", {}, "ngữ cảnh 0%");
  private bannerHost = h("div");
  private sideActions = h("span", { class: "side-acts" });
  private fileInput = h("input", { type: "file", multiple: true, hidden: true, "aria-label": "Chọn tệp để thêm" });
  private shell: HTMLElement;
  private visible = true;
  private cur: HTMLElement | null = null; // khối trả lời đang stream
  private curRaw = "";
  private curThink: HTMLElement | null = null;
  private renderQueued = false;
  private cards = new Map<string, ToolCard>();
  private lastCard: ToolCard | null = null;
  private pending: { req: PermissionRequest; el: HTMLElement; allow: (always?: boolean) => void; deny: () => void } | null = null;
  private working: HTMLElement | null = null;
  private workTimer = 0;
  private workStart = 0;
  private stick = true;
  private expanded = new Set<string>();
  private sideStore = store("neu.side");
  private history: string[] = [];
  private histIdx = -1;

  constructor(private root: HTMLElement, private ctl: AgentController, private opts: MountOptions) {
    this.shell = h("div", { class: "neu" });
    root.append(this.shell);
    this.build();
    ctl.onEvent((e) => this.onEvent(e));
    void this.refresh(true);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) {
      this.opts.onAttention?.("clear");
      requestAnimationFrame(() => {
        this.scroll();
        this.input.focus({ preventScroll: true });
      });
    }
  }

  // ------------------------------------------------------------------ khung
  private build(): void {
    const head = h("div", { class: "neu-head" },
      h("button", { class: "iconbtn toggle-side", type: "button", "aria-label": "Mở/đóng thanh bên", onclick: () => this.shell.classList.toggle("side-open") }, "☰"),
      this.wsEl,
      h("span", { class: "grow" }),
      h("div", { class: "meter", title: "Mức dùng cửa sổ ngữ cảnh của mô hình" }, h("div", { class: "bar" }, this.meterBar), this.meterTxt),
      h("div", { style: { position: "relative" } }, this.modePill),
      this.ctl.learnLessons ? h("button", { class: "iconbtn", type: "button", "aria-label": "Học vibe coding", title: "Bài học, bài tập chấm tự động, dự án mẫu", onclick: () => this.openLearning() }, "📚 Học") : null,
      h("button", { class: "iconbtn", type: "button", "aria-label": "Phiên mới", title: "Phiên mới (/clear)", onclick: () => void this.ctl.newSession() }, "＋ Mới"),
      h("button", { class: "iconbtn", type: "button", "aria-label": "Cài đặt", title: "Cài đặt", onclick: () => this.openSettings() }, "⚙"),
    );
    const side = h("aside", { class: "side", "aria-label": "Thanh bên" },
      h("h4", { class: "files-h" }, "Tệp", this.sideActions),
      this.tree,
      h("h4", {}, "Việc cần làm"),
      this.todosEl,
    );
    const composer = h("div", { class: "composer-wrap" }, this.procBar, h("div", { class: "composer" }, this.input,
      h("div", { class: "bar" }, h("span", { id: "hint" }, "@tệp · !lệnh · Shift+Tab đổi chế độ · Esc dừng"), h("span", { class: "grow" }),
        h("button", { class: "btn sm", type: "button", title: "Chèn khung Mục tiêu – Ngữ cảnh – Ràng buộc", onclick: () => this.insertTemplate() }, "Mẫu prompt"), this.sendBtn),
      this.tipEl));
    const main = h("main", { class: "main" }, this.bannerHost, this.feed, composer);
    this.shell.append(head, h("div", { class: "neu-body" }, side, main));
    if (this.sideStore.get() === "0") this.side(false);
    this.shell.append(this.fileInput);
    this.fileInput.addEventListener("change", () => {
      void this.uploadList(this.fileInput.files);
      this.fileInput.value = "";
    });
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    this.shell.addEventListener("dragenter", (e) => hasFiles(e) && (depth++, this.shell.classList.add("dropping")));
    this.shell.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
    this.shell.addEventListener("dragleave", (e) => hasFiles(e) && --depth <= 0 && ((depth = 0), this.shell.classList.remove("dropping")));
    this.shell.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.shell.classList.remove("dropping");
      void this.uploadList(e.dataTransfer!.files);
    });

    this.feed.addEventListener("scroll", () => (this.stick = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 80));
    this.feed.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-copy]");
      if (b) {
        const code = b.closest(".code")?.querySelector("code")?.textContent ?? "";
        void navigator.clipboard?.writeText(code).then(() => ((b as HTMLElement).textContent = "Đã chép"), () => undefined);
        setTimeout(() => ((b as HTMLElement).textContent = "Sao chép"), 1500);
      }
    });
    this.input.addEventListener("input", () => {
      this.autoGrow();
      this.updateSlash();
      void this.updateMention();
      this.paintTips();
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("keydown", (e) => this.onGlobalKey(e));
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (this.modeMenu && !t.closest(".modemenu") && !t.closest(".pill")) this.closeModeMenu();
    });
    this.shell.addEventListener("click", (e) => {
      if (window.innerWidth <= 800 && !(e.target as HTMLElement).closest(".side") && !(e.target as HTMLElement).closest(".toggle-side")) this.shell.classList.remove("side-open");
    });
  }

  private side(open: boolean): void {
    this.shell.querySelector<HTMLElement>(".side")!.style.display = open ? "" : "none";
    this.sideStore.set(open ? "1" : "0");
  }

  private async refresh(first = false): Promise<void> {
    this.state = await this.ctl.getState();
    this.busy = this.state.busy;
    this.wsEl.textContent = this.state.workspace;
    this.wsEl.title = this.state.workspace;
    this.paintMode();
    this.paintSideActions();
    this.paintTodos(this.state.todos);
    this.paintBanners();
    this.paintBusy();
    this.procs.clear();
    for (const p of this.state.processes ?? []) this.procs.set(p.id, { command: p.command, alive: p.alive, url: p.url });
    this.paintProcs();
    if (first || !this.feedInner.children.length) this.paintWelcome();
    void this.loadTree();
  }

  private paintMode(): void {
    const m = this.state.mode;
    this.modePill.textContent = MODE_INFO[m].label;
    this.modePill.style.color = `var(--mode-${m})`;
    this.modePill.title = MODE_INFO[m].desc + " (Shift+Tab để đổi)";
  }

  private paintBanners(): void {
    clear(this.bannerHost);
    const s = this.state;
    if (s.untrustedProject)
      this.bannerHost.append(h("div", { class: "banner warn", role: "alert" },
        h("div", { class: "grow" }, h("b", {}, "Dự án này có cấu hình riêng "), "(quy tắc cho phép, hook hoặc máy chủ MCP trong .neuagent/settings.json) có thể chạy lệnh thật. Chỉ tin cậy nếu bạn tin nguồn của thư mục này. Chưa tin cậy thì chỉ áp dụng quy tắc cấm."),
        h("button", { class: "btn sm primary", type: "button", onclick: async () => { await this.ctl.trustProject(true); await this.refresh(); } }, "Tin cậy"),
        h("button", { class: "btn sm", type: "button", onclick: async () => { await this.ctl.trustProject(false); await this.refresh(); } }, "Không")));
    if (!s.settings.hasKey && !s.presets.some((p) => !p.needsKey && p.baseUrl === s.settings.baseUrl))
      this.bannerHost.append(h("div", { class: "banner warn" }, h("div", { class: "grow" }, "Chưa có key để gọi mô hình. Vào Cài đặt để nhập key của nhóm bạn."), h("button", { class: "btn sm", type: "button", onclick: () => this.openSettings() }, "Cài đặt")));
    if (s.memoryFiles.length) this.bannerHost.append(h("div", { class: "notice", style: { padding: "6px 18px 0" } }, "Đã nạp hướng dẫn dự án: " + s.memoryFiles.join(", ")));
  }

  private paintWelcome(): void {
    clear(this.feedInner);
    const st = this.state;
    const work = st.profile === "work";
    this.feedInner.append(h("div", { class: "welcome" },
      h("h2", {}, st.welcomeTitle),
      h("div", {}, ...(work
        ? ["Tôi làm việc với các tệp trong thư mục ", h("code", {}, st.workspaceName), ": đọc, tóm tắt, soạn Word, tính Excel, làm slide. ", h("b", {}, "Kéo thả tệp Word/Excel/PDF vào đây"), " hoặc bấm “Thêm tệp” để bắt đầu."]
        : ["Tôi làm việc trong thư mục ", h("code", {}, st.workspaceName), st.capabilities.exec ? ": đọc và sửa mã, chạy lệnh (luôn hỏi bạn trước)." : ": đọc và sửa mã; chạy JavaScript trong hộp cát an toàn (bản web không có terminal)."])),
      h("div", { class: "chips" }, ...st.suggestions.map((x) => h("button", { class: "chip", type: "button", onclick: () => void this.submit(x) }, x))),
      work ? h("div", { class: "hint", style: { marginTop: "18px" } }, "Mọi thay đổi đều được hỏi trước. Bản gốc của bạn không bị ghi đè — kết quả được lưu thành tệp mới.") : null));
  }

  // ------------------------------------------------------------------ sự kiện từ agent
  private onEvent(e: SessionEvent): void {
    switch (e.type) {
      case "turn_start":
        this.busy = true;
        this.paintBusy();
        break;
      case "text":
        if (e.depth > 0) break;
        this.dropWelcome();
        if (!this.cur) {
          this.cur = h("div", { class: "msg-ai" });
          this.curRaw = "";
          this.append(this.cur);
        }
        this.curRaw += e.delta;
        this.queueRender();
        break;
      case "reasoning":
        if (!this.curThink) {
          this.curThink = h("div", { class: "think" });
          this.append(this.curThink);
        }
        this.curThink.textContent += e.delta;
        this.scroll();
        break;
      case "message_end":
        if (e.depth === 0) this.finishText(e.text);
        break;
      case "tool_start":
        this.finishText();
        this.dropWelcome();
        this.addTool(e);
        break;
      case "tool_result":
        this.finishTool(e);
        break;
      case "permission":
        this.addPermission(e.request);
        break;
      case "permission_resolved":
        this.resolvePermission(e.allowed);
        break;
      case "todos":
        this.paintTodos(e.todos);
        break;
      case "mode":
        this.state.mode = e.mode;
        this.paintMode();
        break;
      case "usage": {
        this.meterBar.style.width = e.contextPct + "%";
        this.meterBar.className = e.contextPct > 85 ? "vhi" : e.contextPct > 65 ? "hi" : "";
        this.meterTxt.textContent = `ngữ cảnh ${e.contextPct}%`;
        this.meterTxt.title = `${e.promptTokens} token vào · ${e.completionTokens} token ra · ${e.calls} lần gọi`;
        break;
      }
      case "notice":
        this.finishText();
        this.append(h("div", { class: "notice " + e.level, role: e.level === "error" ? "alert" : "status" }, e.text));
        break;
      case "proc": {
        const p = this.procs.get(e.id) ?? { command: e.command, alive: true };
        if (e.state === "exit") p.alive = false;
        if (e.url) p.url = e.url;
        if (e.state === "start") p.alive = true;
        this.procs.set(e.id, p);
        this.paintProcs();
        break;
      }
      case "files_changed":
        void this.loadTree(e.paths);
        break;
      case "turn_end":
        this.finishText();
        this.busy = false;
        this.pending = null;
        if (e.interrupted) this.append(h("div", { class: "notice warn" }, "Đã dừng theo yêu cầu."));
        if (!this.visible) this.opts.onAttention?.("done");
        this.paintBusy();
        this.input.focus();
        break;
      case "reset":
        this.cards.clear();
        this.lastCard = null;
        this.cur = null;
        this.pending = null;
        void this.refresh(true);
        break;
    }
  }

  private dropWelcome(): void {
    this.feedInner.querySelector(".welcome")?.remove();
  }
  private append(el: HTMLElement): void {
    this.feedInner.insertBefore(el, this.working);
    this.scroll();
  }
  private scroll(): void {
    if (this.stick) requestAnimationFrame(() => (this.feed.scrollTop = this.feed.scrollHeight));
  }
  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.cur) this.cur.innerHTML = renderMarkdown(this.curRaw);
      this.scroll();
    });
  }
  private finishText(final?: string): void {
    if (this.cur) {
      const text = final ?? this.curRaw;
      if (text.trim()) this.cur.innerHTML = renderMarkdown(text);
      else this.cur.remove();
    }
    this.cur = null;
    this.curRaw = "";
    this.curThink = null;
  }

  // ------------------------------------------------------------------ thẻ công cụ
  private addTool(e: Extract<SessionEvent, { type: "tool_start" }>): void {
    const res = h("span", { class: "res" });
    const body = h("div", { class: "tool-b", hidden: true });
    const head = h("div", { class: "tool-h", role: "button", tabindex: "0", "aria-expanded": "false" },
      h("span", { class: "dot" }), h("span", { class: "nm" }, TOOL_LABEL[e.name] ?? e.name), h("span", { class: "sm" }, e.summary), res);
    const el = h("div", { class: "tool running" + (e.depth > 0 ? " sub" : "") }, head, body);
    const toggle = () => {
      body.hidden = !body.hidden;
      head.setAttribute("aria-expanded", String(!body.hidden));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), toggle()));
    if (e.name === "bash") body.append(h("div", { class: "cmd" }, String(e.args.command ?? "")));
    if (e.preview) {
      body.append(...previewBlock(e.preview));
      body.hidden = false;
    }
    const card: ToolCard = { id: e.id, name: e.name, el, head, body, res, depth: e.depth };
    this.cards.set(e.id, card);
    this.lastCard = card;
    this.append(el);
  }

  private finishTool(e: Extract<SessionEvent, { type: "tool_result" }>): void {
    const c = this.cards.get(e.id);
    if (!c) return;
    c.el.classList.remove("running", "wait");
    c.el.classList.add(e.ok ? "ok" : "err");
    const lines = e.output.split("\n");
    const n = e.output.startsWith("(") ? 0 : lines.length;
    let sum = e.ok ? "" : e.output.replace(/^Lỗi:\s*/, "").split("\n")[0].slice(0, 90);
    if (e.ok) {
      if (e.name === "read_file") sum = `${lines.filter((l) => /^\s*\d+\t/.test(l)).length} dòng`;
      else if (["grep", "glob", "list_dir"].includes(e.name)) sum = `${n} kết quả`;
      else if (e.name === "bash") sum = lines.at(-1)?.startsWith("[mã thoát") ? lines.at(-1)!.replace(/[[\]]/g, "") : "xong";
      else if (e.name === "todo_write") sum = e.output.replace(/^Đã cập nhật danh sách việc /, "");
      else sum = lines[0].slice(0, 80);
    }
    c.res.textContent = sum;
    if (!c.el.querySelector(".verdict") || !e.ok) c.body.querySelector(".out")?.remove();
    const showOut = !["edit_file", "write_file", "todo_write"].includes(e.name) || !e.ok;
    if (showOut && e.output.trim()) {
      const long = lines.length > 14;
      const pre = h("pre", { class: "out" }, long && !this.expanded.has(e.id) ? lines.slice(0, 14).join("\n") + `\n… (${lines.length - 14} dòng nữa — bấm để xem hết)` : e.output);
      if (long)
        pre.addEventListener("click", () => {
          this.expanded.add(e.id);
          pre.textContent = e.output;
        });
      c.body.append(pre);
      if (!e.ok || e.name === "bash") c.body.hidden = false;
      else if (e.name !== "read_file" && n <= 8) c.body.hidden = false;
    }
    c.head.setAttribute("aria-expanded", String(!c.body.hidden));
    this.scroll();
  }

  // ------------------------------------------------------------------ xin quyền
  private addPermission(req: PermissionRequest): void {
    this.finishText();
    let card = this.lastCard && this.lastCard.name === req.tool && this.lastCard.el.classList.contains("running") ? this.lastCard : null;
    let host: HTMLElement;
    if (card) {
      card.el.classList.remove("running");
      card.el.classList.add("wait");
      host = card.el;
      card.body.hidden = false;
    } else {
      host = h("div", { class: "tool wait" }, h("div", { class: "tool-h" }, h("span", { class: "dot" }), h("span", { class: "nm" }, req.kind === "plan" ? "Kế hoạch" : (TOOL_LABEL[req.tool] ?? req.tool)), h("span", { class: "sm" }, req.summary)));
      this.append(host);
    }
    const ask = h("div", { class: "ask", role: "group", "aria-label": "Xin quyền" });
    const note = h("input", { type: "text", placeholder: req.kind === "plan" ? "Góp ý để chỉnh kế hoạch…" : "Lý do từ chối (không bắt buộc)…", "aria-label": "Ghi chú" });
    const respond = (r: Parameters<AgentController["respondPermission"]>[1]) => this.ctl.respondPermission(req.id, r);
    let allow: (always?: boolean) => void;
    let deny: () => void;
    if (req.kind === "plan") {
      const plan = h("div", { class: "plan msg-ai", html: renderMarkdown(req.plan ?? "") });
      allow = () => respond({ allow: true, mode: "acceptEdits" });
      deny = () => respond({ allow: false, note: note.value.trim() || undefined });
      ask.append(h("div", { class: "q" }, "Agent đề xuất kế hoạch này. Duyệt chứ?"), plan,
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => respond({ allow: true, mode: "acceptEdits" }) }, "Duyệt, tự sửa file"),
          h("button", { class: "btn", type: "button", onclick: () => respond({ allow: true, mode: "default" }) }, "Duyệt, hỏi từng thay đổi"),
          note, h("button", { class: "btn danger", type: "button", onclick: deny }, "Chưa, tiếp tục lập kế hoạch")));
    } else {
      allow = (always) => respond({ allow: true, always });
      deny = () => respond({ allow: false, note: note.value.trim() || undefined });
      const label = req.tool === "bash" ? "Chạy lệnh này?" : req.preview?.outline ? (req.preview.isNew ? "Tạo tài liệu này?" : /replace|edit/.test(req.tool) ? "Sửa tài liệu này?" : "Ghi đè tài liệu này?") : req.preview ? (req.preview.isNew ? "Tạo file này?" : "Áp dụng thay đổi này?") : `Cho phép ${TOOL_LABEL[req.tool] ?? req.tool}?`;
      ask.append(...([h("div", { class: "q" }, label), req.note ? h("div", { class: "note" }, req.note) : null,
        req.tool !== "bash" && !req.preview ? h("div", { class: "cmd", style: { marginBottom: "8px" } }, req.summary) : null,
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => allow() }, "Cho phép ", h("kbd", {}, "Enter")),
          h("button", { class: "btn", type: "button", title: "Thêm quy tắc cho phiên này", onclick: () => allow(true) }, "Luôn cho phép trong phiên"),
          note, h("button", { class: "btn danger", type: "button", onclick: deny }, "Từ chối ", h("kbd", {}, "Esc")))] as (HTMLElement | null)[]).filter((x): x is HTMLElement => !!x));
    }
    host.append(ask);
    this.pending = { req, el: ask, allow, deny };
    if (!this.visible) this.opts.onAttention?.("permission");
    this.paintBusy();
    this.scroll();
    (ask.querySelector("button.primary") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private resolvePermission(allowed: boolean): void {
    const p = this.pending;
    if (!p) return;
    const host = p.el.parentElement;
    p.el.replaceWith(h("div", { class: "verdict " + (allowed ? "yes" : "no") }, allowed ? "✓ Đã cho phép" : "✗ Đã từ chối"));
    host?.classList.remove("wait");
    if (host && !host.classList.contains("ok") && !host.classList.contains("err")) host.classList.add("running");
    this.pending = null;
    this.paintBusy();
  }

  // ------------------------------------------------------------------ nhập liệu
  private paintBusy(): void {
    const waiting = !!this.pending;
    this.sendBtn.textContent = this.busy ? "Dừng" : "Gửi";
    this.sendBtn.className = "btn " + (this.busy ? "danger" : "primary");
    if (this.busy && !this.working) {
      this.workStart = Date.now();
      const t = h("span", {}, "Đang làm việc… 0s");
      this.working = h("div", { class: "working", role: "status" }, h("span", { class: "spin" }), t, h("span", {}, "· Esc để dừng"));
      this.feedInner.append(this.working);
      this.workTimer = window.setInterval(() => (t.textContent = (this.pending ? "Đang chờ bạn duyệt… " : "Đang làm việc… ") + Math.round((Date.now() - this.workStart) / 1000) + "s"), 500);
      this.scroll();
    } else if (!this.busy && this.working) {
      clearInterval(this.workTimer);
      this.working.remove();
      this.working = null;
    }
    void waiting;
  }

  private onSendClick(): void {
    if (this.busy) this.ctl.interrupt();
    else void this.submit(this.input.value);
  }

  private async submit(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.busy) return;
    this.history.unshift(t);
    this.histIdx = -1;
    this.input.value = "";
    this.autoGrow();
    this.closeSlash();
    this.closeMention();
    clear(this.tipEl);
    this.dropWelcome();
    this.stick = true;
    this.append(h("div", { class: "msg-user" }, t));
    this.busy = true;
    this.paintBusy();
    await this.ctl.send(t);
    const st = await this.ctl.getState();
    this.state.commands = st.commands;
    this.state.todos = st.todos;
  }

  private autoGrow(): void {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 220) + "px";
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (this.mentionMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.mentionSel = (this.mentionSel + (e.key === "ArrowDown" ? 1 : -1) + this.mentionItems.length) % this.mentionItems.length;
        this.paintMention();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        this.pickMention(this.mentionItems[this.mentionSel]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeMention();
        return;
      }
    }
    if (this.slashMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.slashSel = (this.slashSel + (e.key === "ArrowDown" ? 1 : -1) + this.slashItems.length) % this.slashItems.length;
        this.paintSlash();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !/\s/.test(this.input.value.trim().slice(1)))) {
        e.preventDefault();
        const c = this.slashItems[this.slashSel];
        if (c) {
          this.input.value = "/" + c.name + " ";
          this.closeSlash();
          this.autoGrow();
          if (e.key === "Enter" && ["help", "clear", "undo", "context", "compact"].includes(c.name)) void this.submit("/" + c.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeSlash();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this.submit(this.input.value);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      void this.cycleMode();
    } else if (e.key === "Escape" && this.busy) {
      e.preventDefault();
      this.ctl.interrupt();
    } else if (e.key === "ArrowUp" && !this.input.value && this.history.length) {
      e.preventDefault();
      this.histIdx = Math.min(this.histIdx + 1, this.history.length - 1);
      this.input.value = this.history[this.histIdx];
    } else if (e.key === "ArrowDown" && this.histIdx >= 0) {
      e.preventDefault();
      this.histIdx--;
      this.input.value = this.histIdx >= 0 ? this.history[this.histIdx] : "";
    }
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === "Tab" && e.shiftKey && e.target !== this.input && tag !== "INPUT" && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      void this.cycleMode();
      return;
    }
    if (this.pending && !document.querySelector("dialog[open]")) {
      const typing = (tag === "INPUT" || tag === "TEXTAREA") && (e.target as HTMLInputElement).value !== "";
      if (e.key === "Escape") {
        e.preventDefault();
        this.pending.deny();
      } else if (e.key === "Enter" && !typing && tag !== "BUTTON" && !(e.target === this.input && this.input.value)) {
        e.preventDefault();
        this.pending.allow();
      }
    } else if (e.key === "Escape" && this.busy && !(e.target === this.input)) this.ctl.interrupt();
  }

  private async cycleMode(): Promise<void> {
    const order = this.state.allowedModes;
    const next = order[(order.indexOf(this.state.mode) + 1) % order.length];
    await this.ctl.setMode(next);
  }

  // ------------------------------------------------------------------ menu lệnh /
  private updateSlash(): void {
    const v = this.input.value;
    if (!v.startsWith("/") || /\s/.test(v.trim())) return this.closeSlash();
    const q = v.slice(1).toLowerCase();
    this.slashItems = this.state.commands.filter((c) => c.name.toLowerCase().startsWith(q) || (q.length > 1 && c.name.toLowerCase().includes(q)));
    if (!this.slashItems.length) return this.closeSlash();
    this.slashSel = Math.min(this.slashSel, this.slashItems.length - 1);
    this.paintSlash();
  }
  private paintSlash(): void {
    this.slashMenu?.remove();
    const m = h("div", { class: "menu", role: "listbox", "aria-label": "Lệnh" }, ...this.slashItems.map((c, i) =>
      h("div", { class: "it" + (i === this.slashSel ? " sel" : ""), role: "option", onmousedown: (ev: Event) => { ev.preventDefault(); this.input.value = "/" + c.name + " "; this.closeSlash(); this.input.focus(); } },
        h("span", { class: "k" }, "/" + c.name), h("span", { class: "d" }, c.description))));
    this.input.parentElement!.append(m);
    this.slashMenu = m;
    m.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  private closeSlash(): void {
    this.slashMenu?.remove();
    this.slashMenu = null;
    this.slashSel = 0;
  }

  // ------------------------------------------------------------------ @tệp
  private mentionToken(): { start: number; query: string } | null {
    const pos = this.input.selectionStart ?? this.input.value.length;
    const m = /(^|\s)@([^\s@]*)$/.exec(this.input.value.slice(0, pos));
    return m ? { start: pos - m[2].length - 1, query: m[2] } : null;
  }
  private async updateMention(): Promise<void> {
    const tok = this.mentionToken();
    if (!tok || !this.ctl.searchFiles) return this.closeMention();
    const seq = ++this.mentionSeq;
    let found: string[] = [];
    try {
      found = await this.ctl.searchFiles(tok.query);
    } catch {
      /* bỏ qua */
    }
    if (seq !== this.mentionSeq) return;
    this.mentionItems = found.slice(0, 8);
    if (!this.mentionItems.length) return this.closeMention();
    this.mentionSel = Math.min(this.mentionSel, this.mentionItems.length - 1);
    this.paintMention();
  }
  private paintMention(): void {
    this.mentionMenu?.remove();
    const m = h("div", { class: "menu", role: "listbox", "aria-label": "Tệp" }, ...this.mentionItems.map((p, i) =>
      h("div", { class: "it" + (i === this.mentionSel ? " sel" : ""), role: "option", onmousedown: (ev: Event) => { ev.preventDefault(); this.pickMention(p); } },
        h("span", { class: "k" }, "@" + p.split("/").pop()), h("span", { class: "d" }, p))));
    this.input.parentElement!.append(m);
    this.mentionMenu = m;
    m.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  private pickMention(path: string): void {
    const tok = this.mentionToken();
    if (tok) {
      const pos = this.input.selectionStart ?? this.input.value.length;
      const ins = "@" + path + " ";
      this.input.value = this.input.value.slice(0, tok.start) + ins + this.input.value.slice(pos);
      this.input.setSelectionRange(tok.start + ins.length, tok.start + ins.length);
    }
    this.closeMention();
    this.autoGrow();
    this.input.focus();
  }
  private closeMention(): void {
    this.mentionSeq++;
    this.mentionMenu?.remove();
    this.mentionMenu = null;
    this.mentionSel = 0;
  }

  // ------------------------------------------------------------------ gợi ý cấu trúc prompt
  private paintTips(): void {
    clear(this.tipEl);
    const tips = promptTips(this.input.value);
    if (!tips.length) return;
    this.tipEl.append("💡 Prompt rõ hơn: ", ...tips.flatMap((t, i) => [h("b", {}, t.part), " — " + t.tip + (i < tips.length - 1 ? " · " : "")]));
  }
  private insertTemplate(): void {
    if (!this.input.value.trim()) this.input.value = PROMPT_TEMPLATE;
    else this.input.value += (this.input.value.endsWith("\n") ? "" : "\n") + PROMPT_TEMPLATE;
    this.autoGrow();
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  // ------------------------------------------------------------------ tiến trình nền
  private paintProcs(): void {
    clear(this.procBar);
    for (const [id, p] of this.procs) {
      if (!p.alive) { this.procs.delete(id); continue; }
      this.procBar.append(h("div", { class: "proc", role: "status" }, h("span", { class: "dot", "aria-hidden": "true" }), h("code", { title: p.command }, p.command),
        p.url && this.ctl.openUrl ? h("button", { class: "btn sm", type: "button", onclick: () => void this.ctl.openUrl!(p.url!) }, "Mở " + p.url.replace(/^https?:\/\//, "")) : p.url ? h("span", { class: "mention-note" }, p.url) : null,
        this.ctl.stopProcess ? h("button", { class: "btn sm", type: "button", onclick: () => void this.ctl.stopProcess!(id) }, "Dừng") : null));
    }
  }

  // ------------------------------------------------------------------ học tập
  private openLearning(): void {
    void openLearn(this.ctl, {
      onTry: (p) => {
        this.input.value = p;
        this.autoGrow();
        this.paintTips();
        this.input.focus();
      },
      onReveal: (path) => {
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i++) this.openDirs.add(parts.slice(0, i).join("/"));
        void this.loadTree([path]);
      },
    });
  }

  // ------------------------------------------------------------------ menu chế độ
  private toggleModeMenu(): void {
    if (this.modeMenu) return this.closeModeMenu();
    const m = h("div", { class: "menu modemenu", role: "menu" }, ...this.state.allowedModes.map((k) =>
      h("div", { class: "it" + (k === this.state.mode ? " sel" : ""), role: "menuitemradio", "aria-checked": String(k === this.state.mode), tabindex: "0",
        onclick: async () => { this.closeModeMenu(); await this.ctl.setMode(k); },
        onkeydown: (ev: KeyboardEvent) => ev.key === "Enter" && (ev.target as HTMLElement).click() },
      h("span", { class: "k", style: { color: `var(--mode-${k})` } }, MODE_INFO[k].label), h("span", { class: "d" }, MODE_INFO[k].desc))));
    this.modePill.parentElement!.append(m);
    this.modeMenu = m;
  }
  private closeModeMenu(): void {
    this.modeMenu?.remove();
    this.modeMenu = null;
  }

  // ------------------------------------------------------------------ thanh bên
  private paintTodos(todos: Todo[]): void {
    clear(this.todosEl);
    if (!todos.length) return void this.todosEl.append(h("div", { class: "empty" }, "Agent sẽ ghi danh sách việc ở đây khi làm nhiệm vụ nhiều bước."));
    const box = { completed: "☑", in_progress: "◐", pending: "☐" } as const;
    todos.forEach((t) => this.todosEl.append(h("div", { class: "todo " + t.status }, h("span", { class: "box" }, box[t.status]), h("span", {}, t.content))));
  }

  private openDirs = new Set<string>([""]);
  private async loadTree(changed: string[] = []): Promise<void> {
    const build = async (dir: string, depth: number, into: HTMLElement): Promise<void> => {
      let items;
      try {
        items = await this.ctl.listDir(dir || ".");
      } catch {
        return;
      }
      if (!items.length && depth === 0) into.append(h("div", { class: "empty" }, "(thư mục trống)"));
      for (const it of items) {
        const path = dir ? dir + "/" + it.name : it.name;
        const open = it.isDir && this.openDirs.has(path);
        const hit = changed.includes(path);
        const acts = it.isDir ? null : h("span", { class: "acts" },
          this.state.capabilities.openExternal ? h("button", { type: "button", title: "Mở bằng ứng dụng", "aria-label": "Mở " + it.name + " bằng ứng dụng", onclick: (ev: Event) => { ev.stopPropagation(); void this.ctl.openExternally?.(path); } }, "↗") : null,
          h("button", { type: "button", title: "Tải xuống", "aria-label": "Tải " + it.name + " xuống", onclick: (ev: Event) => { ev.stopPropagation(); void this.download(path); } }, "⬇"));
        const row = h("div", { class: "row" + (hit ? " changed" : ""), role: "treeitem", style: { paddingLeft: 6 + depth * 14 + "px" }, tabindex: "0", title: path },
          h("span", { class: "ic" }, it.isDir ? (open ? "▾" : "▸") : fileIcon(it.name)), h("span", { class: "nm" }, it.name), acts);
        const act = () => {
          if (it.isDir) {
            if (this.openDirs.has(path)) this.openDirs.delete(path);
            else this.openDirs.add(path);
            void this.loadTree();
          } else void this.openFile(path);
        };
        row.addEventListener("click", act);
        row.addEventListener("keydown", (k) => k.key === "Enter" && act());
        into.append(row);
        if (open) await build(path, depth + 1, into);
      }
    };
    const frag = h("div");
    await build("", 0, frag);
    clear(this.tree);
    while (frag.firstChild) this.tree.append(frag.firstChild);
  }

  private async openFile(path: string): Promise<void> {
    const r = await this.ctl.readFile(path);
    const dlg = h("dialog", { class: "viewer" });
    const body = "error" in r ? h("div", { class: "hint" }, r.error) : h("pre", {}, ...r.text.split("\n").slice(0, 3000).map((l, i) => h("div", {}, r.kind === "text" ? h("span", { class: "ln" }, String(i + 1)) : null, l)));
    dlg.append(
      h("div", { class: "dh" }, h("span", { class: "mono" }, path),
        h("span", { class: "acts-h" },
          this.state.capabilities.openExternal ? h("button", { class: "btn sm", type: "button", onclick: () => void this.ctl.openExternally?.(path) }, "Mở bằng ứng dụng") : null,
          h("button", { class: "btn sm", type: "button", onclick: () => void this.download(path) }, "Tải xuống"),
          h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng"))),
      h("div", { class: "db" }, body, ...("text" in r && r.kind === "document" ? [h("div", { class: "hint" }, "Đây là bản chữ trích xuất để xem nhanh. Mở tệp gốc để xem đúng định dạng.")] : []), ...("text" in r && r.truncated ? [h("div", { class: "hint" }, "(đã cắt bớt phần cuối)")] : [])));
    dlg.style.width = "min(860px, 96vw)";
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  private paintSideActions(): void {
    clear(this.sideActions);
    const c = this.state.capabilities;
    this.sideActions.append(
      h("button", { class: "btn sm", type: "button", title: "Thêm tệp từ máy của bạn (hoặc kéo thả vào cửa sổ)", onclick: () => this.fileInput.click() }, "＋ Thêm tệp"),
      c.revealWorkspace ? h("button", { class: "btn sm", type: "button", title: "Mở thư mục trong Finder/Explorer", onclick: () => void this.ctl.revealWorkspace?.() }, "Mở thư mục") : h("button", { class: "btn sm", type: "button", title: "Tải cả thư mục về dạng .zip", onclick: () => void this.zip() }, "⬇ Zip"),
      h("button", { class: "btn sm", type: "button", title: "Làm mới", "aria-label": "Làm mới danh sách tệp", onclick: () => void this.loadTree() }, "↻"));
  }

  private async uploadList(list: FileList | null): Promise<void> {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const r = await this.ctl.uploadFiles(files);
    this.dropWelcome();
    if (r.saved.length) this.append(h("div", { class: "notice" }, "Đã thêm vào thư mục làm việc: " + r.saved.join(", ")));
    for (const e of r.errors) this.append(h("div", { class: "notice warn" }, e));
    void this.loadTree(r.saved);
  }

  private async download(path: string): Promise<void> {
    const r = await this.ctl.downloadFile(path);
    if ("error" in r) this.append(h("div", { class: "notice error" }, r.error));
    else saveBlob(r.name, r.data);
  }

  private async zip(): Promise<void> {
    const r = await this.ctl.exportZip();
    saveBlob(r.name, r.data);
  }

  // ------------------------------------------------------------------ cài đặt
  private openSettings(): void {
    const s: PublicSettings = this.state.settings;
    const base = h("input", { type: "text", value: s.baseUrl, spellcheck: "false", "aria-label": "Địa chỉ API" });
    const model = h("input", { type: "text", value: s.model, spellcheck: "false" });
    const key = h("input", { type: "password", autocomplete: "off", placeholder: s.hasKey ? `Đang dùng key ${s.keyHint} — để trống nếu giữ nguyên` : "Dán key vào đây", spellcheck: "false" });
    const think = h("input", { type: "checkbox", checked: s.thinking });
    const result = h("span", { class: "res", role: "status" });
    const dlg = h("dialog", {});
    const patch = () => ({ baseUrl: base.value.trim(), model: model.value.trim(), thinking: think.checked, ...(key.value.trim() ? { key: key.value.trim() } : {}) });
    dlg.append(
      h("div", { class: "dh" }, "Cài đặt", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
      h("div", { class: "db" },
        this.state.presets.length ? h("div", { class: "chips", style: { justifyContent: "flex-start", marginTop: "0" } }, ...this.state.presets.map((p) => h("button", { class: "chip", type: "button", onclick: () => { base.value = p.baseUrl; model.value = p.model; } }, p.label))) : null,
        h("label", {}, "Địa chỉ API (kiểu OpenAI)", base),
        h("label", {}, "Mô hình", model),
        h("label", {}, "Key API", key),
        h("label", { class: "chk" }, think, "Bật chế độ suy nghĩ (chậm hơn, hiển thị quá trình suy luận)"),
        h("div", { class: "hint" }, `Thư mục làm việc: ${this.state.workspace}. Khả năng: ${[this.state.capabilities.exec ? "chạy lệnh" : "không có terminal", this.state.capabilities.runJs ? "JS sandbox" : "", this.state.capabilities.fetch ? "tải web" : ""].filter(Boolean).join(", ")}.`),
        this.state.capabilities.realFs ? null : h("div", { class: "hint" }, "Key được lưu trong trình duyệt này (localStorage). Chỉ nhập key trên máy bạn tin cậy."),
        h("div", {}, h("button", { class: "btn sm", type: "button", onclick: async () => { await this.ctl.saveSettings(patch()); result.className = "res"; result.textContent = "Đang thử…"; const r = await this.ctl.testConnection(); result.className = "res " + (r.ok ? "ok" : "bad"); result.textContent = r.message; } }, "Lưu và kiểm tra kết nối"), " ", result)),
      h("div", { class: "df" },
        this.state.capabilities.reset ? h("button", { class: "btn danger", type: "button", style: { marginRight: "auto" }, title: "Xoá mọi thay đổi trong thư mục ảo của tab này và nạp lại dữ liệu mẫu", onclick: async () => { if (confirm("Xoá toàn bộ tệp trong thư mục của tab này và nạp lại dữ liệu mẫu?")) { await this.ctl.resetWorkspace?.(); dlg.close(); await this.refresh(true); } } }, "Khôi phục dữ liệu mẫu") : null,
        h("button", { class: "btn", type: "button", onclick: async () => { await this.ctl.saveSettings({ key: "" }); await this.refresh(); dlg.close(); } }, "Xoá key"),
        h("button", { class: "btn primary", type: "button", onclick: async () => { await this.ctl.saveSettings(patch()); await this.refresh(); dlg.close(); } }, "Lưu")));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    base.focus();
  }
}

export { escapeHtml };
