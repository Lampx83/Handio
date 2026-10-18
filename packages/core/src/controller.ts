import type { DirEntry, Env } from "./env";
import { ProcessManager } from "./processes";
import { LlmClient, LlmError } from "./llm";
import { PROFILES, type Profile } from "./profiles";
import { allowedModes, type Policy } from "./policy";
import * as learning from "./learning";
import { changeDiff, listChanges, revertChanges, type ChangeDiff, type ChangeFile, type RevertResult } from "./changes";
import { detectRun, type RunSuggestion } from "./run-detect";
import { mergeHooks } from "./hooks";
import { extOf, formatSections, isOfficeFile, readDocumentSections } from "./office/readdoc";
import { basename, isInside, join, relative } from "./path";
import { sniffImage } from "./vision";
import type { Mode } from "./permissions";
import { archiveForSave, chatTitle, cleanProjectName, countTurns, ID_RE, messagesToHistory, newId, trimForSave, type ChatMeta, type ChatStore, type HistoryItem, type ProjectHost, type ProjectsState } from "./projects";
import { Session, type SessionOptions } from "./session";
import { dueState, MAX_RUNS_PER_DAY, MAX_TASK_CHATS, MAX_TASK_CHATS_PER_PROJECT, MAX_TASKS, newTask, nextRun, RUN_TIMEOUT_MS, runsToday, withRun, type Every, type ScheduledTask, type TaskLock, type TaskRun, type TaskView } from "./schedule";
import { badCitations, docViewOf, listProcedures, removeProcedure, saveProcedure, type Procedure } from "./work-ctl";
import type { DocView } from "./office/locate";
import { DiagnosticsRecorder, newInstallId } from "./diagnostics";
import { stackOf, type Stack, type UiLib } from "./task-profile";
import { parsePacks, readProjectPacks, type LoadedPack, type RawPack } from "./packs";
import type { HttpToolRuntime } from "./http-tools";
import type { SandboxStatus } from "./container";
import { feedbackProblem, type FeedbackInput, type FeedbackResult } from "./feedback";
import { buildShareV2, type SharedChatInfo, type SharePayloadV2, type SharePreview, type ShareResult } from "./share";
import { effectiveKey, normalizeSettings, sanitizeProjectSettings, toPublic, type BuiltinKey, type ProjectSettings } from "./settings";
import { IGNORE_DIRS, relPath, resolveSafe, ToolError, walk, type UndoEntry } from "./tools";
import type { AgentController, PermissionRequest, PermissionResponse, QuotaInfo, RewindPoint, SessionEvent, Settings, UiState } from "./types";

export interface SettingsStore {
  load(): Promise<Partial<Settings> | null>;
  save(s: Settings): Promise<void>;
}
export interface TrustStore {
  isTrusted(root: string): Promise<boolean>;
  setTrusted(root: string, trusted: boolean): Promise<void>;
}
export interface ControllerOptions {
  env: Env;
  profile?: Profile;
  /** Hạn chờ người dùng trả lời câu hỏi của `ask_user` (ms; mặc định 15 phút). Hết hạn thì agent tự quyết. */
  questionTimeoutMs?: number;
  /** Chính sách quản trị (khoá cài đặt). */
  policy?: Policy;
  /** Giá trị mặc định của cài đặt (vd địa chỉ API của bản phát hành). */
  defaults?: Partial<Settings>;
  /** Key tích hợp sẵn do ứng dụng cung cấp (Desktop). Bản web không dùng. */
  builtinKey?: BuiltinKey;
  store: SettingsStore;
  trust: TrustStore;
  realFs: boolean;
  presets?: UiState["presets"];
  openFolder?: () => Promise<void>;
  openExternally?: (absPath: string) => Promise<void>;
  /** Mở địa chỉ localhost trong trình duyệt (đã được kiểm tra là localhost). */
  openUrl?: (url: string) => Promise<void>;
  revealWorkspace?: () => Promise<void>;
  resetWorkspace?: () => Promise<void>;
  /** Gói mở rộng của quản trị/người dùng (xem packs.ts). Gói trong thư mục dự án được lõi tự đọc. */
  packs?: () => Promise<RawPack[]>;
  /** Nhiều dự án (thư mục) trong cùng một tab. */
  projects?: ProjectHost;
  /** Lưu lịch sử trò chuyện theo dự án. */
  chats?: ChatStore;
  /** Dựng một trang HTML thành PDF/PNG (Desktop, trong cửa sổ ẩn không script, không mạng). */
  renderDesign?: (html: string, opts: { format: "pdf" | "png"; width: number; height?: number }) => Promise<Uint8Array>;
  /** Hộp "Lưu thành…" của hệ điều hành (Desktop): hỏi người dùng muốn xuất vào thư mục nào. Trả null nếu huỷ. Không có = lưu cạnh tệp thiết kế. */
  pickSavePath?: (o: { defaultPath: string; format: "pdf" | "png" }) => Promise<string | null>;
  /** Tiêu đề đăng nhập (SSO/tài khoản) và các máy chủ (host[:cổng]) được phép nhận nó. */
  authHeaders?: () => Promise<Record<string, string> | null>;
  authHosts?: string[];
  fetchImpl?: typeof fetch;
  /** Địa chỉ gốc các dịch vụ của tổ chức cho công cụ HTTP của gói (tools.json), vd https://ai.neu.edu.vn/agent/. Không đặt = công cụ HTTP của gói không bật. */
  toolsBase?: string;
  /**
   * Tác vụ định kỳ (schedule.ts): `enabled` bật bộ hẹn giờ (Desktop/web); `now` để kiểm thử dùng đồng hồ giả. Không đặt `enabled` = chỉ quản lý được, không tự chạy.
   * `background` (Desktop, cần ProjectHost.peek): bộ lập lịch của multi.ts chạy cả tác vụ của dự án chưa mở thay cho bộ hẹn giờ từng dự án.
   * `canRun`: điều kiện để tự chạy (vd đã đăng nhập). `lock`: dùng chung giữa các tab để cả ứng dụng chỉ chạy một tác vụ tự động mỗi lúc.
   * `undo`: (do multi.ts đặt) nhật ký hoàn tác lần chạy, dùng chung giữa các bộ điều khiển dự án.
   */
  tasks?: { enabled?: boolean; now?: () => number; tickMs?: number; background?: boolean; canRun?: () => boolean; lock?: TaskLock; undo?: Map<string, RunUndo> };
  /** (multi.ts) Bộ điều khiển chỉ mở để chạy tác vụ định kỳ của dự án chưa mở: phiên nhàn rỗi không chạy hook/MCP/gói, không hỏi hạn mức. `wake()` khi người dùng mở dự án. */
  headless?: boolean;
  /** Mã dự án của bộ điều khiển này; mặc định là dự án đang mở của ProjectHost. */
  projectId?: string;
  /** Tự chẩn đoán không chứa nội dung (docs/DIAGNOSTICS.md). Không đặt = không ghi, không gửi gì. Tắt được bằng Settings.diagnostics hoặc policy.diagnostics=false. */
  /** Desktop, tab Code: trạng thái chạy lệnh trong container Docker (dò lại Docker mỗi lần gọi). Không đặt = không có tuỳ chọn này. */
  sandbox?: { status(): Promise<SandboxStatus> };
  diagnostics?: { endpoint: string; headers?(): Record<string, string>; enabled?(): boolean; version: string; build?: string; platform: string; fetch?: typeof fetch };
}

/** Nhật ký hoàn tác một lần chạy tác vụ định kỳ (chỉ trong bộ nhớ: đóng ứng dụng là mất). `after`: kích thước + giờ sửa của từng tệp ngay sau lần chạy (null = không còn tệp), để không đè lên chỗ người dùng sửa sau đó. */
export interface RunUndo {
  projectId: string;
  entries: UndoEntry[];
  after: Map<string, { size: number; mtimeMs: number } | null>;
}
/** Nội dung cũ tối đa giữ để hoàn tác một lần chạy (quá thì lần chạy đó không hoàn tác được). */
const MAX_UNDO_BYTES = 20_000_000;

const MAX_VIEW_BYTES = 200_000;
const MAX_UPLOAD = 50 * 1024 * 1024;

/** Chỉ giữ tên tệp (bỏ thư mục), bỏ ký tự điều khiển/đặc biệt. */
function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "").trim().slice(0, 150);
  return clean;
}

/** Điều phối một phiên làm việc: dùng chung cho trang web (trong trình duyệt) và tiến trình chính của Electron. */
export class LocalController implements AgentController {
  private listeners = new Set<(e: SessionEvent) => void>();
  private pending = new Map<string, (r: PermissionResponse) => void>();
  private settings!: Settings;
  private session!: Session;
  private llm!: LlmClient;
  private project: ProjectSettings = { deny: [], allow: [] };
  private trusted = false;
  private busy = false;
  private pendingNotices: string[] = [];
  private get builtin(): BuiltinKey | undefined {
    return this.o.builtinKey;
  }
  private abort: AbortController | null = null;
  private todos: import("./tools").Todo[] = [];
  private projectId = "";
  private projectName = "";
  private chatId = newId();
  /** Cuộc trò chuyện do /branch tạo: tiêu đề có thêm “(nhánh)”. */
  private branches = new Set<string>();
  private rawInputs: string[] = [];
  /** Công cụ đã dùng trong lượt hiện tại và việc làm xong gần nhất (cho "Lưu thành quy trình" của tab Work). */
  private turnTools: string[] = [];
  private lastGood: { prompt: string; tools: string[]; chatId: string; projectId: string } | null = null;
  private diag?: DiagnosticsRecorder;
  private tasksTimer?: ReturnType<typeof setInterval>;
  private taskAbort: AbortController | null = null;
  /** Mã tác vụ đang chạy trong dự án này. */
  private runningTask: string | null = null;
  /** Bộ điều khiển chỉ mở cho tác vụ định kỳ (xem ControllerOptions.headless). */
  private headless = false;
  private ownUndo = new Map<string, RunUndo>();
  /** Tiêu đề giữ nguyên khi người dùng nhắn tiếp trong cuộc trò chuyện của một lần chạy tự động. */
  private keptTitles = new Map<string, string>();
  private lastTaskChatAt = 0;
  /** Hạn mức token trong ngày (do máy chủ đếm); null = chưa biết hoặc máy chủ không có hạn mức. */
  private quota: QuotaInfo | null = null;

  private constructor(private o: ControllerOptions) {}

  static async create(o: ControllerOptions): Promise<LocalController> {
    const c = new LocalController(o);
    c.settings = c.applyPolicy(normalizeSettings(await o.store.load(), o.defaults));
    c.llm = new LlmClient(() => ({ baseUrl: c.settings.baseUrl, model: c.settings.model, key: effectiveKey(c.settings, c.builtin).key, keyHeader: c.settings.keyHeader, temperature: c.settings.temperature, maxOutputTokens: c.settings.maxOutputTokens, thinking: c.settings.thinking, allowInsecure: c.settings.allowInsecureHttp, tab: o.profile ?? "code", authHeaders: o.authHeaders ? async () => { try { return o.authHosts?.includes(new URL(c.settings.baseUrl).host) ? await o.authHeaders!() : null; } catch { return null; } } : undefined }), o.fetchImpl);
    // hạn mức token: lấy từ tiêu đề phản hồi mỗi lần gọi mô hình, và hỏi một lần lúc khởi động (không tốn token, không chặn khởi động)
    c.llm.onQuota = (q) => {
      c.quota = q.tabs || !c.quota?.tabs ? q : { ...q, tabs: c.quota.tabs }; // tiêu đề phản hồi không có danh sách tab: giữ danh sách đã biết
      c.fire({ type: "quota", quota: q });
    };
    c.headless = !!o.headless;
    if (!c.headless) c.askQuota();
    c.trusted = await o.trust.isTrusted(o.env.root);
    await c.loadProject();
    c.session = await c.makeSession(c.headless ? c.idleOverride() : undefined);
    if (!c.headless) c.pendingNotices.push(...c.session.startupNotices);
    c.initDiagnostics();
    if (o.projects) {
      const st = await o.projects.list();
      const pid = o.projectId && st.projects.some((p) => p.id === o.projectId) ? o.projectId : st.active;
      c.projectId = pid;
      c.projectName = st.projects.find((p) => p.id === pid)?.name ?? "";
    }
    if (o.tasks?.enabled) {
      c.tasksTimer = setInterval(() => void c.tasksTick(), o.tasks.tickMs ?? 30_000);
      (c.tasksTimer as { unref?: () => void }).unref?.();
    }
    return c;
  }

  /** Hỏi hạn mức một lần (không tốn token). Chỉ hỏi máy chủ mặc định của ứng dụng (không gửi thêm yêu cầu tới địa chỉ do người dùng tự đặt). */
  private askQuota(): void {
    if (this.settings.baseUrl === normalizeSettings({}, this.o.defaults).baseUrl) void this.llm.quota().then((q) => q && this.llm.onQuota?.(q));
  }

  /** Phiên nhàn rỗi của bộ điều khiển chỉ mở cho tác vụ: không hook, không MCP, không gói, không cấu hình dự án (không có tác dụng phụ khi chưa ai mở dự án). */
  private idleOverride(): Partial<SessionOptions> {
    return { trustProject: false, project: { deny: this.project.deny, allow: [] }, packs: [], getSettings: () => ({ ...this.settings, hooks: {}, mcpServers: {} }) };
  }

  /** Người dùng mở dự án vốn chỉ được mở cho tác vụ định kỳ: dựng phiên đầy đủ như mở dự án bình thường. */
  async wake(): Promise<void> {
    if (!this.headless) return;
    this.headless = false;
    this.askQuota();
    await this.rebuildSession();
  }

  private async loadProject(): Promise<void> {
    const dec = new TextDecoder();
    const merged: ProjectSettings = { deny: [], allow: [] };
    for (const f of [".neuagent/settings.json", ".neuagent/settings.local.json"]) {
      try {
        const p = sanitizeProjectSettings(JSON.parse(dec.decode(await this.o.env.readBytes(this.o.env.root + "/" + f))));
        merged.deny.push(...p.deny);
        merged.allow.push(...p.allow);
        merged.mode = p.mode ?? merged.mode;
        merged.hooks = mergeHooks(merged.hooks ?? {}, p.hooks ?? {});
        merged.mcpServers = { ...(merged.mcpServers ?? {}), ...(p.mcpServers ?? {}) };
      } catch {
        /* không có / hỏng: bỏ qua */
      }
    }
    this.project = merged;
  }

  private applyPolicy(s: Settings): Settings {
    const p = this.o.policy;
    if (!p) return s;
    if (p.baseUrl) s.baseUrl = p.baseUrl.replace(/\/+$/, "");
    if (p.allowInsecureHttp !== undefined) s.allowInsecureHttp = p.allowInsecureHttp;
    return s;
  }

  private async syncSettings(): Promise<void> {
    this.settings = this.applyPolicy(normalizeSettings(await this.o.store.load(), this.o.defaults));
  }

  private async makeSession(override?: Partial<SessionOptions>): Promise<Session> {
    // Gói mở rộng: của quản trị/người dùng do ứng dụng cung cấp + gói nằm trong dự án (.neuagent/packs, không tin cậy)
    const raws: RawPack[] = [];
    try {
      raws.push(...((await this.o.packs?.()) ?? []));
    } catch {
      /* không đọc được gói: chạy không có gói */
    }
    raws.push(...(await readProjectPacks(this.o.env, this.o.env.root)));
    const { packs, notices } = parsePacks(raws);
    const sess = await this.makeSessionWith(packs, override);
    sess.startupNotices.push(...notices);
    return sess;
  }

  private httpToolRuntime(): HttpToolRuntime | undefined {
    const base = this.o.toolsBase;
    if (!base) return undefined;
    let host = "";
    try {
      host = new URL(base).host;
    } catch {
      return undefined;
    }
    // tiêu đề đăng nhập chỉ gửi tới máy chủ của tổ chức (authHosts), như khi gọi mô hình
    const mayAuth = !!this.o.authHeaders && (this.o.authHosts ?? []).includes(host);
    return { base, fetch: this.o.fetchImpl ?? ((...a) => fetch(...a)), headers: mayAuth ? this.o.authHeaders : undefined };
  }

  /** Tiến trình nền (máy chủ dev…) của dự án đang mở: sống qua "cuộc trò chuyện mới", mở lại lịch sử, chuyển sang rồi quay về dự án. */
  private procs?: ProcessManager;

  private makeSessionWith(packs: LoadedPack[], override?: Partial<SessionOptions>): Promise<Session> {
    if (this.o.env.spawn && !this.procs) this.procs = new ProcessManager(this.o.env, () => undefined);
    return Session.create({
      procs: this.procs,
      env: this.o.env,
      profile: this.o.profile ?? "code",
      policy: this.o.policy,
      getSettings: () => this.settings,
      llm: this.llm,
      emit: (e) => {
        if (e.type === "todos") this.todos = e.todos;
        this.fire(e);
      },
      askPermission: (req) => this.askUser(req),
      project: this.project,
      trustProject: this.trusted,
      packs,
      httpTools: this.httpToolRuntime(),
      questionTimeoutMs: this.o.questionTimeoutMs,
      ...override,
    });
  }

  private fire(e: SessionEvent): void {
    if (e.type === "tool_start" && e.depth === 0) this.turnTools.push(e.name);
    this.diag?.onEvent(e); // không bao giờ ném lỗi, không chặn
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* một người nghe lỗi không được làm hỏng phiên */
      }
    }
  }

  private askUser(req: PermissionRequest): Promise<PermissionResponse> {
    return new Promise((resolve) => this.pending.set(req.id, resolve));
  }

  // ---------------------------------------------------------------- AgentController
  /** Agent đang làm việc trong dự án này (dùng cho trình quản lý nhiều dự án). */
  isBusy(): boolean {
    return this.busy;
  }

  /** Mã tác vụ định kỳ đang chạy trong dự án này (null = không có). */
  currentTaskId(): string | null {
    return this.runningTask;
  }

  /** Mã cuộc trò chuyện hiện tại. */
  currentChatId(): string {
    return this.chatId;
  }

  async getState(): Promise<UiState> {
    const env = this.o.env;
    await this.syncSettings();
    const def = PROFILES[this.o.profile ?? "code"];
    return {
      quota: this.quota,
      profile: def.id,
      profileLabel: def.label,
      tagline: def.tagline,
      welcomeTitle: def.welcomeTitle,
      suggestions: def.suggestions,
      allowedModes: allowedModes(def.modes, this.o.policy),
      workspace: this.session.ctx.root,
      workspaceName: basename(this.session.ctx.root) || "/",
      projectId: this.projectId,
      projectName: this.projectName || basename(this.session.ctx.root) || "/",
      chatId: this.chatId,
      ...(this.busy ? { live: messagesToHistory(this.session.main.messages) } : {}),
      mode: this.session.mode,
      model: this.settings.model,
      settings: toPublic(this.settings, this.builtin),
      commands: this.session.slashCommands(),
      todos: this.todos,
      busy: this.busy,
      capabilities: { exec: !!env.exec, runJs: !!env.runJs, fetch: !!env.fetchUrl, openFolder: !!this.o.openFolder, realFs: this.o.realFs, openExternal: !!this.o.openExternally, revealWorkspace: !!this.o.revealWorkspace, pdf: !!env.convertToPdf, reset: !!this.o.resetWorkspace, sandbox: !!env.sandbox && env.sandbox.kind !== "none" && env.sandbox.kind !== "refuse", projects: !!this.o.projects, pickFolder: !!this.o.projects?.pick, chats: !!this.o.chats, renderDesign: !!this.o.renderDesign },
      policy: { baseUrl: !!this.o.policy?.baseUrl, insecureHttp: this.o.policy?.allowInsecureHttp !== undefined, notice: this.o.policy?.notice },
      untrustedProject: !this.trusted && (this.project.allow.length > 0 || !!this.project.mode || Object.keys(this.project.hooks ?? {}).length > 0 || Object.keys(this.project.mcpServers ?? {}).length > 0),
      memoryFiles: this.session.memory.map((m) => m.name),
      processes: (this.session.ctx.procs?.list() ?? []).map((p) => ({ id: p.id, command: p.command, alive: p.alive, url: p.url })),
      presets: this.o.presets ?? [],
    };
  }

  onEvent(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Nhóm của người dùng không được dùng tab này (máy chủ báo qua /quota). Chỉ để báo sớm, tiết kiệm một lượt gọi; máy chủ vẫn tự kiểm tra từng yêu cầu. */
  private tabDenied(): boolean {
    const tabs = this.quota?.tabs;
    return !!tabs && !tabs.includes(this.o.profile ?? "code");
  }

  async send(text: string): Promise<void> {
    if (this.tabDenied()) {
      this.fire({ type: "notice", level: "error", text: `Nhóm của bạn không được dùng tab ${PROFILES[this.o.profile ?? "code"].label}.` });
      return;
    }
    if (this.taskAbort && !this.busy) {
      this.fire({ type: "notice", level: "warn", text: "Tác vụ định kỳ đang chạy trong dự án này. Đợi xong hoặc bấm Dừng ở nút ⏰." });
      return;
    }
    if (this.busy) {
      // đang làm việc: tin thường được xếp hàng và đưa cho agent ở bước kế tiếp; lệnh (/…, !…) thì phải đợi
      const t = text.trim();
      if (t && !/^[/!]/.test(t)) {
        this.session.queue.push(t);
        return;
      }
      this.fire({ type: "notice", level: "warn", text: "Agent đang làm việc. Tin nhắn thường gửi được ngay; lệnh / hoặc ! thì đợi xong hoặc bấm Dừng (Esc)." });
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    const turn = { projectId: this.projectId, chatId: this.chatId, session: this.session };
    await this.syncSettings();
    this.fire({ type: "turn_start" });
    if (this.diag && !/^[/!]/.test(text.trim())) this.diag.noteTask(text, await this.projectTags());
    this.turnTools = [];
    for (const n of this.pendingNotices.splice(0)) this.fire({ type: "notice", level: "warn", text: n });
    let final = "";
    let interrupted = false;
    let failed = false; // lượt kết thúc vì lỗi (mất kết nối, hết hạn mức…) chứ không phải vì xong việc
    let ranTurn = false;
    try {
      const modelCmd = /^\/model(?:\s+(.+))?$/.exec(text.trim());
      if (modelCmd) {
        await this.modelCommand(modelCmd[1]?.trim());
        return;
      }
      const info = /^\/(usage|effort|branch|fork)(?:\s+(.+))?$/.exec(text.trim());
      if (info) {
        if (info[1] === "usage") this.usageCommand();
        else if (info[1] === "effort") await this.effortCommand(info[2]?.trim().toLowerCase());
        else await this.branchCommand();
        return;
      }
      const r = await this.session.handleInput(text);
      if (r.reset) {
        await this.newSession();
      } else if (r.run) {
        this.rawInputs.push(text.trim());
        ranTurn = true;
        final = await this.session.main.runTurn(r.run, this.abort.signal);
        this.session.emitUsage();
        if (this.turnTools.length) this.lastGood = { prompt: r.run, tools: this.turnTools.filter((n, i, a) => a.indexOf(n) === i), chatId: this.chatId, projectId: this.projectId };
      }
    } catch (e) {
      if (!(e instanceof ToolError)) this.diag?.onError(e);
      if (e instanceof LlmError && e.kind === "abort") interrupted = true;
      else if (e instanceof LlmError) {
        failed = true;
        this.fire({ type: "notice", level: "error", text: e.message, ...(e.code === "login_required" ? { action: "login" as const } : {}) });
      }
      else if (e instanceof ToolError) this.fire({ type: "notice", level: "error", text: e.message });
      else this.fire({ type: "notice", level: "error", text: "Lỗi không mong muốn: " + (e as Error).message });
    } finally {
      this.busy = false;
      this.abort = null;
      for (const [id, resolve] of this.pending) {
        resolve({ allow: false, note: "Bị ngắt." });
        this.pending.delete(id);
      }
      if (ranTurn || turn.chatId === this.chatId) await this.persistChat(turn, ranTurn && (interrupted || failed)); // lệnh như /branch đã đổi cuộc trò chuyện thì không ghi đè bản cũ
      // tổng kết lượt (tab Code): các tệp đã đổi + đã chạy kiểm tra chưa
      if (ranTurn && turn.session === this.session && (this.o.profile ?? "code") === "code") {
        const sm = await this.session.turnSummary().catch(() => null);
        if (sm) this.fire({ type: "summary", ...sm });
      }
      // tab Work: trích dẫn [[tệp|vị trí]] không có thật trong tài liệu thì cảnh báo ngay
      if (ranTurn && !interrupted && final && turn.session === this.session && (this.o.profile ?? "code") === "work") {
        const c = await badCitations(this.session.ctx, final).catch(() => null);
        if (c?.bad.length) this.fire({ type: "notice", level: "warn", text: `⚠ ${c.bad.length}/${c.checked} trích dẫn không khớp tài liệu: ${c.bad.slice(0, 3).join("; ")}` });
      }
      this.fire({ type: "turn_end", interrupted, final });
      // tin nhắn xếp hàng mà lượt vừa rồi chưa kịp nhận: dừng thì bỏ, xong bình thường thì gửi tiếp như lượt mới
      const rest = turn.session.queue.splice(0);
      if (rest.length && !interrupted && turn.session === this.session) void this.send(rest.join("\n\n"));
    }
  }

  /**
   * Chuẩn bị khởi động lại ứng dụng (cập nhật): nếu agent đang làm việc thì dừng gọn, đợi lưu hội thoại, trả vị trí để làm tiếp sau khi mở lại.
   * Không có việc đang dở (hoặc chưa lưu được) thì trả null.
   */
  async suspendForRestart(): Promise<{ projectId: string; chatId: string } | null> {
    if (!this.busy) return null;
    const at = { projectId: this.projectId, chatId: this.chatId };
    this.interrupt();
    for (let i = 0; i < 100 && this.busy; i++) await new Promise((r) => setTimeout(r, 100));
    if (!at.projectId || !at.chatId || !this.o.chats) return null;
    return (await this.o.chats.load(at.projectId, at.chatId)) ? at : null;
  }

  /** Sau khi mở lại: báo giao diện mở đúng cuộc trò chuyện đã dừng và gửi tin nối tiếp (mở dự án đó trước nếu đang ở dự án khác). */
  async resumeAfterRestart(at: { projectId: string; chatId: string }, text: string): Promise<boolean> {
    if (this.busy || !this.o.chats || !ID_RE.test(at.projectId) || !ID_RE.test(at.chatId)) return false;
    if (!(await this.o.chats.load(at.projectId, at.chatId))) return false;
    if (this.projectId !== at.projectId) await this.projectOpen(at.projectId);
    this.fire({ type: "resume", chatId: at.chatId, text: String(text).slice(0, 500) });
    return true;
  }

  /** Lưu cuộc trò chuyện sau mỗi lượt (dùng giá trị chụp lúc bắt đầu lượt, phòng khi người dùng đã chuyển dự án). */
  private async persistChat(t: { projectId: string; chatId: string; session: Session }, unfinished = false): Promise<void> {
    const store = this.o.chats;
    if (!store || !t.projectId) return;
    const msgs = t.session.main.messages;
    const old = t.session.main.archived;
    const all = old.length ? [...old, ...msgs] : msgs;
    const turns = countTurns(all);
    if (!turns) return;
    try {
      await store.save(t.projectId, { id: t.chatId, title: this.keptTitles.get(t.chatId) ?? chatTitle(all) + (this.branches.has(t.chatId) ? " (nhánh)" : ""), updated: Date.now(), turns, ...(unfinished ? { unfinished: true } : {}), messages: trimForSave(msgs), inputs: t.chatId === this.chatId ? [...this.rawInputs] : undefined, ...(old.length ? { archived: archiveForSave(old) } : {}) });
    } catch {
      /* không lưu được lịch sử (đầy bộ nhớ…): bỏ qua, không ảnh hưởng công việc */
    }
  }

  interrupt(): void {
    this.diag?.onInterrupt();
    this.abort?.abort();
    for (const [id, resolve] of this.pending) {
      resolve({ allow: false, note: "Người dùng đã dừng." });
      this.pending.delete(id);
    }
  }

  respondPermission(id: string, res: PermissionResponse): void {
    const r = this.pending.get(id);
    if (r) {
      this.pending.delete(id);
      r(res);
    }
  }

  async setMode(mode: Mode): Promise<void> {
    try {
      this.session.setMode(mode);
    } catch (e) {
      this.fire({ type: "notice", level: "warn", text: (e as Error).message });
    }
  }

  /** `/usage`: token của phiên này và hạn mức hôm nay. */
  private usageCommand(): void {
    const q = this.quota;
    const quota = !q ? "" : q.state === "unlimited" || !q.limit ? "\nHạn mức hôm nay: không giới hạn" : `\nHạn mức hôm nay: ${q.used}/${q.limit} token (${q.pct ?? Math.round((100 * q.used) / q.limit)}%), làm mới lúc ${new Date(q.resetAt * 1000).toLocaleString("vi-VN")}`;
    this.fire({ type: "notice", level: "info", text: this.session.usageReport() + quota });
  }

  /** `/branch`: tách nhánh: sao chép hội thoại hiện tại sang một cuộc trò chuyện mới để thử hướng khác; bản gốc vẫn nằm trong Lịch sử. */
  private async branchCommand(): Promise<void> {
    const note = (text: string, level: "info" | "warn" = "info") => this.fire({ type: "notice", level, text });
    if (!countTurns(this.session.main.messages)) return note("Chưa có gì để tách nhánh: hãy trò chuyện với agent trước.", "warn");
    if (!this.o.chats) return note("Bản này không lưu lịch sử trò chuyện nên chưa tách nhánh được.", "warn");
    this.chatId = newId();
    this.branches.add(this.chatId);
    await this.persistChat({ projectId: this.projectId, chatId: this.chatId, session: this.session });
    note("Đã tách nhánh: từ đây bạn làm tiếp trên bản sao, bản gốc vẫn ở Lịch sử. Hội thoại được sao chép; tệp trong thư mục làm việc vẫn dùng chung (dùng /rewind hoặc Git nếu cần quay lại).");
  }

  /** `/effort`: bật/tắt suy luận sâu (mô hình “nghĩ” trước khi trả lời: kỹ hơn nhưng chậm hơn). */
  private async effortCommand(arg?: string): Promise<void> {
    const note = (text: string, level: "info" | "warn" = "info") => this.fire({ type: "notice", level, text });
    if (arg === undefined) return note(`Suy luận sâu: ${this.settings.thinking ? "bật (high)" : "tắt (low)"}. Dùng /effort high hoặc /effort low. Thêm “ultrathink” vào một prompt để chỉ bật cho lượt đó.`);
    const on = ["high", "max", "on", "bat", "bật"].includes(arg);
    if (!on && !["low", "medium", "off", "tat", "tắt"].includes(arg)) return note("Dùng: /effort high (suy luận sâu) hoặc /effort low.", "warn");
    await this.saveSettings({ thinking: on });
    note(on ? "Đã bật suy luận sâu: trả lời kỹ hơn nhưng chậm hơn." : "Đã tắt suy luận sâu.");
  }

  /** `/model`: liệt kê mô hình trên máy chủ; `/model <tên|số>` để chọn. */
  private async modelCommand(arg?: string): Promise<void> {
    const note = (text: string, level: "info" | "warn" | "error" = "info") => this.fire({ type: "notice", level, text });
    let models: string[];
    try {
      models = await this.llm.models(this.abort?.signal);
    } catch (e) {
      return note("Không lấy được danh sách mô hình: " + (e as Error).message, "error");
    }
    if (!arg) return note("Mô hình hiện tại: " + this.settings.model + "\nCó trên máy chủ:\n" + models.map((m, i) => `${i + 1}. ${m}${m === this.settings.model ? "  ← đang dùng" : ""}`).join("\n") + "\nChọn: /model <tên hoặc số>");
    const pick = /^\d+$/.test(arg) ? models[+arg - 1] : models.find((m) => m === arg);
    if (!pick) return note(`Không có mô hình "${arg}". Gõ /model để xem danh sách.`, "warn");
    await this.saveSettings({ model: pick });
    note("Đã chuyển sang mô hình " + pick + ".");
  }

  // ---------------------------------------------------------------- học tập
  private learnOnly<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    return fn().catch((e: Error) => ({ error: e.message }));
  }
  async learnLessons() {
    return learning.listLessons();
  }
  async learnExercises() {
    return learning.listExercises(this.o.env, this.session.ctx.root);
  }
  async learnExercise(id: string) {
    const ex = learning.getExercise(id);
    if (!ex) return { error: "Không có bài tập " + id };
    return { id: ex.id, title: ex.title, goal: ex.goal, instructions: ex.instructions, lang: ex.lang, level: ex.level, minutes: ex.minutes, concepts: ex.concepts, hintCount: ex.hints.length };
  }
  async learnStart(id: string) {
    return this.learnOnly(async () => {
      const r = await learning.startExercise(this.o.env, this.session.ctx.root, id);
      this.fire({ type: "files_changed", paths: r.created });
      return r;
    });
  }
  async learnHint(id: string, n: number) {
    return this.learnOnly(async () => learning.exerciseHint(id, n));
  }
  async learnGrade(id: string) {
    return this.learnOnly(() => learning.gradeExercise(this.o.env, this.session.ctx.root, id));
  }
  async learnTemplates() {
    return learning.listTemplates();
  }
  async learnCreate(id: string) {
    return this.learnOnly(async () => {
      const r = await learning.createFromTemplate(this.o.env, this.session.ctx.root, id);
      this.fire({ type: "files_changed", paths: [r.dir] });
      return r;
    });
  }

  /** Gợi ý cho `@`: tệp và thư mục (thư mục có dấu `/` ở cuối); bỏ qua tệp nhạy cảm và thư mục sinh ra như node_modules. */
  async searchFiles(query: string): Promise<string[]> {
    const q = query.toLowerCase();
    const files: string[] = [];
    const dirs = new Set<string>();
    let seen = 0;
    for await (const f of walk(this.session.ctx, this.session.ctx.root)) {
      if (++seen > 5000) break;
      const rel = relPath(this.session.ctx, f);
      files.push(rel);
      for (let i = rel.indexOf("/"); i >= 0; i = rel.indexOf("/", i + 1)) dirs.add(rel.slice(0, i + 1));
    }
    if (!q) {
      // chưa gõ gì: các mục ở thư mục gốc (thư mục trước)
      const top = [...dirs].filter((d) => d.indexOf("/") === d.length - 1).sort();
      return [...top, ...files.filter((f) => !f.includes("/")).sort()].slice(0, 40);
    }
    const hit = (p: string) => p.toLowerCase().includes(q);
    const rank = (p: string) => (p.replace(/\/$/, "").split("/").pop() ?? "").toLowerCase().startsWith(q) ? 0 : 1;
    return [...dirs, ...files].filter(hit).sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, 40);
  }

  // ---------------------------------------------------------------- thay đổi, quay lại, mô hình, chạy thử
  async changesList(): Promise<ChangeFile[]> {
    return listChanges(this.session.ctx);
  }

  async changeDiff(path: string): Promise<ChangeDiff | { error: string }> {
    return (await changeDiff(this.session.ctx, path)) ?? { error: "Tệp này không còn thay đổi." };
  }

  async changesRevert(path?: string): Promise<RevertResult | { error: string }> {
    if (this.busy) return { error: "Agent đang làm việc, hãy chờ hoặc bấm Dừng." };
    const r = await revertChanges(this.session.ctx, path === undefined ? {} : { rel: path });
    if (r.reverted.length) this.fire({ type: "files_changed", paths: r.reverted });
    return r;
  }

  async rewindPoints(): Promise<RewindPoint[]> {
    return this.session.rewindPoints(this.rawInputs).map((p) => p.point);
  }

  /** /rewind: về trước yêu cầu thứ `index` — cắt hội thoại, và (nếu `files`) khôi phục các tệp agent đã đổi từ đó. */
  async rewind(index: number, files: boolean): Promise<{ history: HistoryItem[]; reverted: string[]; skipped: string[]; text: string } | { error: string }> {
    if (this.busy) return { error: "Agent đang làm việc, hãy chờ hoặc bấm Dừng." };
    const pts = this.session.rewindPoints(this.rawInputs);
    const p = pts[index];
    if (!p) return { error: "Không còn điểm này." };
    const aligned = this.rawInputs.length === pts.length;
    const r = await this.session.rewindTo(p.msgIndex, p.turn, files);
    this.rawInputs = aligned ? this.rawInputs.slice(0, index) : [];
    this.todos = [];
    this.fire({ type: "todos", todos: [] });
    const msgs = this.session.main.messages;
    const store = this.o.chats;
    if (store && this.projectId) {
      try {
        const old = this.session.main.archived;
        const all = old.length ? [...old, ...msgs] : msgs;
        if (countTurns(all)) await store.save(this.projectId, { id: this.chatId, title: chatTitle(all), updated: Date.now(), turns: countTurns(all), messages: trimForSave(msgs), inputs: aligned ? [...this.rawInputs] : undefined, ...(old.length ? { archived: archiveForSave(old) } : {}) });
        else await store.remove(this.projectId, this.chatId);
      } catch {
        /* không lưu được: bỏ qua */
      }
    }
    return { history: messagesToHistory(msgs, aligned ? this.rawInputs : undefined), ...r, text: p.point.text };
  }

  async runSuggestions(): Promise<RunSuggestion[]> {
    return detectRun(this.o.env, this.session.ctx.root);
  }

  async startBackground(command: string): Promise<{ id: string; url?: string; alive: boolean; code?: number } | { error: string }> {
    const procs = this.session.ctx.procs;
    if (!procs) return { error: "Nơi chạy này không hỗ trợ chạy nền." };
    // chỉ chạy lệnh do chính ứng dụng gợi ý (nút ▶): giao diện không nhờ chạy lệnh tuỳ ý qua đường này
    const ok = (await this.runSuggestions()).some((s) => s.background && s.command === command);
    if (!ok) return { error: "Lệnh này không nằm trong danh sách gợi ý chạy của dự án." };
    try {
      const info = procs.start(command, this.session.ctx.root);
      await procs.settle(info.id, 8000);
      const p = procs.get(info.id)!;
      return { id: info.id, url: p.info.url, alive: p.info.alive, code: p.info.code };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async stopProcess(id: string): Promise<void> {
    this.session.ctx.procs?.stop(id);
  }

  async openUrl(url: string): Promise<void> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) || !/^https?:$/.test(u.protocol)) return; // chỉ xem trước máy cục bộ
    await this.o.openUrl?.(u.href);
  }

  /** Dừng mọi thứ đang chạy (gọi khi đóng ứng dụng hoặc thay thế bộ điều khiển). */
  dispose(): void {
    if (this.tasksTimer) clearInterval(this.tasksTimer);
    this.tasksTimer = undefined;
    this.taskAbort?.abort("stop");
    this.interrupt();
    this.session.dispose();
    this.procs?.stopAll();
    this.procs = undefined;
  }

  async newSession(): Promise<void> {
    this.interrupt();
    this.session.dispose();
    this.todos = [];
    await this.loadProject();
    await this.replaceSession(true);
    this.pendingNotices.push(...this.session.startupNotices);
    this.chatId = newId();
    this.rawInputs = [];
    this.fire({ type: "reset" });
  }

  /**
   * Thay phiên bằng phiên mới (đọc lại cấu hình). `keepMode`: giữ chế độ quyền người dùng vừa chọn (cùng dự án) thay vì quay về mặc định.
   * Luôn báo chế độ thật cho giao diện: đã gặp nhãn vẫn ghi "Toàn quyền" trong khi phiên mới ở chế độ mặc định và cứ hỏi từng lệnh.
   */
  private async replaceSession(keepMode: boolean): Promise<void> {
    const prev = keepMode ? this.session.mode : undefined;
    this.session = await this.makeSession();
    if (prev && prev !== this.session.mode) {
      try {
        this.session.setMode(prev);
      } catch {
        /* tab/chính sách không cho chế độ đó: giữ mặc định */
      }
    }
    this.fire({ type: "mode", mode: this.session.mode });
  }

  /** Tạo lại phiên (đọc lại AGENTS.md, cấu hình dự án…) nhưng giữ nguyên hội thoại đang có. */
  private async rebuildSession(): Promise<void> {
    const { messages, archived } = this.session.main;
    this.session.dispose();
    await this.loadProject();
    await this.replaceSession(true);
    this.pendingNotices.push(...this.session.startupNotices);
    this.session.main.messages = messages;
    this.session.main.archived = archived;
  }

  // ---------------------------------------------------------------- dự án
  private requireHost(): ProjectHost {
    if (!this.o.projects) throw new Error("Tab này không có chức năng dự án.");
    return this.o.projects;
  }

  /** Chuyển sang một thư mục khác: dừng việc đang chạy, mở phiên mới ở thư mục đó. */
  private async attach(env: Env, projectId: string, name: string): Promise<void> {
    this.interrupt();
    this.procs?.stopAll(); // đổi dự án trong CÙNG bộ điều khiển (không dùng nhiều dự án): dừng tiến trình của dự án cũ
    this.procs = undefined;
    this.session.dispose();
    this.o.env = env;
    this.projectId = projectId;
    this.projectName = name;
    this.trusted = await this.o.trust.isTrusted(env.root);
    this.todos = [];
    await this.loadProject();
    await this.replaceSession(false);
    this.pendingNotices.push(...this.session.startupNotices);
    this.chatId = newId();
    this.rawInputs = [];
    this.fire({ type: "reset" });
  }

  async projectsState(): Promise<ProjectsState> {
    const st = await this.requireHost().list();
    const active = this.projectId || st.active;
    // trạng thái từng dự án: đang chạy (chỉ dự án đang mở, vì chuyển dự án thì dừng việc đang làm) và số cuộc trò chuyện còn dở
    const projects = await Promise.all(
      st.projects.map(async (p) => {
        const unfinished = this.o.chats ? (await this.o.chats.list(p.id).catch(() => [])).filter((c) => c.unfinished && !(this.busy && p.id === active && c.id === this.chatId)).length : 0;
        return { ...p, ...(this.busy && p.id === active ? { running: true } : {}), ...(unfinished ? { unfinished } : {}) };
      }),
    );
    return { ...st, projects, active };
  }

  async projectOpen(id: string): Promise<void> {
    if (!ID_RE.test(id) || id === this.projectId) return;
    const host = this.requireHost();
    const env = await host.open(id);
    const info = (await host.list()).projects.find((p) => p.id === id);
    await this.attach(env, id, info?.name ?? "");
  }

  async projectCreate(spec: { name: string; instructions?: string }): Promise<{ ok: true } | { error: string }> {
    const name = cleanProjectName(spec.name ?? "");
    if (!name) return { error: "Hãy đặt tên cho dự án." };
    try {
      const { info, env } = await this.requireHost().create({ name });
      const text = (spec.instructions ?? "").trim();
      if (text) await env.writeText(join(env.root, "AGENTS.md"), text.slice(0, 20000) + "\n");
      await this.attach(env, info.id, info.name);
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async projectPick(): Promise<{ ok: boolean } | { error: string }> {
    const host = this.requireHost();
    if (!host.pick) return { error: "Bản này không chọn được thư mục trên máy." };
    try {
      const r = await host.pick();
      if (!r) return { ok: false };
      await this.attach(r.env, r.info.id, r.info.name);
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async projectRemove(id: string): Promise<{ ok: true } | { error: string }> {
    if (!ID_RE.test(id)) return { error: "Mã dự án không hợp lệ." };
    const host = this.requireHost();
    const st = await host.list();
    if (st.projects.length <= 1) return { error: "Phải còn ít nhất một dự án." };
    const wasActive = id === (this.projectId || st.active);
    await host.remove(id);
    for (const c of await (this.o.chats?.list(id) ?? Promise.resolve([] as ChatMeta[]))) await this.o.chats?.remove(id, c.id);
    if (wasActive) {
      const next = (await host.list()).projects[0];
      await this.attach(await host.open(next.id), next.id, next.name);
    }
    return { ok: true };
  }

  async projectRename(id: string, name: string): Promise<void> {
    const n = cleanProjectName(name);
    if (!n || !ID_RE.test(id)) return;
    await this.requireHost().rename(id, n);
    if (id === this.projectId) this.projectName = n;
  }

  /** Hướng dẫn dự án = AGENTS.md ở gốc dự án (cơ chế sẵn có; Codex/Cursor/Claude Code cũng đọc được). */
  async instructionsGet(): Promise<string> {
    try {
      return new TextDecoder().decode(await this.o.env.readBytes(join(this.session.ctx.root, "AGENTS.md")));
    } catch {
      return "";
    }
  }

  async instructionsSet(text: string): Promise<void> {
    const p = join(this.session.ctx.root, "AGENTS.md");
    const t = text.slice(0, 20000);
    if (t.trim()) await this.o.env.writeText(p, t.endsWith("\n") ? t : t + "\n");
    else if (await this.o.env.stat(p)) await this.o.env.remove(p);
    await this.rebuildSession();
    this.fire({ type: "files_changed", paths: ["AGENTS.md"] });
    this.fire({ type: "notice", level: "info", text: t.trim() ? "Đã lưu hướng dẫn dự án (AGENTS.md). Agent sẽ làm theo từ lượt hỏi tiếp theo." : "Đã xoá hướng dẫn dự án." });
  }

  // ---------------------------------------------------------------- tab Work: xem tài liệu, quy trình của tôi
  /** Nội dung xem trước (chỉ đọc) của một tài liệu, đánh dấu vị trí trích dẫn `loc`. */
  async docView(path: string, loc?: string): Promise<DocView | { error: string }> {
    return docViewOf(this.session.ctx, path, loc);
  }

  async procedureList(): Promise<Procedure[]> {
    return listProcedures(this.o.env, this.session.ctx.root);
  }

  /** Lưu việc vừa làm xong thành lệnh /tên trong dự án (.neuagent/commands). */
  async procedureSave(name: string, description?: string): Promise<{ ok: true; name: string } | { error: string }> {
    const g = this.lastGood;
    if (!g || g.chatId !== this.chatId || g.projectId !== this.projectId) return { error: "Chưa có việc nào vừa xong để lưu." };
    const r = await saveProcedure(this.o.env, this.session.ctx.root, { name, description, request: g.prompt, tools: g.tools }, this.session.slashCommands().map((c) => c.name));
    if ("error" in r) return r;
    await this.rebuildSession();
    this.fire({ type: "files_changed", paths: [`.neuagent/commands/${r.name}.md`] });
    return { ok: true, name: r.name };
  }

  async procedureRemove(name: string): Promise<void> {
    if (await removeProcedure(this.o.env, this.session.ctx.root, name)) {
      await this.rebuildSession();
      this.fire({ type: "files_changed", paths: [`.neuagent/commands/${name}.md`] });
    }
  }

  // ---------------------------------------------------------------- lịch sử trò chuyện
  async chatList(): Promise<ChatMeta[]> {
    if (!this.o.chats || !this.projectId) return [];
    const list = (await this.o.chats.list(this.projectId)).sort((a, b) => b.updated - a.updated);
    if (!this.busy) return list;
    // đang làm việc: đánh dấu cuộc trò chuyện hiện tại (chưa lưu nếu mới) để giao diện hiện biểu tượng "đang chạy"
    const cur = list.find((c) => c.id === this.chatId);
    if (cur) cur.running = true;
    else list.unshift({ id: this.chatId, title: chatTitle(this.session.main.messages), updated: Date.now(), turns: countTurns(this.session.main.messages), running: true });
    return list;
  }

  async chatOpen(id: string): Promise<{ id: string; title: string; history: HistoryItem[] } | { error: string }> {
    if (!this.o.chats || !ID_RE.test(id)) return { error: "Không mở được cuộc trò chuyện." };
    const saved = await this.o.chats.load(this.projectId, id);
    if (!saved) return { error: "Cuộc trò chuyện đã bị xoá." };
    this.interrupt();
    this.session.dispose();
    this.todos = [];
    await this.loadProject();
    await this.replaceSession(true);
    this.session.main.messages = saved.messages;
    this.session.main.archived = saved.archived ?? [];
    this.chatId = saved.id;
    if (saved.title.endsWith(" (nhánh)")) this.branches.add(saved.id);
    if (saved.task) this.keptTitles.set(saved.id, saved.title); // lần chạy tự động: nhắn tiếp thì thành cuộc trò chuyện thường (không bị dọn), giữ tiêu đề
    this.rawInputs = saved.inputs && saved.inputs.length === countTurns(saved.messages) ? [...saved.inputs] : [];
    return { id: saved.id, title: saved.title, history: messagesToHistory(saved.messages, saved.inputs) };
  }

  async chatRemove(id: string): Promise<void> {
    if (!this.o.chats || !ID_RE.test(id)) return;
    await this.o.chats.remove(this.projectId, id);
    if (id === this.chatId) await this.newSession();
  }

  // ---------------------------------------------------------------- thiết kế
  async exportDesign(path: string, format: "pdf" | "png", width: number, height?: number): Promise<{ saved: string } | { error: string }> {
    if (!this.o.renderDesign) return { error: "Bản này không xuất được PDF/PNG. Hãy dùng bản Desktop." };
    try {
      const p = await resolveSafe(this.session.ctx, path);
      if (!/\.(html?|svg)$/i.test(p)) return { error: "Chỉ xuất được tệp .html hoặc .svg." };
      let html = new TextDecoder().decode(await this.o.env.readBytes(p));
      if (/\.svg$/i.test(p)) html = `<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`;
      const w = Math.min(Math.max(Math.round(width) || 1280, 200), 4000);
      const h = height ? Math.min(Math.max(Math.round(height), 100), 20000) : undefined;
      const data = await this.o.renderDesign(html, { format, width: w, height: h });
      const dir = join(p, "..");
      const stem = basename(p).replace(/\.[^.]+$/, "");
      let name = `${stem}.${format}`;
      for (let n = 2; await this.o.env.stat(join(dir, name)); n++) name = `${stem} (${n}).${format}`;
      let target = join(dir, name);
      if (this.o.pickSavePath) {
        // hỏi người dùng lưu vào thư mục nào (hộp "Lưu thành…" của hệ điều hành; nó tự hỏi nếu trùng tên)
        // không chọn (đóng hộp thoại) thì xuất vào thư mục mặc định: cạnh tệp thiết kế
        const chosen = await this.o.pickSavePath({ defaultPath: target, format });
        if (chosen) target = chosen.toLowerCase().endsWith("." + format) ? chosen : `${chosen}.${format}`;
      }
      await this.o.env.writeBytes(target, data);
      const inside = isInside(this.session.ctx.root, target);
      const rel = inside ? relPath(this.session.ctx, target) : target;
      if (inside) this.fire({ type: "files_changed", paths: [rel] });
      return { saved: rel };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const p = await resolveSafe(this.session.ctx, path || ".");
    return (await this.o.env.readdir(p))
      .filter((e) => !(e.isDir && IGNORE_DIRS.has(e.name)) && e.name !== ".DS_Store")
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  async readFile(path: string): Promise<{ text: string; truncated: boolean; kind: "text" | "document" } | { error: string }> {
    try {
      const p = await resolveSafe(this.session.ctx, path);
      const data = await this.o.env.readBytes(p);
      if (isOfficeFile(p)) {
        const r = await readDocumentSections(data, extOf(p), {});
        const text = formatSections(r, 0, 60000);
        return { text, truncated: text.length >= 60000, kind: "document" };
      }
      if (data.subarray(0, 8000).includes(0)) return { error: "File nhị phân, không xem được. Dùng nút Tải xuống để lấy về." };
      const truncated = data.length > MAX_VIEW_BYTES;
      return { text: new TextDecoder().decode(truncated ? data.subarray(0, MAX_VIEW_BYTES) : data), truncated, kind: "text" };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /**
   * Người dùng sửa tệp chữ trong ứng dụng (hộp xem tệp → Sửa → Lưu). Chỉ tệp ĐÃ CÓ, trong dự án, là chữ và nhỏ hơn giới hạn xem (xem bị cắt thì
   * không cho sửa: lưu lại sẽ làm mất phần cuối). Giữ kiểu xuống dòng CRLF của tệp gốc.
   */
  async writeTextFile(path: string, text: string): Promise<{ ok: true } | { error: string }> {
    try {
      if (typeof text !== "string") return { error: "Nội dung không hợp lệ." };
      if (text.length > MAX_VIEW_BYTES) return { error: `Nội dung quá lớn để lưu tại đây (giới hạn ${Math.round(MAX_VIEW_BYTES / 1000)} KB).` };
      const p = await resolveSafe(this.session.ctx, path);
      const st = await this.o.env.stat(p);
      if (!st || st.isDir) return { error: "Chỉ sửa được tệp đã có." };
      if (isOfficeFile(p)) return { error: "Tệp Word/Excel/PowerPoint/PDF không sửa được ở đây: hãy mở bằng ứng dụng của nó." };
      const data = await this.o.env.readBytes(p);
      if (data.subarray(0, 8000).includes(0)) return { error: "Tệp nhị phân, không sửa được." };
      if (data.length > MAX_VIEW_BYTES) return { error: "Tệp quá lớn để sửa tại đây. Hãy dùng trình soạn thảo của bạn." };
      const crlf = new TextDecoder().decode(data).includes("\r\n");
      const out = crlf && !text.includes("\r") ? text.replace(/\n/g, "\r\n") : text;
      await this.o.env.writeText(p, out);
      this.fire({ type: "files_changed", paths: [relPath(this.session.ctx, p)] });
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async uploadFiles(files: { name: string; data: Uint8Array }[]): Promise<{ saved: string[]; errors: string[] }> {
    const saved: string[] = [];
    const errors: string[] = [];
    const root = this.session.ctx.root;
    for (const f of files) {
      const clean = safeFileName(f.name);
      if (!clean) {
        errors.push(`Tên tệp không hợp lệ: ${f.name}`);
        continue;
      }
      if (f.data.length > MAX_UPLOAD) {
        errors.push(`${clean}: quá lớn (${Math.round(f.data.length / 1048576)} MB, giới hạn ${MAX_UPLOAD / 1048576} MB)`);
        continue;
      }
      let name = clean;
      for (let n = 2; await this.o.env.stat(join(root, name)); n++) name = clean.replace(/(\.[^./]+)?$/, ` (${n})$1`);
      await this.o.env.writeBytes(join(root, name), f.data);
      saved.push(name);
    }
    if (saved.length) this.fire({ type: "files_changed", paths: saved });
    return { saved, errors };
  }

  /**
   * Ảnh dán (Ctrl+V, ảnh chụp màn hình…): lưu TẠM ngoài thư mục dự án để không làm lẫn tệp rác vào mã nguồn người dùng
   * (bị `git status` thấy, có thể lỡ commit). Tham chiếu trả về dạng `dan/<tên>`; agent đọc bằng read_image. Giữ tối đa 30 ảnh gần nhất.
   */
  async pasteImages(files: { name: string; data: Uint8Array }[]): Promise<{ refs: string[]; errors: string[]; dir?: string }> {
    const refs: string[] = [];
    const errors: string[] = [];
    // môi trường không có thư mục tạm (bản web): lưu vào thư mục riêng của ứng dụng trong dự án, không để lẫn vào mã nguồn
    const scratch = this.o.env.scratchDir;
    const inProject = !scratch;
    const dir = scratch ?? join(this.session.ctx.root, ".neuagent", "pasted");
    await this.o.env.mkdirp(dir);
    for (const f of files.slice(0, 5)) {
      const clean = safeFileName(f.name);
      if (!clean || !/\.(png|jpe?g|webp|gif)$/i.test(clean) || !sniffImage(f.data)) {
        errors.push(`Không phải ảnh png/jpg/webp/gif: ${f.name}`);
        continue;
      }
      if (f.data.length > 20 * 1024 * 1024) {
        errors.push(`${clean}: ảnh quá lớn (${Math.round(f.data.length / 1048576)} MB, tối đa 20 MB).`);
        continue;
      }
      let name = clean;
      for (let n = 2; await this.o.env.stat(join(dir, name)); n++) name = clean.replace(/(\.[^./]+)?$/, `-${n}$1`);
      await this.o.env.writeBytes(join(dir, name), f.data);
      refs.push(inProject ? ".neuagent/pasted/" + name : "dan/" + name);
    }
    // dọn: chỉ giữ 30 ảnh mới nhất
    try {
      const all = await Promise.all((await this.o.env.readdir(dir)).filter((e) => !e.isDir).map(async (e) => ({ n: e.name, m: (await this.o.env.stat(join(dir, e.name)))?.mtimeMs ?? 0 })));
      for (const old of all.sort((a, b) => b.m - a.m).slice(30)) await this.o.env.remove(join(dir, old.n)).catch(() => undefined);
    } catch {
      /* dọn không được thì thôi */
    }
    return { refs, errors, dir };
  }

  async downloadFile(path: string): Promise<{ name: string; data: Uint8Array } | { error: string }> {
    try {
      const p = await resolveSafe(this.session.ctx, path);
      const st = await this.o.env.stat(p);
      if (!st?.isFile) return { error: "Không phải tệp." };
      return { name: basename(p), data: await this.o.env.readBytes(p) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async exportZip(): Promise<{ name: string; data: Uint8Array }> {
    const mod = await import("jszip");
    const JSZip = (mod as unknown as { default: typeof import("jszip") }).default ?? (mod as unknown as typeof import("jszip"));
    const zip = new JSZip();
    const root = this.session.ctx.root;
    let count = 0;
    const walkDir = async (dir: string): Promise<void> => {
      for (const e of await this.o.env.readdir(dir)) {
        if (e.name === ".DS_Store" || e.name === "node_modules" || e.name === ".git") continue;
        const p = join(dir, e.name);
        if (e.isDir) await walkDir(p);
        else if (count++ < 5000) zip.file(relative(root, p), await this.o.env.readBytes(p));
      }
    };
    await walkDir(root);
    return { name: (basename(root) || "du-an") + ".zip", data: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }) };
  }

  async openExternally(path: string): Promise<void> {
    if (!this.o.openExternally) return;
    const p = await resolveSafe(this.session.ctx, path);
    await this.o.openExternally(p);
  }

  async resetWorkspace(): Promise<void> {
    if (!this.o.resetWorkspace) return;
    await this.o.resetWorkspace();
    await this.newSession();
  }

  async revealWorkspace(): Promise<void> {
    await this.o.revealWorkspace?.();
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    const { key, ...rest } = patch;
    delete (rest as Partial<Settings>).diagId;
    const p = this.o.policy;
    if (p?.baseUrl) delete (rest as Partial<Settings>).baseUrl; // bị chính sách khoá
    if (p?.allowInsecureHttp !== undefined) delete (rest as Partial<Settings>).allowInsecureHttp;
    // ảnh Docker không đổi được từ giao diện (chỉ tệp cài đặt/chính sách); chính sách bắt buộc container thì không tắt được
    delete (rest as Partial<Settings>).containerImage;
    if (p?.requireContainer) delete (rest as Partial<Settings>).container;
    const next = normalizeSettings({ ...this.settings, ...rest }, this.o.defaults);
    next.key = key === undefined ? this.settings.key : key || undefined;
    this.settings = next;
    // không ghi `mode` khi trùng mặc định sản phẩm: đổi mặc định ở bản sau mới có hiệu lực với người đã từng lưu cài đặt
    const persisted = { ...next } as Partial<Settings>;
    if (persisted.mode === this.o.defaults?.mode) delete persisted.mode;
    await this.o.store.save(persisted as Settings);
  }

  // ---------------------------------------------------------------- tác vụ định kỳ
  private get scope(): { profile: string; projectId: string } {
    return { profile: this.o.profile ?? "code", projectId: this.projectId };
  }
  private taskNow(): number {
    return (this.o.tasks?.now ?? Date.now)();
  }
  private async allTasks(): Promise<ScheduledTask[]> {
    await this.syncSettings();
    return this.settings.tasks ?? [];
  }
  /** Tác vụ của tab + dự án này (bản lưu). */
  private async myTasks(): Promise<ScheduledTask[]> {
    const { profile, projectId } = this.scope;
    return (await this.allTasks()).filter((t) => t.profile === profile && t.projectId === projectId);
  }
  private undoStore(): Map<string, RunUndo> {
    return this.o.tasks?.undo ?? this.ownUndo;
  }
  /** Tác vụ của tab + dự án đang mở, kèm lần chạy tới, đang chạy, hoàn tác được không. */
  async taskList(): Promise<TaskView[]> {
    const now = this.taskNow();
    const undo = this.undoStore();
    return (await this.myTasks()).map((t) => {
      const v: TaskView = { ...t };
      const next = nextRun(t, now);
      if (next !== undefined) v.next = next;
      if (this.runningTask === t.id) v.running = true;
      if (undo.get(t.id)?.projectId === this.projectId) v.canUndo = true;
      return v;
    });
  }
  /** Mọi tác vụ của tab này (mọi dự án): cho bộ lập lịch của multi.ts. */
  async tasksForProfile(): Promise<ScheduledTask[]> {
    const profile = this.scope.profile;
    return (await this.allTasks()).filter((t) => t.profile === profile);
  }
  /** Đọc lại cài đặt rồi sửa danh sách và lưu (nhiều bộ điều khiển dự án dùng chung một tệp cài đặt). */
  private async changeTasks(fn: (all: ScheduledTask[]) => ScheduledTask[]): Promise<void> {
    await this.saveSettings({ tasks: fn(await this.allTasks()) });
  }

  async taskAdd(spec: { name: string; prompt: string; every: Every }): Promise<{ ok: true; id: string } | { error: string }> {
    const all = await this.allTasks();
    const mine = all.filter((t) => t.profile === this.scope.profile && t.projectId === this.scope.projectId);
    if (mine.length >= MAX_TASKS) return { error: `Mỗi dự án có tối đa ${MAX_TASKS} tác vụ định kỳ.` };
    const t = newTask(spec ?? {}, this.scope, this.taskNow());
    if (typeof t === "string") return { error: t };
    await this.saveSettings({ tasks: [...all, t] });
    return { ok: true, id: t.id };
  }

  async taskSet(id: string, enabled: boolean): Promise<void> {
    await this.changeTasks((all) => all.map((t) => (t.id === id && this.isMine(t) ? { ...t, enabled: !!enabled } : t)));
  }

  async taskRemove(id: string): Promise<void> {
    if (this.runningTask === id) this.taskAbort?.abort("stop");
    await this.changeTasks((all) => all.filter((t) => !(t.id === id && this.isMine(t))));
    if (this.undoStore().get(id)?.projectId === this.projectId) this.undoStore().delete(id);
  }

  /** Bỏ mọi tác vụ của một dự án (dự án bị bỏ khỏi danh sách). */
  async tasksDropProject(projectId: string): Promise<void> {
    const profile = this.scope.profile;
    if ((await this.allTasks()).some((t) => t.profile === profile && t.projectId === projectId)) await this.changeTasks((all) => all.filter((t) => !(t.profile === profile && t.projectId === projectId)));
  }

  private isMine(t: ScheduledTask): boolean {
    return t.profile === this.scope.profile && t.projectId === this.scope.projectId;
  }

  async taskStop(): Promise<void> {
    this.taskAbort?.abort("stop");
  }

  async taskNotify(on?: boolean): Promise<boolean> {
    if (typeof on === "boolean") await this.saveSettings({ taskNotify: on });
    else await this.syncSettings();
    return this.settings.taskNotify !== false;
  }

  /** Bộ hẹn giờ gọi mỗi ~30 giây: chạy tối đa MỘT tác vụ đến hạn, và chỉ khi agent đang rảnh (không giẫm lên việc người dùng đang làm). */
  async tasksTick(): Promise<void> {
    if (this.taskAbort || this.busy) return;
    if (this.o.tasks?.canRun && !this.o.tasks.canRun()) return;
    const now = this.taskNow();
    for (const t of await this.myTasks()) {
      const due = dueState(t, now);
      if (due === "missed") await this.taskMarkMissed(t.id);
      else if (due === "run") {
        await this.taskRun(t.id, false);
        return;
      }
    }
  }

  /** Ghi "bỏ lỡ giờ hẹn" (ứng dụng đóng quá lâu qua giờ hẹn): không chạy bù. */
  async taskMarkMissed(id: string): Promise<void> {
    await this.recordTask(id, this.taskNow(), { status: "skipped", summary: "Bỏ lỡ giờ hẹn (ứng dụng đang đóng)." }, false);
  }

  /** Bộ lập lịch (multi.ts) gọi khi tác vụ `id` của dự án này đến hạn. "busy" = agent đang bận, thử lại lượt sau. */
  async taskRunScheduled(id: string): Promise<"ran" | "busy" | "none"> {
    if (this.taskAbort || this.busy) return "busy";
    const t = (await this.myTasks()).find((x) => x.id === id);
    if (!t || dueState(t, this.taskNow()) !== "run") return "none";
    await this.taskRun(id, false);
    return "ran";
  }

  /** Hạn mức đã biết (bộ điều khiển chỉ mở cho tác vụ lấy của dự án đang mở, khỏi hỏi lại máy chủ). */
  quotaInfo(): QuotaInfo | null {
    return this.quota;
  }
  adoptQuota(q: QuotaInfo | null): void {
    if (q && !this.quota) this.quota = q;
  }

  private async recordTask(id: string, now: number, run: Omit<TaskRun, "at">, counts: boolean): Promise<void> {
    await this.changeTasks((all) => all.map((t) => (t.id === id ? withRun(t, now, run, counts) : t)));
  }

  /** Chạy ngay một tác vụ (người dùng bấm hoặc đến hạn). */
  async taskRunNow(id: string): Promise<{ status: "ok" | "error" | "skipped"; summary: string } | { error: string }> {
    if (this.busy) return { error: "Agent đang làm việc, hãy chờ hoặc bấm Dừng." };
    if (this.taskAbort) return { error: "Đang có một tác vụ định kỳ chạy." };
    return this.taskRun(id, true);
  }

  /**
   * Chạy tác vụ trong MỘT PHIÊN RIÊNG, không có người ngồi trước. Quyền chặt hơn phiên thường:
   *  - chế độ acceptEdits (hoặc default nếu chính sách không cho): chỉ sửa tệp trong dự án; lệnh shell, mạng, tệp nhạy cảm, tệp cấu hình dự án luôn cần hỏi;
   *  - không ai trả lời nên MỌI yêu cầu hỏi bị từ chối (agent được báo để bỏ qua); không dùng quy tắc "luôn cho phép" đã lưu, không nạp cấu hình/hook/MCP của dự án;
   *  - bỏ qua nếu hết hạn mức token, tab không được dùng, quá số lần mỗi ngày; cắt sau RUN_TIMEOUT_MS. Không ghi chẩn đoán.
   * Lần chạy được lưu thành một cuộc trò chuyện "⏰ tên" trong lịch sử dự án (giữ có giới hạn) và giữ nhật ký hoàn tác trong bộ nhớ.
   */
  private async taskRun(id: string, manual: boolean): Promise<{ status: "ok" | "error" | "skipped"; summary: string } | { error: string }> {
    const task = (await this.myTasks()).find((t) => t.id === id);
    if (!task) return { error: "Không còn tác vụ này." };
    const now = this.taskNow();
    const done = (status: "ok" | "error" | "skipped"): void =>
      this.fire({ type: "task_done", taskId: task.id, projectId: this.projectId, name: task.name, status, notify: !manual && status !== "skipped" && this.settings.taskNotify !== false });
    const skip = async (summary: string) => {
      await this.recordTask(id, now, { status: "skipped", summary }, false);
      done("skipped");
      return { status: "skipped" as const, summary };
    };
    if (runsToday(task, now) >= MAX_RUNS_PER_DAY) return skip(`Đã chạy ${MAX_RUNS_PER_DAY} lần hôm nay (giới hạn mỗi ngày).`);
    if (this.quota && (this.quota.state === "exceeded" || this.quota.state === "grace")) return skip("Hết hạn mức token hôm nay.");
    if (this.tabDenied()) return skip(`Nhóm của bạn không được dùng tab ${PROFILES[this.o.profile ?? "code"].label}.`);
    const denied: string[] = [];
    let deniedCount = 0;
    const settings = (): Settings => ({ ...this.settings, mode: "acceptEdits", permissions: { allow: [], deny: this.settings.permissions.deny } });
    const abort = new AbortController();
    this.taskAbort = abort;
    this.runningTask = id;
    const timer = setTimeout(() => abort.abort("timeout"), RUN_TIMEOUT_MS);
    let run: { status: "ok" | "error"; summary: string };
    let sess: Session | undefined;
    try {
      await this.syncSettings();
      sess = await this.makeSession({
        getSettings: settings,
        emit: () => undefined,
        trustProject: false,
        project: { deny: this.project.deny, allow: [] },
        procs: undefined,
        askPermission: async (req) => {
          deniedCount++;
          if (denied.length < 20) denied.push(req.tool);
          return { allow: false, note: "Tác vụ định kỳ chạy không có người duyệt: thao tác này bị từ chối. Bỏ qua nó và nêu trong báo cáo." };
        },
      });
      try {
        sess.setMode("acceptEdits");
      } catch {
        sess.setMode("default"); // chính sách không cho acceptEdits: càng chặt càng tốt
      }
      const guard = "[Tác vụ định kỳ, chạy tự động: không có người trả lời. Đừng hỏi lại. Thao tác bị từ chối thì bỏ qua và nói rõ trong báo cáo. Kết thúc bằng báo cáo ngắn gọn.]\n\n";
      const final = await sess.main.runTurn(guard + task.prompt, abort.signal);
      const skipped = denied.length ? ` (${deniedCount} thao tác bị từ chối vì không có người duyệt: ${[...new Set(denied)].join(", ")})` : "";
      run = { status: "ok", summary: (final.trim() || "(không có báo cáo)").slice(0, 600) + skipped };
    } catch (e) {
      const m = abort.signal.aborted ? (abort.signal.reason === "timeout" ? "Chạy quá lâu, đã cắt." : "Bị dừng.") : (e as Error).message;
      run = { status: "error", summary: m.slice(0, 300) };
    } finally {
      clearTimeout(timer);
      sess?.dispose();
      this.taskAbort = null;
      this.runningTask = null;
    }
    const changed = sess ? await this.keepRunUndo(task.id, sess).catch(() => [] as string[]) : [];
    const chatId = sess ? await this.saveTaskChat(task, sess) : undefined;
    await this.recordTask(id, this.taskNow(), { ...run, ...(deniedCount ? { denied: deniedCount } : {}), ...(chatId ? { chatId } : {}) }, true);
    if (changed.length) this.fire({ type: "files_changed", paths: changed });
    if (!manual) this.fire({ type: "notice", level: run.status === "ok" ? "info" : "warn", text: `Tác vụ định kỳ “${task.name}”: ${run.status === "ok" ? "đã chạy xong" : "lỗi"}. Xem ở nút ⏰.` });
    done(run.status);
    return run;
  }

  /** Giữ nhật ký hoàn tác của lần chạy (thay lần trước của cùng tác vụ). Trả về các tệp đã đổi (đường dẫn tương đối). */
  private async keepRunUndo(taskId: string, sess: Session): Promise<string[]> {
    const ctx = sess.ctx;
    const store = this.undoStore();
    store.delete(taskId);
    const entries = ctx.undoStack.filter((e) => isInside(ctx.root, e.path));
    if (!entries.length) return [];
    const paths = [...new Set(entries.map((e) => e.path))];
    const bytes = entries.reduce((n, e) => n + (e.old === null ? 0 : typeof e.old === "string" ? e.old.length * 2 : e.old.length), 0);
    if (bytes <= MAX_UNDO_BYTES) {
      const after = new Map<string, { size: number; mtimeMs: number } | null>();
      for (const p of paths) {
        const st = await ctx.env.stat(p).catch(() => null);
        after.set(p, st?.isFile ? { size: st.size, mtimeMs: st.mtimeMs } : null);
      }
      store.set(taskId, { projectId: this.projectId, entries, after });
    }
    return paths.map((p) => relPath(ctx, p));
  }

  /**
   * "Hoàn tác lần chạy": đưa các tệp lần chạy gần nhất của tác vụ đã đổi về như trước. Tệp đã bị sửa lại sau lần chạy (người dùng hoặc agent)
   * thì giữ nguyên và báo trong `skipped`; tệp nhạy cảm/ngoài dự án không đụng tới (revertChanges kiểm tra lại từng đường dẫn).
   */
  async taskUndo(id: string): Promise<RevertResult | { error: string }> {
    const store = this.undoStore();
    const u = store.get(id);
    if (!u || u.projectId !== this.projectId) return { error: "Không còn gì để hoàn tác cho lần chạy này." };
    if (this.busy || this.taskAbort) return { error: "Agent đang làm việc, hãy chờ hoặc bấm Dừng." };
    const ctx = this.session.ctx;
    const keep: UndoEntry[] = [];
    const later: string[] = [];
    for (const [p, a] of u.after) {
      const st = await ctx.env.stat(p).catch(() => null);
      const same = a === null ? !st : !!st?.isFile && st.size === a.size && st.mtimeMs === a.mtimeMs;
      if (same) keep.push(...u.entries.filter((e) => e.path === p));
      else later.push(relPath(ctx, p));
    }
    const r = await revertChanges({ ...ctx, undoStack: keep, readFiles: new Map() });
    store.delete(id);
    if (r.reverted.length) this.fire({ type: "files_changed", paths: r.reverted });
    return { reverted: r.reverted, skipped: [...r.skipped, ...later] };
  }

  /** Lưu lần chạy thành cuộc trò chuyện "⏰ tên" trong lịch sử dự án; dọn bớt lần cũ (MAX_TASK_CHATS mỗi tác vụ, MAX_TASK_CHATS_PER_PROJECT cả dự án). */
  private async saveTaskChat(task: ScheduledTask, sess: Session): Promise<string | undefined> {
    const store = this.o.chats;
    if (!store || !this.projectId) return undefined;
    const msgs = sess.main.messages;
    const old = sess.main.archived;
    const all = old.length ? [...old, ...msgs] : msgs;
    const turns = countTurns(all);
    if (!turns) return undefined;
    const id = newId();
    this.lastTaskChatAt = Math.max(Date.now(), this.lastTaskChatAt + 1); // thứ tự chắc chắn để dọn đúng lần cũ nhất
    try {
      await store.save(this.projectId, { id, title: "⏰ " + task.name, updated: this.lastTaskChatAt, turns, task: task.id, messages: trimForSave(msgs), inputs: turns === 1 ? [task.prompt] : undefined, ...(old.length ? { archived: archiveForSave(old) } : {}) });
      const list = (await store.list(this.projectId)).filter((m) => m.task).sort((a, b) => b.updated - a.updated);
      const per = new Map<string, number>();
      let kept = 0;
      for (const m of list) {
        const n = (per.get(m.task!) ?? 0) + 1;
        per.set(m.task!, n);
        if (n <= MAX_TASK_CHATS && kept < MAX_TASK_CHATS_PER_PROJECT) kept++;
        else await store.remove(this.projectId, m.id);
      }
      return (await store.load(this.projectId, id)) ? id : undefined;
    } catch {
      return undefined; // không lưu được lịch sử: không ảnh hưởng tác vụ
    }
  }

  // ---------------------------------------------------------------- chẩn đoán (không chứa nội dung)
  private initDiagnostics(): void {
    const d = this.o.diagnostics;
    if (!d) return;
    try {
      this.diag = new DiagnosticsRecorder({
        endpoint: d.endpoint,
        headers: d.headers,
        version: d.version,
        build: d.build,
        platform: d.platform,
        fetch: d.fetch ?? this.o.fetchImpl,
        enabled: () => this.diagEnabled(),
        forbidden: () => this.o.policy?.diagnostics === false,
        context: () => ({ profile: this.o.profile ?? "code", model: this.settings.model, install: this.installId() }),
      });
    } catch {
      /* chẩn đoán hỏng không được làm hỏng ứng dụng */
    }
  }
  /** Bộ khung/thư viện giao diện của dự án (chỉ mã, cho nhật ký chất lượng). Tab Work không có khái niệm này. Không bao giờ ném lỗi. */
  private async projectTags(): Promise<{ stack: Stack; ui: UiLib } | undefined> {
    if ((this.o.profile ?? "code") === "work") return undefined;
    try {
      const env = this.o.env;
      const read = async (name: string): Promise<string | undefined> => {
        const p = join(env.root, name);
        const st = await env.stat(p);
        if (!st?.isFile || st.size > 200_000) return undefined;
        return new TextDecoder().decode(await env.readBytes(p));
      };
      const [pkg, reqs, html] = await Promise.all([read("package.json"), read("requirements.txt"), env.stat(join(env.root, "index.html"))]);
      return stackOf({ pkg, reqs, hasHtml: !!html?.isFile });
    } catch {
      return undefined;
    }
  }
  private diagEnabled(): boolean {
    return this.o.policy?.diagnostics !== false && this.settings.diagnostics !== false && (this.o.diagnostics?.enabled?.() ?? true);
  }
  private installId(): string {
    let id = this.settings.diagId;
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      id = newInstallId();
      this.settings.diagId = id;
      void Promise.resolve().then(() => this.o.store.save(this.settings)).catch(() => undefined);
    }
    return id;
  }
  track(act: string): void {
    try {
      this.diag?.noteUi(String(act));
    } catch {
      /* chẩn đoán không bao giờ làm hỏng ứng dụng */
    }
  }
  feedback(v: "up" | "down", reason?: string): void {
    try {
      this.diag?.noteFeedback(String(v), reason === undefined ? undefined : String(reason));
    } catch {
      /* như trên */
    }
  }
  /** Góp ý/báo lỗi do người dùng tự viết và chủ động gửi. Địa chỉ suy ra từ địa chỉ chẩn đoán của ứng dụng (…/diag → …/feedback). */
  async sendFeedback(f: FeedbackInput): Promise<FeedbackResult> {
    const d = this.o.diagnostics;
    const bad = feedbackProblem(f?.kind, f?.text);
    if (bad) return { ok: false, message: bad };
    if (!d || !/\/diag\/?$/.test(d.endpoint)) return { ok: false, message: "Bản này chưa nối được máy chủ để gửi góp ý." };
    const body = {
      kind: f.kind,
      text: f.text.trim(),
      ctx: f.tech ? { version: d.version, platform: d.platform, tab: this.o.profile ?? "code", model: this.settings.model } : {},
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const r = await (d.fetch ?? this.o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)))(d.endpoint.replace(/\/diag\/?$/, "/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(d.headers?.() ?? {}) },
        body: JSON.stringify(body),
        signal: ac.signal,
        redirect: "error",
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (r.ok && j.ok) return { ok: true, message: "Đã gửi. Cảm ơn bạn đã góp ý!" };
      if (r.status === 401) return { ok: false, message: "Bạn chưa đăng nhập hoặc phiên đã hết hạn. Hãy đăng nhập lại rồi gửi." };
      return { ok: false, message: j.message || `Chưa gửi được góp ý (mã ${r.status}). Hãy thử lại sau.` };
    } catch (e) {
      return { ok: false, message: ac.signal.aborted ? "Máy chủ không trả lời kịp. Hãy thử lại sau." : "Không kết nối được máy chủ để gửi góp ý." };
    } finally {
      clearTimeout(timer);
    }
  }
  // ---------------------------------------------------------------- chia sẻ cuộc trò chuyện
  private shareBase(): string | null {
    const e = this.o.diagnostics?.endpoint;
    return e && /\/diag\/?$/.test(e) ? e.replace(/\/diag\/?$/, "/") : null;
  }

  private async sharePayloadFor(chatId?: string, title?: string): Promise<{ payload: SharePayloadV2 } | { error: string }> {
    // cả phần trước các lần tóm tắt ngữ cảnh: trước đây sau khi tóm tắt chỉ còn tin nội bộ → báo "chưa có nội dung"
    let messages = [...this.session.main.archived, ...this.session.main.messages];
    let inputs: string[] | undefined = this.rawInputs.length === countTurns(this.session.main.messages) ? this.rawInputs : undefined;
    let t = "";
    if (chatId && chatId !== this.chatId) {
      if (!this.o.chats || !ID_RE.test(chatId)) return { error: "Không tìm thấy cuộc trò chuyện." };
      const saved = await this.o.chats.load(this.projectId, chatId);
      if (!saved) return { error: "Cuộc trò chuyện đã bị xoá." };
      messages = [...(saved.archived ?? []), ...saved.messages];
      inputs = saved.inputs && saved.inputs.length === countTurns(saved.messages) ? saved.inputs : undefined;
      t = saved.title;
    }
    if (!countTurns(messages)) return { error: "Cuộc trò chuyện chưa có nội dung để chia sẻ." };
    const d = this.o.diagnostics;
    const payload = buildShareV2(messages, {
      title: (title ?? "").trim() || t || chatTitle(messages),
      profile: this.o.profile ?? "code",
      version: d?.version ?? "",
      platform: d?.platform ?? "",
      model: this.settings.model,
      mode: this.session.mode,
      inputs,
    });
    return { payload };
  }

  async sharePreview(chatId?: string): Promise<SharePreview> {
    const r = await this.sharePayloadFor(chatId);
    if ("error" in r) return { ok: false, message: r.error, title: "", items: 0, redactions: 0 };
    return { ok: true, title: r.payload.title, items: r.payload.items.length, redactions: r.payload.redactions };
  }

  private async shareCall(path: string, init?: { method: string; body?: unknown }): Promise<{ status: number; json: any } | null> {
    const base = this.shareBase();
    const d = this.o.diagnostics;
    if (!base || !d) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const r = await (d.fetch ?? this.o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)))(base + path, {
        method: init?.method ?? "GET",
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(d.headers?.() ?? {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: ac.signal,
        redirect: "error",
      });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    } catch {
      return { status: 0, json: {} };
    } finally {
      clearTimeout(timer);
    }
  }

  async shareChat(f: { chatId?: string; title?: string }): Promise<ShareResult> {
    const base = this.shareBase();
    if (!base) return { ok: false, message: "Bản này chưa nối được máy chủ để chia sẻ." };
    const p = await this.sharePayloadFor(f?.chatId, f?.title);
    if ("error" in p) return { ok: false, message: p.error };
    const r = await this.shareCall("share", { method: "POST", body: p.payload });
    if (!r || r.status === 0) return { ok: false, message: "Không kết nối được máy chủ để chia sẻ. Hãy thử lại sau." };
    if (r.status === 401) return { ok: false, message: "Bạn chưa đăng nhập hoặc phiên đã hết hạn. Hãy đăng nhập lại rồi chia sẻ." };
    if (r.status === 200 && r.json?.ok && typeof r.json.id === "string") return { ok: true, message: "Đã tạo liên kết chia sẻ.", id: r.json.id, url: base + "share/" + r.json.id };
    return { ok: false, message: r.json?.message || `Chưa chia sẻ được (mã ${r.status}). Hãy thử lại sau.` };
  }

  async sharedChats(): Promise<SharedChatInfo[]> {
    const base = this.shareBase();
    const r = await this.shareCall("shares");
    if (!base || !r || r.status !== 200 || !Array.isArray(r.json?.items)) return [];
    return r.json.items
      .filter((x: any) => x && typeof x.id === "string" && /^[A-Za-z0-9_-]{22}$/.test(x.id))
      .map((x: any) => ({ id: x.id, title: String(x.title ?? "").slice(0, 120), url: base + "share/" + x.id, ts: Number(x.ts) || 0, views: Number(x.views) || 0, items: Number(x.nitems) || 0, redactions: Number(x.redactions) || 0 }));
  }

  async unshareChat(id: string): Promise<{ ok: boolean; message: string }> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(String(id))) return { ok: false, message: "Mã liên kết không hợp lệ." };
    const r = await this.shareCall("share/revoke", { method: "POST", body: { id } });
    if (r?.status === 200 && r.json?.ok) return { ok: true, message: "Đã thu hồi: liên kết không còn dùng được." };
    return { ok: false, message: r?.json?.message || "Chưa thu hồi được. Hãy thử lại sau." };
  }

  /** Tab Code (Desktop): đang chạy lệnh trong container hay không, Docker có chạy không. null = nơi chạy này không có tuỳ chọn container. */
  async sandboxStatus(): Promise<SandboxStatus | null> {
    if (!this.o.sandbox || (this.o.profile ?? "code") !== "code") return null;
    return this.o.sandbox.status();
  }

  async diagnosticsStatus(): Promise<{ available: boolean; enabled: boolean; lockedByPolicy: boolean }> {
    return { available: !!this.diag, enabled: !!this.diag && this.diagEnabled(), lockedByPolicy: this.o.policy?.diagnostics === false };
  }
  async diagnosticsPreview(note: string): Promise<string | null> {
    return this.diag?.prepareReport(String(note ?? "").slice(0, 500)) ?? null;
  }
  async diagnosticsSend(): Promise<{ ok: boolean }> {
    return this.diag ? this.diag.sendPrepared() : { ok: false };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.llm.models();
      return { ok: true, message: models.length ? "Kết nối được. Mô hình: " + models.slice(0, 3).join(", ") : "Kết nối được." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      return await this.llm.models();
    } catch {
      return [];
    }
  }

  async resetPermissions(): Promise<void> {
    await this.syncSettings();
    this.settings = { ...this.settings, permissions: { ...this.settings.permissions, allow: [] } };
    await this.o.store.save(this.settings);
    await this.rebuildSession();
    this.fire({ type: "notice", level: "info", text: "Đã xoá các quy tắc “Luôn cho phép”." });
  }

  async trustProject(trust: boolean): Promise<void> {
    await this.o.trust.setTrusted(this.o.env.root, trust);
    this.trusted = trust;
    const { messages, archived } = this.session.main;
    this.session.dispose();
    await this.replaceSession(true);
    this.pendingNotices.push(...this.session.startupNotices);
    this.session.main.messages = messages;
    this.session.main.archived = archived;
    this.fire({ type: "notice", level: "info", text: trust ? "Đã tin cậy dự án này: quy tắc allow trong .neuagent/settings.json có hiệu lực." : "Không tin cậy dự án: chỉ áp dụng quy tắc cấm." });
  }

  openFolder(): Promise<void> {
    return this.o.openFolder ? this.o.openFolder() : Promise.resolve();
  }

  /** Dùng cho test. */
  get currentSession(): Session {
    return this.session;
  }
  relPath(abs: string): string {
    return relPath(this.session.ctx, abs);
  }
}
