import { parseBlocks, runsText } from "./mdblocks";

/**
 * Biểu đồ trong Markdown của create_pptx: khối rào ```chart <loại> chứa (tuỳ chọn) dòng "title: ..." rồi một bảng:
 * cột đầu = nhãn trục, các cột sau = chuỗi số liệu. Loại: cột | ngang | đường | tròn | vành | vùng (hoặc bar, barh, line, pie, doughnut, area).
 */
export type ChartKind = "bar" | "barh" | "line" | "pie" | "doughnut" | "area";
export interface ChartSpec {
  kind: ChartKind;
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

const KIND: Record<string, ChartKind> = { cot: "bar", cột: "bar", bar: "bar", column: "bar", ngang: "barh", barh: "barh", duong: "line", đường: "line", line: "line", tron: "pie", tròn: "pie", pie: "pie", vanh: "doughnut", vành: "doughnut", doughnut: "doughnut", donut: "doughnut", vung: "area", vùng: "area", area: "area" };

/** "8,5" → 8.5; "1.200" → 1200 (dấu chấm ngăn nhóm nghìn kiểu Việt Nam); "12%" → 12. */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/[%\s]/g, "");
  if (!t) return null;
  const n = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(n) ? +n : null;
}

export function parseChart(text: string, info: string): ChartSpec | { error: string } {
  const kind = KIND[(info.split(/\s+/)[0] ?? "").toLowerCase()] ?? "bar";
  let title = "";
  const body = text.split("\n").filter((l) => {
    const m = /^\s*(?:title|tiêu đề)\s*:\s*(.+)$/i.exec(l);
    if (m) title = m[1].trim();
    return !m;
  }).join("\n");
  const tb = parseBlocks(body).find((b) => b.t === "table");
  if (!tb || tb.t !== "table") return { error: "khối chart cần một bảng Markdown (cột đầu là nhãn, các cột sau là số liệu)" };
  const header = tb.header.map(runsText);
  if (header.length < 2 || !tb.rows.length) return { error: "bảng chart cần ít nhất 2 cột và 1 dòng" };
  if (tb.rows.length > 40) return { error: "bảng chart quá nhiều dòng (tối đa 40)" };
  const labels = tb.rows.map((r) => runsText(r[0] ?? []));
  const series = header.slice(1, 7).map((name, i) => ({ name: name || `Chuỗi ${i + 1}`, values: tb.rows.map((r) => parseNumber(runsText(r[i + 1] ?? [])) ?? NaN) }));
  const bad = series.find((s) => s.values.some((v) => Number.isNaN(v)));
  if (bad) return { error: `cột “${bad.name}” có ô không phải số` };
  return { kind, title, labels, series };
}
