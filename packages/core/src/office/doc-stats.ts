/** Thống kê tài liệu (doc_stats): từ, ký tự, đoạn, bảng, trang A4 ước lượng, thời gian đọc; Word → dàn ý; PowerPoint → từng slide; Excel → từng sheet. */
import { docxToMarkdown, loadZip } from "./docx-read";
import { formatVn } from "./vn-number";
import { mdBlocks, readDocumentSections } from "./readdoc";
import { readPptx } from "./pptx";

/** Số từ như Word đếm: mỗi cụm ký tự giữa các khoảng trắng có chữ hoặc số (tiếng Việt: mỗi âm tiết là một từ). */
export const countWords = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Số từ trên một trang A4 (Times New Roman 13, giãn dòng ~1,15, lề 2–3 cm): chỉ là ước lượng. */
export const WORDS_PER_PAGE = 450;
/** Tốc độ đọc thầm văn bản tiếng Việt: ~200 từ/phút. */
export const WORDS_PER_MINUTE = 200;

const fmt = (n: number): string => formatVn(n, 0);

const minutes = (words: number): string => {
  const m = words / WORDS_PER_MINUTE;
  return m < 1 ? "dưới 1 phút" : `khoảng ${Math.round(m)} phút`;
};

/** Bỏ ký hiệu Markdown để đếm ký tự/từ chính xác hơn. */
function stripMarkdown(md: string): string {
  return md
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l))
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*>\s?/, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\|/g, " ").replace(/[*_`]/g, ""))
    .join("\n");
}

const charsOf = (t: string): { all: number; noSpace: number } => ({ all: [...t.replace(/\n/g, " ")].length, noSpace: [...t.replace(/\s+/g, "")].length });

function outline(md: string, max = 60): string[] {
  const out: string[] = [];
  let total = 0;
  for (const l of md.split("\n")) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(l);
    if (!m) continue;
    total++;
    if (out.length < max) out.push(`${"  ".repeat(m[1].length - 1)}${m[2].replace(/[*_`]/g, "")}`);
  }
  if (total > max) out.push(`… (còn ${total - max} tiêu đề nữa)`);
  return out;
}

function tableCount(blocks: string[]): { tables: number; rows: number } {
  const t = blocks.filter((b) => b.startsWith("|"));
  return { tables: t.length, rows: t.reduce((n, b) => n + Math.max(0, b.split("\n").length - 2), 0) };
}

async function docxStats(bytes: Uint8Array): Promise<string> {
  const md = await docxToMarkdown(bytes);
  const blocks = mdBlocks(md);
  const plain = stripMarkdown(md);
  const w = countWords(plain);
  const c = charsOf(plain);
  const { tables, rows } = tableCount(blocks);
  const heads = blocks.filter((b) => /^#{1,6}\s/.test(b)).length;
  const paras = blocks.filter((b) => !b.startsWith("|") && !/^#{1,6}\s/.test(b)).length;
  const zip = await loadZip(bytes);
  const images = Object.keys(zip.files).filter((n) => /^word\/media\//.test(n)).length;
  const app = await zip.file("docProps/app.xml")?.async("string");
  const wordPages = app ? Number(/<Pages>(\d+)<\/Pages>/.exec(app)?.[1]) || 0 : 0;
  const lines = [
    "[Word]",
    `Số từ: ${fmt(w)} · Ký tự: ${fmt(c.all)} (không tính khoảng trắng: ${fmt(c.noSpace)})`,
    `Đoạn văn: ${fmt(paras)} · Tiêu đề: ${fmt(heads)} · Bảng: ${fmt(tables)}${tables ? ` (${fmt(rows)} dòng dữ liệu)` : ""} · Ảnh: ${fmt(images)}`,
    `Số trang A4 ước lượng: ~${Math.max(1, Math.ceil(w / WORDS_PER_PAGE))} (${WORDS_PER_PAGE} từ/trang${wordPages ? `; Word đã ghi ${wordPages} trang trong tệp` : ""})`,
    `Thời gian đọc: ${minutes(w)}`,
  ];
  const ol = outline(md);
  if (ol.length) lines.push("Dàn ý (theo tiêu đề):", ...ol);
  else lines.push("Dàn ý: tài liệu không dùng kiểu tiêu đề (Heading), nên không dựng được dàn ý.");
  return lines.join("\n");
}

async function pptxStats(bytes: Uint8Array): Promise<string> {
  const slides = await readPptx(bytes);
  const NOTE = "[Ghi chú người trình bày]";
  let total = 0;
  let notes = 0;
  const rows = slides.map((s, i) => {
    const at = s.text.indexOf(NOTE);
    const raw = at >= 0 ? s.text.slice(0, at) : s.text;
    // ô số trang của slide (một dòng chỉ có số thứ tự slide) không phải nội dung
    const rawLines = raw.split("\n");
    if (rawLines.length && rawLines[rawLines.length - 1].trim() === String(i + 1)) rawLines.pop();
    const body = rawLines.join("\n");
    const note = at >= 0 ? s.text.slice(at + NOTE.length) : "";
    const title = s.label.replace(/^Slide \d+:?\s*/, "");
    const wBody = countWords(body) + countWords(title);
    total += wBody;
    notes += countWords(note);
    return `  Slide ${i + 1}${title ? `: ${title.slice(0, 60)}` : ""} — ${fmt(wBody)} từ${note ? `, ghi chú ${fmt(countWords(note))} từ` : ""}`;
  });
  const lines = ["[PowerPoint]", `Số slide: ${fmt(slides.length)} · Tổng số từ trên slide: ${fmt(total)}${notes ? ` · Từ trong ghi chú: ${fmt(notes)}` : ""}`];
  if (slides.length) lines.push(`Trung bình ${fmt(Math.round(total / slides.length))} từ/slide${total / slides.length > 70 ? " (khá dày chữ; thường nên dưới 50–70 từ mỗi slide)" : ""}`);
  lines.push(...rows.slice(0, 100));
  if (rows.length > 100) lines.push(`  … (còn ${rows.length - 100} slide nữa)`);
  return lines.join("\n");
}

async function xlsxStats(bytes: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  try {
    await loadZip(bytes);
    await wb.xlsx.load(bytes);
  } catch (e) {
    if (/quá lớn/.test((e as Error).message)) throw e;
    throw new Error("Không mở được file Excel (hỏng, có mật khẩu, hoặc là định dạng .xls cũ — hãy lưu lại thành .xlsx).");
  }
  const lines = ["[Excel]", `Số sheet: ${fmt(wb.worksheets.length)}`];
  let totalFormulas = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ws of wb.worksheets as any[]) {
    let cells = 0;
    let formulas = 0;
    let numbers = 0;
    ws.eachRow({ includeEmpty: false }, (row: { eachCell: (o: unknown, f: (c: { value: unknown }) => void) => void }) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown;
        if (v === null || v === undefined || v === "") return;
        cells++;
        if (typeof v === "object" && v !== null && ("formula" in v || "sharedFormula" in v)) formulas++;
        if (typeof v === "number") numbers++;
      }));
    totalFormulas += formulas;
    const merged = Object.keys(ws.model?.merges ?? {}).length || (ws.model?.merges?.length ?? 0);
    lines.push(
      `  Sheet “${ws.name}”: ${fmt(ws.rowCount || 0)} hàng × ${fmt(ws.columnCount || 0)} cột · ${fmt(cells)} ô có dữ liệu (${fmt(numbers)} ô số) · ${fmt(formulas)} công thức${merged ? ` · ${fmt(merged)} vùng gộp ô` : ""}${ws.state && ws.state !== "visible" ? " · đang ẩn" : ""}`,
    );
  }
  lines.push(`Tổng số công thức: ${fmt(totalFormulas)}`);
  return lines.join("\n");
}

export async function documentStats(bytes: Uint8Array, ext: string): Promise<string> {
  if (ext === ".docx") return docxStats(bytes);
  if (ext === ".pptx") return pptxStats(bytes);
  if (ext === ".xlsx" || ext === ".xlsm") return xlsxStats(bytes);
  const r = await readDocumentSections(bytes, ext, {});
  if (ext === ".pdf") {
    const per = r.sections.map((s) => countWords(s.text));
    const total = per.reduce((a, b) => a + b, 0);
    const lines = ["[PDF]", `Số trang: ${fmt(r.sections.length)} · Số từ: ${fmt(total)} · Thời gian đọc: ${minutes(total)}`];
    if (r.note) lines.push(`⚠ ${r.note}`);
    else if (per.length) lines.push(`Từ mỗi trang: ${per.slice(0, 40).map((n, i) => `${i + 1}:${n}`).join(", ")}${per.length > 40 ? ", …" : ""}`);
    return lines.join("\n");
  }
  const text = r.sections.map((s) => s.text).join("\n");
  const c = charsOf(text);
  const w = countWords(text);
  const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return [`[${r.kind}]`, `Số từ: ${fmt(w)} · Ký tự: ${fmt(c.all)} (không tính khoảng trắng: ${fmt(c.noSpace)})`, `Dòng: ${fmt(text.split(/\r?\n/).length)} (không trống: ${fmt(nonEmpty)})`, `Số trang A4 ước lượng: ~${Math.max(1, Math.ceil(w / WORDS_PER_PAGE))} · Thời gian đọc: ${minutes(w)}`].join("\n");
}
