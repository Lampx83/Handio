/**
 * Tự chẩn đoán & phản hồi (diagnostics) — KHÔNG CHỨA NỘI DUNG ngay từ cách thiết kế.
 *
 * Chỉ ghi: loại sự kiện/mã, loại lỗi LLM + mã HTTP, tên công cụ (trong danh sách cố định) + thành công/thất bại + nhóm thời gian,
 * số lần chạm giới hạn bước/vòng lặp/tràn ngữ cảnh, số lần quyền được/bị từ chối, thời lượng lượt + số token, phiên bản,
 * nền tảng, profile, tên mô hình và một mã ngẫu nhiên theo máy cài.
 * KHÔNG BAO GIỜ: câu hỏi, câu trả lời, tên/đường dẫn/nội dung tệp, dòng lệnh, URL, thông điệp lỗi của công cụ, key, email.
 * Danh tính do MÁY CHỦ gắn (HMAC của email SSO); máy khách không gửi danh tính.
 *
 * Mọi thứ đi qua `sanitizeEvent`/`sanitizeApp` (danh sách cho phép theo từng trường; trường lạ bị bỏ). Lược đồ dùng chung với bộ thu
 * (deploy/220/diag/schema.json) — có test so khớp hai bên.
 */
import type { SessionEvent } from "./types";

// ---------------------------------------------------------------- lược đồ (dữ liệu thuần, trùng schema.json)
export type FieldSpec =
  | { k: "int"; min: number; max: number; req?: boolean }
  | { k: "enum"; v: readonly string[]; req?: boolean }
  | { k: "bool"; req?: boolean }
  | { k: "tool"; req?: boolean }
  | { k: "text"; max: number; req?: boolean };

export const DIAG_TOOLS: string[] = [
  "read_file", "list_dir", "glob", "grep", "edit_file", "write_file", "todo_write", "bash", "bash_output", "kill_process", "run_javascript",
  "check_package", "web_fetch", "read_image", "web_search", "fetch_page", "xlsx_pivot", "merge_check", "merge_documents", "scan_pii", "redact_pii", "read_document", "find_in_documents", "create_docx", "docx_replace", "create_xlsx", "xlsx_edit", "create_pptx",
  "convert_to_pdf", "skill", "task", "exit_plan_mode", "mcp", "other",
];
export const DIAG_SIGNALS = ["loop", "step_limit", "repeat_tool_fail", "slow_first_token", "slow_turn", "ctx_high", "early_interrupt", "perm_denied", "empty_output", "invalid_tool_args", "unknown_tool", "truncated", "context_overflow", "args_truncated", "text_repeat"];
/** Lý do công cụ thất bại (chỉ mã): xem ToolErrorKind trong tools.ts. "program" = chương trình/test của người dùng chạy hỏng (kết quả bình thường, không phải lỗi công cụ); "denied" = bị từ chối quyền. */
export const DIAG_TOOL_ERRORS = ["not_found", "outside_project", "read_first", "stale", "binary", "bad_args", "no_match", "ambiguous", "wrong_type", "sandbox", "program", "timeout", "unsupported", "denied", "hook", "unknown_tool", "bad_json", "internal", "other"];
/** Việc người dùng làm trong giao diện (chỉ MÃ, không có nội dung): để biết tính năng nào được dùng/bỏ qua. */
export const DIAG_UI_ACTS = ["tab_switch", "suggestion", "template", "attach", "learn_open", "settings_open", "new_chat", "open_chat", "mode_change", "model_change", "run_click", "changes_open", "login_prompt", "update_banner", "update_download", "download_open", "slash_command", "mention_file", "stop_click", "point_edit", "feedback_send", "guide_open"];
export const DIAG_FEEDBACK_REASONS = ["wrong", "slow", "incomplete", "confusing", "other"];
export const DIAG_PLATFORMS = ["web", "mac", "win", "linux", "other"];
export const DIAG_PROFILES = ["work", "code", "design"];

export const DIAG_SCHEMA = {
  version: 1,
  limits: { maxBodyBytes: 16384, maxEvents: 200, maxNote: 500 },
  tools: DIAG_TOOLS,
  app: {
    install: { k: "hex", min: 32, max: 32 },
    version: { k: "version" },
    build: { k: "hex", min: 4, max: 16 },
    platform: { k: "enum", v: DIAG_PLATFORMS },
    profile: { k: "enum", v: DIAG_PROFILES },
    model: { k: "model" },
  },
  events: {
    turn: {
      end: { k: "enum", v: ["ok", "interrupted", "error", "step_limit", "loop"], req: true },
      dur_s: { k: "int", min: 0, max: 86400 },
      ttft_ms: { k: "int", min: 0, max: 3600000 },
      steps: { k: "int", min: 0, max: 1000 },
      tools: { k: "int", min: 0, max: 5000 },
      tool_fail: { k: "int", min: 0, max: 5000 },
      prompt_tok: { k: "int", min: 0, max: 1000000000 },
      completion_tok: { k: "int", min: 0, max: 1000000000 },
      ctx_pct: { k: "int", min: 0, max: 1000 },
      compactions: { k: "int", min: 0, max: 100 },
      perm_allow: { k: "int", min: 0, max: 5000 },
      perm_deny: { k: "int", min: 0, max: 5000 },
      /** Số lần gọi mô hình trong lượt; lời nhắc lớn nhất của một lần gọi; token lời nhắc lấy từ bộ nhớ đệm; ước lượng token của kết quả công cụ đã gửi lại; số lần lược bớt kết quả cũ; giây tới công cụ đầu tiên. */
      calls: { k: "int", min: 0, max: 5000 },
      peak_prompt_tok: { k: "int", min: 0, max: 1000000000 },
      cached_tok: { k: "int", min: 0, max: 1000000000 },
      tool_out_tok: { k: "int", min: 0, max: 1000000000 },
      pruned: { k: "int", min: 0, max: 5000 },
      first_tool_s: { k: "int", min: 0, max: 86400 },
    },
    tool: {
      name: { k: "tool", req: true },
      ok: { k: "bool", req: true },
      dur: { k: "enum", v: ["lt1s", "lt5s", "lt30s", "lt2m", "ge2m"], req: true },
      err: { k: "enum", v: DIAG_TOOL_ERRORS },
    },
    llm_error: {
      kind: { k: "enum", v: ["context", "auth", "rate", "server", "network", "insecure", "quota", "unexpected", "other"], req: true },
      status: { k: "int", min: 0, max: 599 },
    },
    llm_retry: { kind: { k: "enum", v: ["network", "rate", "server"], req: true } },
    signal: {
      code: { k: "enum", v: DIAG_SIGNALS, req: true },
      tool: { k: "tool" },
      n: { k: "int", min: 0, max: 100000 },
    },
    ui: { act: { k: "enum", v: DIAG_UI_ACTS, req: true } },
    feedback: { v: { k: "enum", v: ["up", "down"], req: true }, reason: { k: "enum", v: DIAG_FEEDBACK_REASONS } },
    report: { note: { k: "text", max: 500 } },
  },
} as const;

/** Ngưỡng phát hiện phía máy khách (đổi ở đây; báo cáo phía máy chủ có ngưỡng riêng trong deploy/220/diag/report.py). */
export const DIAG_THRESHOLDS = {
  /** Cùng một công cụ + cùng tham số liên tiếp ≥ N lần => vòng lặp. */
  loopRepeat: 3,
  /** Cùng một công cụ thất bại ≥ N lần trong một lượt. */
  toolFailRepeat: 3,
  slowFirstTokenMs: 20_000,
  slowTurnS: 300,
  ctxHighPct: 85,
  /** Người dùng bấm Dừng trong N giây đầu của lượt. */
  earlyInterruptS: 8,
  /** Từ chối quyền ≥ N lần trong một lượt (hoặc ≥ 2 lần cùng một công cụ). */
  permDeniedTurn: 3,
};

// ---------------------------------------------------------------- bộ làm sạch (danh sách cho phép)
export type DiagEvent = { t: string; ts: number } & Record<string, string | number | boolean>;
export interface DiagApp {
  install: string;
  version: string;
  build?: string;
  platform: string;
  profile: string;
  model: string;
}
export interface DiagPayload {
  v: 1;
  app: DiagApp;
  sent: number;
  dropped?: number;
  events: DiagEvent[];
}

const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.]{1,16})?$/;
const MODEL_RE = /^[A-Za-z0-9._:-]{1,60}$/;
/** Tên mô hình do người dùng gõ: loại những chuỗi giống khoá/token (tiền tố sk-/ghp_/…, từ "secret/token/key", đoạn chữ-số dài ≥24). */
const LOOKS_SECRET = /^(sk|pk|ghp|gho|ghu|ghs|xox.|akia|eyj|bearer|key|token|secret)[-_.:]|secret|token|passw|api[-_]?key|[A-Za-z0-9]{24,}/i;
const FILE_EXT = /\.(xlsx?|docx?|pptx?|pdf|txt|csv|json|env|pem|key|py|js|ts|sh|zip)$/i;
const hexRe = (min: number, max: number) => new RegExp(`^[0-9a-f]{${min},${max}}$`);
const TOOL_SET = new Set(DIAG_TOOLS);

/** Tên công cụ -> tên cho phép gửi. Tên lạ/do mô hình bịa ra (có thể chứa bí mật) KHÔNG đi ra ngoài. */
export function safeToolName(name: unknown): string {
  if (typeof name !== "string") return "other";
  if (name.startsWith("mcp__")) return "mcp";
  return TOOL_SET.has(name) ? name : "other";
}

/** Tên mô hình: bỏ phần thư mục ("Qwen/Qwen3-8B" -> "Qwen3-8B"), chỉ nhận chữ/số/._:- ; còn lại -> "other". */
export function safeModelName(model: unknown): string {
  if (typeof model !== "string") return "other";
  if (!/^[A-Za-z0-9._:-]{1,60}(\/[A-Za-z0-9._:-]{1,60})?$/.test(model)) return "other"; // tối đa dạng "tổ-chức/tên"
  const last = model.split("/").pop() ?? "";
  return MODEL_RE.test(last) && !LOOKS_SECRET.test(last) && !FILE_EXT.test(last) ? last : "other";
}

function cleanField(spec: FieldSpec, v: unknown): string | number | boolean | undefined {
  switch (spec.k) {
    case "int": {
      if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
      return Math.max(spec.min, Math.min(spec.max, Math.round(v)));
    }
    case "enum":
      return typeof v === "string" && spec.v.includes(v) ? v : undefined;
    case "bool":
      return typeof v === "boolean" ? v : undefined;
    case "tool":
      return typeof v === "string" ? safeToolName(v) : undefined;
    case "text":
      // eslint-disable-next-line no-control-regex
      return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, spec.max) : undefined;
  }
}

/** Lọc một sự kiện theo lược đồ: loại lạ => null; trường lạ/sai kiểu bị bỏ; thiếu trường bắt buộc => null. Không bao giờ ném lỗi. */
export function sanitizeEvent(raw: unknown): DiagEvent | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const spec = (DIAG_SCHEMA.events as Record<string, Record<string, FieldSpec>>)[String(r.t)];
    if (!spec || typeof r.t !== "string" || !Object.prototype.hasOwnProperty.call(DIAG_SCHEMA.events, r.t)) return null;
    if (typeof r.ts !== "number" || !Number.isFinite(r.ts) || r.ts < 1_000_000_000 || r.ts > 4_000_000_000) return null;
    const out: DiagEvent = { t: r.t, ts: Math.round(r.ts) };
    for (const [k, fs] of Object.entries(spec)) {
      const v = cleanField(fs, r[k]);
      if (v === undefined || (fs.k === "text" && v === "")) {
        if (fs.req) return null;
        continue;
      }
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function sanitizeApp(raw: unknown): DiagApp | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    if (!hexRe(32, 32).test(s(r.install)) || !VERSION_RE.test(s(r.version))) return null;
    const app: DiagApp = {
      install: s(r.install),
      version: s(r.version),
      platform: DIAG_PLATFORMS.includes(s(r.platform)) ? s(r.platform) : "other",
      profile: DIAG_PROFILES.includes(s(r.profile)) ? s(r.profile) : "code",
      model: safeModelName(r.model),
    };
    if (hexRe(4, 16).test(s(r.build))) app.build = s(r.build);
    return app;
  } catch {
    return null;
  }
}

/** Dựng gói gửi đi (ĐÂY là chuỗi byte duy nhất rời khỏi máy). Lọc lại toàn bộ lần nữa. */
export function buildPayload(app: unknown, events: unknown[], o: { now?: number; dropped?: number } = {}): DiagPayload | null {
  const a = sanitizeApp(app);
  if (!a) return null;
  const evs = events.map(sanitizeEvent).filter((e): e is DiagEvent => !!e).slice(0, DIAG_SCHEMA.limits.maxEvents);
  const p: DiagPayload = { v: 1, app: a, sent: Math.round((o.now ?? Date.now()) / 1000), events: evs };
  if (o.dropped && o.dropped > 0) p.dropped = Math.min(100000, Math.round(o.dropped));
  return p;
}

const enc = (s: string) => new TextEncoder().encode(s).length;

/** Chia sự kiện thành các lô vừa giới hạn của bộ thu (≤200 sự kiện, ≤16 KB; ở đây chừa dư). */
export function chunkEvents(events: DiagEvent[], maxEvents = 80, maxBytes = 12_000): DiagEvent[][] {
  const out: DiagEvent[][] = [];
  let cur: DiagEvent[] = [];
  let bytes = 0;
  for (const e of events) {
    const n = enc(JSON.stringify(e)) + 1;
    if (cur.length && (cur.length >= maxEvents || bytes + n > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function newInstallId(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const durBucket = (ms: number): string => (ms < 1000 ? "lt1s" : ms < 5000 ? "lt5s" : ms < 30_000 ? "lt30s" : ms < 120_000 ? "lt2m" : "ge2m");

// ---------------------------------------------------------------- bộ ghi + phát hiện vấn đề
export interface RecorderOptions {
  /** Địa chỉ nhận (vd "/agent/diag" ở bản web, đầy đủ https://… ở Desktop). */
  endpoint: string;
  /** Tiêu đề bổ sung (Desktop: Authorization: Bearer <token SSO>). KHÔNG đặt danh tính ở đây. */
  headers?: () => Record<string, string>;
  /** Có đang bật không (người dùng + chính sách). Tắt => không ghi gì, xoá bộ đệm. */
  enabled: () => boolean;
  /** Chính sách quản trị cấm hẳn: tắt cả gửi báo lỗi thủ công. */
  forbidden?: () => boolean;
  version: string;
  build?: string;
  platform: string;
  /** Ngữ cảnh lúc gửi (profile, tên mô hình, mã cài đặt). */
  context: () => { profile: string; model: string; install: string };
  fetch?: typeof fetch;
  now?: () => number;
  maxBuffer?: number;
  /** Chờ bao lâu sau lần ghi cuối thì gửi (ms). */
  flushDelayMs?: number;
  sendTimeoutMs?: number;
}

interface TurnState {
  start: number;
  firstOut?: number;
  steps: number;
  tools: number;
  fails: number;
  toolStart: Map<string, number>;
  failBy: Map<string, number>;
  repKey: string;
  repN: number;
  p0: number;
  c0: number;
  ctx: number;
  compactions: number;
  calls: number;
  peakP: number;
  cached: number;
  toolOut: number;
  pruned: number;
  firstTool?: number;
  permAllow: number;
  permDeny: number;
  denyBy: Map<string, number>;
  permTool: Map<string, string>;
  interrupted: boolean;
  err: boolean;
  stepLimit: boolean;
  loopStop: boolean;
  emptyPending: boolean;
  signals: Set<string>;
}

/** FNV-1a: chỉ để so "cùng lời gọi" trong bộ nhớ; không bao giờ được ghi hay gửi. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

export class DiagnosticsRecorder {
  private buf: DiagEvent[] = [];
  private dropped = 0;
  private turn: TurnState | null = null;
  private lastP = 0;
  private lastC = 0;
  private lastCached = 0;
  private failures = 0;
  private nextAllowed = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sending = false;
  private prepared: DiagPayload | null = null;
  private disposed = false;

  constructor(private o: RecorderOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }
  private active(): boolean {
    try {
      return !this.disposed && !this.o.forbidden?.() && !!this.o.enabled();
    } catch {
      return false;
    }
  }

  // ---- đầu vào (đồng bộ, O(1), không bao giờ ném lỗi)
  onEvent(e: SessionEvent): void {
    try {
      if (!this.active()) {
        if (this.buf.length) this.buf = [];
        this.turn = null;
        return;
      }
      this.handle(e);
    } catch {
      /* chẩn đoán không bao giờ được làm hỏng agent */
    }
  }

  /** Lỗi bắt được ở `send()`. Chỉ lấy loại + mã HTTP, KHÔNG lấy thông điệp. */
  onError(err: unknown): void {
    try {
      if (!this.active()) return;
      const x = err as { name?: string; kind?: string; status?: number };
      if (x?.kind === "abort") return;
      if (x?.name === "ToolError") return;
      const isLlm = typeof x?.kind === "string" && typeof x?.status === "number";
      const kind = isLlm ? (["context", "auth", "rate", "server", "network", "insecure", "quota"].includes(x.kind!) ? x.kind! : "other") : "unexpected";
      this.push({ t: "llm_error", ts: this.ts(), kind, status: isLlm ? x.status : 0 });
      if (this.turn) this.turn.err = true;
    } catch {
      /* bỏ qua */
    }
  }

  /** Người dùng bấm Dừng. */
  onInterrupt(): void {
    try {
      if (this.turn) this.turn.interrupted = true;
    } catch {
      /* bỏ qua */
    }
  }

  private ts(): number {
    return Math.floor(this.now() / 1000);
  }

  private newTurn(): TurnState {
    return { start: this.now(), steps: 0, tools: 0, fails: 0, toolStart: new Map(), failBy: new Map(), repKey: "", repN: 0, p0: this.lastP, c0: this.lastC, ctx: 0, compactions: 0, calls: 0, peakP: 0, cached: 0, toolOut: 0, pruned: 0, permAllow: 0, permDeny: 0, denyBy: new Map(), permTool: new Map(), interrupted: false, err: false, stepLimit: false, loopStop: false, emptyPending: false, signals: new Set() };
  }

  private signal(code: string, tool?: string, n?: number): void {
    const t = this.turn;
    const key = code + (tool ?? "");
    if (t) {
      if (t.signals.has(key)) return;
      t.signals.add(key);
    }
    const ev: Record<string, unknown> = { t: "signal", ts: this.ts(), code };
    if (tool) ev.tool = tool;
    if (n !== undefined) ev.n = n;
    this.push(ev);
  }

  private handle(e: SessionEvent): void {
    if (e.type === "turn_start") {
      if (this.turn) this.finishTurn(false, "");
      this.turn = this.newTurn();
      return;
    }
    const t = this.turn;
    switch (e.type) {
      case "text":
      case "reasoning":
        if (t && !t.firstOut && e.depth === 0) t.firstOut = this.now();
        return;
      case "message_end": {
        if (!t) return;
        if (!t.firstOut && e.depth === 0) t.firstOut = this.now();
        if (e.depth === 0) t.steps++;
        t.emptyPending = e.text.trim() === "";
        return;
      }
      case "tool_start": {
        if (!t) return;
        t.emptyPending = false;
        if (!t.firstOut && e.depth === 0) t.firstOut = this.now();
        t.toolStart.set(e.id, this.now());
        if (t.firstTool === undefined && e.depth === 0) t.firstTool = this.now();
        const key = e.name + "\u0000" + fnv(safeJson(e.args));
        t.repN = key === t.repKey ? t.repN + 1 : 1;
        t.repKey = key;
        if (t.repN >= DIAG_THRESHOLDS.loopRepeat) this.signal("loop", safeToolName(e.name), t.repN);
        if (e.summary === "tham số không hợp lệ") this.signal("invalid_tool_args", safeToolName(e.name));
        return;
      }
      case "tool_result": {
        if (!t) return;
        t.tools++;
        t.toolOut += Math.round(e.output.length / 3);
        const name = safeToolName(e.name);
        const st = t.toolStart.get(e.id);
        t.toolStart.delete(e.id);
        const err = !e.ok && e.errKind && DIAG_TOOL_ERRORS.includes(e.errKind) ? e.errKind : undefined;
        this.push({ t: "tool", ts: this.ts(), name, ok: !!e.ok, dur: durBucket(st ? this.now() - st : 0), ...(err ? { err } : {}) });
        if (!e.ok) {
          t.fails++;
          // chương trình của người dùng chạy hỏng / bị từ chối quyền không phải "công cụ lỗi lặp lại"
          const real = err !== "program" && err !== "denied";
          const n = (t.failBy.get(name) ?? 0) + (real ? 1 : 0);
          t.failBy.set(name, n);
          if (real && n >= DIAG_THRESHOLDS.toolFailRepeat) this.signal("repeat_tool_fail", name, n);
          if (e.output.startsWith("Lỗi: không có công cụ")) this.signal("unknown_tool");
        }
        return;
      }
      case "permission":
        if (t) t.permTool.set(e.request.id, safeToolName(e.request.tool));
        return;
      case "permission_resolved": {
        if (!t) return;
        const tool = t.permTool.get(e.id) ?? "other";
        t.permTool.delete(e.id);
        if (e.allowed) t.permAllow++;
        else if (!t.interrupted) {
          // bị ngắt (Esc) không tính là người dùng từ chối
          t.permDeny++;
          const n = (t.denyBy.get(tool) ?? 0) + 1;
          t.denyBy.set(tool, n);
          if (n >= 2) this.signal("perm_denied", tool, n);
        }
        return;
      }
      case "usage": {
        const dp = e.promptTokens - this.lastP; // lời nhắc của MỘT lần gọi (sự kiện được phát sau mỗi lần gọi)
        const dc = (e.cachedTokens ?? 0) - this.lastCached;
        if (t && dp > 0) {
          t.calls++;
          t.peakP = Math.max(t.peakP, dp);
        }
        if (t && dc > 0) t.cached += dc;
        this.lastCached = e.cachedTokens ?? 0;
        this.lastP = e.promptTokens;
        this.lastC = e.completionTokens;
        if (t) t.ctx = Math.max(t.ctx, e.contextPct);
        return;
      }
      case "notice":
        this.onNotice(e.text);
        return;
      case "reset":
        this.lastP = 0;
        this.lastC = 0;
        this.lastCached = 0;
        if (t) {
          t.p0 = 0;
          t.c0 = 0;
        }
        return;
      case "turn_end":
        this.finishTurn(e.interrupted, e.final);
        return;
    }
  }

  /** Nhận diện vài thông báo của hệ thống (chỉ khớp chuỗi cục bộ; chỉ MÃ được lưu). Có test chạy phiên thật để phát hiện khi câu chữ đổi. */
  private onNotice(text: string): void {
    const t = this.turn;
    if (/giới hạn \d+ bước/.test(text)) {
      if (t) t.stepLimit = true;
      this.signal("step_limit", undefined, t?.steps);
    } else if (/^Lời gọi công cụ bị cắt/.test(text)) this.signal("args_truncated");
    else if (/^Agent bắt đầu lặp lại một đoạn văn/.test(text)) this.signal("text_repeat");
    else if (/lặp lại cùng một thao tác/.test(text)) {
      if (t) t.loopStop = true;
      if (!t || ![...t.signals].some((k) => k.startsWith("loop"))) this.signal("loop", undefined, t?.repN);
    } else if (/^Ngữ cảnh đầy, đang rút gọn/.test(text)) this.signal("context_overflow");
    else if (/^Đã lược bớt kết quả công cụ cũ/.test(text)) {
      if (t) t.pruned++;
    }
    else if (/^Đang tóm tắt hội thoại/.test(text)) {
      if (t) t.compactions++;
    } else if (/^Câu trả lời bị cắt/.test(text)) this.signal("truncated");
    else if (/^Mất kết nối/.test(text)) this.push({ t: "llm_retry", ts: this.ts(), kind: "network" });
    else if (/^Chạm giới hạn lệnh\/phút/.test(text)) this.push({ t: "llm_retry", ts: this.ts(), kind: "rate" });
    else if (/Thử lại sau \d+s \(lần \d+\)/.test(text)) this.push({ t: "llm_retry", ts: this.ts(), kind: "server" });
  }

  private finishTurn(interrupted: boolean, _final: string): void {
    const t = this.turn;
    this.turn = null;
    if (!t) return;
    const now = this.now();
    const durS = Math.round((now - t.start) / 1000);
    const ttft = t.firstOut ? t.firstOut - t.start : undefined;
    this.turn = t; // để `signal` còn dùng được bộ nhớ chống trùng
    if (ttft !== undefined && ttft > DIAG_THRESHOLDS.slowFirstTokenMs) this.signal("slow_first_token", undefined, Math.round(ttft / 1000));
    if (durS > DIAG_THRESHOLDS.slowTurnS) this.signal("slow_turn", undefined, durS);
    if (t.ctx >= DIAG_THRESHOLDS.ctxHighPct) this.signal("ctx_high", undefined, t.ctx);
    if (interrupted && durS <= DIAG_THRESHOLDS.earlyInterruptS) this.signal("early_interrupt", undefined, durS);
    if (t.permDeny >= DIAG_THRESHOLDS.permDeniedTurn) this.signal("perm_denied", undefined, t.permDeny);
    if (t.emptyPending && !interrupted && !t.err) this.signal("empty_output");
    this.turn = null;
    const quiet = t.steps === 0 && t.tools === 0 && !t.err && !interrupted; // lệnh gạch chéo (/help…) không phải lượt làm việc
    if (quiet) return;
    const end = t.err ? "error" : interrupted ? "interrupted" : t.stepLimit ? "step_limit" : t.loopStop ? "loop" : "ok";
    const ev: Record<string, unknown> = {
      t: "turn", ts: Math.floor(now / 1000), end, dur_s: durS, steps: t.steps, tools: t.tools, tool_fail: t.fails,
      prompt_tok: Math.max(0, this.lastP - t.p0), completion_tok: Math.max(0, this.lastC - t.c0), ctx_pct: t.ctx, compactions: t.compactions, perm_allow: t.permAllow, perm_deny: t.permDeny,
    };
    if (ttft !== undefined) ev.ttft_ms = ttft;
    if (t.calls) ev.calls = t.calls;
    if (t.peakP) ev.peak_prompt_tok = t.peakP;
    if (t.cached) ev.cached_tok = t.cached;
    if (t.toolOut) ev.tool_out_tok = t.toolOut;
    if (t.pruned) ev.pruned = t.pruned;
    if (t.firstTool !== undefined) ev.first_tool_s = Math.round((t.firstTool - t.start) / 1000);
    this.push(ev);
    this.schedule(this.o.flushDelayMs ?? 5000);
  }

  // ---- bộ đệm vòng
  private push(raw: unknown): void {
    const ev = sanitizeEvent(raw);
    if (!ev) return;
    this.buf.push(ev);
    const max = this.o.maxBuffer ?? 500;
    while (this.buf.length > max) {
      this.buf.shift();
      this.dropped++;
    }
    if (this.buf.length >= 100) this.schedule(0);
    else this.schedule(this.o.flushDelayMs ?? 5000);
  }

  /** Số sự kiện đang chờ gửi (cho test/chẩn đoán). */
  get pending(): number {
    return this.buf.length;
  }

  private schedule(delay: number): void {
    if (this.timer || this.disposed) return;
    const wait = Math.max(delay, this.nextAllowed - this.now(), 0);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, wait);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private payload(events: DiagEvent[], dropped = 0): DiagPayload | null {
    const c = this.o.context();
    return buildPayload({ install: c.install, version: this.o.version, build: this.o.build, platform: this.o.platform, profile: c.profile, model: c.model }, events, { now: this.now(), dropped });
  }

  private async post(p: DiagPayload): Promise<"ok" | "drop" | "retry" | { retryAfter: number }> {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), this.o.sendTimeoutMs ?? 10_000);
    (to as { unref?: () => void }).unref?.();
    try {
      const f = this.o.fetch ?? fetch;
      const extra = this.o.headers?.() ?? {};
      const r = await f(this.o.endpoint, { method: "POST", headers: { ...extra, "Content-Type": "application/json" }, body: JSON.stringify(p), redirect: "error", keepalive: true, signal: ctl.signal });
      if (r.ok) return "ok";
      if (r.status === 400 || r.status === 413 || r.status === 422) return "drop"; // lô bị từ chối: gửi lại cũng vô ích
      if (r.status === 429) {
        const ra = parseInt(r.headers?.get?.("Retry-After") ?? "", 10);
        return { retryAfter: Number.isFinite(ra) ? Math.min(ra, 900) * 1000 : 0 };
      }
      return "retry";
    } catch {
      return "retry";
    } finally {
      clearTimeout(to);
    }
  }

  /** Gửi bộ đệm theo lô; thất bại thì lùi dần (30s, 60s, … tối đa 30 phút). Không bao giờ ném lỗi, không báo lỗi cho người dùng. */
  async flush(): Promise<void> {
    try {
      if (this.sending || !this.active() || !this.buf.length) return;
      if (this.now() < this.nextAllowed) return this.schedule(0);
      this.sending = true;
      try {
        const chunk = chunkEvents(this.buf)[0];
        const p = this.payload(chunk, this.dropped);
        if (!p) return void (this.buf = []);
        const res = await this.post(p);
        if (res === "ok" || res === "drop") {
          const sent = new Set(chunk);
          this.buf = this.buf.filter((e) => !sent.has(e));
          if (res === "ok") this.dropped = 0;
          this.failures = 0;
          this.nextAllowed = 0;
        } else {
          this.failures++;
          const exp = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
          const wait = typeof res === "object" && res.retryAfter ? res.retryAfter : exp * (0.5 + Math.random() * 0.5);
          this.nextAllowed = this.now() + wait;
        }
      } finally {
        this.sending = false;
      }
      if (this.buf.length) this.schedule(this.failures ? 0 : 500);
    } catch {
      this.sending = false;
    }
  }

  // ---- "Báo lỗi": xem trước đúng gói sẽ gửi, rồi gửi chính gói đó
  /** Dựng gói báo lỗi (các sự kiện gần đây + ghi chú ngắn của người dùng). Trả về chuỗi JSON đúng như sẽ gửi, hoặc null nếu bị cấm. */
  /** Ghi một việc người dùng làm trong giao diện (chỉ mã trong danh sách DIAG_UI_ACTS). Không bao giờ ném lỗi. */
  noteUi(act: string): void {
    if (!DIAG_UI_ACTS.includes(act)) return;
    this.push({ t: "ui", ts: this.ts(), act });
  }

  /** Phản hồi 👍/👎 của người dùng kèm lý do chọn sẵn (không có chữ tự do). */
  noteFeedback(v: string, reason?: string): void {
    if (v !== "up" && v !== "down") return;
    const ev: Record<string, unknown> = { t: "feedback", ts: this.ts(), v };
    if (reason && DIAG_FEEDBACK_REASONS.includes(reason)) ev.reason = reason;
    this.push(ev);
  }

  prepareReport(note: string): string | null {
    try {
      if (this.disposed || this.o.forbidden?.()) return null;
      // các sự kiện gần nhất sao cho cả gói vừa giới hạn của bộ thu (chừa chỗ cho ghi chú)
      const recent: DiagEvent[] = [];
      let bytes = 0;
      for (let i = this.buf.length - 1; i >= 0 && recent.length < 100; i--) {
        bytes += enc(JSON.stringify(this.buf[i])) + 1;
        if (bytes > 9000) break;
        recent.unshift(this.buf[i]);
      }
      const p = this.payload([...recent, { t: "report", ts: this.ts(), note } as DiagEvent], 0);
      if (!p) return null;
      this.prepared = p;
      return JSON.stringify(p, null, 2);
    } catch {
      return null;
    }
  }

  /** Gửi đúng gói đã xem trước (một lần). Trả về kết quả để giao diện báo cho người dùng (hành động do họ chủ động). */
  async sendPrepared(): Promise<{ ok: boolean }> {
    const p = this.prepared;
    this.prepared = null;
    if (!p) return { ok: false };
    try {
      const body = JSON.stringify(p);
      if (new TextEncoder().encode(body).length > DIAG_SCHEMA.limits.maxBodyBytes) return { ok: false };
      return { ok: (await this.post(p)) === "ok" };
    } catch {
      return { ok: false };
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.buf = [];
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}
