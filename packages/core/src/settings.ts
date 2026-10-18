import type { Mode } from "./permissions";
import { MODES } from "./permissions";
import { sanitizeHooks, type HooksConfig } from "./hooks";
import { sanitizeMcpServers, type McpServerSpec } from "./mcp";
import { sanitizeTasks } from "./schedule";
import { sanitizeImage, sanitizePorts } from "./container";
import type { PublicSettings, Settings } from "./types";

/**
 * Key tích hợp sẵn do ỨNG DỤNG cung cấp (Desktop). Chỉ được gửi tới các máy chủ trong `hosts` và chỉ khi người dùng chưa tự nhập key.
 * Bản web KHÔNG mang key: nginx phía máy chủ gắn key vào header (xem deploy/220).
 */
export interface BuiltinKey {
  key: string;
  hosts: string[];
}

/** Key sẽ dùng: key người dùng nhập; nếu chưa có thì key tích hợp (chỉ khi máy chủ nằm trong danh sách cho phép). */
export function effectiveKey(s: { key?: string; baseUrl: string }, builtin: BuiltinKey | undefined): { key?: string; builtin: boolean } {
  if (s.key) return { key: s.key, builtin: false };
  if (!builtin) return { builtin: false };
  try {
    return builtin.hosts.includes(new URL(s.baseUrl).host) ? { key: builtin.key, builtin: true } : { builtin: false };
  } catch {
    return { builtin: false };
  }
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://ai.neu.edu.vn/agent/vllm/v1",
  model: "qwen3.5-35b-a3b-int4",
  keyHeader: "x-ollama-seckey",
  thinking: false,
  allowInsecureHttp: false,
  mode: "default",
  maxSteps: 40,
  contextTokens: 32768,
  temperature: 0.3,
  maxOutputTokens: 4096,
  permissions: { allow: [], deny: [] },
  hooks: {},
  mcpServers: {},
};

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length < 300).slice(0, 200) : []);

/** Gộp cấu hình cấp người dùng (đáng tin) lên mặc định. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined, defaults: Partial<Settings> = {}): Settings {
  const r = raw ?? {};
  const s: Settings = { ...DEFAULT_SETTINGS, ...defaults, ...r, permissions: { allow: strList(r.permissions?.allow), deny: strList(r.permissions?.deny) } };
  s.hooks = sanitizeHooks(r.hooks);
  s.mcpServers = sanitizeMcpServers(r.mcpServers);
  if (r.tasks !== undefined) s.tasks = sanitizeTasks(r.tasks);
  // container (tab Code): chỉ giữ giá trị đúng kiểu; ảnh/cổng sai bị bỏ
  for (const k of ["container", "containerNetwork"] as const) if (s[k] !== undefined && typeof s[k] !== "boolean") delete s[k];
  if (s.containerPorts !== undefined) s.containerPorts = sanitizePorts(s.containerPorts);
  if (s.containerImage !== undefined && !sanitizeImage(s.containerImage)) delete s.containerImage;
  // `mode` đã lưu = "default" là dấu vết của phiên bản cũ: giao diện không bao giờ lưu lựa chọn chế độ (chọn ở thanh dưới ô nhập chỉ có hiệu lực trong
  // phiên), nhưng cài đặt cũ ghi nguyên bản mặc định lúc đó vào tệp và nó đè lên mặc định sản phẩm ("auto"). Coi như chưa đặt.
  if (r.mode === "default" && defaults.mode && defaults.mode !== "default") s.mode = defaults.mode;
  if (!MODES.includes(s.mode)) s.mode = "default";
  s.baseUrl = String(s.baseUrl || defaults.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "");
  s.maxSteps = Math.max(1, Math.min(Number(s.maxSteps) || 40, 200));
  s.contextTokens = Math.max(4096, Number(s.contextTokens) || 32768);
  return s;
}

export interface ProjectSettings {
  /** Quy tắc cấm luôn có hiệu lực (chỉ làm chặt thêm). */
  deny: string[];
  /** Quy tắc cho phép chỉ có hiệu lực khi người dùng đã tin cậy thư mục. */
  allow: string[];
  mode?: Mode;
  /** Hooks và máy chủ MCP của dự án: CHẠY LỆNH THẬT nên chỉ có hiệu lực sau khi người dùng bấm "Tin cậy". */
  hooks?: HooksConfig;
  mcpServers?: Record<string, McpServerSpec>;
}

/**
 * Cấu hình trong thư mục dự án (.neuagent/settings.json) là DỮ LIỆU KHÔNG ĐÁNG TIN: một repo lạ không được
 * đổi địa chỉ máy chủ, lấy key, chạy hook/MCP. Ở đây chỉ trích phần quyền; mọi trường khác bị bỏ.
 */
export function sanitizeProjectSettings(raw: unknown): ProjectSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const mode: Mode | undefined = MODES.includes(r.mode) && r.mode !== "bypass" ? r.mode : undefined;
  return { deny: strList(r.permissions?.deny), allow: strList(r.permissions?.allow), mode, hooks: sanitizeHooks(r.hooks), mcpServers: sanitizeMcpServers(r.mcpServers) };
}

export function toPublic(s: Settings, builtin?: BuiltinKey): PublicSettings {
  const { key, diagId: _diagId, ...rest } = s;
  const eff = effectiveKey(s, builtin);
  return { ...rest, hasKey: !!eff.key, keyHint: key ? "••••" + key.slice(-4) : eff.builtin ? "key tích hợp sẵn" : "" };
}
