import type { DiffPreview, Todo } from "./tools";
import type { Mode } from "./permissions";
import type { DirEntry } from "./env";
import type { Profile } from "./profiles";
import type { Lesson } from "./learning-types";
import type { ExerciseSummary, GradeResult, TemplateSummary } from "./learning";

export interface PermissionRequest {
  id: string;
  /** "tool": xin chạy một công cụ; "plan": xin duyệt kế hoạch. */
  kind: "tool" | "plan";
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  preview?: DiffPreview | null;
  plan?: string;
  /** Lý do cần hỏi (vd file cấu hình dự án). */
  note?: string;
  depth: number;
}

export interface PermissionResponse {
  allow: boolean;
  /** Chọn "luôn cho phép" (thêm quy tắc cho phiên). */
  always?: boolean;
  /** Lý do từ chối / góp ý kế hoạch, gửi lại cho mô hình. */
  note?: string;
  /** Với kế hoạch: chế độ chuyển sang sau khi duyệt. */
  mode?: Mode;
}

export type SessionEvent =
  | { type: "turn_start" }
  | { type: "text"; depth: number; delta: string }
  | { type: "reasoning"; depth: number; delta: string }
  | { type: "message_end"; depth: number; text: string }
  | { type: "tool_start"; id: string; name: string; summary: string; args: Record<string, unknown>; depth: number; preview?: DiffPreview | null }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string; depth: number }
  | { type: "permission"; request: PermissionRequest }
  | { type: "permission_resolved"; id: string; allowed: boolean }
  | { type: "todos"; todos: Todo[] }
  | { type: "mode"; mode: Mode }
  | { type: "usage"; promptTokens: number; completionTokens: number; contextPct: number; calls: number }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | { type: "files_changed"; paths: string[] }
  | { type: "turn_end"; interrupted: boolean; final: string }
  | { type: "proc"; id: string; command: string; state: "start" | "data" | "exit"; text?: string; code?: number; url?: string }
  | { type: "reset" };

export interface SlashCommandInfo {
  name: string;
  description: string;
}

export interface Settings {
  baseUrl: string;
  model: string;
  keyHeader: string;
  thinking: boolean;
  allowInsecureHttp: boolean;
  mode: Mode;
  maxSteps: number;
  contextTokens: number;
  temperature: number;
  maxOutputTokens: number;
  permissions: { allow: string[]; deny: string[] };
  /** Hooks và MCP của người dùng (chỉ sửa được bằng tay trong tệp cài đặt, không qua giao diện). */
  hooks: import("./hooks").HooksConfig;
  mcpServers: Record<string, import("./mcp").McpServerSpec>;
  /** Chỉ có ở phía lưu trữ; UI không bao giờ nhận giá trị thật. */
  key?: string;
}

/** Bản gửi cho giao diện: không chứa key. */
export interface PublicSettings extends Omit<Settings, "key"> {
  hasKey: boolean;
  keyHint: string;
}

export interface UiState {
  profile: Profile;
  profileLabel: string;
  tagline: string;
  welcomeTitle: string;
  suggestions: string[];
  allowedModes: Mode[];
  workspace: string;
  workspaceName: string;
  mode: Mode;
  model: string;
  settings: PublicSettings;
  commands: SlashCommandInfo[];
  todos: Todo[];
  busy: boolean;
  capabilities: { exec: boolean; runJs: boolean; fetch: boolean; openFolder: boolean; realFs: boolean; openExternal: boolean; revealWorkspace: boolean; pdf: boolean; reset: boolean; sandbox: boolean };
  /** Có file cấu hình của dự án đang chờ người dùng tin cậy. */
  untrustedProject: boolean;
  /** Các mục bị chính sách quản trị khoá (UI vô hiệu hoá) và lời nhắn của quản trị viên. */
  policy: { baseUrl: boolean; insecureHttp: boolean; notice?: string };
  memoryFiles: string[];
  processes: { id: string; command: string; alive: boolean; url?: string }[];
  presets: { label: string; baseUrl: string; model: string; needsKey: boolean }[];
}

/** Giao diện dùng chung giữa UI và nơi chạy agent (cùng trang ở web, qua IPC ở desktop). */
export interface AgentController {
  getState(): Promise<UiState>;
  onEvent(cb: (e: SessionEvent) => void): () => void;
  send(text: string): Promise<void>;
  interrupt(): void;
  respondPermission(id: string, res: PermissionResponse): void;
  setMode(mode: Mode): Promise<void>;
  newSession(): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<{ text: string; truncated: boolean; kind: "text" | "document" } | { error: string }>;
  /** Thêm tệp từ máy người dùng vào thư mục làm việc (tự đổi tên nếu trùng). Trả về đường dẫn đã lưu. */
  uploadFiles(files: { name: string; data: Uint8Array }[]): Promise<{ saved: string[]; errors: string[] }>;
  downloadFile(path: string): Promise<{ name: string; data: Uint8Array } | { error: string }>;
  /** Nén cả thư mục làm việc thành một file zip. */
  exportZip(): Promise<{ name: string; data: Uint8Array }>;
  openExternally?(path: string): Promise<void>;
  revealWorkspace?(): Promise<void>;
  /** Bản web: xoá thư mục ảo và nạp lại dữ liệu mẫu. */
  resetWorkspace?(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  trustProject(trust: boolean): Promise<void>;
  openFolder?(): Promise<void>;
  /** Học tập (tab Code): giáo trình, bài tập có chấm, dự án mẫu. */
  learnLessons?(): Promise<Lesson[]>;
  learnExercises?(): Promise<ExerciseSummary[]>;
  learnExercise?(id: string): Promise<{ id: string; title: string; goal: string; instructions: string; lang: string; level: number; minutes: number; concepts: string[]; hintCount: number } | { error: string }>;
  learnStart?(id: string): Promise<{ dir: string; created: string[] } | { error: string }>;
  learnHint?(id: string, n: number): Promise<{ text: string; index: number; total: number } | { error: string }>;
  learnGrade?(id: string): Promise<GradeResult | { error: string }>;
  learnTemplates?(): Promise<TemplateSummary[]>;
  learnCreate?(id: string): Promise<{ dir: string; files: number } | { error: string }>;
  /** Gợi ý tệp cho `@` trong ô chat. */
  searchFiles?(query: string): Promise<string[]>;
  /** Dừng một lệnh chạy nền. */
  stopProcess?(id: string): Promise<void>;
  /** Mở địa chỉ localhost (xem trước ứng dụng web đang chạy) trong trình duyệt. */
  openUrl?(url: string): Promise<void>;
}
