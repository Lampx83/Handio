/**
 * Vị trí ổn định trong tài liệu (để trích dẫn nguồn): Word/văn bản = "đoạn N", Excel = "Sheet!C5", PowerPoint = "slide N", PDF = "trang N".
 * Câu trả lời trích nguồn bằng ký hiệu [[tệp|vị trí]]; giao diện biến nó thành chip mở khung xem tài liệu.
 */
import { extOf, mdBlocks, readDocumentSections } from "./readdoc";
import { colName, colNumber, readXlsxGrid, type SheetGrid } from "./xlsx";

export interface DocUnit {
  /** Vị trí, đúng dạng dùng trong trích dẫn: "đoạn 3", "Điểm!C5", "slide 2", "trang 1". */
  loc: string;
  text: string;
  /** Excel: từng ô của hàng (địa chỉ + chữ) để chỉ ra ô khớp. */
  cells?: { addr: string; text: string }[];
}

const MAX_GRID_ROWS = 5000;
const MAX_GRID_COLS = 40;

export interface DocUnits {
  kind: string;
  units: DocUnit[];
  note?: string;
}

/** Chia tài liệu thành các đơn vị có vị trí. Dùng cho tìm kiếm có dẫn nguồn, xem trước và kiểm tra trích dẫn. */
export async function documentUnits(bytes: Uint8Array, ext: string): Promise<DocUnits> {
  if (ext === ".xlsx" || ext === ".xlsm") {
    const grids = await readXlsxGrid(bytes, { maxRows: MAX_GRID_ROWS, maxCols: MAX_GRID_COLS });
    const units: DocUnit[] = [];
    for (const g of grids)
      for (const row of g.rows) {
        const cells = row.cells.map((t, i) => ({ addr: `${colName(g.c1 + i)}${row.r}`, text: t })).filter((c) => c.text !== "");
        units.push({ loc: `${g.name}!${cells[0]?.addr ?? "A" + row.r}`, text: cells.map((c) => c.text).join(" | "), cells });
      }
    return { kind: "Excel", units };
  }
  const r = await readDocumentSections(bytes, ext, {});
  const units: DocUnit[] = [];
  if (r.kind === "Word" || r.kind === "Văn bản") mdBlocks(r.sections.map((s) => s.text).join("\n\n")).forEach((b, i) => units.push({ loc: `đoạn ${i + 1}`, text: b }));
  else
    r.sections.forEach((s, i) => {
      const loc = r.kind === "PDF" ? `trang ${i + 1}` : `slide ${i + 1}`;
      if (s.text.trim() || r.kind === "PowerPoint") units.push({ loc, text: (r.kind === "PowerPoint" ? s.label.replace(/^Slide \d+:?\s*/, "") + "\n" : "") + s.text });
    });
  return { kind: r.kind, units, note: r.note };
}

// ---------------------------------------------------------------- ký hiệu trích dẫn

export interface Citation {
  file: string;
  loc: string;
  /** Nguyên văn "[[tệp|vị trí]]". */
  raw: string;
}

export const CITATION_RE = /\[\[([^[\]|\n]{1,200})\|([^[\]\n]{1,80})\]\]/g;
export const citeToken = (file: string, loc: string): string => `[[${file}|${loc}]]`;

/** Các trích dẫn khác nhau trong một đoạn văn, theo thứ tự xuất hiện. */
export function parseCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const file = m[1].trim();
    const loc = m[2].trim();
    if (!out.some((c) => c.file === file && c.loc === loc)) out.push({ file, loc, raw: m[0] });
  }
  return out;
}

export type ParsedLoc = { kind: "para"; n: number } | { kind: "slide"; n: number } | { kind: "page"; n: number } | { kind: "cell"; sheet: string; col: number; row: number } | { kind: "row"; sheet: string; row: number };

export function parseLoc(loc: string): ParsedLoc | null {
  const t = loc.trim();
  let m = /^(?:đoạn|doan|¶|mục|dòng)\s*(\d{1,6})$/i.exec(t);
  if (m) return { kind: "para", n: +m[1] };
  m = /^slide\s*(\d{1,5})$/i.exec(t);
  if (m) return { kind: "slide", n: +m[1] };
  m = /^(?:trang|tr\.?|page)\s*(\d{1,6})$/i.exec(t);
  if (m) return { kind: "page", n: +m[1] };
  m = /^(.{1,60})!\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?$/.exec(t);
  if (m) return { kind: "cell", sheet: m[1].replace(/^'|'$/g, "").replace(/^Sheet\s*“(.*)”$/i, "$1"), col: colNumber(m[2]), row: +m[3] };
  m = /^(.{1,60})!(\d{1,7})$/.exec(t);
  if (m) return { kind: "row", sheet: m[1].replace(/^'|'$/g, ""), row: +m[2] };
  return null;
}

export interface CitationCheck {
  ok: boolean;
  /** Nhãn gọn để hiển thị/ghi chú lỗi. */
  label: string;
  /** Đoạn trích tại vị trí đó (cắt ngắn). */
  snippet?: string;
  reason?: string;
}

/** Vị trí `loc` có thật trong tài liệu không? (không đánh giá nội dung có đúng ý hay không). */
export async function checkCitation(bytes: Uint8Array, ext: string, loc: string): Promise<CitationCheck> {
  const p = parseLoc(loc);
  if (!p) return { ok: false, label: loc, reason: "vị trí không hợp lệ" };
  if (p.kind === "cell" || p.kind === "row") {
    if (ext !== ".xlsx" && ext !== ".xlsm") return { ok: false, label: loc, reason: "không phải file Excel" };
    let g: SheetGrid | null = null;
    try {
      g = (await readXlsxGrid(bytes, { sheet: p.sheet, maxRows: 1, maxCols: 1 })).find((x) => x.name.toLowerCase() === p.sheet.toLowerCase()) ?? null;
    } catch {
      /* không có sheet */
    }
    if (!g) return { ok: false, label: loc, reason: "không có sheet này" };
    if (p.row < 1 || p.row > g.lastRow) return { ok: false, label: loc, reason: `sheet chỉ có ${g.lastRow} hàng` };
    const full = (await readXlsxGrid(bytes, { sheet: p.sheet, maxRows: 40, maxCols: MAX_GRID_COLS, aroundRow: p.row + 20 }))[0];
    const row = full?.rows.find((r) => r.r === p.row);
    return { ok: true, label: loc, snippet: row?.cells.filter(Boolean).join(" | ").slice(0, 160) };
  }
  const { units, kind } = await documentUnits(bytes, ext);
  const want = p.kind === "para" ? `đoạn ${p.n}` : p.kind === "slide" ? `slide ${p.n}` : `trang ${p.n}`;
  if ((p.kind === "para") !== (kind === "Word" || kind === "Văn bản")) return { ok: false, label: loc, reason: `không dùng được với tệp ${kind}` };
  const u = units.find((x) => x.loc === want);
  return u ? { ok: true, label: want, snippet: u.text.replace(/\s+/g, " ").slice(0, 160) } : { ok: false, label: loc, reason: `không có ${want} (tài liệu có ${units.length})` };
}

// ---------------------------------------------------------------- dữ liệu cho khung xem tài liệu

export type ViewBlock =
  | { n: number; t: "h" | "p"; text: string; hit?: boolean }
  | { n: number; t: "list"; items: string[]; hit?: boolean }
  | { n: number; t: "table"; rows: string[][]; hit?: boolean }
  | { n: number; t: "grid"; cols: string[]; rows: { r: number; cells: string[] }[]; hitRow?: number; hitCol?: number };

export interface ViewSection {
  label: string;
  blocks: ViewBlock[];
  hit?: boolean;
  note?: string;
}
export interface DocView {
  kind: string;
  name: string;
  sections: ViewSection[];
  /** Vị trí trích dẫn có thật trong tài liệu. */
  found: boolean;
  note?: string;
}

const splitRow = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
const isSepRow = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Một khối Markdown → khối hiển thị (luôn là chữ thuần; giao diện chỉ dùng textContent). */
function viewBlock(text: string, n: number): ViewBlock {
  const lines = text.split("\n");
  if (lines.length >= 2 && lines[0].includes("|") && isSepRow(lines[1])) return { n, t: "table", rows: [splitRow(lines[0]), ...lines.slice(2).filter((l) => l.trim()).map(splitRow)] };
  if (lines.every((l) => /^\s*([-*+•]|\d+[.)])\s+/.test(l))) return { n, t: "list", items: lines.map((l) => l.replace(/^\s*([-*+•]|\d+[.)])\s+/, "")) };
  const h = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) return { n, t: "h", text: h[2] };
  return { n, t: "p", text: text.replace(/^<center>([\s\S]*)<\/center>$/, "$1") };
}

const gridBlock = (g: SheetGrid, hitRow?: number, hitCol?: number): ViewBlock => ({ n: 1, t: "grid", cols: g.cols, rows: g.rows, hitRow, hitCol });

/** Dựng nội dung xem trước (chỉ đọc) của một tài liệu và đánh dấu vị trí trích dẫn `loc`. */
export async function buildDocView(bytes: Uint8Array, name: string, loc?: string): Promise<DocView> {
  const ext = extOf(name);
  const p = loc ? parseLoc(loc) : null;
  if (ext === ".xlsx" || ext === ".xlsm") {
    const around = p?.kind === "cell" || p?.kind === "row" ? p.row : undefined;
    const grids = await readXlsxGrid(bytes, { maxRows: 300, maxCols: 26, aroundRow: around, maxCells: 60_000 });
    let found = false;
    const sections = grids.map((g): ViewSection => {
      const mine = (p?.kind === "cell" || p?.kind === "row") && g.name.toLowerCase() === p.sheet.toLowerCase();
      const hitRow = mine ? (p as { row: number }).row : undefined;
      const hitCol = mine && p?.kind === "cell" ? p.col : undefined;
      if (mine && hitRow !== undefined && hitRow >= 1 && hitRow <= g.lastRow) found = true;
      return { label: g.name, hit: !!mine, blocks: [gridBlock(g, hitRow, hitCol)], note: g.truncated ? `${g.lastRow} hàng × ${g.lastCol} cột (chỉ hiện một phần)` : undefined };
    });
    return { kind: "Excel", name, sections, found: loc ? found : true };
  }
  const r = await readDocumentSections(bytes, ext, {});
  const sections: ViewSection[] = [];
  let found = !loc;
  if (r.kind === "Word" || r.kind === "Văn bản") {
    const blocks = mdBlocks(r.sections.map((s) => s.text).join("\n\n")).slice(0, 2000).map((b, i) => viewBlock(b, i + 1));
    if (p?.kind === "para") {
      const b = blocks.find((x) => x.n === p.n);
      if (b && b.t !== "grid") {
        b.hit = true;
        found = true;
      }
    }
    sections.push({ label: "", blocks });
  } else {
    r.sections.forEach((s, i) => {
      const hit = (p?.kind === "slide" && r.kind === "PowerPoint" && p.n === i + 1) || (p?.kind === "page" && r.kind === "PDF" && p.n === i + 1);
      if (hit) found = true;
      sections.push({ label: s.label || `Trang ${i + 1}`, hit, blocks: mdBlocks(s.text).slice(0, 400).map((b, k) => viewBlock(b, k + 1)) });
    });
  }
  return { kind: r.kind, name, sections: sections.slice(0, 400), found, note: r.note };
}
