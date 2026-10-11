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
      description: "Create a Word document (.docx) from Markdown. Supports # headings, paragraphs, **bold**, *italic*, bullet and numbered lists (nested by 2-space indent), tables (| a | b |), > quotes, --- rules, <<<pagebreak>>>, and <center>text</center>. style 'formal' = Vietnamese administrative format (Times New Roman 13, A4, justified, margins 3/2/2/2 cm); 'modern' = Calibri 11. For official letters pass letterhead (national motto block), title, subtitle, signature and recipients. Never overwrite an existing file unless it was read first; save under a new name instead.",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "output path ending in .docx" },
        content: { type: "string", description: "document body in Markdown" },
        title: { type: "string", description: "centered bold title, e.g. THÔNG BÁO" }, subtitle: { type: "string", description: "line under the title, e.g. V/v ..." },
        style: { type: "string", enum: ["formal", "modern"] }, orientation: { type: "string", enum: ["portrait", "landscape"] },
        letterhead: { type: "object", properties: { agency_parent: S, agency: S, doc_number: S, place_date: S } },
        signature: { type: "object", properties: { role: S, name: S, on_behalf: S }, required: ["role"] },
        recipients: { type: "array", items: S }, page_numbers: { type: "boolean" },
      }, required: ["path", "content"] },
      summarize: (a) => String(a.path ?? ""),
      async preview(ctx, a) {
        return outlinePreview(ctx, a.path, describeDocx({ content: String(a.content ?? ""), title: a.title, letterhead: a.letterhead, signature: a.signature }));
      },
      async run(ctx, a) {
        const { abs, existed } = await prepareWrite(ctx, a.path, ".docx");
        if (typeof a.content !== "string" || !a.content.trim()) throw new ToolError("Thiếu content (nội dung Markdown).");
        const opts = { content: a.content, title: a.title, subtitle: a.subtitle, style: a.style, orientation: a.orientation, letterhead: jsonArg<Letterhead | undefined>(a.letterhead, "letterhead"), signature: jsonArg<Signature | undefined>(a.signature, "signature"), recipients: jsonArg<string[]>(a.recipients, "recipients"), page_numbers: a.page_numbers };
        const bytes = await createDocx(opts);
        await commit(ctx, abs, bytes, existed);
        return `Đã ${existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(bytes.length)}).\n${describeDocx(opts)}\nHãy dùng read_document để kiểm tra lại nội dung trước khi báo cáo.`;
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
      description: "Create an Excel workbook (.xlsx). sheets = [{name, rows: [[...], ...]}]; the first row is the header (bold, blue fill, frozen) unless header=false. Cells: numbers as real numbers (not '1.200.000' strings), text, or formulas as strings starting with '=' (English function names, comma separators, e.g. '=SUM(B2:B10)', '=IF(C2>=5,\"Đạt\",\"Không đạt\")'). ISO dates 'YYYY-MM-DD' become real dates shown dd/mm/yyyy. Formulas are calculated and returned so you can verify the numbers. number_formats e.g. {\"C\": \"#,##0\", \"D\": \"0.0%\"}. conditional colours cells: [{range: \"D2:D30\", rule: \"bars\" | \"scale\" | {op: \"lt\"|\"le\"|\"gt\"|\"ge\"|\"eq\"|\"ne\", value: 5, color: \"red\"|\"green\"|\"yellow\"}}]. Excel charts are not supported (use create_pptx for charts). BULK DATA: never type more than ~40 rows yourself (the call gets cut off). Instead give a sheet `generate` = {count, seed?, columns: [{name, type, ...}]} and the tool generates the rows: types seq {start,step,prefix,pad}, pick {values,weights?}, int {min,max}, float {min,max,decimals}, date {from,to} (ISO), name_vi {gender?: nam|nu}, email {from: column name, domain}, phone_vi, bool {true_label,false_label,p}, text {template}, formula {template}; in templates {seq} = 1..count, {row} = Excel row number, {col:Column name} = that column's value in the same row. The header row is built from the column names unless you give your own `rows` first.",
      parameters: { type: "object", properties: { path: S, sheets: { type: "array", items: { type: "object", properties: { name: S, generate: { type: "object", description: "bulk generator {count, seed?, columns:[{name,type,...}]}: the tool generates the rows" }, rows: { type: "array", items: { type: "array", items: {} } }, header: { type: "boolean" }, widths: { type: "array", items: { type: "number" } }, freeze_header: { type: "boolean" }, autofilter: { type: "boolean" }, number_formats: { type: "object" }, conditional: { type: "array", items: { type: "object", properties: { range: S, rule: {} }, required: ["range", "rule"] } } }, required: ["name"] } } }, required: ["path", "sheets"] },
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
          built = await createXlsx(sheets);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        await commit(ctx, abs, built.bytes, existed);
        return reportOf(`Đã ${existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(built.bytes.length)}).\n${built.dims.join("\n")}`, built.report);
      },
    },
    {
      name: "xlsx_edit", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || a.path,
      description: "Edit an existing Excel file: set cells, append rows, or add a sheet. Read the file first. All formulas are recalculated and checked. set = {\"B2\": 10, \"C2\": \"=B2*2\", \"Sheet2!D5\": \"Đạt\", \"E1\": null}. Use save_as to keep the original untouched (recommended). Note: charts, pivot tables and macros in the original may be lost.",
      parameters: { type: "object", properties: { path: S, sheet: { type: "string", description: "default sheet for set/append_rows" }, set: { type: "object" }, append_generate: { type: "object", description: "append BULK generated rows (same spec as create_xlsx generate: {count, seed?, columns}); use this instead of typing many rows" }, append_rows: { type: "array", items: { type: "array", items: {} } }, add_sheet: { type: "object", properties: { name: S, rows: { type: "array", items: { type: "array", items: {} } } } }, save_as: { type: "string" } }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""}${a.save_as ? " → " + a.save_as : ""}`,
      async preview(ctx, a) {
        let n = 0;
        try { n = Object.keys(jsonArg<Record<string, unknown>>(a.set, "set") ?? {}).length; } catch { /* bỏ qua */ }
        let rows = 0;
        try { rows = (jsonArg<unknown[][]>(a.append_rows, "append_rows") ?? []).length; } catch { /* bỏ qua */ }
        return outlinePreview(ctx, a.save_as || a.path, `Sửa ${a.path}${a.save_as ? ` (lưu thành ${a.save_as})` : " (ghi đè bản gốc)"}: ${n} ô, ${rows} hàng thêm${a.add_sheet ? ", thêm sheet “" + a.add_sheet.name + "”" : ""}.` + (n ? "\n" + Object.entries(jsonArg<Record<string, unknown>>(a.set, "set") ?? {}).slice(0, 12).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`).join("\n") : ""));
      },
      async run(ctx, a) {
        const src = await resolveSafe(ctx, a.path);
        if (!ctx.readFiles.has(src)) throw new ToolError(`Hãy đọc ${a.path} bằng read_document trước khi sửa.`);
        await checkFresh(ctx, src, a.path);
        const { bytes } = await loadBinary(ctx, a.path, [".xlsx", ".xlsm"]);
        const edit = { sheet: a.sheet, set: jsonArg<Record<string, any>>(a.set, "set"), append_rows: jsonArg<any[][]>(a.append_rows, "append_rows"), add_sheet: jsonArg<any>(a.add_sheet, "add_sheet") };
        const gen = jsonArg<GenSpec>(a.append_generate, "append_generate");
        if (gen) {
          try {
            const first = (await sheetRowCount(bytes, a.sheet)) + 1;
            edit.append_rows = [...(edit.append_rows ?? []), ...generateRows(validateGen(gen), first)];
          } catch (e) {
            throw new ToolError((e as Error).message);
          }
        }
        if (!edit.set && !edit.append_rows && !edit.add_sheet) throw new ToolError("Cần ít nhất một trong set, append_rows, append_generate, add_sheet.");
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
        return reportOf(`Đã lưu ${relPath(ctx, abs)}. Đã sửa: ${res.changed.slice(0, 20).join(", ")}${res.changed.length > 20 ? ` … (+${res.changed.length - 20})` : ""}.`, res.report);
      },
    },
    {
      name: "create_pptx", kind: "edit", readonly: false, pathArg: "path",
      description: "Create a PowerPoint (.pptx) from Markdown. Slides are separated by a line containing only ---. Each slide: a '# Title' (or ##) line, then bullets (- item, nested by 2 spaces), paragraphs, tables or code. The first slide with '# Title' and a short subtitle paragraph becomes the cover. A paragraph starting 'Ghi chú:' becomes the presenter notes. A real chart: a fenced block ```chart cột (or ngang, đường, tròn, vành, vùng) with an optional 'title: ...' line and a Markdown table (first column = labels, other columns = numeric series, e.g. 7,5 or 1.200). Keep 3-6 short bullets per slide; split long content across slides. LAYOUTS are chosen automatically from the content, so write it to fit: a title-only slide (or '## 1. Name' + one line) = section divider; the LAST slide with a short title (e.g. 'Cảm ơn') = closing; 2-4 bullets like '92%: sinh viên dùng…' or '**1.200** bài giảng' = big-number cards; 3-6 bullets like '**Hạ tầng**: mô tả…' or 'Hạ tầng: mô tả…' = numbered cards; an ORDERED list (1. 2. 3.) of 3-5 steps = process timeline; a single '> quote' (+ optional attribution line) = quote slide; bullets plus ONE chart, small table or image = two columns. An image: a line '![mô tả](hinh/anh.png)' with a png/jpg/gif file in the project folder. theme chooses the colors: xanh (default), ngoc, xanhla, cam, tim, do, den; pick one that fits the topic or the user's wish.",
      parameters: { type: "object", properties: { path: S, content: { type: "string", description: "Markdown, slides separated by ---" }, footer: { type: "string" }, theme: { type: "string", enum: Object.keys(PPTX_THEMES), description: "color theme (default xanh)" } }, required: ["path", "content"] },
      summarize: (a) => String(a.path ?? ""),
      async preview(ctx, a) {
        return outlinePreview(ctx, a.path, describePptx(String(a.content ?? "")));
      },
      async run(ctx, a) {
        const { abs, existed } = await prepareWrite(ctx, a.path, ".pptx");
        if (typeof a.content !== "string" || !a.content.trim()) throw new ToolError("Thiếu content (Markdown).");
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
          r = await createPptx({ content: a.content, footer: a.footer, theme: typeof a.theme === "string" ? a.theme : undefined, images });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        await commit(ctx, abs, r.bytes, existed);
        return `Đã ${existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(r.bytes.length)}, ${r.slides} slide).` + (r.warnings.length ? "\n⚠ " + r.warnings.join("\n⚠ ") : "") + "\nHãy dùng read_document để kiểm tra lại.";
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
