/**
 * Tác vụ định kỳ: lịch đơn giản (mỗi N phút / hằng ngày / hằng tuần) để agent tự chạy lại một việc khi ứng dụng đang mở.
 * Chỉ là logic thuần (không giờ hệ thống, không I/O): bộ điều khiển (controller.ts) giữ đồng hồ, lưu và chạy.
 * Ghi chú: `repeat.ts` là bộ phát hiện mô hình lặp chữ, không liên quan đến lịch.
 */
import { newId } from "./projects";

export const MAX_TASKS = 10;
/** Khoảng cách tối thiểu giữa hai lần chạy kiểu "mỗi N phút" (tránh đốt hạn mức token). */
export const MIN_MINUTES = 30;
/** Số lần chạy tối đa mỗi tác vụ mỗi ngày (kể cả bấm "Chạy ngay"). */
export const MAX_RUNS_PER_DAY = 12;
/** Mỗi lần chạy bị cắt sau thời gian này. */
export const RUN_TIMEOUT_MS = 15 * 60_000;
/** Bỏ lỡ giờ hẹn (ứng dụng đang đóng) quá lâu thì không chạy bù: người dùng không còn cần việc đó đúng lúc ấy. */
export const MISSED_AFTER_MS = 6 * 3600_000;

export type Every = { kind: "minutes"; n: number } | { kind: "daily"; at: string } | { kind: "weekly"; day: number; at: string };

export interface TaskRun {
  at: number;
  status: "ok" | "error" | "skipped";
  /** Kết quả rút gọn (chữ cuối cùng của agent hoặc lý do bỏ qua/lỗi). Lưu cục bộ, không bao giờ vào chẩn đoán. */
  summary: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  every: Every;
  enabled: boolean;
  /** Tab + dự án mà tác vụ thuộc về (tác vụ chạy trong thư mục dự án đó). */
  profile: string;
  projectId: string;
  createdAt: number;
  lastRun?: TaskRun;
  /** Ngày (giờ máy) và số lần đã chạy trong ngày đó, cho giới hạn mỗi ngày. */
  day?: string;
  runs?: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : ""); // eslint-disable-line no-control-regex

export function sanitizeEvery(raw: unknown): Every | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.kind === "minutes") {
    const n = Number(r.n);
    return Number.isInteger(n) && n >= MIN_MINUTES && n <= 7 * 24 * 60 ? { kind: "minutes", n } : null;
  }
  if (r.kind === "daily") return typeof r.at === "string" && TIME_RE.test(r.at) ? { kind: "daily", at: r.at } : null;
  if (r.kind === "weekly") return typeof r.at === "string" && TIME_RE.test(r.at) && Number.isInteger(r.day) && (r.day as number) >= 0 && (r.day as number) <= 6 ? { kind: "weekly", day: r.day as number, at: r.at } : null;
  return null;
}

/** Tác vụ mới do người dùng tạo; lỗi thì trả chuỗi báo cho người dùng. */
export function newTask(spec: { name?: unknown; prompt?: unknown; every?: unknown }, scope: { profile: string; projectId: string }, now: number): ScheduledTask | string {
  const name = clip(spec.name, 60);
  const prompt = clip(spec.prompt, 2000);
  if (!name) return "Hãy đặt tên cho tác vụ.";
  if (!prompt) return "Hãy nhập việc cần agent làm.";
  const every = sanitizeEvery(spec.every);
  if (!every) return `Lịch không hợp lệ (mỗi N phút thì N từ ${MIN_MINUTES}; hằng ngày/tuần cần giờ HH:MM).`;
  return { id: newId(), name, prompt, every, enabled: true, profile: scope.profile, projectId: scope.projectId, createdAt: now };
}

/** Làm sạch danh sách đọc từ tệp cài đặt. */
export function sanitizeTasks(raw: unknown): ScheduledTask[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduledTask[] = [];
  for (const x of raw.slice(0, MAX_TASKS * 5)) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, any>;
    const every = sanitizeEvery(r.every);
    const id = typeof r.id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r.id) ? r.id : "";
    const name = clip(r.name, 60);
    const prompt = clip(r.prompt, 2000);
    if (!every || !id || !name || !prompt || out.some((t) => t.id === id)) continue;
    const t: ScheduledTask = { id, name, prompt, every, enabled: r.enabled !== false, profile: clip(r.profile, 20), projectId: typeof r.projectId === "string" && r.projectId.length <= 40 ? r.projectId : "", createdAt: Number.isFinite(r.createdAt) ? r.createdAt : 0 };
    if (r.lastRun && Number.isFinite(r.lastRun.at) && ["ok", "error", "skipped"].includes(r.lastRun.status)) t.lastRun = { at: r.lastRun.at, status: r.lastRun.status, summary: clip(r.lastRun.summary, 800) };
    if (typeof r.day === "string" && /^\d{4}-\d\d-\d\d$/.test(r.day) && Number.isInteger(r.runs) && r.runs >= 0) {
      t.day = r.day;
      t.runs = r.runs;
    }
    out.push(t);
  }
  return out;
}

/** Ngày theo giờ máy, dạng YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const runsToday = (t: ScheduledTask, now: number): number => (t.day === dayKey(now) ? t.runs ?? 0 : 0);

/** Mốc hẹn gần nhất không sau `now` (chỉ cho hằng ngày/hằng tuần). */
function lastSlot(e: Exclude<Every, { kind: "minutes" }>, now: number): number {
  const [hh, mm] = e.at.split(":").map(Number);
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  if (e.kind === "weekly") d.setDate(d.getDate() - ((d.getDay() - e.day + 7) % 7));
  if (d.getTime() > now) d.setDate(d.getDate() - (e.kind === "daily" ? 1 : 7));
  return d.getTime();
}

/** "run": đến hạn chạy; "missed": đã qua giờ hẹn quá lâu (không chạy bù, chỉ ghi nhận); null: chưa đến. */
export function dueState(t: ScheduledTask, now: number): "run" | "missed" | null {
  if (!t.enabled) return null;
  const anchor = t.lastRun?.at ?? t.createdAt;
  if (t.every.kind === "minutes") return now >= anchor + t.every.n * 60_000 ? "run" : null;
  const slot = lastSlot(t.every, now);
  if (slot <= anchor) return null;
  return now - slot > MISSED_AFTER_MS ? "missed" : "run";
}

/** Ghi kết quả một lần chạy (lần "skipped" do bỏ lỡ/hết hạn mức không tính vào số lần trong ngày). */
export function withRun(t: ScheduledTask, now: number, run: Omit<TaskRun, "at">, counts: boolean): ScheduledTask {
  const today = dayKey(now);
  const base = t.day === today ? t.runs ?? 0 : 0;
  return { ...t, lastRun: { at: now, ...run, summary: run.summary.slice(0, 800) }, day: today, runs: base + (counts ? 1 : 0) };
}

const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
export const describeEvery = (e: Every): string => (e.kind === "minutes" ? `Mỗi ${e.n} phút` : e.kind === "daily" ? `Hằng ngày ${e.at}` : `${DAYS[e.day]} hằng tuần ${e.at}`);
export const WEEKDAYS = DAYS;
