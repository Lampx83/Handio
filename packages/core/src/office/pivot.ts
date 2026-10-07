/**
 * Bảng tổng hợp kiểu PivotTable bằng công thức sống (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS) trên dữ liệu gốc:
 * đổi số liệu gốc thì bảng tổng hợp tự đổi. (ExcelJS không tạo được PivotTable/biểu đồ thật; đây là phương án trung thực thay thế.)
 */
import { fold } from "./readdoc";
import { colName, readXlsxGrid, type CellInput, type ConditionalSpec, type XlsxEdit } from "./xlsx";

export type Agg = "sum" | "count" | "avg" | "min" | "max";
export interface PivotSpec {
  /** Sheet nguồn (mặc định sheet đầu). Dòng đầu là tiêu đề cột. */
  sheet?: string;
  /** 1–2 cột để nhóm. */
  group_by: string[];
  /** Các giá trị cần tính cho mỗi nhóm. `column` có thể bỏ trống với count. */
  values: { column?: string; agg: Agg; label?: string }[];
  /** Tên sheet kết quả (mặc định "Tổng hợp"). */
  output_sheet?: string;
  /** Tô màu cột giá trị đầu tiên: thanh dữ liệu hoặc thang màu. */
  highlight?: "bars" | "scale";
}

export const AGG_LABEL: Record<Agg, string> = { sum: "Tổng", count: "Số lượng", avg: "Trung bình", min: "Nhỏ nhất", max: "Lớn nhất" };
const quote = (n: string) => `'${n.replace(/'/g, "''")}'`;
const natural = (a: string, b: string): number => a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" });

export interface PivotPlan {
  edit: XlsxEdit;
  groups: number;
  skipped: number;
  describe: string;
}

export async function planPivot(bytes: Uint8Array, spec: PivotSpec): Promise<PivotPlan> {
  const group = spec.group_by ?? [];
  if (!group.length || group.length > 2) throw new Error("group_by cần 1 hoặc 2 tên cột.");
  if (!spec.values?.length || spec.values.length > 8) throw new Error("values cần từ 1 đến 8 mục.");
  const g = (await readXlsxGrid(bytes, { sheet: spec.sheet, maxRows: 20000, maxCols: 60, maxCells: 400_000 }))[0];
  if (!g || !g.rows.length) throw new Error("Sheet nguồn trống.");
  if (g.truncated && g.lastRow > 20000) throw new Error("Sheet nguồn quá lớn (hơn 20.000 hàng).");
  const head = g.rows[0];
  const colOf = (name: string): number => {
    const want = fold(name).trim();
    const i = head.cells.findIndex((c) => fold(c).trim() === want);
    if (i < 0) throw new Error(`Không có cột “${name}”. Các cột: ${head.cells.filter(Boolean).join(", ")}.`);
    return i;
  };
  const gcols = group.map(colOf);
  const vals = spec.values.map((v) => {
    if (v.agg !== "count" && !v.column) throw new Error(`Cần chỉ rõ cột cho phép tính “${v.agg}”.`);
    if (!["sum", "count", "avg", "min", "max"].includes(v.agg)) throw new Error(`Phép tính không hợp lệ: ${v.agg} (dùng sum, count, avg, min, max).`);
    return { ...v, idx: v.column ? colOf(v.column) : gcols[0] };
  });
  const data = g.rows.slice(1);
  const lastRow = g.lastRow;
  const rng = (i: number) => `${quote(g.name)}!$${colName(i + 1)}$2:$${colName(i + 1)}$${lastRow}`;
  const keys = new Map<string, string[]>();
  let skipped = 0;
  for (const r of data) {
    const k = gcols.map((c) => (r.cells[c] ?? "").trim());
    if (k.some((x) => !x)) {
      skipped++;
      continue;
    }
    keys.set(k.join("\u0001"), k);
  }
  const combos = [...keys.values()].sort((a, b) => a.reduce((d, x, i) => d || natural(x, b[i]), 0));
  if (!combos.length) throw new Error("Không có dòng dữ liệu nào có đủ giá trị ở cột nhóm.");
  if (combos.length > 500) throw new Error(`Có ${combos.length} nhóm, quá nhiều (tối đa 500). Hãy chọn cột nhóm khác.`);

  const nG = group.length;
  const header: CellInput[] = [...group.map((c, i) => g.rows[0].cells[gcols[i]] || c), ...vals.map((v) => v.label || (v.agg === "count" && !v.column ? "Số lượng" : `${AGG_LABEL[v.agg]} ${v.column}`))];
  const rows: CellInput[][] = [header];
  combos.forEach((k, ri) => {
    const r = ri + 2;
    const crit = gcols.map((c, i) => `${rng(c)},$${colName(i + 1)}${r}`).join(",");
    const line: CellInput[] = [...k.map((x) => (/^[=+@-]/.test(x) ? "'" + x : x))];
    for (const v of vals) {
      const R = rng(v.idx);
      line.push(v.agg === "sum" ? `=SUMIFS(${R},${crit})` : v.agg === "count" ? `=COUNTIFS(${crit})` : v.agg === "avg" ? `=IFERROR(AVERAGEIFS(${R},${crit}),0)` : v.agg === "min" ? `=MINIFS(${R},${crit})` : `=MAXIFS(${R},${crit})`);
    }
    rows.push(line);
  });
  const last = combos.length + 1;
  const total: CellInput[] = ["Tổng", ...Array.from({ length: nG - 1 }, () => "")];
  vals.forEach((v, i) => {
    const L = colName(nG + i + 1);
    total.push(v.agg === "sum" || v.agg === "count" ? `=SUM(${L}2:${L}${last})` : v.agg === "avg" ? `=AVERAGE(${rng(v.idx)})` : v.agg === "min" ? `=MIN(${rng(v.idx)})` : `=MAX(${rng(v.idx)})`);
  });
  rows.push(total);
  const number_formats: Record<string, string> = {};
  vals.forEach((v, i) => (number_formats[colName(nG + i + 1)] = v.agg === "count" ? "#,##0" : v.agg === "avg" ? "#,##0.00" : "#,##0.##"));
  const conditional: ConditionalSpec[] = spec.highlight ? [{ range: `${colName(nG + 1)}2:${colName(nG + 1)}${last}`, rule: spec.highlight }] : [];
  return {
    edit: { add_sheet: { name: spec.output_sheet || "Tổng hợp", rows, header: true, number_formats, conditional, freeze_header: true } },
    groups: combos.length,
    skipped,
    describe: `${combos.length} nhóm theo ${group.join(" × ")}; ${vals.map((v) => `${AGG_LABEL[v.agg]}${v.column ? " " + v.column : ""}`).join(", ")}` + (skipped ? `; bỏ qua ${skipped} dòng thiếu giá trị nhóm` : ""),
  };
}

