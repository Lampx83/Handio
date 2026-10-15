/**
 * Chia sẻ cuộc trò chuyện: người dùng chủ động tạo một liên kết để người khác (đã đăng nhập Handio) đọc. Bản chụp được che thông tin
 * nhạy cảm ở máy người dùng TRƯỚC khi gửi, và nhóm phát triển cũng đọc được bản đã chia sẻ để cải thiện hệ thống (hộp chia sẻ nói rõ).
 * Phía máy chủ: deploy/220/diag/shares.py.
 */
import { findPii, maskValue } from "./office/pii";
import type { ChatMessage } from "./llm";
import { isInternalUser, type HistoryItem } from "./projects";

export interface ShareItem {
  k: "user" | "assistant" | "tool";
  t: string;
  /** Tên công cụ (khi k = "tool"). */
  n?: string;
}
export interface SharePayload {
  v: 1;
  title: string;
  profile: string;
  version: string;
  platform: string;
  redactions: number;
  items: ShareItem[];
}
export interface ShareResult {
  ok: boolean;
  message: string;
  id?: string;
  url?: string;
}
export interface SharedChatInfo {
  id: string;
  title: string;
  url: string;
  ts: number;
  views: number;
  items: number;
  redactions: number;
}
export interface SharePreview {
  ok: boolean;
  message?: string;
  title: string;
  items: number;
  redactions: number;
}

export const SHARE_MAX_ITEMS = 400;
const MAX_ITEM = 6000;
const MAX_TOOL = 400;
const MAX_TOTAL = 280 * 1024;
export const SHARE_MASK = "[đã ẩn]";

// khoá/mật khẩu còn sót trong hội thoại (do người dùng dán, hoặc kết quả công cụ đọc phải tệp .env…)
const SECRET_RES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  /\b(bearer)\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\b(password|passwd|mat khau|mật khẩu|secret|api[_-]?key|token)\b\s*[:=]\s*\S{6,}/gi,
];

/** Che khoá/mật khẩu và dữ liệu cá nhân (CCCD, SĐT, email, số tài khoản, mã sinh viên…). Trả về chữ đã che và số chỗ đã che. */
export function redactForShare(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const re of SECRET_RES) {
    out = out.replace(re, () => {
      count++;
      return SHARE_MASK;
    });
  }
  // dữ liệu cá nhân: quét từng dòng (bộ tìm kiếm được thiết kế cho đoạn ngắn)
  out = out
    .split("\n")
    .map((line) => {
      if (line.length < 6 || line.length > 2000) return line;
      const hits = findPii(line);
      if (!hits.length) return line;
      let l = line;
      for (const h of [...hits].sort((a, b) => b.start - a.start)) {
        l = l.slice(0, h.start) + maskValue(line.slice(h.start, h.end), h.type) + l.slice(h.end);
        count++;
      }
      return l;
    })
    .join("\n");
  return { text: out, count };
}

/** Dựng bản chụp để chia sẻ từ lịch sử hội thoại (bỏ tin nhắn nội bộ, rút gọn kết quả công cụ, che nhạy cảm, giới hạn kích thước). */
export function buildSharePayload(history: HistoryItem[], meta: { title: string; profile: string; version: string; platform: string }): SharePayload {
  let redactions = 0;
  const red = (s: string) => {
    const r = redactForShare(s);
    redactions += r.count;
    return r.text;
  };
  let items: ShareItem[] = [];
  for (const h of history) {
    if (h.kind === "user" && isInternalUser(h.text)) continue;
    const text = (h.text ?? "").trim();
    if (!text) continue;
    if (h.kind === "tool") items.push({ k: "tool", n: h.name || "tool", t: red(text.slice(0, MAX_TOOL)) });
    else items.push({ k: h.kind, t: red(text.slice(0, MAX_ITEM)) });
  }
  if (items.length > SHARE_MAX_ITEMS) items = items.slice(-SHARE_MAX_ITEMS);
  // quá nặng thì rút ngắn từng mục cho vừa
  const size = () => items.reduce((n, i) => n + new TextEncoder().encode(i.t).length + 24, 0);
  for (const cap of [3000, 1500, 600]) {
    if (size() <= MAX_TOTAL) break;
    items = items.map((i) => (i.t.length > cap ? { ...i, t: i.t.slice(0, cap) + "…" } : i));
  }
  return { v: 1, title: red(meta.title).slice(0, 120) || "Cuộc trò chuyện", profile: meta.profile, version: meta.version, platform: meta.platform, redactions, items };
}

// ---------------------------------------------------------------- bản v2: đủ thông tin để nhóm phát triển (và Claude) hiểu vì sao agent làm đúng/sai
export interface ShareItemV2 {
  /** user: người dùng gõ · assistant: trả lời · tool: một lần gọi công cụ · system: lời nhắc của chính Handio · summary: bản tóm tắt ngữ cảnh */
  k: "user" | "assistant" | "tool" | "system" | "summary";
  t: string;
  /** tool: tên công cụ */
  n?: string;
  /** tool: kết quả (đã cắt) */
  r?: string;
  /** tool: kết quả là lỗi / bị từ chối */
  e?: boolean;
}
export interface SharePayloadV2 {
  v: 2;
  title: string;
  profile: string;
  version: string;
  platform: string;
  model: string;
  mode: string;
  redactions: number;
  items: ShareItemV2[];
}

const V2_MAX_TOTAL = 400 * 1024;
const V2_ARGS = 1500;
const V2_RESULT = 1500;
/** Kết quả đọc tệp thường là nội dung tệp của người dùng: chỉ giữ phần đầu để biết agent thấy gì. */
const V2_READ_RESULT = 600;
const V2_SYSTEM = 800;
const READ_TOOLS = new Set(["read_file", "read_document", "read_image", "grep", "list_dir"]);
const ATTACH_MARK = "\n\n[Nội dung các tệp được đính kèm";
const failed = (r: string) => /^(Lỗi|Bị từ chối|Bị chặn|Người dùng từ chối)/.test(r.trimStart());

/**
 * Dựng bản chia sẻ v2 từ TOÀN BỘ tin nhắn (kể cả phần trước các lần tóm tắt ngữ cảnh): lời người dùng, trả lời, mỗi lần gọi công cụ
 * kèm đối số và kết quả (cắt ngắn, đánh dấu lỗi), lời nhắc của Handio và bản tóm tắt. Nội dung tệp đính kèm bằng @ bị bỏ; mọi chữ được che.
 */
export function buildShareV2(messages: ChatMessage[], meta: { title: string; profile: string; version: string; platform: string; model: string; mode: string; inputs?: string[] }): SharePayloadV2 {
  let redactions = 0;
  const red = (s: string) => {
    const r = redactForShare(s);
    redactions += r.count;
    return r.text;
  };
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  const results = new Map<string, string>();
  for (const m of messages) if (m.role === "tool" && m.tool_call_id) results.set(m.tool_call_id, m.content ?? "");
  // `inputs` = chữ người dùng gõ (trước khi mở rộng @tệp) của các lượt CUỐI (sau lần tóm tắt gần nhất)
  const real = messages.filter((m) => m.role === "user" && m.content && !isInternalUser(m.content));
  const raw = new Map<ChatMessage, string>();
  if (meta.inputs?.length) meta.inputs.forEach((t, i) => { const m = real[real.length - meta.inputs!.length + i]; if (m) raw.set(m, t); });

  let items: ShareItemV2[] = [];
  for (const m of messages) {
    const c = m.content ?? "";
    if (m.role === "user" && c) {
      if (!isInternalUser(c)) {
        const t = (raw.get(m) ?? c.split(ATTACH_MARK)[0]).trim();
        if (t) items.push({ k: "user", t: red(cut(t, MAX_ITEM)) });
      } else if (c.startsWith("[Tóm tắt")) items.push({ k: "summary", t: red(cut(c.replace(/^\[Tóm tắt[^\]]*\]\s*/, ""), 3000)) });
      else items.push({ k: "system", t: red(cut(c, V2_SYSTEM)) });
    } else if (m.role === "assistant") {
      if (c.trim()) items.push({ k: "assistant", t: red(cut(c.trim(), MAX_ITEM)) });
      for (const tc of m.tool_calls ?? []) {
        const r = results.get(tc.id) ?? "";
        const name = tc.function.name;
        items.push({ k: "tool", n: name, t: red(cut(tc.function.arguments, V2_ARGS)), r: red(cut(r, READ_TOOLS.has(name) && !failed(r) ? V2_READ_RESULT : V2_RESULT)), ...(failed(r) ? { e: true } : {}) });
      }
    }
  }
  if (items.length > SHARE_MAX_ITEMS) items = items.slice(-SHARE_MAX_ITEMS);
  // quá nặng: rút kết quả công cụ trước, rồi đối số, rồi mọi mục
  const size = () => items.reduce((n, i) => n + new TextEncoder().encode(i.t + (i.r ?? "")).length + 40, 0);
  for (const cap of [600, 200, 0]) {
    if (size() <= V2_MAX_TOTAL) break;
    items = items.map((i) => (i.r && i.r.length > cap ? { ...i, r: cap ? i.r.slice(0, cap) + "…" : "" } : i));
  }
  for (const cap of [3000, 800, 300]) {
    if (size() <= V2_MAX_TOTAL) break;
    items = items.map((i) => (i.t.length > cap ? { ...i, t: i.t.slice(0, cap) + "…" } : i));
  }
  const short = (s: string) => s.replace(/[^A-Za-z0-9 ._()/:+-]/g, "").slice(0, 40);
  return { v: 2, title: red(meta.title).slice(0, 120) || "Cuộc trò chuyện", profile: meta.profile, version: meta.version, platform: meta.platform, model: short(meta.model), mode: short(meta.mode), redactions, items };
}
