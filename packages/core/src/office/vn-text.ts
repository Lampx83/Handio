/** Xử lý chữ tiếng Việt: bỏ dấu, slug, chuẩn hoá họ tên, tách họ/đệm/tên, sắp xếp theo bảng chữ cái tiếng Việt, số điện thoại. */

const COMBINING = /[̀-ͯ]/g;

/** Chuẩn hoá về NFC (dạng dựng sẵn) để "ế" luôn là một ký tự dù văn bản gốc ở dạng tổ hợp. */
export const nfc = (s: string): string => s.normalize("NFC");

export function removeDiacritics(s: string): string {
  return s.normalize("NFD").replace(COMBINING, "").replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFC");
}

export function slugify(s: string, sep = "-"): string {
  const t = removeDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, sep);
  const e = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.replace(new RegExp(`^(?:${e})+|(?:${e})+$`, "g"), "");
}

const lines = (s: string): string[] => nfc(s).replace(/\r\n?/g, "\n").split("\n");

export function normalizeSpaces(s: string): string {
  return lines(s)
    .map((l) => l.replace(/[  -   　\t]/g, " ").replace(/[​-‍﻿]/g, "").replace(/ {2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const wordsOf = (name: string): string[] => nfc(name).trim().split(/\s+/).filter(Boolean);

/** "NGUYỄN văn a" → "Nguyễn Văn A". Giữ nguyên số dòng; bỏ khoảng trắng thừa. */
export function titleCaseName(s: string): string {
  return lines(s)
    .map((l) =>
      wordsOf(l)
        .map((w) => w.toLowerCase().replace(/(^|[-'’.])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase()))
        .join(" "))
    .join("\n");
}

/** Họ ghép phổ biến (so sánh không phân biệt hoa thường, có dấu). Từ đầu tiên còn lại là họ đơn. */
const COMPOUND_SURNAMES = ["công huyền tôn nữ", "công tằng tôn nữ", "âu dương", "công tôn", "tôn thất", "tôn nữ", "hoàng phủ", "nguyễn phúc"];

export interface NameParts {
  ho: string;
  dem: string;
  ten: string;
  compound: boolean;
}

export function splitName(name: string): NameParts {
  const w = wordsOf(name);
  if (w.length === 0) return { ho: "", dem: "", ten: "", compound: false };
  if (w.length === 1) return { ho: "", dem: "", ten: w[0], compound: false };
  const low = w.map((x) => x.toLowerCase());
  let hoLen = 1;
  for (const c of COMPOUND_SURNAMES) {
    const k = c.split(" ").length;
    if (w.length > k && low.slice(0, k).join(" ") === c) {
      hoLen = k;
      break;
    }
  }
  return { ho: w.slice(0, hoLen).join(" "), dem: w.slice(hoLen, -1).join(" "), ten: w[w.length - 1], compound: hoLen > 1 };
}

// ---------------------------------------------------------------- sắp xếp theo bảng chữ cái tiếng Việt

const LETTER_ORDER = ["a", "ă", "â", "b", "c", "d", "đ", "e", "ê", "g", "h", "i", "k", "l", "m", "n", "o", "ô", "ơ", "p", "q", "r", "s", "t", "u", "ư", "v", "x", "y"];
const LETTER_RANK = new Map(LETTER_ORDER.map((c, i) => [c, i + 1]));
const TONES = ["", "̀", "̉", "̃", "́", "̣"]; // ngang, huyền, hỏi, ngã, sắc, nặng

interface CollationKey {
  primary: number[];
  tones: number[];
}

function collationKey(s: string): CollationKey {
  const primary: number[] = [];
  const tones: number[] = [];
  const nfd = s.toLowerCase().normalize("NFD");
  let i = 0;
  while (i < nfd.length) {
    const base = nfd[i++];
    let shape = "";
    let tone = 0;
    while (i < nfd.length && /[̀-ͯ]/.test(nfd[i])) {
      const mk = nfd[i++];
      if (mk === "̆" || mk === "̂" || mk === "̛") shape = mk;
      else {
        const t = TONES.indexOf(mk);
        if (t > 0) tone = t;
      }
    }
    let letter = base;
    if (base === "a" && shape === "̆") letter = "ă";
    else if (base === "a" && shape === "̂") letter = "â";
    else if (base === "e" && shape === "̂") letter = "ê";
    else if (base === "o" && shape === "̂") letter = "ô";
    else if (base === "o" && shape === "̛") letter = "ơ";
    else if (base === "u" && shape === "̛") letter = "ư";
    const rank = LETTER_RANK.get(letter);
    // khoảng trắng và ký tự khác xếp trước chữ cái; chữ cái ngoài bảng (f j w z) xếp theo mã
    primary.push(rank ?? (/\s/.test(base) ? 0 : base.charCodeAt(0) + (/[a-z]/.test(base) ? 100 : -1000)));
    tones.push(tone);
  }
  return { primary, tones };
}

function cmpKey(a: CollationKey, b: CollationKey): number {
  const n = Math.min(a.primary.length, b.primary.length);
  for (let i = 0; i < n; i++) if (a.primary[i] !== b.primary[i]) return a.primary[i] - b.primary[i];
  if (a.primary.length !== b.primary.length) return a.primary.length - b.primary.length;
  for (let i = 0; i < n; i++) if (a.tones[i] !== b.tones[i]) return a.tones[i] - b.tones[i];
  return 0;
}

/** So sánh hai chuỗi theo thứ tự chữ cái tiếng Việt (a ă â b c d đ e ê … và thanh điệu: ngang, huyền, hỏi, ngã, sắc, nặng). */
export const compareVi = (a: string, b: string): number => cmpKey(collationKey(a), collationKey(b));

/** Sắp xếp họ tên: theo TÊN, rồi họ, rồi tên đệm (cách xếp danh sách lớp/cơ quan). */
export function sortNames(names: string[]): string[] {
  const keyed = names.map((n) => {
    const p = splitName(n);
    return { n, ten: collationKey(p.ten), ho: collationKey(p.ho), dem: collationKey(p.dem), full: collationKey(n) };
  });
  keyed.sort((x, y) => cmpKey(x.ten, y.ten) || cmpKey(x.ho, y.ho) || cmpKey(x.dem, y.dem) || cmpKey(x.full, y.full) || (x.n < y.n ? -1 : x.n > y.n ? 1 : 0));
  return keyed.map((k) => k.n);
}

// ---------------------------------------------------------------- số điện thoại

const CARRIER_BY_PREFIX: Record<string, string> = {};
const setCarrier = (name: string, prefixes: string[]) => prefixes.forEach((p) => (CARRIER_BY_PREFIX[p] = name));
setCarrier("Viettel", ["032", "033", "034", "035", "036", "037", "038", "039", "086", "096", "097", "098"]);
setCarrier("VinaPhone", ["081", "082", "083", "084", "085", "088", "091", "094"]);
setCarrier("MobiFone", ["070", "076", "077", "078", "079", "089", "090", "093"]);
setCarrier("Vietnamobile", ["052", "056", "058", "092"]);
setCarrier("Gmobile", ["059", "099"]);
setCarrier("Itelecom (Reddi)", ["087"]);

/** Đầu số di động 11 số cũ (trước 15/9/2018) → đầu số 10 số hiện nay. */
const OLD_PREFIX: Record<string, string> = {
  "0162": "032", "0163": "033", "0164": "034", "0165": "035", "0166": "036", "0167": "037", "0168": "038", "0169": "039",
  "0120": "070", "0121": "079", "0122": "077", "0123": "083", "0124": "084", "0125": "085", "0126": "076", "0127": "081", "0128": "078", "0129": "082",
  "0186": "056", "0188": "058", "0199": "059",
};

const AREA: Record<string, string> = { "024": "Hà Nội", "028": "TP. Hồ Chí Minh", "0236": "Đà Nẵng", "0225": "Hải Phòng", "0292": "Cần Thơ", "0258": "Khánh Hoà", "0254": "Bà Rịa - Vũng Tàu", "0251": "Đồng Nai", "0274": "Bình Dương", "0238": "Nghệ An", "0234": "Thừa Thiên Huế", "0256": "Bình Định", "0262": "Đắk Lắk", "0263": "Lâm Đồng", "0206": "Cao Bằng", "0208": "Thái Nguyên", "0203": "Quảng Ninh", "0204": "Bắc Giang", "0222": "Bắc Ninh", "0220": "Hải Dương", "0221": "Hưng Yên", "0227": "Thái Bình", "0228": "Nam Định", "0229": "Ninh Bình", "0232": "Quảng Bình", "0233": "Quảng Trị", "0237": "Thanh Hoá", "0239": "Hà Tĩnh", "0255": "Quảng Ngãi", "0235": "Quảng Nam" };

export interface PhoneResult {
  input: string;
  valid: boolean;
  /** Dạng trong nước: 0912 345 678. */
  national?: string;
  /** Dạng quốc tế: +84 912 345 678. */
  international?: string;
  carrier?: string;
  type?: "di động" | "cố định" | "tổng đài";
  note?: string;
}

const group = (d: string, sizes: number[]): string => {
  const out: string[] = [];
  let i = 0;
  for (const s of sizes) {
    out.push(d.slice(i, i + s));
    i += s;
  }
  if (i < d.length) out.push(d.slice(i));
  return out.filter(Boolean).join(" ");
};

export function normalizePhone(input: string): PhoneResult {
  const raw = input.trim();
  let d = raw.replace(/[^\d+]/g, "");
  let note: string | undefined;
  if (d.startsWith("+")) d = d.slice(1).replace(/\+/g, "");
  else d = d.replace(/\+/g, "");
  if (!d) return { input: raw, valid: false, note: "không có chữ số" };
  if (/^1[89]00\d{4,6}$/.test(d)) return { input: raw, valid: true, national: d, type: "tổng đài", note: "đầu số dịch vụ/tổng đài" };
  if (d.startsWith("0084")) d = "0" + d.slice(4);
  else if (d.startsWith("84") && d.length >= 11) d = "0" + d.slice(2);
  else if (!d.startsWith("0") && /^[2-9]\d{8,9}$/.test(d)) {
    d = "0" + d;
    note = "thiếu số 0 đầu, đã thêm";
  }
  if (d.length === 11 && OLD_PREFIX[d.slice(0, 4)]) {
    d = OLD_PREFIX[d.slice(0, 4)] + d.slice(4);
    note = "đầu số 11 số cũ, đã đổi sang đầu số 10 số hiện nay";
  }
  if (/^0[35789]\d{8}$/.test(d)) {
    const carrier = CARRIER_BY_PREFIX[d.slice(0, 3)];
    return { input: raw, valid: true, national: group(d, [4, 3, 3]), international: "+84 " + group(d.slice(1), [3, 3, 3]), carrier: carrier ?? "không rõ nhà mạng", type: "di động", note };
  }
  if (/^02\d{9}$/.test(d)) {
    const big = d.startsWith("024") || d.startsWith("028");
    const area = AREA[d.slice(0, 3)] ?? AREA[d.slice(0, 4)];
    return {
      input: raw,
      valid: true,
      national: big ? group(d, [3, 4, 4]) : group(d, [4, 3, 4]),
      international: "+84 " + (big ? group(d.slice(1), [2, 4, 4]) : group(d.slice(1), [3, 3, 4])),
      carrier: area ? `mã vùng ${area}` : undefined,
      type: "cố định",
      note,
    };
  }
  return { input: raw, valid: false, note: `không đúng định dạng Việt Nam (di động: 10 số bắt đầu 03/05/07/08/09; cố định: 11 số bắt đầu 02; hiện có ${d.length} số)` };
}

export function phoneLine(r: PhoneResult): string {
  if (!r.valid) return `${r.input} → KHÔNG HỢP LỆ: ${r.note}`;
  return [`${r.input} → ${r.national}`, r.international, [r.type, r.carrier].filter(Boolean).join(", "), r.note ? `(${r.note})` : ""].filter(Boolean).join(" | ");
}
