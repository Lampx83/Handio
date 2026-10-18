import type { Env } from "./env";
import type { ChatMessage } from "./llm";

/** Một dự án = một thư mục làm việc (thật ở Desktop, ảo trong trình duyệt) cùng các cuộc trò chuyện của nó. */
export interface ProjectInfo {
  id: string;
  name: string;
  /** Đường dẫn thư mục thật (chỉ Desktop). */
  path?: string;
  created: number;
  lastUsed: number;
  /** Trạng thái lúc hỏi danh sách (không lưu): agent đang làm việc trong dự án này. */
  running?: boolean;
  /** Đã làm xong khi bạn đang ở dự án khác và chưa mở lại xem (không lưu). */
  finished?: boolean;
  /** Số cuộc trò chuyện của dự án bị dừng giữa chừng (dừng tay, chuyển dự án, mất kết nối) và chưa làm tiếp. */
  unfinished?: number;
}

export interface ProjectsState {
  active: string;
  projects: ProjectInfo[];
  /** Có thể chọn một thư mục có sẵn trên máy (Desktop). */
  canPick: boolean;
}

/** Nơi lưu danh sách dự án và tạo môi trường (Env) cho từng dự án. Do ứng dụng chủ cung cấp (Desktop/Web). */
export interface ProjectHost {
  list(): Promise<ProjectsState>;
  open(id: string): Promise<Env>;
  /** Môi trường của dự án mà KHÔNG đổi "dự án đang mở" (bộ lập lịch tác vụ định kỳ chạy dự án chưa mở). Không có = chỉ chạy tác vụ của dự án đã mở. */
  peek?(id: string): Promise<Env>;
  create(spec: { name: string }): Promise<{ info: ProjectInfo; env: Env }>;
  /** Chọn một thư mục có sẵn làm dự án (hộp thoại hệ điều hành). null nếu huỷ. */
  pick?(): Promise<{ info: ProjectInfo; env: Env } | null>;
  /** Bỏ dự án khỏi danh sách. KHÔNG xoá tệp trên đĩa. */
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
}

export interface ChatMeta {
  id: string;
  title: string;
  updated: number;
  /** Số lượt người dùng đã hỏi. */
  turns: number;
  /** Lượt cuối bị dừng giữa chừng (dừng tay, chuyển dự án, mất kết nối): chưa xong, có thể làm tiếp. */
  unfinished?: boolean;
  /** Agent đang làm việc trong cuộc trò chuyện này (không lưu). */
  running?: boolean;
  /** Lần chạy tự động của tác vụ định kỳ có mã này (schedule.ts). */
  task?: string;
}
export interface SavedChat extends ChatMeta {
  messages: ChatMessage[];
  /** Nội dung người dùng gõ (trước khi mở rộng lệnh / và đính kèm @tệp), theo thứ tự các lượt hỏi. */
  inputs?: string[];
  /** Tin nhắn trước các lần tóm tắt ngữ cảnh (mô hình không còn thấy): để lịch sử và bản chia sẻ không mất phần đầu. */
  archived?: ChatMessage[];
}

/** Lưu lịch sử trò chuyện theo dự án (Desktop: thư mục dữ liệu ứng dụng; Web: localStorage). Không ghi vào thư mục dự án của người dùng. */
export interface ChatStore {
  list(projectId: string): Promise<ChatMeta[]>;
  load(projectId: string, id: string): Promise<SavedChat | null>;
  save(projectId: string, chat: SavedChat): Promise<void>;
  remove(projectId: string, id: string): Promise<void>;
}

/** Một dòng của lịch sử đã lưu, để giao diện dựng lại cuộc trò chuyện. */
export interface HistoryItem {
  kind: "user" | "assistant" | "tool";
  text: string;
  /** Với kind = "tool": tên công cụ và tóm tắt tham số. */
  name?: string;
}

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Tên dự án hợp lệ: gọn, không ký tự điều khiển; dùng được làm tên thư mục. */
export function cleanProjectName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 60);
}

/** Tên hiển thị không trùng tên dự án đang có (không phân biệt hoa/thường): "Bài 2" → "Bài 2 (2)" khi đã có "Bài 2" TRONG DANH SÁCH. */
export function uniqueProjectName(existing: readonly string[], name: string): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let out = name;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${name} (${n})`;
  return out;
}

export const isInternalUser = (t: string): boolean => /^\[(Tôi vừa tự chạy lệnh|Hook |Hệ thống)/.test(t) || t.startsWith("Hãy tiếp tục công việc đang làm dở") || t.startsWith("[Tóm tắt") || /^(Kế hoạch được duyệt|Người dùng chưa duyệt|Không ở chế độ plan)/.test(t);

/** Tiêu đề cuộc trò chuyện = câu hỏi đầu tiên của người dùng. */
export function chatTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content && !isInternalUser(m.content));
  const t = (first?.content ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > 60 ? t.slice(0, 58) + "…" : t) : "Cuộc trò chuyện mới";
}

export const countTurns = (messages: ChatMessage[]): number => messages.filter((m) => m.role === "user" && m.content && !isInternalUser(m.content)).length;

const MAX_TOOL_OUT = 1500;
/** Rút gọn kết quả công cụ dài trước khi lưu (giữ cho lịch sử nhỏ; mô hình vẫn thấy phần đầu). */
export function trimForSave(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.role === "tool" && m.content && m.content.length > MAX_TOOL_OUT ? { ...m, content: m.content.slice(0, MAX_TOOL_OUT) + "\n… (đã cắt khi lưu)" } : m));
}

/** Phần trước các lần tóm tắt khi lưu: rút gọn và chỉ giữ ~600 tin cuối (bản web lưu ở localStorage, dung lượng có hạn). */
export const archiveForSave = (old: ChatMessage[]): ChatMessage[] => trimForSave(old.slice(-600));

function briefArgs(json: string): string {
  try {
    const a = JSON.parse(json) as Record<string, unknown>;
    for (const k of ["path", "file_path", "command", "pattern", "query", "url", "description", "prompt"]) {
      const v = a[k];
      if (typeof v === "string" && v) return v.length > 90 ? v.slice(0, 88) + "…" : v;
    }
  } catch {
    /* bỏ qua */
  }
  return "";
}

/** Chuyển tin nhắn đã lưu thành các dòng hiển thị (người dùng, trả lời, công cụ đã dùng). */
export function messagesToHistory(messages: ChatMessage[], inputs?: string[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  // chỉ dùng `inputs` khi khớp số lượt (sau khi tóm tắt hội thoại thì số lượt đổi)
  const raw = inputs && inputs.length === countTurns(messages) ? inputs : null;
  let k = 0;
  for (const m of messages) {
    if (m.role === "user" && m.content && !isInternalUser(m.content)) out.push({ kind: "user", text: raw ? raw[k++] : m.content });
    else if (m.role === "assistant") {
      if (m.content?.trim()) out.push({ kind: "assistant", text: m.content });
      for (const c of m.tool_calls ?? []) out.push({ kind: "tool", text: briefArgs(c.function.arguments), name: c.function.name });
    }
  }
  return out;
}
