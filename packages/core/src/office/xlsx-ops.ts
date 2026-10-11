/* eslint-disable @typescript-eslint/no-explicit-any */
import { colorHex } from "./colors";

/**
 * Thao tác cấu trúc và định dạng cho xlsx_edit: xoá/chèn hàng-cột, đổi tên/xoá sheet, xoá vùng, sắp xếp, định dạng ô, gộp ô, cố định hàng, bộ lọc.
 * Chạy trên workbook ExcelJS đã mở. Số hàng/cột luôn theo sheet TRƯỚC lần gọi này; nhiều thao tác cùng loại được áp từ dưới lên.
 * Công thức tham chiếu vùng bị dịch chuyển được viết lại (ExcelJS không tự làm): ô bị xoá → #REF!.
 */
export interface FormatSpec {
  sheet?: string;
  /** "A1", "A1:D5", cả cột "B:B"/"B:D", cả hàng "2:2"/"2:5". */
  range: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Màu chữ (#RRGGBB hoặc tên màu). */
  color?: string;
  /** Màu nền ô. */
  fill?: string;
  font?: string;
  size?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** Định dạng số/ngày Excel, ví dụ "#,##0", "0.0%", "dd/mm/yyyy". */
  number_format?: string;
  border?: "all" | "outline" | "bottom" | "top" | "none";
  /** Độ rộng cột (ký tự) khi range là cột; chiều cao hàng (điểm) khi range là hàng. */
  width?: number;
  height?: number;
}

export interface XlsxOps {
  rename_sheet?: { from: string; to: string }[];
  delete_sheet?: string[];
  delete_rows?: { sheet?: string; from: number; count?: number }[];
  insert_rows?: { sheet?: string; at: number; count?: number }[];
  delete_columns?: { sheet?: string; from: string | number; count?: number }[];
  insert_columns?: { sheet?: string; at: string | number; count?: number }[];
  clear?: { sheet?: string; range: string }[];
  sort?: { sheet?: string; range?: string; by: string | number; order?: "asc" | "desc"; header?: boolean }[];
  format?: FormatSpec[];
  merge?: { sheet?: string; range: string }[];
  unmerge?: { sheet?: string; range: string }[];
  /** "A2" = cố định mọi hàng/cột phía trên-trái ô đó; null = bỏ cố định. */
  freeze?: { sheet?: string; cell: string | null };
  autofilter?: { sheet?: string; range: string | null };
}

const colLetter = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const colIndex = (l: string): number => l.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colArg = (v: string | number, what: string): number => {
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? +v : /^[A-Za-z]{1,3}$/.test(String(v)) ? colIndex(String(v)) : 0;
  if (!Number.isInteger(n) || n < 1 || n > 16384) throw new Error(`${what}: cột không hợp lệ “${v}” (dùng chữ như B hoặc số như 2).`);
  return n;
};
const rowArg = (v: unknown, what: string): number => {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 1048576) throw new Error(`${what}: số hàng không hợp lệ “${String(v)}”.`);
  return v as number;
};
const cnt = (v: unknown, what: string): number => {
  if (v === undefined) return 1;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 100000) throw new Error(`${what}: count phải là số nguyên từ 1.`);
  return v as number;
};

// ---------------------------------------------------------------- viết lại công thức khi dịch hàng/cột

type Shift = { axis: "row" | "col"; at: number; count: number; kind: "insert" | "delete"; sheet: string };

/** Vị trí mới của một hàng/cột sau thao tác; null = bị xoá. */
function moved(n: number, s: Shift): number | null {
  if (s.kind === "insert") return n >= s.at ? n + s.count : n;
  if (n < s.at) return n;
  if (n >= s.at + s.count) return n - s.count;
  return null;
}

const REF = String.raw`(\$?)([A-Z]{1,3})(\$?)(\d+)`;
const REF_RE = new RegExp(String.raw`(?<![A-Za-z0-9_.])((?:'[^']+'|[A-Za-z0-9_]+)!)?${REF}(?::${REF})?(?![A-Za-z0-9_(])`, "g");

export function shiftFormula(formula: string, ownSheet: string, s: Shift): string {
  const pos = (col: string, row: string): number => (s.axis === "row" ? +row : colIndex(col));
  return formula
    .split('"')
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // trong chuỗi chữ
      return seg.replace(REF_RE, (m, sheetPart: string | undefined, dc1: string, c1: string, dr1: string, r1: string, dc2: string | undefined, c2: string | undefined, dr2: string | undefined, r2: string | undefined) => {
        const sh = sheetPart ? sheetPart.slice(0, -1).replace(/^'|'$/g, "") : ownSheet;
        if (sh.toLowerCase() !== s.sheet.toLowerCase()) return m;
        const prefix = sheetPart ?? "";
        const build = (dc: string, col: string, dr: string, row: string, n: number): string => (s.axis === "row" ? `${dc}${col}${dr}${n}` : `${dc}${colLetter(n)}${dr}${row}`);
        if (c2 === undefined) {
          const n = moved(pos(c1, r1), s);
          return n === null ? "#REF!" : prefix + build(dc1, c1, dr1, r1, n);
        }
        const p1 = pos(c1, r1);
        const p2 = pos(c2, r2!);
        const n1 = moved(p1, s);
        const n2 = moved(p2, s);
        if (n1 === null && n2 === null && p1 >= s.at && p2 < s.at + s.count) return "#REF!"; // cả vùng bị xoá
        const a = n1 ?? s.at; // đầu vùng nằm trong phần bị xoá → hàng/cột đầu tiên còn lại
        const b = n2 ?? Math.max(1, s.at - 1); // cuối vùng → hàng/cột liền trước phần bị xoá
        return prefix + build(dc1, c1, dr1, r1, a) + ":" + build(dc2 ?? "", c2, dr2 ?? "", r2!, b);
      });
    })
    .join('"');
}

/** Viết lại công thức của mọi ô trong workbook theo một lần dịch hàng/cột trên `sheet`. */
function shiftWorkbook(wb: any, s: Shift): void {
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        const v = cell.value;
        if (v && typeof v === "object" && typeof v.formula === "string") {
          const f = shiftFormula(v.formula, ws.name, s);
          if (f !== v.formula) cell.value = { formula: f };
        }
      });
    });
  }
}

// ---------------------------------------------------------------- vùng

interface Box {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  cols?: boolean;
  rows?: boolean;
}

export function parseBox(ws: any, text: string, what = "range"): Box {
  const t = String(text ?? "").trim().replace(/\$/g, "");
  const maxR = Math.max(1, ws.rowCount || 1);
  const maxC = Math.max(1, ws.columnCount || 1);
  let m = /^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/.exec(t);
  if (m) {
    const c1 = colIndex(m[1]);
    const r1 = +m[2];
    const c2 = m[3] ? colIndex(m[3]) : c1;
    const r2 = m[4] ? +m[4] : r1;
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }
  m = /^([A-Za-z]{1,3})(?::([A-Za-z]{1,3}))?$/.exec(t);
  if (m) {
    const c1 = colIndex(m[1]);
    const c2 = m[2] ? colIndex(m[2]) : c1;
    return { r1: 1, c1: Math.min(c1, c2), r2: maxR, c2: Math.max(c1, c2), cols: true };
  }
  m = /^(\d{1,7})(?::(\d{1,7}))?$/.exec(t);
  if (m) {
    const r1 = +m[1];
    const r2 = m[2] ? +m[2] : r1;
    return { r1: Math.min(r1, r2), c1: 1, r2: Math.max(r1, r2), c2: maxC, rows: true };
  }
  throw new Error(`${what}: vùng không hợp lệ “${text}” (ví dụ A1:D5, B:B, 2:2).`);
}

const argb = (hex: string): string => "FF" + hex;
const hexOf = (v: string, what: string): string => {
  const h = colorHex(v);
  if (!h) throw new Error(`${what}: không hiểu màu “${v}” (dùng #RRGGBB hoặc tên màu thông dụng).`);
  return h;
};

function cmp(a: any, b: any): number {
  const blank = (v: any) => v === null || v === undefined || v === "";
  if (blank(a) || blank(b)) return blank(a) && blank(b) ? 0 : blank(a) ? 1 : -1; // ô trống luôn xuống cuối
  const num = (v: any) => (v instanceof Date ? +v : typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(+v.replace(/\./g, "").replace(",", ".")) ? +v.replace(/\./g, "").replace(",", ".") : NaN);
  const x = num(a);
  const y = num(b);
  if (!isNaN(x) && !isNaN(y)) return x - y;
  return String(a?.richText ? a.richText.map((r: any) => r.text).join("") : a).localeCompare(String(b?.richText ? b.richText.map((r: any) => r.text).join("") : b), "vi", { sensitivity: "base", numeric: true });
}

/** Áp các thao tác CẤU TRÚC (trước khi gán ô/thêm hàng). Trả danh sách mô tả thay đổi. */
export function applyStructureOps(wb: any, ops: XlsxOps, defaultSheet?: string): string[] {
  const changed: string[] = [];
  const find = (name?: string): any => {
    const n = name ?? defaultSheet;
    const ws = n ? wb.worksheets.find((w: any) => w.name.toLowerCase() === String(n).toLowerCase()) : wb.worksheets[0];
    if (!ws) throw new Error(`Không có sheet "${n}". Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
    return ws;
  };
  for (const r of ops.rename_sheet ?? []) {
    const ws = find(r.from);
    const to = String(r.to ?? "").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
    if (!to) throw new Error("rename_sheet: tên mới trống.");
    if (wb.worksheets.some((w: any) => w !== ws && w.name.toLowerCase() === to.toLowerCase())) throw new Error(`rename_sheet: đã có sheet tên “${to}”.`);
    const old = ws.name;
    ws.name = to;
    // công thức ở sheet khác trỏ tới tên cũ
    for (const w of wb.worksheets) w.eachRow({ includeEmpty: false }, (row: any) => row.eachCell({ includeEmpty: false }, (c: any) => {
      const v = c.value;
      if (v && typeof v === "object" && typeof v.formula === "string" && v.formula.includes(old)) c.value = { formula: v.formula.split(`'${old}'!`).join(`'${to}'!`).split(`${old}!`).join(`'${to}'!`).replace(/''/g, "'") };
    }));
    changed.push(`Đã đổi tên sheet “${old}” → “${to}”`);
  }
  for (const name of ops.delete_sheet ?? []) {
    const ws = find(name);
    if (wb.worksheets.length <= 1) throw new Error("Không thể xoá sheet duy nhất của tệp.");
    wb.removeWorksheet(ws.id);
    changed.push(`Đã xoá sheet “${name}” (công thức ở nơi khác tham chiếu sheet này sẽ báo lỗi #REF!)`);
  }
  const order = <T,>(a: T[], key: (x: T) => number) => [...a].sort((x, y) => key(y) - key(x));
  for (const d of order(ops.delete_rows ?? [], (x) => x.from)) {
    const ws = find(d.sheet);
    const from = rowArg(d.from, "delete_rows");
    const count = cnt(d.count, "delete_rows");
    ws.spliceRows(from, count);
    shiftWorkbook(wb, { axis: "row", at: from, count, kind: "delete", sheet: ws.name });
    changed.push(`${ws.name}: đã xoá ${count} hàng từ hàng ${from}`);
  }
  for (const d of order(ops.insert_rows ?? [], (x) => x.at)) {
    const ws = find(d.sheet);
    const at = rowArg(d.at, "insert_rows");
    const count = cnt(d.count, "insert_rows");
    ws.spliceRows(at, 0, ...Array.from({ length: count }, () => []));
    shiftWorkbook(wb, { axis: "row", at, count, kind: "insert", sheet: ws.name });
    changed.push(`${ws.name}: đã chèn ${count} hàng trống tại hàng ${at}`);
  }
  for (const d of order(ops.delete_columns ?? [], (x) => colArg(x.from, "delete_columns"))) {
    const ws = find(d.sheet);
    const from = colArg(d.from, "delete_columns");
    const count = cnt(d.count, "delete_columns");
    ws.spliceColumns(from, count);
    shiftWorkbook(wb, { axis: "col", at: from, count, kind: "delete", sheet: ws.name });
    changed.push(`${ws.name}: đã xoá ${count} cột từ cột ${colLetter(from)}`);
  }
  for (const d of order(ops.insert_columns ?? [], (x) => colArg(x.at, "insert_columns"))) {
    const ws = find(d.sheet);
    const at = colArg(d.at, "insert_columns");
    const count = cnt(d.count, "insert_columns");
    ws.spliceColumns(at, 0, ...Array.from({ length: count }, () => []));
    shiftWorkbook(wb, { axis: "col", at, count, kind: "insert", sheet: ws.name });
    changed.push(`${ws.name}: đã chèn ${count} cột trống tại cột ${colLetter(at)}`);
  }
  return changed;
}

/** Áp các thao tác định dạng/sắp xếp (SAU khi gán ô, để ô mới cũng được định dạng). */
export function applyFormatOps(wb: any, ops: XlsxOps, defaultSheet?: string): string[] {
  const changed: string[] = [];
  const find = (name?: string): any => {
    const n = name ?? defaultSheet;
    const ws = n ? wb.worksheets.find((w: any) => w.name.toLowerCase() === String(n).toLowerCase()) : wb.worksheets[0];
    if (!ws) throw new Error(`Không có sheet "${n}". Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
    return ws;
  };
  for (const c of ops.clear ?? []) {
    const ws = find(c.sheet);
    const b = parseBox(ws, c.range, "clear");
    for (let r = b.r1; r <= b.r2; r++) for (let col = b.c1; col <= b.c2; col++) ws.getCell(r, col).value = null;
    changed.push(`${ws.name}: đã xoá nội dung vùng ${c.range}`);
  }
  for (const s of ops.sort ?? []) {
    const ws = find(s.sheet);
    const b = s.range ? parseBox(ws, s.range, "sort") : { r1: 1, c1: 1, r2: Math.max(1, ws.rowCount), c2: Math.max(1, ws.columnCount) };
    const by = colArg(s.by, "sort");
    if (by < b.c1 || by > b.c2) throw new Error(`sort: cột ${s.by} nằm ngoài vùng sắp xếp.`);
    const first = b.r1 + (s.header === false ? 0 : 1);
    const rows: any[][] = [];
    for (let r = first; r <= b.r2; r++) {
      const line: any[] = [];
      for (let c = b.c1; c <= b.c2; c++) {
        const v = ws.getCell(r, c).value;
        if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) throw new Error("sort: vùng có công thức nên không sắp xếp được an toàn (công thức tham chiếu theo vị trí). Hãy đổi sang giá trị hoặc sắp xếp ở dữ liệu nguồn.");
        line.push(v);
      }
      rows.push(line);
    }
    const k = by - b.c1;
    const dir = s.order === "desc" ? -1 : 1;
    const sorted = rows.map((line, i) => ({ line, i })).sort((x, y) => (cmp(x.line[k], y.line[k]) || x.i - y.i) * (x.line[k] == null || x.line[k] === "" || y.line[k] == null || y.line[k] === "" ? 1 : dir)).map((x) => x.line);
    sorted.forEach((line, i) => line.forEach((v, j) => (ws.getCell(first + i, b.c1 + j).value = v)));
    changed.push(`${ws.name}: đã sắp xếp ${rows.length} hàng theo cột ${colLetter(by)} (${s.order === "desc" ? "giảm dần" : "tăng dần"})`);
  }
  for (const f of ops.format ?? []) {
    const ws = find(f.sheet);
    const b = parseBox(ws, f.range, "format");
    const fill = f.fill ? hexOf(f.fill, "format.fill") : null;
    const color = f.color ? hexOf(f.color, "format.color") : null;
    const thin = { style: "thin", color: { argb: "FF8C8C8C" } };
    for (let r = b.r1; r <= b.r2; r++) {
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = ws.getCell(r, c);
        if (f.bold !== undefined || f.italic !== undefined || f.underline !== undefined || color || f.font || f.size !== undefined)
          cell.font = {
            ...(cell.font ?? {}),
            ...(f.bold !== undefined ? { bold: f.bold } : {}),
            ...(f.italic !== undefined ? { italic: f.italic } : {}),
            ...(f.underline !== undefined ? { underline: f.underline } : {}),
            ...(color ? { color: { argb: argb(color) } } : {}),
            ...(f.font ? { name: f.font } : {}),
            ...(f.size !== undefined ? { size: Math.min(72, Math.max(6, f.size)) } : {}),
          };
        if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fill) } };
        if (f.align || f.valign || f.wrap !== undefined)
          cell.alignment = { ...(cell.alignment ?? {}), ...(f.align ? { horizontal: f.align } : {}), ...(f.valign ? { vertical: f.valign === "middle" ? "middle" : f.valign } : {}), ...(f.wrap !== undefined ? { wrapText: f.wrap } : {}) };
        if (f.number_format) cell.numFmt = f.number_format;
        if (f.border) {
          if (f.border === "none") cell.border = {};
          else {
            const cur = cell.border ?? {};
            const all = f.border === "all";
            cell.border = {
              ...cur,
              ...(all || f.border === "bottom" || (f.border === "outline" && r === b.r2) ? { bottom: thin } : {}),
              ...(all || f.border === "top" || (f.border === "outline" && r === b.r1) ? { top: thin } : {}),
              ...(all || (f.border === "outline" && c === b.c1) ? { left: thin } : {}),
              ...(all || (f.border === "outline" && c === b.c2) ? { right: thin } : {}),
            };
          }
        }
      }
    }
    if (f.width !== undefined) for (let c = b.c1; c <= b.c2; c++) ws.getColumn(c).width = Math.min(255, Math.max(2, f.width));
    if (f.height !== undefined) for (let r = b.r1; r <= b.r2; r++) ws.getRow(r).height = Math.min(409, Math.max(5, f.height));
    changed.push(`${ws.name}: đã định dạng vùng ${f.range}`);
  }
  for (const m of ops.merge ?? []) {
    const ws = find(m.sheet);
    parseBox(ws, m.range, "merge");
    ws.mergeCells(m.range);
    changed.push(`${ws.name}: đã gộp ô ${m.range}`);
  }
  for (const m of ops.unmerge ?? []) {
    const ws = find(m.sheet);
    parseBox(ws, m.range, "unmerge");
    ws.unMergeCells(m.range);
    changed.push(`${ws.name}: đã tách ô ${m.range}`);
  }
  if (ops.freeze) {
    const ws = find(ops.freeze.sheet);
    if (ops.freeze.cell === null) ws.views = [{ state: "normal" }];
    else {
      const b = parseBox(ws, ops.freeze.cell, "freeze");
      ws.views = [{ state: "frozen", xSplit: b.c1 - 1, ySplit: b.r1 - 1 }];
    }
    changed.push(`${ws.name}: ${ops.freeze.cell === null ? "đã bỏ cố định" : "đã cố định phía trên-trái " + ops.freeze.cell}`);
  }
  if (ops.autofilter) {
    const ws = find(ops.autofilter.sheet);
    if (ops.autofilter.range === null) ws.autoFilter = undefined;
    else {
      parseBox(ws, ops.autofilter.range, "autofilter");
      ws.autoFilter = ops.autofilter.range;
    }
    changed.push(`${ws.name}: ${ops.autofilter.range === null ? "đã tắt bộ lọc" : "đã bật bộ lọc " + ops.autofilter.range}`);
  }
  return changed;
}
