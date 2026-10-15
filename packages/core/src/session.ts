import { TOOL_GROUPS, groupOfTool, groupsFor, matchGroups } from "./tool-groups";
import { pageTools } from "./page-check";
import { brandText } from "./brand";
import type { Env } from "./env";
import { LlmClient, LlmError, type ChatMessage, type ChatResult, type ToolSchema } from "./llm";
import { expandCommand, loadAgents, loadCommands, loadDirMemory, loadMemory, loadRules, loadSkills, ruleMatches, type CustomCommand, type CustomSkill, type Rule } from "./memory";
import { Permissions, type Mode, type TargetInfo } from "./permissions";
import { toPublic, type ProjectSettings } from "./settings";
import { builtinTools, IGNORE_DIRS, readText, relPath, resolveSafe, ToolError, walk, type Tool, type ToolContext } from "./tools";
import { dangerousReason, isReadonlySegment, parseCommand } from "./shell";
import { listChanges, revertChanges, trackExec, type RevertResult } from "./changes";
import { isInternalUser } from "./projects";
import { dirname, join } from "./path";
import { isSensitivePath } from "./sensitive";
import { officeTools } from "./office/tools";
import { workTools } from "./office/work-tools";
import { PROFILES, type Profile } from "./profiles";
import { allowedModes, type Policy } from "./policy";
import { ProcessManager } from "./processes";
import { detectRun } from "./run-detect";
import { HookRunner, mergeHooks, countHooks } from "./hooks";
import { McpManager, type McpServerSpec } from "./mcp";
import { mergePackParts, packsFor, type LoadedPack } from "./packs";
import { buildHttpTools, type HttpToolRuntime } from "./http-tools";
import { findRepetition } from "./repeat";
import { visionTool } from "./vision";
import { ASK_LIMITS, cleanAnswers, formatAnswers, parseAskQuestions } from "./ask";
import type { AskQuestion, PermissionRequest, PermissionResponse, RewindPoint, SessionEvent, Settings, SlashCommandInfo } from "./types";

/** Công cụ Office có cấu trúc: kết quả đã liệt kê nội dung vừa ghi nên cổng "đọc lại" không cần thêm một lần đọc. */
const SELF_REPORTING = new Set([
  "create_docx", "create_xlsx", "create_pptx", "create_pdf", "docx_edit", "xlsx_edit", "pptx_edit", "docx_replace", "xlsx_pivot",
  // thao tác tệp không có nội dung để "đọc lại": kết quả đã liệt kê việc đã làm (đã gặp: xoá 12 tệp xong vẫn bị ép read_document)
  "delete_file", "move_file", "copy_file", "make_dir", "zip_files", "unzip_file",
]);
/** Cây thư mục dự án hai cấp (bỏ thư mục sinh ra/ẩn), tối đa ~70 dòng: đủ để biết dự án có gì mà không phải gọi list_dir nhiều lần. */
async function projectSnapshot(env: Env, root: string): Promise<string> {
  const lines: string[] = [];
  const MAX = 70;
  const walk = async (dir: string, depth: number, indent: string): Promise<void> => {
    let ents = await env.readdir(dir);
    ents = ents.filter((e) => !e.name.startsWith(".") && !(e.isDir && IGNORE_DIRS.has(e.name)) && e.name !== "package-lock.json").sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    for (const e of ents) {
      if (lines.length >= MAX) return void (lines.length === MAX && lines.push(indent + "…"));
      lines.push(indent + e.name + (e.isDir ? "/" : ""));
      if (e.isDir && depth < 2) await walk(join(dir, e.name), depth + 1, indent + "  ");
    }
  };
  await walk(root, 1, "");
  return lines.length > 1 ? lines.join("\n") : "";
}

const PRUNE_MARK = "[đã lược để tiết kiệm ngữ cảnh]";
/** Ngân sách ký tự cho kết quả đọc tệp được giữ khi rút gọn ngữ cảnh (≈ 12 nghìn token). */
const READ_KEEP_CHARS = 48_000;
/** Công cụ ghi tệp mà đối số mang cả nội dung lớn. */
const BULKY_ARGS = new Set(["write_file", "edit_file", "create_docx", "create_xlsx", "create_pptx", "create_pdf", "docx_edit", "xlsx_edit", "pptx_edit"]);
/** Dấu vết thay cho đối số lớn của lời gọi cũ. Mô hình yếu hay chép lại nó làm nội dung (đã gặp: styles.css 16k ký tự bị ghi đè còn một dòng). */
const prunedArgNote = (n: number) => `[${n} ký tự đã ghi vào tệp; lược bớt khỏi lịch sử để tiết kiệm ngữ cảnh, đọc lại bằng read_file nếu cần]`;
const PRUNED_ARG_RE = /ký tự đã ghi vào tệp; lược bớt khỏi lịch sử/;
const MAX_TOOL_CHARS = 12000;
/** Hạn chờ người dùng trả lời một câu hỏi của `ask_user` (không ai trả lời thì agent tự quyết, không treo phiên). */
const QUESTION_TIMEOUT_MS = 15 * 60_000;
/** Số lần `ask_user` tối đa cho một lượt hỏi của người dùng (lời nhắc dặn chỉ hỏi một lần). */
const MAX_ASKS_PER_TURN = 3;

const SUMMARY_SYSTEM = `You compress a conversation between a user and a coding agent into a short working summary (Vietnamese if the user wrote Vietnamese). Keep: the user's goal, decisions made, files read/changed (with paths), commands run and results, open problems and the next step. Drop pleasantries and raw file dumps. Max ~350 words, bullet points.`;

interface AgentDef {
  name: string;
  description: string;
  prompt: string;
  tools: string[] | null;
}
const AGENTS: Record<string, AgentDef> = {
  explore: {
    name: "explore",
    description: "Explore and search the codebase (read-only). Use when you need to look through many files without filling the main context.",
    prompt: "You explore code, read-only. Find the answer quickly with grep/glob/read_file, then report briefly (max ~15 lines): which file, which function, what it does. Do not guess; do not modify files.",
    tools: ["read_file", "list_dir", "glob", "grep"],
  },
  general: {
    name: "general",
    description: "General-purpose agent for one independent multi-step subtask.",
    prompt: "You carry out one subtask you were given. Finish it completely, then report briefly the result and the files you changed.",
    tools: null,
  },
};

export interface SessionOptions {
  /** Tiến trình nền của DỰ ÁN (do bộ điều khiển giữ): phiên mới/cuộc trò chuyện khác vẫn thấy và không dừng máy chủ đang chạy. */
  procs?: ProcessManager;
  env: Env;
  profile?: Profile;
  policy?: Policy;
  getSettings: () => Settings;
  llm: LlmClient;
  emit: (e: SessionEvent) => void;
  askPermission: (req: PermissionRequest) => Promise<PermissionResponse>;
  project?: ProjectSettings | null;
  trustProject?: boolean;
  /** Gói mở rộng đã đọc (xem packs.ts, docs/EXTENSIONS.md): thêm kỹ năng, lệnh, subagent, công cụ MCP… mà không sửa lõi. */
  packs?: LoadedPack[];
  /** Nơi gọi các công cụ HTTP do gói khai báo (tools.json): địa chỉ gốc của tổ chức + cách gọi có đăng nhập. Không đặt = các công cụ đó không bật. */
  httpTools?: HttpToolRuntime;
  /** Hạn chờ trả lời câu hỏi của `ask_user` (ms); mặc định 15 phút. */
  questionTimeoutMs?: number;
}

/** Kết quả đặc biệt của `Session.ask` khi hết hạn chờ. `allow: true` để chẩn đoán không đếm là người dùng từ chối. */
const QUESTION_TIMED_OUT: PermissionResponse = { allow: true };

let idCounter = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export class Session {
  /** Tin nhắn người dùng gửi khi agent đang làm việc: được đưa vào cuộc hội thoại ở bước kế tiếp (không phải chờ hết lượt). */
  queue: string[] = [];
  readonly ctx: ToolContext;
  readonly perms: Permissions;
  readonly tools = new Map<string, Tool>();
  memory: { name: string; text: string }[] = [];
  /** Quy tắc theo phạm vi (thư mục rules): loại `glob` chỉ nạp vào `memory` khi agent đụng tới tệp khớp. */
  rules: Rule[] = [];
  private dirChecked = new Set<string>();
  /** Prompt của lượt này có “ultrathink”: bật suy luận sâu chỉ cho lượt đó. */
  ultrathink = false;
  commands: CustomCommand[] = [];
  agentDefs: Record<string, AgentDef> = { ...AGENTS };
  skills: CustomSkill[] = [];
  hooks: HookRunner | null = null;
  mcp: McpManager | null = null;
  hookContext = "";
  /** Các gói mở rộng đang dùng ở tab này. */
  packs: LoadedPack[] = [];
  packPrompts: { pack: string; text: string }[] = [];
  /** Thông báo lúc khởi động (lỗi MCP…) để bộ điều khiển hiển thị. */
  startupNotices: string[] = [];
  /** Ảnh chụp cấu trúc thư mục dự án lúc mở cuộc trò chuyện (tab Code): agent khỏi tự khám phá lại ở mỗi cuộc trò chuyện mới. */
  snapshot = "";
  promptTokens = 0;
  completionTokens = 0;
  calls = 0;
  charsPerToken = 3;
  lastPromptTokens = 0;
  /** Kích thước (ký tự) lược đồ công cụ của lần gọi gần nhất ở tác tử chính: một phần của lời nhắc vào mô hình. */
  toolsChars = 0;
  /** Nhóm công cụ đã bật (xem tool-groups.ts); giữ đến hết phiên. */
  readonly enabledGroups = new Set<string>();
  /** Số thứ tự lượt hỏi (để gắn thay đổi vào lượt, phục vụ "Thay đổi" và /rewind). */
  turnNo = 0;
  readonly turnMarks = new WeakMap<ChatMessage, number>();
  /** Việc đã làm trong lượt hiện tại: để biết đã chạy kiểm tra sau lần sửa cuối chưa. */
  turnLog = { seq: 0, lastEdit: 0, checks: [] as { seq: number; ok: boolean; bg?: boolean }[], reads: [] as number[], webEdit: 0, htmlFile: "", pageOk: 0 };
  /** Số lần đã gọi `ask_user` trong lượt hiện tại. */
  private asked = 0;
  readonly main: Agent;

  private constructor(readonly o: SessionOptions, root: string) {
    this.ctx = { env: o.env, root, extraDirs: o.env.scratchDir ? [o.env.scratchDir] : [], readFiles: new Map(), undoStack: [], todos: [], onTodos: (t) => o.emit({ type: "todos", todos: t }) };
    if (o.procs) {
      this.ctx.procs = o.procs;
      o.procs.setEmit((e) => o.emit({ type: "proc", ...e }));
    } else if (o.env.spawn) this.ctx.procs = new ProcessManager(o.env, (e) => o.emit({ type: "proc", ...e }));
    const s = o.getSettings();
    const proj = o.project ?? { deny: [], allow: [] };
    const trusted = !!o.trustProject;
    const def = PROFILES[o.profile ?? "code"];
    let mode = (trusted && proj.mode && proj.mode !== "bypass" ? proj.mode : s.mode) as Mode;
    if (!allowedModes(def.modes, o.policy).includes(mode)) mode = def.defaultMode;
    this.perms = new Permissions(
      { allow: [...s.permissions.allow, ...(trusted ? proj.allow : [])], deny: [...s.permissions.deny, ...proj.deny] },
      mode,
      root,
    );
    const code = def.id === "code" && !o.policy?.disableBash;
    this.packs = packsFor(o.packs ?? [], def.id);
    const pp = mergePackParts(this.packs);
    this.packPrompts = pp.prompts;
    // Hooks chạy LỆNH THẬT: của gói (quản trị/người dùng cài) và của người dùng thì luôn; của dự án chỉ khi đã bấm "Tin cậy"
    if (code && o.env.exec) {
      const hooks = mergeHooks(mergeHooks(pp.hooks, s.hooks ?? {}), trusted ? proj.hooks ?? {} : {});
      if (countHooks(hooks)) this.hooks = new HookRunner(hooks, o.env, root);
    }
    // MCP: của người dùng và của dự án (đã Tin cậy) như cũ chỉ ở tab Code; công cụ của gói do quản trị cài dùng được ở mọi tab
    const servers: Record<string, McpServerSpec> = { ...pp.mcpServers, ...(code ? s.mcpServers ?? {} : {}), ...(code && trusted ? proj.mcpServers ?? {} : {}) };
    if (o.env.spawnStdio && Object.keys(servers).length) this.mcp = new McpManager(servers, o.env, root);
    const base = builtinTools(o.env).filter((t) => (def.id === "code" || !["bash", "run_javascript"].includes(t.name)) && !(o.policy?.disableBash && t.name === "bash"));
    const vision = visionTool(o.env, () => this.o.llm);
    const httpTools = o.httpTools ? buildHttpTools(pp.httpTools, o.httpTools) : [];
    for (const t of [...base, vision, ...httpTools, ...(def.id === "work" || def.id === "design" ? officeTools(o.env) : []), ...(def.id === "work" ? workTools(o.env) : []), ...(def.id === "code" ? pageTools(o.env) : []), ...this.metaTools()]) this.tools.set(t.name, t);
    this.main = new Agent(this);
  }

  static async create(o: SessionOptions): Promise<Session> {
    let root = o.env.root;
    try {
      root = await o.env.realpath(o.env.root);
    } catch {
      /* thư mục ảo */
    }
    const s = new Session(o, root);
    if ((o.profile ?? "code") === "code") s.snapshot = await projectSnapshot(o.env, root).catch(() => "");
    s.rules = await loadRules(o.env, root);
    s.memory = await loadMemory(o.env, root, s.rules);
    const pp = mergePackParts(s.packs);
    // của dự án ghi đè của gói cùng tên
    const projectCommands = await loadCommands(o.env, root);
    s.commands = [...projectCommands, ...pp.commands.filter((c) => !projectCommands.some((x) => x.name === c.name))];
    for (const a of [...pp.agents, ...(await loadAgents(o.env, root))]) if (!(a.name in AGENTS)) s.agentDefs[a.name] = { name: a.name, description: a.description || "(không có mô tả)", prompt: a.prompt, tools: a.tools };
    const projectSkills = await loadSkills(o.env, root);
    s.skills = [...projectSkills, ...pp.skills.filter((k) => !projectSkills.some((x) => x.name === k.name))];
    if (s.skills.length) s.tools.set("skill", s.skillTool());
    if (s.mcp) {
      await s.mcp.startAll();
      for (const t of s.mcp.tools()) s.tools.set(t.name, t);
      s.startupNotices.push(...s.mcp.errors);
    }
    if (s.hooks) {
      const r = await s.hooks.run("SessionStart");
      s.hookContext = r.context;
      s.startupNotices.push(...r.warnings);
    }
    return s;
  }

  /** Dừng mọi tiến trình nền và máy chủ MCP khi phiên kết thúc. */
  dispose(): void {
    if (!this.o.procs) this.ctx.procs?.stopAll(); // tiến trình của dự án (do bộ điều khiển giữ) không dừng khi chỉ đổi phiên/cuộc trò chuyện
    this.mcp?.close();
  }

  private skillTool(): Tool {
    return {
      name: "skill", kind: "read", readonly: true,
      description: "Load the detailed instructions of a skill (a packaged procedure/knowledge) by name, from the skills list in the system prompt.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      summarize: (a) => String(a.name ?? ""),
      run: async (_ctx, a) => {
        const sk = this.skills.find((x) => x.name === a.name);
        if (!sk) throw new ToolError(`Không có skill '${a.name}'. Hiện có: ${this.skills.map((x) => x.name).join(", ")}`);
        const attached = sk.texts ? Object.entries(sk.texts).map(([n, t]) => `\n\n--- ${n} ---\n${t}`).join("") : "";
        return sk.body + attached + (sk.files.length && !sk.texts ? `\n\n[Các tệp kèm trong ${sk.dir}: ${sk.files.join(", ")}]` : "");
      },
    };
  }

  get profile(): Profile {
    return this.o.profile ?? "code";
  }
  get mode(): Mode {
    return this.perms.mode;
  }
  setMode(m: Mode): void {
    if (!allowedModes(PROFILES[this.profile].modes, this.o.policy).includes(m)) throw new ToolError(`Chế độ ${m} không dùng được ở tab ${PROFILES[this.profile].label}.`);
    this.perms.setMode(m);
    this.o.emit({ type: "mode", mode: m });
  }
  emit(e: SessionEvent): void {
    this.o.emit(e);
  }

  // ---------------------------------------------------------------- công cụ meta
  private metaTools(): Tool[] {
    const task: Tool = {
      name: "task", kind: "meta", readonly: true,
      description: "Delegate a subtask to a subagent with its own context (keeps the main context small). Use 'explore' for read-only code exploration, or 'general'. The subagent returns a short report.",
      parameters: { type: "object", properties: { agent: { type: "string", description: "subagent name, default explore" }, description: { type: "string", description: "3-6 words" }, prompt: { type: "string", description: "detailed, self-contained request (the subagent cannot see this conversation)" } }, required: ["prompt"] },
      summarize: (a) => `${a.agent || "explore"}: ${String(a.description || a.prompt || "").slice(0, 70)}`,
      run: async (_ctx, a) => this.runSubagent(String(a.prompt ?? ""), String(a.agent || "explore"), String(a.description || "")),
    };
    const useTools: Tool = {
      name: "use_tools", kind: "meta", readonly: true,
      description: "Turn on extra tool groups when you need them (they are hidden by default to save context). Groups: " + TOOL_GROUPS.filter((g) => g.profiles.includes(this.profile)).map((g) => `${g.id} = ${g.label}`).join("; ") + ". Call once with the groups you need, then use the new tools in your next step.",
      parameters: { type: "object", properties: { groups: { type: "array", items: { type: "string" }, description: "group ids" } }, required: ["groups"] },
      summarize: (a) => "bật nhóm công cụ " + (Array.isArray(a.groups) ? a.groups.join(", ") : ""),
      run: async (_ctx, a) => {
        const ids = (Array.isArray(a.groups) ? a.groups : []).map(String);
        const valid = groupsFor(this.profile).map((g) => g.id);
        const bad = ids.filter((i: string) => !valid.includes(i));
        const added = this.enableGroups(ids);
        const names = groupsFor(this.profile).filter((g) => ids.includes(g.id)).flatMap((g) => g.tools).filter((n) => this.tools.has(n));
        if (bad.length && !names.length) return `Lỗi: không có nhóm ${bad.join(", ")}. Nhóm hợp lệ: ${valid.join(", ")}.`;
        return `Đã bật ${added.length ? added.join(", ") : "(đã bật từ trước)"}. Công cụ dùng được từ bước kế tiếp: ${names.join(", ") || "(không có)"}.`;
      },
    };
    const exitPlan: Tool = {
      name: "exit_plan_mode", kind: "meta", readonly: false,
      description: "Only in plan mode: present your plan to the user for approval before changing anything.",
      parameters: { type: "object", properties: { plan: { type: "string", description: "detailed plan in markdown" } }, required: ["plan"] },
      summarize: () => "kế hoạch",
      run: async (_ctx, a) => this.exitPlanMode(String(a.plan ?? ""), 0),
    };
    const askUser: Tool = {
      name: "ask_user", kind: "meta", readonly: true,
      description: "Ask the user 1-4 structured multiple-choice questions when you are MISSING information that you truly cannot decide yourself (e.g. which of several files, which audience, an irreversible choice). Do not use it for things you can reasonably decide: short requests are complete briefs. Ask at most once per request, at most 3 questions; each question has 2-4 options (put your recommended option FIRST); do not add an 'Other' option because the user can always type their own answer. Returns the user's choices, or tells you the user left it to you: then decide yourself and state your assumption.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array", minItems: 1, maxItems: ASK_LIMITS.questions,
            description: "1-4 questions",
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "the full question, ending with a question mark" },
                header: { type: "string", description: "very short label (max 12 characters), e.g. 'Đối tượng'" },
                options: {
                  type: "array", minItems: 2, maxItems: ASK_LIMITS.options, description: "2-4 mutually informative options; the first is your recommendation",
                  items: { type: "object", properties: { label: { type: "string", description: "short choice text (1-5 words)" }, description: { type: "string", description: "one short sentence on what this choice means" } }, required: ["label"] },
                },
                multi_select: { type: "boolean", description: "true if several options may be chosen together; default false" },
              },
              required: ["question", "options"],
            },
          },
        },
        required: ["questions"],
      },
      summarize: (a) => {
        const n = Array.isArray(a.questions) ? a.questions.length : 0;
        const q = Array.isArray(a.questions) && a.questions[0] && typeof (a.questions[0] as { question?: unknown }).question === "string" ? String((a.questions[0] as { question: string }).question).slice(0, 60) : "";
        return n > 1 ? `${n} câu hỏi` : q;
      },
      run: async (_ctx, a) => this.askQuestions(parseAskQuestions(a.questions)),
    };
    return [task, exitPlan, askUser, useTools];
  }

  /** `ask_user`: hỏi người dùng rồi trả câu trả lời thành chữ cho mô hình. Không cấp quyền gì cho công cụ khác (bỏ qua `always`/`mode`). */
  async askQuestions(questions: AskQuestion[]): Promise<string> {
    if (this.asked >= MAX_ASKS_PER_TURN) return `Đã hỏi người dùng ${MAX_ASKS_PER_TURN} lần trong yêu cầu này. Đừng hỏi thêm: hãy tự chọn phương án hợp lý nhất, làm tiếp và nêu rõ giả định trong báo cáo.`;
    this.asked++;
    const req: PermissionRequest = { id: nextId("q"), kind: "question", tool: "ask_user", summary: questions.length > 1 ? `${questions.length} câu hỏi cho bạn` : "Câu hỏi cho bạn", args: {}, questions, depth: 0 };
    const res = await this.ask(req, this.o.questionTimeoutMs ?? QUESTION_TIMEOUT_MS);
    if (res === QUESTION_TIMED_OUT) {
      this.emit({ type: "notice", level: "info", text: "Hết thời gian chờ trả lời; agent sẽ tự quyết." });
      return "Người dùng không trả lời kịp (hết thời gian chờ). Hãy tự chọn phương án hợp lý nhất (ưu tiên lựa chọn đầu tiên), làm tiếp và nêu rõ giả định trong báo cáo. Đừng hỏi lại cùng câu hỏi.";
    }
    const { answered, text } = formatAnswers(questions, res.allow ? cleanAnswers(res.answers, questions) : []);
    if (!answered) return "Người dùng không chọn gì và để bạn tự quyết. Hãy tự chọn phương án hợp lý nhất (ưu tiên lựa chọn đầu tiên), làm tiếp và nêu rõ giả định trong báo cáo. Đừng hỏi lại cùng câu hỏi.";
    return `Người dùng đã trả lời:\n${text}${answered < questions.length ? "\nVới câu không trả lời: hãy tự quyết và nêu giả định." : ""}`;
  }

  async exitPlanMode(plan: string, depth: number): Promise<string> {
    if (this.perms.mode !== "plan") return "Không ở chế độ plan; cứ tiếp tục làm theo kế hoạch.";
    const req: PermissionRequest = { id: nextId("p"), kind: "plan", tool: "exit_plan_mode", summary: "Kế hoạch đề xuất", args: {}, plan, depth };
    const res = await this.ask(req);
    if (res.allow) {
      const m: Mode = res.mode === "default" ? "default" : "auto";
      this.setMode(m);
      const edited = (res.plan ?? "").trim();
      if (edited && edited !== plan.trim()) return `Kế hoạch được duyệt, nhưng người dùng đã tự sửa kế hoạch. Hãy làm theo BẢN ĐÃ SỬA này (thay cho bản bạn đề xuất), đã thoát chế độ plan (${m === "auto" ? "tự duyệt việc thường ngày" : "mỗi thay đổi sẽ được hỏi"}):\n${edited.slice(0, 8000)}`;
      return `Kế hoạch được duyệt. Đã thoát chế độ plan (${m === "auto" ? "tự duyệt việc thường ngày" : "mỗi thay đổi sẽ được hỏi"}). Hãy thực hiện theo kế hoạch rồi kiểm chứng.`;
    }
    return `Người dùng chưa duyệt.${res.note ? " Góp ý: " + res.note + "." : ""} Hãy chỉnh kế hoạch rồi gọi lại exit_plan_mode.`;
  }

  async runSubagent(prompt: string, agent: string, description: string): Promise<string> {
    const def = this.agentDefs[agent || "explore"];
    if (!def) throw new ToolError(`Không có subagent '${agent}'. Hiện có: ${Object.keys(this.agentDefs).join(", ")}`);
    this.emit({ type: "notice", level: "info", text: `Subagent ${def.name}${description ? ": " + description : ""} bắt đầu` });
    const sub = new Agent(this, def, 1);
    const text = await sub.runTurn(prompt, this.ctx.signal);
    return text || "(subagent không trả về nội dung)";
  }

  /** Với `timeoutMs`: hết hạn mà chưa ai trả lời thì trả QUESTION_TIMED_OUT (giao diện được báo đóng thẻ; không tính là từ chối). */
  async ask(req: PermissionRequest, timeoutMs?: number): Promise<PermissionResponse> {
    const answer = this.o.askPermission(req); // đăng ký chờ TRƯỚC khi phát sự kiện, để người nghe trả lời ngay cũng không bị mất
    this.emit({ type: "permission", request: req });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = timeoutMs ? await Promise.race([answer, new Promise<PermissionResponse>((r) => (timer = setTimeout(() => r(QUESTION_TIMED_OUT), timeoutMs)))]) : await answer;
    if (timer) clearTimeout(timer);
    this.emit({ type: "permission_resolved", id: req.id, allowed: res.allow });
    return res;
  }

  // ---------------------------------------------------------------- prompt
  toolsFor(def: AgentDef | null, depth: number): Tool[] {
    const out: Tool[] = [];
    for (const t of this.tools.values()) {
      if (depth > 0 && (t.name === "task" || t.name === "exit_plan_mode" || t.name === "ask_user")) continue;
      if (t.name === "exit_plan_mode" && this.perms.mode !== "plan") continue;
      if (def?.tools && !def.tools.includes(t.name)) continue;
      if (depth === 0 && !def && this.gatedOff(t.name)) continue;
      out.push(t);
    }
    return out;
  }

  /** Công cụ thuộc một nhóm CHƯA bật (của tab hiện tại)? */
  private gatedOff(tool: string): boolean {
    if (tool === "use_tools") return groupsFor(this.profile).every((g) => this.enabledGroups.has(g.id));
    const g = groupOfTool(this.profile, tool);
    return !!g && !this.enabledGroups.has(g);
  }

  /** Bật các nhóm công cụ có chủ đề được nhắc trong tin nhắn người dùng/kết quả công cụ gần đây. Trả về nhóm mới bật. */
  refreshGroups(messages: ChatMessage[]): string[] {
    const texts: string[] = [];
    let users = 0, tools = 0;
    for (let i = messages.length - 1; i >= 0 && (users < 3 || tools < 3); i--) {
      const m = messages[i];
      const c = typeof m.content === "string" ? m.content : "";
      if (m.role === "user" && users < 3 && c) { texts.push(c.slice(0, 4000)); users++; }
      else if (m.role === "tool" && tools < 3 && c) { texts.push(c.slice(0, 2500)); tools++; }
    }
    return this.enableGroups(matchGroups(this.profile, texts));
  }

  enableGroups(ids: string[]): string[] {
    const added: string[] = [];
    for (const id of ids) if (!this.enabledGroups.has(id) && groupsFor(this.profile).some((g) => g.id === id)) { this.enabledGroups.add(id); added.push(id); }
    return added;
  }

  systemPrompt(def: AgentDef | null, depth: number): string {
    const caps = [this.tools.has("bash") ? "bash (real shell)" : "no shell", this.tools.has("run_javascript") ? "run_javascript (sandbox)" : "", this.tools.has("web_fetch") ? "web_fetch" : ""].filter(Boolean).join(", ");
    let base = brandText(PROFILES[this.profile].systemBase);
    // check_page chỉ có ở Desktop: không nhắc công cụ không tồn tại (mô hình sẽ gọi nó và lỡ một bước)
    if (!this.tools.has("check_page")) base = base.replace(/but check_page can \(when available\):[\s\S]*?(?=Also run the build)/, "after starting the dev server (bash background=true) a dev server does NOT report missing imports or broken CSS until the page loads, so ALSO run the linter (npm run lint: no-undef / jsx-no-undef catch a component that is used but never imported) and the build, and fix every error. ").replace(/\bcheck_page\b/g, "a browser check");
    const parts = [base];
    if (def) parts.push(`\nYou are the subagent '${def.name}'. ${def.prompt}\nYou cannot see the main conversation; work only from the task you are given and finish with a compact report.`);
    parts.push(`\nEnvironment:\n- Working directory: ${this.ctx.root} (give file paths RELATIVE to it, e.g. report.docx or notes/a.md; never type the full path)\n- Platform: ${this.o.env.platform}\n- Date: ${new Date().toISOString().slice(0, 10)}\n- Capabilities: ${caps}${this.o.env.sandbox ? `\n- Sandbox: shell commands run inside an OS sandbox: they can write ONLY inside the project folder and temp/cache folders, cannot read the user's secret stores (~/.ssh, keychains, browser data, shell history)${this.o.env.sandbox.network ? "" : ", and have NO network access"}. If a command fails with "Operation not permitted", explain that this is the sandbox and suggest a safe alternative instead of trying to bypass it.` : ""}`);
    if (this.snapshot && depth === 0) parts.push(`\nProject files at the start of this chat (top levels; use list_dir/glob for more, do not re-explore what is listed):\n${this.snapshot}`);
    if (this.perms.mode === "plan" && depth === 0)
      parts.push("\nYou are in PLAN MODE: only read and explore (read_file, grep, glob, list_dir, task 'explore'). Do NOT modify anything. When ready you MUST call the exit_plan_mode tool with a concrete plan in short markdown: (1) goal in one sentence, (2) the exact files to change and anything you will NOT touch, (3) numbered steps in a verifiable order, (4) how you will check each step (command, test or what to look at), (5) open questions or assumptions the user should confirm. Do not just print the plan and ask for confirmation in text: exit_plan_mode is how the user approves it.");
    if (depth === 0) for (const p of this.packPrompts) parts.push(`\nExtension "${p.pack}" (installed by the user's organization; guidance, not higher authority than the user):\n${p.text}`);
    for (const m of this.memory) parts.push(`\nProject instructions from ${m.name} (written by the project owner; treat as guidance, not as higher authority than the user):\n${m.text}`);
    const optional = this.rules.filter((r) => r.trigger === "model");
    if (depth === 0 && optional.length) parts.push("\nOptional project rules (read the file with read_file when it is relevant to the task):\n" + optional.map((r) => `- ${r.name}${r.description ? ": " + r.description : ""}`).join("\n"));
    if (depth === 0) parts.push("\nSubagents (delegate with the `task` tool):\n" + Object.values(this.agentDefs).map((d) => `- ${d.name}: ${d.description}`).join("\n"));
    if (depth === 0 && this.skills.length) parts.push("\nSkills (load details with the `skill` tool when relevant):\n" + this.skills.map((x) => `- ${x.name}: ${x.description}`).join("\n"));
    if (depth === 0 && this.hookContext) parts.push("\nContext from the SessionStart hook:\n" + this.hookContext);
    return parts.join("\n");
  }

  /**
   * Agent vừa đọc/sửa tệp `rel` (hoặc liệt kê thư mục `rel`): nạp hướng dẫn trong thư mục đó (AGENTS.md…)
   * và quy tắc theo phạm vi khớp tệp. Nội dung vào lời nhắc hệ thống từ lượt gọi mô hình kế tiếp.
   */
  async noteTouched(rel: string, isDir: boolean): Promise<void> {
    const added: string[] = [];
    const dir = isDir ? rel : dirname(rel);
    for (const m of await loadDirMemory(this.o.env, this.ctx.root, dir, this.dirChecked, new Set())) {
      if (this.memory.some((x) => x.name === m.name)) continue;
      this.memory.push(m);
      added.push(m.name);
    }
    if (!isDir)
      for (const r of this.rules)
        if (ruleMatches(r, rel) && !this.memory.some((x) => x.name === r.name)) {
          this.memory.push({ name: r.name, text: r.text });
          added.push(r.name);
        }
    if (added.length) this.emit({ type: "notice", level: "info", text: "Đã nạp hướng dẫn: " + added.join(", ") });
  }

  cachedTokens = 0;

  track(usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }, chars: number): void {
    this.calls++;
    const ct = usage.prompt_tokens_details?.cached_tokens;
    if (typeof ct === "number" && ct > 0) this.cachedTokens += ct;
    const pt = usage.prompt_tokens ?? 0;
    this.promptTokens += pt;
    this.completionTokens += usage.completion_tokens ?? 0;
    if (pt > 200 && chars > 0) this.charsPerToken = Math.max(1.8, Math.min(5, 0.5 * this.charsPerToken + (0.5 * chars) / pt));
    this.lastPromptTokens = pt;
  }

  // ---------------------------------------------------------------- lượt chat & lệnh slash
  slashCommands(): SlashCommandInfo[] {
    const base: SlashCommandInfo[] = [
      { name: "help", description: "Xem các lệnh" },
      { name: "clear", description: "Xoá hội thoại, bắt đầu phiên mới" },
      { name: "compact", description: "Tóm tắt hội thoại để giải phóng ngữ cảnh" },
      { name: "mode", description: "Đổi chế độ quyền: " + PROFILES[this.profile].modes.join(" | ") },
      { name: "undo", description: "Hoàn tác thay đổi file gần nhất của agent" },
      ...(PROFILES[this.profile].modes.includes("plan") ? [{ name: "plan", description: "Vào chế độ lập kế hoạch (chỉ đọc), có thể kèm yêu cầu: /plan <việc cần làm>" }] : []),
      { name: "memory", description: "Các tệp hướng dẫn đang nạp (AGENTS.md, quy tắc…)" },
      { name: "branch", description: "Tách nhánh: sao chép hội thoại sang cuộc trò chuyện mới để thử hướng khác" },
      { name: "usage", description: "Token đã dùng trong phiên và hạn mức hôm nay" },
      { name: "effort", description: "Mức suy luận: /effort high (suy luận sâu) | low; thêm “ultrathink” vào prompt để chỉ bật cho lượt đó" },
      { name: "context", description: "Ngữ cảnh đang dùng vào việc gì" },
      { name: "status", description: "Mô hình, chế độ, thư mục, ngữ cảnh" },
      ...(this.profile === "code" ? [{ name: "diff", description: "Xem các tệp agent đã thay đổi" }, { name: "rewind", description: "Quay lại một lượt trước (hội thoại + tệp)" }] : []),
      { name: "model", description: "Xem/chọn mô hình: /model hoặc /model <tên|số>" },
      { name: "agents", description: "Danh sách subagent (có sẵn + tuỳ biến)" },
      { name: "skills", description: "Danh sách skill của dự án" },
      { name: "hooks", description: "Xem các hook đang bật" },
      { name: "mcp", description: "Xem công cụ MCP đang nối" },
      { name: "packs", description: "Xem các gói mở rộng đang bật" },
    ];
    const bundled = Object.entries(PROFILES[this.profile].commands).map(([name, c]) => ({ name, description: c.description }));
    const custom = this.commands.map((c) => ({ name: c.name, description: c.description }));
    return [...base, ...bundled, ...custom.filter((c) => !bundled.some((b) => b.name === c.name))];
  }

  /** Xử lý dòng người dùng nhập. Trả về văn bản để chạy như một lượt chat, hoặc null nếu đã xử lý xong. */
  async handleInput(line: string): Promise<{ run: string | null; reset?: boolean }> {
    const text = line.trim();
    this.ultrathink = /\bultrathink\b/i.test(text);
    if (text.startsWith("!")) return { run: await this.userShell(text.slice(1).trim()) };
    if (!text.startsWith("/")) return { run: await this.attachMentions(text) };
    const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    if (!m) return { run: text };
    const [, name, args] = m;
    const notice = (t: string, level: "info" | "warn" | "error" = "info") => this.emit({ type: "notice", level, text: t });
    switch (name) {
      case "help":
        notice(this.slashCommands().map((c) => `/${c.name} — ${c.description}`).join("\n"));
        return { run: null };
      case "clear":
        return { run: null, reset: true };
      case "compact": {
        const ok = await this.main.compact(args);
        notice(ok ? "Đã tóm tắt hội thoại." : "Chưa có gì để tóm tắt.", ok ? "info" : "warn");
        this.emitUsage();
        return { run: null };
      }
      case "mode": {
        const a = args.trim();
        const allowed = allowedModes(PROFILES[this.profile].modes, this.o.policy);
        if (!allowed.includes(a as Mode)) notice(`Chế độ hiện tại: ${this.mode}. Dùng: /mode ${allowed.join(" | ")}`, "warn");
        else {
          this.setMode(a as Mode);
          notice(`Đã chuyển sang chế độ ${a}.`);
        }
        return { run: null };
      }
      case "undo": {
        notice(await this.undo());
        return { run: null };
      }
      case "plan": {
        if (!allowedModes(PROFILES[this.profile].modes, this.o.policy).includes("plan")) break;
        this.setMode("plan");
        notice("Đã vào chế độ plan: agent chỉ đọc và lập kế hoạch, bạn duyệt rồi mới sửa.");
        return { run: args.trim() ? await this.attachMentions(args.trim()) : null };
      }
      case "memory":
        notice(this.memoryReport());
        return { run: null };
      case "hooks":
        notice(this.hooks ? `Đang có ${this.hooks.count} hook (sự kiện: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop). Hook của dự án chỉ chạy khi bạn đã “Tin cậy” thư mục.` : "Chưa có hook nào. Thêm vào cài đặt người dùng (hooks) hoặc .neuagent/settings.json của dự án (cần Tin cậy).");
        return { run: null };
      case "agents":
        notice(Object.values(this.agentDefs).map((d) => `${d.name}${d.tools ? ` [${d.tools.join(", ")}]` : ""}: ${d.description}`).join("\n"));
        return { run: null };
      case "skills":
        notice(this.skills.length ? this.skills.map((x) => `${x.name}: ${x.description}`).join("\n") : "Chưa có skill. Tạo .neuagent/skills/<tên>/SKILL.md.");
        return { run: null };
      case "packs":
        notice(this.packs.length ? this.packs.map((p) => `${p.manifest.name} v${p.manifest.version} (${p.origin}): ${p.manifest.description} — ${p.skills.length} skill, ${p.commands.length} lệnh, ${p.agents.length} subagent${Object.keys(p.mcpServers).length ? `, ${Object.keys(p.mcpServers).length} máy chủ MCP` : ""}`).join("\n") : "Chưa có gói mở rộng. Xem docs/EXTENSIONS.md.");
        return { run: null };
      case "mcp":
        notice(this.mcp ? `Công cụ MCP: ${[...this.tools.keys()].filter((k) => k.startsWith("mcp__")).join(", ") || "(không có)"}${this.mcp.errors.length ? "\nLỗi: " + this.mcp.errors.join("; ") : ""}` : "Chưa cấu hình máy chủ MCP (mcpServers trong cài đặt người dùng; của dự án cần Tin cậy).");
        return { run: null };
      case "context":
        notice(this.contextReport());
        return { run: null };
      case "status":
        notice(await this.statusReport());
        return { run: null };
      case "diff": {
        if (this.profile !== "code") break;
        const ch = await listChanges(this.ctx);
        notice(ch.length ? ch.map((f) => `${f.status === "new" ? "＋" : f.status === "deleted" ? "−" : "✎"} ${f.path}${f.sensitive || f.binary || f.large ? "" : `  +${f.added} −${f.removed}`}`).join("\n") : "Chưa có thay đổi.");
        return { run: null };
      }
      case "rewind":
        if (this.profile !== "code") break;
        notice("Bấm nút ↶ ở thanh trên, hoặc nhấn Esc hai lần.");
        return { run: null };
    }
    const custom = this.commands.find((c) => c.name === name);
    const bundled = PROFILES[this.profile].commands[name];
    if (custom || bundled) return { run: await this.attachMentions(expandCommand((custom ?? bundled).body, args)) };
    notice(`Không có lệnh /${name}. Gõ /help để xem danh sách.`, "warn");
    return { run: null };
  }

  /** `!lệnh`: người dùng tự chạy lệnh (không cần xin phép như agent, vẫn chặn lệnh phá hoại); kết quả được đưa vào hội thoại để agent biết. */
  private async userShell(command: string): Promise<null> {
    const notice = (t: string, level: "info" | "warn" | "error" = "warn") => this.emit({ type: "notice", level, text: t });
    if (!command) return void notice("Cú pháp: !lệnh  (ví dụ: !ls -la hoặc !python3 --version)") as unknown as null;
    if (!this.o.env.exec || this.o.policy?.disableBash || this.profile !== "code") return void notice("Tab này không có terminal để chạy lệnh.") as unknown as null;
    const danger = dangerousReason(command, this.ctx.root);
    if (danger) return void notice("Lệnh bị chặn vì nguy hiểm: " + danger + ".", "error") as unknown as null;
    const id = nextId("u");
    this.emit({ type: "tool_start", id, name: "bash", summary: command.slice(0, 110), args: { command }, depth: 0 });
    let out = "";
    let ok = true;
    try {
      this.ctx.turn = ++this.turnNo; // thay đổi do lệnh tự chạy cũng vào "Thay đổi"
      const segs = parseCommand(command);
      const readonlyCmd = !!segs && segs.length > 0 && segs.every((x) => isReadonlySegment(x, this.ctx.root));
      const run = () => this.o.env.exec!(command, { cwd: this.ctx.root, timeoutMs: 120_000, signal: this.ctx.signal });
      const r = readonlyCmd ? await run() : await trackExec(this.ctx, run);
      out = (r.output.trim() || "(không có đầu ra)").slice(-8000) + (r.timedOut ? "\n[Hết thời gian 120s, đã dừng lệnh]" : `\n[mã thoát ${r.code}]`);
      ok = r.code === 0 && !r.timedOut;
    } catch (e) {
      out = "Lỗi: " + (e as Error).message;
      ok = false;
    }
    this.emit({ type: "tool_result", id, name: "bash", ok, output: out, depth: 0 });
    this.emit({ type: "files_changed", paths: [] });
    this.main.messages.push({ role: "user", content: `[Tôi vừa tự chạy lệnh \`${command}\` trong terminal và nhận được kết quả:]\n${out}` }, { role: "assistant", content: "Đã ghi nhận kết quả lệnh." });
    return null;
  }

  /** `@đường/dẫn` trong prompt: đính kèm nội dung tệp (hoặc danh sách thư mục) để agent khỏi phải đoán/đọc lại. */
  async attachMentions(text: string): Promise<string> {
    const found: string[] = [];
    for (const m of text.matchAll(/(^|[\s(\[])@([^\s@()'",;<>\[\]]+)/g)) {
      const t = m[2].replace(/[.,;:!?]+$/, "");
      if (t && !found.includes(t)) found.push(t);
    }
    if (!found.length) return text;
    const blocks: string[] = [];
    const names: string[] = [];
    let total = 0;
    for (const t of found.slice(0, 8)) {
      let abs: string;
      try {
        // "dan/<tên>" = ảnh dán tạm (lưu ngoài thư mục dự án, xem LocalController.pasteImages)
        const scratch = this.o.env.scratchDir;
        abs = await resolveSafe(this.ctx, scratch && t.startsWith("dan/") ? join(scratch, t.slice(4)) : t);
      } catch {
        continue;
      }
      const st = await this.o.env.stat(abs);
      if (!st) continue;
      const outside = !!this.o.env.scratchDir && abs.startsWith(this.o.env.scratchDir + "/");
      const rel = outside ? abs : relPath(this.ctx, abs);
      if (!outside && isSensitivePath(rel)) {
        this.emit({ type: "notice", level: "warn", text: `Không đính kèm @${t}: tệp có thể chứa bí mật (khoá/mật khẩu).` });
        continue;
      }
      if (st.isDir) {
        const items = await this.dirTree(abs, "", 0, { n: 0 });
        blocks.push(`<dir path="${rel}">\n${items.join("\n") || "(thư mục trống)"}\n</dir>`);
        names.push("@" + (rel === "." ? "" : rel + "/"));
        continue;
      }
      if (/\.(png|jpe?g|webp|gif)$/i.test(rel)) {
        if (this.tools.has("read_image")) {
          blocks.push(`<image path="${rel}">Ảnh người dùng vừa dán/đính kèm${outside ? " (lưu tạm ngoài thư mục dự án; đường dẫn này dùng được nguyên văn)" : ""}. Gọi read_image với đúng path này để xem (chép chữ, đọc bảng, mô tả).</image>`);
          if (!outside && !/^\.neuagent\/pasted\//.test(rel)) names.push(`@${rel} (ảnh)`); // ảnh dán: giao diện đã hiện ảnh, không nhắc lại tên tệp
        }
        continue;
      }
      let body: string;
      try {
        body = await readText(this.ctx, abs);
      } catch {
        continue; // nhị phân/không đọc được
      }
      const lines = body.split("\n");
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      const shown = lines.slice(0, 400);
      let block = `<file path="${rel}">\n${shown.map((l, i) => `${String(i + 1).padStart(6)}\t${l.length > 400 ? l.slice(0, 400) + "…" : l}`).join("\n")}${lines.length > shown.length ? `\n… (còn ${lines.length - shown.length} dòng, dùng read_file offset=${shown.length + 1})` : ""}\n</file>`;
      if (total + block.length > 80_000) block = `<file path="${rel}">(bỏ qua: tổng dung lượng đính kèm quá lớn, hãy dùng read_file)</file>`;
      total += block.length;
      blocks.push(block);
      names.push(`@${rel} (${lines.length} dòng)`);
      if (lines.length <= 400) this.ctx.readFiles.set(abs, st.mtimeMs); // đã "đọc": sửa được ngay
    }
    if (!blocks.length) return text;
    if (names.length) this.emit({ type: "notice", level: "info", text: "Đã đính kèm: " + names.join(", ") });
    return `${text}\n\n[Nội dung các tệp được đính kèm bằng @ (tại thời điểm gửi):]\n${blocks.join("\n")}`;
  }

  /** Cây thư mục (sâu tối đa 2 cấp, tối đa 150 mục) cho `@thư_mục/`; bỏ thư mục sinh ra và tệp nhạy cảm. */
  private async dirTree(abs: string, prefix: string, depth: number, count: { n: number }): Promise<string[]> {
    const out: string[] = [];
    const entries = (await this.o.env.readdir(abs)).filter((e) => !(e.isDir && IGNORE_DIRS.has(e.name)) && e.name !== ".DS_Store" && !isSensitivePath(e.name)).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (count.n >= 150) {
        out.push(prefix + "…");
        break;
      }
      count.n++;
      out.push(prefix + e.name + (e.isDir ? "/" : ""));
      if (e.isDir && depth < 1) out.push(...(await this.dirTree(abs + "/" + e.name, prefix + "  ", depth + 1, count)));
    }
    return out;
  }

  async undo(): Promise<string> {
    const u = this.ctx.undoStack.pop();
    if (!u) return "Không còn thay đổi nào để hoàn tác.";
    const batch = [u];
    // thay đổi do cùng một lệnh bash: hoàn tác cả nhóm (theo thứ tự ngược)
    while (u.group && this.ctx.undoStack.length && this.ctx.undoStack[this.ctx.undoStack.length - 1].group === u.group) batch.push(this.ctx.undoStack.pop()!);
    const rels: string[] = [];
    for (const e of batch) {
      const rel = relPath(this.ctx, e.path);
      rels.push(rel);
      const real = await resolveSafe(this.ctx, e.path); // luôn nằm trong thư mục dự án
      if (e.old === null) await this.o.env.remove(real);
      else {
        await this.o.env.mkdirp(dirname(real)); // thư mục chứa có thể đã bị xoá (di chuyển thư mục, rm -r)
        if (typeof e.old === "string") await this.o.env.writeText(real, e.old);
        else await this.o.env.writeBytes(real, e.old);
        const st = await this.o.env.stat(real);
        if (st) this.ctx.readFiles.set(real, st.mtimeMs);
      }
    }
    this.emit({ type: "files_changed", paths: rels });
    if (batch.length > 1) return `Đã hoàn tác ${batch.length} tệp do cùng một lệnh thay đổi.`;
    return u.old === null ? `Đã xoá file ${rels[0]} vừa tạo.` : `Đã khôi phục ${rels[0]} về trước lần sửa gần nhất.`;
  }

  // ---------------------------------------------------------------- lượt hỏi, thay đổi, quay lại
  /** Bắt đầu một lượt hỏi của người dùng (gắn mọi thay đổi sau đó vào lượt này). */
  beginTurn(userMsg: ChatMessage): void {
    this.ctx.turn = ++this.turnNo;
    this.turnMarks.set(userMsg, this.ctx.turn);
    this.turnLog = { seq: 0, lastEdit: 0, checks: [], reads: [], webEdit: 0, htmlFile: "", pageOk: 0 };
    this.asked = 0;
  }

  /** Ghi nhận một công cụ vừa chạy xong (để biết đã kiểm chứng sau lần sửa cuối chưa). */
  noteTool(name: string, passed: boolean, wrote: boolean, background = false, extra: { file?: string; pageClean?: boolean } = {}): void {
    const L = this.turnLog;
    if (wrote && extra.file && /\.(html?|jsx?|tsx?|mjs|vue|svelte|astro|css|scss)$/i.test(extra.file)) {
      L.webEdit = L.seq + 1; // vừa sửa mã/giao diện web: trang có thể đã vỡ
      if (/\.html?$/i.test(extra.file)) L.htmlFile = extra.file;
    }
    if (name === "check_page" && passed && extra.pageClean) L.pageOk = L.seq + 1;
    // bg: chỉ KHỞI ĐỘNG một máy chủ nền. Máy chủ dev không báo lỗi CSS/import cho đến khi trang được tải, nên không phải là kiểm chứng
    if (name === "bash" || name === "run_javascript") L.checks.push({ seq: ++L.seq, ok: passed, bg: background });
    if (passed && (name === "read_document" || name === "read_file")) L.reads.push(++L.seq); // đọc lại để kiểm tra
    if (wrote) {
      L.lastEdit = ++L.seq;
      // công cụ Office có cấu trúc đã tự báo lại những gì vừa ghi (số slide + tiêu đề, số đoạn/bảng…): không bắt đọc lại thêm một bước
      if (passed && SELF_REPORTING.has(name)) L.reads.push(++L.seq);
    }
  }

  /** Tóm tắt lượt vừa xong: các tệp đã đổi và đã chạy kiểm tra hay chưa. null nếu lượt này không đổi tệp nào. */
  async turnSummary(): Promise<{ turn: number; files: Awaited<ReturnType<typeof listChanges>>; verify: "ok" | "fail" | "none" } | null> {
    const turn = this.ctx.turn ?? 0;
    if (!turn) return null;
    const files = await listChanges(this.ctx, turn);
    if (!files.length) return null;
    const after = this.turnLog.checks.filter((c) => c.seq > this.turnLog.lastEdit);
    return { turn, files, verify: !after.length ? "none" : after.every((c) => c.ok) ? "ok" : "fail" };
  }

  /** Các điểm quay lại = trước mỗi yêu cầu hiển thị của người dùng (`inputs`: nội dung người dùng đã gõ, nếu khớp). */
  rewindPoints(inputs: string[] = []): { point: RewindPoint; msgIndex: number; turn?: number }[] {
    const msgs = this.main.messages;
    const idx = msgs.map((m, i) => (m.role === "user" && m.content && !isInternalUser(m.content) ? i : -1)).filter((i) => i >= 0);
    const aligned = inputs.length === idx.length;
    return idx.map((mi, k) => {
      const turn = this.turnMarks.get(msgs[mi]);
      const raw = aligned ? inputs[k] : (msgs[mi].content ?? "").split(/\n\n\[(?:Nội dung các tệp được đính kèm|Thông tin thêm từ hook)/)[0];
      const files = turn === undefined ? 0 : new Set(this.ctx.undoStack.filter((e) => (e.turn ?? 0) >= turn).map((e) => e.path)).size;
      return { point: { index: k, text: raw.replace(/\s+/g, " ").trim().slice(0, 200), files }, msgIndex: mi, turn };
    });
  }

  /** Cắt hội thoại về trước tin nhắn `msgIndex`; nếu `files` thì khôi phục cả các tệp đã đổi từ lượt `turn`. */
  async rewindTo(msgIndex: number, turn: number | undefined, files: boolean): Promise<RevertResult> {
    const r: RevertResult = files && turn !== undefined ? await revertChanges(this.ctx, { fromTurn: turn }) : { reverted: [], skipped: [] };
    this.main.messages = this.main.messages.slice(0, msgIndex);
    this.ctx.todos = [];
    if (r.reverted.length) this.emit({ type: "files_changed", paths: r.reverted });
    return r;
  }

  private estTokens(chars: number, scale: number): number {
    return Math.round(chars * scale);
  }

  /** /memory: các tệp hướng dẫn đang nạp và quy tắc chưa nạp. */
  private memoryReport(): string {
    const lines = this.memory.map((m) => `✓ ${m.name} (${m.text.length} ký tự)`);
    for (const r of this.rules) {
      if (this.memory.some((m) => m.name === r.name)) continue;
      if (r.trigger === "glob") lines.push(`· ${r.name}: chờ agent đụng tới ${r.globs.join(", ")}`);
      else if (r.trigger === "model") lines.push(`· ${r.name}: agent tự đọc khi liên quan${r.description ? " (" + r.description + ")" : ""}`);
      else if (r.trigger === "manual") lines.push(`· ${r.name}: chỉ dùng khi bạn nhắc @${r.name}`);
    }
    if (!lines.length) return "Chưa có tệp hướng dẫn nào. Gõ /init để agent soạn AGENTS.md, hoặc tự tạo AGENTS.md ở thư mục dự án (toàn cục: ~/.neuagent/AGENTS.md).";
    return lines.join("\n") + "\nSửa AGENTS.md: nút 📝 cạnh tên dự án, hoặc nhờ agent (luôn cần bạn duyệt). Có hiệu lực từ lượt hỏi tiếp theo.";
  }

  /** /usage: token đã dùng trong phiên này. */
  usageReport(): string {
    const cached = this.cachedTokens ? ` (${this.cachedTokens} token lời nhắc dùng lại từ bộ nhớ đệm)` : "";
    return `Phiên này: ${this.promptTokens} token vào, ${this.completionTokens} token ra, ${this.calls} lần gọi mô hình${cached}\nNgữ cảnh đang dùng: ~${this.contextPct()}%`;
  }

  /** /context: ngữ cảnh đang dùng vào việc gì (ước lượng, hiệu chỉnh theo số token thật của lần gọi gần nhất). */
  private contextReport(): string {
    const limit = this.o.getSettings().contextTokens;
    const sysAll = this.systemPrompt(null, 0).length;
    const base = brandText(PROFILES[this.profile].systemBase).length;
    const mem = this.memory.reduce((n, m) => n + m.text.length, 0);
    const tools = JSON.stringify(this.toolsFor(null, 0).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))).length;
    const msgs = this.main.messages;
    const part = (role: string) => msgs.filter((m) => m.role === role).reduce((n, m) => n + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
    const [u, a, t] = [part("user"), part("assistant"), part("tool")];
    const all = sysAll + tools + u + a + t;
    // cùng con số với thước ngữ cảnh ở thanh trên (đã hiệu chỉnh theo token thật), chia theo tỉ lệ ký tự
    const used = this.main.estimateTokens();
    const scale = all > 0 ? used / all : 0;
    const k = (c: number) => { const n = this.estTokens(c, scale); return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); };
    const pct = this.contextPct();
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    const rows: [string, string][] = [["Lời nhắc hệ thống", k(base + (sysAll - base - mem))], ["Công cụ", k(tools)], ...(this.memory.length <= 6 ? this.memory.map((m) => [m.name, k(m.text.length)] as [string, string]) : mem ? [["Hướng dẫn dự án (" + this.memory.length + " tệp)", k(mem)] as [string, string]] : []), ["Tin nhắn của bạn", k(u)], ["Trả lời của agent", k(a)], ["Kết quả công cụ", k(t)], ["Còn trống", limit - used >= 1000 ? ((limit - used) / 1000).toFixed(1) + "k" : String(Math.max(0, limit - used))]];
    return `${bar} ~${pct}% · ${used}/${limit} token\n` + rows.map(([n, v]) => `${n.padEnd(20)} ${v}`).join("\n") + `\nTổng: ${this.promptTokens} token vào / ${this.completionTokens} ra · ${this.calls} lần gọi`;
  }

  /** /status: tình trạng phiên (kiểu Codex). */
  private async statusReport(): Promise<string> {
    const s = this.o.getSettings();
    const ch = this.profile === "code" ? (await listChanges(this.ctx)).length : 0;
    const procs = this.ctx.procs?.list().filter((p) => p.alive).length ?? 0;
    return [
      `Mô hình: ${s.model} · Chế độ: ${this.mode}`,
      `Thư mục: ${this.ctx.root}`,
      `Terminal: ${this.o.env.exec ? "có" : "không"}${this.o.env.sandbox ? ` · sandbox ${this.o.env.sandbox.kind}${this.o.env.sandbox.network ? "" : ", không mạng"}` : this.o.env.exec ? " · không sandbox" : ""}`,
      `Ngữ cảnh ~${this.contextPct()}% · ${this.calls} lần gọi · ${this.main.messages.length} tin nhắn`,
      ...(this.profile === "code" ? [`Đã thay đổi ${ch} tệp · ${procs} tiến trình nền`] : []),
      `Hướng dẫn dự án: ${this.memory.map((m) => m.name).join(", ") || "(chưa có)"}`,
    ].join("\n");
  }

  contextPct(): number {
    return Math.min(99, Math.floor((100 * this.main.estimateTokens()) / this.o.getSettings().contextTokens));
  }
  /** Cửa sổ ngữ cảnh đang dùng vào việc gì (token ước lượng; tổng khớp thước ngữ cảnh, chia theo tỉ lệ ký tự). */
  contextBreakdown(): { used: number; limit: number; parts: { name: string; tokens: number }[] } {
    const limit = this.o.getSettings().contextTokens;
    const used = this.main.estimateTokens();
    const mem = this.memory.reduce((n, m) => n + m.text.length, 0);
    const sysAll = this.systemPrompt(null, 0).length;
    const tools = this.toolsChars || JSON.stringify(this.toolsFor(null, 0).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))).length;
    const bytes = (role: string) => this.main.messages.filter((m) => m.role === role).reduce((n, m) => n + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
    const raw: [string, number][] = [
      ["Lời nhắc hệ thống", Math.max(0, sysAll - mem)], ["Công cụ", tools], ["Hướng dẫn dự án", mem],
      ["Tin nhắn của bạn", bytes("user")], ["Trả lời của AI", bytes("assistant")], ["Kết quả công cụ", bytes("tool")],
    ];
    const all = raw.reduce((n, [, c]) => n + c, 0);
    const scale = all > 0 ? used / all : 0;
    return { used, limit, parts: raw.map(([name, c]) => ({ name, tokens: Math.round(c * scale) })).filter((x) => x.tokens > 0) };
  }
  emitUsage(): void {
    this.emit({ type: "usage", promptTokens: this.promptTokens, completionTokens: this.completionTokens, contextPct: this.contextPct(), calls: this.calls, cachedTokens: this.cachedTokens, context: this.contextBreakdown() });
  }
  publicSettings() {
    return toPublic(this.o.getSettings());
  }
}

// ================================================================== Agent

export class Agent {
  messages: ChatMessage[] = [];
  private repeatKey = "";
  private repeatN = 0;
  /** Các lệnh gọi gần nhất (để phát hiện xen kẽ A,B,A,B…) và chuỗi lỗi liên tiếp cùng công cụ cùng lý do. */
  private hist: string[] = [];
  private cycleN = 0;
  private failRun = { tool: "", sig: "", n: 0 };
  private stopWhy = "";
  private nudges = 0;
  private pageChecks = 0;
  private lastReminder = 0;
  private pruneNoted = false;
  private lastPageProblem = "";

  constructor(private s: Session, private def: AgentDef | null = null, private depth = 0) {}

  /** Neo ước lượng: số token THẬT của lần gọi gần nhất (usage.prompt_tokens) và số ký tự đã gửi lúc đó. */
  private anchor: { tokens: number; chars: number } | null = null;

  private promptChars(): number {
    const tools = this.depth === 0 ? this.s.toolsChars : 0;
    return this.s.systemPrompt(this.def, this.depth).length + JSON.stringify(this.messages).length + tools;
  }

  /**
   * Số token lời nhắc hiện tại (gồm lược đồ công cụ). Sau lần gọi đầu tiên: token thật của lần gọi gần nhất cộng phần thay đổi
   * (tin mới, hoặc bớt đi sau khi tóm tắt) quy đổi bằng tỉ lệ ký tự/token đã hiệu chỉnh — sát thực tế hơn nhiều so với chia cả khối.
   */
  estimateTokens(): number {
    const chars = this.promptChars();
    if (this.depth === 0 && this.anchor) {
      const est = this.anchor.tokens + (chars - this.anchor.chars) / this.s.charsPerToken;
      return Math.max(Math.floor(chars / (this.s.charsPerToken * 2)), Math.floor(est));
    }
    return Math.floor(chars / this.s.charsPerToken);
  }

  pruneToolResults(keepLast = 4): number {
    const idx = this.messages.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
    let n = 0;
    // GIỮ kết quả ĐỌC TỆP gần đây (tới ngân sách ký tự), không chỉ 4 kết quả cuối: làm việc với từ 5 tệp trở lên thì tệp cũ nhất bị lược rồi
    // mô hình đọc lại nó, việc đó lược tệp kế tiếp… thành vòng lặp mãi (ảnh thật: chu kỳ 5 lần đọc). Chỉ lược kết quả đọc khi quá ngân sách
    // hoặc tệp đã bị sửa sau đó (nội dung đã cũ).
    const readNames = new Set(["read_file", "read_document"]);
    const nameOf = new Map<string, string>();
    const argsOf = new Map<string, string>();
    for (const m of this.messages) for (const tc of m.role === "assistant" ? m.tool_calls ?? [] : []) { nameOf.set(tc.id, tc.function.name); argsOf.set(tc.id, tc.function.arguments); }
    const protectedIdx = new Set<number>();
    // ngân sách theo cửa sổ ngữ cảnh: tối đa ~1/4 cửa sổ dành cho tệp đang làm việc (còn lại cho lời nhắc, công cụ, lịch sử)
    let budget = Math.min(READ_KEEP_CHARS, Math.floor(this.s.o.getSettings().contextTokens * this.s.charsPerToken * 0.25));
    const seenPath = new Set<string>();
    for (const i of [...idx].reverse()) {
      const m = this.messages[i];
      if (!readNames.has(nameOf.get(m.tool_call_id ?? "") ?? "")) continue;
      const c = m.content ?? "";
      if (c.endsWith(PRUNE_MARK) || c.startsWith("Lỗi")) continue;
      let p = "";
      try { p = String((JSON.parse(argsOf.get(m.tool_call_id ?? "") ?? "{}") as { path?: unknown }).path ?? ""); } catch { /* bỏ qua */ }
      if (p && seenPath.has(p)) continue; // lần đọc cũ hơn của cùng tệp: không cần giữ
      if (c.length > budget) break;
      budget -= c.length;
      if (p) seenPath.add(p);
      protectedIdx.add(i);
    }
    for (const i of keepLast ? idx.slice(0, -keepLast) : idx) {
      if (protectedIdx.has(i)) continue;
      const c = this.messages[i].content ?? "";
      if (c.length > 300 && !c.endsWith(PRUNE_MARK)) {
        this.messages[i].content = c.slice(0, 200) + " … " + PRUNE_MARK;
        n++;
      }
    }
    // Nội dung tệp vừa ghi nằm trong ĐỐI SỐ của lời gọi (không phải kết quả): một tệp CSS 14k ký tự ≈ 5k token cứ ở lại mãi trong lịch sử dù
    // đã nằm trên đĩa (đã gặp: phiên làm ứng dụng đồng hồ phải tóm tắt ngữ cảnh 3 lần). Thay các chuỗi lớn của lời gọi cũ bằng dấu vết ngắn.
    const asst = this.messages.map((m, i) => (m.role === "assistant" && m.tool_calls?.length ? i : -1)).filter((i) => i >= 0);
    for (const i of keepLast ? asst.slice(0, -keepLast) : asst) {
      for (const tc of this.messages[i].tool_calls ?? []) {
        if (!BULKY_ARGS.has(tc.function.name) || tc.function.arguments.length < 800) continue;
        try {
          const o = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          let changed = false;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === "string" && v.length > 400) {
              o[k] = prunedArgNote(v.length);
              changed = true;
            }
          }
          if (changed) {
            tc.function.arguments = JSON.stringify(o);
            n++;
          }
        } catch {
          /* đối số không phải JSON (bị cắt): để nguyên */
        }
      }
    }
    return n;
  }

  /**
   * Cổng tự kiểm tra (một lần mỗi lượt): agent sắp báo cáo xong nhưng vừa tạo/sửa tệp mà chưa kiểm chứng → nhắc làm ngay.
   * Code: chưa chạy thử / lần chạy cuối bị lỗi. Work/Design: chưa đọc lại tệp vừa tạo. Không làm gì nếu môi trường không có công cụ để kiểm chứng.
   */
  /** Các kết quả công cụ gần nhất phần lớn là lỗi (lỗi công cụ hoặc lệnh thoát khác 0). */
  private failingStreak(): boolean {
    const tools = this.messages.filter((m) => m.role === "tool").slice(-5);
    if (tools.length < 4) return false;
    const bad = tools.filter((m) => /^Lỗi/.test(m.content ?? "") || /\[mã thoát [1-9]\d*\]\s*$/.test((m.content ?? "").slice(-60))).length;
    return bad >= 4;
  }

  /**
   * Tab Code (Desktop): agent sắp báo "xong" mà vừa sửa mã/giao diện web. Đừng trông chờ mô hình tự nhớ gọi check_page (dữ liệu thật: 0 lần gọi
   * trong cả phiên dựng ứng dụng, người dùng phải chép lỗi console 6 lần): hệ thống TỰ mở thử trang; có lỗi/trang trắng thì trả báo cáo cho mô hình sửa.
   * Tối đa 3 lần mỗi lượt. Trang sạch thì ghi nhận để không nhắc thêm.
   */
  private async autoPageCheck(signal?: AbortSignal): Promise<string | null> {
    const s = this.s;
    const L = s.turnLog;
    const tool = s.tools.get("check_page");
    if (s.profile !== "code" || !tool || !L.webEdit || L.pageOk > L.webEdit) return null;
    if (this.pageChecks >= 3) {
      // hết lượt tự sửa mà trang vẫn lỗi: cho kết thúc nhưng nói THẲNG với người dùng (không để lời "xong" của mô hình che mất)
      if (this.lastPageProblem) {
        const first = this.lastPageProblem.split("\n").find((l) => /^\s*1\.\s/.test(l))?.trim() ?? "";
        s.emit({ type: "notice", level: "warn", text: `Trang web vẫn còn lỗi sau ${this.pageChecks} lần tự sửa${first ? ": " + first.slice(0, 200) : ""}. Hãy kiểm tra lại, hoặc nhắn agent làm tiếp.` });
        this.lastPageProblem = "";
      }
      return null;
    }
    let server = s.ctx.procs?.list().filter((p) => p.alive && p.url).pop();
    // chưa có máy chủ chạy (agent quên bật, hoặc người dùng phải nhắn "bật ứng dụng đi"): ở chế độ Tự động thì tự bật máy chủ dev của dự án
    // để kiểm tra trang và để nút "Mở localhost" sẵn cho người dùng
    if (!server && !L.htmlFile && s.ctx.procs && (s.perms.mode === "auto" || s.perms.mode === "bypass")) {
      const cmd = (await detectRun(s.o.env, s.ctx.root).catch(() => [])).find((x) => x.kind === "run" && x.background)?.command;
      if (cmd) {
        try {
          const info = s.ctx.procs.start(cmd, s.ctx.root);
          await s.ctx.procs.settle(info.id, 8000);
          server = s.ctx.procs.get(info.id)?.info.alive ? s.ctx.procs.get(info.id)!.info : undefined;
          if (server?.url) s.emit({ type: "notice", level: "info", text: `Đã bật ứng dụng để kiểm tra: ${server.url}` });
        } catch {
          /* không bật được: bỏ qua, không chặn việc báo cáo */
        }
      }
    }
    const url = server?.url ?? (L.htmlFile ? relPath(s.ctx, L.htmlFile) : "");
    if (!url) return null;
    let text: string;
    try {
      text = await tool.run({ ...s.ctx, signal }, { url, wait_ms: 1500 });
    } catch {
      return null; // không kiểm tra được (cửa sổ ẩn lỗi…): không chặn việc báo cáo
    }
    if (/KẾT QUẢ: ổn/.test(text)) {
      L.pageOk = ++L.seq;
      return null;
    }
    this.lastPageProblem = text;
    return "[Hệ thống] Bạn chưa tự kiểm tra trang, nên hệ thống đã mở thử giúp và THẤY LỖI. Đừng báo xong khi trang còn lỗi.\n" + text;
  }

  private verifyNudge(): string | null {
    const s = this.s;
    const L = s.turnLog;
    if (this.nudges >= 1 || !L.lastEdit) return null;
    if (s.profile === "code") {
      if (!s.tools.has("bash") && !s.tools.has("run_javascript")) return null;
      const after = L.checks.filter((c) => c.seq > L.lastEdit);
      if (!after.length) return "[Hệ thống] Bạn vừa tạo hoặc sửa tệp nhưng CHƯA chạy thử. Hãy chạy chương trình hoặc bộ kiểm thử ngay bây giờ (bash hoặc run_javascript; máy chủ web thì chạy nền), đọc kết quả thật, sửa lỗi nếu có, rồi mới báo cáo. Nếu thật sự không chạy được thì nói rõ lý do cho người dùng.";
      // chỉ mới KHỞI ĐỘNG máy chủ nền (chưa build/lint/gọi trang): máy chủ dev không báo lỗi thiếu import hay CSS hỏng cho đến khi có người tải trang
      if (after.every((c) => c.bg) && !(L.pageOk > L.lastEdit)) return "[Hệ thống] Bạn mới khởi động máy chủ nền, chưa kiểm chứng gì: máy chủ dev không báo lỗi thiếu import, CSS hỏng hay API sai cho đến khi trang được tải. " + (s.tools.has("check_page") ? "Hãy gọi check_page rồi sửa mọi lỗi nó báo." : "Hãy chạy `npm run build` và `npm run lint` (nếu dự án có; no-undef / jsx-no-undef bắt lỗi thiếu import) rồi sửa mọi lỗi.") + " Chỉ báo xong khi sạch lỗi.";
      if (!after[after.length - 1].ok) return "[Hệ thống] Lần chạy kiểm tra gần nhất của bạn bị LỖI. Hãy đọc lỗi, tìm nguyên nhân gốc, sửa rồi chạy lại cho đến khi qua; đừng báo là đã xong khi chưa qua.";
      return null;
    }
    if (!L.reads.some((r) => r > L.lastEdit)) {
      return s.profile === "work"
        ? "[Hệ thống] Bạn vừa tạo hoặc sửa tài liệu nhưng chưa ĐỌC LẠI để kiểm tra. Hãy read_document lại tệp vừa tạo, đối chiếu số liệu, công thức, tên riêng và thể thức với nguồn, sửa chỗ sai rồi mới báo cáo."
        : "[Hệ thống] Bạn vừa tạo hoặc sửa thiết kế nhưng chưa ĐỌC LẠI để kiểm tra. Hãy read_file tệp vừa ghi và chạy danh sách kiểm tra (không có <script>/tài nguyên ngoài, thẻ đã đóng, đúng khổ, dấu tiếng Việt đúng, chữ không tràn khung), sửa chỗ sai rồi mới báo cáo.";
    }
    return null;
  }

  /**
   * Khi agent đọc lại CẢ MỘT tệp đã đọc trước đó, kết quả đọc cũ của tệp ấy là dư thừa (bản mới đầy đủ và mới hơn nằm ngay sau): thay bằng một dòng ngắn
   * để không gửi lại hàng nghìn token ở mọi bước sau. Không đụng tới lần đọc theo đoạn (offset) hay tệp khác.
   */
  private dedupeReads(call: { id: string; name: string; arguments: string }): number {
    if (call.name !== "read_file") return 0;
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "tool" || last.tool_call_id !== call.id || (last.content ?? "").startsWith("Lỗi")) return 0;
    const whole = (args: string): string | null => {
      try {
        const a = JSON.parse(args) as { path?: unknown; offset?: unknown; limit?: unknown };
        // chỉ lần đọc CẢ tệp (không offset, không giới hạn số dòng): đọc theo đoạn không thay thế được nhau
        return typeof a.path === "string" && a.path && !(Number(a.offset) > 1) && !(Number(a.limit) > 0) ? a.path : null;
      } catch {
        return null;
      }
    };
    const p = whole(call.arguments);
    if (!p) return 0;
    const older = new Set<string>();
    for (const m of this.messages) for (const tc of m.role === "assistant" ? (m.tool_calls ?? []) : []) if (tc.id !== call.id && tc.function.name === "read_file" && whole(tc.function.arguments) === p) older.add(tc.id);
    let n = 0;
    for (const m of this.messages) {
      if (m.role === "tool" && m.tool_call_id && older.has(m.tool_call_id) && (m.content?.length ?? 0) > 300 && !m.content!.endsWith(PRUNE_MARK)) {
        m.content = "(nội dung cũ của tệp này đã được thay bằng lần đọc mới hơn ở bên dưới) " + PRUNE_MARK;
        n++;
      }
    }
    return n;
  }

  private async manageContext(): Promise<void> {
    const limit = this.s.o.getSettings().contextTokens;
    if (this.estimateTokens() > 0.45 * limit && this.pruneToolResults() && !this.pruneNoted) {
      this.pruneNoted = true; // một lần mỗi lượt: bài thử thật phát thông báo này ~20 lần liên tiếp
      this.s.emit({ type: "notice", level: "info", text: "Đã lược bớt kết quả công cụ cũ để tiết kiệm ngữ cảnh." });
    }
    const used = this.estimateTokens();
    // quá 75% cửa sổ, hoặc còn dưới ~3k token cho câu trả lời (lời gọi công cụ dài sẽ bị cắt giữa chừng): tóm tắt phần cũ trước
    if (used > 0.75 * limit || limit - used - 600 < 3000) await this.compact("", true);
  }

  private transcript(maxChars = 14000): string {
    const lines = this.messages.map((m) => {
      if (m.role === "tool") return "[tool result] " + (m.content ?? "").slice(0, 400);
      if (m.role === "assistant") {
        const calls = (m.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments.slice(0, 120)})`).join("; ");
        return "[assistant] " + (m.content ?? "").slice(0, 600) + (calls ? " -> calls: " + calls : "");
      }
      return "[user] " + (m.content ?? "").slice(0, 1200);
    });
    const t = lines.join("\n");
    return t.length > maxChars ? t.slice(0, 3000) + "\n… (omitted) …\n" + t.slice(-(maxChars - 3000)) : t;
  }

  async compact(focus = "", midturn = false): Promise<boolean> {
    if (this.messages.length < 3) return false;
    this.s.emit({ type: "notice", level: "info", text: "Đang tóm tắt hội thoại để giải phóng ngữ cảnh…" });
    const user = "Conversation to summarize:\n\n" + this.transcript() + (focus ? "\n\nSpecial focus: " + focus : "");
    let r: ChatResult;
    try {
      r = await this.s.o.llm.chat([{ role: "system", content: SUMMARY_SYSTEM }, { role: "user", content: user }], { maxTokens: 900, temperature: 0.1, thinking: false, signal: this.s.ctx.signal });
    } catch (e) {
      this.s.emit({ type: "notice", level: "error", text: "Không tóm tắt được: " + (e as Error).message });
      return false;
    }
    this.s.track(r.usage, user.length);
    this.messages = [
      { role: "user", content: "[Tóm tắt phần hội thoại trước đó, để tiết kiệm ngữ cảnh]\n" + (r.content.trim() || "(không có tóm tắt)") },
      { role: "assistant", content: "Đã nắm bối cảnh, tôi sẽ tiếp tục từ đây." },
    ];
    if (midturn) this.messages.push({ role: "user", content: "Hãy tiếp tục công việc đang làm dở theo bản tóm tắt ở trên." });
    return true;
  }

  /** Sau khi bị ngắt giữa chừng: mọi tool_call đều phải có kết quả. */
  repairHistory(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.tool_calls) {
        const answered = new Set(this.messages.slice(i + 1).filter((x) => x.role === "tool").map((x) => x.tool_call_id));
        for (const c of m.tool_calls) if (!answered.has(c.id)) this.messages.push({ role: "tool", tool_call_id: c.id, content: "Bị người dùng ngắt." });
        return;
      }
      if (m.role === "user") return;
    }
  }

  async runTurn(userText: string, signal?: AbortSignal): Promise<string> {
    const s = this.s;
    s.ctx.signal = signal;
    if (this.depth === 0) {
      s.perms.tainted = false;
      if (s.hooks) {
        const hr = await s.hooks.run("UserPromptSubmit", { prompt: userText }, signal);
        for (const w of hr.warnings) s.emit({ type: "notice", level: "warn", text: w });
        if (hr.blocked) {
          s.emit({ type: "notice", level: "error", text: "Yêu cầu bị chặn bởi hook: " + hr.message });
          return "";
        }
        if (hr.context) userText += "\n\n[Thông tin thêm từ hook]\n" + hr.context;
      }
    }
    const userMsg: ChatMessage = { role: "user", content: userText };
    this.messages.push(userMsg);
    if (this.depth === 0) s.beginTurn(userMsg);
    let stopRetries = 0;
    // Hạn mức bước là CHẶN AN TOÀN chống chạy vô hạn, không phải điểm dừng để người dùng gõ "tiếp tục": tác tử chính được tới 3 lần
    // số bước cài đặt trong một lượt (chuyện lặp vô ích đã có các chốt riêng: lặp lệnh, lặp lỗi, lặp chữ).
    const maxSteps = this.depth === 0 ? s.o.getSettings().maxSteps * 3 : 25;
    let final = "";
    this.repeatKey = "";
    this.repeatN = 0;
    this.hist = [];
    this.cycleN = 0;
    this.failRun = { tool: "", sig: "", n: 0 };
    this.stopWhy = "";
    this.nudges = 0;
    this.pageChecks = 0;
    this.pruneNoted = false;
    this.lastPageProblem = "";
    this.repeats = 0;
    this.lastReminder = 0;
    const goal = userText.replace(/\s+/g, " ").trim().slice(0, 300);
    try {
      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) throw new LlmError("Đã dừng.", 0, "abort");
        if (this.depth === 0) for (const q of s.queue.splice(0)) this.messages.push({ role: "user", content: "[Tin nhắn mới của người dùng, gửi khi bạn đang làm việc. Hãy tính đến nó ngay từ bước này]\n" + q });
        if (maxSteps >= 10 && maxSteps - step === Math.max(3, Math.floor(maxSteps * 0.15))) this.messages.push({ role: "user", content: `[Hệ thống] Chỉ còn ${maxSteps - step} bước trong lượt này. Hãy ưu tiên hoàn thành phần quan trọng nhất, rồi tóm tắt: đã làm gì và còn thiếu gì.` });
        // chống "quên việc chính": sa vào sửa một lỗi phụ nhiều bước thì mô hình mất mục tiêu ban đầu (người dùng phản ánh). Nhắc lại ĐÚNG câu giao việc
        // + danh sách việc cần làm: định kỳ mỗi 8 bước, hoặc sớm hơn khi các lệnh gần nhất liên tiếp lỗi.
        if (this.depth === 0 && step > 0) {
          const since = step - this.lastReminder;
          if (since >= 8 || (since >= 3 && this.failingStreak())) {
            this.lastReminder = step;
            const todos = s.ctx.todos ?? [];
            const list = todos.length ? "\nViệc cần làm: " + todos.slice(0, 8).map((t) => `${t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "○"} ${t.content}`).join(" | ") : "";
            this.messages.push({
              role: "user",
              content: `[Hệ thống] Nhắc việc chính người dùng giao: “${goal}”.${list}\nĐang xử lý việc phụ (lỗi, cài đặt…) thì chỉ làm mức tối thiểu để việc chính chạy tiếp (tối đa vài lần thử), rồi QUAY LẠI việc chính và làm cho xong. Nếu kẹt, nói rõ với người dùng thay vì sửa mãi.`,
            });
          }
        }
        await this.manageContext();
        const resp = await this.callModel(signal);
        this.lastFinish = resp.finish;
        if (resp.finish === "repeat") {
          this.repeats++;
          s.emit({ type: "notice", level: "warn", text: "Agent bắt đầu lặp lại một đoạn văn nên đã bị dừng sinh chữ và được nhắc đổi cách làm." });
          this.messages.push({ role: "assistant", content: resp.content || "(đã dừng vì lặp lại một đoạn văn)" });
          s.emit({ type: "message_end", depth: this.depth, text: resp.content });
          if (this.repeats >= 3) return final || resp.content || "Agent liên tục lặp lại một đoạn văn nên đã dừng. Hãy nói lại yêu cầu ngắn gọn hơn hoặc chia thành các bước nhỏ.";
          this.messages.push({ role: "user", content: "[Hệ thống] Bạn vừa lặp lại cùng một đoạn văn nhiều lần mà không làm gì. Đừng giải thích hay lên kế hoạch nữa: hãy GỌI CÔNG CỤ ngay để làm bước tiếp theo (nếu việc quá dài thì chia nhỏ từng phần, mỗi lần dưới ~5.000 ký tự), hoặc nói ngắn gọn bạn đang vướng ở đâu." });
          continue;
        }
        const msg: ChatMessage = { role: "assistant", content: resp.content || null };
        if (resp.toolCalls.length) msg.tool_calls = resp.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }));
        this.messages.push(msg);
        if (resp.content.trim()) final = resp.content.trim();
        s.emit({ type: "message_end", depth: this.depth, text: resp.content });

        if (!resp.toolCalls.length) {
          if (this.depth === 0 && s.mode === "plan" && resp.content.trim()) {
            // mô hình in kế hoạch ra văn bản thay vì gọi exit_plan_mode: vẫn xin người dùng duyệt
            const fb = await s.exitPlanMode(resp.content.trim(), this.depth);
            this.messages.push({ role: "user", content: fb });
            if (s.mode !== "plan") continue;
            if (fb.startsWith("Người dùng chưa duyệt")) continue;
          }
          if (this.depth === 0 && s.queue.length) continue; // người dùng vừa nhắn thêm: trả lời luôn trong lượt này
          if (resp.finish === "length") s.emit({ type: "notice", level: "warn", text: "Câu trả lời bị cắt do hết độ dài tối đa." });
          if (this.depth === 0 && s.hooks) {
            const hr = await s.hooks.run("Stop", { prompt: userText }, signal);
            for (const w of hr.warnings) s.emit({ type: "notice", level: "warn", text: w });
            if (hr.blocked && stopRetries < 2) {
              stopRetries++;
              s.emit({ type: "notice", level: "info", text: "Hook Stop yêu cầu làm tiếp: " + hr.message.split("\n")[0] });
              this.messages.push({ role: "user", content: "[Hook Stop phản hồi]\n" + hr.message });
              continue;
            }
          }
          const auto = this.depth === 0 && !signal?.aborted ? await this.autoPageCheck(signal) : null;
          if (auto) {
            this.pageChecks++;
            s.emit({ type: "notice", level: "info", text: "Trang web có lỗi, đang sửa tiếp…" });
            this.messages.push({ role: "user", content: auto });
            continue;
          }
          const nudge = this.depth === 0 && !signal?.aborted ? this.verifyNudge() : null;
          if (nudge) {
            // cổng tự kiểm tra: vừa tạo/sửa mà chưa chạy thử / chưa đọc lại thì nhắc MỘT lần trước khi cho báo cáo
            this.nudges++;
            s.emit({ type: "notice", level: "info", text: "Đang tự kiểm tra lại kết quả trước khi báo cáo…" });
            this.messages.push({ role: "user", content: nudge });
            continue;
          }
          return final;
        }
        for (const c of resp.toolCalls) {
          if (signal?.aborted) {
            this.messages.push({ role: "tool", tool_call_id: c.id, content: "Bị người dùng ngắt." });
            continue;
          }
          const key = c.name + "\u0000" + c.arguments;
          this.repeatN = key === this.repeatKey ? this.repeatN + 1 : 1;
          this.repeatKey = key;
          let result = await this.execute(c);
          if (this.repeatN >= 3) result += `\n[Cảnh báo] Bạn đã gọi cùng công cụ với cùng tham số ${this.repeatN} lần liên tiếp mà không tiến triển. Hãy đổi cách tiếp cận, hoặc dừng lại và báo cáo người dùng.`;
          result += this.watch(c.name, key, result);
          this.messages.push({ role: "tool", tool_call_id: c.id, content: result });
          this.dedupeReads(c);
        }
        if (signal?.aborted) throw new LlmError("Đã dừng.", 0, "abort");
        if (this.repeatN >= 5) {
          s.emit({ type: "notice", level: "warn", text: this.stopWhy ? `Agent lặp lại cùng một thao tác ${this.stopWhy} nên đã dừng.` : `Agent lặp lại cùng một thao tác ${this.repeatN} lần nên đã dừng.` });
          // thay vì im lặng: nhờ mô hình nói rõ đang kẹt ở đâu và cần người dùng cung cấp/quyết định gì
          const why = await this.wrapUp(signal, "[Hệ thống] Bạn đã bị dừng vì cứ lặp lại thao tác mà không tiến triển. Không gọi công cụ nữa. Hãy nói ngắn gọn: bạn đang cố làm gì, vì sao bị kẹt, và cần người dùng cung cấp thông tin hay quyết định gì để làm tiếp.");
          return why || final || "(đã dừng vì lặp vô ích)";
        }
      }
      s.emit({ type: "notice", level: "warn", text: `Đã đạt giới hạn an toàn ${maxSteps} bước trong một lượt.` });
      // một lượt cuối không dùng công cụ để người dùng nhận được bản tóm tắt tiến độ (thay vì lượt kết thúc đột ngột)
      return (await this.wrapUp(signal, "[Hệ thống] Đã hết số bước cho phép trong lượt này. Không gọi công cụ nữa. Hãy tóm tắt ngắn gọn: đã làm được gì, còn lại việc gì, và bước tiếp theo bạn đề xuất (nói bạn sẽ làm tiếp phần còn lại ở lượt sau).")) || final;
    } catch (e) {
      if (e instanceof LlmError && e.kind === "abort") {
        this.repairHistory();
        throw e;
      }
      throw e;
    }
  }

  /**
   * Phát hiện lặp ngoài trường hợp "cùng lệnh, cùng tham số": (1) xen kẽ A,B,A,B,A,B; (2) cùng một công cụ lỗi liên tiếp với cùng lý do.
   * Trả về lời nhắc gắn vào kết quả công cụ; khi nặng thì đặt repeatN ≥ 5 để vòng lặp chính dừng. Chương trình của người dùng chạy hỏng (kind "program") và việc bị từ chối không tính là lặp.
   */
  private watch(name: string, key: string, result: string): string {
    const { ok, kind } = this.lastRes;
    const h = this.hist;
    h.push(key);
    if (h.length > 12) h.shift();
    const n = h.length;
    let warn = "";
    // chu kỳ chu kỳ p (2…6 lệnh): cả p lệnh gần nhất lặp lại NGUYÊN VĂN p lệnh liền trước (ảnh thật: đọc đi đọc lại 5 tệp mãi). Với p = 2 cần ba vòng
    // (A,B,A,B,A,B) như trước; p ≥ 3 hai vòng là đủ vì lặp cả chuỗi dài giống hệt gần như không bao giờ là tiến triển.
    let period = 0;
    for (let p = 2; p <= 6 && !period; p++) {
      const need = p === 2 ? 6 : 2 * p;
      if (n < need) continue;
      let same = true;
      for (let i = 1; i <= need - p && same; i++) if (h[n - i] !== h[n - i - p]) same = false;
      if (same && new Set(h.slice(n - p)).size > 1) period = p;
    }
    if (period) {
      this.cycleN++;
      warn += period === 2 ? "\n[Cảnh báo] Bạn đang lặp qua lại giữa hai thao tác mà không tiến triển. Đổi hướng hoặc báo người dùng." : `\n[Cảnh báo] Bạn đang lặp lại cùng một chuỗi ${period} thao tác mà không tiến triển (đọc đi đọc lại cùng tệp). Nội dung đã có ở trên: hãy bắt tay vào sửa/làm, hoặc nói rõ với người dùng bạn đang kẹt ở đâu.`;
      if (this.cycleN >= 3) {
        this.repeatN = Math.max(this.repeatN, 5);
        this.stopWhy = period === 2 ? "qua lại giữa hai thao tác" : "lặp lại cùng một chuỗi thao tác";
      }
    }
    if (ok) this.failRun = { tool: "", sig: "", n: 0 };
    else if (kind !== "program" && kind !== "denied") {
      const sig = result.split("\n")[0].replace(/\d+/g, "#").slice(0, 100);
      this.failRun = this.failRun.tool === name && this.failRun.sig === sig ? { tool: name, sig, n: this.failRun.n + 1 } : { tool: name, sig, n: 1 };
      if (this.failRun.n >= 3) warn += `\n[Cảnh báo] ${name} đã lỗi ${this.failRun.n} lần liên tiếp với cùng lý do. Đừng thử lại cùng cách: đọc kỹ thông báo lỗi, đổi cách làm (đường dẫn, tham số hoặc công cụ khác) hoặc hỏi người dùng.`;
      if (this.failRun.n >= 5) {
        this.repeatN = Math.max(this.repeatN, 5);
        this.stopWhy = `thất bại (${name})`;
      }
    }
    return warn;
  }

  /** Một lượt cuối KHÔNG dùng công cụ để mô hình tóm tắt/giải thích. Chỉ ở lớp agent chính; lỗi (trừ ngắt) thì bỏ qua và dọn lời nhắc. */
  private async wrapUp(signal: AbortSignal | undefined, instruction: string): Promise<string> {
    if (this.depth !== 0 || signal?.aborted) return "";
    const mark = this.messages.length;
    this.messages.push({ role: "user", content: instruction });
    try {
      const resp = await this.callModel(signal, true);
      const text = resp.content.trim();
      if (!text) throw new Error("rỗng");
      this.messages.push({ role: "assistant", content: resp.content });
      this.s.emit({ type: "message_end", depth: 0, text: resp.content });
      return text;
    } catch (e) {
      if (e instanceof LlmError && e.kind === "abort") throw e;
      this.messages.length = mark;
      return "";
    }
  }

  /** Số lần mô hình bị ngắt vì lặp một đoạn văn trong lượt này. */
  private repeats = 0;
  /** Lý do dừng của lần gọi mô hình gần nhất ("length" = hết độ dài đầu ra, lời gọi công cụ có thể bị cắt giữa chừng). */
  private lastFinish: string | null = null;

  /**
   * Số token đầu ra tối đa cho lần gọi này: phần còn lại của cửa sổ ngữ cảnh, tối đa 16.384. Giá trị 4096 (mặc định cũ, đã được lưu vào
   * cài đặt của mọi người) coi như "tự động": 4096 token chỉ đủ ~10.000 ký tự tiếng Việt nên một tệp HTML/bảng dài bị cắt giữa chừng
   * và lời gọi công cụ thành JSON hỏng. Người dùng tự đặt giá trị khác thì tôn trọng (nhưng không vượt phần còn lại của ngữ cảnh).
   */
  private outputBudget(system: string, tools: ToolSchema[]): number {
    const st = this.s.o.getSettings();
    const ctx = st.contextTokens || 32768;
    // cùng cách tính với thước ngữ cảnh (đã gồm lược đồ công cụ, neo theo token thật): trước đây cộng đôi phần công cụ nên "room" tụt
    // về âm ở ~22k token thật và ngân sách rơi xuống sàn 1024 → lời gọi tạo tệp dài luôn bị cắt giữa chừng
    void system; void tools;
    const used = this.estimateTokens();
    const room = ctx - used - 600;
    const want = st.maxOutputTokens && st.maxOutputTokens !== 4096 ? st.maxOutputTokens : 12288;
    return Math.max(Math.min(2048, want), Math.min(want, room, 16384)); // sàn 2048, trừ khi người dùng tự đặt nhỏ hơn
  }

  private async callModel(signal?: AbortSignal, noTools = false): Promise<ChatResult> {
    const s = this.s;
    if (!noTools && this.depth === 0 && !this.def) s.refreshGroups(this.messages);
    const tools: ToolSchema[] = noTools ? [] : s.toolsFor(this.def, this.depth).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (this.depth === 0 && !this.def) s.toolsChars = JSON.stringify(tools).length;
    const system = s.systemPrompt(this.def, this.depth);
    const settings = s.o.getSettings();
    const notify = (text: string) => s.emit({ type: "notice", level: "warn", text });
    const think = !!settings.thinking || (this.depth === 0 && s.ultrathink);
    let resp: ChatResult | null = null;
    // ngắt sớm khi mô hình cứ lặp lại một đoạn văn (vòng lặp sinh chữ tiêu hết token mà không tiến triển)
    const guard = new AbortController();
    const onAbort = () => guard.abort();
    signal?.addEventListener("abort", onAbort);
    let streamed = "";
    let checkedAt = 0;
    let repeatCut = -1;
    const watchText = (t: string) => {
      if (repeatCut >= 0) return;
      streamed += t;
      if (streamed.length - checkedAt < 400) return;
      checkedAt = streamed.length;
      const r = findRepetition(streamed);
      if (r) {
        repeatCut = r.cut;
        guard.abort();
      }
    };
    try {
    for (let attempt = 0; attempt < 2 && !resp; attempt++) {
      try {
        resp = await s.o.llm.chat([{ role: "system", content: system }, ...this.messages], {
          tools,
          signal: guard.signal,
          thinking: think,
          maxTokens: this.outputBudget(system, tools),
          notify,
          onContent: (t) => {
            watchText(t);
            if (this.depth === 0 && repeatCut < 0) s.emit({ type: "text", depth: 0, delta: t });
          },
          onReasoning: this.depth === 0 && think ? (t) => s.emit({ type: "reasoning", depth: 0, delta: t }) : undefined,
        });
      } catch (e) {
        if (repeatCut >= 0 && !signal?.aborted) {
          // bị ngắt vì lặp: giữ lại phần chữ trước lần lặp
          resp = { content: streamed.slice(0, repeatCut).trim(), reasoning: "", toolCalls: [], usage: {}, finish: "repeat" } as ChatResult;
          break;
        }
        if (e instanceof LlmError && e.kind === "context" && attempt === 0) {
          s.emit({ type: "notice", level: "warn", text: "Ngữ cảnh đầy, đang rút gọn rồi thử lại…" });
          this.pruneToolResults(1);
          if (!(await this.compact("", this.messages[this.messages.length - 1]?.role === "tool"))) throw e;
          continue;
        }
        throw e;
      }
    }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (!resp) throw new LlmError("Không gọi được mô hình.");
    if (repeatCut >= 0 && resp.finish !== "repeat" && !signal?.aborted) resp = { ...resp, content: streamed.slice(0, repeatCut).trim(), toolCalls: [], finish: "repeat" };
    const sentChars = system.length + JSON.stringify(this.messages).length + (this.depth === 0 ? s.toolsChars : 0);
    s.track(resp.usage, sentChars);
    if (this.depth === 0 && (resp.usage.prompt_tokens ?? 0) > 200) this.anchor = { tokens: resp.usage.prompt_tokens!, chars: sentChars };
    if (this.depth === 0) s.emitUsage(); // sau MỖI lần gọi mô hình: thước ngữ cảnh cập nhật ngay và chẩn đoán biết đỉnh token của từng lượt
    s.emitUsage();
    return resp;
  }

  // ---------------------------------------------------------------- chạy công cụ
  /** Kết quả công cụ gần nhất (để phát hiện lặp). */
  private lastRes: { ok: boolean; kind?: string } = { ok: true };
  private done(tc: { id: string }, name: string, ok: boolean, output: string, kind?: string): void {
    this.lastRes = { ok, kind };
    this.s.emit({ type: "tool_result", id: tc.id, name, ok, output, depth: this.depth, ...(kind ? { errKind: kind } : {}) });
  }

  private async execute(tc: { id: string; name: string; arguments: string }): Promise<string> {
    const s = this.s;
    const { name } = tc;
    const tool = s.tools.get(name);
    if (tool && this.depth === 0 && !this.def) {
      const g = groupOfTool(s.profile, name);
      if (g) s.enableGroups([g]);
    }
    const allowed = new Set(s.toolsFor(this.def, this.depth).map((t) => t.name));
    let args: Record<string, unknown>;
    try {
      const parsed = tc.arguments.trim() ? JSON.parse(tc.arguments) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("tham số phải là object");
      args = parsed;
    } catch (e) {
      s.emit({ type: "tool_start", id: tc.id, name, summary: "tham số không hợp lệ", args: {}, depth: this.depth });
      if (this.lastFinish === "length") s.emit({ type: "notice", level: "warn", text: "Lời gọi công cụ bị cắt vì nội dung quá dài so với độ dài đầu ra tối đa; agent sẽ được nhắc chia nhỏ." });
      const out = this.lastFinish === "length"
        ? `Lỗi: lời gọi ${name} bị CẮT GIỮA CHỪNG vì nội dung quá dài so với độ dài đầu ra tối đa của một lần trả lời (${(e as Error).message}). Gọi lại y hệt sẽ lại bị cắt. Hãy CHIA NHỎ: Word dùng create_docx phần đầu rồi create_docx cùng path với append=true cho từng phần tiếp; PowerPoint dùng create_pptx 3-5 slide đầu rồi create_pptx cùng path với append=true; HTML/mã tạo trước tệp khung ngắn rồi thêm từng phần bằng edit_file; Excel dùng generate/append_generate hoặc xlsx_edit thêm mỗi lần tối đa ~40 dòng. Mỗi lần gọi chỉ nên dưới ~2.000 ký tự nội dung (tiếng Việt có dấu tốn nhiều hơn bạn tưởng).`
        : `Lỗi: tham số không phải JSON hợp lệ (${(e as Error).message}). Hãy gọi lại với JSON đúng.`;
      this.done(tc, name, false, out, "bad_json");
      return out;
    }
    const summary = tool ? tool.summarize(args) : "";
    if (!tool || !allowed.has(name)) {
      s.emit({ type: "tool_start", id: tc.id, name, summary, args, depth: this.depth });
      const out = `Lỗi: không có công cụ '${name}'. Công cụ hiện có: ${[...allowed].sort().join(", ")}`;
      this.done(tc, name, false, out, "unknown_tool");
      return out;
    }
    const copied = BULKY_ARGS.has(name) ? Object.keys(args).find((k) => typeof args[k] === "string" && PRUNED_ARG_RE.test(args[k] as string)) : undefined;
    if (copied) {
      s.emit({ type: "tool_start", id: tc.id, name, summary, args, depth: this.depth });
      const p = typeof args.path === "string" ? ` ${args.path}` : "";
      const out = `Lỗi: \`${copied}\` là dấu vết hệ thống để lại khi lược bớt lịch sử, KHÔNG phải nội dung thật (ghi vào sẽ xoá mất tệp). Hãy read_file${p} để lấy nội dung thật rồi chép đúng, hoặc viết lại đầy đủ.`;
      this.done(tc, name, false, out, "bad_args");
      return out;
    }

    // xin quyền
    let target: TargetInfo = {};
    const rawPath = tool.targetPath ? tool.targetPath(args) : tool.pathArg ? args[tool.pathArg] : undefined;
    if (typeof rawPath === "string") {
      try {
        const abs = await resolveSafe(s.ctx, rawPath);
        target = { abs, rel: relPath(s.ctx, abs) };
      } catch {
        /* công cụ sẽ báo lỗi đường dẫn */
      }
    }
    const preview = tool.preview ? await tool.preview(s.ctx, args).catch(() => null) : null;
    s.emit({ type: "tool_start", id: tc.id, name, summary, args, depth: this.depth, preview });
    if (s.hooks) {
      const hr = await s.hooks.run("PreToolUse", { toolName: name, toolInput: args }, s.ctx.signal);
      for (const w of hr.warnings) s.emit({ type: "notice", level: "warn", text: w });
      if (hr.blocked) {
        const out = "Bị chặn bởi hook PreToolUse: " + hr.message;
        this.done(tc, name, false, out, "hook");
        return out;
      }
    }
    const d = s.perms.decide(tool, args, target);
    if (d.decision === "deny") {
      const out = "Bị từ chối: " + d.reason;
      this.done(tc, name, false, out, "denied");
      return out;
    }
    if (d.decision === "ask") {
      const res = await s.ask({ id: nextId("a"), kind: "tool", tool: name, summary, args, preview, note: d.reason || undefined, depth: this.depth });
      if (!res.allow) {
        const out = "Người dùng từ chối chạy công cụ này." + (res.note ? " Lý do: " + res.note : " Hãy đề xuất cách khác hoặc hỏi lại người dùng.");
        this.done(tc, name, false, out, "denied");
        return out;
      }
      if (res.always) {
        const rule = s.perms.remember(tool, args);
        s.emit({ type: "notice", level: "info", text: "Đã thêm quy tắc cho phiên này: " + rule });
      }
    }

    // chạy
    let ok = true;
    let errKind: string | undefined;
    let result: string;
    const undoBefore = s.ctx.undoStack.length;
    try {
      // lệnh bash có thể ghi file: chụp trước/sau để đưa vào "Thay đổi" (bỏ qua lệnh chỉ-đọc cho nhanh)
      const segs = name === "bash" ? parseCommand(String(args.command ?? "")) : null;
      const readonlyCmd = !!segs && segs.length > 0 && segs.every((x) => isReadonlySegment(x, s.ctx.root));
      result = name === "bash" && !readonlyCmd ? await trackExec(s.ctx, () => tool.run(s.ctx, args)) : await tool.run(s.ctx, args);
    } catch (e) {
      ok = false;
      if (e instanceof ToolError) {
        result = "Lỗi: " + e.message;
        errKind = e.kind;
      } else if (e instanceof LlmError && e.kind === "abort") throw e;
      else {
        const em = `${(e as { code?: string }).code ?? ""} ${(e as Error).message}`;
        if (/\b(EBUSY|EPERM|EACCES)\b|resource busy|being used by another process|sharing violation/i.test(em)) {
          // thường là Word/Excel/PowerPoint đang giữ tệp (Windows): nói rõ cách xử lý thay vì lỗi kỹ thuật
          result = `Lỗi: tệp đang mở hoặc bị khoá bởi chương trình khác (${name}). Đóng tệp trong Word/Excel/PowerPoint hoặc chương trình xem rồi thử lại, hoặc ghi sang một tên khác.`;
          errKind = "other";
        } else {
          result = `Lỗi nội bộ khi chạy ${name}: ${(e as Error).name}: ${(e as Error).message}`;
          errKind = "internal";
        }
      }
    }
    result = String(result);
    if (result.length > MAX_TOOL_CHARS) result = result.slice(0, MAX_TOOL_CHARS) + `\n… (đã cắt bớt ${result.length - MAX_TOOL_CHARS} ký tự)`;
    this.done(tc, name, ok, result, ok ? undefined : errKind);
    s.noteTool(name, ok && !(name === "bash" && /\[(mã thoát [1-9]\d*|Hết thời gian)/.test(result.slice(-80))), s.ctx.undoStack.length > undoBefore, name === "bash" && !!(args as { background?: unknown }).background, { file: target.abs, pageClean: name === "check_page" && /KẾT QUẢ: ổn/.test(result) });
    if (ok && (tool.kind === "net" || tool.kind === "mcp") && !s.perms.tainted) {
      s.perms.tainted = true;
      if (s.perms.mode !== "bypass") s.emit({ type: "notice", level: "warn", text: `Đã nhận nội dung từ ${tool.kind === "mcp" ? "công cụ ngoài (MCP)" : "web/dịch vụ ngoài"} (không tin cậy). Trong lượt này mọi thao tác ghi file/chạy lệnh đều được hỏi lại, kể cả khi bạn đã bật tự động duyệt.` });
    }
    if (ok && (tool.kind === "edit" || tool.kind === "exec")) s.emit({ type: "files_changed", paths: target.rel ? [target.rel] : [] });
    if (ok && target.rel && ["read_file", "edit_file", "write_file", "list_dir"].includes(name)) await s.noteTouched(target.rel, name === "list_dir");
    if (s.hooks) {
      const hr = await s.hooks.run("PostToolUse", { toolName: name, toolInput: args, toolOutput: result }, s.ctx.signal);
      for (const w of hr.warnings) s.emit({ type: "notice", level: "warn", text: w });
      if (hr.blocked) {
        s.emit({ type: "notice", level: "info", text: "Hook PostToolUse phản hồi: " + hr.message.split("\n")[0] });
        result += "\n[Hook PostToolUse phản hồi]\n" + hr.message;
      } else if (hr.context) result += "\n[Hook PostToolUse]\n" + hr.context;
    }
    return result;
  }
}

