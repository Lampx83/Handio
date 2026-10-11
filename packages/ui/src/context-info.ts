import type { QuotaInfo } from "@neu/agent-core";
import { h } from "./dom";

/**
 * Bảng chi tiết khi bấm vào vòng tròn ngữ cảnh: cửa sổ ngữ cảnh đang dùng vào việc gì + hạn mức token hôm nay.
 * Phần thuần (định dạng, gộp phần, tính %) tách riêng để kiểm thử được.
 */

export interface ContextParts {
  used: number;
  limit: number;
  parts: { name: string; tokens: number }[];
}
/** Phần của sự kiện `usage` mà bảng cần. `context` vắng khi lõi cũ. */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  contextPct: number;
  calls: number;
  context?: ContextParts;
}

// ------------------------------------------------------------------ định dạng
/** 381700 → "381,7k"; 1000000 → "1M"; 950 → "950". */
export function fmtTokens(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v < 1000) return String(v);
  if (v < 999_950) return (v / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "k";
  return (v / 1_000_000).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "M";
}
/** 1234567 → "1.234.567" (cố định, không phụ thuộc ngôn ngữ máy). */
export const fmtInt = (n: number): string => String(Math.max(0, Math.round(Number.isFinite(n) ? n : 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const clampPct = (n: number): number => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// ------------------------------------------------------------------ cửa sổ ngữ cảnh
export interface Segment {
  name: string;
  tokens: number;
  /** Chiều rộng trên thanh, % của cả cửa sổ. */
  width: number;
  /** Chỉ số màu 0..6 (ổn định theo vị trí phần; "Khác" luôn là 6). */
  color: number;
}
export const OTHER = "Khác";
export const MAX_PARTS = 6;

/** Gộp phần trùng tên, bỏ phần rỗng/không hợp lệ; quá `max` phần thì dồn các phần nhỏ nhất vào "Khác". Giữ thứ tự gốc. */
export function mergeParts(parts: { name: string; tokens: number }[], max = MAX_PARTS): { name: string; tokens: number }[] {
  const byName = new Map<string, number>();
  for (const p of parts) {
    const t = Number.isFinite(p.tokens) ? Math.round(p.tokens) : 0;
    if (t <= 0) continue;
    byName.set(p.name, (byName.get(p.name) ?? 0) + t);
  }
  let out = [...byName].map(([name, tokens]) => ({ name, tokens }));
  if (out.length > max) {
    const keep = new Set([...out].sort((a, b) => b.tokens - a.tokens).slice(0, max - 1).map((p) => p.name));
    const rest = out.filter((p) => !keep.has(p.name)).reduce((s, p) => s + p.tokens, 0);
    out = [...out.filter((p) => keep.has(p.name)), { name: OTHER, tokens: rest }];
  }
  return out;
}

export interface ContextView {
  pct: number;
  used: number;
  limit: number;
  /** true: chỉ có % (lõi cũ), số token là ước lượng từ % và cỡ cửa sổ. */
  approx: boolean;
  segments: Segment[];
  free: number;
}

/** Dựng số liệu bảng từ sự kiện `usage` gần nhất. `fallbackLimit` = cỡ cửa sổ trong cài đặt (dùng khi lõi chưa gửi `context`). */
export function contextView(u: UsageInfo | null | undefined, fallbackLimit = 0): ContextView | null {
  if (!u) return null;
  const c = u.context;
  const limit = c && c.limit > 0 ? c.limit : Math.max(0, fallbackLimit);
  const approx = !(c && c.limit > 0);
  const used = c && c.limit > 0 ? Math.max(0, c.used) : Math.round((clampPct(u.contextPct) / 100) * limit);
  const pct = c && c.limit > 0 ? Math.min(100, Math.floor((100 * used) / c.limit)) : clampPct(u.contextPct);
  const merged = c ? mergeParts(c.parts ?? []) : [];
  // thanh không được tràn: nếu tổng các phần vượt cửa sổ thì co theo tỉ lệ
  const sum = merged.reduce((s, p) => s + p.tokens, 0);
  const denom = Math.max(limit, sum, 1);
  const segments = merged.map((p, i) => ({ name: p.name, tokens: p.tokens, width: (100 * p.tokens) / denom, color: p.name === OTHER ? 6 : Math.min(i, 5) }));
  return { pct, used, limit, approx, segments, free: Math.max(0, limit - used) };
}

export function contextTitle(v: ContextView): string {
  if (v.limit <= 0) return `${v.pct}%`;
  return `${v.approx ? "~" : ""}${fmtTokens(v.used)} / ${fmtTokens(v.limit)} (${v.pct}%)`;
}

// ------------------------------------------------------------------ hạn mức hôm nay
export interface QuotaView {
  used: string;
  limit: string;
  pct: number;
  level: "ok" | "warn" | "err";
  /** Câu trạng thái ngắn ("" khi bình thường). */
  text: string;
  reset: string | null;
}

/** "Đặt lại lúc 00:00 ngày mai". `resetAt` tính bằng giây epoch. */
export function resetText(resetAt: number, now: Date = new Date()): string | null {
  if (!(resetAt > 0)) return null;
  const d = new Date(resetAt * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(d) - day0(now)) / 86_400_000);
  const when = diff === 0 ? "hôm nay" : diff === 1 ? "ngày mai" : `ngày ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  return `Đặt lại lúc ${p2(d.getHours())}:${p2(d.getMinutes())} ${when}`;
}

export function quotaView(q: QuotaInfo | null | undefined, now: Date = new Date()): QuotaView | null {
  if (!q || q.state === "unlimited" || !(q.limit > 0)) return null;
  const pct = clampPct(q.pct ?? (100 * q.used) / q.limit);
  const level = q.state === "ok" ? "ok" : q.state === "warn" ? "warn" : "err";
  const text = q.state === "warn" ? "Sắp hết hạn mức" : q.state === "grace" ? "Đã hết hạn mức · được hoàn tất việc đang làm" : q.state === "exceeded" ? "Đã hết hạn mức hôm nay" : "";
  return { used: fmtTokens(q.used), limit: fmtTokens(q.limit), pct: Math.round(pct), level, text, reset: resetText(q.resetAt, now) };
}

/** Từ ngưỡng này bảng mời bắt đầu cuộc trò chuyện mới. */
export const NEW_CHAT_PCT = 80;

// ------------------------------------------------------------------ DOM
export interface PanelInput {
  usage: UsageInfo | null;
  fallbackLimit: number;
  quota: QuotaInfo | null | undefined;
  busy: boolean;
  onNewChat(): void;
}

/** Dựng nội dung bảng (không có lớp bọc định vị: do App đặt). Dựng lại mỗi lần có số liệu mới. */
export function buildContextPanel(p: PanelInput, now: Date = new Date()): HTMLElement {
  const v = contextView(p.usage, p.fallbackLimit);
  const q = quotaView(p.quota, now);
  const panel = h("div", { class: "ctx-pop", role: "dialog", "aria-label": "Chi tiết ngữ cảnh", tabindex: "-1" });

  if (!v) {
    panel.append(h("div", { class: "ctx-h" }, h("span", {}, "Cửa sổ ngữ cảnh")), h("div", { class: "ctx-note" }, "Chưa có số liệu. Gửi một yêu cầu để bắt đầu."));
  } else {
    const label = `Đã dùng ${contextTitle(v)}`;
    const seg = h("div", { class: "ctx-seg", role: "img", "aria-label": label });
    if (v.segments.length) for (const s of v.segments) seg.append(h("span", { class: "ctx-s c" + s.color, style: { width: s.width + "%" }, title: `${s.name} · ${fmtInt(s.tokens)} token` }));
    else seg.append(h("span", { class: "ctx-s c0", style: { width: v.pct + "%" }, title: `Đã dùng · ${v.pct}%` }));
    panel.append(h("div", { class: "ctx-h" }, h("span", {}, "Cửa sổ ngữ cảnh"), h("span", { class: "ctx-n" }, contextTitle(v))), seg);
    if (v.segments.length) {
      const leg = h("ul", { class: "ctx-leg" });
      for (const s of v.segments) leg.append(h("li", {}, h("i", { class: "sw c" + s.color, "aria-hidden": "true" }), h("span", { class: "nm" }, s.name), h("span", { class: "tk" }, fmtTokens(s.tokens))));
      if (v.limit > 0) leg.append(h("li", { class: "free" }, h("i", { class: "sw", "aria-hidden": "true" }), h("span", { class: "nm" }, "Còn trống"), h("span", { class: "tk" }, fmtTokens(v.free))));
      panel.append(leg);
    }
  }

  if (q) {
    panel.append(h("div", { class: "ctx-q" },
      h("div", { class: "ctx-h" }, h("span", {}, "Hạn mức hôm nay"), h("span", { class: "ctx-n" }, `${q.used} / ${q.limit} (${q.pct}%)`)),
      h("div", { class: "ctx-prog " + q.level, role: "progressbar", "aria-label": "Hạn mức hôm nay", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(q.pct) }, h("i", { style: { width: q.pct + "%" } })),
      q.text || q.reset ? h("div", { class: "ctx-sub" }, [q.text, q.reset].filter(Boolean).join(" · ")) : null));
  }

  const u = p.usage;
  if (u) panel.append(h("div", { class: "ctx-meta" }, `${fmtInt(u.calls)} lần gọi · ${fmtInt(u.promptTokens)} token vào · ${fmtInt(u.completionTokens)} token ra`));
  panel.append(h("div", { class: "ctx-note" }, "Khi ngữ cảnh gần đầy, agent tự tóm tắt phần cũ để tiếp tục."));
  if (v && v.pct >= NEW_CHAT_PCT) panel.append(h("button", { class: "btn sm ctx-new", type: "button", disabled: p.busy, title: p.busy ? "Chờ agent làm xong" : undefined, onclick: () => p.onNewChat() }, "Cuộc trò chuyện mới"));
  return panel;
}
