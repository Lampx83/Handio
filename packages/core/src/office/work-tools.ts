/* eslint-disable @typescript-eslint/no-explicit-any */
/** Công cụ nâng cao của tab Work: trộn thư hàng loạt, quét/che dữ liệu cá nhân, bảng tổng hợp bằng công thức sống. */
import type { Env } from "../env";
import { basename, dirname, join } from "../path";
import { pushUndo, relPath, remember, resolveSafe, ToolError, walk, type Tool, type ToolContext } from "../tools";
import { docxToMarkdown } from "./docx-read";
import { combineDocx, fileNames, fillTemplate, loadMergeData, MERGE_MAX, planMerge, templatePlaceholders, type MergePlan, type Template } from "./merge";
import { countsLine, PII_LABEL, redactDocument, scanDocumentPii, type PiiType } from "./pii";
import { planPivot } from "./pivot";
import { extOf, isReadableDocument } from "./readdoc";
import { readPptx } from "./pptx";
import { editXlsx } from "./xlsx";
import { jsonArg, kb, loadBinary, outlinePreview, prepareWrite, reportOf } from "./tools";

const S = { type: "string" } as const;
const stem = (p: string): string => basename(p).replace(/\.[^.]+$/, "");
const GROUP = () => `lot-${Date.now().toString(36)}`;

async function writeNew(ctx: ToolContext, abs: string, bytes: Uint8Array, group: string): Promise<void> {
  await ctx.env.mkdirp(dirname(abs));
  await ctx.env.writeBytes(abs, bytes);
  await remember(ctx, abs);
  pushUndo(ctx, abs, null, group);
}

interface Loaded {
  tpl: Template;
  tplAbs: string;
  data: Awaited<ReturnType<typeof loadMergeData>>;
  plan: MergePlan;
}

async function loadMerge(ctx: ToolContext, a: any): Promise<Loaded> {
  const t = await loadBinary(ctx, a.template, [".docx", ".pptx"]);
  const kind = extOf(t.abs) === ".docx" ? "docx" : "pptx";
  const d = await loadBinary(ctx, a.data, [".xlsx", ".xlsm", ".csv", ".tsv", ".txt"]);
  let data;
  try {
    data = await loadMergeData(d.bytes, extOf(d.abs), { sheet: a.sheet ? String(a.sheet) : undefined, decimalComma: a.decimal_comma });
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
  const offset = Math.max(0, Math.floor(Number(a.offset) || 0));
  if (offset) data = { headers: data.headers, rows: data.rows.slice(offset) };
  const tpl: Template = { kind, bytes: t.bytes };
  let ph: string[];
  try {
    ph = await templatePlaceholders(tpl);
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
  if (!ph.length) throw new ToolError("Mẫu không có chỗ trống dạng {{Tên cột}}. Hãy thêm {{Họ tên}}, {{Chức vụ}}… vào mẫu (đúng tên cột trong bảng dữ liệu).");
  return { tpl, tplAbs: t.abs, data, plan: planMerge(data, ph) };
}

const textOf = async (tpl: Template, bytes: Uint8Array): Promise<string> =>
  tpl.kind === "docx" ? await docxToMarkdown(bytes) : (await readPptx(bytes)).map((s) => s.label + "\n" + s.text).join("\n\n");

function planReport(l: Loaded, names: string[]): string {
  const p = l.plan;
  const empties = Object.entries(p.empties).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n} dòng trống`);
  return [
    `Mẫu: ${l.tpl.kind === "docx" ? "Word" : "PowerPoint"} · ${p.placeholders.length} chỗ trống: ${p.placeholders.map((x) => `{{${x}}}`).join(" ")}`,
    `Dữ liệu: ${p.rows} dòng (tối đa ${MERGE_MAX} bản mỗi lần).`,
    p.missing.length ? `⚠ Thiếu cột cho: ${p.missing.map((x) => `{{${x}}}`).join(" ")} (các cột có: ${l.data.headers.filter(Boolean).join(", ")})` : "Mọi chỗ trống đều có cột tương ứng.",
    empties.length ? `⚠ Ô trống: ${empties.join("; ")}` : "",
    p.unused.length ? `Cột chưa dùng: ${p.unused.join(", ")}` : "",
    `Tên tệp: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` … (${names.length} tệp)` : ""}`,
  ].filter(Boolean).join("\n");
}

async function namesFor(ctx: ToolContext, l: Loaded, a: any, dirAbs: string): Promise<string[]> {
  const ext = l.tpl.kind === "docx" ? ".docx" : ".pptx";
  const existing = new Set<string>();
  try {
    for (const e of await ctx.env.readdir(dirAbs)) existing.add(e.name.toLowerCase());
  } catch {
    /* thư mục chưa có */
  }
  return fileNames(l.plan, a.name_pattern ? String(a.name_pattern) : undefined, stem(l.tplAbs), ext, (n) => existing.has(n.toLowerCase()));
}

const defaultDir = (a: any): string => String(a.output_dir || `${String(a.template ?? "mau").replace(/\.[^./]+$/, "")}-hang-loat`);

export function workTools(_env: Env): Tool[] {
  const tools: Tool[] = [
    {
      name: "merge_check", kind: "read", readonly: true, pathArg: "template",
      description: "Mail merge dry run (writes nothing): check a Word/PowerPoint template containing {{Column}} placeholders against a data table (Excel/CSV, first row = column names). Reports the placeholders, missing columns, empty cells, the file names, and shows the FIRST merged output so the user can check it. Always run this before merge_documents.",
      parameters: { type: "object", properties: { template: S, data: S, sheet: { type: "string", description: "Excel sheet name (default: first)" }, name_pattern: { type: "string", description: "file name pattern, e.g. giay-moi-{{Họ tên}}" }, offset: { type: "integer", description: "skip the first N data rows (to process more than 200 in several runs)" }, decimal_comma: { type: "boolean", description: "write 8.5 as 8,5 (default true)" } }, required: ["template", "data"] },
      summarize: (a) => `${a.template ?? ""} + ${a.data ?? ""}`,
      async run(ctx, a) {
        const l = await loadMerge(ctx, a);
        if (!l.plan.rows) throw new ToolError("Bảng dữ liệu không có dòng nào.");
        const names = await namesFor(ctx, l, a, await resolveSafe(ctx, defaultDir(a)));
        let sample = "";
        if (!l.plan.missing.length) {
          const f = await fillTemplate(l.tpl, l.plan.valuesOf(0));
          sample = "\nBản đầu tiên (dòng dữ liệu 1):\n" + (await textOf(l.tpl, f.bytes)).slice(0, 1500);
        }
        return planReport(l, names) + sample + (l.plan.rows > MERGE_MAX ? `\n⚠ Có ${l.plan.rows} dòng > ${MERGE_MAX}: chỉ làm ${MERGE_MAX} dòng mỗi lần (dùng offset để làm tiếp).` : "");
      },
    },
    {
      name: "merge_documents", kind: "edit", readonly: false, pathArg: "template", targetPath: (a) => defaultDir(a),
      description: `Mail merge: create one Word/PowerPoint file per data row (certificates, invitations, personal score sheets, decisions) from a template with {{Column}} placeholders and an Excel/CSV table. mode 'combined' (Word only) makes ONE file with one copy per page. Max ${MERGE_MAX} outputs per call. Never overwrites: existing names get a -2 suffix. Run merge_check first and show the user the first output.`,
      parameters: { type: "object", properties: { template: S, data: S, sheet: S, mode: { type: "string", enum: ["separate", "combined"] }, name_pattern: { type: "string", description: "file name pattern, e.g. giay-khen-{{Họ tên}}" }, output_dir: { type: "string", description: "folder for the results (default: <template>-hang-loat)" }, offset: { type: "integer" }, decimal_comma: { type: "boolean" } }, required: ["template", "data"] },
      summarize: (a) => `${a.template ?? ""} × ${a.data ?? ""}`,
      async preview(ctx, a) {
        try {
          const l = await loadMerge(ctx, a);
          const dir = defaultDir(a);
          const names = await namesFor(ctx, l, a, await resolveSafe(ctx, dir));
          let sample = "";
          if (!l.plan.missing.length && l.plan.rows) sample = "\n\nBản đầu:\n" + (await textOf(l.tpl, (await fillTemplate(l.tpl, l.plan.valuesOf(0))).bytes)).slice(0, 600);
          return await outlinePreview(ctx, dir, `${a.mode === "combined" ? "1 tệp gộp" : Math.min(l.plan.rows, MERGE_MAX) + " tệp"} từ ${l.plan.rows} dòng\n` + planReport(l, names) + sample);
        } catch (e) {
          return outlinePreview(ctx, defaultDir(a), "Không xem trước được: " + (e as Error).message);
        }
      },
      async run(ctx, a) {
        const l = await loadMerge(ctx, a);
        const p = l.plan;
        if (!p.rows) throw new ToolError("Bảng dữ liệu không có dòng nào.");
        if (p.rows > MERGE_MAX) throw new ToolError(`Có ${p.rows} dòng, vượt giới hạn ${MERGE_MAX} bản mỗi lần. Chia dữ liệu: chạy lại với offset=0, ${MERGE_MAX}, …`);
        if (p.missing.length) throw new ToolError(`Mẫu có chỗ trống không có cột: ${p.missing.map((x) => `{{${x}}}`).join(" ")}. Các cột có: ${l.data.headers.filter(Boolean).join(", ")}. Sửa mẫu hoặc tên cột rồi chạy lại.`);
        const combined = a.mode === "combined";
        if (combined && l.tpl.kind !== "docx") throw new ToolError("Chế độ combined chỉ dùng cho mẫu Word.");
        const dirAbs = await resolveSafe(ctx, defaultDir(a));
        const st = await ctx.env.stat(dirAbs);
        if (st && !st.isDir) throw new ToolError(`${relPath(ctx, dirAbs)} là một tệp, không phải thư mục.`);
        const group = GROUP();
        const copies: Uint8Array[] = [];
        let replaced = 0;
        for (let i = 0; i < p.rows; i++) {
          const f = await fillTemplate(l.tpl, p.valuesOf(i));
          replaced += f.replaced;
          copies.push(f.bytes);
        }
        if (combined) {
          const out = await combineDocx(copies);
          let name = `${stem(l.tplAbs)}-gop.docx`;
          for (let n = 2; await ctx.env.stat(join(dirAbs, name)); n++) name = `${stem(l.tplAbs)}-gop-${n}.docx`;
          await writeNew(ctx, join(dirAbs, name), out, group);
          return `Đã tạo ${relPath(ctx, join(dirAbs, name))} (${kb(out.length)}): ${p.rows} bản, mỗi bản một trang; ${replaced} chỗ đã điền.\nHãy dùng read_document để kiểm tra lại, đối chiếu từng họ tên với bảng dữ liệu.`;
        }
        const names = await namesFor(ctx, l, a, dirAbs);
        for (let i = 0; i < copies.length; i++) await writeNew(ctx, join(dirAbs, names[i]), copies[i], group);
        return `Đã tạo ${copies.length} tệp trong ${relPath(ctx, dirAbs)}/ (${replaced} chỗ đã điền). Ví dụ: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""}.\nHoàn tác được tất cả cùng lúc bằng /undo. Hãy đọc lại vài tệp (đầu, giữa, cuối) để kiểm tra tên người và số liệu.`;
      },
    },
    {
      name: "scan_pii", kind: "read", readonly: true, pathArg: "path",
      description: "Scan a document (or every document in a folder) for personal data: ID card (CCCD/CMND), phone numbers, emails, tax codes, bank account numbers, student IDs. Reports counts and locations only; values are masked and never shown in full. Use before sharing/sending a document, then offer redact_pii.",
      parameters: { type: "object", properties: { path: { type: "string", description: "a file, or a folder (default: whole project)" } } },
      summarize: (a) => String(a.path ?? "(cả thư mục)"),
      async run(ctx, a) {
        const abs = await resolveSafe(ctx, a.path || ".");
        const st = await ctx.env.stat(abs);
        if (!st) throw new ToolError(`Không có ${a.path}.`);
        const files: string[] = [];
        if (st.isDir) {
          for await (const f of walk(ctx, abs)) if (isReadableDocument(f) && files.push(f) >= 40) break;
        } else files.push(abs);
        const lines: string[] = [];
        let total = 0;
        let clean = 0;
        let skipped = 0;
        for (const f of files) {
          try {
            const s = await ctx.env.stat(f);
            if (!s || s.size > 25 * 1024 * 1024) throw new Error("quá lớn");
            const r = await scanDocumentPii(await ctx.env.readBytes(f), extOf(f));
            if (!r.total) {
              clean++;
              continue;
            }
            total += r.total;
            const by = (t: PiiType) => r.findings.filter((x) => x.type === t);
            const detail = (Object.keys(PII_LABEL) as PiiType[]).filter((t) => r.counts[t]).map((t) => `    ${PII_LABEL[t]} ×${r.counts[t]}: ` + by(t).slice(0, 6).map((x) => `${x.loc} ${x.masked}`).join("; ") + (r.counts[t] > 6 ? " …" : ""));
            lines.push(`${relPath(ctx, f)}: ${countsLine(r.counts)}${r.note ? " (" + r.note + ")" : ""}\n${detail.join("\n")}`);
          } catch {
            skipped++;
          }
        }
        return (lines.length ? lines.join("\n") + "\n" : "") + `Đã quét ${files.length} tệp: ${total ? `${total} chỗ có dữ liệu cá nhân trong ${lines.length} tệp` : "không thấy dữ liệu cá nhân"}${clean && total ? `, ${clean} tệp sạch` : ""}${skipped ? `, ${skipped} tệp không đọc được` : ""}.\nLưu ý: chỉ nhận ra dạng phổ biến (số 9–10 chữ số trơn chỉ tính khi có từ khoá/tiêu đề cột như MSSV, STK, CMND). PDF scan/ảnh không quét được.` + (total ? "\nCó thể tạo bản đã che bằng redact_pii." : "");
      },
    },
    {
      name: "redact_pii", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || redactName(a.path),
      description: "Write a redacted COPY of a Word, Excel, PowerPoint or text/CSV file where personal data (CCCD/CMND, phone, email, tax code, bank account, student ID) is replaced by labels like [CCCD đã ẩn]. The original is never changed. Run scan_pii first and show the user what will be hidden. Not for PDF.",
      parameters: { type: "object", properties: { path: S, save_as: { type: "string", description: "default: <name>-da-an.<ext>" } }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""} → ${a.save_as || redactName(a.path)}`,
      async preview(ctx, a) {
        try {
          const { bytes, abs } = await loadBinary(ctx, a.path, []);
          const r = await scanDocumentPii(bytes, extOf(abs), 0);
          return await outlinePreview(ctx, a.save_as || redactName(a.path), `Bản đã che dữ liệu cá nhân của ${a.path}: ${r.total ? countsLine(r.counts) : "không thấy gì để che"}. Bản gốc giữ nguyên.`);
        } catch (e) {
          return outlinePreview(ctx, a.save_as || redactName(a.path), "Không xem trước được: " + (e as Error).message);
        }
      },
      async run(ctx, a) {
        const { bytes, abs } = await loadBinary(ctx, a.path, []);
        const ext = extOf(abs);
        if (![".docx", ".xlsx", ".xlsm", ".pptx", ".txt", ".csv", ".tsv", ".md"].includes(ext)) throw new ToolError(`Chưa che được tệp ${ext || "này"}. Hỗ trợ Word, Excel, PowerPoint, .txt, .csv, .md (PDF: hãy che trong bản Word gốc rồi xuất lại PDF).`);
        const outExt = ext === ".xlsm" ? ".xlsx" : ext;
        let r;
        try {
          r = await redactDocument(bytes, ext);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        if (!r.total) throw new ToolError("Không thấy dữ liệu cá nhân nào để che; không tạo bản sao.");
        const dest = await prepareWrite(ctx, a.save_as || redactName(a.path, outExt), outExt);
        const old = dest.existed ? await ctx.env.readBytes(dest.abs).catch(() => null) : null;
        await ctx.env.mkdirp(dirname(dest.abs));
        await ctx.env.writeBytes(dest.abs, r.bytes);
        await remember(ctx, dest.abs);
        pushUndo(ctx, dest.abs, old);
        const left = await scanDocumentPii(r.bytes, outExt, 0).catch(() => null);
        return `Đã tạo ${relPath(ctx, dest.abs)} (${kb(r.bytes.length)}): đã che ${countsLine(r.counts)}. Bản gốc không đổi.\nQuét lại bản mới: ${left ? (left.total ? `còn ${left.total} chỗ (${countsLine(left.counts)})` : "không còn dữ liệu cá nhân nhận ra được") : "không quét lại được"}.\nLưu ý: tên người, địa chỉ, ngày sinh KHÔNG được che tự động; hãy đọc lại trước khi gửi.${ext === ".xlsx" || ext === ".xlsm" ? "\nExcel: biểu đồ/pivot trong tệp gốc có thể mất ở bản sao." : ""}`;
      },
    },
    {
      name: "xlsx_pivot", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => a.save_as || String(a.path ?? "").replace(/(\.xlsx?m?)?$/i, "-tonghop.xlsx"),
      description: "Build a PivotTable-style summary sheet from a data sheet using LIVE formulas (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS): one row per group, one column per measure, plus a total row. Changing the data updates the summary. Saved as a NEW workbook (copy of the original + the summary sheet). group_by: 1-2 column names; values: [{column, agg: sum|count|avg|min|max, label?}]. highlight 'bars'|'scale' colours the first measure column. Cannot create real PivotTables; add a chart of the result afterwards with xlsx_edit `charts`.",
      parameters: { type: "object", properties: { path: S, sheet: { type: "string", description: "data sheet (default: first)" }, group_by: { type: "array", items: S }, values: { type: "array", items: { type: "object", properties: { column: S, agg: { type: "string", enum: ["sum", "count", "avg", "min", "max"] }, label: S }, required: ["agg"] } }, output_sheet: { type: "string", description: "default: Tổng hợp" }, highlight: { type: "string", enum: ["bars", "scale"] }, save_as: { type: "string", description: "default: <name>-tonghop.xlsx" } }, required: ["path", "group_by", "values"] },
      summarize: (a) => `${a.path ?? ""} theo ${jsonArg<string[]>(a.group_by, "group_by")?.join?.(", ") ?? ""}`,
      async preview(ctx, a) {
        try {
          const { bytes } = await loadBinary(ctx, a.path, [".xlsx", ".xlsm"]);
          const plan = await planPivot(bytes, { sheet: a.sheet, group_by: jsonArg(a.group_by, "group_by"), values: jsonArg(a.values, "values"), output_sheet: a.output_sheet, highlight: a.highlight });
          return await outlinePreview(ctx, a.save_as || String(a.path).replace(/(\.xlsx?m?)?$/i, "-tonghop.xlsx"), `Thêm sheet “${a.output_sheet || "Tổng hợp"}” (công thức sống): ${plan.describe}.`);
        } catch (e) {
          return outlinePreview(ctx, a.save_as || String(a.path), "Không xem trước được: " + (e as Error).message);
        }
      },
      async run(ctx, a) {
        const { bytes, abs } = await loadBinary(ctx, a.path, [".xlsx", ".xlsm"]);
        let plan;
        let res;
        try {
          plan = await planPivot(bytes, { sheet: a.sheet, group_by: jsonArg(a.group_by, "group_by"), values: jsonArg(a.values, "values"), output_sheet: a.output_sheet, highlight: a.highlight });
          res = await editXlsx(bytes, plan.edit);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const dest = await prepareWrite(ctx, a.save_as || relPath(ctx, abs).replace(/(\.xlsx?m?)?$/i, "-tonghop.xlsx"), ".xlsx");
        const old = dest.existed ? await ctx.env.readBytes(dest.abs).catch(() => null) : null;
        await ctx.env.mkdirp(dirname(dest.abs));
        await ctx.env.writeBytes(dest.abs, res.bytes);
        await remember(ctx, dest.abs);
        pushUndo(ctx, dest.abs, old);
        return reportOf(`Đã lưu ${relPath(ctx, dest.abs)} với sheet “${a.output_sheet || "Tổng hợp"}”: ${plan.describe}. Bản gốc không đổi.\nLưu ý: biểu đồ/pivot có sẵn trong tệp gốc có thể mất ở bản sao.`, res.report);
      },
    },
  ];
  return tools;
}

/** Tên mặc định của bản đã che: tên-da-an.đuôi. */
export const redactName = (p: unknown, ext?: string): string => String(p ?? "").replace(/(\.[A-Za-z0-9]+)?$/, (m) => `-da-an${ext ?? m}`);

