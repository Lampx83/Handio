/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandName } from "../brand";
import { loadZip } from "./docx-read";
import { customFunctions } from "./formulas";
import { colorHex } from "./colors";
import { pickTheme } from "./pptx";
import { extractCharts, injectCharts, planCharts, type ChartRequest, type UsedMap } from "./xlsx-charts";

export type CellInput = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  /** Mảng các hàng; chuỗi bắt đầu bằng "=" là công thức (tên hàm tiếng Anh, phân tách bằng dấu phẩy). */
  rows: CellInput[][];
  /** Hàng đầu là tiêu đề (đậm, chữ trắng trên nền xanh đậm). Mặc định true. */
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
const safeSheetName = (n: string, i: number): string => (String(n || "").replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || `Sheet${i + 1}`);

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

// ---------------------------------------------------------------- giao diện (bảng màu, định dạng)

export interface XlsxLook {
  /** Nền hàng tiêu đề, đường viền hàng Tổng. */
  main: string;
  /** Màu nhấn: chuỗi số liệu đầu của biểu đồ, màu thẻ sheet. */
  accent: string;
  /** Nền hàng so le. */
  band: string;
  /** Nền hàng Tổng. */
  total: string;
  /** Đường kẻ ngang. */
  line: string;
  /** Bảng màu biểu đồ. */
  palette: string[];
}

const LOOKS: Record<string, [string, string]> = {
  xanh: ["1F4E79", "2F5597"],
  ngoc: ["0B5F59", "0F766E"],
  xanhla: ["1E5E21", "2F7D32"],
  cam: ["9A3412", "D9480F"],
  tim: ["3F2589", "5B34B8"],
  do: ["8E1B12", "B42318"],
  den: ["1F2937", "4B5563"],
};
const CHART_BASE = ["2F5597", "ED7D31", "70AD47", "5B9BD5", "BF9000", "7030A0", "C00000", "A5A5A5"];

/** Trộn màu hex với trắng (amt 0..1: càng lớn càng nhạt). */
function mixWhite(hex: string, amt: number): string {
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * amt).toString(16).padStart(2, "0");
  });
  return ch.join("").toUpperCase();
}

/** Bảng màu cho sổ Excel: `theme` (xanh mặc định, ngoc, xanhla, cam, tim, do, den) hoặc `accent` (màu hex/tên màu). */
export function xlsxLook(theme?: string, accent?: string): { look: XlsxLook; note?: string } {
  const picked = pickTheme(theme);
  let [main, acc] = LOOKS[picked.key] ?? LOOKS.xanh;
  let note: string | undefined;
  if (theme && !picked.known) note = `Chủ đề “${theme}” không có; đã dùng “xanh”. Chủ đề có sẵn: ${Object.keys(LOOKS).join(", ")}.`;
  if (accent) {
    const hex = colorHex(accent);
    if (hex) {
      main = hex;
      acc = hex;
    } else note = `Màu “${accent}” không hiểu được; đã dùng chủ đề mặc định.`;
  }
  return { look: { main, accent: acc, band: mixWhite(acc, 0.94), total: mixWhite(acc, 0.82), line: "D9D9D9", palette: [acc, ...CHART_BASE.filter((c) => c !== acc)] }, note };
}

const PCT_TEXT = /^\s*(-?\d+(?:[.,]\d+)?)\s*%\s*$/;

/** Cột toàn chuỗi dạng "85%" / "12,5%" → số thật (0.85) kèm định dạng phần trăm; các cột khác giữ nguyên. */
function normalizePercent(rows: CellInput[][], header: boolean): { rows: CellInput[][]; pct: Map<number, string> } {
  const pct = new Map<number, string>();
  const cols = Math.max(0, ...rows.map((r) => r.length));
  let out = rows;
  for (let c = 0; c < cols; c++) {
    let n = 0;
    let ok = true;
    let whole = true;
    for (let r = header ? 1 : 0; r < rows.length && ok; r++) {
      const v = rows[r][c];
      if (v === null || v === undefined || v === "") continue;
      const m = typeof v === "string" ? PCT_TEXT.exec(v) : null;
      if (!m) ok = false;
      else {
        n++;
        if (!Number.isInteger(+m[1].replace(",", "."))) whole = false;
      }
    }
    if (!ok || !n) continue;
    if (out === rows) out = rows.map((r) => r.slice());
    for (let r = header ? 1 : 0; r < out.length; r++) {
      const v = out[r][c];
      const m = typeof v === "string" ? PCT_TEXT.exec(v) : null;
      if (m) out[r][c] = Math.round(+m[1].replace(",", ".") * 1e8) / 1e10;
    }
    pct.set(c + 1, whole ? "0%" : "0.0%");
  }
  return { rows: out, pct };
}

const TOTAL_LABEL = /^(tổng|tong|total|cộng|cong|grand total|sum|trung bình|trung binh|average|tb)\b/i;
const COLUMN_SUM = /^=\s*(?:SUM|SUBTOTAL|AVERAGE)\(\s*(?:\d+\s*,\s*)?\$?([A-Za-z]{1,3})\$?(\d+)\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*\)/i;

/** Hàng "Tổng" ở cuối bảng (1 = hàng đầu); 0 nếu không có. Nhận ra nhãn "Tổng"/"Total"… hoặc công thức SUM theo cột. */
function detectTotal(rows: CellInput[][], header: boolean): number {
  const n = rows.length;
  if (n < (header ? 3 : 2)) return 0;
  const last = rows[n - 1] ?? [];
  const nonEmpty = last.filter((v) => v !== null && v !== undefined && v !== "");
  if (!nonEmpty.length) return 0;
  const first = nonEmpty[0];
  if (typeof first === "string" && !first.startsWith("=") && first.trim().length <= 25 && TOTAL_LABEL.test(first.trim()) && nonEmpty.length > 1) return n;
  const labelCell = last[0];
  const labelOk = labelCell === null || labelCell === undefined || labelCell === "" || (typeof labelCell === "string" && !labelCell.startsWith("="));
  if (labelOk && last.some((v) => {
    const m = typeof v === "string" ? COLUMN_SUM.exec(v) : null;
    return !!m && m[1].toUpperCase() === m[3].toUpperCase() && +m[2] !== +m[4];
  })) return n;
  return 0;
}

const ID_HEADER = /^(stt|tt|mã|ma\b|id\b|mssv|msv|năm|nam\b|year|sđt|sdt|điện thoại|dien thoai|phone|cccd|cmnd|số hiệu|so hieu|khóa|khoá|khoa\b|lớp|lop\b)/i;
const RATIO_HEADER = /tỷ lệ|tỉ lệ|tỷ trọng|tỉ trọng|phần trăm|percent|ratio|\brate\b/i;
const decimalsOf = (fmt: string | undefined): number => (fmt && /\.(0+)/.exec(fmt)?.[1].length) || 0;

/** Chiều rộng (ký tự) của giá trị khi hiển thị. */
function shownLen(v: unknown, fmt: string | undefined): number {
  if (v instanceof Date) return 10;
  if (typeof v === "number") {
    if (fmt?.includes("%")) return String((Math.abs(v) * 100).toFixed(decimalsOf(fmt))).length + 2;
    const dec = fmt ? decimalsOf(fmt) : Math.min(6, (String(v).split(".")[1] ?? "").length);
    const int = String(Math.floor(Math.abs(v))).length;
    return int + (fmt?.includes(",") ? Math.floor((int - 1) / 3) : 0) + (dec ? dec + 1 : 0) + (v < 0 ? 1 : 0);
  }
  return Math.max(0, ...String(v ?? "").split("\n").map((s) => [...s].length));
}

/** Định dạng đẹp mặc định: tiêu đề đậm nền xanh, hàng so le, kẻ ngang mảnh, hàng Tổng, định dạng số/ngày/%, độ rộng, đóng băng, lọc, in ngang. */
function styleSheet(ws: any, spec: Pick<SheetSpec, "widths" | "freeze_header" | "autofilter" | "number_formats" | "conditional">, rows: CellInput[][], cols: number, header: boolean, look: XlsxLook, pct: Map<number, string> = new Map()): void {
  const n = rows.length;
  if (!n) return;
  const argb = (hex: string) => ({ argb: "FF" + hex });
  const val = (r: number, c: number): unknown => plain(ws.getCell(r, c).value);
  const rowEmpty: boolean[] = [];
  let tables = 0;
  let prevEmpty = true;
  for (let r = 1; r <= n; r++) {
    let empty = true;
    for (let c = 1; c <= cols && empty; c++) if (val(r, c) !== "") empty = false;
    rowEmpty[r] = empty;
    if (!empty && prevEmpty) tables++;
    prevEmpty = empty;
  }
  const total = detectTotal(rows, header);
  const firstData = header ? 2 : 1;
  const lastData = total ? total - 1 : n;
  const userFmt = spec.number_formats ?? {};

  // loại và định dạng từng cột
  const kind: ("number" | "date" | "text")[] = [];
  const fmts: (string | undefined)[] = [];
  const center: boolean[] = [];
  for (let c = 1; c <= cols; c++) {
    const vals: unknown[] = [];
    for (let r = firstData; r <= lastData; r++) {
      const v = val(r, c);
      if (v !== "") vals.push(v);
    }
    const k = vals.length && vals.every((v) => v instanceof Date) ? "date" : vals.length && vals.every((v) => typeof v === "number" && Number.isFinite(v)) ? "number" : "text";
    kind[c] = k;
    const head = header ? String(val(1, c)) : "";
    let fmt: string | undefined;
    if (k === "number") {
      const nums = vals as number[];
      if (pct.has(c)) fmt = pct.get(c);
      else if (RATIO_HEADER.test(head) && !head.includes("%") && nums.every((v) => v >= 0 && v <= 1)) fmt = "0.0%";
      else if (ID_HEADER.test(head.trim())) {
        fmt = undefined;
        center[c] = true;
      } else if (nums.every((v) => Number.isInteger(v))) fmt = "#,##0";
      else fmt = nums.every((v) => Math.abs(Math.round(v * 10) / 10 - v) < 1e-9) ? "#,##0.0" : "#,##0.00";
    }
    fmts[c] = fmt;
  }
  const letters = Object.keys(userFmt).map((l) => colNumber(l));

  // độ rộng cột
  const widths: number[] = [];
  const headerFits: boolean[] = [];
  const filterDefault = header && lastData - firstData >= 1 && tables <= 1;
  const filter = spec.autofilter ?? filterDefault;
  for (let c = 1; c <= cols; c++) {
    let w = 0;
    for (let r = firstData; r <= n; r++) {
      const v = val(r, c);
      if (v !== "") w = Math.max(w, shownLen(v, userFmt[colName(c)] ?? fmts[c]));
    }
    const headLen = header ? Math.min(32, Math.ceil(shownLen(val(1, c), undefined) * 1.15) + (filter ? 2 : 0)) : 0;
    const auto = Math.min(60, Math.max(10, w + 2, headLen + 2));
    widths[c] = spec.widths?.[c - 1] ?? auto;
    headerFits[c] = !header || shownLen(val(1, c), undefined) * 1.15 + 2 <= widths[c];
    ws.getColumn(c).width = widths[c];
  }

  const hair = { style: "thin", color: argb(look.line) };
  for (let r = 1; r <= n; r++) {
    if (rowEmpty[r]) continue;
    const isHead = header && r === 1;
    const isTotal = r === total;
    const band = !isHead && !isTotal && (r - firstData) % 2 === 1 && lastData - firstData >= 2;
    let wrapped = false;
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      if (isHead) {
        cell.font = { name: "Calibri", size: 11, bold: true, color: argb("FFFFFF") };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: argb(look.main) };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = { bottom: { style: "thin", color: argb(look.main) } };
        continue;
      }
      const v = val(r, c);
      const k = kind[c];
      const horizontal = center[c] || k === "date" ? "center" : k === "number" ? "right" : "left";
      const wrap = typeof v === "string" && [...v].length > widths[c];
      const h = k === "text" && typeof v === "number" ? "right" : horizontal;
      cell.alignment = { vertical: "middle", horizontal: h, wrapText: wrap, ...(h !== "center" ? { indent: 1 } : {}) };
      if (wrap) wrapped = true;
      if (typeof v === "number" && !cell.numFmt && fmts[c] && !letters.includes(c)) cell.numFmt = fmts[c];
      if (isTotal) {
        cell.font = { name: "Calibri", size: 11, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: argb(look.total) };
        cell.border = { top: { style: "medium", color: argb(look.main) }, bottom: { style: "thin", color: argb(look.main) } };
      } else {
        if (band) cell.fill = { type: "pattern", pattern: "solid", fgColor: argb(look.band) };
        cell.border = { bottom: hair };
      }
    }
    if (!isHead && !wrapped) ws.getRow(r).height = 20;
  }
  if (header && headerFits.slice(1).every(Boolean)) ws.getRow(1).height = 26;
  for (const [letter, fmt] of Object.entries(userFmt)) {
    const c = colNumber(letter);
    if (c) for (let r = firstData; r <= n; r++) ws.getCell(r, c).numFmt = fmt;
  }

  const gridOff = tables <= 1;
  const frozen = spec.freeze_header !== false && header;
  ws.views = [frozen ? { state: "frozen", ySplit: 1, showGridLines: !gridOff } : { showGridLines: !gridOff }];
  if (filter && n > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, lastData), column: cols } };
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }, ...(header ? { printTitlesRow: "1:1" } : {}) };
  ws.headerFooter = { oddFooter: "&CTrang &P / &N" };
  ws.properties.tabColor = argb(look.accent);
  addConditional(ws, spec.conditional);
}

export interface XlsxOptions {
  /** Biểu đồ thật chèn vào sổ (xem ChartRequest). */
  charts?: ChartRequest[];
  /** Chủ đề màu: xanh (mặc định), ngoc, xanhla, cam, tim, do, den. */
  theme?: string;
  /** Màu nhấn tuỳ ý (hex hoặc tên màu), thay cho chủ đề. */
  accent?: string;
}

export async function createXlsx(sheets: SheetSpec[], opts: XlsxOptions = {}): Promise<{ bytes: Uint8Array; report: BuildReport; dims: string[]; notes: string[] }> {
  if (!sheets.length) throw new Error("Cần ít nhất một sheet.");
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = brandName();
  wb.created = new Date();
  const { look, note } = xlsxLook(opts.theme, opts.accent);
  const notes: string[] = note ? [note] : [];
  const grid: Grid = new Map();
  const dims: string[] = [];
  const used = new Set<string>();
  const usedSize: UsedMap = new Map();
  const styling: (() => void)[] = [];
  sheets.forEach((spec, si) => {
    let name = safeSheetName(spec.name, si);
    while (used.has(name.toLowerCase())) name = (name.slice(0, 28) + "_" + (si + 1)).slice(0, 31);
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    const header = spec.header !== false && (spec.rows ?? []).length > 0;
    const { rows, pct } = normalizePercent(spec.rows ?? [], header);
    const cols = Math.max(1, ...rows.map((r) => r.length));
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
    styling.push(() => styleSheet(ws, spec, rows, cols, header, look, pct));
    usedSize.set(name, { rows: rows.length, cols });
    dims.push(`${name}: ${rows.length} hàng × ${cols} cột`);
  });
  const report = await recalc(wb, grid);
  styling.forEach((f) => f());
  const charts = planCharts(wb, opts.charts, usedSize, look.palette);
  notes.push(...charts.lines);
  wb.calcProperties = { fullCalcOnLoad: true };
  const bytes = toBytes(await wb.xlsx.writeBuffer());
  return { bytes: await injectCharts(bytes, charts.inserts), report, dims, notes };
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
  /** Thêm biểu đồ thật (cột, ngang, đường, tròn, vành, vùng) từ vùng dữ liệu; biểu đồ có sẵn trong tệp được giữ lại. */
  charts?: ChartRequest[];
  /** Chủ đề màu / màu nhấn cho sheet mới và biểu đồ (như create_xlsx). */
  theme?: string;
  accent?: string;
}

/** Hàng mới nối vào cuối bảng: lấy kiểu của hàng dữ liệu trước đó (cách 2 hàng để giữ màu so le); bỏ qua nếu hàng trên là hàng Tổng hoặc tiêu đề. */
function inheritRowStyle(ws: any, r: number, cols: number): void {
  if (r < 3) return;
  const isTotal = (row: number): boolean => {
    let t = false;
    ws.getRow(row).eachCell({ includeEmpty: false }, (cell: any) => {
      if (cell.border?.top?.style === "medium" && cell.font?.bold) t = true;
    });
    return t;
  };
  if (isTotal(r - 1)) return;
  const src = r - 2 >= 3 && !isTotal(r - 2) ? r - 2 : r - 1;
  const from = ws.getRow(src);
  for (let c = 1; c <= cols; c++) {
    const st = from.getCell(c).style;
    if (st && Object.keys(st).length) ws.getCell(r, c).style = JSON.parse(JSON.stringify(st));
  }
  if (from.height) ws.getRow(r).height = from.height;
}

export async function editXlsx(bytes: Uint8Array, e: XlsxEdit): Promise<{ bytes: Uint8Array; changed: string[]; report: BuildReport; notes: string[] }> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  let kept: Awaited<ReturnType<typeof extractCharts>> = [];
  try {
    await loadZip(bytes);
    kept = await extractCharts(bytes); // ExcelJS làm mất biểu đồ khi đọc-ghi: lấy ra để chèn lại
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
      inheritRowStyle(ws, r, Math.max(line.length, ws.columnCount || 0));
      line.forEach((v, c) => apply(ws, r, c + 1, v));
      changed.push(`${ws.name}!A${r}:${colLetter(Math.max(1, line.length))}${r}`);
      r++;
    }
  }
  const { look, note } = xlsxLook(e.theme, e.accent);
  const notes: string[] = note ? [note] : [];
  let styleNew: (() => void) | undefined;
  if (e.add_sheet) {
    const ws = wb.addWorksheet(safeSheetName(e.add_sheet.name, wb.worksheets.length));
    const sp = e.add_sheet;
    const header = sp.header !== false && sp.rows.length > 0;
    const { rows, pct } = normalizePercent(sp.rows, header);
    rows.forEach((line, r) => line.forEach((v, c) => apply(ws, r + 1, c + 1, v)));
    styleNew = () => styleSheet(ws, sp, rows, Math.max(1, ...rows.map((r) => r.length)), header, look, pct);
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
  styleNew?.();
  const usedSize: UsedMap = new Map(wb.worksheets.map((w: any) => [w.name, { rows: w.rowCount || 0, cols: w.columnCount || 0 }] as const));
  const charts = planCharts(wb, e.charts, usedSize, look.palette);
  notes.push(...charts.lines);
  wb.calcProperties = { fullCalcOnLoad: true };
  const names = new Set<string>(wb.worksheets.map((w: any) => w.name));
  const out = await injectCharts(toBytes(await wb.xlsx.writeBuffer()), [...kept.filter((k) => names.has(k.sheet)), ...charts.inserts]);
  return { bytes: out, changed, report, notes };
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
