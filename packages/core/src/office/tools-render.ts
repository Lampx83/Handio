import type { Env } from "../env";
import { relPath, ToolError, type Tool } from "../tools";
import { buildPdfHtml } from "./pdf-html";
import { commit, kb, prepareWrite } from "./tools";

const S = { type: "string" } as const;

/** Công cụ cần khả năng dựng trang của máy (Desktop: Chromium): create_pdf. Không có `env.htmlToPdf` thì không đăng ký. */
export function renderTools(env: Env): Tool[] {
  if (!env.htmlToPdf) return [];
  const render = env.htmlToPdf.bind(env);
  return [
    {
      name: "create_pdf", kind: "edit", readonly: false, pathArg: "path",
      description: "Create a professionally typeset PDF (A4) directly from Markdown, no Word needed: title block, headings, paragraphs, bullet/numbered lists, tables (zebra rows, numbers right-aligned), > quotes and callouts (start the quote with **Lưu ý:**, **Mẹo:** or **Cảnh báo:**), code, ---, <<<pagebreak>>> and REAL charts via a fenced block ```chart cột|ngang|đường|tròn|vành|vùng with an optional 'title:' line and a Markdown table (first column labels, next columns numbers). Page numbers in the footer. Use it for reports, handouts, summaries, certificates-style documents the user wants as PDF. To turn an existing Word/Excel/PowerPoint into PDF use convert_to_pdf instead (needs LibreOffice).",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "output path ending in .pdf" },
        content: { type: "string", description: "document body in Markdown (start with the first heading; the title block comes from `title`)" },
        title: S, subtitle: S, meta: { type: "string", description: "small line under the title, e.g. author, unit, date" },
        accent: { type: "string", description: "accent color #RRGGBB or a name like xanh dương, đỏ, xanh lá" },
        footer: { type: "string", description: "left footer text, e.g. document or unit name" },
        toc: { type: "boolean", description: "table of contents (use for 4+ sections)" }, landscape: { type: "boolean" },
      }, required: ["path", "content"] },
      summarize: (a) => String(a.path ?? ""),
      async run(ctx, a) {
        if (typeof a.content !== "string" || !a.content.trim()) throw new ToolError("Thiếu content (nội dung Markdown).", "bad_args");
        const { abs, existed } = await prepareWrite(ctx, a.path, ".pdf");
        let built;
        try {
          built = buildPdfHtml({ content: a.content, title: a.title, subtitle: a.subtitle, meta: a.meta, accent: a.accent, toc: a.toc === true, landscape: a.landscape === true });
        } catch (e) {
          throw new ToolError((e as Error).message, "bad_args");
        }
        let bytes: Uint8Array;
        try {
          bytes = await render(built.html, { footer: typeof a.footer === "string" ? a.footer.slice(0, 120) : "", landscape: a.landscape === true });
        } catch (e) {
          throw new ToolError("Không dựng được PDF: " + (e as Error).message);
        }
        await commit(ctx, abs, bytes, existed);
        return `Đã ${existed ? "ghi đè" : "tạo"} ${relPath(ctx, abs)} (${kb(bytes.length)}).` + (built.warnings.length ? "\n⚠ " + built.warnings.join("\n⚠ ") : "") + "\nHãy dùng pdf_text (hoặc read_document) để kiểm tra lại nội dung.";
      },
    },
  ];
}
