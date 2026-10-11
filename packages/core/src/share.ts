/**
 * Chia sẻ cuộc trò chuyện: người dùng chủ động tạo một liên kết để người khác (đã đăng nhập Hando) đọc. Bản chụp được che thông tin
 * nhạy cảm ở máy người dùng TRƯỚC khi gửi, và nhóm phát triển cũng đọc được bản đã chia sẻ để cải thiện hệ thống (hộp chia sẻ nói rõ).
 * Phía máy chủ: deploy/220/diag/shares.py.
 */
import { findPii, maskValue } from "./office/pii";
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
