import type { DirEntry, Env } from "./env";
import { LlmClient, LlmError } from "./llm";
import { PROFILES, type Profile } from "./profiles";
import { allowedModes, type Policy } from "./policy";
import * as learning from "./learning";
import { changeDiff, listChanges, revertChanges, type ChangeDiff, type ChangeFile, type RevertResult } from "./changes";
import { detectRun, type RunSuggestion } from "./run-detect";
import { mergeHooks } from "./hooks";
import { extOf, formatSections, isOfficeFile, readDocumentSections } from "./office/readdoc";
import { basename, join, relative } from "./path";
import type { Mode } from "./permissions";
import { chatTitle, cleanProjectName, countTurns, ID_RE, messagesToHistory, newId, trimForSave, type ChatMeta, type ChatStore, type HistoryItem, type ProjectHost, type ProjectsState } from "./projects";
import { Session } from "./session";
import { badCitations, docViewOf, listProcedures, removeProcedure, saveProcedure, type Procedure } from "./work-ctl";
import type { DocView } from "./office/locate";
import { DiagnosticsRecorder, newInstallId } from "./diagnostics";
import { parsePacks, readProjectPacks, type LoadedPack, type RawPack } from "./packs";
import { effectiveKey, normalizeSettings, sanitizeProjectSettings, toPublic, type BuiltinKey, type ProjectSettings } from "./settings";
import { IGNORE_DIRS, relPath, resolveSafe, ToolError, walk } from "./tools";
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
  /** Tiêu đề đăng nhập (SSO/tài khoản) và các máy chủ (host[:cổng]) được phép nhận nó. */
  authHeaders?: () => Promise<Record<string, string> | null>;
  authHosts?: string[];
  fetchImpl?: typeof fetch;
  /** Tự chẩn đoán không chứa nội dung (docs/DIAGNOSTICS.md). Không đặt = không ghi, không gửi gì. Tắt được bằng Settings.diagnostics hoặc policy.diagnostics=false. */
  diagnostics?: { endpoint: string; headers?(): Record<string, string>; enabled?(): boolean; version: string; build?: string; platform: string; fetch?: typeof fetch };
}

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
  private rawInputs: string[] = [];
  /** Công cụ đã dùng trong lượt hiện tại và việc làm xong gần nhất (cho "Lưu thành quy trình" của tab Work). */
  private turnTools: string[] = [];
  private lastGood: { prompt: string; tools: string[]; chatId: string; projectId: string } | null = null;
  private diag?: DiagnosticsRecorder;
  /** Hạn mức token trong ngày (do máy chủ đếm); null = chưa biết hoặc máy chủ không có hạn mức. */
  private quota: QuotaInfo | null = null;

  private constructor(private o: ControllerOptions) {}

  static async create(o: ControllerOptions): Promise<LocalController> {
    const c = new LocalController(o);
    c.settings = c.applyPolicy(normalizeSettings(await o.store.load(), o.defaults));
    c.llm = new LlmClient(() => ({ baseUrl: c.settings.baseUrl, model: c.settings.model, key: effectiveKey(c.settings, c.builtin).key, keyHeader: c.settings.keyHeader, temperature: c.settings.temperature, maxOutputTokens: c.settings.maxOutputTokens, thinking: c.settings.thinking, allowInsecure: c.settings.allowInsecureHttp, authHeaders: o.authHeaders ? async () => { try { return o.authHosts?.includes(new URL(c.settings.baseUrl).host) ? await o.authHeaders!() : null; } catch { return null; } } : undefined }), o.fetchImpl);
    // hạn mức token: lấy từ tiêu đề phản hồi mỗi lần gọi mô hình, và hỏi một lần lúc khởi động (không tốn token, không chặn khởi động)
    c.llm.onQuota = (q) => {
      c.quota = q;
      c.fire({ type: "quota", quota: q });
    };
    // chỉ hỏi máy chủ mặc định của ứng dụng (không gửi thêm yêu cầu tới địa chỉ do người dùng tự đặt)
    if (c.settings.baseUrl === normalizeSettings({}, o.defaults).baseUrl) void c.llm.quota().then((q) => q && c.llm.onQuota?.(q));
    c.trusted = await o.trust.isTrusted(o.env.root);
    await c.loadProject();
    c.session = await c.makeSession();
    c.pendingNotices.push(...c.session.startupNotices);
    c.initDiagnostics();
    if (o.projects) {
      const st = await o.projects.list();
      c.projectId = st.active;
      c.projectName = st.projects.find((p) => p.id === st.active)?.name ?? "";
    }
    return c;
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

  private async makeSession(): Promise<Session> {
    // Gói mở rộng: của quản trị/người dùng do ứng dụng cung cấp + gói nằm trong dự án (.neuagent/packs, không tin cậy)
    const raws: RawPack[] = [];
    try {
      raws.push(...((await this.o.packs?.()) ?? []));
    } catch {
      /* không đọc được gói: chạy không có gói */
    }
    raws.push(...(await readProjectPacks(this.o.env, this.o.env.root)));
    const { packs, notices } = parsePacks(raws);
    const sess = await this.makeSessionWith(packs);
    sess.startupNotices.push(...notices);
    return sess;
  }

  private makeSessionWith(packs: LoadedPack[]): Promise<Session> {
    return Session.create({
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
      mode: this.session.mode,
      model: this.settings.model,
      settings: toPublic(this.settings, this.builtin),
      commands: this.session.slashCommands(),
      todos: this.todos,
      busy: this.busy,
      capabilities: { exec: !!env.exec, runJs: !!env.runJs, fetch: !!env.fetchUrl, openFolder: !!this.o.openFolder, realFs: this.o.realFs, openExternal: !!this.o.openExternally, revealWorkspace: !!this.o.revealWorkspace, pdf: !!env.convertToPdf, reset: !!this.o.resetWorkspace, sandbox: !!env.sandbox, projects: !!this.o.projects, pickFolder: !!this.o.projects?.pick, chats: !!this.o.chats, renderDesign: !!this.o.renderDesign },
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

  async send(text: string): Promise<void> {
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
    this.turnTools = [];
    for (const n of this.pendingNotices.splice(0)) this.fire({ type: "notice", level: "warn", text: n });
    let final = "";
    let interrupted = false;
    let ranTurn = false;
    try {
      const modelCmd = /^\/model(?:\s+(.+))?$/.exec(text.trim());
      if (modelCmd) {
        await this.modelCommand(modelCmd[1]?.trim());
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
      else if (e instanceof LlmError) this.fire({ type: "notice", level: "error", text: e.message, ...(e.code === "login_required" ? { action: "login" as const } : {}) });
      else if (e instanceof ToolError) this.fire({ type: "notice", level: "error", text: e.message });
      else this.fire({ type: "notice", level: "error", text: "Lỗi không mong muốn: " + (e as Error).message });
    } finally {
      this.busy = false;
      this.abort = null;
      for (const [id, resolve] of this.pending) {
        resolve({ allow: false, note: "Bị ngắt." });
        this.pending.delete(id);
      }
      await this.persistChat(turn);
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

  /** Lưu cuộc trò chuyện sau mỗi lượt (dùng giá trị chụp lúc bắt đầu lượt, phòng khi người dùng đã chuyển dự án). */
  private async persistChat(t: { projectId: string; chatId: string; session: Session }): Promise<void> {
    const store = this.o.chats;
    if (!store || !t.projectId) return;
    const msgs = t.session.main.messages;
    const turns = countTurns(msgs);
    if (!turns) return;
    try {
      await store.save(t.projectId, { id: t.chatId, title: chatTitle(msgs), updated: Date.now(), turns, messages: trimForSave(msgs), inputs: t.chatId === this.chatId ? [...this.rawInputs] : undefined });
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
        if (countTurns(msgs)) await store.save(this.projectId, { id: this.chatId, title: chatTitle(msgs), updated: Date.now(), turns: countTurns(msgs), messages: trimForSave(msgs), inputs: aligned ? [...this.rawInputs] : undefined });
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
    this.interrupt();
    this.session.dispose();
  }

  async newSession(): Promise<void> {
    this.interrupt();
    this.session.dispose();
    this.todos = [];
    await this.loadProject();
    this.session = await this.makeSession();
    this.pendingNotices.push(...this.session.startupNotices);
    this.chatId = newId();
    this.rawInputs = [];
    this.fire({ type: "reset" });
  }

  /** Tạo lại phiên (đọc lại AGENTS.md, cấu hình dự án…) nhưng giữ nguyên hội thoại đang có. */
  private async rebuildSession(): Promise<void> {
    const messages = this.session.main.messages;
    this.session.dispose();
    await this.loadProject();
    this.session = await this.makeSession();
    this.pendingNotices.push(...this.session.startupNotices);
    this.session.main.messages = messages;
  }

  // ---------------------------------------------------------------- dự án
  private requireHost(): ProjectHost {
    if (!this.o.projects) throw new Error("Tab này không có chức năng dự án.");
    return this.o.projects;
  }

  /** Chuyển sang một thư mục khác: dừng việc đang chạy, mở phiên mới ở thư mục đó. */
  private async attach(env: Env, projectId: string, name: string): Promise<void> {
    this.interrupt();
    this.session.dispose();
    this.o.env = env;
    this.projectId = projectId;
    this.projectName = name;
    this.trusted = await this.o.trust.isTrusted(env.root);
    this.todos = [];
    await this.loadProject();
    this.session = await this.makeSession();
    this.pendingNotices.push(...this.session.startupNotices);
    this.chatId = newId();
    this.rawInputs = [];
    this.fire({ type: "reset" });
  }

  async projectsState(): Promise<ProjectsState> {
    const st = await this.requireHost().list();
    return { ...st, active: this.projectId || st.active };
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
    return (await this.o.chats.list(this.projectId)).sort((a, b) => b.updated - a.updated);
  }

  async chatOpen(id: string): Promise<{ id: string; title: string; history: HistoryItem[] } | { error: string }> {
    if (!this.o.chats || !ID_RE.test(id)) return { error: "Không mở được cuộc trò chuyện." };
    const saved = await this.o.chats.load(this.projectId, id);
    if (!saved) return { error: "Cuộc trò chuyện đã bị xoá." };
    this.interrupt();
    this.session.dispose();
    this.todos = [];
    await this.loadProject();
    this.session = await this.makeSession();
    this.session.main.messages = saved.messages;
    this.chatId = saved.id;
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
      await this.o.env.writeBytes(join(dir, name), data);
      const rel = relPath(this.session.ctx, join(dir, name));
      this.fire({ type: "files_changed", paths: [rel] });
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
    const next = normalizeSettings({ ...this.settings, ...rest }, this.o.defaults);
    next.key = key === undefined ? this.settings.key : key || undefined;
    this.settings = next;
    await this.o.store.save(next);
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
    const messages = this.session.main.messages;
    this.session.dispose();
    this.session = await this.makeSession();
    this.pendingNotices.push(...this.session.startupNotices);
    this.session.main.messages = messages;
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
