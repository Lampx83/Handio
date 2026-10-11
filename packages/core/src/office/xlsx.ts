/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadZip } from "./docx-read";
import { customFunctions } from "./formulas";

export type CellInput = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  /** Mảng các hàng; chuỗi bắt đầu bằng "=" là công thức (tên hàm tiếng Anh, phân tách bằng dấu phẩy). */
  rows: CellInput[][];
  /** Hàng đầu là tiêu đề (đậm, nền xanh nhạt). Mặc định true. */
  header?: boolean;
  /** Độ rộng cột (ký tự); bỏ trống thì tự co theo nội dung. */
  widths?: number[];
  freeze_header?: boolean;
  autofilter?: boolean;
  /** Định dạng số theo cột, vd {"C": "#,##0", "D": "0.0%"}. */
  number_formats?: Record<string, string>;
  /** Tô màu theo điều kiện: thanh dữ liệu, thang màu, hoặc tô ô theo ngưỡng. */
  conditional?: ConditionalSpec[];
}

export interface ConditionalSpec {
  /** Vùng áp dụng, vd "D2:D30". */
  range: string;
  /** "bars" thanh dữ liệu · "scale" thang 2 màu · hoặc ngưỡng: ô thoả điều kiện được tô màu. */
  rule: "bars" | "scale" | { op: "lt" | "le" | "gt" | "ge" | "eq" | "ne"; value: number; color?: "red" | "green" | "yellow" };
}

export interface FormulaReport {
  cell: string;
  formula: string;
  value: string;
}
export interface BuildReport {
  formulas: FormulaReport[];
  unverified: string[];
  errors: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const colLetter = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const colIndex = (l: string): number => l.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const cellAddress = (row: number, col: number): string => colLetter(col) + row;

export function parseAddress(a: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a.trim());
  return m ? { row: +m[2], col: colIndex(m[1]) } : null;
}

async function excel(): Promise<any> {
  const mod: any = await import("exceljs");
  return mod.default ?? mod;
}
async function formulaParser(): Promise<any> {
  const mod: any = await import("fast-formula-parser");
  return mod.default ?? mod;
}
const toBytes = (b: any): Uint8Array => (b instanceof Uint8Array ? new Uint8Array(b) : new Uint8Array(b as ArrayBuffer));
const safeSheetName = (n: string, i: number): string => (String(n || "").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`);

type Grid = Map<string, unknown[][]>;

/** Tính công thức Excel thông dụng bằng fast-formula-parser (không có thì báo "chưa kiểm được"). */
class Evaluator {
  private parser: any;
  private cache = new Map<string, unknown>();
  private visiting = new Set<string>();
  private FormulaError: any;
  unsupported = new Set<string>();
  constructor(private grid: Grid, FP: any) {
    this.FormulaError = FP.FormulaError;
    this.parser = new FP({
      functions: customFunctions(FP),
      onCell: ({ sheet, row, col }: any) => this.value(sheet, row, col),
      onRange: (ref: any) => {
        const out: unknown[][] = [];
        for (let r = ref.from.row; r <= ref.to.row; r++) {
          const line: unknown[] = [];
          for (let c = ref.from.col; c <= ref.to.col; c++) line.push(this.value(ref.sheet, r, c));
          out.push(line);
        }
        return out;
      },
    });
  }
  private value(sheet: string, row: number, col: number): unknown {
    const raw = this.grid.get(sheet)?.[row - 1]?.[col - 1];
    if (typeof raw === "string" && raw.startsWith("=") && raw.length > 1) return this.cell(sheet, row, col, raw.slice(1));
    return raw === undefined ? null : raw;
  }
  cell(sheet: string, row: number, col: number, formula: string): unknown {
    const key = `${sheet}!${row},${col}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.visiting.has(key)) return new this.FormulaError("#REF!", "Tham chiếu vòng");
    this.visiting.add(key);
    let res: unknown;
    try {
      res = this.parser.parse(formula, { sheet, row, col });
      if (Array.isArray(res)) res = res[0]?.[0] ?? null;
    } catch (e) {
      const msg = String((e as Error).message || e);
      const fn = /Function (\w+) is not implemented/.exec(msg)?.[1];
      if (fn) this.unsupported.add(fn);
      res = Object.assign(new this.FormulaError("#NAME?", msg), { unverified: true });
    }
    this.visiting.delete(key);
    this.cache.set(key, res);
    return res;
  }
  isError(v: unknown): boolean {
    return !!v && typeof v === "object" && "error" in (v as object) && this.FormulaError && v instanceof this.FormulaError;
  }
}

const fmtValue = (v: unknown, ev: Evaluator): string => (ev.isError(v) ? String((v as any).error) : v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1e9) / 1e9) : String(v));

/** Tính mọi công thức trong lưới và ghi kết quả (cache) vào ô ExcelJS; trả báo cáo để agent kiểm tra số liệu. */
async function recalc(wb: any, grid: Grid): Promise<BuildReport> {
  const FP = await formulaParser();
  const ev = new Evaluator(grid, FP);
  const report: BuildReport = { formulas: [], unverified: [], errors: [] };
  let n = 0;
  for (const ws of wb.worksheets) {
    const rows = grid.get(ws.name) ?? [];
    rows.forEach((line, r) =>
      line.forEach((raw, c) => {
        if (typeof raw !== "string" || !raw.startsWith("=") || raw.length < 2 || n++ > 50000) return;
        const v = ev.cell(ws.name, r + 1, c + 1, raw.slice(1));
        const addr = `${rows.length && grid.size > 1 ? ws.name + "!" : ""}${cellAddress(r + 1, c + 1)}`;
        const cell = ws.getCell(r + 1, c + 1);
        if (ev.isError(v)) {
          if ((v as any).unverified) report.unverified.push(`${addr} (${raw})`);
          else report.errors.push(`${addr} ${raw} → ${(v as any).error}`);
          cell.value = { formula: raw.slice(1) };
        } else {
          cell.value = { formula: raw.slice(1), result: v === null ? 0 : (v as any) };
          if (report.formulas.length < 40) report.formulas.push({ cell: addr, formula: raw, value: fmtValue(v, ev) });
        }
      }),
    );
  }
  if (ev.unsupported.size) report.unverified.push(`(hàm chưa kiểm được: ${[...ev.unsupported].join(", ")})`);
  return report;
}


const CF_COLORS = { red: ["FFFFC7CE", "FF9C0006"], green: ["FFC6EFCE", "FF006100"], yellow: ["FFFFEB9C", "FF9C5700"] } as const;
const CF_OPS = { lt: "lessThan", le: "lessThanOrEqual", gt: "greaterThan", ge: "greaterThanOrEqual", eq: "equal", ne: "notEqual" } as const;

/** Tô màu theo điều kiện (ExcelJS không hỗ trợ biểu đồ, nhưng hỗ trợ định dạng có điều kiện). Bỏ qua vùng không hợp lệ. */
function addConditional(ws: any, specs: ConditionalSpec[] | undefined): void {
  for (const c of (specs ?? []).slice(0, 10)) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(c?.range ?? "").trim());
    if (!m) continue;
    const ref = `${m[1].toUpperCase()}${m[2]}:${m[3].toUpperCase()}${m[4]}`;
    let rule: any;
    if (c.rule === "bars") rule = { type: "dataBar", gradient: false, showValue: true, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF638EC6" } };
    else if (c.rule === "scale") rule = { type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: "FFFCFCFF" }, { argb: "FF63BE7B" }] };
    else if (c.rule && typeof c.rule === "object" && c.rule.op in CF_OPS && Number.isFinite(c.rule.value)) {
      const [bg, fg] = CF_COLORS[c.rule.color && c.rule.color in CF_COLORS ? c.rule.color : "red"];
      rule = { type: "cellIs", operator: CF_OPS[c.rule.op], formulae: [c.rule.value], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: bg } }, font: { color: { argb: fg } } } };
    } else continue;
    ws.addConditionalFormatting({ ref, rules: [{ ...rule, priority: 1 }] });
  }
}

/** Kẻ viền, tô đậm hàng tiêu đề, định dạng số, độ rộng cột, cố định hàng đầu, lọc, tô màu điều kiện. */
function styleSheet(ws: any, spec: Pick<SheetSpec, "widths" | "freeze_header" | "autofilter" | "number_formats" | "conditional">, rows: CellInput[][], cols: number, header: boolean): void {
  const border = { top: { style: "thin", color: { argb: "FFBFBFBF" } }, bottom: { style: "thin", color: { argb: "FFBFBFBF" } }, left: { style: "thin", color: { argb: "FFBFBFBF" } }, right: { style: "thin", color: { argb: "FFBFBFBF" } } };
  rows.forEach((line, r) => line.forEach((_v, c) => (ws.getCell(r + 1, c + 1).border = border)));
  if (header) {
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(1, c);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
  }
  for (const [letter, fmt] of Object.entries(spec.number_formats ?? {})) {
    const c = colIndex(letter);
    if (c) for (let r = header ? 2 : 1; r <= rows.length; r++) ws.getCell(r, c).numFmt = fmt;
  }
  for (let c = 1; c <= cols; c++) {
    const w = spec.widths?.[c - 1];
    const auto = Math.min(60, Math.max(8, ...rows.map((r) => (typeof r[c - 1] === "string" && !String(r[c - 1]).startsWith("=") ? [...String(r[c - 1])].length : 10)))) + 2;
    ws.getColumn(c).width = w ?? auto;
  }
  if (spec.freeze_header !== false && header) ws.views = [{ state: "frozen", ySplit: 1 }];
  if (spec.autofilter && rows.length > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length, column: cols } };
  addConditional(ws, spec.conditional);
}

export async function createXlsx(sheets: SheetSpec[]): Promise<{ bytes: Uint8Array; report: BuildReport; dims: string[] }> {
  if (!sheets.length) throw new Error("Cần ít nhất một sheet.");
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hando";
  wb.created = new Date();
  const grid: Grid = new Map();
  const dims: string[] = [];
  const used = new Set<string>();
  sheets.forEach((spec, si) => {
    let name = safeSheetName(spec.name, si);
    while (used.has(name.toLowerCase())) name = (name.slice(0, 28) + "_" + (si + 1)).slice(0, 31);
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    const rows = spec.rows ?? [];
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const header = spec.header !== false && rows.length > 0;
    const g: unknown[][] = [];
    rows.forEach((line, r) => {
      const gl: unknown[] = [];
      line.forEach((raw, c) => {
        const cell = ws.getCell(r + 1, c + 1);
        let v: unknown = raw;
        if (typeof raw === "string" && ISO_DATE.test(raw)) {
          const dt = new Date(raw + "T00:00:00Z");
          if (!isNaN(+dt)) {
            cell.value = dt;
            cell.numFmt = "dd/mm/yyyy";
            gl.push(Math.round(+dt / 86400000) + 25569);
            return;
          }
        }
        if (typeof raw === "string" && raw.startsWith("=") && raw.length > 1) cell.value = { formula: raw.slice(1) };
        else if (raw !== null && raw !== undefined) cell.value = raw;
        if (typeof raw === "string" && raw.startsWith("'")) {
          cell.value = raw.slice(1);
          v = raw.slice(1);
        }
        gl.push(v);
      });
      g.push(gl);
    });
    grid.set(name, g);
    styleSheet(ws, spec, rows, cols, header);
    dims.push(`${name}: ${rows.length} hàng × ${cols} cột`);
  });
  const report = await recalc(wb, grid);
  wb.calcProperties = { fullCalcOnLoad: true };
  return { bytes: toBytes(await wb.xlsx.writeBuffer()), report, dims };
}

// ---------------------------------------------------------------- đọc

function plain(v: any): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t: any) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) return plain(v.result);
    if ("hyperlink" in v) return v.text ?? v.hyperlink;
    if ("error" in v) return String(v.error);
    if ("text" in v) return v.text;
  }
  return v;
}
const fmtDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${base} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : base;
};
const show = (v: unknown): string => (v instanceof Date ? fmtDate(v) : typeof v === "number" ? String(Math.round(v * 1e9) / 1e9) : String(v ?? "")).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ⏎ ");

export interface SheetText {
  name: string;
  summary: string;
  text: string;
}

export async function readXlsx(bytes: Uint8Array, opts: { sheet?: string; range?: string; maxRows?: number; maxCols?: number } = {}): Promise<SheetText[]> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await loadZip(bytes); // chặn zip bomb trước khi ExcelJS giải nén
    await wb.xlsx.load(bytes);
  } catch (e) {
    if (/quá lớn/.test((e as Error).message)) throw e;
    throw new Error("Không mở được file Excel (hỏng, có mật khẩu, hoặc là định dạng .xls cũ — hãy lưu lại thành .xlsx).");
  }
  const out: SheetText[] = [];
  const want = opts.sheet?.toLowerCase();
  for (const [idx, ws] of wb.worksheets.entries()) {
    if (want && ws.name.toLowerCase() !== want && String(idx + 1) !== want) continue;
    const lastRow = ws.rowCount || 0;
    const lastCol = ws.columnCount || 0;
    let r1 = 1, c1 = 1, r2 = lastRow, c2 = lastCol;
    if (opts.range) {
      const [a, b] = opts.range.split(":");
      const pa = parseAddress(a);
      const pb = parseAddress(b ?? a);
      if (pa && pb) [r1, c1, r2, c2] = [Math.min(pa.row, pb.row), Math.min(pa.col, pb.col), Math.max(pa.row, pb.row), Math.max(pa.col, pb.col)];
    }
    const maxRows = opts.maxRows ?? 100;
    const maxCols = opts.maxCols ?? 26;
    const rEnd = Math.min(r2, r1 + maxRows - 1);
    const cEnd = Math.min(c2, c1 + maxCols - 1);
    const lines: string[] = [];
    if (lastRow && lastCol) {
      lines.push("    | " + Array.from({ length: cEnd - c1 + 1 }, (_, i) => colLetter(c1 + i)).join(" | "));
      for (let r = r1; r <= rEnd; r++) {
        const row = ws.getRow(r);
        const cells = Array.from({ length: cEnd - c1 + 1 }, (_, i) => {
          const cell = row.getCell(c1 + i);
          const v: any = cell.value;
          const base = show(plain(v));
          return v && typeof v === "object" && ("formula" in v || "sharedFormula" in v) ? `${base} [=${v.formula ?? v.sharedFormula}]` : base;
        });
        if (cells.some((c) => c !== "")) lines.push(String(r).padStart(3) + " | " + cells.join(" | "));
      }
    }
    const merged = Object.keys(ws.model?.merges ?? {}).length || (ws.model?.merges?.length ?? 0);
    const more: string[] = [];
    if (rEnd < r2) more.push(`còn ${r2 - rEnd} hàng nữa (đọc tiếp bằng range "A${rEnd + 1}:${colLetter(c2)}${r2}")`);
    if (cEnd < c2) more.push(`còn ${c2 - cEnd} cột nữa (cột ${colLetter(cEnd + 1)}–${colLetter(c2)})`);
    out.push({
      name: ws.name,
      summary: `${lastRow} hàng × ${lastCol} cột${merged ? `, ${merged} vùng gộp ô` : ""}${ws.state && ws.state !== "visible" ? ", đang ẩn" : ""}`,
      text: (lines.length ? lines.join("\n") : "(sheet trống)") + (more.length ? "\n… " + more.join("; ") : ""),
    });
  }
  if (!out.length && want) throw new Error(`Không có sheet "${opts.sheet}". Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
  return out;
}

// ---------------------------------------------------------------- sửa

export interface XlsxEdit {
  /** Sheet mặc định cho `set`/`append_rows` (mặc định sheet đầu). */
  sheet?: string;
  /** Gán ô: {"B2": 10, "C2": "=B2*2", "Điểm!D5": "Đạt", "E1": null}. */
  set?: Record<string, CellInput>;
  /** Thêm hàng vào cuối sheet. */
  append_rows?: CellInput[][];
  /** Thêm sheet mới (có thể kèm tiêu đề đậm, định dạng số, tô màu điều kiện như create_xlsx). */
  add_sheet?: { name: string; rows: CellInput[][] } & Partial<Pick<SheetSpec, "header" | "widths" | "freeze_header" | "autofilter" | "number_formats" | "conditional">>;
}

export async function editXlsx(bytes: Uint8Array, e: XlsxEdit): Promise<{ bytes: Uint8Array; changed: string[]; report: BuildReport }> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await loadZip(bytes);
    await wb.xlsx.load(bytes);
  } catch (e) {
    if (/quá lớn/.test((e as Error).message)) throw e;
    throw new Error("Không mở được file Excel (hỏng hoặc có mật khẩu).");
  }
  const findSheet = (name?: string) => {
    const ws = name ? wb.worksheets.find((w: any) => w.name.toLowerCase() === name.toLowerCase()) : wb.worksheets[0];
    if (!ws) throw new Error(`Không có sheet "${name}". Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
    return ws;
  };
  const apply = (ws: any, row: number, col: number, raw: CellInput) => {
    const cell = ws.getCell(row, col);
    if (raw === null) cell.value = null;
    else if (typeof raw === "string" && raw.startsWith("'")) cell.value = raw.slice(1); // 'chữ: ép thành chữ (không phải công thức)
    else if (typeof raw === "string" && ISO_DATE.test(raw)) {
      cell.value = new Date(raw + "T00:00:00Z");
      cell.numFmt = "dd/mm/yyyy";
    } else if (typeof raw === "string" && raw.startsWith("=") && raw.length > 1) cell.value = { formula: raw.slice(1) };
    else cell.value = raw;
  };
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(e.set ?? {})) {
    const bang = key.lastIndexOf("!");
    const ws = findSheet(bang >= 0 ? key.slice(0, bang).replace(/^'|'$/g, "") : e.sheet);
    const addr = parseAddress(bang >= 0 ? key.slice(bang + 1) : key);
    if (!addr) throw new Error(`Địa chỉ ô không hợp lệ: "${key}" (ví dụ "B2").`);
    apply(ws, addr.row, addr.col, raw);
    changed.push(`${ws.name}!${cellAddress(addr.row, addr.col)}`);
  }
  if (e.append_rows?.length) {
    const ws = findSheet(e.sheet);
    let r = (ws.rowCount || 0) + 1;
    for (const line of e.append_rows) {
      line.forEach((v, c) => apply(ws, r, c + 1, v));
      changed.push(`${ws.name}!A${r}:${colLetter(Math.max(1, line.length))}${r}`);
      r++;
    }
  }
  if (e.add_sheet) {
    const ws = wb.addWorksheet(safeSheetName(e.add_sheet.name, wb.worksheets.length));
    e.add_sheet.rows.forEach((line, r) => line.forEach((v, c) => apply(ws, r + 1, c + 1, v)));
    const sp = e.add_sheet;
    if (sp.header !== undefined || sp.widths || sp.number_formats || sp.conditional || sp.autofilter || sp.freeze_header !== undefined)
      styleSheet(ws, sp, sp.rows, Math.max(1, ...sp.rows.map((r) => r.length)), sp.header !== false && sp.rows.length > 0);
    changed.push(`(sheet mới) ${ws.name}`);
  }
  // dựng lưới để tính lại mọi công thức
  const grid: Grid = new Map();
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row: any, r: number) => {
      const line: unknown[] = (rows[r - 1] = []);
      row.eachCell({ includeEmpty: false }, (cell: any, c: number) => {
        const v = cell.value;
        line[c - 1] = v && typeof v === "object" && ("formula" in v || "sharedFormula" in v) ? "=" + (v.formula ?? cell.formula ?? "") : v instanceof Date ? Math.round(+v / 86400000) + 25569 : plain(v);
      });
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    grid.set(ws.name, rows);
  }
  const report = await recalc(wb, grid);
  wb.calcProperties = { fullCalcOnLoad: true };
  return { bytes: toBytes(await wb.xlsx.writeBuffer()), changed, report };
}

export function describeXlsx(sheets: SheetSpec[]): string {
  return sheets.map((s) => `Sheet “${s.name}”: ${s.rows.length} hàng × ${Math.max(0, ...s.rows.map((r) => r.length))} cột, ${s.rows.flat().filter((c) => typeof c === "string" && c.startsWith("=")).length} công thức${s.rows[0] ? " — tiêu đề: " + s.rows[0].slice(0, 8).join(", ") : ""}`).join("\n");
}

// ---------------------------------------------------------------- lưới ô có cấu trúc (xem trước, tìm kiếm, quét dữ liệu cá nhân, tổng hợp)

export interface GridRow {
  /** Số hàng trong sheet (từ 1). */
  r: number;
  /** Giá trị hiển thị của từng ô, bắt đầu từ cột `c1`. */
  cells: string[];
}
export interface SheetGrid {
  name: string;
  /** Chữ cái các cột hiển thị. */
  cols: string[];
  c1: number;
  rows: GridRow[];
  lastRow: number;
  lastCol: number;
  truncated: boolean;
}

export const colName = colLetter;
export const colNumber = colIndex;

/** Giá trị ô dạng chữ như người dùng thấy: ngày dd/mm/yyyy, số nguyên không dấu thập phân thừa; không kèm công thức. */
export function cellDisplay(v: any): string {
  const x = plain(v);
  return x instanceof Date ? fmtDate(x) : typeof x === "number" ? String(Math.round(x * 1e9) / 1e9) : String(x ?? "");
}

/** Đọc các sheet thành lưới ô (giới hạn số hàng/cột/ô để an toàn bộ nhớ). `aroundRow`: nếu hàng đó nằm ngoài giới hạn thì mở cửa sổ quanh nó. */
export async function readXlsxGrid(bytes: Uint8Array, opts: { sheet?: string; maxRows?: number; maxCols?: number; maxCells?: number; aroundRow?: number } = {}): Promise<SheetGrid[]> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await loadZip(bytes);
    await wb.xlsx.load(bytes);
  } catch (e) {
    if (/quá lớn/.test((e as Error).message)) throw e;
    throw new Error("Không mở được file Excel (hỏng, có mật khẩu, hoặc là định dạng .xls cũ — hãy lưu lại thành .xlsx).");
  }
  const want = opts.sheet?.toLowerCase();
  const maxRows = opts.maxRows ?? 300;
  const maxCols = opts.maxCols ?? 26;
  let budget = opts.maxCells ?? 250_000;
  const out: SheetGrid[] = [];
  for (const [idx, ws] of wb.worksheets.entries()) {
    if (want && ws.name.toLowerCase() !== want && String(idx + 1) !== want) continue;
    const lastRow = ws.rowCount || 0;
    const lastCol = ws.columnCount || 0;
    const cEnd = Math.min(lastCol, maxCols);
    let r1 = 1;
    if (opts.aroundRow && opts.aroundRow > maxRows && opts.aroundRow <= lastRow) r1 = Math.max(1, opts.aroundRow - Math.floor(maxRows / 2));
    const rEnd = Math.min(lastRow, r1 + maxRows - 1, r1 - 1 + Math.max(0, Math.floor(budget / Math.max(1, cEnd))));
    const rows: GridRow[] = [];
    for (let r = r1; r <= rEnd; r++) {
      const row = ws.getRow(r);
      const cells = Array.from({ length: cEnd }, (_, i) => cellDisplay(row.getCell(i + 1).value));
      budget -= cEnd;
      if (cells.some((c) => c !== "")) rows.push({ r, cells });
    }
    out.push({ name: ws.name, cols: Array.from({ length: cEnd }, (_, i) => colLetter(i + 1)), c1: 1, rows, lastRow, lastCol, truncated: r1 > 1 || rEnd < lastRow || cEnd < lastCol });
  }
  if (!out.length && want) throw new Error(`Không có sheet "${opts.sheet}". Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
  return out;
}

/** Số hàng đang dùng của một sheet (mặc định sheet đầu): để công thức sinh tự động trỏ đúng hàng khi nối thêm. */
export async function sheetRowCount(bytes: Uint8Array, sheet?: string): Promise<number> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = sheet ? wb.worksheets.find((w: { name: string }) => w.name.toLowerCase() === sheet.toLowerCase()) : wb.worksheets[0];
  return ws?.rowCount ?? 0;
}
