/**
 * Phát hiện dữ liệu cá nhân trong tài liệu tiếng Việt: CCCD/CMND, số điện thoại, email, mã số thuế, số tài khoản, mã sinh viên.
 * Nguyên tắc: báo SỐ LƯỢNG và VỊ TRÍ, chỉ hiện giá trị đã che; không bao giờ trả lại giá trị đầy đủ.
 * Ưu tiên độ chính xác: số 9–10 chữ số trơn (dễ nhầm mã sinh viên, số hồ sơ…) chỉ được tính khi có từ khoá đi kèm hoặc nằm trong cột có tiêu đề phù hợp.
 */
import { fold } from "./readdoc";
import { DOCX, PPTX, rewriteZipText, type Edit } from "./xmlfill";
import { documentUnits } from "./locate";
import { cellDisplay, colName, readXlsxGrid } from "./xlsx";
import { loadZip } from "./docx-read";

export type PiiType = "cccd" | "cmnd" | "phone" | "email" | "mst" | "stk" | "mssv";
export const PII_TYPES: PiiType[] = ["cccd", "cmnd", "phone", "email", "mst", "stk", "mssv"];
export const PII_LABEL: Record<PiiType, string> = { cccd: "CCCD", cmnd: "CMND", phone: "SĐT", email: "Email", mst: "Mã số thuế", stk: "Số tài khoản", mssv: "Mã sinh viên" };
/** Loại đặc biệt nhạy cảm (có thể bị lợi dụng giả mạo/chiếm đoạt tài sản). */
export const PII_HIGH: PiiType[] = ["cccd", "cmnd", "stk", "mst"];

export interface PiiHit {
  type: PiiType;
  start: number;
  end: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Dãy chữ số có thể có dấu cách/chấm/gạch đơn giữa các nhóm (vd 0901 234 567, 0123456789-001). */
const NUMBER = /(?<![\w@.+-])(?:\+|0084)?\d(?:[ .-]?\d){6,18}(?![\w@])/g;

const CTX: [PiiType | "idcard", RegExp][] = [
  ["stk", /(stk|so tai khoan|tai khoan|tk ngan hang|account|ngan hang)[^\d]{0,12}$/],
  ["mst", /(mst|ma so thue|tax code|tax id)[^\d]{0,12}$/],
  ["mssv", /(mssv|ma sinh vien|ma sv|student id|ma so sv)[^\d]{0,12}$/],
  ["idcard", /(cccd|can cuoc|cmnd|cmt|chung minh|so dinh danh|can cuoc cong dan)[^\d]{0,16}$/],
];
const CCCD_FMT = /^0(?:0[1-9]|[1-8]\d|9[0-6])\d{9}$/;
const MOBILE = /^0(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
const LANDLINE = /^02\d{8,9}$/;

function context(text: string, at: number): PiiType | "idcard" | null {
  const before = fold(text.slice(Math.max(0, at - 32), at));
  for (const [t, re] of CTX) if (re.test(before)) return t;
  return null;
}

/**
 * Tìm dữ liệu cá nhân trong một đoạn chữ ngắn (một dòng/ô/đoạn).
 * `forced`: ô thuộc cột có tiêu đề cho biết loại (vd "SĐT", "CCCD") — mọi dãy số hợp lý trong ô được tính là loại đó.
 */
export function findPii(text: string, forced?: PiiType | "idcard"): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const m of text.matchAll(EMAIL)) hits.push({ type: "email", start: m.index!, end: m.index! + m[0].length });
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const start = m.index!;
    let digits = raw.replace(/\D/g, "");
    let type: PiiType | null = null;
    const ctx = forced ?? context(text, start);
    if (/^(?:\+84|0084)/.test(raw.replace(/[ .-]/g, ""))) {
      digits = "0" + raw.replace(/[ .-]/g, "").replace(/^(?:\+84|0084)/, "");
      if (MOBILE.test(digits) || LANDLINE.test(digits)) type = "phone";
    } else if (raw.startsWith("+")) continue;
    else if (ctx === "idcard") type = digits.length === 12 ? "cccd" : digits.length === 9 ? "cmnd" : null;
    else if (ctx === "stk") type = digits.length >= 8 && digits.length <= 19 ? "stk" : null;
    else if (ctx === "mst") type = /^\d{10}(?:-?\d{3})?$/.test(raw.replace(/[ .]/g, "")) ? "mst" : null;
    else if (ctx === "mssv") type = digits.length >= 6 && digits.length <= 12 ? "mssv" : null;
    else if (ctx === "phone") type = digits.length >= 9 && digits.length <= 11 ? "phone" : null;
    else if (ctx === "cccd" || ctx === "cmnd" || ctx === "email") type = null;
    else if (CCCD_FMT.test(digits)) type = "cccd";
    else if (MOBILE.test(digits) || LANDLINE.test(digits)) type = "phone";
    else if (/^\d{10}-\d{3}$/.test(raw)) type = "mst"; // mã số thuế đơn vị phụ thuộc
    if (type) hits.push({ type, start, end: start + raw.length });
  }
  // bỏ chồng lấn: giữ cái đầu tiên theo vị trí
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  return hits.filter((h, i) => !hits.slice(0, i).some((p) => p.end > h.start && p.start < h.end));
}

/** Che giá trị khi hiển thị cho người dùng/agent: chỉ chừa vài ký tự cuối. */
export function maskValue(v: string, type: PiiType): string {
  if (type === "email") {
    const [u, d = ""] = v.split("@");
    return `${u.slice(0, 1)}•••@${d.slice(0, 1)}•••${d.includes(".") ? d.slice(d.lastIndexOf(".")) : ""}`;
  }
  const digits = v.replace(/\D/g, "");
  return "•".repeat(Math.max(0, digits.length - 2)) + digits.slice(-2);
}

export interface PiiFinding {
  type: PiiType;
  loc: string;
  masked: string;
}
export interface PiiReport {
  findings: PiiFinding[];
  counts: Record<PiiType, number>;
  /** Loại nào cũng không có → rỗng. */
  total: number;
  note?: string;
}

const emptyCounts = (): Record<PiiType, number> => ({ cccd: 0, cmnd: 0, phone: 0, email: 0, mst: 0, stk: 0, mssv: 0 });

/** Cột Excel có tiêu đề cho biết loại dữ liệu cá nhân. */
const HEADER_TYPE: [RegExp, PiiType | "idcard"][] = [
  [/(cccd|can cuoc|cmnd|cmt|chung minh|dinh danh)/, "idcard"],
  [/(sdt|so dien thoai|dien thoai|phone|mobile|di dong|^dt$)/, "phone"],
  [/(mst|ma so thue|tax)/, "mst"],
  [/(stk|so tai khoan|tai khoan|account)/, "stk"],
  [/(mssv|ma sinh vien|ma sv|student)/, "mssv"],
];
const headerType = (h: string): PiiType | "idcard" | undefined => {
  const f = fold(h).trim();
  return HEADER_TYPE.find(([re]) => re.test(f))?.[1];
};

const typeFromForced = (digits: string, forced: PiiType | "idcard"): PiiType => (forced === "idcard" ? (digits.length === 9 ? "cmnd" : "cccd") : forced);

/** Quét một tài liệu (Word/Excel/PowerPoint/PDF/văn bản). Không bao giờ trả giá trị đầy đủ. */
export async function scanDocumentPii(bytes: Uint8Array, ext: string, maxFindings = 500, quick = false): Promise<PiiReport> {
  const counts = emptyCounts();
  const findings: PiiFinding[] = [];
  const add = (type: PiiType, loc: string, value: string) => {
    counts[type]++;
    if (findings.length < maxFindings) findings.push({ type, loc, masked: maskValue(value, type) });
  };
  let note: string | undefined;
  if (ext === ".xlsx" || ext === ".xlsm") {
    for (const g of await readXlsxGrid(bytes, quick ? { maxRows: 3000, maxCols: 30, maxCells: 60_000 } : { maxRows: 20000, maxCols: 60, maxCells: 400_000 })) {
      const head = g.rows[0];
      const colTypes = head ? head.cells.map(headerType) : [];
      for (const row of g.rows) {
        row.cells.forEach((text, i) => {
          if (!text || row === head) return;
          const forced = colTypes[i];
          const hs = findPii(text, forced);
          const addr = `${g.name}!${colName(g.c1 + i)}${row.r}`;
          if (forced && !hs.length && /^[\d .+-]{6,25}$/.test(text)) {
            const d = text.replace(/\D/g, "");
            if (d.length >= 6) add(typeFromForced(d, forced), addr, text);
          } else for (const h of hs) add(h.type, addr, text.slice(h.start, h.end));
        });
      }
      if (g.truncated) note = "Một sheet lớn chỉ quét được một phần.";
    }
    return { findings, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), note };
  }
  const r = await documentUnits(bytes, ext);
  for (const u of r.units) for (const line of u.text.split("\n")) for (const h of findPii(line)) add(h.type, u.loc, line.slice(h.start, h.end));
  return { findings, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), note: r.note };
}

/** Tóm tắt một dòng: "CCCD ×2, SĐT ×5". */
export const countsLine = (c: Record<PiiType, number>): string => PII_TYPES.filter((t) => c[t]).map((t) => `${PII_LABEL[t]} ×${c[t]}`).join(", ");

/** Có đủ nặng để cảnh báo ngay khi đọc không (loại nhạy cảm, hoặc nhiều thông tin liên hệ)? */
export const isNotable = (c: Record<PiiType, number>): boolean => PII_HIGH.some((t) => c[t] > 0) || c.phone + c.email + c.mssv >= 8;

/** Chữ thay thế khi che. */
const REDACT = (t: PiiType): string => `[${PII_LABEL[t]} đã ẩn]`;

export async function redactDocument(bytes: Uint8Array, ext: string): Promise<{ bytes: Uint8Array; counts: Record<PiiType, number>; total: number }> {
  const counts = emptyCounts();
  const edits = (full: string): Edit[] =>
    findPii(full).map((h) => {
      counts[h.type]++;
      return { start: h.start, end: h.end, text: REDACT(h.type) };
    });
  if (ext === ".docx" || ext === ".pptx") {
    const r = await rewriteZipText(bytes, ext === ".docx" ? DOCX : PPTX, edits);
    return { bytes: r.bytes, counts, total: r.edits };
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    await loadZip(bytes);
    const mod: any = await import("exceljs"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const ExcelJS = mod.default ?? mod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    for (const ws of wb.worksheets) {
      let colTypes: (PiiType | "idcard" | undefined)[] = [];
      ws.eachRow({ includeEmpty: false }, (row: any, r: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (r === 1) {
          colTypes = [];
          row.eachCell({ includeEmpty: true }, (cell: any, c: number) => (colTypes[c - 1] = headerType(cellDisplay(cell.value)))); // eslint-disable-line @typescript-eslint/no-explicit-any
          return;
        }
        row.eachCell({ includeEmpty: false }, (cell: any, c: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const v = cell.value;
          if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) return; // không đụng công thức
          const text = cellDisplay(v);
          if (!text) return;
          const forced = colTypes[c - 1];
          const hs = findPii(text, forced);
          if (forced && !hs.length && /^[\d .+-]{6,25}$/.test(text) && text.replace(/\D/g, "").length >= 6) {
            const t = typeFromForced(text.replace(/\D/g, ""), forced);
            counts[t]++;
            cell.value = REDACT(t);
            return;
          }
          if (!hs.length) return;
          let out = text;
          for (const h of [...hs].reverse()) {
            counts[h.type]++;
            out = out.slice(0, h.start) + REDACT(h.type) + out.slice(h.end);
          }
          cell.value = out;
        });
      });
    }
    wb.calcProperties = { fullCalcOnLoad: true };
    const buf = await wb.xlsx.writeBuffer();
    return { bytes: buf instanceof Uint8Array ? new Uint8Array(buf) : new Uint8Array(buf as ArrayBuffer), counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }
  // văn bản thuần
  const text = new TextDecoder().decode(bytes);
  const out = text.split("\n").map((line) => {
    const hs = findPii(line);
    let s = line;
    for (const h of [...hs].reverse()) {
      counts[h.type]++;
      s = s.slice(0, h.start) + REDACT(h.type) + s.slice(h.end);
    }
    return s;
  }).join("\n");
  return { bytes: new TextEncoder().encode(out), counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

