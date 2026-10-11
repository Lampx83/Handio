import type { HistoryItem } from "@neu/agent-core";
import { h, store } from "./dom";

/**
 * Chế độ yên lặng của tab Work: người dùng văn phòng không cần xem từng lệnh công cụ.
 * Mọi hoạt động của một lượt gom vào MỘT khối gập; ngoài dòng chính chỉ còn kết quả cuối và các tệp vừa làm.
 * Phần thuần (không DOM) ở đây để kiểm thử được; `ActivityBlock` là phần dựng DOM.
 */

// ------------------------------------------------------------------ công tắc
const DETAIL = store("neu.detail");
/** "Hiện từng bước chi tiết" (mặc định tắt). Chỉ có nghĩa ở tab Work. */
export const detailSteps = (): boolean => DETAIL.get() === "1";
export const setDetailSteps = (on: boolean): void => DETAIL.set(on ? "1" : "0");
/** Tab Work mà không bật chi tiết thì yên lặng; Code và Design luôn chi tiết. */
export const isQuiet = (profile: string | undefined, detail: boolean): boolean => profile === "work" && !detail;

// ------------------------------------------------------------------ nhãn thân thiện
const LABELS: [RegExp, string][] = [
  [/^create_pptx$/, "Đang tạo bài trình chiếu"],
  [/^pptx_/, "Đang chỉnh bài trình chiếu"],
  [/^create_docx$/, "Đang soạn văn bản Word"],
  [/^docx_/, "Đang chỉnh văn bản Word"],
  [/^(create_)?xlsx(_|$)/, "Đang làm bảng tính"],
  [/^(read_document|read_file|find_in_documents)$/, "Đang đọc tài liệu"],
  [/^web_/, "Đang tra cứu"],
  [/^(create_pdf|convert_to_pdf|images_to_pdf|pdf_)/, "Đang làm PDF"],
  [/^(list_dir|glob|grep)$/, "Đang xem thư mục"],
];
export const DEFAULT_LABEL = "Đang làm việc";

/** Việc đang làm, bằng tiếng Việt thường, theo tên công cụ. */
export function activityLabel(tool: string | null | undefined): string {
  if (!tool) return DEFAULT_LABEL;
  for (const [re, label] of LABELS) if (re.test(tool)) return label;
  return DEFAULT_LABEL;
}

/** Công cụ nội bộ (lập danh sách việc, hỏi, trình kế hoạch) không tính là "bước". */
const NON_STEP = new Set(["todo_write", "ask_user", "exit_plan_mode"]);
export const countsAsStep = (name: string, depth = 0): boolean => depth === 0 && !NON_STEP.has(name);
/** Người dùng tự từ chối không phải "lỗi cần tự xử lý". */
export const countsAsError = (ok: boolean, errKind?: string): boolean => !ok && errKind !== "denied";
/** Lời dẫn đứng ngay trước các công cụ này là phần câu hỏi/kế hoạch: giữ ở dòng chính. */
export const keepsPrecedingText = (name: string): boolean => name === "ask_user" || name === "exit_plan_mode";

export function durationText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} phút ${s % 60} giây` : `${m} phút`;
}

// ------------------------------------------------------------------ tiêu đề khối
export type ActivityPhase = "running" | "waiting" | "done" | "stopped" | "unfinished";
export interface ActivityStats {
  phase: ActivityPhase;
  steps: number;
  errors: number;
  /** Công cụ đang chạy gần nhất (cho nhãn). */
  tool: string | null;
  ms: number;
}
export interface Headline {
  title: string;
  /** "N bước", thời gian */
  meta: string[];
  /** "đã tự xử lý N lỗi" (hiện nhạt) */
  note: string;
}

export function headline(s: ActivityStats): Headline {
  const finished = s.phase === "done" || s.phase === "stopped" || s.phase === "unfinished";
  const title = s.phase === "waiting" ? "Đang chờ bạn…" : s.phase === "done" ? "✓ Hoàn tất" : s.phase === "stopped" ? "Đã dừng" : s.phase === "unfinished" ? "Chưa hoàn tất" : activityLabel(s.tool);
  const meta: string[] = [];
  if (s.steps > 0) meta.push(`${s.steps} bước`);
  if (finished) meta.push(durationText(s.ms));
  const note = s.errors > 0 ? (s.phase === "unfinished" ? `${s.errors} lỗi` : `đã tự xử lý ${s.errors} lỗi`) : "";
  return { title, meta, note };
}

export function headlineText(s: ActivityStats): string {
  const hl = headline(s);
  return [hl.title, ...hl.meta, ...(hl.note ? [hl.note] : [])].join(" · ");
}

// ------------------------------------------------------------------ chip tệp cuối lượt
const CHIP_EXT = /\.(docx|doc|xlsx|xlsm|xls|pptx|ppt|pdf|txt|md|csv|rtf|odt|ods|odp)$/i;
/** Tệp Office/PDF/văn bản agent đã tạo hoặc sửa trong lượt: bỏ tệp tạm `~$…`, tệp/thư mục ẩn, thư mục; mỗi tệp một lần. */
export function changedFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const p = String(raw ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p || p.endsWith("/") || out.includes(p)) continue;
    const segs = p.split("/");
    if (segs.some((s) => s.startsWith(".") || s.startsWith("~$"))) continue;
    if (!CHIP_EXT.test(segs[segs.length - 1])) continue;
    out.push(p);
  }
  return out;
}
export function chipSplit(files: string[], max = 4): { shown: string[]; more: number } {
  return { shown: files.slice(0, max), more: Math.max(0, files.length - max) };
}
/** Mở được trong khung xem tài liệu của tab Work. */
export const isDocViewable = (path: string): boolean => /\.(docx|xlsx|xlsm|pptx|pdf)$/i.test(path);

// ------------------------------------------------------------------ gom lịch sử đã lưu
export type HistoryBlock =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "activity"; items: HistoryItem[]; steps: number; /** Lượt có trả lời cuối sau các bước */ hasFinal: boolean };

/**
 * Mỗi lượt (giữa hai tin người dùng): mọi thứ đến công cụ cuối cùng (lời dẫn + công cụ) thành một khối `activity`;
 * văn bản sau công cụ cuối là câu trả lời, giữ ở dòng chính. Lượt không có công cụ giữ nguyên.
 */
export function groupHistory(items: HistoryItem[]): HistoryBlock[] {
  const out: HistoryBlock[] = [];
  let turn: HistoryItem[] = [];
  const flush = (): void => {
    if (!turn.length) return;
    let last = -1;
    turn.forEach((it, i) => it.kind === "tool" && (last = i));
    if (last < 0) {
      for (const it of turn) out.push({ kind: "assistant", text: it.text });
    } else {
      const inner: HistoryItem[] = [];
      const kept: HistoryItem[] = [];
      for (let i = 0; i <= last; i++) {
        const it = turn[i];
        const next = turn[i + 1];
        if (it.kind === "assistant" && next?.kind === "tool" && keepsPrecedingText(next.name ?? "")) kept.push(it);
        else inner.push(it);
      }
      const tail = turn.slice(last + 1).filter((it) => it.kind === "assistant" && it.text.trim());
      out.push({ kind: "activity", items: inner, steps: inner.filter((it) => it.kind === "tool" && countsAsStep(it.name ?? "")).length, hasFinal: tail.length > 0 });
      for (const it of [...kept, ...tail]) out.push({ kind: "assistant", text: it.text });
    }
    turn = [];
  };
  for (const it of items) {
    if (it.kind === "user") {
      flush();
      out.push({ kind: "user", text: it.text });
    } else turn.push(it);
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ khối gập (DOM)
let seq = 0;

export class ActivityBlock {
  readonly el: HTMLElement;
  /** Chi tiết: các thẻ công cụ, lời dẫn, thông báo nhẹ. */
  readonly list: HTMLElement;
  private head: HTMLButtonElement;
  private spin = h("span", { class: "spin", "aria-hidden": "true" });
  private titleEl = h("span", { class: "act-t" });
  private metaEl = h("span", { class: "act-m" });
  private noteEl = h("span", { class: "act-e" });
  private live = h("span", { class: "sr-only", role: "status" });
  private stats: ActivityStats = { phase: "running", steps: 0, errors: 0, tool: null, ms: 0 };
  private running = new Map<string, string>();
  private lastFailed = false;
  private started: number;
  /** Khối dựng từ lịch sử đã lưu: không có thời gian, chỉ số bước. */
  private savedTitle: string | null = null;

  constructor(private now: () => number = Date.now, detailsOpen = false) {
    this.started = now();
    const id = "act-" + ++seq;
    this.list = h("div", { class: "act-list", id, hidden: !detailsOpen });
    this.head = h("button", { class: "act-h", type: "button", "aria-expanded": String(detailsOpen), "aria-controls": id, onclick: () => this.toggle() },
      this.spin, this.titleEl, this.metaEl, this.noteEl, h("span", { class: "act-car", "aria-hidden": "true" }, "▾"));
    this.el = h("div", { class: "activity running" }, this.head, this.live, this.list);
    this.render();
  }

  private toggle(): void {
    this.list.hidden = !this.list.hidden;
    this.head.setAttribute("aria-expanded", String(!this.list.hidden));
  }

  get steps(): number {
    return this.stats.steps;
  }
  get errors(): number {
    return this.stats.errors;
  }
  get phase(): ActivityPhase {
    return this.stats.phase;
  }
  /** Công cụ đang chạy (nhãn cho thanh "Đang làm việc"). */
  get tool(): string | null {
    return this.stats.tool;
  }

  toolStart(id: string, name: string, depth: number): void {
    if (this.stats.phase !== "running" && this.stats.phase !== "waiting") return;
    if (countsAsStep(name, depth)) this.stats.steps++;
    if (depth === 0) {
      this.running.set(id, name);
      this.stats.tool = name;
    }
    this.render();
  }

  toolResult(id: string, ok: boolean, errKind: string | undefined, depth: number): void {
    this.running.delete(id);
    if (countsAsError(ok, errKind)) this.stats.errors++;
    if (depth === 0) this.lastFailed = countsAsError(ok, errKind);
    this.render();
  }

  setWaiting(w: boolean): void {
    if (this.stats.phase !== "running" && this.stats.phase !== "waiting") return;
    this.stats.phase = w ? "waiting" : "running";
    if (w) this.live.textContent = "Đang chờ bạn";
    this.render();
  }

  /** Khối đã kết thúc: chốt tiêu đề. */
  finish(o: { interrupted: boolean; hasFinal: boolean }): void {
    this.stats.ms = this.now() - this.started;
    this.stats.phase = o.interrupted ? "stopped" : !o.hasFinal && this.lastFailed ? "unfinished" : "done";
    this.live.textContent = headlineText(this.stats);
    this.render();
  }

  /** Dạng gọn cho cuộc trò chuyện đã lưu: đã xong, chỉ có số bước. */
  static saved(items: HTMLElement[], steps: number, hasFinal: boolean): ActivityBlock {
    const b = new ActivityBlock(Date.now);
    b.stats.steps = steps;
    b.list.append(...items);
    b.stats.phase = "done";
    b.savedTitle = hasFinal ? "✓ Hoàn tất" : "Các bước";
    b.render();
    return b;
  }

  private render(): void {
    const s = this.stats;
    const finished = s.phase === "done" || s.phase === "stopped" || s.phase === "unfinished";
    const hl = headline(s);
    this.titleEl.textContent = this.savedTitle ?? hl.title;
    const meta = this.savedTitle ? hl.meta.filter((m) => /bước/.test(m)) : hl.meta;
    this.metaEl.textContent = meta.length ? " · " + meta.join(" · ") : "";
    this.noteEl.textContent = hl.note ? " · " + hl.note : "";
    this.spin.hidden = finished || s.phase === "waiting";
    this.el.className = "activity " + s.phase;
    this.head.title = finished ? "Xem các bước" : "";
  }
}
