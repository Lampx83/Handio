/**
 * Trộn thư hàng loạt: mẫu Word/PowerPoint có {{Tên cột}} + bảng dữ liệu (Excel/CSV) → nhiều tệp (hoặc một tệp Word gộp, mỗi bản một trang).
 * Mỗi giá trị được thay đúng MỘT lần (giá trị chứa "{{...}}" không bị thay tiếp), mã hoá XML an toàn, giữ định dạng của run đầu.
 */
import { loadZip } from "./docx-read";
import { fold } from "./readdoc";
import { DOCX, PPTX, rewriteZipText, type Edit } from "./xmlfill";
import { readXlsxGrid } from "./xlsx";

/** Giới hạn cứng số bản tạo ra trong một lần. */
export const MERGE_MAX = 200;

export interface MergeData {
  headers: string[];
  rows: string[][];
}

/** CSV/TSV (RFC 4180: ô trong dấu nháy kép, "" là dấu nháy); tự nhận dấu phân cách , ; hoặc tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = src.split("\n", 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Đọc bảng dữ liệu: dòng đầu là tiêu đề cột. Số thập phân dùng dấu phẩy (8,5) nếu `decimalComma`. */
export async function loadMergeData(bytes: Uint8Array, ext: string, opts: { sheet?: string; decimalComma?: boolean } = {}): Promise<MergeData> {
  let table: string[][];
  if (ext === ".xlsx" || ext === ".xlsm") {
    const grids = await readXlsxGrid(bytes, { sheet: opts.sheet, maxRows: 5000, maxCols: 60, maxCells: 300_000 });
    const g = grids[0];
    if (!g) throw new Error("File Excel không có sheet nào.");
    const maxCol = Math.max(0, ...g.rows.map((r) => r.cells.reduce((m, c, i) => (c !== "" ? i + 1 : m), 0)));
    table = g.rows.map((r) => r.cells.slice(0, maxCol));
  } else table = parseCsv(new TextDecoder().decode(bytes));
  if (table.length < 2) throw new Error("Bảng dữ liệu cần ít nhất một dòng tiêu đề và một dòng dữ liệu.");
  const headers = table[0].map((h) => h.trim());
  const comma = opts.decimalComma !== false;
  const rows = table.slice(1).map((r) => headers.map((_, i) => {
    const v = (r[i] ?? "").trim();
    return comma && /^-?\d+\.\d+$/.test(v) ? v.replace(".", ",") : v;
  })).filter((r) => r.some((c) => c !== ""));
  return { headers, rows };
}

const PLACEHOLDER = /\{\{\s*([^{}\n]{1,80}?)\s*\}\}/g;
const key = (s: string): string => fold(s).replace(/\s+/g, " ").trim();

export interface Template {
  kind: "docx" | "pptx";
  bytes: Uint8Array;
}
const dialect = (k: Template["kind"]) => (k === "docx" ? DOCX : PPTX);

/** Các {{tên}} xuất hiện trong mẫu (theo thứ tự, không trùng). */
export async function templatePlaceholders(t: Template): Promise<string[]> {
  const found: string[] = [];
  await rewriteZipText(t.bytes, dialect(t.kind), (full) => {
    for (const m of full.matchAll(PLACEHOLDER)) if (!found.some((f) => key(f) === key(m[1]))) found.push(m[1].trim());
    return [];
  });
  return found;
}

/** Điền một bản: thay một lần mọi {{cột}} bằng giá trị tương ứng; {{cột lạ}} giữ nguyên. */
export async function fillTemplate(t: Template, values: Map<string, string>): Promise<{ bytes: Uint8Array; replaced: number }> {
  const r = await rewriteZipText(t.bytes, dialect(t.kind), (full): Edit[] =>
    [...full.matchAll(PLACEHOLDER)].filter((m) => values.has(key(m[1]))).map((m) => ({ start: m.index!, end: m.index! + m[0].length, text: values.get(key(m[1]))!.replace(/\s*\n\s*/g, " ") })),
  );
  return { bytes: r.bytes, replaced: r.edits };
}

export interface MergePlan {
  rows: number;
  placeholders: string[];
  /** Placeholder không có cột tương ứng. */
  missing: string[];
  /** Cột không được mẫu dùng. */
  unused: string[];
  /** Placeholder → số dòng có ô trống. */
  empties: Record<string, number>;
  /** Map để điền theo từng dòng. */
  valuesOf(i: number): Map<string, string>;
}

export function planMerge(data: MergeData, placeholders: string[]): MergePlan {
  const idx = new Map<string, number>();
  data.headers.forEach((h, i) => {
    if (h && !idx.has(key(h))) idx.set(key(h), i);
  });
  const missing = placeholders.filter((p) => !idx.has(key(p)));
  const used = new Set(placeholders.map(key));
  const empties: Record<string, number> = {};
  for (const p of placeholders) if (idx.has(key(p))) empties[p] = data.rows.filter((r) => !(r[idx.get(key(p))!] ?? "").trim()).length;
  return {
    rows: data.rows.length,
    placeholders,
    missing,
    unused: data.headers.filter((h) => h && !used.has(key(h))),
    empties,
    valuesOf: (i) => new Map([...idx].map(([k, c]) => [k, data.rows[i][c] ?? ""])),
  };
}

/** Tên tệp an toàn từ giá trị dữ liệu: bỏ ký tự cấm, khoảng trắng → "-", tối đa 80 ký tự. */
// eslint-disable-next-line no-control-regex
export const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 80);

/** Tên tệp cho từng dòng theo `pattern` (vd "giay-khen-{{Họ tên}}"); không trùng nhau và không trùng `taken`. */
export function fileNames(plan: MergePlan, pattern: string | undefined, fallbackStem: string, ext: string, taken: (name: string) => boolean): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < plan.rows; i++) {
    const vals = plan.valuesOf(i);
    let base = pattern ? pattern.replace(PLACEHOLDER, (_m, k: string) => vals.get(key(k)) ?? "") : "";
    base = safeName(base.replace(/\.[A-Za-z0-9]{2,4}$/, ""));
    if (!base) base = `${fallbackStem}-${String(i + 1).padStart(3, "0")}`;
    let name = base + ext;
    for (let n = 2; used.has(name.toLowerCase()) || taken(name); n++) name = `${base}-${n}${ext}`;
    used.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** Tách document.xml thành: phần trước thân, thân (không kể sectPr cuối), sectPr cuối, phần sau thân. */
function splitBody(xml: string): { head: string; body: string; sect: string; tail: string } {
  const open = xml.indexOf("<w:body>");
  const close = xml.lastIndexOf("</w:body>");
  if (open < 0 || close < open) throw new Error("Không đọc được cấu trúc Word của mẫu.");
  const inner = xml.slice(open + 8, close);
  const s = inner.lastIndexOf("<w:sectPr");
  const isFinal = s >= 0 && /^<w:sectPr\b[\s\S]*?(?:\/>|<\/w:sectPr>)\s*$/.test(inner.slice(s)) && !/<\/w:p>\s*$/.test(inner.slice(s));
  return { head: xml.slice(0, open + 8), body: isFinal ? inner.slice(0, s) : inner, sect: isFinal ? inner.slice(s) : "", tail: xml.slice(close) };
}

/** Gộp nhiều bản Word cùng mẫu thành một tệp, mỗi bản bắt đầu ở trang mới. */
export async function combineDocx(copies: Uint8Array[]): Promise<Uint8Array> {
  if (!copies.length) throw new Error("Không có bản nào để gộp.");
  const zips = await Promise.all(copies.map((c) => loadZip(c)));
  const xmls = await Promise.all(zips.map((z) => z.file("word/document.xml")!.async("string")));
  const parts = xmls.map(splitBody);
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  // dấu trang (bookmark) trùng id làm Word phàn nàn: chỉ giữ ở bản đầu
  const bodies = parts.map((p, i) => (i ? p.body.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g, "") : p.body));
  zips[0].file("word/document.xml", parts[0].head + bodies.join(pageBreak) + parts[0].sect + parts[0].tail);
  return zips[0].generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
