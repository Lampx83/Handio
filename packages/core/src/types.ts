import type { DiffPreview, Todo } from "./tools";
import type { Mode } from "./permissions";
import type { DirEntry } from "./env";
import type { Profile } from "./profiles";
import type { Lesson } from "./learning-types";
import type { ExerciseSummary, GradeResult, TemplateSummary } from "./learning";
import type { ChatMeta, HistoryItem, ProjectsState } from "./projects";
import type { ChangeDiff, ChangeFile, RevertResult } from "./changes";
import type { RunSuggestion } from "./run-detect";
import type { DocView } from "./office/locate";
import type { Procedure } from "./work-ctl";

/** Một điểm có thể "quay lại" (/rewind): trước một yêu cầu của người dùng. */
export interface RewindPoint {
  index: number;
  text: string;
  /** Số tệp đã bị agent đụng tới từ điểm này (0 nếu không biết, vd cuộc trò chuyện mở lại từ lịch sử). */
  files: number;
}

/** Một lựa chọn trong câu hỏi của công cụ `ask_user`. */
export interface AskOption {
  label: string;
  description?: string;
}

/** Một câu hỏi có cấu trúc của agent (đã được lõi kiểm tra: 2–4 lựa chọn). */
export interface AskQuestion {
  question: string;
  /** Nhãn ngắn (≤ 12 ký tự). */
  header?: string;
  options: AskOption[];
  multiSelect: boolean;
}

/** Trả lời một câu hỏi: chỉ số lựa chọn đã chọn (theo `options`) và/hoặc chữ tự gõ ở ô "Khác". Cả hai trống = bỏ qua câu này. */
export interface QuestionAnswer {
  picked: number[];
  other?: string;
}

export interface PermissionRequest {
  id: string;
  /** "tool": xin chạy một công cụ; "plan": xin duyệt kế hoạch; "question": agent hỏi người dùng (`ask_user`), không cấp quyền gì cho công cụ khác. */
  kind: "tool" | "plan" | "question";
  tool: string;
  summary: string;
  args: Record<string, unknown>;
  preview?: DiffPreview | null;
  plan?: string;
  /** Với kind "question": các câu hỏi (1–4). */
  questions?: AskQuestion[];
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
  /** Với kế hoạch: bản kế hoạch người dùng đã tự sửa trước khi duyệt (agent làm theo bản này). */
  plan?: string;
  /** Với câu hỏi (`kind: "question"`): trả lời theo thứ tự câu hỏi. `allow: true` + mảng rỗng/không có = người dùng bấm "Để agent tự quyết". */
  answers?: QuestionAnswer[];
}

export type SessionEvent =
  | { type: "turn_start" }
  | { type: "text"; depth: number; delta: string }
  | { type: "reasoning"; depth: number; delta: string }
  | { type: "message_end"; depth: number; text: string }
  | { type: "tool_start"; id: string; name: string; summary: string; args: Record<string, unknown>; depth: number; preview?: DiffPreview | null }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string; depth: number; /** Mã loại lỗi (khi ok = false), vd "not_found", "program": để chẩn đoán phân biệt lỗi do agent với kết quả chạy chương trình. */ errKind?: string }
  | { type: "permission"; request: PermissionRequest }
  | { type: "permission_resolved"; id: string; allowed: boolean }
  | { type: "todos"; todos: Todo[] }
  | { type: "mode"; mode: Mode }
  | { type: "quota"; quota: QuotaInfo }
  | { type: "usage"; promptTokens: number; completionTokens: number; contextPct: number; calls: number; /** token lời nhắc dùng lại từ bộ nhớ đệm (cộng dồn; 0 nếu máy chủ không báo) */ cachedTokens?: number; /** Chi tiết cửa sổ ngữ cảnh (ước lượng đã hiệu chỉnh theo token thật) */ context?: { used: number; limit: number; parts: { name: string; tokens: number }[] } }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string; /** Hành động gợi ý cho người dùng: "login" = hiện nút Đăng nhập lại. */ action?: "login" }
  | { type: "files_changed"; paths: string[] }
  | { type: "summary"; turn: number; files: ChangeFile[]; /** Đã chạy kiểm tra sau lần sửa cuối chưa */ verify: "ok" | "fail" | "none" }
  | { type: "turn_end"; interrupted: boolean; final: string }
  | { type: "proc"; id: string; command: string; state: "start" | "data" | "exit"; text?: string; code?: number; url?: string }
  | { type: "reset" }
  /** Tổng quan các dự án chạy NỀN (không phải dự án đang mở): bao nhiêu đang làm việc, bao nhiêu đã xong mà bạn chưa xem. */
  | { type: "projects"; running: number; finished: number }
  /** Sau khi cập nhật/khởi động lại: giao diện mở lại cuộc trò chuyện `chatId` rồi gửi `text` để agent làm tiếp việc đang dở. */
  | { type: "resume"; chatId: string; text: string };

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
  /** Gửi chẩn đoán không chứa nội dung (mặc định bật; chính sách quản trị có thể ép tắt). Xem docs/DIAGNOSTICS.md. */
  diagnostics?: boolean;
  /** Mã ngẫu nhiên của máy cài (không phải danh tính), do bộ chẩn đoán tự tạo. */
  diagId?: string;
}

/** Bản gửi cho giao diện: không chứa key. */
export interface PublicSettings extends Omit<Settings, "key"> {
  hasKey: boolean;
  keyHint: string;
}

/** Hạn mức token trong ngày của người dùng (do máy chủ đếm; làm mới 00:00 giờ Việt Nam). */
export interface QuotaInfo {
  /** Hạn mức/ngày; 0 = không giới hạn. */
  limit: number;
  used: number;
  remaining: number | null;
  pct: number | null;
  /** ok < nhắc < grace (hết hạn mức, được hoàn tất việc đang làm) < exceeded (bị chặn). */
  state: "ok" | "warn" | "grace" | "exceeded" | "unlimited";
  /** Thời điểm làm mới (giây epoch). */
  resetAt: number;
  tier?: string;
}

export interface UiState {
  /** Dự án khác đang chạy nền / đã xong chưa xem (chỉ khi mở nhiều dự án cùng lúc). */
  background?: { running: number; finished: number };
  /** Nội dung đang làm dở của cuộc trò chuyện hiện tại (chỉ khi agent đang chạy): dựng lại khung chat khi quay lại dự án đang chạy nền. */
  live?: HistoryItem[];
  /** Hạn mức token hôm nay (null = chưa biết / không có). */
  quota?: QuotaInfo | null;
  profile: Profile;
  profileLabel: string;
  tagline: string;
  welcomeTitle: string;
  suggestions: string[];
  allowedModes: Mode[];
  workspace: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  /** Cuộc trò chuyện đang mở (đổi khi bấm “Mới” hoặc mở lại một cuộc cũ). */
  chatId: string;
  mode: Mode;
  model: string;
  settings: PublicSettings;
  commands: SlashCommandInfo[];
  todos: Todo[];
  busy: boolean;
  capabilities: { exec: boolean; runJs: boolean; fetch: boolean; openFolder: boolean; realFs: boolean; openExternal: boolean; revealWorkspace: boolean; pdf: boolean; reset: boolean; sandbox: boolean; projects: boolean; pickFolder: boolean; chats: boolean; renderDesign: boolean };
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
  /** Sửa tệp chữ ĐÃ CÓ trong dự án ngay trong ứng dụng (không tạo tệp mới, không sửa tệp nhị phân/Office/quá lớn). */
  writeTextFile?(path: string, text: string): Promise<{ ok: true } | { error: string }>;
  /** Thêm tệp từ máy người dùng vào thư mục làm việc (tự đổi tên nếu trùng). Trả về đường dẫn đã lưu. */
  uploadFiles(files: { name: string; data: Uint8Array }[]): Promise<{ saved: string[]; errors: string[] }>;
  /** Ảnh dán (Ctrl+V): lưu TẠM ngoài thư mục dự án; trả về tham chiếu `dan/<tên>` để nhắc bằng @. */
  pasteImages?(files: { name: string; data: Uint8Array }[]): Promise<{ refs: string[]; errors: string[]; /** thư mục đã lưu ảnh (để báo cho người dùng biết ảnh nằm đâu) */ dir?: string }>;
  downloadFile(path: string): Promise<{ name: string; data: Uint8Array } | { error: string }>;
  /** Nén cả thư mục làm việc thành một file zip. */
  exportZip(): Promise<{ name: string; data: Uint8Array }>;
  openExternally?(path: string): Promise<void>;
  revealWorkspace?(): Promise<void>;
  /** Bản web: xoá thư mục ảo và nạp lại dữ liệu mẫu. */
  resetWorkspace?(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /** Danh sách mô hình trên máy chủ (cho ô chọn mô hình trong Cài đặt). */
  listModels?(): Promise<string[]>;
  /** Bỏ các quy tắc “Luôn cho phép” đã lưu (chỉ thắt chặt, không thêm quyền). */
  resetPermissions?(): Promise<void>;
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
  /** Dự án (thư mục làm việc) của tab này. */
  projectsState?(): Promise<ProjectsState>;
  projectOpen?(id: string): Promise<void>;
  projectCreate?(spec: { name: string; instructions?: string }): Promise<{ ok: true } | { error: string }>;
  /** Chọn một thư mục có sẵn trên máy làm dự án (Desktop). */
  projectPick?(): Promise<{ ok: boolean } | { error: string }>;
  projectRemove?(id: string): Promise<{ ok: true } | { error: string }>;
  projectRename?(id: string, name: string): Promise<void>;
  /** Hướng dẫn riêng của dự án (tệp AGENTS.md ở thư mục gốc dự án). */
  instructionsGet?(): Promise<string>;
  instructionsSet?(text: string): Promise<void>;
  /** Lịch sử trò chuyện của dự án đang mở. */
  chatList?(): Promise<ChatMeta[]>;
  chatOpen?(id: string): Promise<{ id: string; title: string; history: HistoryItem[] } | { error: string }>;
  chatRemove?(id: string): Promise<void>;
  /** Xuất một thiết kế (.html/.svg) ra PDF hoặc PNG cạnh tệp gốc (Desktop). */
  exportDesign?(path: string, format: "pdf" | "png", width: number, height?: number): Promise<{ saved: string } | { error: string }>;
  /** Dừng một lệnh chạy nền. */
  stopProcess?(id: string): Promise<void>;
  /** Mở địa chỉ localhost (xem trước ứng dụng web đang chạy) trong trình duyệt. */
  openUrl?(url: string): Promise<void>;
  /** "Thay đổi": các tệp agent đã tạo/sửa/xoá trong cuộc trò chuyện này, so với bản gốc. */
  changesList?(): Promise<ChangeFile[]>;
  changeDiff?(path: string): Promise<ChangeDiff | { error: string }>;
  /** Hoàn tác một tệp (có `path`) hoặc tất cả. */
  changesRevert?(path?: string): Promise<RevertResult | { error: string }>;
  /** /rewind: các điểm quay lại; `rewind` cắt hội thoại về trước điểm đó (và khôi phục tệp nếu `files`). */
  rewindPoints?(): Promise<RewindPoint[]>;
  rewind?(index: number, files: boolean): Promise<{ history: HistoryItem[]; reverted: string[]; skipped: string[]; text: string } | { error: string }>;
  /** Gợi ý lệnh chạy/kiểm thử dự án. */
  runSuggestions?(): Promise<RunSuggestion[]>;
  /** Bấm ▶ với lệnh chạy nền (máy chủ web…): chạy thẳng, không qua mô hình. Chỉ nhận lệnh có trong `runSuggestions`. */
  startBackground?(command: string): Promise<{ id: string; url?: string; alive: boolean; code?: number } | { error: string }>;
  /** Work: xem tài liệu (chỉ đọc) và đánh dấu vị trí trích dẫn; "Quy trình của tôi" = lệnh / lưu trong dự án. */
  docView?(path: string, loc?: string): Promise<DocView | { error: string }>;
  procedureList?(): Promise<Procedure[]>;
  procedureSave?(name: string, description?: string): Promise<{ ok: true; name: string } | { error: string }>;
  procedureRemove?(name: string): Promise<void>;
  /** Chẩn đoán không chứa nội dung (docs/DIAGNOSTICS.md): trạng thái; xem trước gói “Báo lỗi” (JSON đúng như sẽ gửi, null nếu bị cấm); gửi chính gói đó. */
  /** Ghi một việc người dùng làm trong giao diện (mã trong DIAG_UI_ACTS), cho chẩn đoán không chứa nội dung. Không có = bỏ qua. */
  track?(act: string): void;
  /** Phản hồi 👍/👎 (kèm lý do chọn sẵn) cho câu trả lời vừa rồi. */
  feedback?(v: "up" | "down", reason?: string): void;
  /** Gửi góp ý/báo lỗi do người dùng viết tới nhóm phát triển (lưu ở máy chủ cho quản trị viên). Không bao giờ ném lỗi. */
  sendFeedback?(f: import("./feedback").FeedbackInput): Promise<import("./feedback").FeedbackResult>;
  /** Chia sẻ cuộc trò chuyện: xem trước (đã che nhạy cảm), tạo liên kết, danh sách đã chia sẻ, thu hồi. Không bao giờ ném lỗi. */
  sharePreview?(chatId?: string): Promise<import("./share").SharePreview>;
  shareChat?(f: { chatId?: string; title?: string }): Promise<import("./share").ShareResult>;
  sharedChats?(): Promise<import("./share").SharedChatInfo[]>;
  unshareChat?(id: string): Promise<{ ok: boolean; message: string }>;
  diagnosticsStatus?(): Promise<{ available: boolean; enabled: boolean; lockedByPolicy: boolean }>;
  diagnosticsPreview?(note: string): Promise<string | null>;
  diagnosticsSend?(): Promise<{ ok: boolean }>;
}
