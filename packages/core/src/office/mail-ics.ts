/** Dựng thư nháp .eml (RFC 5322 + MIME) và lời mời lịch .ics (RFC 5545). Chạy được cả trình duyệt (không dùng Buffer). */
import { fmtVn, fromDays, parseDate, toDays, type Ymd } from "./vn-calendar";

const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Băm 53 bit (cyrb53) → chuỗi hex 14 ký tự: để tạo UID/boundary ổn định theo nội dung. */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

// ---------------------------------------------------------------- địa chỉ

export interface Mailbox {
  name: string;
  addr: string;
}

const ADDR_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;

export function parseMailbox(raw: string): Mailbox | null {
  const s = raw.trim();
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(s);
  const name = m ? m[1].trim().replace(/^"(.*)"$/, "$1") : "";
  const addr = (m ? m[2] : s).trim();
  if (!ADDR_RE.test(addr) || /[\r\n]/.test(name)) return null;
  return { name, addr };
}

/** Tách danh sách địa chỉ từ mảng hoặc chuỗi ngăn bằng ; hoặc dấu phẩy ngoài <...>. */
export function splitAddresses(v: unknown): string[] {
  const parts: string[] = [];
  const add = (s: string) => {
    let depth = 0;
    let quoted = false;
    let cur = "";
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (ch === "<") depth++;
      if (ch === ">") depth = Math.max(0, depth - 1);
      if ((ch === ";" || ch === ",") && !depth && !quoted) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
  };
  if (Array.isArray(v)) v.forEach((x) => add(String(x)));
  else if (typeof v === "string") add(v);
  return parts;
}

// ---------------------------------------------------------------- tiêu đề thư (RFC 2047)

const ASCII_SAFE = /^[\x20-\x7e]*$/;

/** Mã hoá "=?UTF-8?B?...?=" chia nhiều từ ≤ 75 ký tự (không cắt giữa ký tự UTF-8). */
export function encodeWords(s: string, prefixLen = 9): string {
  const clean = s.replace(/[\r\n]+/g, " ");
  if (ASCII_SAFE.test(clean)) return clean;
  const chunks: string[] = [];
  let cur: number[] = [];
  // dòng đầu còn chỗ ít hơn vì đã có tên header ("Subject: "); mỗi từ mã hoá ≤ 75 ký tự, mỗi dòng ≤ 76
  let limit = Math.floor((76 - prefixLen - 12) / 4) * 3;
  for (const ch of clean) {
    const b = enc.encode(ch);
    if (cur.length + b.length > limit) {
      chunks.push(toBase64(Uint8Array.from(cur)));
      cur = [];
      limit = 45;
    }
    cur.push(...b);
  }
  if (cur.length) chunks.push(toBase64(Uint8Array.from(cur)));
  return chunks.map((c) => `=?UTF-8?B?${c}?=`).join("\r\n ");
}

export function formatMailbox(m: Mailbox): string {
  if (!m.name) return m.addr;
  const n = ASCII_SAFE.test(m.name) ? (/^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(m.name) ? m.name : `"${m.name.replace(/(["\\])/g, "\\$1")}"`) : encodeWords(m.name);
  return `${n} <${m.addr}>`;
}

const wrap76 = (b64: string): string => (b64.match(/.{1,76}/g) ?? []).join("\r\n");

export const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".txt": "text/plain; charset=UTF-8",
  ".csv": "text/csv; charset=UTF-8",
  ".md": "text/markdown; charset=UTF-8",
  ".html": "text/html; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
  ".json": "application/json",
};

export interface EmlAttachment {
  name: string;
  bytes: Uint8Array;
}

export interface EmlOptions {
  to: Mailbox[];
  cc?: Mailbox[];
  bcc?: Mailbox[];
  subject: string;
  body: string;
  attachments?: EmlAttachment[];
  date?: Date;
}

const rfcDate = (d: Date): string => {
  const t = new Date(d.getTime() + 7 * 3600_000); // +0700
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][t.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${wd}, ${p(t.getUTCDate())} ${mo} ${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())} +0700`;
};

/** Tên tệp đính kèm: bản ASCII dự phòng và bản RFC 5987 (UTF-8, phần trăm) cho tên có dấu. */
const fileNameParts = (name: string): { ascii: string; star?: string } => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  if (ASCII_SAFE.test(name) && ascii === name) return { ascii };
  return { ascii, star: encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()) };
};

/** Dựng nội dung .eml (CRLF, UTF-8). Không có From: ứng dụng thư dùng tài khoản mặc định khi mở bản nháp (X-Unsent: 1). */
export function buildEml(o: EmlOptions): Uint8Array {
  const head: string[] = [];
  const list = (k: string, v: Mailbox[]) => {
    if (v.length) head.push(`${k}: ${v.map(formatMailbox).join(",\r\n ")}`);
  };
  head.push("X-Unsent: 1");
  list("To", o.to);
  list("Cc", o.cc ?? []);
  list("Bcc", o.bcc ?? []);
  head.push(`Subject: ${encodeWords(o.subject)}`);
  head.push(`Date: ${rfcDate(o.date ?? new Date())}`);
  head.push("MIME-Version: 1.0");
  const bodyText = o.body.replace(/\r\n?|\n/g, "\r\n");
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(toBase64(enc.encode(bodyText)))].join("\r\n");
  const atts = o.attachments ?? [];
  let out: string;
  if (!atts.length) out = head.join("\r\n") + "\r\n" + textPart + "\r\n";
  else {
    const boundary = "----=_Part_" + hash53(o.subject + bodyText + atts.map((a) => a.name + a.bytes.length).join("|"));
    const parts = [textPart];
    for (const a of atts) {
      const ext = a.name.includes(".") ? a.name.slice(a.name.lastIndexOf(".")).toLowerCase() : "";
      const mime = (MIME_BY_EXT[ext] ?? "application/octet-stream").split(";")[0];
      const fn = fileNameParts(a.name);
      parts.push(
        [`Content-Type: ${mime}; name="${fn.ascii}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${fn.ascii}"${fn.star ? `; filename*=UTF-8''${fn.star}` : ""}`, "", wrap76(toBase64(a.bytes))].join("\r\n"),
      );
    }
    head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    out = head.join("\r\n") + "\r\n\r\n" + parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") + `--${boundary}--\r\n`;
  }
  return enc.encode(out);
}

// ---------------------------------------------------------------- lịch .ics

/** Gấp dòng theo RFC 5545: tối đa 75 octet mỗi dòng, dòng nối tiếp bắt đầu bằng một dấu cách; không cắt giữa ký tự UTF-8. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += n;
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

export const escapeIcs = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n?|\n/g, "\\n");

export interface DateTime {
  date: Ymd;
  /** Giờ, phút; undefined = chỉ có ngày. */
  time?: { h: number; mi: number };
}

/** "2025-03-10T08:30", "10/03/2025 8h30", "10/03/2025 14:00", "10/03/2025 2h chiều"... */
export function parseDateTime(raw: unknown): DateTime | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:[T\s]+(.+))?$/.exec(s);
  if (!m) return null;
  const date = parseDate(m[1]);
  if (!date) return null;
  if (!m[2]) return { date };
  const t = /^(\d{1,2})\s*(?:[:hHgG]|giờ)\s*(\d{1,2})?\s*(?:ph[uú]t|p)?(?::\d{2}(?:\.\d+)?)?\s*(Z)?\s*(sa|ch|am|pm|sáng|chiều|tối)?$/i.exec(m[2].trim());
  if (!t) return null;
  let h = +t[1];
  const mi = t[2] ? +t[2] : 0;
  const ap = (t[4] ?? "").toLowerCase();
  if ((ap === "ch" || ap === "pm" || ap === "chiều" || ap === "tối") && h < 12) h += 12;
  if ((ap === "sa" || ap === "am" || ap === "sáng") && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { date, time: { h, mi } };
}

const p2 = (n: number): string => String(n).padStart(2, "0");
const icsDate = (d: Ymd): string => `${String(d.y).padStart(4, "0")}${p2(d.m)}${p2(d.d)}`;
const icsDateTime = (d: Ymd, t: { h: number; mi: number }): string => `${icsDate(d)}T${p2(t.h)}${p2(t.mi)}00`;

export const addMinutes = (dt: DateTime, minutes: number): DateTime => {
  const base = toDays(dt.date) * 1440 + (dt.time?.h ?? 0) * 60 + (dt.time?.mi ?? 0) + minutes;
  const day = Math.floor(base / 1440);
  const rem = base - day * 1440;
  return { date: fromDays(day), time: { h: Math.floor(rem / 60), mi: rem % 60 } };
};

export interface IcsOptions {
  title: string;
  start: DateTime;
  end?: DateTime;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees?: Mailbox[];
  reminderMinutes?: number;
  recurrence?: "daily" | "weekly" | "monthly";
  recurrenceCount?: number;
  recurrenceUntil?: Ymd;
  prodId: string;
  now?: Date;
}

const VTIMEZONE = ["BEGIN:VTIMEZONE", "TZID:Asia/Ho_Chi_Minh", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0700", "TZOFFSETTO:+0700", "TZNAME:ICT", "END:STANDARD", "END:VTIMEZONE"];

export function buildIcs(o: IcsOptions): { text: string; uid: string; endShown: string } {
  const now = o.now ?? new Date();
  const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`;
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${o.prodId}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  let dtstart: string;
  let dtend: string;
  let endShown: string;
  if (o.allDay) {
    const lastDay = o.end ? toDays(o.end.date) : toDays(o.start.date);
    dtstart = `DTSTART;VALUE=DATE:${icsDate(o.start.date)}`;
    dtend = `DTEND;VALUE=DATE:${icsDate(fromDays(lastDay + 1))}`; // DTEND của sự kiện cả ngày là ngày KHÔNG bao gồm
    endShown = fmtVn(fromDays(lastDay));
  } else {
    const st = { date: o.start.date, time: o.start.time ?? { h: 8, mi: 0 } };
    const en = o.end?.time ? { date: o.end.date, time: o.end.time } : addMinutes(st, 60);
    dtstart = `DTSTART;TZID=Asia/Ho_Chi_Minh:${icsDateTime(st.date, st.time)}`;
    dtend = `DTEND;TZID=Asia/Ho_Chi_Minh:${icsDateTime(en.date, en.time!)}`;
    endShown = `${fmtVn(en.date)} ${p2(en.time!.h)}:${p2(en.time!.mi)}`;
  }
  if (!o.allDay) L.push(...VTIMEZONE);
  const uid = `${hash53([o.title, dtstart, dtend, o.location ?? "", o.description ?? ""].join("\n"))}@office-agent.local`;
  L.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, dtstart, dtend, `SUMMARY:${escapeIcs(o.title)}`);
  if (o.location) L.push(`LOCATION:${escapeIcs(o.location)}`);
  if (o.description) L.push(`DESCRIPTION:${escapeIcs(o.description)}`);
  for (const a of o.attendees ?? []) {
    const cn = a.name ? `;CN=${/[;:,"]/.test(a.name) || /[^\x20-\x7e]/.test(a.name) ? `"${a.name.replace(/"/g, "'")}"` : a.name}` : "";
    L.push(`ATTENDEE${cn};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.addr}`);
  }
  if (o.recurrence) {
    const freq = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" }[o.recurrence];
    let r = `RRULE:FREQ=${freq}`;
    if (o.recurrenceCount) r += `;COUNT=${o.recurrenceCount}`;
    else if (o.recurrenceUntil) r += o.allDay ? `;UNTIL=${icsDate(o.recurrenceUntil)}` : `;UNTIL=${icsDate(o.recurrenceUntil)}T165959Z`; // 23:59:59 giờ Việt Nam
    L.push(r);
  }
  if (o.reminderMinutes !== undefined) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcs(o.title)}`, `TRIGGER:-PT${o.reminderMinutes}M`, "END:VALARM");
  L.push("END:VEVENT", "END:VCALENDAR");
  return { text: L.map(foldLine).join("\r\n") + "\r\n", uid, endShown };
}
