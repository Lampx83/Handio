/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildChartXml, chartKindFor, type ChartXmlSpec } from "./chart-xml";
import { decodeXml, encodeXml, loadZip } from "./docx-read";
import { cellAddress, colName, colNumber, parseAddress } from "./xlsx";

/** Một yêu cầu biểu đồ Excel (tham số `charts` của create_xlsx / xlsx_edit). */
export interface ChartRequest {
  /** col (cột đứng) | bar (thanh ngang) | line | pie | doughnut | area. */
  type: string;
  title?: string;
  /** Sheet chứa dữ liệu (mặc định sheet đầu). */
  sheet?: string;
  /** Vùng dữ liệu gồm hàng tiêu đề và cột nhãn, vd "A1:C6". */
  data_range: string;
  /** Ô góc trên-trái của biểu đồ, vd "E2" (mặc định: bên phải dữ liệu). */
  position?: string;
  width_cols?: number;
  height_rows?: number;
  x_title?: string;
  y_title?: string;
  /** Ép hiện/ẩn nhãn số (mặc định tự chọn). */
  labels?: boolean;
}

/** Một biểu đồ sẽ chèn vào gói xlsx. */
export interface ChartInsert {
  sheet: string;
  chartXml: string;
  /** Phần phụ kèm theo (quan hệ của biểu đồ, kiểu, màu, bảng nhúng…) khi giữ lại biểu đồ có sẵn: đường dẫn đầy đủ trong gói → nội dung. */
  chartRels?: string;
  extraParts?: Record<string, Uint8Array>;
  /** Content-Type của các phần phụ (đường dẫn → kiểu). */
  extraTypes?: Record<string, string>;
  /** Dựng phần tử neo trong drawing; `id` là số định danh hình, `rid` là quan hệ tới biểu đồ. */
  anchor: (id: number, rid: string) => string;
}

const KIND_VI: Record<string, string> = { bar: "cột", barh: "thanh ngang", line: "đường", pie: "tròn", doughnut: "vành", area: "vùng" };
const TOTAL_LABEL = /^(tổng|tong|total|cộng|cong|grand total|sum)\b/i;
const MAX_CHARTS = 10;
const MAX_SERIES = 12;
const MAX_POINTS = 500;

const quoteSheet = (n: string): string => `'${n.replace(/'/g, "''")}'`;
const absRef = (sheet: string, c1: number, r1: number, c2: number, r2: number): string =>
  c1 === c2 && r1 === r2 ? `${quoteSheet(sheet)}!$${colName(c1)}$${r1}` : `${quoteSheet(sheet)}!$${colName(c1)}$${r1}:$${colName(c2)}$${r2}`;
const fmtDate = (d: Date): string => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

function cellValue(v: any): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return cellValue(v.result);
    if ("richText" in v) return v.richText.map((t: any) => t.text).join("");
    if ("error" in v) return null;
    if ("text" in v) return v.text;
    return null;
  }
  return v;
}
const labelOf = (v: unknown): string => (v instanceof Date ? fmtDate(v) : v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1e9) / 1e9) : String(v));

/** Sheet đã dùng bao nhiêu hàng/cột (để tự đặt biểu đồ bên phải dữ liệu). */
export type UsedMap = Map<string, { rows: number; cols: number }>;

/**
 * Kiểm tra yêu cầu và dựng biểu đồ từ dữ liệu hiện có trong sổ ExcelJS (công thức đã có kết quả).
 * Lỗi người dùng → Error tiếng Việt rõ ràng. `lines` là các dòng báo cáo "Đã thêm biểu đồ …".
 */
export function planCharts(wb: any, requests: ChartRequest[] | undefined, used: UsedMap, palette: string[]): { inserts: ChartInsert[]; lines: string[] } {
  const inserts: ChartInsert[] = [];
  const lines: string[] = [];
  if (!requests?.length) return { inserts, lines };
  if (!Array.isArray(requests)) throw new Error("charts phải là danh sách [{type, title, data_range, …}].");
  if (requests.length > MAX_CHARTS) throw new Error(`Tối đa ${MAX_CHARTS} biểu đồ mỗi lần (nhận ${requests.length}).`);
  const nextRow = new Map<string, number>(); // sheet → hàng tiếp theo cho biểu đồ tự đặt
  requests.forEach((req, i) => {
    const tag = `Biểu đồ ${i + 1}${req?.title ? ` “${String(req.title).slice(0, 40)}”` : ""}`;
    if (!req || typeof req !== "object") throw new Error(`${tag}: phải là đối tượng {type, data_range, …}.`);
    const kind = chartKindFor(req.type);
    if (!kind) throw new Error(`${tag}: loại “${req.type ?? ""}” không hợp lệ (dùng col, bar, line, pie, doughnut hoặc area).`);
    const ws = req.sheet ? wb.worksheets.find((w: any) => w.name.toLowerCase() === String(req.sheet).toLowerCase()) : wb.worksheets[0];
    if (!ws) throw new Error(`${tag}: không có sheet “${req.sheet}”. Các sheet: ${wb.worksheets.map((w: any) => w.name).join(", ")}.`);
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*:\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*$/.exec(String(req.data_range ?? ""));
    if (!m) throw new Error(`${tag}: data_range “${req.data_range ?? ""}” không hợp lệ (ví dụ "A1:C6", gồm hàng tiêu đề và cột nhãn).`);
    const c1 = Math.min(colNumber(m[1]), colNumber(m[3]));
    const c2 = Math.max(colNumber(m[1]), colNumber(m[3]));
    const r1 = Math.min(+m[2], +m[4]);
    let r2 = Math.max(+m[2], +m[4]);
    if (c2 - c1 < 1) throw new Error(`${tag}: data_range cần ít nhất 2 cột (cột nhãn + cột số liệu), nhận “${req.data_range}”.`);
    if (r2 - r1 < 1) throw new Error(`${tag}: data_range cần hàng tiêu đề và ít nhất 1 hàng dữ liệu, nhận “${req.data_range}”.`);
    if (c2 - c1 > MAX_SERIES) throw new Error(`${tag}: tối đa ${MAX_SERIES} chuỗi số liệu (nhận ${c2 - c1}); hãy chọn vùng nhỏ hơn.`);
    if (r2 - r1 > MAX_POINTS) throw new Error(`${tag}: quá nhiều hàng (${r2 - r1}, tối đa ${MAX_POINTS}).`);

    const notes: string[] = [];
    const get = (r: number, c: number): unknown => cellValue(ws.getCell(r, c).value);
    // hàng cuối là "Tổng": không đưa vào biểu đồ
    const lastLabel = labelOf(get(r2, c1)).trim();
    if (r2 - r1 >= 2 && TOTAL_LABEL.test(lastLabel) && lastLabel.length <= 25) {
      r2--;
      notes.push(`bỏ hàng “${lastLabel}”`);
    }
    const labels: string[] = [];
    for (let r = r1 + 1; r <= r2; r++) labels.push(labelOf(get(r, c1)));
    const series: ChartXmlSpec["series"] = [];
    for (let c = c1 + 1; c <= c2; c++) {
      const head = labelOf(get(r1, c)).trim();
      const values: number[] = [];
      for (let r = r1 + 1; r <= r2; r++) {
        const v = get(r, c);
        if (v === null || v === "") values.push(NaN);
        else if (typeof v === "number" && Number.isFinite(v)) values.push(v);
        else if (typeof v === "boolean") values.push(v ? 1 : 0);
        else throw new Error(`${tag}: ô ${cellAddress(r, c)} (“${labelOf(v).slice(0, 30)}”) không phải số. Hãy dùng số thật hoặc chọn lại data_range.`);
      }
      if (values.every((x) => Number.isNaN(x))) throw new Error(`${tag}: cột ${colName(c)} (“${head}”) không có số nào.`);
      series.push({ name: head || `Chuỗi ${c - c1}`, values });
    }
    if ((kind === "pie" || kind === "doughnut") && series.length > 1) notes.push(`biểu đồ ${KIND_VI[kind]} chỉ vẽ cột “${series[0].name}”`);

    // số định dạng của ô dữ liệu đầu (nếu người dùng đã đặt)
    const f0 = ws.getCell(r1 + 1, c1 + 1).numFmt;
    const numFmt = typeof f0 === "string" && f0 && f0 !== "General" && !/[dmyh]{2}/i.test(f0.replace(/"[^"]*"/g, "")) ? f0 : undefined;

    const spec: ChartXmlSpec = { kind, title: req.title ? String(req.title) : undefined, labels, series, palette, numFmt, categoryTitle: req.x_title, valueTitle: req.y_title, dataLabels: typeof req.labels === "boolean" ? req.labels : undefined };
    const sheetName: string = ws.name;
    const xml = buildChartXml(spec, {
      categories: absRef(sheetName, c1, r1 + 1, c1, r2),
      series: series.map((_s, k) => ({ name: absRef(sheetName, c1 + 1 + k, r1, c1 + 1 + k, r1), values: absRef(sheetName, c1 + 1 + k, r1 + 1, c1 + 1 + k, r2) })),
    });

    // vị trí & kích thước
    const widthCols = Math.min(30, Math.max(3, Math.round(Number(req.width_cols) || (kind === "pie" || kind === "doughnut" ? 7 : 9))));
    const heightRows = Math.min(60, Math.max(6, Math.round(Number(req.height_rows) || 17)));
    const u = used.get(sheetName) ?? { rows: 0, cols: 0 };
    let col: number;
    let row: number;
    let where: string;
    if (req.position !== undefined && req.position !== null && String(req.position).trim() !== "") {
      const p = parseAddress(String(req.position));
      if (!p) throw new Error(`${tag}: position “${req.position}” không hợp lệ (ví dụ "E2").`);
      col = p.col;
      row = p.row;
      where = cellAddress(row, col);
      if (col <= Math.max(u.cols, c2) && row <= Math.max(u.rows, r2) && col >= 1 && row >= 1 && !(col > c2 && col > u.cols)) notes.push(`⚠ vị trí ${where} chồng lên dữ liệu`);
    } else {
      col = Math.max(u.cols, c2) + 2;
      row = nextRow.get(sheetName) ?? (r1 <= 1 ? 2 : r1);
      where = cellAddress(row, col);
      nextRow.set(sheetName, row + heightRows + 1);
    }
    const c0 = col - 1;
    const r0 = row - 1;
    const label = `${i + 1}`;
    inserts.push({
      sheet: sheetName,
      chartXml: xml,
      anchor: (id, rid) => anchorXml(id, rid, `Biểu đồ ${label}`, c0, r0, c0 + widthCols, r0 + heightRows),
    });
    lines.push(`Đã thêm biểu đồ ${KIND_VI[kind]}${req.title ? ` “${String(req.title).slice(0, 60)}”` : ""} từ ${sheetName}!${colName(c1)}${r1}:${colName(c2)}${r2} đặt tại ${where}${notes.length ? ` (${notes.join("; ")})` : ""}.`);
  });
  return { inserts, lines };
}

const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const T_DRAWING = `${NS_R}/drawing`;
const T_CHART = `${NS_R}/chart`;
const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

function anchorXml(id: number, rid: string, name: string, c1: number, r1: number, c2: number, r2: number): string {
  return (
    `<xdr:twoCellAnchor xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" editAs="oneCell"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${encodeXml(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

// ---------------------------------------------------------------- đường dẫn trong gói

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/") + 1);
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
function resolve(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(from) + target).split("/");
  const out: string[] = [];
  for (const s of parts) {
    if (s === "..") out.pop();
    else if (s && s !== ".") out.push(s);
  }
  return out.join("/");
}
const relsPathOf = (part: string): string => `${dirOf(part)}_rels/${baseOf(part)}.rels`;
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

interface Rel { id: string; type: string; target: string; mode?: string }
function parseRels(xml: string | null): Rel[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ id: attr(m[0], "Id") ?? "", type: attr(m[0], "Type") ?? "", target: decodeXml(attr(m[0], "Target") ?? ""), mode: attr(m[0], "TargetMode") }));
}
const nextId = (rels: Rel[]): string => {
  let n = 1;
  const ids = new Set(rels.map((r) => r.id));
  while (ids.has(`rId${n}`)) n++;
  return `rId${n}`;
};
const relXml = (r: Rel): string => `<Relationship Id="${r.id}" Type="${r.type}" Target="${encodeXml(r.target).replace(/"/g, "&quot;")}"${r.mode ? ` TargetMode="${r.mode}"` : ""}/>`;
const relsDoc = (rels: Rel[]): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${rels.map(relXml).join("")}</Relationships>`;

/** Tên sheet → đường dẫn phần sheet trong gói. */
async function sheetParts(zip: any): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wbXml: string | null = (await zip.file("xl/workbook.xml")?.async("string")) ?? null;
  if (!wbXml) return out;
  const rels = parseRels((await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? null);
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1] ?? /\bid="([^"]*)"/.exec(m[0])?.[1];
    const rel = rels.find((r) => r.id === rid);
    if (name !== undefined && rel) out.set(decodeXml(name), resolve("xl/workbook.xml", rel.target));
  }
  return out;
}

/** Chèn biểu đồ vào gói xlsx (ExcelJS không tự tạo được): thêm drawing, chart, quan hệ, content-type và phần tử <drawing>. */
export async function injectCharts(bytes: Uint8Array, items: ChartInsert[]): Promise<Uint8Array> {
  if (!items.length) return bytes;
  const zip: any = await loadZip(bytes);
  const sheets = await sheetParts(zip);
  const ctPath = "[Content_Types].xml";
  let ct: string = await zip.file(ctPath)!.async("string");
  const addType = (part: string, type: string): void => {
    if (!ct.includes(`PartName="/${part}"`)) ct = ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  };
  const maxNum = (re: RegExp): number => Object.keys(zip.files).reduce((n, f) => Math.max(n, +(re.exec(f)?.[1] ?? 0)), 0);
  let chartNo = maxNum(/^xl\/charts\/chart(\d+)\.xml$/);
  let drawNo = maxNum(/^xl\/drawings\/drawing(\d+)\.xml$/);

  const bySheet = new Map<string, ChartInsert[]>();
  for (const it of items) {
    if (!sheets.has(it.sheet)) throw new Error(`Không tìm thấy sheet “${it.sheet}” trong tệp để đặt biểu đồ.`);
    bySheet.set(it.sheet, [...(bySheet.get(it.sheet) ?? []), it]);
  }
  for (const [sheet, list] of bySheet) {
    const sheetPath = sheets.get(sheet)!;
    const sheetRelsPath = relsPathOf(sheetPath);
    let sheetXml: string = await zip.file(sheetPath).async("string");
    const sheetRels = parseRels((await zip.file(sheetRelsPath)?.async("string")) ?? null);

    // drawing có sẵn (ảnh…) hay tạo mới
    const existing = /<drawing\b[^>]*\br:id="([^"]*)"[^>]*\/>/.exec(sheetXml);
    let drawingPath: string;
    let drawingXml: string;
    let drawingRels: Rel[];
    const found = existing ? sheetRels.find((r) => r.id === existing[1]) : undefined;
    if (found) {
      drawingPath = resolve(sheetPath, found.target);
      drawingXml = (await zip.file(drawingPath)?.async("string")) ?? "";
      drawingRels = parseRels((await zip.file(relsPathOf(drawingPath))?.async("string")) ?? null);
    } else {
      drawingPath = `xl/drawings/drawing${++drawNo}.xml`;
      drawingXml = "";
      drawingRels = [];
    }
    if (!/<(?:\w+:)?wsDr\b/.test(drawingXml)) drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}"></xdr:wsDr>`;
    drawingXml = drawingXml.replace(/<((?:\w+:)?wsDr\b[^>]*?)\s*\/>\s*$/, (_m, head: string) => `<${head}></${/^(\w+:)?/.exec(head)![0]}wsDr>`);
    let shapeId = Math.max(1, ...[...drawingXml.matchAll(/<(?:\w+:)?cNvPr\b[^>]*\bid="(\d+)"/g)].map((x) => +x[1])) + 1;

    let anchors = "";
    for (const it of list) {
      chartNo++;
      const chartPath = `xl/charts/chart${chartNo}.xml`;
      zip.file(chartPath, it.chartXml);
      addType(chartPath, CT_CHART);
      if (it.chartRels) zip.file(relsPathOf(chartPath), it.chartRels);
      for (const [p, data] of Object.entries(it.extraParts ?? {})) {
        if (!zip.file(p)) zip.file(p, data);
        const t = it.extraTypes?.[p];
        if (t) addType(p, t);
      }
      const rid = nextId(drawingRels);
      drawingRels.push({ id: rid, type: T_CHART, target: `../charts/chart${chartNo}.xml` });
      anchors += it.anchor(shapeId++, rid);
    }
    drawingXml = drawingXml.replace(/<\/((?:\w+:)?wsDr)>\s*$/, `${anchors}</$1>`);
    zip.file(drawingPath, drawingXml);
    zip.file(relsPathOf(drawingPath), relsDoc(drawingRels));
    addType(drawingPath, CT_DRAWING);

    if (!found) {
      const rid = nextId(sheetRels);
      sheetRels.push({ id: rid, type: T_DRAWING, target: `../drawings/${baseOf(drawingPath)}` });
      zip.file(sheetRelsPath, relsDoc(sheetRels));
      if (!/<worksheet\b[^>]*\bxmlns:r=/.test(sheetXml)) sheetXml = sheetXml.replace(/<worksheet\b/, `<worksheet xmlns:r="${NS_R}"`);
      const tag = `<drawing r:id="${rid}"/>`;
      const after = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(sheetXml);
      sheetXml = after ? sheetXml.slice(0, after.index) + tag + sheetXml.slice(after.index) : sheetXml.replace(/<\/worksheet>\s*$/, `${tag}</worksheet>`);
      zip.file(sheetPath, sheetXml);
    }
  }
  zip.file(ctPath, ct);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/**
 * Lấy các biểu đồ có sẵn trong tệp xlsx (ExcelJS làm mất chúng khi đọc-ghi) để chèn lại sau khi sửa.
 * Giữ nguyên XML biểu đồ, vị trí neo và các phần phụ (kiểu, màu, bảng nhúng).
 */
export async function extractCharts(bytes: Uint8Array): Promise<ChartInsert[]> {
  const out: ChartInsert[] = [];
  let zip: any;
  try {
    zip = await loadZip(bytes);
  } catch {
    return out;
  }
  const ct: string = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
  const typeOf = (part: string): string | undefined => {
    const ov = new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(ct);
    if (ov) return attr(ov[0], "ContentType");
    const ext = part.slice(part.lastIndexOf(".") + 1).toLowerCase();
    const df = [...ct.matchAll(/<Default\b[^>]*>/g)].find((m) => attr(m[0], "Extension")?.toLowerCase() === ext);
    return df ? attr(df[0], "ContentType") : undefined;
  };
  for (const [sheet, sheetPath] of await sheetParts(zip)) {
    const sf = zip.file(sheetPath);
    if (!sf) continue;
    const sheetXml: string = await sf.async("string");
    const rid = /<drawing\b[^>]*\br:id="([^"]*)"/.exec(sheetXml)?.[1];
    if (!rid) continue;
    const dRel = parseRels((await zip.file(relsPathOf(sheetPath))?.async("string")) ?? null).find((r) => r.id === rid);
    if (!dRel) continue;
    const drawingPath = resolve(sheetPath, dRel.target);
    const drawingXml: string | undefined = await zip.file(drawingPath)?.async("string");
    if (!drawingXml) continue;
    const dRels = parseRels((await zip.file(relsPathOf(drawingPath))?.async("string")) ?? null);
    const root = /<(?:\w+:)?wsDr\b[^>]*>/.exec(drawingXml)?.[0] ?? "";
    const rootNs = [...root.matchAll(/\bxmlns:(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]] as const);
    for (const am of drawingXml.matchAll(/<((?:\w+:)?(?:twoCellAnchor|oneCellAnchor|absoluteAnchor))\b[^>]*>[\s\S]*?<\/\1>/g)) {
      const anchor = am[0];
      const ch = /<(?:\w+:)?chart\b[^>]*>/.exec(anchor);
      if (!ch || !anchor.includes(NS_C) && !/<(?:\w+:)?graphicData\b[^>]*drawingml\/2006\/chart/.test(anchor)) continue;
      const crid = /\b\w+:id="([^"]*)"/.exec(ch[0])?.[1];
      const cRel = dRels.find((r) => r.id === crid && r.type === T_CHART);
      if (!cRel) continue;
      const chartPath = resolve(drawingPath, cRel.target);
      const chartXml: string | undefined = await zip.file(chartPath)?.async("string");
      if (!chartXml) continue;
      // phần phụ của biểu đồ
      const cRelsPath = relsPathOf(chartPath);
      const cRelsXml: string | undefined = await zip.file(cRelsPath)?.async("string");
      const extraParts: Record<string, Uint8Array> = {};
      const extraTypes: Record<string, string> = {};
      for (const r of parseRels(cRelsXml ?? null)) {
        if (r.mode === "External") continue;
        const p = resolve(chartPath, r.target);
        const f = zip.file(p);
        if (!f) continue;
        extraParts[p] = await f.async("uint8array");
        const t = typeOf(p);
        if (t) extraTypes[p] = t;
      }
      // neo: mang theo khai báo không gian tên của gốc drawing
      const open = /^<[^>]*>/.exec(anchor)![0];
      const decl = rootNs.filter(([p]) => !new RegExp(`\\bxmlns:${p}=`).test(open)).map(([p, u]) => ` xmlns:${p}="${u}"`).join("");
      const patched = decl ? anchor.replace(/^<([^\s>/]+)/, `<$1${decl}`) : anchor;
      const idRe = /(<(?:\w+:)?chart\b[^>]*?\b\w+:id=")[^"]*(")/;
      out.push({
        sheet,
        chartXml,
        chartRels: cRelsXml,
        extraParts,
        extraTypes,
        anchor: (id, newRid) => patched.replace(/(<(?:\w+:)?cNvPr\b[^>]*\bid=")\d+(")/, `$1${id}$2`).replace(idRe, `$1${newRid}$2`),
      });
    }
  }
  return out;
}
