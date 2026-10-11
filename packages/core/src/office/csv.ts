/** CSV/TSV: giải mã, đoán dấu phân cách, đọc/ghi theo RFC 4180, suy luận kiểu ô khi nạp vào Excel. */
import { parseLocaleNumber, type NumberLocale } from "./vn-number";

export const CSV_DELIMS = [",", ";", "\t", "|"] as const;

/** Giải mã tệp văn bản: BOM UTF-8/UTF-16, UTF-8; nếu không phải UTF-8 hợp lệ thì thử Windows-1258 (tiếng Việt cũ). */
export function decodeText(bytes: Uint8Array): { text: string; note?: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), note: "UTF-16" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), note: "UTF-16" };
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body) };
  } catch {
    try {
      return { text: new TextDecoder("windows-1258").decode(body), note: "Tệp không phải UTF-8: đã đọc theo bảng mã Windows-1258 (tiếng Việt cũ); hãy kiểm tra dấu." };
    } catch {
      return { text: new TextDecoder("utf-8").decode(body), note: "Tệp không phải UTF-8: một số ký tự có thể sai." };
    }
  }
}

/** Đoán dấu phân cách: dấu có số lượng ổn định nhất trên các dòng đầu (bỏ qua dấu nằm trong ngoặc kép). */
export function detectDelimiter(text: string): string {
  const src = text.replace(/\r\n?/g, "\n");
  let best = ",";
  let bestScore = -1;
  for (const d of CSV_DELIMS) {
    const counts: number[] = [];
    let q = false;
    let c = 0;
    for (let i = 0; i < src.length && counts.length < 20; i++) {
      const ch = src[i];
      if (ch === '"') q = !q;
      else if (!q && ch === d) c++;
      else if (!q && ch === "\n") {
        if (c || counts.length) counts.push(c);
        c = 0;
      }
    }
    if (c) counts.push(c);
    if (!counts.length) continue;
    const mode = [...counts].sort((x, y) => counts.filter((v) => v === y).length - counts.filter((v) => v === x).length)[0];
    if (!mode) continue;
    const score = counts.filter((v) => v === mode).length * 1000 + mode;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Đọc CSV theo RFC 4180 với dấu phân cách cho trước (ô trong ngoặc kép, "" là một dấu nháy, xuống dòng trong ô). */
export function parseDelimited(text: string, delim: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  let wasQuoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "" && !wasQuoted) {
      q = true;
      wasQuoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
      wasQuoted = false;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      wasQuoted = false;
    } else cell += ch;
  }
  if (cell !== "" || row.length || wasQuoted) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

/** Ghi CSV: ô chứa dấu phân cách, ngoặc kép, xuống dòng hoặc khoảng trắng đầu/cuối được đặt trong ngoặc kép. Dòng kết thúc CRLF. */
export function toCsv(rows: string[][], delim: string, bom = true): string {
  const esc = (v: string): string => (v.includes(delim) || /["\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (bom ? "﻿" : "") + rows.map((r) => r.map(esc).join(delim)).join("\r\n") + (rows.length ? "\r\n" : "");
}

/**
 * Suy luận kiểu một ô khi nạp vào Excel: số thật là số; mã có số 0 đầu ("0912345678"), số điện thoại có "+", số quá dài (> 15 chữ số)
 * giữ nguyên là chữ; ngày dd/mm/yyyy thành ngày thật; chữ bắt đầu bằng "=" hoặc "'" được rào để không thành công thức.
 */
export function inferCell(raw: string, locale: NumberLocale): string | number | null {
  const t = raw.trim();
  if (t === "") return null;
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (date) {
    const [d, m, y] = [+date[1], +date[2], +date[3]];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (m >= 1 && m <= 12 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (!/^[+]/.test(t) && !/^-?0\d/.test(t) && /^-?[\d.,]+$/.test(t)) {
    const p = parseLocaleNumber(t, locale);
    if (p && (p.int + p.frac).replace(/^0+/, "").length <= 15) {
      const n = Number(`${p.neg ? "-" : ""}${p.int}.${p.frac || "0"}`);
      if (Number.isFinite(n)) return n;
    }
  }
  return /^[=']/.test(raw) ? "'" + raw : raw;
}
