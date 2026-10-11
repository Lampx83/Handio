/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Env } from "../env";
import { relPath, resolveSafe, ToolError, type Tool, type ToolContext } from "../tools";
import { sniffImage } from "../vision";
import { commit, jsonArg, kb, outlinePreview, prepareWrite } from "./tools";
import { extOf, formatSections } from "./readdoc";

/** PDF: pdf_info, pdf_text, pdf_split, pdf_merge, pdf_rotate, images_to_pdf. (Mỗi công cụ: mô tả tiếng Anh cho mô hình, thông báo lỗi tiếng Việt, kiểm thử riêng — xem AGENTS.md.) */

const S = { type: "string" } as const;
const MAX_PDF = 60 * 1024 * 1024; // mỗi tệp PDF; khi gộp: tổng các tệp đầu vào
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_PAGES = 2000;
const MAX_FILES = 50; // số tệp đầu ra khi tách / số tệp đầu vào khi gộp
const MAX_IMAGES = 300;
const A4: [number, number] = [595.28, 841.89];
const MAX_PAGE_PT = 14400; // giới hạn kích thước trang của PDF

const NO_PASSWORD = "Công cụ không gỡ được mật khẩu. Hãy mở tệp bằng trình xem PDF (nhập mật khẩu nếu có), lưu/in thành bản PDF mới không mã hoá rồi thử lại.";

/** Tên đầu ra mặc định: "<tên>-<hậu tố>.pdf" cạnh tệp gốc (bỏ đuôi .pdf/đuôi ảnh nếu có). */
const named = (raw: unknown, suffix: string): string => String(raw ?? "").replace(/(\.(pdf|png|jpe?g|gif|webp))?$/i, "") + suffix + ".pdf";

/** Mô hình đôi khi gửi mảng dưới dạng chuỗi JSON hoặc một chuỗi đơn: chấp nhận cả ba. */
function listArg(v: unknown, what: string): string[] {
  const arr = typeof v === "string" && !v.trim().startsWith("[") ? [v] : jsonArg<unknown>(v, what);
  if (!Array.isArray(arr) || !arr.length || arr.some((x) => typeof x !== "string" || !x.trim())) throw new ToolError(`${what} phải là danh sách đường dẫn tệp.`, "bad_args");
  return arr as string[];
}
const firstOf = (v: unknown): string => {
  try {
    return listArg(v, "paths")[0];
  } catch {
    return "";
  }
};

/** "1-3,5,8-" → [1,2,3,5,8,…]. Giữ đúng thứ tự người dùng gõ. */
export function parsePageRanges(spec: unknown, total: number): number[] {
  const raw = typeof spec === "number" ? String(spec) : String(spec ?? "");
  const s = raw.trim().toLowerCase().replace(/\s*[-–—]\s*/g, "-");
  if (!s) throw new ToolError(`Thiếu dải trang (ví dụ "1-3,5"; PDF này có ${total} trang).`, "bad_args");
  if (/^(all|\*|tất cả|tat ca)$/.test(s)) return Array.from({ length: total }, (_, i) => i + 1);
  const out: number[] = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!m) throw new ToolError(`Dải trang “${part}” không hợp lệ. Dùng số trang hoặc dải, cách nhau dấu phẩy, ví dụ "1-3,5" (PDF này có ${total} trang).`, "bad_args");
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === "" ? total : Number(m[2]);
    if (a < 1 || b < a || b > total) throw new ToolError(`Dải trang “${part}” nằm ngoài PDF này (có ${total} trang, đánh số từ 1).`, "bad_args");
    for (let p = a; p <= b; p++) {
      out.push(p);
      if (out.length > MAX_PAGES * 2) throw new ToolError("Dải trang quá dài.", "bad_args");
    }
  }
  return out;
}

/** [1,2,3,5] → "1-3, 5" */
function compact(pages: number[]): string {
  const ps = [...new Set(pages)].sort((x, y) => x - y);
  const parts: string[] = [];
  for (let i = 0; i < ps.length; ) {
    let j = i;
    while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
    parts.push(j > i ? `${ps[i]}-${ps[j]}` : String(ps[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

async function statFile(ctx: ToolContext, raw: unknown, exts: string[], limit: number, what: string): Promise<{ abs: string; rel: string; size: number; mtimeMs: number }> {
  const abs = await resolveSafe(ctx, raw);
  const st = await ctx.env.stat(abs);
  if (!st) throw new ToolError(`Không có tệp ${raw}.`, "not_found");
  if (st.isDir) throw new ToolError(`${raw} là thư mục.`, "wrong_type");
  if (exts.length && !exts.includes(extOf(abs))) throw new ToolError(`${raw}: công cụ này chỉ dùng cho ${what}.`, "wrong_type");
  if (st.size > limit) throw new ToolError(`${raw} quá lớn (${Math.round(st.size / 1048576)} MB, giới hạn ${Math.round(limit / 1048576)} MB).`, "bad_args");
  return { abs, rel: relPath(ctx, abs), size: st.size, mtimeMs: st.mtimeMs };
}

function checkHeader(bytes: Uint8Array, rel: string): void {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new ToolError(`${rel} không phải tệp PDF hợp lệ (hỏng hoặc sai định dạng).`, "wrong_type");
}

async function loadPdf(ctx: ToolContext, raw: unknown): Promise<{ abs: string; rel: string; bytes: Uint8Array }> {
  const f = await statFile(ctx, raw, [".pdf"], MAX_PDF, ".pdf");
  const bytes = await ctx.env.readBytes(f.abs);
  checkHeader(bytes, f.rel);
  return { abs: f.abs, rel: f.rel, bytes };
}

/** Mở bằng pdf-lib để sửa/ghép. PDF có mật khẩu: báo lỗi (không bẻ khoá). */
async function openEditable(bytes: Uint8Array, rel: string): Promise<any> {
  const { PDFDocument } = await import("pdf-lib");
  let doc;
  let n = 0;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (!doc.isEncrypted) {
      doc.getPages(); // duyệt cây trang: PDF hỏng nặng báo lỗi ở đây
      n = doc.getPageCount();
    }
  } catch (e) {
    throw new ToolError(`${rel} bị hỏng hoặc không đọc được (${(e as Error).message}).`, "wrong_type");
  }
  if (doc.isEncrypted) throw new ToolError(`${rel} có mật khẩu/được mã hoá nên không tách, gộp hay xoay được. ${NO_PASSWORD}`, "unsupported");
  if (n < 1) throw new ToolError(`${rel} không có trang nào.`, "wrong_type");
  if (n > MAX_PAGES) throw new ToolError(`${rel} có ${n} trang, vượt giới hạn ${MAX_PAGES} trang.`, "bad_args");
  return doc;
}

/** Lỗi bất ngờ của pdf-lib khi dựng/lưu (PDF cấu trúc lạ) → thông báo tiếng Việt. */
async function building<T>(rel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(`Không xử lý được ${rel}: cấu trúc PDF bất thường (${(e as Error).message}).`, "wrong_type");
  }
}
const relList = (infos: { rel: string }[]): string => infos.map((f) => f.rel).join(", ");

/** Mở bằng pdf.js (đọc chữ, kích thước, thông tin). PDF cần mật khẩu để mở: báo lỗi. */
async function openReadable(bytes: Uint8Array, rel: string): Promise<any> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, disableFontFace: true, stopAtErrors: false } as never);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "PasswordException" || /password/i.test(err?.message ?? "")) throw new ToolError(`${rel} có mật khẩu nên không đọc được. ${NO_PASSWORD}`, "unsupported");
    throw new ToolError(`${rel} bị hỏng hoặc không đọc được (${err?.message ?? e}).`, "wrong_type");
  }
  if (pdf.numPages > MAX_PAGES) {
    await pdf.destroy?.();
    throw new ToolError(`${rel} có ${pdf.numPages} trang, vượt giới hạn ${MAX_PAGES} trang.`, "bad_args");
  }
  return pdf;
}

async function pageText(pdf: any, n: number): Promise<string> {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  return (content.items as any[]).filter((it) => it.str != null).map((it) => it.str + (it.hasEOL ? "\n" : "")).join("").trim();
}

const pdfDate = (s: unknown): string => {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(String(s ?? ""));
  return m ? [m[3], m[2], m[1]].filter(Boolean).join("/") : "";
};

const SIZES: [string, number, number][] = [["A5", 148, 210], ["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["Letter", 216, 279], ["Legal", 216, 356]];
function sizeName(wMm: number, hMm: number): string {
  const [w, h] = [Math.round(wMm), Math.round(hMm)];
  const portrait = w <= h;
  const [lo, hi] = portrait ? [w, h] : [h, w];
  const hit = SIZES.find(([, sw, sh]) => Math.abs(sw - lo) <= 2 && Math.abs(sh - hi) <= 2);
  return `${hit ? hit[0] + " " + (portrait ? "dọc" : "ngang") + ", " : ""}${w}×${h} mm`;
}

/** Hướng chụp EXIF ("Orientation": 1, 3, 6, 8…) của ảnh JPEG; 1 nếu không có/không đọc được. */
export function jpegOrientation(b: Uint8Array): number {
  try {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        const t = i + 10; // đầu khối TIFF
        const le = b[t] === 0x49;
        const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const u32 = (o: number) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
        const ifd = t + u32(t + 4);
        const n = u16(ifd);
        for (let k = 0; k < n && k < 64; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) return u16(e + 8);
        }
        return 1;
      }
      if (marker === 0xda || marker === 0xd9) break;
      i += 2 + len;
    }
  } catch {
    /* coi như không có */
  }
  return 1;
}

export function pdfTools(_env: Env): Tool[] {
  return [
    {
      name: "pdf_info", kind: "read", readonly: true, pathArg: "path",
      description: "Show facts about a PDF file: page count, page size(s), title/author/creation date, whether it is password-protected/encrypted, and whether it has a text layer. A PDF without a text layer is a scan (images of pages): pdf_text and read_document cannot read its text and there is NO built-in OCR or page-to-image export here — the pages must first exist as image files (png/jpg: scans or photos), which read_image can then transcribe; otherwise ask the user for the original Word/PDF-with-text. Call this before splitting/rotating so page numbers are valid.",
      parameters: { type: "object", properties: { path: S }, required: ["path"] },
      summarize: (a) => String(a.path ?? ""),
      async run(ctx, a) {
        const { abs, rel, bytes } = await loadPdf(ctx, a.path);
        let encrypted: boolean | null = null;
        try {
          const { PDFDocument } = await import("pdf-lib");
          encrypted = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted;
        } catch {
          /* pdf.js bên dưới sẽ báo hỏng nếu thật sự hỏng */
        }
        const pdf = await openReadable(bytes, rel);
        try {
          const n: number = pdf.numPages;
          const groups = new Map<string, number[]>();
          for (let i = 1; i <= n; i++) {
            const page = await pdf.getPage(i);
            const [x1, y1, x2, y2] = page.view as number[];
            const rot = ((page.rotate ?? 0) % 360 + 360) % 360;
            let w = Math.abs(x2 - x1);
            let h = Math.abs(y2 - y1);
            if (rot === 90 || rot === 270) [w, h] = [h, w];
            const label = sizeName((w * 25.4) / 72, (h * 25.4) / 72);
            (groups.get(label) ?? groups.set(label, []).get(label)!).push(i);
          }
          let info: Record<string, unknown> = {};
          try {
            info = ((await pdf.getMetadata()).info ?? {}) as Record<string, unknown>;
          } catch {
            /* không có thông tin tài liệu */
          }
          // Lớp chữ: lấy mẫu tối đa 6 trang rải đều
          const sample = [...new Set(Array.from({ length: Math.min(6, n) }, (_, k) => 1 + Math.floor((k * n) / Math.min(6, n))))];
          let chars = 0;
          for (const p of sample) chars += (await pageText(pdf, p)).replace(/\s+/g, "").length;
          const hasText = chars >= 10 * sample.length;
          const st = await ctx.env.stat(abs);
          if (st) ctx.readFiles.set(abs, st.mtimeMs);
          const lines = [`${rel} (${kb(bytes.length)})`, `Số trang: ${n}`];
          const gs = [...groups.entries()];
          lines.push("Khổ trang: " + (gs.length === 1 ? gs[0][0] : gs.slice(0, 6).map(([k, v]) => `${k} (trang ${compact(v)})`).join("; ") + (gs.length > 6 ? "; …" : "")));
          const meta: [string, unknown][] = [["Tiêu đề", info.Title], ["Tác giả", info.Author], ["Chủ đề", info.Subject], ["Tạo bằng", info.Creator || info.Producer], ["Ngày tạo", pdfDate(info.CreationDate)]];
          for (const [k, v] of meta) if (typeof v === "string" && v.trim()) lines.push(`${k}: ${v.trim().slice(0, 200)}`);
          lines.push("Mật khẩu/mã hoá: " + (encrypted ? "có mã hoá (mở được không cần mật khẩu, nhưng tách/gộp/xoay không dùng được; pdf_text vẫn đọc được)" : encrypted === false ? "không" : "không xác định"));
          lines.push(hasText ? `Lớp chữ: có (lấy mẫu ${sample.length} trang, đọc được chữ).` : `⚠ Lớp chữ: KHÔNG có (lấy mẫu ${sample.length} trang gần như không có chữ) — nhiều khả năng là bản scan/ảnh. pdf_text sẽ không lấy được chữ. Chưa có OCR hay xuất trang PDF thành ảnh trong công cụ này: cần có ảnh các trang (png/jpg) rồi dùng read_image để chép chữ, hoặc xin bản gốc dạng văn bản.`);
          return lines.join("\n");
        } finally {
          await pdf.destroy?.();
        }
      },
    },
    {
      name: "pdf_text", kind: "read", readonly: true, pathArg: "path",
      description: "Extract the text of a PDF page by page (each page is labelled 'Trang N'). pages = which pages, e.g. '1-3,5' or '8-' (default: all). Only works for PDFs that have a text layer; scans return empty pages (see pdf_info). Long output is paged: continue with offset.",
      parameters: { type: "object", properties: { path: S, pages: { type: "string", description: "e.g. '1-3,5' (default: all pages)" }, offset: { type: "integer", description: "continue reading from this character offset" }, max_chars: { type: "integer", description: "default 12000, max 30000" } }, required: ["path"] },
      summarize: (a) => String(a.path ?? "") + (a.pages ? ` [trang ${a.pages}]` : ""),
      async run(ctx, a) {
        const { abs, rel, bytes } = await loadPdf(ctx, a.path);
        const pdf = await openReadable(bytes, rel);
        try {
          const total: number = pdf.numPages;
          const want = a.pages == null || String(a.pages).trim() === "" ? Array.from({ length: total }, (_, i) => i + 1) : [...new Set(parsePageRanges(a.pages, total))].sort((x, y) => x - y);
          const sections = [];
          let chars = 0;
          for (const p of want) {
            const t = await pageText(pdf, p);
            chars += t.replace(/\s+/g, "").length;
            sections.push({ label: `Trang ${p}`, text: t || "(trang không có chữ)" });
          }
          const st = await ctx.env.stat(abs);
          if (st) ctx.readFiles.set(abs, st.mtimeMs);
          const note = chars < 10 * Math.max(1, want.length) ? "Các trang này gần như không có lớp chữ (có thể là bản scan/ảnh). Chưa có OCR hay xuất trang thành ảnh: cần ảnh các trang (png/jpg) rồi dùng read_image, hoặc xin bản gốc dạng văn bản." : undefined;
          const head = `PDF ${total} trang; đã lấy ${want.length === total ? "tất cả" : "trang " + compact(want)}.\n`;
          return head + formatSections({ kind: "PDF", sections, note }, Math.max(0, Math.floor(Number(a.offset) || 0)), Math.max(1000, Math.min(Math.floor(Number(a.max_chars) || 12000), 30000)));
        } finally {
          await pdf.destroy?.();
        }
      },
    },
    {
      name: "pdf_split", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.output || named(a.path, "-tach"),
      description: `Extract pages of a PDF into a NEW PDF, or cut a PDF into several files. ranges = pages to keep in one new file, e.g. '1-3,7' (a JSON list of such strings makes one file per item); split_every = N makes one file for every N pages (max ${MAX_FILES} files). Give ranges OR split_every. The original is never changed; output defaults to '<name>-tach.pdf' next to it (with several files: '<name>-tach-1.pdf', '-2', …; output then acts as the base name). Password-protected PDFs are refused.`,
      parameters: { type: "object", properties: { path: S, ranges: { type: "string", description: "pages to extract, e.g. '1-3,7'" }, split_every: { type: "integer", description: "cut into files of N pages each" }, output: { type: "string", description: "new .pdf path (default: <name>-tach.pdf)" } }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""} → ${a.output || named(a.path, "-tach")}` + (a.split_every ? ` (mỗi ${a.split_every} trang)` : a.ranges ? ` [trang ${typeof a.ranges === "string" ? a.ranges : JSON.stringify(a.ranges)}]` : ""),
      async preview(ctx, a) {
        return outlinePreview(ctx, a.output || named(a.path, "-tach"), `Tách ${a.split_every ? `mỗi ${a.split_every} trang` : `trang ${typeof a.ranges === "string" ? a.ranges : JSON.stringify(a.ranges ?? "")}`} của ${a.path} thành PDF mới. Bản gốc giữ nguyên.`);
      },
      async run(ctx, a) {
        const hasRanges = !(a.ranges == null || a.ranges === "" || (Array.isArray(a.ranges) && !a.ranges.length));
        const hasEvery = !(a.split_every == null || a.split_every === "");
        if (hasRanges === hasEvery) throw new ToolError(hasRanges ? "Chỉ dùng một trong hai: ranges hoặc split_every." : "Cần ranges (vd \"1-3,7\") hoặc split_every (vd 10).", "bad_args");
        const { abs, rel, bytes } = await loadPdf(ctx, a.path);
        const src = await openEditable(bytes, rel);
        const total: number = src.getPageCount();
        let parts: number[][] = [];
        if (hasEvery) {
          const n = Math.floor(Number(a.split_every));
          if (!Number.isFinite(n) || n < 1) throw new ToolError("split_every phải là số nguyên từ 1 trở lên.", "bad_args");
          if (n >= total) throw new ToolError(`PDF chỉ có ${total} trang, không cần cắt mỗi ${n} trang.`, "bad_args");
          const count = Math.ceil(total / n);
          if (count > MAX_FILES) throw new ToolError(`Cắt mỗi ${n} trang sẽ ra ${count} tệp, vượt giới hạn ${MAX_FILES}. Hãy tăng split_every lên ít nhất ${Math.ceil(total / MAX_FILES)}.`, "bad_args");
          for (let p = 1; p <= total; p += n) parts.push(Array.from({ length: Math.min(n, total - p + 1) }, (_, i) => p + i));
        } else {
          const list = Array.isArray(a.ranges) || (typeof a.ranges === "string" && a.ranges.trim().startsWith("[")) ? listArg(a.ranges, "ranges") : [a.ranges];
          if (list.length > MAX_FILES) throw new ToolError(`Tối đa ${MAX_FILES} tệp một lần.`, "bad_args");
          parts = list.map((r) => parsePageRanges(r, total));
        }
        const base = String(a.output || named(a.path, "-tach"));
        if (extOf(base) !== ".pdf") throw new ToolError(`output phải có đuôi .pdf (nhận “${base}”).`, "bad_args");
        const width = String(parts.length).length;
        const names = parts.length === 1 ? [base] : parts.map((_, i) => base.replace(/\.pdf$/i, `-${String(i + 1).padStart(width, "0")}.pdf`));
        // Kiểm tra mọi đích trước khi ghi bất kỳ tệp nào
        const dests: { abs: string; existed: boolean }[] = [];
        for (const nm of names) {
          const d = await prepareWrite(ctx, nm, ".pdf");
          if (d.abs === abs) throw new ToolError(`Không ghi đè bản gốc ${rel}. Hãy chọn tên khác trong output.`, "bad_args");
          dests.push(d);
        }
        const { PDFDocument } = await import("pdf-lib");
        const done: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          const out = await PDFDocument.create();
          const data = await building(rel, async () => {
            const pages = await out.copyPages(src, parts[i].map((p) => p - 1));
            pages.forEach((p: any) => out.addPage(p));
            return out.save();
          });
          await commit(ctx, dests[i].abs, data, dests[i].existed);
          done.push(`${relPath(ctx, dests[i].abs)}: ${parts[i].length} trang (${compact(parts[i])}), ${kb(data.length)}`);
        }
        return `Đã tách ${rel} (${total} trang) thành ${done.length} tệp. Bản gốc giữ nguyên.\n` + done.join("\n");
      },
    },
    {
      name: "pdf_merge", kind: "edit", readonly: false, pathArg: "output", targetPath: (a) => a.output || named(firstOf(a.paths), "-gop"),
      description: `Merge several PDFs, in the given order, into ONE new PDF (2 to ${MAX_FILES} files). The inputs are never changed; output defaults to '<first name>-gop.pdf'. Password-protected PDFs are refused.`,
      parameters: { type: "object", properties: { paths: { type: "array", items: S, description: "PDF files in the order they should appear" }, output: { type: "string", description: "new .pdf path (default: <first name>-gop.pdf)" } }, required: ["paths"] },
      summarize: (a) => {
        let n = 0;
        try { n = listArg(a.paths, "paths").length; } catch { /* bỏ qua */ }
        return `${n} tệp → ${a.output || named(firstOf(a.paths), "-gop")}`;
      },
      async preview(ctx, a) {
        let list: string[] = [];
        try { list = listArg(a.paths, "paths"); } catch { /* bỏ qua */ }
        return outlinePreview(ctx, a.output || named(list[0], "-gop"), `Gộp ${list.length} PDF theo thứ tự:\n` + list.slice(0, 12).map((p, i) => `  ${i + 1}. ${p}`).join("\n"));
      },
      async run(ctx, a) {
        const list = listArg(a.paths, "paths");
        if (list.length < 2) throw new ToolError("Cần ít nhất 2 tệp PDF để gộp.", "bad_args");
        if (list.length > MAX_FILES) throw new ToolError(`Tối đa ${MAX_FILES} tệp một lần gộp.`, "bad_args");
        const infos = [];
        let size = 0;
        for (const p of list) {
          const f = await statFile(ctx, p, [".pdf"], MAX_PDF, ".pdf");
          size += f.size;
          infos.push(f);
        }
        if (size > MAX_PDF) throw new ToolError(`Tổng dung lượng các tệp (${Math.round(size / 1048576)} MB) vượt giới hạn ${Math.round(MAX_PDF / 1048576)} MB.`, "bad_args");
        const outRaw = String(a.output || named(list[0], "-gop"));
        const dest = await prepareWrite(ctx, outRaw, ".pdf");
        const hit = infos.find((f) => f.abs === dest.abs);
        if (hit) throw new ToolError(`Không ghi đè tệp đầu vào ${hit.rel}. Hãy chọn tên khác trong output.`, "bad_args");
        const { PDFDocument } = await import("pdf-lib");
        const out = await PDFDocument.create();
        const lines: string[] = [];
        for (const f of infos) {
          const bytes = await ctx.env.readBytes(f.abs);
          checkHeader(bytes, f.rel);
          const doc = await openEditable(bytes, f.rel);
          const n: number = doc.getPageCount();
          if (out.getPageCount() + n > MAX_PAGES) throw new ToolError(`Tổng số trang vượt giới hạn ${MAX_PAGES}.`, "bad_args");
          await building(f.rel, async () => {
            const pages = await out.copyPages(doc, doc.getPageIndices());
            pages.forEach((p: any) => out.addPage(p));
          });
          lines.push(`  ${f.rel}: ${n} trang`);
        }
        const data: Uint8Array = await building(relList(infos), () => out.save());
        await commit(ctx, dest.abs, data, dest.existed);
        return `Đã gộp ${infos.length} tệp thành ${relPath(ctx, dest.abs)} (${out.getPageCount()} trang, ${kb(data.length)}). Các tệp gốc giữ nguyên.\n` + lines.join("\n");
      },
    },
    {
      name: "pdf_rotate", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || named(a.path, "-xoay"),
      description: "Rotate pages of a PDF clockwise by 90, 180 or 270 degrees (added to each page's current rotation) and save the result as a NEW file; the original is never changed (save_as defaults to '<name>-xoay.pdf'). pages = which pages, e.g. '2,4-6' (default: all). Password-protected PDFs are refused.",
      parameters: { type: "object", properties: { path: S, degrees: { type: "integer", enum: [90, 180, 270], description: "clockwise" }, pages: { type: "string", description: "e.g. '2,4-6' (default: all pages)" }, save_as: { type: "string", description: "new .pdf path (default: <name>-xoay.pdf)" } }, required: ["path", "degrees"] },
      summarize: (a) => `${a.path ?? ""} ${a.degrees ?? ""}°${a.pages ? ` [trang ${a.pages}]` : ""} → ${a.save_as || named(a.path, "-xoay")}`,
      async preview(ctx, a) {
        return outlinePreview(ctx, a.save_as || named(a.path, "-xoay"), `Xoay ${a.pages ? "trang " + a.pages : "tất cả các trang"} của ${a.path} ${a.degrees}° theo chiều kim đồng hồ, lưu thành bản mới. Bản gốc giữ nguyên.`);
      },
      async run(ctx, a) {
        const d = Number(a.degrees);
        const deg = Number.isInteger(d) ? ((d % 360) + 360) % 360 : NaN;
        if (![90, 180, 270].includes(deg)) throw new ToolError("degrees phải là 90, 180 hoặc 270 (theo chiều kim đồng hồ).", "bad_args");
        const { abs, rel, bytes } = await loadPdf(ctx, a.path);
        const doc = await openEditable(bytes, rel);
        const total: number = doc.getPageCount();
        const pages = a.pages == null || String(a.pages).trim() === "" ? Array.from({ length: total }, (_, i) => i + 1) : [...new Set(parsePageRanges(a.pages, total))];
        const dest = await prepareWrite(ctx, a.save_as || named(a.path, "-xoay"), ".pdf");
        if (dest.abs === abs) throw new ToolError(`Không ghi đè bản gốc ${rel}. Hãy chọn tên khác trong save_as.`, "bad_args");
        const { degrees } = await import("pdf-lib");
        const all = doc.getPages();
        for (const p of pages) {
          const page = all[p - 1];
          page.setRotation(degrees((page.getRotation().angle + deg) % 360));
        }
        const data: Uint8Array = await building(rel, () => doc.save());
        await commit(ctx, dest.abs, data, dest.existed);
        return `Đã xoay ${pages.length === total ? "tất cả " + total : pages.length} trang${pages.length === total ? "" : " (" + compact(pages) + ")"} ${deg}° theo chiều kim đồng hồ, lưu thành ${relPath(ctx, dest.abs)} (${kb(data.length)}). Bản gốc giữ nguyên.`;
      },
    },
    {
      name: "images_to_pdf", kind: "edit", readonly: false, pathArg: "output", targetPath: (a) => a.output || named(firstOf(a.paths), "-ghep"),
      description: `Combine PNG/JPG images into ONE new PDF, one image per page, in the given order (up to ${MAX_IMAGES} images). page_size 'a4' (default) = A4 page (portrait, or landscape for a wide image), image scaled to fit and centered, aspect ratio kept; 'fit' = each page has exactly the image's pixel size. Phone-photo (EXIF) rotation is applied. GIF/WebP are not supported. The images are never changed; output defaults to '<first name>-ghep.pdf'.`,
      parameters: { type: "object", properties: { paths: { type: "array", items: S, description: "image files (png/jpg) in page order" }, output: { type: "string", description: "new .pdf path (default: <first name>-ghep.pdf)" }, page_size: { type: "string", enum: ["a4", "fit"] } }, required: ["paths"] },
      summarize: (a) => {
        let n = 0;
        try { n = listArg(a.paths, "paths").length; } catch { /* bỏ qua */ }
        return `${n} ảnh → ${a.output || named(firstOf(a.paths), "-ghep")}${a.page_size ? ` (${a.page_size})` : ""}`;
      },
      async preview(ctx, a) {
        let list: string[] = [];
        try { list = listArg(a.paths, "paths"); } catch { /* bỏ qua */ }
        return outlinePreview(ctx, a.output || named(list[0], "-ghep"), `Ghép ${list.length} ảnh thành PDF (${String(a.page_size || "a4").toLowerCase() === "fit" ? "trang đúng cỡ ảnh" : "khổ A4"}):\n` + list.slice(0, 12).map((p, i) => `  ${i + 1}. ${p}`).join("\n"));
      },
      async run(ctx, a) {
        const list = listArg(a.paths, "paths");
        if (list.length > MAX_IMAGES) throw new ToolError(`Tối đa ${MAX_IMAGES} ảnh một lần.`, "bad_args");
        const mode = String(a.page_size ?? "a4").toLowerCase();
        if (mode !== "a4" && mode !== "fit") throw new ToolError('page_size phải là "a4" hoặc "fit".', "bad_args");
        const infos = [];
        let size = 0;
        for (const p of list) {
          const f = await statFile(ctx, p, [], MAX_IMAGE, "ảnh");
          size += f.size;
          infos.push(f);
        }
        if (size > MAX_PDF) throw new ToolError(`Tổng dung lượng ảnh (${Math.round(size / 1048576)} MB) vượt giới hạn ${Math.round(MAX_PDF / 1048576)} MB.`, "bad_args");
        const dest = await prepareWrite(ctx, a.output || named(list[0], "-ghep"), ".pdf");
        const hit = infos.find((f) => f.abs === dest.abs);
        if (hit) throw new ToolError(`Không ghi đè tệp ảnh ${hit.rel}. Hãy chọn tên .pdf khác trong output.`, "bad_args");
        const { PDFDocument, degrees } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        for (const f of infos) {
          const bytes = await ctx.env.readBytes(f.abs);
          const mime = sniffImage(bytes);
          if (mime !== "image/png" && mime !== "image/jpeg") throw new ToolError(mime ? `${f.rel}: ảnh ${mime.slice(6).toUpperCase()} chưa ghép được; hãy chuyển sang PNG hoặc JPG.` : `${f.rel} không phải ảnh PNG/JPG đọc được.`, "unsupported");
          let img;
          try {
            img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          } catch (e) {
            throw new ToolError(`${f.rel}: không đọc được ảnh (${(e as Error).message}).`, "wrong_type");
          }
          const orient = mime === "image/jpeg" ? jpegOrientation(bytes) : 1;
          const swap = orient === 6 || orient === 8;
          const dw = swap ? img.height : img.width; // kích thước khi hiển thị đúng chiều
          const dh = swap ? img.width : img.height;
          let pw: number, ph: number, k: number;
          if (mode === "fit") {
            k = Math.min(1, MAX_PAGE_PT / Math.max(dw, dh));
            if (Math.min(dw, dh) * k < 3) k = 3 / Math.min(dw, dh);
            pw = dw * k;
            ph = dh * k;
          } else {
            [pw, ph] = dw > dh ? [A4[1], A4[0]] : A4;
            k = Math.min(pw / dw, ph / dh);
          }
          const page = doc.addPage([pw, ph]);
          const x0 = (pw - dw * k) / 2;
          const y0 = (ph - dh * k) / 2;
          const w = img.width * k; // kích thước ảnh lưu (trước khi xoay)
          const h = img.height * k;
          if (orient === 3) page.drawImage(img, { x: x0 + w, y: y0 + h, width: w, height: h, rotate: degrees(180) });
          else if (orient === 6) page.drawImage(img, { x: x0, y: y0 + w, width: w, height: h, rotate: degrees(-90) });
          else if (orient === 8) page.drawImage(img, { x: x0 + h, y: y0, width: w, height: h, rotate: degrees(90) });
          else page.drawImage(img, { x: x0, y: y0, width: w, height: h });
        }
        const data: Uint8Array = await doc.save();
        await commit(ctx, dest.abs, data, dest.existed);
        return `Đã ghép ${infos.length} ảnh thành ${relPath(ctx, dest.abs)} (${infos.length} trang, ${mode === "fit" ? "đúng cỡ ảnh" : "khổ A4"}, ${kb(data.length)}). Ảnh gốc giữ nguyên.`;
      },
    },
  ];
}
