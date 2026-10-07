import type { Env } from "./env";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookCommand {
  type?: "command";
  command: string;
  timeout?: number;
}
export interface HookEntry {
  /** Biểu thức chính quy khớp tên công cụ (chỉ với PreToolUse/PostToolUse); bỏ trống = mọi công cụ. */
  matcher?: string;
  hooks: HookCommand[];
}
export type HooksConfig = Partial<Record<HookEvent, HookEntry[]>>;

export interface HookResult {
  blocked: boolean;
  /** Lý do chặn / phản hồi gửi cho mô hình. */
  message: string;
  /** Nội dung in ra (stdout) khi thoát mã 0: thêm vào ngữ cảnh. */
  context: string;
  warnings: string[];
}

/** Làm sạch cấu hình hooks đọc từ tệp: chỉ sự kiện biết, lệnh dạng chuỗi ngắn, số lượng hợp lý. */
export function sanitizeHooks(raw: unknown): HooksConfig {
  const out: HooksConfig = {};
  if (!raw || typeof raw !== "object") return out;
  for (const ev of HOOK_EVENTS) {
    const list = (raw as Record<string, unknown>)[ev];
    if (!Array.isArray(list)) continue;
    const entries: HookEntry[] = [];
    for (const e of list.slice(0, 20)) {
      if (!e || typeof e !== "object") continue;
      const hooks = Array.isArray((e as HookEntry).hooks) ? (e as HookEntry).hooks : [];
      const cmds = hooks
        .filter((h): h is HookCommand => !!h && typeof h.command === "string" && h.command.length > 0 && h.command.length <= 2000 && (h.type === undefined || h.type === "command"))
        .slice(0, 10)
        .map((h) => ({ type: "command" as const, command: h.command, timeout: Math.max(1, Math.min(Number(h.timeout) || 30, 120)) }));
      const matcher = typeof (e as HookEntry).matcher === "string" ? (e as HookEntry).matcher!.slice(0, 200) : undefined;
      if (cmds.length) entries.push({ matcher, hooks: cmds });
    }
    if (entries.length) out[ev] = entries;
  }
  return out;
}

export const countHooks = (c: HooksConfig): number => Object.values(c).reduce((n, es) => n + (es ?? []).reduce((m, e) => m + e.hooks.length, 0), 0);

export function mergeHooks(...configs: HooksConfig[]): HooksConfig {
  const out: HooksConfig = {};
  for (const c of configs) for (const ev of HOOK_EVENTS) if (c[ev]?.length) out[ev] = [...(out[ev] ?? []), ...c[ev]!];
  return out;
}

/**
 * Hooks: lệnh của người dùng chạy ở các thời điểm trong vòng đời agent (qua cùng sandbox với lệnh của agent).
 * Dữ liệu sự kiện qua biến môi trường NEU_HOOK_JSON (≤ 64 KB). Mã thoát: 0 = bình thường (stdout thêm vào ngữ cảnh với
 * SessionStart/UserPromptSubmit), 2 = chặn/phản hồi (đầu ra gửi lại cho mô hình), khác = chỉ cảnh báo.
 */
export class HookRunner {
  constructor(private cfg: HooksConfig, private env: Env, private root: string) {}

  get count(): number {
    return countHooks(this.cfg);
  }

  async run(event: HookEvent, data: { toolName?: string; toolInput?: unknown; toolOutput?: string; prompt?: string } = {}, signal?: AbortSignal): Promise<HookResult> {
    const res: HookResult = { blocked: false, message: "", context: "", warnings: [] };
    if (!this.env.exec) return res;
    for (const entry of this.cfg[event] ?? []) {
      if (data.toolName) {
        try {
          if (!new RegExp(`^(?:${entry.matcher && entry.matcher !== "*" ? entry.matcher : ".*"})$`).test(data.toolName)) continue;
        } catch {
          continue;
        }
      }
      for (const h of entry.hooks) {
        const payload = JSON.stringify({ event, tool_name: data.toolName ?? "", tool_input: data.toolInput ?? null, tool_output: data.toolOutput?.slice(0, 20000) ?? null, prompt: data.prompt ?? null, cwd: this.root });
        const json = payload.length > 64_000 ? payload.slice(0, 64_000) : payload;
        try {
          const r = await this.env.exec(h.command, { cwd: this.root, timeoutMs: (h.timeout ?? 30) * 1000, signal, env: { NEU_HOOK_EVENT: event, NEU_HOOK_JSON: json, NEU_PROJECT_DIR: this.root } });
          const out = r.output.trim();
          if (r.timedOut) res.warnings.push(`hook quá thời gian: ${h.command}`);
          else if (r.code === 2) {
            res.blocked = true;
            res.message += (out || "Bị chặn bởi hook.") + "\n";
          } else if (r.code === 0) {
            if (out) res.context += out + "\n";
          } else res.warnings.push(`hook thoát mã ${r.code}: ${h.command} ${out.slice(0, 200)}`);
        } catch (e) {
          res.warnings.push(`hook lỗi (${(e as Error).message}): ${h.command}`);
        }
      }
    }
    res.message = res.message.trim();
    res.context = res.context.trim();
    return res;
  }
}
