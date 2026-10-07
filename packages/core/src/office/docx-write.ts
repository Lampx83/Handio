import { parseBlocks, parseInline, runsText, type Align, type Block, type Run } from "./mdblocks";

export interface Letterhead {
  /** Cơ quan chủ quản (vd "ĐẠI HỌC KINH TẾ QUỐC DÂN"). */
  agency_parent?: string;
  /** Cơ quan ban hành (vd "KHOA CÔNG NGHỆ THÔNG TIN"). */
  agency?: string;
  /** Số, ký hiệu (vd "Số: 12/TB-CNTT"). */
  doc_number?: string;
  /** Địa danh, ngày tháng (vd "Hà Nội, ngày 07 tháng 10 năm 2026"). */
  place_date?: string;
}
export interface Signature {
  /** Chức danh người ký (vd "TRƯỞNG KHOA"). */
  role: string;
  name?: string;
  /** Vd "KT. HIỆU TRƯỞNG" (ký thay mặt). */
  on_behalf?: string;
}
export interface DocxOptions {
  /** Nội dung Markdown. */
  content: string;
  /** Tiêu đề căn giữa, in đậm (vd "THÔNG BÁO"). */
  title?: string;
  /** Dòng trích yếu dưới tiêu đề (vd "V/v tổ chức hội thảo…"). */
  subtitle?: string;
  /** "formal" (Times New Roman 13, căn đều, lề chuẩn hành chính) hoặc "modern" (Calibri 11). */
  style?: "formal" | "modern";
  orientation?: "portrait" | "landscape";
  letterhead?: Letterhead;
  signature?: Signature;
  /** Nơi nhận (mỗi phần tử một dòng, vd "- Như trên;"). */
  recipients?: string[];
  /** Đánh số trang ở chân trang (mặc định true). */
  page_numbers?: boolean;
}

const CM = 567; // twip / cm
const bytesFromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function createDocx(o: DocxOptions): Promise<Uint8Array> {
  const d = await import("docx");
  const formal = (o.style ?? "formal") === "formal";
  const font = formal ? "Times New Roman" : "Calibri";
  const size = formal ? 26 : 22; // nửa điểm
  const landscape = o.orientation === "landscape";
  const algn = (a?: Align) => (a === "center" ? d.AlignmentType.CENTER : a === "right" ? d.AlignmentType.RIGHT : a === "justify" ? d.AlignmentType.JUSTIFIED : a === "left" ? d.AlignmentType.LEFT : undefined);
  const bodyAlign = formal ? d.AlignmentType.JUSTIFIED : d.AlignmentType.LEFT;

  const mkRuns = (runs: Run[], extra: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
    runs.map((r) => {
      const tr = new d.TextRun({ text: r.text, bold: r.bold || extra.bold, italics: r.italic || extra.italics, size: extra.size, font: r.code ? "Consolas" : undefined, shading: r.code ? { type: d.ShadingType.CLEAR, fill: "EEEEEE", color: "auto" } : undefined, style: r.link ? "Hyperlink" : undefined });
      return r.link ? new d.ExternalHyperlink({ link: r.link, children: [tr] }) : tr;
    });

  const numbering: { reference: string; levels: object[] }[] = [
    { reference: "bullets", levels: [0, 1, 2, 3].map((level) => ({ level, format: d.LevelFormat.BULLET, text: ["•", "–", "▪", "·"][level], alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 567 + level * 425, hanging: 283 } } } })) },
  ];
  let orderedCount = 0;
  const makeOrderedRef = () => {
    const ref = `num${orderedCount++}`;
    numbering.push({ reference: ref, levels: [0, 1, 2, 3].map((level) => ({ level, format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN, d.LevelFormat.DECIMAL][level], text: `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 567 + level * 425, hanging: 340 } } } })) });
    return ref;
  };

  const border = { style: d.BorderStyle.SINGLE, size: 4, color: "808080" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const noBorder = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];

  const para = (runs: Run[], opts: { align?: Align; indentFirst?: boolean; bold?: boolean; italics?: boolean; size?: number; before?: number; after?: number; keepNext?: boolean } = {}) =>
    new d.Paragraph({
      alignment: algn(opts.align) ?? bodyAlign,
      indent: opts.indentFirst && formal ? { firstLine: CM } : undefined,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: formal ? 312 : 276 },
      keepNext: opts.keepNext,
      children: mkRuns(runs, { bold: opts.bold, italics: opts.italics, size: opts.size }),
    });

  const tableOf = (b: Extract<Block, { t: "table" }>) => {
    const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
    const cell = (runs: Run[], i: number, head: boolean) =>
      new d.TableCell({
        borders,
        width: { size: Math.floor(100 / cols), type: d.WidthType.PERCENTAGE },
        shading: head ? { type: d.ShadingType.CLEAR, fill: "D9E2F3", color: "auto" } : undefined,
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        verticalAlign: d.VerticalAlign.CENTER,
        children: [new d.Paragraph({ alignment: head ? d.AlignmentType.CENTER : algn(b.align[i]) ?? d.AlignmentType.LEFT, spacing: { after: 0, line: 264 }, children: mkRuns(runs, { bold: head, size: formal ? 24 : 20 }) })],
      });
    const pad = (row: Run[][]) => Array.from({ length: cols }, (_, i) => row[i] ?? [{ text: "" }]);
    return new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      rows: [new d.TableRow({ tableHeader: true, cantSplit: true, children: pad(b.header).map((c, i) => cell(c, i, true)) }), ...b.rows.map((r) => new d.TableRow({ cantSplit: true, children: pad(r).map((c, i) => cell(c, i, false)) }))],
    });
  };

  // ---- đầu văn bản (quốc hiệu) ----
  const lh = o.letterhead;
  if (lh && (lh.agency || lh.agency_parent || lh.place_date)) {
    const mid = (text: string, opts: { bold?: boolean; size?: number; italics?: boolean; underline?: boolean } = {}) =>
      new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 0 }, children: [new d.TextRun({ text, bold: opts.bold, size: opts.size ?? 26, italics: opts.italics, font: "Times New Roman" })] });
    const line = () => new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 40 }, border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } }, indent: { left: 700, right: 700 }, children: [] });
    const left: InstanceType<typeof d.Paragraph>[] = [];
    if (lh.agency_parent) left.push(mid(lh.agency_parent.toUpperCase(), { size: 24 }));
    if (lh.agency) left.push(mid(lh.agency.toUpperCase(), { bold: true, size: 24 }), line());
    if (lh.doc_number) left.push(mid(lh.doc_number, { size: 26 }));
    const right = [mid("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { bold: true, size: 24 }), mid("Độc lập - Tự do - Hạnh phúc", { bold: true, size: 26 }), line()];
    if (lh.place_date) right.push(mid(lh.place_date, { italics: true, size: 26 }));
    children.push(
      new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [new d.TableRow({ children: [new d.TableCell({ borders: noBorders, width: { size: 46, type: d.WidthType.PERCENTAGE }, children: left.length ? left : [mid("")] }), new d.TableCell({ borders: noBorders, width: { size: 54, type: d.WidthType.PERCENTAGE }, children: right })] })],
      }),
      new d.Paragraph({ spacing: { after: 120 }, children: [] }),
    );
  }

  // ---- tiêu đề ----
  if (o.title) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 120, after: o.subtitle ? 40 : 200 }, keepNext: true, children: [new d.TextRun({ text: o.title, bold: true, size: formal ? 28 : 32 })] }));
  if (o.subtitle) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 240 }, children: [new d.TextRun({ text: o.subtitle, bold: formal, size: formal ? 26 : 24 })] }));

  // ---- thân văn bản ----
  const blocks = parseBlocks(o.content);
  let h1Seen = false;
  for (const b of blocks) {
    if (b.t === "heading") {
      const lvl = Math.min(b.level, 3);
      const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][lvl - 1];
      // heading 1 đầu tiên trùng với tiêu đề đã có thì giữ như tiêu đề thường
      children.push(new d.Paragraph({ heading, keepNext: true, children: mkRuns(b.runs), spacing: { before: h1Seen || lvl > 1 ? 200 : 120, after: 100 } }));
      if (lvl === 1) h1Seen = true;
    } else if (b.t === "para") children.push(para(b.runs, { align: b.align, indentFirst: !b.align }));
    else if (b.t === "quote") children.push(new d.Paragraph({ indent: { left: 567 }, border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: "A0A0A0", space: 8 } }, spacing: { after: 120 }, children: mkRuns(b.runs, { italics: true }) }));
    else if (b.t === "code") b.text.split("\n").forEach((l, i, arr) => children.push(new d.Paragraph({ shading: { type: d.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" }, spacing: { after: i === arr.length - 1 ? 120 : 0 }, children: [new d.TextRun({ text: l || " ", font: "Consolas", size: 20 })] })));
    else if (b.t === "list") {
      const ref = b.items.some((it) => it.ordered) ? makeOrderedRef() : "bullets";
      for (const it of b.items) children.push(new d.Paragraph({ numbering: { reference: it.ordered ? ref : "bullets", level: it.level }, alignment: bodyAlign, spacing: { after: 60, line: formal ? 312 : 276 }, children: mkRuns(it.runs) }));
      children.push(new d.Paragraph({ spacing: { after: 60 }, children: [] }));
    } else if (b.t === "table") {
      children.push(tableOf(b), new d.Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.t === "hr") children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 160 }, children: [] }));
    else if (b.t === "pagebreak") children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
  }

  // ---- nơi nhận + chữ ký ----
  if (o.signature || o.recipients?.length) {
    const rec = (o.recipients ?? []).map((r) => new d.Paragraph({ spacing: { after: 0 }, children: [new d.TextRun({ text: r.replace(/^[-*]\s*/, "- "), size: 22 })] }));
    const sigPars: InstanceType<typeof d.Paragraph>[] = [];
    const c = (text: string, bold = true, sz = 26) => new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 0 }, keepNext: true, children: [new d.TextRun({ text, bold, size: sz })] });
    if (o.signature) {
      if (o.signature.on_behalf) sigPars.push(c(o.signature.on_behalf.toUpperCase()));
      sigPars.push(c(o.signature.role.toUpperCase()));
      sigPars.push(...Array.from({ length: 4 }, () => c("", false)));
      if (o.signature.name) sigPars.push(c(o.signature.name));
    }
    children.push(
      new d.Paragraph({ spacing: { after: 120 }, children: [] }),
      new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        rows: [new d.TableRow({ cantSplit: true, children: [
          new d.TableCell({ borders: noBorders, width: { size: 55, type: d.WidthType.PERCENTAGE }, children: rec.length ? [new d.Paragraph({ spacing: { after: 0 }, children: [new d.TextRun({ text: "Nơi nhận:", bold: true, italics: true, size: 22 })] }), ...rec] : [new d.Paragraph({ children: [] })] }),
          new d.TableCell({ borders: noBorders, width: { size: 45, type: d.WidthType.PERCENTAGE }, children: sigPars.length ? sigPars : [new d.Paragraph({ children: [] })] }),
        ] })],
      }),
    );
  }

  const margin = formal ? { top: 2 * CM, bottom: 2 * CM, left: 3 * CM, right: 2 * CM } : { top: 1134, bottom: 1134, left: 1134, right: 1134 };
  const doc = new d.Document({
    creator: "NEU Agent",
    title: o.title || runsText(blocks.find((b): b is Extract<Block, { t: "heading" }> => b.t === "heading")?.runs ?? [{ text: "Tài liệu" }]),
    styles: {
      default: { document: { run: { font, size }, paragraph: { spacing: { line: formal ? 312 : 276 } } } },
      paragraphStyles: [1, 2, 3].map((n) => ({ id: `Heading${n}`, name: `Heading ${n}`, basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, bold: true, size: formal ? [28, 27, 26][n - 1] : [34, 28, 24][n - 1], color: formal ? "000000" : "1F3864", italics: formal && n === 3 }, paragraph: { outlineLevel: n - 1, alignment: formal && n === 1 ? d.AlignmentType.LEFT : d.AlignmentType.LEFT } })),
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", run: { color: "0563C1", underline: { type: d.UnderlineType.SINGLE } } }],
    },
    numbering: { config: numbering as never },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, orientation: landscape ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT }, margin } },
      footers: o.page_numbers === false ? undefined : { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], size: 22 })] })] }) },
      children,
    }],
  });
  return bytesFromBase64(await d.Packer.toBase64String(doc));
}

export function describeDocx(o: Pick<DocxOptions, "content" | "title" | "letterhead" | "signature">): string {
  const blocks = parseBlocks(o.content);
  const count = (t: Block["t"]) => blocks.filter((b) => b.t === t).length;
  const heads = blocks.filter((b): b is Extract<Block, { t: "heading" }> => b.t === "heading").slice(0, 10).map((b) => "  ".repeat(b.level - 1) + "• " + runsText(b.runs));
  const words = blocks.reduce((n, b) => n + (b.t === "para" || b.t === "quote" ? runsText(b.runs).split(/\s+/).length : 0), 0);
  return [`Văn bản Word${o.title ? ` “${o.title}”` : ""}: ${count("heading")} tiêu đề, ${count("para")} đoạn (~${words} từ), ${count("list")} danh sách, ${count("table")} bảng${o.letterhead ? ", có quốc hiệu/tiêu ngữ" : ""}${o.signature ? ", có chữ ký" : ""}.`, ...heads].join("\n");
}

export { parseInline };
