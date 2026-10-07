import { docxToMarkdown } from "./docx-read";
import { readPptx } from "./pptx";
import { readXlsx } from "./xlsx";

export const OFFICE_EXT = [".docx", ".xlsx", ".xlsm", ".pptx", ".pdf"] as const;
const TEXT_EXT = [".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml", ".ini", ".rtf"];
const LEGACY = [".doc", ".xls", ".ppt"];

export const extOf = (p: string): string => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
};
export const isOfficeFile = (p: string): boolean => (OFFICE_EXT as readonly string[]).includes(extOf(p));
export const isReadableDocument = (p: string): boolean => isOfficeFile(p) || TEXT_EXT.includes(extOf(p));

export interface DocSection {
  label: string;
  text: string;
}
export interface ReadDocOptions {
  sheet?: string;
  range?: string;
}

export async function readDocumentSections(bytes: Uint8Array, ext: string, o: ReadDocOptions = {}): Promise<{ kind: string; sections: DocSection[]; note?: string }> {
  if (LEGACY.includes(ext)) throw new Error(`Định dạng cũ ${ext} chưa đọc được. Hãy mở bằng Word/Excel/PowerPoint và lưu lại thành ${ext}x.`);
  if (ext === ".docx") return { kind: "Word", sections: [{ label: "", text: await docxToMarkdown(bytes) }] };
  if (ext === ".xlsx" || ext === ".xlsm") return { kind: "Excel", sections: (await readXlsx(bytes, o)).map((s) => ({ label: `Sheet “${s.name}” (${s.summary})`, text: s.text })) };
  if (ext === ".pptx") return { kind: "PowerPoint", sections: await readPptx(bytes) };
  if (ext === ".pdf") {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, disableFontFace: true, stopAtErrors: false } as never);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text as string[];
    const total = pages.reduce((n, p) => n + p.trim().length, 0);
    return { kind: "PDF", sections: pages.map((t, i) => ({ label: `Trang ${i + 1}`, text: t.trim() })), note: total < 20 * Math.max(1, pages.length) ? "PDF gần như không có lớp chữ (có thể là bản scan/ảnh). Chưa hỗ trợ OCR: hãy dùng bản gốc dạng Word/PDF văn bản." : undefined };
  }
  if (TEXT_EXT.includes(ext) || ext === "") return { kind: "Văn bản", sections: [{ label: "", text: new TextDecoder().decode(bytes) }] };
  throw new Error(`Chưa hỗ trợ đọc định dạng ${ext}. Hỗ trợ: .docx .xlsx .pptx .pdf và các file văn bản (.txt .md .csv …).`);
}

/**
 * Các "đoạn" của văn bản Markdown để trích dẫn: mỗi dòng không trống là một đoạn (tiêu đề, đoạn văn, mục danh sách),
 * một bảng (các dòng liền nhau bắt đầu bằng "|") là một đoạn. Số thứ tự đoạn chính là "đoạn N".
 */
export function mdBlocks(text: string): string[] {
  const out: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (table.length) out.push(table.join("\n"));
    table = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*\|/.test(line)) table.push(line);
    else {
      flush();
      if (line.trim()) out.push(line);
    }
  }
  flush();
  return out;
}

/** Đánh số đoạn (¶N) cho Word/văn bản để trích nguồn được: số đoạn trùng với "đoạn N" trong ký hiệu [[tệp|đoạn N]]. */
function numberBlocks(text: string): string {
  return mdBlocks(text).map((b, i) => `¶${i + 1}${b.includes("\n") ? "\n" : " "}${b}`).join("\n");
}

export function formatSections(r: { kind: string; sections: DocSection[]; note?: string }, offset = 0, maxChars = 12000, cite = false): string {
  const numbered = cite && (r.kind === "Word" || r.kind === "Văn bản");
  const full = r.sections.map((s) => (s.label ? `## ${s.label}\n${s.text}` : numbered ? numberBlocks(s.text) : s.text)).join("\n\n");
  const slice = full.slice(offset, offset + maxChars);
  const rest = full.length - (offset + slice.length);
  return (
    `[${r.kind} — ${full.length} ký tự]\n` +
    (r.note ? `⚠ ${r.note}\n` : "") +
    slice +
    (rest > 0 ? `\n… (còn ${rest} ký tự; đọc tiếp bằng offset=${offset + slice.length})` : "")
  );
}

/** Bỏ dấu tiếng Việt, hạ chữ thường: để tìm "nguyen" khớp "Nguyễn". */
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
