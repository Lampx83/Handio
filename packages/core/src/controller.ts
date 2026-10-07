import type { DirEntry, Env } from "./env";
import { LlmClient, LlmError } from "./llm";
import { PROFILES, type Profile } from "./profiles";
import { allowedModes, type Policy } from "./policy";
import * as learning from "./learning";
import { mergeHooks } from "./hooks";
import { extOf, formatSections, isOfficeFile, readDocumentSections } from "./office/readdoc";
import { basename, join, relative } from "./path";
import type { Mode } from "./permissions";
import { Session } from "./session";
import { effectiveKey, normalizeSettings, sanitizeProjectSettings, toPublic, type BuiltinKey, type ProjectSettings } from "./settings";
import { IGNORE_DIRS, relPath, resolveSafe, ToolError, walk } from "./tools";
import type { AgentController, PermissionRequest, PermissionResponse, SessionEvent, Settings, UiState } from "./types";

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
  fetchImpl?: typeof fetch;
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

  private constructor(private o: ControllerOptions) {}

  static async create(o: ControllerOptions): Promise<LocalController> {
    const c = new LocalController(o);
    c.settings = c.applyPolicy(normalizeSettings(await o.store.load(), o.defaults));
    c.llm = new LlmClient(() => ({ baseUrl: c.settings.baseUrl, model: c.settings.model, key: effectiveKey(c.settings, c.builtin).key, keyHeader: c.settings.keyHeader, temperature: c.settings.temperature, maxOutputTokens: c.settings.maxOutputTokens, thinking: c.settings.thinking, allowInsecure: c.settings.allowInsecureHttp }), o.fetchImpl);
    c.trusted = await o.trust.isTrusted(o.env.root);
    await c.loadProject();
    c.session = await c.makeSession();
    c.pendingNotices.push(...c.session.startupNotices);
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

  private makeSession(): Promise<Session> {
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
    });
  }

  private fire(e: SessionEvent): void {
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
      profile: def.id,
      profileLabel: def.label,
      tagline: def.tagline,
      welcomeTitle: def.welcomeTitle,
      suggestions: def.suggestions,
      allowedModes: allowedModes(def.modes, this.o.policy),
      workspace: this.session.ctx.root,
      workspaceName: basename(this.session.ctx.root) || "/",
      mode: this.session.mode,
      model: this.settings.model,
      settings: toPublic(this.settings, this.builtin),
      commands: this.session.slashCommands(),
      todos: this.todos,
      busy: this.busy,
      capabilities: { exec: !!env.exec, runJs: !!env.runJs, fetch: !!env.fetchUrl, openFolder: !!this.o.openFolder, realFs: this.o.realFs, openExternal: !!this.o.openExternally, revealWorkspace: !!this.o.revealWorkspace, pdf: !!env.convertToPdf, reset: !!this.o.resetWorkspace, sandbox: !!env.sandbox },
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
      this.fire({ type: "notice", level: "warn", text: "Agent đang làm việc. Bấm Dừng (Esc) trước khi gửi yêu cầu mới." });
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    await this.syncSettings();
    this.fire({ type: "turn_start" });
    for (const n of this.pendingNotices.splice(0)) this.fire({ type: "notice", level: "warn", text: n });
    let final = "";
    let interrupted = false;
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
        final = await this.session.main.runTurn(r.run, this.abort.signal);
        this.session.emitUsage();
      }
    } catch (e) {
      if (e instanceof LlmError && e.kind === "abort") interrupted = true;
      else if (e instanceof LlmError) this.fire({ type: "notice", level: "error", text: e.message });
      else if (e instanceof ToolError) this.fire({ type: "notice", level: "error", text: e.message });
      else this.fire({ type: "notice", level: "error", text: "Lỗi không mong muốn: " + (e as Error).message });
    } finally {
      this.busy = false;
      this.abort = null;
      for (const [id, resolve] of this.pending) {
        resolve({ allow: false, note: "Bị ngắt." });
        this.pending.delete(id);
      }
      this.fire({ type: "turn_end", interrupted, final });
    }
  }

  interrupt(): void {
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

  /** Gợi ý tệp cho `@`: tìm theo một phần đường dẫn (bỏ qua tệp nhạy cảm và thư mục sinh ra như node_modules). */
  async searchFiles(query: string): Promise<string[]> {
    const q = query.toLowerCase();
    const out: string[] = [];
    let seen = 0;
    for await (const f of walk(this.session.ctx, this.session.ctx.root)) {
      if (++seen > 5000) break;
      const rel = relPath(this.session.ctx, f);
      if (!q || rel.toLowerCase().includes(q)) {
        out.push(rel);
        if (out.length >= 40) break;
      }
    }
    return out.sort((a, b) => a.length - b.length || a.localeCompare(b));
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
    this.fire({ type: "reset" });
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
    const p = this.o.policy;
    if (p?.baseUrl) delete (rest as Partial<Settings>).baseUrl; // bị chính sách khoá
    if (p?.allowInsecureHttp !== undefined) delete (rest as Partial<Settings>).allowInsecureHttp;
    const next = normalizeSettings({ ...this.settings, ...rest }, this.o.defaults);
    next.key = key === undefined ? this.settings.key : key || undefined;
    this.settings = next;
    await this.o.store.save(next);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const models = await this.llm.models();
      return { ok: true, message: models.length ? "Kết nối được. Mô hình: " + models.slice(0, 3).join(", ") : "Kết nối được." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
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
