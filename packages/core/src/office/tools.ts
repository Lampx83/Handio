/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Env } from "../env";
import { dirname, join } from "../path";
import { checkFresh, pushUndo, relPath, remember, resolveSafe, ToolError, walk, type DiffPreview, type Tool, type ToolContext } from "../tools";
import { createDocx, describeDocx, type Letterhead, type Signature } from "./docx-write";
import { docxReplace } from "./docx-read";
import { docxSuggest } from "./track";
import { documentUnits } from "./locate";
import { countsLine, isNotable, scanDocumentPii } from "./pii";
import { createPptx, describePptx, pptxImageRefs, PPTX_THEMES } from "./pptx";
import { editDocx, type DocxEditOptions } from "./docx-edit";
import { editPptx, type PptxEditOptions } from "./pptx-edit";
import { filesTools } from "./tools-files";
import { pdfTools } from "./tools-pdf";
import { renderTools } from "./tools-render";
import { utilTools } from "./tools-utils";
import { citeToken } from "./locate";
import { extOf, fold, formatSections, isReadableDocument, readDocumentSections } from "./readdoc";
import { createXlsx, describeXlsx, editXlsx, sheetRowCount, type SheetSpec } from "./xlsx";
import { genHeader, generateRows, validateGen, type GenSpec } from "./gen";

const S = { type: "string" } as const;

/** Cảnh báo ngắn khi tài liệu vừa đọc có dữ liệu cá nhân đáng kể (không bao giờ nêu giá trị). */
async function piiNote(bytes: Uint8Array, ext: string): Promise<string> {
  try {
    const rep = await scanDocumentPii(bytes, ext, 0, true);
    return isNotable(rep.counts) ? `\n⚠ Có dữ liệu cá nhân (${countsLine(rep.counts)}). Nếu nội dung sẽ được gửi/chia sẻ ra ngoài: nhắc người dùng bằng một câu và đề nghị che bằng redact_pii.` : "";
  } catch {
    return "";
  }
}
const MAX_FILE = 25 * 1024 * 1024;

/** Mô hình đôi khi gửi mảng/đối tượng dưới dạng chuỗi JSON: chấp nhận cả hai. */
export function jsonArg<T>(v: unknown, what: string): T {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      throw new ToolError(`Tham số ${what} phải là JSON hợp lệ.`);
    }
  }
  return v as T;
}

export async function loadBinary(ctx: ToolContext, path: unknown, exts: string[]): Promise<{ abs: string; bytes: Uint8Array }> {
  const abs = await resolveSafe(ctx, path);
  const st = await ctx.env.stat(abs);
  if (!st) throw new ToolError(`Không có file ${path}.`);
  if (st.isDir) throw new ToolError(`${path} là thư mục.`);
  if (st.size > MAX_FILE) throw new ToolError(`${path} quá lớn (${Math.round(st.size / 1048576)} MB, giới hạn 25 MB).`);
  if (exts.length && !exts.includes(extOf(abs))) throw new ToolError(`${path}: công cụ này chỉ dùng cho ${exts.join(", ")}.`);
  return { abs, bytes: await ctx.env.readBytes(abs) };
}

/** Chuẩn bị ghi file nhị phân: đúng đuôi; nếu đã tồn tại thì phải đã được đọc (read_document) và chưa bị đổi. */
export async function prepareWrite(ctx: ToolContext, rawPath: unknown, ext: string): Promise<{ abs: string; existed: boolean }> {
  const abs = await resolveSafe(ctx, rawPath);
  if (extOf(abs) !== ext) throw new ToolError(`Đường dẫn phải có đuôi ${ext} (nhận “${rawPath}”).`);
  const st = await ctx.env.stat(abs);
  if (st?.isDir) throw new ToolError(`${rawPath} là thư mục.`);
  if (st) {
    if (!ctx.readFiles.has(abs)) throw new ToolError(`${relPath(ctx, abs)} đã tồn tại. Để không mất bản gốc: lưu sang tên khác, hoặc đọc nó bằng read_document trước nếu thật sự muốn ghi đè.`);
    await checkFresh(ctx, abs, relPath(ctx, abs));
  }
  return { abs, existed: !!st };
}

export async function commit(ctx: ToolContext, abs: string, bytes: Uint8Array, existed: boolean): Promise<void> {
  const old = existed ? await ctx.env.readBytes(abs) : null;
  await ctx.env.mkdirp(dirname(abs));
  await ctx.env.writeBytes(abs, bytes);
  await remember(ctx, abs);
  pushUndo(ctx, abs, old);
}

/**
 * Tệp Word/PowerPoint đang được dựng từng phần: một lời gọi chỉ viết được khoảng 2.000-3.000 ký tự tiếng Việt, nên create_docx/create_pptx
 * nhận `append: true` để nối thêm phần mới. Nội dung Markdown đã gửi được giữ trong bộ nhớ theo (môi trường, đường dẫn) và dựng lại cả tệp.
 */
interface Building { content: string; opts: Record<string, unknown>; size: number }
const building = new WeakMap<object, Map<string, Building>>();
const buildingOf = (env: object): Map<string, Building> => {
  let m = building.get(env);
  if (!m) building.set(env, (m = new Map()));
  return m;
};
const MAX_BUILD_CHARS = 400_000;

/** Như prepareWrite, nhưng cho nối vào tệp do chính mình vừa dựng (kích thước còn nguyên) mà không bắt đọc lại. */
async function prepareAppend(ctx: ToolContext, rawPath: unknown, ext: string, tool: string): Promise<{ abs: string; st: Building }> {
  const abs = await resolveSafe(ctx, rawPath);
  if (extOf(abs) !== ext) throw new ToolError(`Đường dẫn phải có đuôi ${ext} (nhận “${rawPath}”).`);
  const st = buildingOf(ctx.env).get(abs);
  const info = await ctx.env.stat(abs);
  if (!st || !info?.isFile) throw new ToolError(`Không có bản đang dựng của ${relPath(ctx, abs)}: append chỉ dùng ngay sau khi chính bạn tạo tệp này bằng ${tool} (không có append) trong cùng phiên làm việc. Hãy gọi ${tool} không có append với phần đầu.`);
  if (info.size !== st.size) throw new ToolError(`${relPath(ctx, abs)} đã bị sửa ngoài ${tool} kể từ lần dựng trước. Hãy đọc nó bằng read_document rồi tạo lại.`);
  return { abs, st };
}

/** Thay mỗi sheet có `generate` bằng các hàng đã sinh (hàng tiêu đề lấy từ tên cột, trừ khi người gọi tự đưa `rows` đầu tiên). */
export function expandGenerated(sheets: SheetSpec[]): SheetSpec[] {
  if (!Array.isArray(sheets)) return sheets;
  return sheets.map((sh) => {
    const gen = (sh as unknown as { generate?: GenSpec }).generate;
    if (!gen) return sh;
    const spec = validateGen(gen);
    const given = Array.isArray(sh.rows) ? sh.rows : [];
    const base = given.length ? given : [genHeader(spec)];
    const { generate: _g, ...rest } = sh as unknown as Record<string, unknown>;
    void _g;
    return { ...(rest as unknown as SheetSpec), rows: [...base, ...generateRows(spec, base.length + 1)] };
  });
}

export const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const outlinePreview = async (ctx: ToolContext, rawPath: unknown, text: string): Promise<DiffPreview | null> => {
  try {
    const abs = await resolveSafe(ctx, rawPath);
    return { path: relPath(ctx, abs), diff: [], isNew: !(await ctx.env.stat(abs)), outline: text };
  } catch {
    return null;
  }
};

/** Tên mặc định cho bản đề xuất: tên-dexuat.docx (cạnh tệp gốc). */
export const suggestName = (p: unknown): string => String(p ?? "").replace(/(\.docx)?$/i, "-dexuat.docx");

export function officeTools(env: Env): Tool[] {
  const tools: Tool[] = [
    {
      name: "read_document", kind: "read", readonly: true, pathArg: "path",
      description: "Read a Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF or text/CSV file as text. Word → markdown (headings, lists, tables); Excel → cell grid per sheet with formulas shown as [=...]; PowerPoint → slides with notes; PDF → pages. Always read a document before editing it or answering questions about it. Long output is paged with offset.",
      parameters: { type: "object", properties: { path: S, sheet: { type: "string", description: "Excel: sheet name or number" }, range: { type: "string", description: "Excel: e.g. A1:F50" }, offset: { type: "integer", description: "continue reading from this character offset" }, max_chars: { type: "integer", description: "default 12000, max 30000" } }, required: ["path"] },
      summarize: (a) => String(a.path ?? "") + (a.sheet ? ` [${a.sheet}]` : "") + (a.range ? ` ${a.range}` : ""),
      async run(ctx, a) {
        const { abs, bytes } = await loadBinary(ctx, a.path, []);
        let r;
        try {
          r = await readDocumentSections(bytes, extOf(abs), { sheet: a.sheet ? String(a.sheet) : undefined, range: a.range ? String(a.range) : undefined });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const st = await ctx.env.stat(abs);
        if (st) ctx.readFiles.set(abs, st.mtimeMs);
        const out = formatSections(r, Math.max(0, Math.floor(Number(a.offset) || 0)), Math.max(1000, Math.min(Math.floor(Number(a.max_chars) || 12000), 30000)), true);
        return out + (await piiNote(bytes, extOf(abs)));
      },
    },
    {
      name: "find_in_documents", kind: "read", readonly: true,
      description: "Search for words across all documents in the project folder (Word, Excel, PowerPoint, PDF, text). Ignores case and Vietnamese diacritics ('nguyen' matches 'Nguyễn'). All words must appear on the same line/cell row. Returns file, location and a snippet.",
      parameters: { type: "object", properties: { query: S, folder: { type: "string", description: "subfolder to search (default: whole project)" } }, required: ["query"] },
      summarize: (a) => String(a.query ?? ""),
      async run(ctx, a) {
        const words = fold(String(a.query ?? "")).split(/\s+/).filter(Boolean);
        if (!words.length) throw new ToolError("Thiếu từ khoá.");
        const base = await resolveSafe(ctx, a.folder || ".");
        const hits: string[] = [];
        let files = 0;
        let skipped = 0;
        for await (const f of walk(ctx, base)) {
          if (!isReadableDocument(f)) continue;
          if (++files > 80) break;
          let perFile = 0;
          try {
            const st = await ctx.env.stat(f);
            if (!st || st.size > MAX_FILE) {
              skipped++;
              continue;
            }
            const { units } = await documentUnits(await ctx.env.readBytes(f), extOf(f));
            for (const u of units) {
              for (const line of u.text.split("\n")) {
                const fl = fold(line);
                if (words.every((w) => fl.includes(w))) {
                  // Excel: chỉ ra ô khớp (ô đầu tiên chứa một từ khoá), còn lại: vị trí của đoạn/slide/trang
                  const cell = u.cells?.find((c) => words.some((w) => fold(c.text).includes(w)));
                  const loc = cell ? u.loc.replace(/![A-Z]+(\d+)$/, `!${cell.addr}`) : u.loc;
                  hits.push(`${citeToken(relPath(ctx, f), loc)} ${line.trim().slice(0, 180)}`);
                  if (++perFile >= 6 || hits.length >= 40) break;
                }
              }
              if (perFile >= 6 || hits.length >= 40) break;
            }
          } catch {
            skipped++;
          }
          if (hits.length >= 40) break;
        }
        return (hits.length ? "Trích nguồn bằng đúng ký hiệu (cả hai dấu ngoặc vuông) ở đầu mỗi dòng.\n" + hits.join("\n") : "(không tìm thấy)") + (hits.length >= 40 ? "\n… (dừng ở 40 kết quả, hãy thu hẹp từ khoá)" : "") + (skipped ? `\n(${skipped} file không đọc được/quá lớn đã bỏ qua)` : "");
      },
    },
    {
      name: "create_docx", kind: "edit", readonly: false, pathArg: "path",
      description: "Create a Word document (.docx) from Markdown. Supports # headings, paragraphs, **bold**, *italic*, bullet and numbered lists (nested by 2-space indent), tables (| a | b |), > quotes, --- rules, <<<pagebreak>>>, and <center>text</center>. style 'formal' = Vietnamese administrative format (Times New Roman 13, A4, justified, margins 3/2/2/2 cm); 'modern' = Calibri 11 with a designed look (big title block, coloured table headers, callouts, page header/footer): use it for reports, handouts, summaries. In modern, > **Lưu ý:** / > **Mẹo:** / > **Cảnh báo:** make coloured callout boxes, and a ```chart block (same syntax as create_pptx) is drawn as coloured bars; subtitle may have extra lines (author, date). For official letters pass letterhead (national motto block), title, subtitle, signature and recipients. Never overwrite an existing file unless it was read first; save under a new name instead.",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "output path ending in .docx" },
        content: { type: "string", description: "document body in Markdown" },
        title: { type: "string", description: "centered bold title, e.g. THÔNG BÁO" }, subtitle: { type: "string", description: "line under the title, e.g. V/v ..." },
        style: { type: "string", enum: ["formal", "modern"] }, orientation: { type: "string", enum: ["portrait", "landscape"] },
        letterhead: { type: "object", properties: { agency_parent: S, agency: S, doc_number: S, place_date: S } },
        signature: { type: "object", properties: { role: S, name: S, on_behalf: S }, required: ["role"] },
        recipients: { type: "array", items: S }, page_numbers: { type: "boolean" },
        accent: { type: "string", description: "main colour of the modern style: #RRGGBB or a colour name (default dark blue)" },
        toc: { type: "boolean", description: "true = insert an auto-updating table of contents after the title block; use for long documents (4+ sections)" },
        append: { type: "boolean", description: "true = add this content to the END of the document you created earlier at the same path with create_docx (use it when the document is longer than ~2,000 characters: send the first part without append, then each next part with append=true; title/style/letterhead/signature are kept from the first call)" },
      }, required: ["path", "content"] },
      summarize: (a) => String(a.path ?? ""),
      async preview(ctx, a) {
        return outlinePreview(ctx, a.path, describeDocx({ content: String(a.content ?? ""), title: a.title, letterhead: a.letterhead, signature: a.signature }));
      },
      async run(ctx, a) {
        if (typeof a.content !== "string" || !a.content.trim()) throw new ToolError("Thiếu content (nội dung Markdown).");
        const append = a.append === true;
        let abs: string, existed: boolean;
        let opts: Parameters<typeof createDocx>[0];
        if (append) {
          const r = await prepareAppend(ctx, a.path, ".docx", "create_docx");
          if (r.st.content.length + a.content.length > MAX_BUILD_CHARS) throw new ToolError("Tài liệu quá dài để nối thêm; hãy tách thành tệp khác.");
          abs = r.abs;
          existed = true;
          opts = { ...(r.st.opts as object), content: r.st.content + "\n\n" + a.content } as typeof opts;
        } else {
          ({ abs, existed } = await prepareWrite(ctx, a.path, ".docx"));
          opts = { content: a.content, title: a.title, subtitle: a.subtitle, style: a.style, orientation: a.orientation, letterhead: jsonArg<Letterhead | undefined>(a.letterhead, "letterhead"), signature: jsonArg<Signature | undefined>(a.signature, "signature"), recipients: jsonArg<string[]>(a.recipients, "recipients"), page_numbers: a.page_numbers, accent: a.accent, toc: a.toc === true || a.toc === "true" };
        }
        const bytes = await createDocx(opts);
        await commit(ctx, abs, bytes, existed);
        const { content, ...rest } = opts as { content: string } & Record<string, unknown>;
        buildingOf(ctx.env).set(abs, { content, opts: rest, size: bytes.length });
        return `Đã ${append ? "nối thêm vào" : existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(bytes.length)}).\n${describeDocx(opts)}\n` + (append ? "Nếu còn phần nữa, gọi tiếp create_docx với append=true. " : "Nếu còn phần nữa, gọi tiếp create_docx với cùng path và append=true (mỗi lần dưới ~2.000 ký tự). ") + "Khi đủ, hãy dùng read_document để kiểm tra lại nội dung trước khi báo cáo.";
      },
    },
    {
      name: "docx_edit", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || a.path,
      description: "Edit an EXISTING Word file paragraph by paragraph, keeping everything else. Paragraph numbers are the ¶N shown by read_document (numbered before this call). replace_paragraph [{para,text}] rewrites a whole paragraph (keeps its style); delete [para…] removes paragraphs or whole tables; insert_after [{para,text,style:'normal'|'heading1'|'heading2'|'heading3'|'bullet'|'numbered',bold,italic,align}] adds paragraphs after ¶N (text may have several lines; lines starting with | become a table); format [{para: N|[N…]|'all'|'headings', match?, bold, italic, underline, color, shade, size, font, align}] changes look (colors: #RRGGBB or names like đỏ, xanh dương, vàng); table [{table: n, op:'set_cell'|'add_row'|'delete_row', row, col?, text?, cells?[]}] edits tables (row/col are 1-based; add_row inserts after row). For small word-level fixes inside a paragraph prefer docx_replace (keeps run formatting). Read the file first; use save_as to keep the original (recommended).",
      parameters: { type: "object", properties: {
        path: S, save_as: { type: "string", description: "new .docx path; the original stays unchanged" },
        replace_paragraph: { type: "array", items: { type: "object", properties: { para: { type: "integer" }, text: S }, required: ["para", "text"] } },
        delete: { type: "array", items: { type: "integer" } },
        insert_after: { type: "array", items: { type: "object", properties: { para: { type: "integer" }, text: S, style: { type: "string", enum: ["normal", "heading1", "heading2", "heading3", "bullet", "numbered"] }, bold: { type: "boolean" }, italic: { type: "boolean" }, align: { type: "string", enum: ["left", "center", "right", "justify"] } }, required: ["para", "text"] } },
        format: { type: "array", items: { type: "object", properties: { para: {}, match: S, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: S, shade: S, size: { type: "number" }, font: S, align: { type: "string", enum: ["left", "center", "right", "justify"] } } } },
        table: { type: "array", items: { type: "object", properties: { table: { type: "integer" }, op: { type: "string", enum: ["set_cell", "add_row", "delete_row"] }, row: { type: "integer" }, col: { type: "integer" }, text: S, cells: { type: "array", items: S } }, required: ["table", "op", "row"] } },
      }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""}${a.save_as ? " → " + a.save_as : ""}`,
      async preview(ctx, a) {
        const bits: string[] = [];
        if (a.replace_paragraph) bits.push("sửa đoạn");
        if (a.insert_after) bits.push("chèn");
        if (a.delete) bits.push("xoá");
        if (a.format) bits.push("định dạng");
        if (a.table) bits.push("sửa bảng");
        return outlinePreview(ctx, a.save_as || a.path, `Sửa Word ${a.path}: ${bits.join(", ") || "(chưa rõ)"}${a.save_as ? ` (lưu thành ${a.save_as})` : " (ghi đè bản gốc)"}`);
      },
      async run(ctx, a) {
        const opts: DocxEditOptions = {};
        for (const k of ["replace_paragraph", "delete", "insert_after", "format", "table"] as const) {
          const v = jsonArg<unknown>(a[k], k);
          if (v === undefined || v === null) continue;
          if (!Array.isArray(v)) throw new ToolError(`${k} phải là danh sách.`, "bad_args");
          (opts as Record<string, unknown>)[k] = v;
        }
        if (!Object.keys(opts).length) throw new ToolError("Chưa nói cần sửa gì: dùng replace_paragraph, delete, insert_after, format hoặc table.", "bad_args");
        const src = await resolveSafe(ctx, a.path);
        if (!ctx.readFiles.has(src)) throw new ToolError(`Hãy đọc ${a.path} bằng read_document trước khi sửa (để biết số đoạn ¶N).`, "read_first");
        await checkFresh(ctx, src, a.path);
        const { bytes } = await loadBinary(ctx, a.path, [".docx"]);
        let res;
        try {
          res = await editDocx(bytes, opts);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        let abs = src;
        let existed = true;
        if (a.save_as) ({ abs, existed } = await prepareWrite(ctx, a.save_as, ".docx"));
        await commit(ctx, abs, res.bytes, existed);
        return `Đã lưu ${relPath(ctx, abs)}.\n` + res.changes.slice(0, 25).join("\n") + "\nSố đoạn ¶ đã thay đổi sau khi chèn/xoá: hãy read_document lại trước lần sửa tiếp theo.";
      },
    },
    {
      name: "docx_replace", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || (a.suggest ? suggestName(a.path) : a.path),
      description: "Replace text inside an existing Word file, keeping its formatting (works even when the text is split across formatting runs; also headers/footers). Read the file first. Use save_as to keep the original untouched (recommended). Each find must match exactly (case-sensitive). suggest=true writes the edits as real Word tracked changes (Track Changes: the user accepts or rejects each one in Word) into a NEW file; prefer it when proofreading or revising someone else's document.",
      parameters: { type: "object", properties: { path: S, replacements: { type: "array", items: { type: "object", properties: { find: S, replace: S }, required: ["find", "replace"] } }, save_as: { type: "string", description: "new .docx path; original stays unchanged" }, suggest: { type: "boolean", description: "write as tracked changes (suggestions) instead of silent replacement" } }, required: ["path", "replacements"] },
      summarize: (a) => `${a.path ?? ""}${a.save_as || a.suggest ? " → " + (a.save_as || suggestName(a.path)) : ""}${a.suggest ? " (đề xuất)" : ""}`,
      async preview(ctx, a) {
        const reps = (() => { try { return jsonArg<{ find: string; replace: string }[]>(a.replacements, "replacements") ?? []; } catch { return []; } })();
        const dest = a.save_as || (a.suggest ? suggestName(a.path) : "");
        return outlinePreview(ctx, dest || a.path, `${a.suggest ? "Đề xuất" : "Thay"} ${reps.length} chỗ trong ${a.path}${dest ? ` (lưu thành ${dest})` : " (ghi đè bản gốc)"}${a.suggest ? " — hiện dưới dạng Track Changes, bạn Chấp nhận/Từ chối trong Word" : ""}:\n` + reps.slice(0, 12).map((r) => `  “${String(r.find).slice(0, 60)}” → “${String(r.replace).slice(0, 60)}”`).join("\n"));
      },
      async run(ctx, a) {
        const reps = jsonArg<{ find: string; replace: string }[]>(a.replacements, "replacements");
        if (!Array.isArray(reps) || !reps.length || reps.some((r) => !r || typeof r.find !== "string" || typeof r.replace !== "string")) throw new ToolError("replacements phải là danh sách {find, replace}.");
        const src = await resolveSafe(ctx, a.path);
        if (!ctx.readFiles.has(src)) throw new ToolError(`Hãy đọc ${a.path} bằng read_document trước khi sửa.`);
        await checkFresh(ctx, src, a.path);
        const { bytes } = await loadBinary(ctx, a.path, [".docx"]);
        if (a.suggest) {
          let sg;
          try {
            sg = await docxSuggest(bytes, reps);
          } catch (e) {
            throw new ToolError((e as Error).message);
          }
          const total = sg.counts.reduce((x, y) => x + y, 0);
          if (!total) throw new ToolError(`Không đánh dấu được chỗ nào trong ${a.path}.` + (sg.skipped.some(Boolean) ? " Chữ cần sửa nằm trong phần có định dạng phức tạp (tab, trường…); hãy dùng docx_replace không có suggest, lưu thành bản mới." : " Kiểm tra đúng từng ký tự (chữ hoa/thường, dấu cách)."));
          const dest = await prepareWrite(ctx, a.save_as || suggestName(a.path), ".docx");
          await commit(ctx, dest.abs, sg.bytes, dest.existed);
          const miss = reps.filter((_r, i) => sg.counts[i] === 0 && !sg.skipped[i]);
          return `Đã lưu ${relPath(ctx, dest.abs)} với ${total} đề xuất (Track Changes). Mở bằng Word → thẻ Review để Chấp nhận/Từ chối.\nBảng trước → sau:\n` + sg.changes.slice(0, 15).map((c, i) => `  ${i + 1}. “${c.find.slice(0, 40)}” → “${c.replace.slice(0, 40)}”  | ${c.context}`).join("\n") + (sg.changes.length > 15 ? `\n  … (+${sg.changes.length - 15} chỗ)` : "") + (miss.length ? `\n⚠ Không tìm thấy: ${miss.map((m) => "“" + m.find.slice(0, 40) + "”").join(", ")}` : "") + (sg.skipped.some(Boolean) ? "\n⚠ Một số chỗ nằm trong phần định dạng phức tạp nên chưa đánh dấu được." : "");
        }
        let res;
        try {
          res = await docxReplace(bytes, reps);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const miss = reps.filter((_r, i) => res.counts[i] === 0);
        if (miss.length === reps.length) throw new ToolError(`Không tìm thấy chữ nào cần thay trong ${a.path}. Kiểm tra đúng từng ký tự (chữ hoa/thường, dấu cách). Dùng read_document để xem lại nội dung.`);
        let abs = src;
        let existed = true;
        if (a.save_as) ({ abs, existed } = await prepareWrite(ctx, a.save_as, ".docx"));
        await commit(ctx, abs, res.bytes, existed);
        return `Đã lưu ${relPath(ctx, abs)}. Số chỗ đã thay: ` + reps.map((r, i) => `“${r.find.slice(0, 30)}” ×${res.counts[i]}`).join(", ") + (miss.length ? `\n⚠ Không tìm thấy: ${miss.map((m) => "“" + m.find.slice(0, 40) + "”").join(", ")}` : "");
      },
    },
    {
      name: "create_xlsx", kind: "edit", readonly: false, pathArg: "path",
      description: "Create an Excel workbook (.xlsx). sheets = [{name, rows: [[...], ...]}]; the first row is the header (bold, blue fill, frozen) unless header=false. Cells: numbers as real numbers (not '1.200.000' strings), text, or formulas as strings starting with '=' (English function names, comma separators, e.g. '=SUM(B2:B10)', '=IF(C2>=5,\"Đạt\",\"Không đạt\")'). ISO dates 'YYYY-MM-DD' become real dates shown dd/mm/yyyy. Formulas are calculated and returned so you can verify the numbers. number_formats e.g. {\"C\": \"#,##0\", \"D\": \"0.0%\"}. conditional colours cells: [{range: \"D2:D30\", rule: \"bars\" | \"scale\" | {op: \"lt\"|\"le\"|\"gt\"|\"ge\"|\"eq\"|\"ne\", value: 5, color: \"red\"|\"green\"|\"yellow\"}}]. Real Excel charts: pass `charts` (see its description) after the data is laid out; a chart is for 1 category column + a few numeric columns, not for raw lists. Default look is applied automatically (dark header with white bold text, banded rows, thin horizontal rules, a bold Tổng/Total row, auto number/date/% formats, frozen header, filter, landscape fit-to-width printing); theme = xanh (default) | ngoc | xanhla | cam | tim | do | den, or accent = any colour. BULK DATA: never type more than ~40 rows yourself (the call gets cut off). Instead give a sheet `generate` = {count, seed?, columns: [{name, type, ...}]} and the tool generates the rows: types seq {start,step,prefix,pad}, pick {values,weights?}, int {min,max}, float {min,max,decimals}, date {from,to} (ISO), name_vi {gender?: nam|nu}, email {from: column name, domain}, phone_vi, bool {true_label,false_label,p}, text {template}, formula {template}; in templates {seq} = 1..count, {row} = Excel row number, {col:Column name} = that column's value in the same row. The header row is built from the column names unless you give your own `rows` first.",
      parameters: { type: "object", properties: { path: S, sheets: { type: "array", items: { type: "object", properties: { name: S, generate: { type: "object", description: "bulk generator {count, seed?, columns:[{name,type,...}]}: the tool generates the rows" }, rows: { type: "array", items: { type: "array", items: {} } }, header: { type: "boolean" }, widths: { type: "array", items: { type: "number" } }, freeze_header: { type: "boolean" }, autofilter: { type: "boolean" }, number_formats: { type: "object" }, conditional: { type: "array", items: { type: "object", properties: { range: S, rule: {} }, required: ["range", "rule"] } } }, required: ["name"] } }, charts: { type: "array", description: "REAL Excel charts: [{type, title, sheet?, data_range, position?, width_cols?, height_rows?}]. type: col (vertical columns) | bar (horizontal bars) | line | pie | doughnut | area. data_range includes the header row and the label column, e.g. \"A1:C6\" (column A = category labels, B and C = numeric series named by row 1; a last row labelled Tổng/Total is left out). Needs real numbers in the cells (formulas are fine). position = top-left cell like \"E2\" (default: right of the data, stacked); width_cols default 9, height_rows default 17. Optional x_title, y_title, labels (true/false = show/hide value labels). Max 10 charts.", items: { type: "object", properties: { type: S, title: S, sheet: S, data_range: S, position: S, width_cols: { type: "number" }, height_rows: { type: "number" }, x_title: S, y_title: S, labels: { type: "boolean" } }, required: ["type", "data_range"] } }, theme: S, accent: S }, required: ["path", "sheets"] },
      summarize: (a) => String(a.path ?? ""),
      async preview(ctx, a) {
        try {
          return outlinePreview(ctx, a.path, describeXlsx(expandGenerated(jsonArg<SheetSpec[]>(a.sheets, "sheets"))));
        } catch {
          return null;
        }
      },
      async run(ctx, a) {
        const { abs, existed } = await prepareWrite(ctx, a.path, ".xlsx");
        let sheets = jsonArg<SheetSpec[]>(a.sheets, "sheets");
        try {
          sheets = expandGenerated(sheets);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        if (!Array.isArray(sheets) || !sheets.length || sheets.some((s) => !s || !Array.isArray((s as any).rows))) throw new ToolError("sheets phải là danh sách {name, rows: [[...]]} hoặc {name, generate: {count, columns}}.");
        for (const sh of sheets) sh.rows = sh.rows.map((r) => (Array.isArray(r) ? r : [r as never]));
        let built;
        try {
          built = await createXlsx(sheets, { charts: jsonArg<any[]>(a.charts, "charts"), theme: a.theme, accent: a.accent });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        await commit(ctx, abs, built.bytes, existed);
        return reportOf(`Đã ${existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(built.bytes.length)}).\n${built.dims.join("\n")}${built.notes.length ? "\n" + built.notes.join("\n") : ""}`, built.report);
      },
    },
    {
      name: "xlsx_edit", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || a.path,
      description: "Edit an existing Excel file: set cells, append rows, or add a sheet. Read the file first. All formulas are recalculated and checked. set = {\"B2\": 10, \"C2\": \"=B2*2\", \"Sheet2!D5\": \"Đạt\", \"E1\": null}. Use save_as to keep the original untouched (recommended). charts = add real Excel charts (see create_xlsx; data_range is on the sheet named by `sheet` inside each chart, default first sheet). Existing charts in the file are kept; pivot tables and macros may be lost. STRUCTURE (row/column numbers refer to the sheet BEFORE this call; run first): rename_sheet [{from,to}], delete_sheet [name], delete_rows [{sheet?,from,count?}], insert_rows [{sheet?,at,count?}], delete_columns [{sheet?,from:'C'|3,count?}], insert_columns [{sheet?,at,count?}] — formulas that point at shifted cells are rewritten. FORMAT/OTHER (after set): clear [{sheet?,range}], sort [{sheet?,range?,by:'C',order:'asc'|'desc',header:true}] (values only; refuses ranges with formulas), format [{sheet?,range:'A1:D1'|'B:B'|'2:2',bold,italic,underline,color,fill,font,size,align,valign,wrap,number_format,border:'all'|'outline'|'bottom'|'top'|'none',width,height}] (colors: #RRGGBB or names like đỏ, xanh dương, vàng), merge/unmerge [{sheet?,range}], freeze {cell:'A2'|null}, autofilter {range|null}. Do structure and data changes in separate calls when numbering gets confusing.",
      parameters: { type: "object", properties: { rename_sheet: { type: "array", items: { type: "object", properties: { from: S, to: S }, required: ["from", "to"] } }, delete_sheet: { type: "array", items: S }, delete_rows: { type: "array", items: { type: "object", properties: { sheet: S, from: { type: "integer" }, count: { type: "integer" } }, required: ["from"] } }, insert_rows: { type: "array", items: { type: "object", properties: { sheet: S, at: { type: "integer" }, count: { type: "integer" } }, required: ["at"] } }, delete_columns: { type: "array", items: { type: "object", properties: { sheet: S, from: {}, count: { type: "integer" } }, required: ["from"] } }, insert_columns: { type: "array", items: { type: "object", properties: { sheet: S, at: {}, count: { type: "integer" } }, required: ["at"] } }, clear: { type: "array", items: { type: "object", properties: { sheet: S, range: S }, required: ["range"] } }, sort: { type: "array", items: { type: "object", properties: { sheet: S, range: S, by: {}, order: { type: "string", enum: ["asc", "desc"] }, header: { type: "boolean" } }, required: ["by"] } }, format: { type: "array", items: { type: "object", properties: { sheet: S, range: S, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, color: S, fill: S, font: S, size: { type: "number" }, align: { type: "string", enum: ["left", "center", "right"] }, valign: { type: "string", enum: ["top", "middle", "bottom"] }, wrap: { type: "boolean" }, number_format: S, border: { type: "string", enum: ["all", "outline", "bottom", "top", "none"] }, width: { type: "number" }, height: { type: "number" } }, required: ["range"] } }, merge: { type: "array", items: { type: "object", properties: { sheet: S, range: S }, required: ["range"] } }, unmerge: { type: "array", items: { type: "object", properties: { sheet: S, range: S }, required: ["range"] } }, freeze: { type: "object", properties: { sheet: S, cell: {} } }, autofilter: { type: "object", properties: { sheet: S, range: {} } }, path: S, sheet: { type: "string", description: "default sheet for set/append_rows" }, set: { type: "object" }, append_generate: { type: "object", description: "append BULK generated rows (same spec as create_xlsx generate: {count, seed?, columns}); use this instead of typing many rows" }, append_rows: { type: "array", items: { type: "array", items: {} } }, add_sheet: { type: "object", properties: { name: S, rows: { type: "array", items: { type: "array", items: {} } } } }, charts: { type: "array", description: "REAL Excel charts: [{type, title, sheet?, data_range, position?, width_cols?, height_rows?}]. type: col (vertical columns) | bar (horizontal bars) | line | pie | doughnut | area. data_range includes the header row and the label column, e.g. \"A1:C6\" (column A = category labels, B and C = numeric series named by row 1; a last row labelled Tổng/Total is left out). Needs real numbers in the cells (formulas are fine). position = top-left cell like \"E2\" (default: right of the data, stacked); width_cols default 9, height_rows default 17. Optional x_title, y_title, labels (true/false = show/hide value labels). Max 10 charts.", items: { type: "object", properties: { type: S, title: S, sheet: S, data_range: S, position: S, width_cols: { type: "number" }, height_rows: { type: "number" }, x_title: S, y_title: S, labels: { type: "boolean" } }, required: ["type", "data_range"] } }, save_as: { type: "string" } }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""}${a.save_as ? " → " + a.save_as : ""}`,
      async preview(ctx, a) {
        let n = 0;
        try { n = Object.keys(jsonArg<Record<string, unknown>>(a.set, "set") ?? {}).length; } catch { /* bỏ qua */ }
        let rows = 0;
        try { rows = (jsonArg<unknown[][]>(a.append_rows, "append_rows") ?? []).length; } catch { /* bỏ qua */ }
        return outlinePreview(ctx, a.save_as || a.path, `Sửa ${a.path}${a.save_as ? ` (lưu thành ${a.save_as})` : " (ghi đè bản gốc)"}: ${n} ô, ${rows} hàng thêm${a.add_sheet ? ", thêm sheet “" + a.add_sheet.name + "”" : ""}${Array.isArray(a.charts) && a.charts.length ? ", " + a.charts.length + " biểu đồ" : ""}.` + (n ? "\n" + Object.entries(jsonArg<Record<string, unknown>>(a.set, "set") ?? {}).slice(0, 12).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`).join("\n") : ""));
      },
      async run(ctx, a) {
        const src = await resolveSafe(ctx, a.path);
        if (!ctx.readFiles.has(src)) throw new ToolError(`Hãy đọc ${a.path} bằng read_document trước khi sửa.`);
        await checkFresh(ctx, src, a.path);
        const { bytes } = await loadBinary(ctx, a.path, [".xlsx", ".xlsm"]);
        const ops: Record<string, unknown> = {};
        for (const k of ["rename_sheet", "delete_sheet", "delete_rows", "insert_rows", "delete_columns", "insert_columns", "clear", "sort", "format", "merge", "unmerge", "freeze", "autofilter"])
          if (a[k] !== undefined && a[k] !== null) ops[k] = jsonArg<unknown>(a[k], k);
        for (const k of ["rename_sheet", "delete_sheet", "delete_rows", "insert_rows", "delete_columns", "insert_columns", "clear", "sort", "format", "merge", "unmerge"])
          if (ops[k] !== undefined && !Array.isArray(ops[k])) throw new ToolError(`${k} phải là danh sách.`, "bad_args");
        const edit = { sheet: a.sheet, set: jsonArg<Record<string, any>>(a.set, "set"), append_rows: jsonArg<any[][]>(a.append_rows, "append_rows"), add_sheet: jsonArg<any>(a.add_sheet, "add_sheet"), charts: jsonArg<any[]>(a.charts, "charts"), ops: Object.keys(ops).length ? (ops as never) : undefined };
        const gen = jsonArg<GenSpec>(a.append_generate, "append_generate");
        if (gen) {
          try {
            const first = (await sheetRowCount(bytes, a.sheet)) + 1;
            edit.append_rows = [...(edit.append_rows ?? []), ...generateRows(validateGen(gen), first)];
          } catch (e) {
            throw new ToolError((e as Error).message);
          }
        }
        if (!edit.set && !edit.append_rows && !edit.add_sheet && !edit.charts?.length && !edit.ops) throw new ToolError("Cần ít nhất một thao tác: set, append_rows, append_generate, add_sheet, charts, hoặc xoá/chèn hàng-cột, sort, format, merge…");
        let res;
        try {
          res = await editXlsx(bytes, edit);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        let abs = src;
        let existed = true;
        if (a.save_as) ({ abs, existed } = await prepareWrite(ctx, a.save_as, extOf(src)));
        await commit(ctx, abs, res.bytes, existed);
        return reportOf(`Đã lưu ${relPath(ctx, abs)}. Đã sửa: ${res.changed.slice(0, 20).join(", ")}${res.changed.length > 20 ? ` … (+${res.changed.length - 20})` : ""}.${res.notes.length ? "\n" + res.notes.join("\n") : ""}`, res.report);
      },
    },
    {
      name: "pptx_edit", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || a.path,
      description: "Edit an EXISTING PowerPoint (.pptx) while keeping its design. (1) replacements [{find, replace, slide?}]: change text (slides and notes; works even when the text is split across formatting runs). (2) transform {case: upper|lower|capitalize, target: titles (default)|all, slides?}: change letter case, e.g. 'make every title UPPERCASE'. (3) style [{target: titles (default)|all|match, match?, slides?, color, size, bold, italic, underline, font, align, fill}]: text color/size/font/alignment and the fill color of the shape that holds the text. (4) background {color, slides?}: slide background color. (5) delete_slides [n], duplicate_slides [n] (the copy sits right after the original; to change its text call again with the new slide number), move_slide {slide, to}. Slide numbers always refer to the file as it was BEFORE this call. Read the file with read_document first. Use save_as to keep the original (recommended). Colors: #RRGGBB or common names (đỏ, xanh dương, xanh lá, cam, vàng, tím, đen, trắng, xám). Not supported: adding new shapes, pictures or animations; to add brand-new slides either duplicate_slides then edit the copy, or rebuild the deck with create_pptx.",
      parameters: { type: "object", properties: {
        path: S, save_as: { type: "string", description: "new .pptx path; the original stays unchanged" },
        replacements: { type: "array", items: { type: "object", properties: { find: S, replace: S, slide: { type: "integer" } }, required: ["find", "replace"] } },
        transform: { type: "object", properties: { case: { type: "string", enum: ["upper", "lower", "capitalize"] }, target: { type: "string", enum: ["titles", "all"] }, slides: { type: "array", items: { type: "integer" } } }, required: ["case"] },
        style: { type: "array", items: { type: "object", properties: { target: { type: "string", enum: ["titles", "all", "match"] }, match: S, slides: { type: "array", items: { type: "integer" } }, color: S, size: { type: "number" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, font: S, align: { type: "string", enum: ["left", "center", "right", "justify"] }, fill: S } } },
        background: { type: "object", properties: { color: S, slides: { type: "array", items: { type: "integer" } } }, required: ["color"] },
        delete_slides: { type: "array", items: { type: "integer" } }, duplicate_slides: { type: "array", items: { type: "integer" } },
        move_slide: { type: "object", properties: { slide: { type: "integer" }, to: { type: "integer" } }, required: ["slide", "to"] },
      }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""}${a.save_as ? " → " + a.save_as : ""}`,
      async preview(ctx, a) {
        const bits: string[] = [];
        if (a.replacements) bits.push("thay chữ");
        if (a.transform) bits.push("đổi hoa/thường");
        if (a.style) bits.push("định dạng");
        if (a.background) bits.push("màu nền");
        if (a.delete_slides) bits.push("xoá slide");
        if (a.duplicate_slides) bits.push("nhân đôi slide");
        if (a.move_slide) bits.push("chuyển slide");
        return outlinePreview(ctx, a.save_as || a.path, `Sửa PowerPoint ${a.path}: ${bits.join(", ") || "(chưa rõ)"}${a.save_as ? ` (lưu thành ${a.save_as})` : " (ghi đè bản gốc)"}`);
      },
      async run(ctx, a) {
        const opts: PptxEditOptions = {
          replacements: jsonArg<PptxEditOptions["replacements"]>(a.replacements, "replacements"),
          transform: jsonArg<PptxEditOptions["transform"]>(a.transform, "transform"),
          style: jsonArg<PptxEditOptions["style"]>(a.style, "style"),
          background: jsonArg<PptxEditOptions["background"]>(a.background, "background"),
          delete_slides: jsonArg<number[]>(a.delete_slides, "delete_slides"),
          duplicate_slides: jsonArg<number[]>(a.duplicate_slides, "duplicate_slides"),
          move_slide: jsonArg<PptxEditOptions["move_slide"]>(a.move_slide, "move_slide"),
        };
        if (opts.replacements && (!Array.isArray(opts.replacements) || opts.replacements.some((r) => !r || typeof r.find !== "string" || typeof r.replace !== "string"))) throw new ToolError("replacements phải là danh sách {find, replace}.", "bad_args");
        if (opts.style && !Array.isArray(opts.style)) throw new ToolError("style phải là danh sách.", "bad_args");
        if (!opts.replacements?.length && !opts.transform && !opts.style?.length && !opts.background && !opts.delete_slides?.length && !opts.duplicate_slides?.length && !opts.move_slide)
          throw new ToolError("Chưa nói cần sửa gì: dùng replacements, transform, style, background, delete_slides, duplicate_slides hoặc move_slide.", "bad_args");
        const src = await resolveSafe(ctx, a.path);
        if (!ctx.readFiles.has(src)) throw new ToolError(`Hãy đọc ${a.path} bằng read_document trước khi sửa.`, "read_first");
        await checkFresh(ctx, src, a.path);
        const { bytes } = await loadBinary(ctx, a.path, [".pptx"]);
        let res;
        try {
          res = await editPptx(bytes, opts);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const miss = (opts.replacements ?? []).filter((_r, i) => res.counts[i] === 0);
        const structural = !!(opts.delete_slides?.length || opts.duplicate_slides?.length || opts.move_slide);
        if (!res.changes.length && !structural) throw new ToolError(`Không có gì thay đổi trong ${a.path}.` + (miss.length ? " Không tìm thấy: " + miss.map((m) => "“" + m.find.slice(0, 40) + "”").join(", ") + ". Kiểm tra đúng từng ký tự (hoa/thường, dấu cách) bằng read_document." : " Kiểm tra số slide và điều kiện (target/match)."), "no_match");
        let abs = src;
        let existed = true;
        if (a.save_as) ({ abs, existed } = await prepareWrite(ctx, a.save_as, ".pptx"));
        await commit(ctx, abs, res.bytes, existed);
        return `Đã lưu ${relPath(ctx, abs)} (${res.slides} slide).\n` + res.changes.slice(0, 25).join("\n") +
          (opts.replacements?.length ? "\nSố chỗ đã thay: " + opts.replacements.map((r, i) => `“${r.find.slice(0, 30)}” ×${res.counts[i]}`).join(", ") : "") +
          (miss.length ? `\n⚠ Không tìm thấy: ${miss.map((m) => "“" + m.find.slice(0, 40) + "”").join(", ")}` : "") +
          (structural ? `\nThứ tự slide mới: ${res.layout.join(", ")} (số = slide gốc).` : "") +
          "\nHãy dùng read_document để kiểm tra lại.";
      },
    },
    {
      name: "create_pptx", kind: "edit", readonly: false, pathArg: "path",
      description: "Create a PowerPoint (.pptx) from Markdown. Slides are separated by a line containing only ---. Each slide: a '# Title' (or ##) line, then bullets (- item, nested by 2 spaces), paragraphs, tables or code. The first slide with '# Title' and a short subtitle paragraph becomes the cover. A paragraph starting 'Ghi chú:' becomes the presenter notes. A real chart: a fenced block ```chart cột (or ngang, đường, tròn, vành, vùng) with an optional 'title: ...' line and a Markdown table (first column = labels, other columns = numeric series, e.g. 7,5 or 1.200). Keep 3-6 short bullets per slide; split long content across slides. LAYOUTS are chosen automatically from the content, so write it to fit: a title-only slide (or '## 1. Name' + one line) = section divider; the LAST slide with a short title (e.g. 'Cảm ơn') = closing; 2-4 bullets like '92%: sinh viên dùng…' or '**1.200** bài giảng' = big-number cards; 3-6 bullets like '**Hạ tầng**: mô tả…' or 'Hạ tầng: mô tả…' = numbered cards; an ORDERED list (1. 2. 3.) of 3-5 steps = process timeline; a single '> quote' (+ optional attribution line) = quote slide; bullets plus ONE chart, small table or image = two columns. An image: a line '![mô tả](hinh/anh.png)' with a png/jpg/gif file in the project folder. theme chooses the colors: xanh (default), ngoc, xanhla, cam, tim, do, den; pick one that fits the topic or the user's wish.",
      parameters: { type: "object", properties: { path: S, content: { type: "string", description: "Markdown, slides separated by ---" }, footer: { type: "string" }, theme: { type: "string", enum: Object.keys(PPTX_THEMES), description: "color theme (default xanh)" }, append: { type: "boolean", description: "true = add these slides to the END of the deck you created earlier at the same path with create_pptx (use it for decks longer than ~6 slides or ~2,000 characters: send the cover and first slides without append, then the next slides with append=true; footer and theme are kept from the first call)" } }, required: ["path", "content"] },
      summarize: (a) => String(a.path ?? ""),
      async preview(ctx, a) {
        return outlinePreview(ctx, a.path, describePptx(String(a.content ?? "")));
      },
      async run(ctx, a) {
        if (typeof a.content !== "string" || !a.content.trim()) throw new ToolError("Thiếu content (Markdown).");
        const append = a.append === true;
        let abs: string, existed: boolean;
        let content: string = a.content;
        let footer: string | undefined = a.footer;
        let theme: string | undefined = typeof a.theme === "string" ? a.theme : undefined;
        if (append) {
          const p = await prepareAppend(ctx, a.path, ".pptx", "create_pptx");
          if (p.st.content.length + a.content.length > MAX_BUILD_CHARS) throw new ToolError("Bài trình chiếu quá dài để nối thêm; hãy tách thành tệp khác.");
          abs = p.abs;
          existed = true;
          content = p.st.content + "\n\n---\n\n" + a.content.replace(/^\s*---\s*\n/, "");
          footer = p.st.opts.footer as string | undefined;
          theme = p.st.opts.theme as string | undefined;
        } else ({ abs, existed } = await prepareWrite(ctx, a.path, ".pptx"));
        let r;
        try {
          const images: Record<string, Uint8Array> = {};
          for (const src of pptxImageRefs(a.content).slice(0, 20)) {
            try {
              const abs = await resolveSafe(ctx, src);
              const st = await ctx.env.stat(abs);
              if (st?.isFile && st.size <= 8_000_000) images[src] = await ctx.env.readBytes(abs);
            } catch {
              /* ảnh thiếu: createPptx đặt khung chữ thay thế và cảnh báo */
            }
          }
          r = await createPptx({ content, footer, theme, images });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        await commit(ctx, abs, r.bytes, existed);
        buildingOf(ctx.env).set(abs, { content, opts: { footer, theme }, size: r.bytes.length });
        return `Đã ${append ? "nối thêm vào" : existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(r.bytes.length)}, ${r.slides} slide${append ? " tổng cộng" : ""}).` + (r.warnings.length ? "\n⚠ " + r.warnings.join("\n⚠ ") : "") + "\nNếu còn slide nữa, gọi tiếp create_pptx với cùng path và append=true (mỗi lần 3-5 slide). Khi đủ, dùng read_document để kiểm tra lại."
      },
    },
  ];

  if (env.convertToPdf) {
    tools.push({
      name: "convert_to_pdf", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.output_path || String(a.path ?? "").replace(/\.[^./]+$/, ".pdf"),
      description: "Convert a Word/Excel/PowerPoint file to PDF (uses LibreOffice installed on this computer).",
      parameters: { type: "object", properties: { path: S, output_path: { type: "string", description: "default: same name with .pdf" } }, required: ["path"] },
      summarize: (a) => String(a.path ?? ""),
      async run(ctx, a) {
        const src = await resolveSafe(ctx, a.path);
        if (![".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt"].includes(extOf(src))) throw new ToolError("Chỉ chuyển được Word/Excel/PowerPoint sang PDF.");
        const outRaw = a.output_path || String(a.path).replace(/\.[^./]+$/, ".pdf");
        const out = await resolveSafe(ctx, outRaw);
        if (extOf(out) !== ".pdf") throw new ToolError("output_path phải có đuôi .pdf.");
        const existed = !!(await ctx.env.stat(out));
        if (existed && !ctx.readFiles.has(out)) throw new ToolError(`${relPath(ctx, out)} đã tồn tại. Chọn tên khác bằng output_path.`);
        const old = existed ? await ctx.env.readBytes(out) : null;
        try {
          await ctx.env.convertToPdf!(src, out, { timeoutMs: 120000, signal: ctx.signal });
        } catch (e) {
          throw new ToolError("Không chuyển được sang PDF: " + (e as Error).message);
        }
        pushUndo(ctx, out, old);
        return `Đã tạo ${relPath(ctx, out)}.`;
      },
    });
  }
  tools.push(...filesTools(env), ...pdfTools(env), ...utilTools(env), ...renderTools(env)); // nhóm công cụ mở rộng, mỗi nhóm một tệp
  return tools;
}

export function reportOf(head: string, r: { formulas: { cell: string; formula: string; value: string }[]; unverified: string[]; errors: string[] }): string {
  const parts = [head];
  if (r.formulas.length) parts.push("Kết quả công thức (đã tính):\n" + r.formulas.slice(0, 25).map((f) => `  ${f.cell}  ${f.formula}  →  ${f.value}`).join("\n") + (r.formulas.length > 25 ? `\n  … (+${r.formulas.length - 25} công thức khác)` : ""));
  if (r.errors.length) parts.push("⚠ Công thức bị lỗi:\n  " + r.errors.slice(0, 15).join("\n  ") + "\nHãy sửa các công thức này.");
  if (r.unverified.length) parts.push("ℹ Chưa kiểm tra được (Excel sẽ tự tính khi mở): " + r.unverified.slice(0, 8).join("; "));
  parts.push("Hãy dùng read_document để kiểm tra lại số liệu trước khi báo cáo.");
  return parts.join("\n");
}

export { join };
