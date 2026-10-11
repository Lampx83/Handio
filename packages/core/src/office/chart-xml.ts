import type { ChartKind } from "./chart";

/**
 * Sinh XML biểu đồ DrawingML thuần (<c:chartSpace>) cho Excel; dùng lại được cho Word (cùng định dạng phần chart).
 * Không phụ thuộc môi trường: chỉ trả về chuỗi XML. Loại: bar (cột), barh (ngang), line, pie, doughnut, area.
 */
export interface ChartXmlSpec {
  kind: ChartKind;
  title?: string;
  /** Nhãn trục danh mục (hoặc tên từng phần của biểu đồ tròn). */
  labels: string[];
  /** Chuỗi số liệu; NaN = ô trống. Biểu đồ tròn/vành chỉ dùng chuỗi đầu. */
  series: { name: string; values: number[] }[];
  /** Màu hex 6 ký tự: theo chuỗi (hoặc theo từng phần với biểu đồ tròn). Mặc định: bảng màu xanh. */
  palette?: string[];
  /** Hiện chú giải. Mặc định: có khi nhiều chuỗi hoặc biểu đồ tròn/vành. */
  legend?: boolean;
  /** Hiện nhãn số. Mặc định: có khi ít điểm dữ liệu (luôn có với tròn/vành). */
  dataLabels?: boolean;
  /** Mã định dạng số (vd "#,##0", "0.0%"). Mặc định tự suy từ dữ liệu. */
  numFmt?: string;
  categoryTitle?: string;
  valueTitle?: string;
  /** Tên phông (mặc định Calibri). */
  font?: string;
}

/** Tham chiếu ô (c:f) để Excel đọc/sửa dữ liệu thật; bộ nhớ đệm lấy từ ChartXmlSpec. */
export interface ChartRefs {
  /** vd "'Doanh thu'!$A$2:$A$6" */
  categories?: string;
  /** theo thứ tự chuỗi: name = ô tiêu đề (vd "'Doanh thu'!$B$1"), values = vùng số liệu. */
  series?: { name?: string; values: string }[];
}

export const DEFAULT_CHART_PALETTE = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"]; // thứ tự cố định, đã kiểm CVD (skill dataviz)

const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string): string => String(s).replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hex = (c: string | undefined, fallback: string): string => (c && /^[0-9a-f]{6}$/i.test(c.replace(/^#/, "")) ? c.replace(/^#/, "").toUpperCase() : fallback);
const fill = (c: string, alpha?: number): string => `<a:solidFill><a:srgbClr val="${c}">${alpha ? `<a:alpha val="${alpha}"/>` : ""}</a:srgbClr></a:solidFill>`;
const line = (c: string, w = 9525): string => `<a:ln w="${w}">${fill(c)}</a:ln>`;

const TEXT = "404040";
const GRID = "E5E7EB";
const AXIS = "BFBFBF";
const AX_CAT = "500000001";
const AX_VAL = "500000002";

/** Kiểu chữ dùng chung (kích thước 1/100 pt). */
const txPr = (font: string, sz: number, opts: { bold?: boolean; color?: string; rot?: number } = {}): string =>
  `<c:txPr><a:bodyPr${opts.rot !== undefined ? ` rot="${opts.rot}" vert="horz"` : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${opts.bold ? 1 : 0}">${fill(opts.color ?? TEXT)}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr>`;

const richTitle = (text: string, font: string, sz: number, opts: { bold?: boolean; rot?: number } = {}): string =>
  `<c:title><c:tx><c:rich><a:bodyPr${opts.rot !== undefined ? ` rot="${opts.rot}" vert="horz"` : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${opts.bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="vi-VN" sz="${sz}" b="${opts.bold ? 1 : 0}">${fill("1F2937")}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

const strCache = (vals: string[]): string => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
const numCache = (vals: number[], fmt: string): string =>
  `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : "")).join("")}</c:numCache>`;

/** Mã định dạng số suy từ dữ liệu: nguyên → "#,##0"; 1 chữ số lẻ → "#,##0.0"; còn lại "#,##0.00". */
export function inferNumFmt(values: number[]): string {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.every((x) => Number.isInteger(x))) return "#,##0";
  return v.every((x) => Math.abs(Math.round(x * 10) / 10 - x) < 1e-9) ? "#,##0.0" : "#,##0.00";
}

function dataLabels(kind: ChartKind, fmt: string, font: string): string {
  const pie = kind === "pie" || kind === "doughnut";
  const pos = kind === "bar" || kind === "barh" ? '<c:dLblPos val="outEnd"/>' : kind === "line" ? '<c:dLblPos val="t"/>' : kind === "pie" ? '<c:dLblPos val="outEnd"/>' : "";
  const color = kind === "doughnut" ? "FFFFFF" : TEXT;
  return (
    `<c:dLbls><c:numFmt formatCode="${pie ? "0.0%" : esc(fmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(font, 900, { bold: pie, color })}${pos}` +
    `<c:showLegendKey val="0"/><c:showVal val="${pie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pie ? 1 : 0}"/><c:showBubbleSize val="0"/>${pie ? '<c:showLeaderLines val="0"/>' : ""}</c:dLbls>`
  );
}

function axes(kind: ChartKind, fmt: string, font: string, spec: ChartXmlSpec): string {
  const horiz = kind === "barh";
  const catPos = horiz ? "l" : "b";
  const valPos = horiz ? "b" : "l";
  const catTitle = spec.categoryTitle ? richTitle(spec.categoryTitle, font, 1000, { rot: horiz ? -5400000 : undefined }) : "";
  const valTitle = spec.valueTitle ? richTitle(spec.valueTitle, font, 1000, { rot: horiz ? undefined : -5400000 }) : "";
  const cat =
    `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="${horiz ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/>${catTitle}` +
    `<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr>${line(AXIS)}</c:spPr>${txPr(font, 900)}<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const val =
    `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valPos}"/>` +
    `<c:majorGridlines><c:spPr>${line(GRID, 6350)}</c:spPr></c:majorGridlines>${valTitle}` +
    `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(font, 900)}<c:crossAx val="${AX_CAT}"/><c:crosses val="${horiz ? "max" : "autoZero"}"/><c:crossBetween val="${kind === "area" ? "midCat" : "between"}"/></c:valAx>`;
  return cat + val;
}

/** Trả về nội dung tệp chartN.xml (c:chartSpace). `refs` (tuỳ chọn): tham chiếu ô để Excel hiện dữ liệu thật và cho sửa. */
export function buildChartXml(spec: ChartXmlSpec, refs?: ChartRefs): string {
  const kind = spec.kind;
  const pie = kind === "pie" || kind === "doughnut";
  const font = spec.font || "Calibri";
  const palette = (spec.palette?.length ? spec.palette : DEFAULT_CHART_PALETTE).map((c, i) => hex(c, DEFAULT_CHART_PALETTE[i % DEFAULT_CHART_PALETTE.length]));
  const color = (i: number): string => palette[i % palette.length];
  const labels = spec.labels.map(String);
  const series = (pie ? spec.series.slice(0, 1) : spec.series).filter((s) => s && Array.isArray(s.values));
  const all = series.flatMap((s) => s.values);
  const fmt = spec.numFmt || inferNumFmt(all);
  const points = labels.length * series.length;
  const showLabels = spec.dataLabels ?? (pie ? true : kind === "area" ? false : kind === "line" ? points <= 12 : points <= 24);
  const legend = spec.legend ?? (pie || series.length > 1);

  const ser = series
    .map((s, i) => {
      const r = refs?.series?.[i];
      const tx = r?.name ? `<c:tx><c:strRef><c:f>${esc(r.name)}</c:f>${strCache([s.name])}</c:strRef></c:tx>` : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
      const cat = refs?.categories
        ? `<c:cat><c:strRef><c:f>${esc(refs.categories)}</c:f>${strCache(labels)}</c:strRef></c:cat>`
        : `<c:cat><c:strLit><c:ptCount val="${labels.length}"/>${labels.map((v, k) => `<c:pt idx="${k}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strLit></c:cat>`;
      const val = r?.values
        ? `<c:val><c:numRef><c:f>${esc(r.values)}</c:f>${numCache(s.values, fmt)}</c:numRef></c:val>`
        : `<c:val><c:numLit><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${s.values.length}"/>${s.values.map((v, k) => (Number.isFinite(v) ? `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>` : "")).join("")}</c:numLit></c:val>`;
      const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`;
      const dl = showLabels ? dataLabels(kind, fmt, font) : "";
      if (pie) {
        const pts = labels.map((_l, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${fill(color(k))}${line("FFFFFF", 19050)}</c:spPr></c:dPt>`).join("");
        return `<c:ser>${head}${pts}${dl}${cat}${val}</c:ser>`;
      }
      if (kind === "line")
        return (
          `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd">${fill(color(i))}<a:round/></a:ln></c:spPr>` +
          `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${fill(color(i))}${line("FFFFFF")}</c:spPr></c:marker>${dl}${cat}${val}<c:smooth val="0"/></c:ser>`
        );
      if (kind === "area") return `<c:ser>${head}<c:spPr>${fill(color(i), series.length > 1 ? 75000 : undefined)}</c:spPr>${dl}${cat}${val}</c:ser>`;
      return `<c:ser>${head}<c:spPr>${fill(color(i))}</c:spPr><c:invertIfNegative val="0"/>${dl}${cat}${val}</c:ser>`;
    })
    .join("");

  let group: string;
  if (kind === "bar" || kind === "barh")
    group = `<c:barChart><c:barDir val="${kind === "barh" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="${series.length > 1 ? 80 : 60}"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>`;
  else if (kind === "line") group = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:lineChart>`;
  else if (kind === "area") group = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:areaChart>`;
  else if (kind === "pie") group = `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`;
  else group = `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;

  const title = spec.title ? richTitle(spec.title, font, 1400, { bold: true }) : "";
  const legendXml = legend ? `<c:legend><c:legendPos val="${pie ? "r" : "b"}"/><c:overlay val="0"/>${txPr(font, 900)}</c:legend>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${NS}><c:date1904 val="0"/><c:lang val="vi-VN"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:autoTitleDeleted val="${title ? 0 : 1}"/><c:plotArea><c:layout/>${group}${pie ? "" : axes(kind, fmt, font, spec)}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>` +
    `${legendXml}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${fill("FFFFFF")}${line("D9D9D9")}</c:spPr>${txPr(font, 1000)}</c:chartSpace>`
  );
}

/** Loại người dùng/mô hình gọi ("col" cột đứng, "bar" thanh ngang kiểu Excel; có cả tên tiếng Việt) → ChartKind. null nếu lạ. */
export function chartKindFor(type: string): ChartKind | null {
  const k = String(type ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
  const map: Record<string, ChartKind> = {
    col: "bar", column: "bar", cot: "bar", bar: "barh", barh: "barh", ngang: "barh", horizontal: "barh",
    line: "line", duong: "line", pie: "pie", tron: "pie", doughnut: "doughnut", donut: "doughnut", vanh: "doughnut", area: "area", vung: "area",
  };
  return map[k] ?? null;
}
