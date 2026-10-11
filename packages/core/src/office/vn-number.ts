/**
 * Số ↔ chữ tiếng Việt, phân tích số kiểu Việt (1.234.567,89) và kiểu quốc tế (1,234,567.89).
 * Thuần tính toán (không Env): dùng chung cho vn_number_words, calc, csv_convert.
 */

export type NumberLocale = "vi" | "en";

export interface ParsedNumber {
  neg: boolean;
  /** Phần nguyên (chỉ chữ số, không có số 0 thừa ở đầu). */
  int: string;
  /** Phần thập phân (chỉ chữ số, không có số 0 thừa ở cuối). */
  frac: string;
  /** Có thể hiểu theo hai cách (vd "1.234" là 1234 hay 1,234). */
  ambiguous?: boolean;
}

/** Số chữ số nguyên tối đa mà vn_number_words đọc (10^15 = 16 chữ số). */
export const MAX_WORDS_VALUE = 10n ** 15n;

const trimInt = (s: string): string => s.replace(/^0+(?=\d)/, "") || "0";

/**
 * Đọc số từ chuỗi. `locale` quyết định nghĩa của dấu chấm/phẩy khi mơ hồ:
 * vi: "." ngăn nhóm nghìn, "," thập phân; en: ngược lại.
 * Trả null nếu không phải số hợp lệ.
 */
export function parseLocaleNumber(raw: string, locale: NumberLocale = "vi"): ParsedNumber | null {
  let s = raw.trim().replace(/[\s  ']/g, "");
  if (!s) return null;
  let neg = false;
  if (/^[-−–]/.test(s)) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/^\d/.test(s) || /[.,]$/.test(s)) return null;
  const thousandSep = locale === "vi" ? "." : ",";
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  const groupsOk = (parts: string[]): boolean => /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));
  let int: string;
  let frac = "";
  let ambiguous = false;
  if (dots && commas) {
    // cả hai dấu: dấu đứng sau cùng là thập phân, dấu còn lại ngăn nhóm
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    const dec = lastDot > lastComma ? "." : ",";
    const grp = dec === "." ? "," : ".";
    const at = s.lastIndexOf(dec);
    const head = s.slice(0, at);
    frac = s.slice(at + 1);
    if (head.includes(dec) || !/^\d+$/.test(frac)) return null;
    const parts = head.split(grp);
    if (!groupsOk(parts)) return null;
    int = parts.join("");
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const n = dots || commas;
    const parts = s.split(sep);
    if (n > 1) {
      // lặp lại một dấu: chỉ hợp lệ khi là ngăn nhóm nghìn (1.234.567)
      if (!groupsOk(parts)) return null;
      int = parts.join("");
    } else {
      const [a, b] = parts;
      if (/^\d{3}$/.test(b) && /^[1-9]\d{0,2}$/.test(a) && sep === thousandSep) {
        int = a + b; // "1.234" (vi) / "1,234" (en): ngăn nhóm nghìn
      } else if (/^\d{3}$/.test(b) && /^[1-9]\d{0,2}$/.test(a)) {
        // "1,234" (vi) / "1.234" (en): thập phân theo `locale`, nhưng người dùng kiểu khác có thể muốn nói 1234
        ambiguous = true;
        int = a;
        frac = b;
      } else {
        int = a;
        frac = b;
      }
    }
  } else int = s;
  return { neg, int: trimInt(int), frac: frac.replace(/0+$/, ""), ambiguous: ambiguous || undefined };
}

/** Chuỗi/số JSON → ParsedNumber (số JSON dùng nguyên, không đoán dấu). */
export function toParsed(value: unknown, locale: NumberLocale = "vi"): ParsedNumber | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    let s = String(Math.abs(value));
    if (/e/i.test(s)) s = Math.abs(value).toFixed(Math.abs(value) < 1 ? 12 : 0);
    const [i, f = ""] = s.split(".");
    return { neg: value < 0 && !/^0*(\.0*)?$/.test(s), int: trimInt(i), frac: f.replace(/0+$/, "") };
  }
  if (typeof value === "string") return parseLocaleNumber(value, locale);
  return null;
}

// ---------------------------------------------------------------- số → chữ

const DIGIT = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

export interface WordsStyle {
  /** "linh" (mặc định) hoặc "lẻ": một trăm linh năm / một trăm lẻ năm. */
  zero: "linh" | "lẻ";
  /** "nghìn" (văn bản nhà nước) hoặc "ngàn" (cách nói miền Nam). */
  thousand: "nghìn" | "ngàn";
}

/** Đọc một nhóm 3 chữ số (1–999). `started`: đã có nhóm cao hơn đọc trước (nên "không trăm", "linh"). */
function readGroup(v: number, started: boolean, st: WordsStyle): string {
  const h = Math.floor(v / 100);
  const t = Math.floor((v % 100) / 10);
  const u = v % 10;
  const out: string[] = [];
  const full = h > 0 || started;
  if (h > 0) out.push(DIGIT[h], "trăm");
  else if (started) out.push("không", "trăm");
  if (t === 0) {
    if (u > 0) out.push(...(full ? [st.zero] : []), DIGIT[u]);
  } else if (t === 1) {
    out.push("mười");
    if (u > 0) out.push(u === 5 ? "lăm" : DIGIT[u]);
  } else {
    out.push(DIGIT[t], "mươi");
    if (u > 0) out.push(u === 1 ? "mốt" : u === 4 ? "tư" : u === 5 ? "lăm" : DIGIT[u]);
  }
  return out.join(" ");
}

/** Đọc số nguyên không âm < 10^9 (ba nhóm: triệu, nghìn, đơn vị). `started`: có phần cao hơn (tỷ) đã đọc. */
function readBlock(n: number, started: boolean, st: WordsStyle): string {
  const groups: [number, string][] = [[Math.floor(n / 1_000_000), "triệu"], [Math.floor(n / 1000) % 1000, st.thousand], [n % 1000, ""]];
  const out: string[] = [];
  let begun = started;
  for (const [v, unit] of groups) {
    if (v === 0) continue;
    out.push(readGroup(v, begun, st));
    if (unit) out.push(unit);
    begun = true;
  }
  return out.join(" ");
}

/** Số nguyên (chuỗi chữ số, ≤ 10^15) → chữ thường, không thêm đơn vị tiền. */
export function integerToWords(int: string, st: WordsStyle = { zero: "linh", thousand: "nghìn" }): string {
  const n = BigInt(int || "0");
  if (n < 0n) throw new RangeError("negative");
  if (n > MAX_WORDS_VALUE) throw new RangeError("too large");
  if (n === 0n) return "không";
  const billions = Number(n / 1_000_000_000n); // ≤ 10^6
  const rest = Number(n % 1_000_000_000n);
  const parts: string[] = [];
  if (billions > 0) parts.push(readBlock(billions, false, st), "tỷ");
  if (rest > 0) parts.push(readBlock(rest, billions > 0, st));
  return parts.join(" ");
}

/** Phần thập phân đọc từng chữ số ("0,05" → "không phẩy không năm"). */
export function fractionToWords(frac: string): string {
  return [...frac].map((c) => DIGIT[+c]).join(" ");
}

export type Currency = "vnd" | "usd" | "none";

export interface WordsResult {
  words: string;
  /** Số viết bằng chữ số theo kiểu Việt, kèm đơn vị. */
  figure: string;
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Nhóm nghìn bằng dấu chấm: "1234567" → "1.234.567". */
export function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function numberToWords(p: ParsedNumber, opts: { currency?: Currency; style?: "formal" | "plain" | "south" } = {}): WordsResult {
  const style = opts.style ?? "formal";
  const st: WordsStyle = style === "south" ? { zero: "lẻ", thousand: "ngàn" } : { zero: "linh", thousand: "nghìn" };
  const cur = opts.currency ?? "none";
  if (BigInt(p.int) > MAX_WORDS_VALUE || (BigInt(p.int) === MAX_WORDS_VALUE && p.frac)) throw new RangeError("too large");
  const parts: string[] = [];
  if (p.neg && (p.int !== "0" || p.frac)) parts.push("âm");
  parts.push(integerToWords(p.int, st));
  const figBase = (p.neg && (p.int !== "0" || p.frac) ? "-" : "") + groupThousands(p.int) + (p.frac ? "," + p.frac : "");
  let figure = figBase;
  if (cur === "vnd") {
    if (p.frac) parts.push("phẩy", fractionToWords(p.frac), "đồng");
    else parts.push("đồng", "chẵn");
    figure = figBase + " đồng";
  } else if (cur === "usd") {
    if (p.frac.length > 2) throw new RangeError("usd decimals");
    parts.push("đô la Mỹ");
    if (p.frac) {
      const cents = Number(p.frac.padEnd(2, "0"));
      parts.push("và", integerToWords(String(cents), st), "xu");
    } else parts.push("chẵn");
    figure = figBase + " USD";
  } else if (p.frac) parts.push("phẩy", fractionToWords(p.frac));
  const text = parts.join(" ");
  return { words: style === "plain" ? text : cap(text), figure };
}

// ---------------------------------------------------------------- định dạng số kiểu Việt

/** Làm tròn "nửa ra xa số 0" ở `d` chữ số thập phân, tránh sai số nhị phân (1.005 → 1,01). */
export function roundTo(x: number, d: number): number {
  if (!Number.isFinite(x)) return x;
  const s = Math.abs(x);
  const r = Number(Math.round(Number(`${s}e${d}`)) + `e-${d}`);
  return Number.isNaN(r) ? Math.round(x * 10 ** d) / 10 ** d : x < 0 ? -r : r;
}

/** Số → chuỗi thập phân thường (không dùng ký hiệu mũ), tối đa 15 chữ số có nghĩa, bỏ số 0 thừa: 0.1+0.2 → "0.3". */
export function plainNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  let s = x.toPrecision(15);
  if (/e/i.test(s)) s = Math.abs(x) < 1 ? x.toFixed(15) : x.toFixed(0);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** Số → "1.234.567,89". `decimals` cố định số chữ số thập phân; bỏ trống = tối đa 15 chữ số có nghĩa, bỏ số 0 thừa. */
export function formatVn(x: number, decimals?: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (decimals === undefined) {
    const s = plainNumber(x);
    const neg = s.startsWith("-");
    const [i, f = ""] = s.replace(/^-/, "").split(".");
    return (neg ? "-" : "") + groupThousands(i) + (f ? "," + f : "");
  }
  const d = Math.max(0, Math.min(15, decimals));
  const rounded = roundTo(x, d);
  const [i, f = ""] = Math.abs(rounded).toFixed(d).split(".");
  const sign = rounded < 0 && /[1-9]/.test(i + f) ? "-" : "";
  return sign + groupThousands(i) + (f ? "," + f : "");
}
