import type { AgentController, DiffLine, HistoryItem, DiffPreview, Mode, PermissionRequest, PublicSettings, SessionEvent, SlashCommandInfo, Todo, UiState } from "@neu/agent-core";
import { clear, h, store } from "./dom";
import { escapeHtml, renderMarkdown } from "./markdown";
import { treeIcon } from "./icons";
import { openSettings as openSettingsDialog, type AccountInfo } from "./settings-ui";
import { accountChip } from "./account-ui";
import { versionLink } from "./changelog-ui";
import { openGuide } from "./guide-ui";
import { openFeedback } from "./feedback-ui";
import { TIPS, type GuideTab } from "./guide-content";
import { DesignPreview } from "./preview";
import { ago, openInstructions, openNewProject, toggleProjectMenu } from "./projects-ui";
import { openLearn } from "./learn";
import { CodeTools } from "./code-tools";
import { DocPane } from "./docview";
import { WorkTools } from "./work-tools";
import { PROMPT_TEMPLATE } from "./prompt-tips";

const MODE_INFO: Record<Mode, { label: string; desc: string }> = {
  default: { label: "Hỏi trước", desc: "Đọc tự do. Sửa file và chạy lệnh phải được bạn duyệt." },
  acceptEdits: { label: "Tự sửa file", desc: "Tự duyệt sửa file trong dự án. Lệnh vẫn hỏi." },
  auto: { label: "Tự động", desc: "Tự lo việc thường ngày (sửa file, build, test, git). Chỉ hỏi khi quan trọng: xoá, mạng, tệp bí mật." },
  plan: { label: "Lập kế hoạch", desc: "Chỉ đọc. Agent đề xuất kế hoạch để bạn duyệt trước khi làm." },
  bypass: { label: "Toàn quyền", desc: "Không hỏi gì (vẫn chặn lệnh phá hoại nặng và hỏi khi đụng tệp bí mật). Chỉ dùng trong thư mục thử nghiệm." },
};
const TOOL_LABEL: Record<string, string> = { read_document: "Đọc tài liệu", find_in_documents: "Tìm trong tài liệu", create_docx: "Tạo Word", docx_replace: "Sửa Word", merge_check: "Kiểm tra trộn", merge_documents: "Trộn hàng loạt", scan_pii: "Quét dữ liệu cá nhân", redact_pii: "Che dữ liệu cá nhân", xlsx_pivot: "Bảng tổng hợp", create_xlsx: "Tạo Excel", xlsx_edit: "Sửa Excel", create_pptx: "Tạo PowerPoint", convert_to_pdf: "Xuất PDF", read_file: "Đọc", list_dir: "Liệt kê", glob: "Tìm file", grep: "Tìm nội dung", edit_file: "Sửa", write_file: "Ghi", bash: "Lệnh", todo_write: "Việc cần làm", task: "Subagent", run_javascript: "Chạy JS", web_fetch: "Tải web", exit_plan_mode: "Kế hoạch" };

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
  /** Chỗ trên thanh ngang của khung chứa để App đặt các nút (trái: ☰; phải: thước ngữ cảnh, chế độ, nút…). Không có thì App tự vẽ thanh riêng. */
  bar?: { left: HTMLElement; right: HTMLElement };
  /** Tài khoản đang đăng nhập (SSO) để hiện trong Cài đặt. */
  account?: AccountInfo;
  /** Gọi khi người dùng bấm "Đăng nhập lại" (phiên hết hạn). Không đặt: tải lại trang (web tự chuyển tới đăng nhập). null: bản này không có đăng nhập. */
  onLogin?: (() => void) | null;
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
  private input = h("textarea", { rows: "1", placeholder: "Nhập yêu cầu…", "aria-label": "Yêu cầu cho agent" });
  private sendBtn = h("button", { class: "btn primary send", type: "button", title: "Gửi (Enter)", "aria-label": "Gửi", onclick: () => this.onSendClick() }, "↑");
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
  private tree = h("div", { class: "tree", role: "tree", "aria-label": "Tệp trong dự án" });
  private projBtn = h("button", { class: "projbtn", type: "button", "aria-haspopup": "menu", title: "Chuyển dự án" });
  private projBox = h("div", { class: "proj", hidden: true });
  private chatsEl = h("div", { class: "chats", role: "list", "aria-label": "Các cuộc trò chuyện" });
  private chatsHead = h("h4", { class: "chats-h", hidden: true }, "Trò chuyện");
  private newChatBtn = h("button", { class: "btn newchat", type: "button", onclick: () => (this.t("new_chat"), void this.ctl.newSession()) }, "＋ Cuộc trò chuyện mới");
  private newBtn = h("button", { class: "iconbtn", type: "button", "aria-label": "Cuộc trò chuyện mới", title: "Cuộc trò chuyện mới (/clear)", onclick: () => (this.t("new_chat"), void this.ctl.newSession()) }, "＋ Mới");
  private learnBtn = h("button", { class: "iconbtn", type: "button", hidden: true, "aria-label": "Học vibe coding", title: "Bài học, bài tập chấm tự động, dự án mẫu", onclick: () => this.openLearning() }, "📚 Học");
  private pv: DesignPreview | null = null;
  private pvHost = h("div", { class: "pv-host", hidden: true });
  /** Bảng Thay đổi, /rewind, thẻ tổng kết, chọn mô hình, nút chạy (chỉ tab Code). */
  private codeTools!: CodeTools;
  /** Trích dẫn bấm xem được, khung xem tài liệu, “Quy trình của tôi” (chỉ tab Work). */
  private workTools!: WorkTools;
  private docPane!: DocPane;
  private hintEl = h("span", { id: "hint" });
  private todosEl = h("div", { class: "todos" });
  private todosHead = h("h4", { hidden: true }, "Việc cần làm");
  private wsEl = h("span", { class: "ws" });
  private meterBar = h("i");
  private meterTxt = h("span", {}, "0%");
  /** Nhãn hạn mức token hôm nay: chỉ hiện khi sắp hết (từ 80%), hết hoặc đang trong phần được vượt thêm. */
  private quotaEl = h("span", { class: "quota-chip", hidden: true });
  private ctxTip = "Mức dùng cửa sổ ngữ cảnh của mô hình";
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
    this.codeTools = new CodeTools(ctl, {
      append: (el) => this.append(el),
      repaint: (hist) => this.paintHistory(hist),
      setInput: (t) => { this.input.value = t; this.autoGrow(); this.input.focus(); },
      submit: (t) => void this.submit(t),
      refreshState: () => void this.refresh(),
      renderDiff: (d) => renderDiff(d),
    });
    this.docPane = new DocPane(ctl, { download: (p) => void this.download(p), external: ctl.openExternally ? (p) => void ctl.openExternally!(p) : undefined });
    this.workTools = new WorkTools(ctl, {
      append: (el) => this.append(el),
      setInput: (t) => { this.input.value = t; this.autoGrow(); this.input.focus(); },
      refreshState: () => void this.refresh(),
      openDoc: (path, loc) => void this.docPane.open(path, loc),
    });
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
    const toggle = h("button", { class: "iconbtn toggle-side", type: "button", "aria-label": "Mở/đóng thanh bên", onclick: () => this.shell.classList.toggle("side-open") }, "☰");
    const tools = [
      ...this.codeTools.buttons,
      ...this.workTools.buttons,
      this.learnBtn,
      this.newBtn,
      ...(this.ctl.sendFeedback ? [h("button", { class: "iconbtn", type: "button", "aria-label": "Góp ý", title: "Góp ý / báo lỗi cho nhóm phát triển", onclick: () => openFeedback(this.ctl, { track: (a) => this.t(a) }) }, "💬")] : []),
      h("button", { class: "iconbtn", type: "button", "aria-label": "Hướng dẫn", title: "Hướng dẫn: mẹo, thủ thuật, tình huống mẫu", onclick: () => this.openGuideDlg() }, "💡"),
      h("button", { class: "iconbtn", type: "button", "aria-label": "Cài đặt", title: "Cài đặt", onclick: () => this.openSettings() }, "⚙"),
    ];
    let head: HTMLElement | null = null;
    if (this.opts.bar) {
      this.opts.bar.left.append(toggle);
      this.opts.bar.right.append(...tools);
    } else head = h("div", { class: "neu-head" }, toggle, this.wsEl, h("span", { class: "grow" }), ...tools);
    this.projBtn.addEventListener("click", () => void toggleProjectMenu(this.projBtn, this.ctl, this.state, { changed: () => void this.refresh(true), newProject: () => openNewProject(this.ctl, this.state, () => void this.refresh(true)) }));
    this.projBox.append(this.projBtn, h("button", { class: "iconbtn", type: "button", title: "Hướng dẫn riêng của dự án (AGENTS.md)", "aria-label": "Hướng dẫn của dự án", onclick: () => void openInstructions(this.ctl, this.state, () => void this.refresh()) }, "📝"));
    const side = h("aside", { class: "side", "aria-label": "Thanh bên" },
      this.projBox,
      h("div", { class: "newchat-wrap" }, this.newChatBtn),
      this.chatsHead,
      this.chatsEl,
      h("h4", { class: "files-h" }, "Tệp", this.sideActions),
      this.tree,
      this.todosHead,
      this.todosEl,
      this.opts.account ? accountChip(this.opts.account, () => this.openSettings()) : null,
      versionLink(),
    );
    const composer = h("div", { class: "composer-wrap" }, this.procBar, h("div", { class: "composer" }, this.input,
      // dưới ô nhập (giống Claude): trái = chế độ chạy + mẫu prompt; phải = mức ngữ cảnh, mô hình, Gửi
      h("div", { class: "bar" },
        h("button", { class: "cbtn plus", type: "button", title: "Đính kèm tệp", "aria-label": "Đính kèm tệp", onclick: () => (this.t("attach"), this.fileInput.click()) }, "+"),
        h("div", { class: "mode-wrap", style: { position: "relative" } }, this.modePill),
        h("button", { class: "btn sm", type: "button", title: "Chèn khung Mục tiêu – Ngữ cảnh – Ràng buộc", onclick: () => this.insertTemplate() }, "Mẫu prompt"),
        this.hintEl, h("span", { class: "grow" }),
        this.quotaEl,
        h("div", { class: "meter", title: this.ctxTip }, h("div", { class: "bar" }, this.meterBar), this.meterTxt),
        this.codeTools.modelEl, this.sendBtn)));
    const main = h("main", { class: "main" }, this.bannerHost, this.feed, composer);
    this.pv = new DesignPreview(this.ctl, () => this.state, (path) => void this.download(path), (text) => void this.submit(text));
    this.pvHost.append(this.pv.el);
    this.shell.append(...(head ? [head] : []), h("div", { class: "neu-body" }, side, main, this.codeTools.panel, this.pvHost, this.docPane.el));
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
    this.input.addEventListener("paste", (e) => {
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      e.preventDefault();
      void this.pasteImages(imgs);
    });
    this.input.addEventListener("input", () => {
      this.autoGrow();
      this.updateSlash();
      void this.updateMention();
      if (this.busy) this.paintBusy(); // đổi nhãn Gửi/Dừng theo việc ô nhập có chữ hay không
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
    void this.ctl.diagnosticsStatus?.().then((d) => (this.diagOn = !!d?.enabled)).catch(() => undefined);
    this.busy = this.state.busy;
    this.wsEl.textContent = this.state.workspace;
    this.wsEl.title = this.state.workspace;
    this.paintProject();
    this.codeTools.update(this.state);
    this.workTools.update(this.state);
    if (this.state.profile !== "work") this.docPane.close();
    this.projBtn.title = this.state.workspace;
    this.learnBtn.hidden = !(this.ctl.learnLessons && this.state.profile === "code");
    this.newBtn.hidden = !!this.state.capabilities.chats;
    const exec = this.state.capabilities.exec;
    this.hintEl.textContent = "Enter gửi · / lệnh · @ tệp" + (exec ? " · ! chạy lệnh" : "");
    this.input.placeholder = "Nhập yêu cầu… (" + this.hintEl.textContent + ")";
    const design = this.state.profile === "design";
    this.pvHost.hidden = !design;
    this.pv?.setVisible(design);
    if (design) void this.pv?.refreshFiles();
    void this.paintChats();
    this.paintMode();
    this.paintQuota();
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
        h("div", { class: "grow" }, h("b", {}, "Dự án này có cấu hình riêng "), "(quy tắc, hook hoặc MCP) có thể chạy lệnh thật. Chỉ tin cậy nếu bạn tin nguồn thư mục này."),
        h("button", { class: "btn sm primary", type: "button", onclick: async () => { await this.ctl.trustProject(true); await this.refresh(); } }, "Tin cậy"),
        h("button", { class: "btn sm", type: "button", onclick: async () => { await this.ctl.trustProject(false); await this.refresh(); } }, "Không")));
    if (!s.settings.hasKey && !s.presets.some((p) => !p.needsKey && p.baseUrl === s.settings.baseUrl))
      this.bannerHost.append(h("div", { class: "banner warn" }, h("div", { class: "grow" }, "Chưa có key. Hãy nhập ở Cài đặt."), h("button", { class: "btn sm", type: "button", onclick: () => this.openSettings() }, "Cài đặt")));
    if (s.memoryFiles.length) this.bannerHost.append(h("div", { class: "notice", style: { padding: "6px 18px 0" } }, "Hướng dẫn dự án: " + s.memoryFiles.join(", ")));
  }

  private paintWelcome(): void {
    clear(this.feedInner);
    const st = this.state;
    const line = st.profile === "work" ? "Kéo thả tệp Word, Excel, PDF vào đây để bắt đầu."
      : st.profile === "design" ? "Gõ / để chọn mẫu: poster, landing page, slide, logo…"
        : st.capabilities.exec ? "Mô tả điều bạn muốn làm; tôi đọc, sửa mã và chạy thử." : "Mô tả điều bạn muốn làm; tôi đọc và sửa mã.";
    this.feedInner.append(h("div", { class: "welcome" },
      h("h2", {}, st.welcomeTitle),
      h("div", {}, line),
      h("div", { class: "chips" }, ...st.suggestions.map((x) => h("button", { class: "chip", type: "button", onclick: () => (this.t("suggestion"), void this.submit(x)) }, x))),
      this.tipEl(st.profile as GuideTab)));
  }

  /** Mẹo ngắn luân phiên trên màn hình chào + lối vào Hướng dẫn. */
  private tipEl(profile: GuideTab): HTMLElement {
    const tips = TIPS[profile] ?? [];
    const tip = tips.length ? tips[Math.floor(Date.now() / 60000) % tips.length] : "";
    return h("div", { class: "tip-row" }, tip ? h("span", { class: "tip-t" }, "💡 " + tip) : null, h("button", { class: "tip-b", type: "button", onclick: () => this.openGuideDlg() }, "Xem hướng dẫn"));
  }

  // ------------------------------------------------------------------ dự án và lịch sử trò chuyện
  private paintProject(): void {
    const on = !!this.state.capabilities.projects;
    this.projBox.hidden = !on;
    this.projBtn.textContent = "";
    this.projBtn.append(h("span", { class: "pj-ic" }, this.state.profile === "code" ? "📁" : this.state.profile === "design" ? "🎨" : "🗂"), h("span", { class: "pj-nm" }, this.state.projectName), h("span", { class: "pj-ar" }, "▾"));
    this.projBtn.title = "Dự án đang mở: " + this.state.projectName + " (bấm để chuyển)";
  }

  private async paintChats(): Promise<void> {
    const on = !!(this.state?.capabilities.chats && this.ctl.chatList);
    const list = on ? await this.ctl.chatList!() : [];
    this.chatsHead.hidden = !on;
    this.chatsEl.hidden = !on;
    clear(this.chatsEl);
    if (!on) return;
    // cuộc đang mở mà chưa được hỏi gì thì chưa lưu: vẫn hiện một dòng để luôn thấy mình đang ở đâu
    if (!list.some((c) => c.id === this.state.chatId)) this.chatsEl.append(h("div", { class: "chat on", role: "listitem" }, h("div", { class: "ct" }, h("span", { class: "t" }, "Cuộc trò chuyện mới"))));
    for (const c of list) {
      const cur = c.id === this.state.chatId;
      this.chatsEl.append(h("div", { class: "chat" + (cur ? " on" : ""), role: "listitem" },
        h("button", { class: "ct", type: "button", title: c.title, "aria-current": cur ? "true" : undefined, onclick: () => void this.openChat(c.id) }, h("span", { class: "t" }, c.title), h("small", {}, ago(c.updated) + " · " + c.turns + " lượt")),
        h("button", { class: "cx", type: "button", title: "Xoá cuộc trò chuyện này", "aria-label": "Xoá " + c.title, onclick: async () => { if (confirm(`Xoá cuộc trò chuyện “${c.title}”?`)) { await this.ctl.chatRemove!(c.id); await this.paintChats(); } } }, "×")));
    }
  }

  /** Mở lại một cuộc trò chuyện đã lưu: dựng lại nội dung và tiếp tục hỏi với đúng ngữ cảnh cũ. */
  private async openChat(id: string): Promise<void> {
    this.t("open_chat");
    if (this.busy || id === this.state.chatId) return;
    const r = await this.ctl.chatOpen!(id);
    if ("error" in r) return void this.append(h("div", { class: "notice error" }, r.error));
    this.state = await this.ctl.getState();
    this.paintHistory(r.history);
    this.paintBanners();
    this.paintTodos([]);
    void this.paintChats();
  }

  /** Dựng lại khung chat từ lịch sử đã lưu (mở lại cuộc trò chuyện, hoặc sau /rewind). */
  private paintHistory(history: HistoryItem[]): void {
    this.cards.clear();
    this.lastCard = null;
    this.cur = null;
    clear(this.feedInner);
    this.stick = true;
    for (const it of history) {
      if (it.kind === "user") this.append(h("div", { class: "msg-user" }, it.text));
      else if (it.kind === "assistant") {
        const el = h("div", { class: "msg-ai" });
        this.md(el, it.text);
        this.append(el);
      }
      else this.append(h("div", { class: "tool ok" }, h("div", { class: "tool-h" }, h("span", { class: "dot" }), h("span", { class: "nm" }, TOOL_LABEL[it.name ?? ""] ?? it.name ?? "Công cụ"), h("span", { class: "sm" }, it.text))));
    }
    if (!history.length) this.paintWelcome();
  }

  // ------------------------------------------------------------------ sự kiện từ agent
  private onEvent(e: SessionEvent): void {
    this.codeTools.onEvent(e);
    this.workTools.onEvent(e);
    if (e.type === "files_changed") this.docPane.onFilesChanged(e.paths);
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
      case "quota":
        this.state.quota = e.quota;
        this.paintQuota();
        break;
      case "mode":
        this.state.mode = e.mode;
        this.paintMode();
        break;
      case "usage": {
        this.meterBar.style.width = e.contextPct + "%";
        this.meterBar.className = e.contextPct > 85 ? "vhi" : e.contextPct > 65 ? "hi" : "";
        const ring = this.meterBar.parentElement as HTMLElement; // vòng tròn dưới ô nhập: --p = % đã dùng, mức màu theo ngưỡng
        ring.style.setProperty("--p", String(Math.max(0, Math.min(100, e.contextPct))));
        ring.dataset.lvl = e.contextPct > 85 ? "vhi" : e.contextPct > 65 ? "hi" : "";
        this.ctxTip = `Ngữ cảnh đã dùng ${e.contextPct}% · ${e.promptTokens} token vào · ${e.completionTokens} token ra · ${e.calls} lần gọi`;
        this.paintQuota();
        this.meterTxt.textContent = `${e.contextPct}%`;
        this.meterTxt.title = `${e.promptTokens} token vào · ${e.completionTokens} token ra · ${e.calls} lần gọi`;
        break;
      }
      case "notice":
        this.finishText();
        if (e.action === "login") {
          // phiên hết hạn / chưa đăng nhập: luôn kèm việc cần làm tiếp (không để người dùng bí)
          const go = this.opts.onLogin;
          this.append(h("div", { class: "notice error", role: "alert" }, h("div", {}, e.text),
            go === null ? h("div", { class: "notice-sub" }, "Bản này không bật đăng nhập nên không đăng nhập lại được. Nếu bạn đang chạy bản phát triển, hãy chạy lại với NEU_AUTH_FORCE=1, hoặc đổi địa chỉ máy chủ ở Cài đặt.")
              : h("div", { class: "notice-sub" }, h("button", { class: "btn primary sm", type: "button", onclick: () => (this.t("login_prompt"), (go ?? (() => location.reload()))()) }, "Đăng nhập lại"), " rồi gửi lại yêu cầu của bạn.")));
          break;
        }
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
        if (this.state?.profile === "design") void this.pv?.onFilesChanged(e.paths);
        break;
      case "turn_end":
        this.finishText();
        this.busy = false;
        this.pending = null;
        if (e.interrupted) this.append(h("div", { class: "notice warn" }, "Đã dừng theo yêu cầu."));
        if (!this.visible) this.opts.onAttention?.("done");
        if (!e.interrupted) this.appendFeedback();
        this.paintBusy();
        this.input.focus();
        void this.paintChats();
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

  /** Dựng Markdown vào một khối trả lời; ở tab Work các trích dẫn [[tệp|vị trí]] thành chip bấm xem được. */
  private md(el: HTMLElement, raw: string): void {
    el.innerHTML = renderMarkdown(this.workTools.prepare(raw));
    this.workTools.decorate(el);
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
      if (this.cur) this.md(this.cur, this.curRaw);
      this.scroll();
    });
  }
  private finishText(final?: string): void {
    if (this.cur) {
      const text = final ?? this.curRaw;
      if (text.trim()) this.md(this.cur, text);
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
      const editor = h("textarea", { class: "plan-edit", "aria-label": "Sửa kế hoạch", spellcheck: false, hidden: true }) as HTMLTextAreaElement;
      editor.value = req.plan ?? "";
      const edited = () => (!editor.hidden && editor.value.trim() !== (req.plan ?? "").trim() ? editor.value : undefined);
      const toggleEdit = () => {
        editor.hidden = !editor.hidden;
        plan.hidden = !editor.hidden;
        editBtn.textContent = editor.hidden ? "Sửa kế hoạch " : "Xem kế hoạch ";
        editBtn.append(h("kbd", {}, "Ctrl+G"));
        if (!editor.hidden) editor.focus();
      };
      const editBtn = h("button", { class: "btn", type: "button", title: "Tự sửa kế hoạch rồi duyệt: agent làm theo bản bạn sửa", onclick: toggleEdit }, "Sửa kế hoạch ", h("kbd", {}, "Ctrl+G"));
      ask.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === "g") {
          e.preventDefault();
          toggleEdit();
        }
      });
      allow = () => respond({ allow: true, mode: "auto", plan: edited() });
      deny = () => respond({ allow: false, note: note.value.trim() || undefined });
      ask.append(h("div", { class: "q" }, "Agent đề xuất kế hoạch này. Duyệt chứ?"), plan, editor,
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => respond({ allow: true, mode: "auto", plan: edited() }) }, "Duyệt, tự làm"),
          h("button", { class: "btn", type: "button", onclick: () => respond({ allow: true, mode: "default", plan: edited() }) }, "Duyệt, hỏi từng thay đổi"),
          editBtn,
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
    // đang làm việc: ô nhập có chữ → nút “Gửi” (tin được xếp hàng, agent nhận ở bước kế tiếp); trống → “Dừng”
    const stop = this.busy && !this.input.value.trim();
    this.sendBtn.textContent = stop ? "■" : "↑";
    this.sendBtn.title = stop ? "Dừng (Esc)" : "Gửi (Enter)";
    this.sendBtn.setAttribute("aria-label", stop ? "Dừng" : "Gửi");
    this.sendBtn.className = "btn send " + (stop ? "danger" : "primary");
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
    if (this.busy && !this.input.value.trim()) (this.t("stop_click"), this.ctl.interrupt());
    else void this.submit(this.input.value);
  }

  private async submit(text: string): Promise<void> {
    const t = text.trim();
    if (t.startsWith("/")) this.t("slash_command");
    if (t && this.codeTools.handleSlash(t)) {
      this.input.value = "";
      this.autoGrow();
      this.closeSlash();
      return;
    }
    if (!t) return;
    const queued = this.busy; // agent đang làm: tin này được xếp hàng, không bắt đầu lượt mới
    this.workTools.noteRequest(t);
    this.history.unshift(t);
    this.histIdx = -1;
    this.input.value = "";
    this.autoGrow();
    this.closeSlash();
    this.closeMention();
    this.dropWelcome();
    this.stick = true;
    this.append(h("div", { class: "msg-user" + (queued ? " queued" : "") }, t));
    if (queued) {
      this.paintBusy();
      await this.ctl.send(t);
      return;
    }
    this.busy = true;
    this.paintBusy();
    await this.ctl.send(t);
    if (/^\/memory\s*$/.test(t) && this.ctl.instructionsGet && this.ctl.instructionsSet) void openInstructions(this.ctl, this.state, () => void this.refresh());
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
          if (e.key === "Enter" && ["help", "clear", "undo", "context", "compact", "status", "diff", "rewind", "memory", "usage", "branch"].includes(c.name)) void this.submit("/" + c.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeSlash();
        return;
      }
    }
    if (e.ctrlKey && e.key.toLowerCase() === "g" && this.pending?.req.kind === "plan") {
      e.preventDefault();
      this.pending.el.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true }));
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this.submit(this.input.value);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      void this.cycleMode();
    } else if (e.key === "Escape" && !this.busy && !this.input.value && this.codeTools.escTap()) {
      e.preventDefault();
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
        h("span", { class: "k" }, "@" + (p.endsWith("/") ? "📁 " + p.slice(0, -1).split("/").pop() + "/" : p.split("/").pop())), h("span", { class: "d" }, p))));
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

  private insertTemplate(): void {
    this.t("template");
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
    this.t("learn_open");
    void openLearn(this.ctl, {
      onTry: (p) => {
        this.input.value = p;
        this.autoGrow();
        this.input.focus();
      },
      onReveal: (path) => {
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i++) this.openDirs.add(parts.slice(0, i).join("/"));
        void this.loadTree([path]);
      },
    });
  }

  /** Ghi một việc người dùng làm trong giao diện cho chẩn đoán (chỉ MÃ, không nội dung). Không bao giờ ném lỗi. */
  private t(act: string): void {
    try {
      this.ctl.track?.(act);
    } catch {
      /* bỏ qua */
    }
  }

  /** Hàng "Câu trả lời có ích không?" sau mỗi lượt: 👍, hoặc 👎 kèm lý do chọn sẵn (không có chữ tự do). Chỉ hiện khi gửi số liệu chẩn đoán đang bật. */
  private diagOn = false;
  private fbRow: HTMLElement | null = null;
  private appendFeedback(): void {
    if (!this.ctl.feedback || !this.diagOn) return;
    this.fbRow?.remove();
    const row = h("div", { class: "fb", role: "group", "aria-label": "Đánh giá câu trả lời" }, h("span", { class: "fb-q" }, "Câu trả lời có ích không?"));
    const done = () => {
      row.replaceChildren(h("span", { class: "fb-q" }, "Cảm ơn bạn đã phản hồi 🙏"));
      setTimeout(() => row.remove(), 4000);
    };
    const up = h("button", { class: "fb-btn", type: "button", title: "Có ích", "aria-label": "Có ích", onclick: () => (this.ctl.feedback!("up"), done()) }, "👍");
    const down = h("button", { class: "fb-btn", type: "button", title: "Chưa tốt", "aria-label": "Chưa tốt", onclick: () => {
      row.replaceChildren(h("span", { class: "fb-q" }, "Vì sao chưa tốt?"), ...[["wrong", "Sai/không đúng ý"], ["incomplete", "Chưa làm xong"], ["slow", "Chậm"], ["confusing", "Khó hiểu"], ["other", "Khác"]].map(([k, label]) =>
        h("button", { class: "chip", type: "button", onclick: () => (this.ctl.feedback!("down", k), done()) }, label)));
    } }, "👎");
    row.append(up, down);
    this.fbRow = row;
    this.append(row);
  }

  // ------------------------------------------------------------------ hạn mức token trong ngày
  private paintQuota(): void {
    const q = this.state?.quota;
    const meter = this.meterBar.parentElement?.parentElement as HTMLElement | undefined;
    const fmt = (n: number) => n.toLocaleString("vi-VN");
    const detail = q && q.state !== "unlimited" && q.limit > 0 ? `\nToken hôm nay: ${fmt(q.used)} / ${fmt(q.limit)} (${q.pct ?? 0}%) · làm mới lúc 00:00 ngày mai` : "";
    if (meter) meter.title = this.ctxTip + detail;
    const el = this.quotaEl;
    if (!q || q.state === "ok" || q.state === "unlimited" || !q.limit) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.state = q.state;
    el.textContent = q.state === "warn" ? `Token hôm nay ${Math.round(q.pct ?? 0)}%` : q.state === "grace" ? "Hết hạn mức hôm nay · hoàn tất việc đang làm" : "Hết hạn mức hôm nay";
    el.title = (q.state === "exceeded" ? "Bạn đã dùng hết hạn mức token hôm nay; hạn mức làm mới lúc 00:00 ngày mai. " : q.state === "grace" ? "Bạn đã dùng hết hạn mức; hệ thống cho vượt thêm một chút để hoàn tất việc đang làm. Sau đó yêu cầu mới sẽ bị từ chối đến 00:00 ngày mai. " : "Sắp hết hạn mức token hôm nay. ") + detail.trim();
  }

  // ------------------------------------------------------------------ menu chế độ
  private toggleModeMenu(): void {
    if (this.modeMenu) return this.closeModeMenu();
    const m = h("div", { class: "menu modemenu", role: "menu" }, ...this.state.allowedModes.map((k) =>
      h("div", { class: "it" + (k === this.state.mode ? " sel" : ""), role: "menuitemradio", "aria-checked": String(k === this.state.mode), tabindex: "0",
        onclick: async () => { this.closeModeMenu(); this.t("mode_change"); await this.ctl.setMode(k); },
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
    this.todosHead.hidden = !todos.length;
    this.todosEl.hidden = !todos.length;
    if (!todos.length) return;
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
          ...treeIcon(it.name, it.isDir, open), h("span", { class: "nm" }, it.name), acts);
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
    if (this.state.profile === "work" && this.ctl.docView && /\.(docx|xlsx|xlsm|pptx|pdf)$/i.test(path)) return void this.docPane.open(path);
    const r = await this.ctl.readFile(path);
    const dlg = h("dialog", { class: "viewer" });
    const body = "error" in r ? h("div", { class: "hint" }, r.error) : h("pre", {}, ...r.text.split("\n").slice(0, 3000).map((l, i) => h("div", {}, r.kind === "text" ? h("span", { class: "ln" }, String(i + 1)) : null, l)));
    dlg.append(
      h("div", { class: "dh" }, h("span", { class: "mono" }, path),
        h("span", { class: "acts-h" },
          this.state.capabilities.openExternal ? h("button", { class: "btn sm", type: "button", onclick: () => void this.ctl.openExternally?.(path) }, "Mở bằng ứng dụng") : null,
          h("button", { class: "btn sm", type: "button", onclick: () => void this.download(path) }, "Tải xuống"),
          h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng"))),
      h("div", { class: "db" }, body, ...("text" in r && r.kind === "document" ? [h("div", { class: "hint" }, "Bản chữ trích xuất. Mở tệp gốc để xem đúng định dạng.")] : []), ...("text" in r && r.truncated ? [h("div", { class: "hint" }, "(đã cắt bớt phần cuối)")] : [])));
    dlg.style.width = "min(860px, 96vw)";
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  private paintSideActions(): void {
    clear(this.sideActions);
    const c = this.state.capabilities;
    this.sideActions.append(
      h("button", { class: "btn sm", type: "button", title: "Thêm tệp từ máy của bạn (hoặc kéo thả vào cửa sổ)", onclick: () => (this.t("attach"), this.fileInput.click()) }, "＋ Thêm tệp"),
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

  /** Ctrl+V với ảnh (vd. ảnh chụp màn hình): lưu vào thư mục làm việc và chèn `@tên` vào prompt để agent đọc bằng read_image. */
  private async pasteImages(imgs: File[]): Promise<void> {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const files = await Promise.all(imgs.slice(0, 5).map(async (f, i) => ({ name: `anh-dan-${stamp}${imgs.length > 1 ? "-" + (i + 1) : ""}.${f.type === "image/jpeg" ? "jpg" : (f.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "")}`, data: new Uint8Array(await f.arrayBuffer()) })));
    const r = await this.ctl.uploadFiles(files);
    this.dropWelcome();
    for (const e of r.errors) this.append(h("div", { class: "notice warn" }, e));
    const refs = r.saved.filter((n) => !/\s/.test(n)).map((n) => "@" + n);
    if (refs.length) {
      const el = this.input;
      const before = el.value.slice(0, el.selectionStart ?? el.value.length);
      const after = el.value.slice(el.selectionEnd ?? el.value.length);
      const ins = (before && !/\s$/.test(before) ? " " : "") + refs.join(" ") + " ";
      el.value = before + ins + after;
      el.selectionStart = el.selectionEnd = before.length + ins.length;
      this.autoGrow();
      el.focus();
    }
    if (r.saved.length) this.append(h("div", { class: "notice" }, "Đã lưu ảnh dán vào thư mục làm việc: " + r.saved.join(", ")));
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
  private openGuideDlg(): void {
    const p = (this.state?.profile ?? "code") as GuideTab;
    openGuide({ profile: p, track: (a) => this.t(a), onTry: (text) => { this.input.value = text; this.autoGrow(); this.input.focus(); } });
  }

  private openSettings(): void {
    this.t("settings_open");
    openSettingsDialog(this.ctl, this.state, this.opts.account, () => void this.refresh());
  }
}

export { escapeHtml };
