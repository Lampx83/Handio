import { colorHex } from "./colors";
import { decodeXml, encodeXml, loadZip, paragraphText } from "./docx-read";

/**
 * Sửa tài liệu Word CÓ SẴN theo từng đoạn (số đoạn ¶N lấy từ read_document): thay chữ cả đoạn, xoá, chèn đoạn/bảng, định dạng
 * (đậm, nghiêng, gạch chân, màu, cỡ, phông, nền chữ, căn lề), sửa bảng (ô, thêm/xoá hàng). Giữ nguyên phần còn lại của tệp.
 * Số đoạn/bảng theo tài liệu TRƯỚC lần gọi này.
 */
export interface DocxFormat {
  /** Số đoạn, danh sách số đoạn, "all" (mọi đoạn) hoặc "headings" (mọi tiêu đề). */
  para?: number | number[] | "all" | "headings";
  /** Chỉ định dạng các đoạn có chứa chuỗi này. */
  match?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  /** Màu nền của chữ. */
  shade?: string;
  size?: number;
  font?: string;
  align?: "left" | "center" | "right" | "justify";
}

export interface DocxEditOptions {
  replace_paragraph?: { para: number; text: string }[];
  delete?: number[];
  insert_after?: { para: number; text: string; style?: "normal" | "heading1" | "heading2" | "heading3" | "bullet" | "numbered"; bold?: boolean; italic?: boolean; align?: DocxFormat["align"] }[];
  format?: DocxFormat[];
  table?: { table: number; op: "set_cell" | "add_row" | "delete_row"; row: number; col?: number; text?: string; cells?: string[] }[];
}

export interface DocxEditResult {
  bytes: Uint8Array;
  changes: string[];
}

interface Seg {
  kind: "p" | "tbl";
  start: number;
  end: number;
  /** Đoạn (¶) đầu và cuối mà phần tử này chiếm trong read_document; 0 = không chiếm (đoạn trống). */
  b1: number;
  b2: number;
  tbl: number;
}

const blank = (s: string) => !s.trim();

function segments(body: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  let block = 0;
  let tbl = 0;
  while (i < body.length) {
    const t = Math.min(...[body.indexOf("<w:tbl>", i), body.indexOf("<w:tbl ", i)].filter((x) => x >= 0), Infinity);
    const pm = /<w:p[\s>/]/g;
    pm.lastIndex = i;
    const pRes = pm.exec(body);
    const pStart = pRes ? pRes.index : -1;
    if (t === Infinity && pStart < 0) break;
    if (t !== Infinity && (pStart < 0 || t < pStart)) {
      let depth = 0;
      const re = /<w:tbl[\s>]|<\/w:tbl>/g;
      re.lastIndex = t;
      let m: RegExpExecArray | null;
      let end = body.length;
      while ((m = re.exec(body))) {
        depth += m[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      }
      const hasText = /<w:t[\s>]/.test(body.slice(t, end));
      out.push({ kind: "tbl", start: t, end, b1: hasText ? ++block : 0, b2: hasText ? block : 0, tbl: ++tbl });
      i = end;
    } else {
      const self = /^<w:p\s*\/>/.exec(body.slice(pStart));
      const end = self ? pStart + self[0].length : (() => { const c = body.indexOf("</w:p>", pStart); return c < 0 ? body.length : c + 6; })();
      const text = self ? "" : paragraphText(body.slice(pStart, end));
      const lines = text.split("\n").filter((l) => !blank(l)).length;
      out.push({ kind: "p", start: pStart, end, b1: lines ? block + 1 : 0, b2: lines ? block + lines : 0, tbl: 0 });
      block += lines;
      i = end;
    }
  }
  return out;
}

const pPrOf = (p: string): string => /<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/.exec(p)?.[0] ?? "";
const firstRPr = (p: string): string => /<w:r\b[^>]*>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p)?.[1] ?? "";
const run = (text: string, rPr: string): string => `<w:r>${rPr}<w:t xml:space="preserve">${encodeXml(text)}</w:t></w:r>`;
const para = (text: string, pPr: string, rPr: string): string => `<w:p>${pPr}${text ? run(text, rPr) : ""}</w:p>`;

function withChild(xml: string, tag: "pPr" | "rPr", child: string, key: string): string {
  const open = `<w:${tag}>`;
  const re = new RegExp(`<${key}\\b[^>]*/>|<${key}\\b[^>]*>[\\s\\S]*?</${key}>`);
  if (xml.startsWith(open)) {
    const inner = xml.slice(open.length, -`</w:${tag}>`.length).replace(re, "");
    return `${open}${inner}${child}</w:${tag}>`;
  }
  if (/^<w:pPr\s*\/>$/.test(xml)) return `<w:pPr>${child}</w:pPr>`;
  return `${open}${child}</w:${tag}>`;
}

function addRPr(rpr: string, f: DocxFormat & { colorHex?: string; shadeHex?: string }): string {
  let r = rpr;
  const put = (key: string, child: string) => (r = withChild(r || "<w:rPr></w:rPr>", "rPr", child, key));
  if (f.bold !== undefined) put("w:b", f.bold ? "<w:b/><w:bCs/>" : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (f.italic !== undefined) put("w:i", f.italic ? "<w:i/><w:iCs/>" : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (f.underline !== undefined) put("w:u", f.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>');
  if (f.colorHex) put("w:color", `<w:color w:val="${f.colorHex}"/>`);
  if (f.size !== undefined) {
    const hp = Math.round(Math.min(400, Math.max(4, f.size)) * 2);
    put("w:sz", `<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
  }
  if (f.font) {
    const n = encodeXml(f.font).replace(/"/g, "&quot;");
    put("w:rFonts", `<w:rFonts w:ascii="${n}" w:hAnsi="${n}" w:cs="${n}" w:eastAsia="${n}"/>`);
  }
  if (f.shadeHex) put("w:shd", `<w:shd w:val="clear" w:color="auto" w:fill="${f.shadeHex}"/>`);
  return r;
}

const JC = { left: "left", center: "center", right: "right", justify: "both" } as const;

function formatParagraph(p: string, f: DocxFormat & { colorHex?: string; shadeHex?: string }): string {
  let out = p;
  if (f.align) {
    const jc = `<w:jc w:val="${JC[f.align]}"/>`;
    const cur = pPrOf(out);
    if (cur) {
      const stripped = cur.replace(/<w:jc\b[^>]*\/>/, "");
      const base = /^<w:pPr\s*\/>$/.test(stripped) ? "<w:pPr></w:pPr>" : stripped;
      const next = /<w:rPr>|<w:sectPr|<w:pPrChange/.test(base) ? base.replace(/(<w:rPr>|<w:sectPr|<w:pPrChange)/, `${jc}$1`) : base.replace("</w:pPr>", `${jc}</w:pPr>`);
      out = out.replace(cur, next);
    } else out = out.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr>${jc}</w:pPr>`);
  }
  if (f.bold !== undefined || f.italic !== undefined || f.underline !== undefined || f.colorHex || f.size !== undefined || f.font || f.shadeHex) {
    out = out.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (_m, attrs: string, body: string) => {
      const rpr = /^<w:rPr>[\s\S]*?<\/w:rPr>|^<w:rPr\s*\/>/.exec(body)?.[0] ?? "";
      const rest = rpr ? body.slice(rpr.length) : body;
      return `<w:r${attrs}>${addRPr(/^<w:rPr\s*\/>$/.test(rpr) ? "" : rpr, f)}${rest}</w:r>`;
    });
  }
  return out;
}

const isHeading = (p: string): boolean => /<w:pStyle\s+w:val="(?:Heading|heading|Title|Tiêu)[^"]*"/.test(p) || /<w:outlineLvl\b/.test(p);

/** Số numId của danh sách chấm tròn / đánh số có sẵn trong numbering.xml (null nếu không có). */
function listNumId(numbering: string | null, ordered: boolean): string | null {
  if (!numbering) return null;
  const abs = new Map<string, boolean>();
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const lvl0 = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/.exec(m[2])?.[1] ?? "";
    abs.set(m[1], !/<w:numFmt\s+w:val="(bullet|none)"/.test(lvl0));
  }
  for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId\s+w:val="(\d+)"/g)) if (abs.get(m[2]) === ordered) return m[1];
  return null;
}

function tableXml(lines: string[], accent: string): string {
  const rows = lines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const b = (c: string) => `<w:top w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${c}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${c}"/>`;
  const cell = (t: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(5000 / cols)}" w:type="pct"/>${head ? `<w:shd w:val="clear" w:color="auto" w:fill="${accent}"/>` : ""}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(t, head ? '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' : "")}</w:p></w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${b("BFBFBF")}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join("")}</w:tblGrid>${rows
    .map((r, i) => `<w:tr>${i === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: cols }, (_, c) => cell(r[c] ?? "", i === 0)).join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

export async function editDocx(bytes: Uint8Array, o: DocxEditOptions): Promise<DocxEditResult> {
  const zip = await loadZip(bytes);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("Không tìm thấy nội dung Word (word/document.xml).");
  const xml = await f.async("string");
  const numbering = (await zip.file("word/numbering.xml")?.async("string")) ?? null;
  const bm = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  if (!bm) throw new Error("Cấu trúc tệp Word không như dự kiến (thiếu w:body).");
  const bodyStart = bm.index + "<w:body>".length;
  const body = bm[1];
  const segs = segments(body);
  const maxBlock = Math.max(0, ...segs.map((s) => s.b2));
  const changes: string[] = [];
  const note = (s: string) => changes.length < 40 && changes.push(s);
  const segOf = (n: unknown, what: string): Seg => {
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > maxBlock) throw new Error(`${what}: không có đoạn ${String(n)} (tài liệu có ${maxBlock} đoạn; số ¶ lấy từ read_document).`);
    return segs.find((s) => s.b1 <= (n as number) && (n as number) <= s.b2)!;
  };
  const text = new Map<Seg, string>(segs.map((s) => [s, body.slice(s.start, s.end)]));
  const after = new Map<Seg, string[]>();
  const removed = new Set<Seg>();
  const preview = (s: string) => decodeXml(s).slice(0, 50);

  // 1) thay chữ cả đoạn
  for (const r of o.replace_paragraph ?? []) {
    const seg = segOf(r.para, "replace_paragraph");
    if (seg.kind !== "p") throw new Error(`replace_paragraph: ¶${r.para} là bảng; dùng table (set_cell) để sửa ô.`);
    const old = text.get(seg)!;
    text.set(seg, para(String(r.text ?? ""), pPrOf(old), firstRPr(old)));
    note(`¶${r.para}: “${preview(paragraphText(old))}” → “${preview(String(r.text))}”`);
  }
  // 2) định dạng
  for (const fm of o.format ?? []) {
    const spec = { ...fm, colorHex: fm.color ? colorHex(fm.color) ?? undefined : undefined, shadeHex: fm.shade ? colorHex(fm.shade) ?? undefined : undefined };
    if ((fm.color && !spec.colorHex) || (fm.shade && !spec.shadeHex)) throw new Error(`format: không hiểu màu “${fm.color && !spec.colorHex ? fm.color : fm.shade}”. Dùng #RRGGBB hoặc tên màu thông dụng.`);
    let targets: Seg[];
    if (fm.para === "all" || fm.para === undefined) targets = segs.filter((s) => s.kind === "p" && s.b1 > 0);
    else if (fm.para === "headings") targets = segs.filter((s) => s.kind === "p" && isHeading(text.get(s)!));
    else targets = (Array.isArray(fm.para) ? fm.para : [fm.para]).map((n) => segOf(n, "format"));
    if (fm.match) targets = targets.filter((s) => paragraphText(text.get(s)!).includes(fm.match!));
    let n = 0;
    for (const s of targets) {
      if (s.kind === "tbl") {
        text.set(s, text.get(s)!.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => formatParagraph(p, spec)));
      } else text.set(s, formatParagraph(text.get(s)!, spec));
      n++;
    }
    note(`Đã định dạng ${n} đoạn${fm.match ? ` chứa “${fm.match.slice(0, 30)}”` : ""}`);
  }
  // 3) sửa bảng
  const tables = segs.filter((s) => s.kind === "tbl");
  for (const t of o.table ?? []) {
    const seg = tables[(t.table ?? 0) - 1];
    if (!seg) throw new Error(`table: không có bảng ${t.table} (tài liệu có ${tables.length} bảng).`);
    let tx = text.get(seg)!;
    const rows = [...tx.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    if (!Number.isInteger(t.row) || t.row < 1 || t.row > rows.length) throw new Error(`table ${t.table}: không có hàng ${t.row} (bảng có ${rows.length} hàng).`);
    const rowXml = rows[t.row - 1];
    if (t.op === "set_cell") {
      const cells = [...rowXml.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
      if (!Number.isInteger(t.col) || t.col! < 1 || t.col! > cells.length) throw new Error(`table ${t.table}: không có cột ${t.col} (hàng có ${cells.length} ô).`);
      const cell = cells[t.col! - 1];
      const p0 = /<w:p\b[\s\S]*?<\/w:p>/.exec(cell)?.[0] ?? "<w:p></w:p>";
      const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(cell)?.[0] ?? "";
      const open = /^<w:tc[^>]*>/.exec(cell)![0];
      const newCell = `${open}${tcPr}${para(String(t.text ?? ""), pPrOf(p0), firstRPr(p0))}</w:tc>`;
      tx = tx.replace(rowXml, rowXml.replace(cell, newCell));
      note(`Bảng ${t.table}, hàng ${t.row}, cột ${t.col}: đã sửa ô`);
    } else if (t.op === "add_row") {
      const vals = t.cells ?? [];
      let k = 0;
      const clone = rowXml.replace(/<w:tc[\s>][\s\S]*?<\/w:tc>/g, (cell) => {
        const p0 = /<w:p\b[\s\S]*?<\/w:p>/.exec(cell)?.[0] ?? "<w:p></w:p>";
        const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(cell)?.[0] ?? "";
        const open = /^<w:tc[^>]*>/.exec(cell)![0];
        return `${open}${tcPr}${para(String(vals[k++] ?? ""), pPrOf(p0), firstRPr(p0))}</w:tc>`;
      });
      tx = tx.replace(rowXml, rowXml + clone.replace(/<w:trPr>\s*<w:tblHeader\s*\/>\s*<\/w:trPr>/, ""));
      note(`Bảng ${t.table}: đã thêm hàng sau hàng ${t.row}`);
    } else if (t.op === "delete_row") {
      if (rows.length <= 1) throw new Error(`table ${t.table}: không xoá được hàng cuối cùng (hãy xoá cả bảng bằng delete).`);
      tx = tx.replace(rowXml, "");
      note(`Bảng ${t.table}: đã xoá hàng ${t.row}`);
    } else throw new Error(`table: op không hợp lệ “${String(t.op)}” (set_cell, add_row, delete_row).`);
    text.set(seg, tx);
  }
  // 4) chèn đoạn/bảng
  const accent = "1F3864";
  for (const ins of o.insert_after ?? []) {
    const seg = segOf(ins.para, "insert_after");
    const ref = text.get(seg)!;
    const refP = seg.kind === "p" ? ref : /<w:p\b[\s\S]*?<\/w:p>/.exec(ref)?.[0] ?? "";
    const lines = String(ins.text ?? "").split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|/.test(lines[i])) {
        const tbl: string[] = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) tbl.push(lines[i++]);
        i--;
        out.push(tableXml(tbl, accent), "<w:p/>");
        continue;
      }
      if (blank(lines[i])) continue;
      let pPr = seg.kind === "p" ? pPrOf(ref).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "").replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "") : "";
      const style = ins.style ?? "normal";
      if (/^heading[123]$/.test(style)) pPr = `<w:pPr><w:pStyle w:val="Heading${style.slice(-1)}"/></w:pPr>`;
      else if (style === "bullet" || style === "numbered") {
        const id = listNumId(numbering, style === "numbered");
        if (id) pPr = `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr>`;
      }
      let t = lines[i];
      if ((style === "bullet" || style === "numbered") && !/<w:numPr>/.test(pPr)) t = (style === "bullet" ? "• " : "") + t;
      let rPr = (style === "normal" || style === "bullet" || style === "numbered") && !isHeading(refP) ? firstRPr(refP) : ""; // sau tiêu đề thì không thừa hưởng màu/cỡ tiêu đề
      rPr = addRPr(rPr, { bold: ins.bold, italic: ins.italic });
      let p = para(t, pPr, rPr);
      if (ins.align) p = formatParagraph(p, { align: ins.align });
      out.push(p);
    }
    after.set(seg, [...(after.get(seg) ?? []), ...out]);
    note(`Đã chèn ${out.filter((x) => x.startsWith("<w:p>")).length || out.length} phần sau ¶${ins.para}`);
  }
  // 5) xoá
  for (const n of o.delete ?? []) {
    const seg = segOf(n, "delete");
    removed.add(seg);
    note(`Đã xoá ¶${n}${seg.kind === "tbl" ? " (bảng)" : ""}: “${preview(paragraphText(body.slice(seg.start, seg.end)))}”`);
  }
  if (removed.size && removed.size >= segs.filter((s) => s.b1 > 0).length) throw new Error("Không thể xoá hết nội dung tài liệu.");

  // dựng lại body: giữ nguyên mọi thứ nằm giữa các phần tử (sectPr, bookmark…)
  let out = "";
  let cur = 0;
  for (const s of segs) {
    out += body.slice(cur, s.start);
    if (!removed.has(s)) out += text.get(s)!;
    out += (after.get(s) ?? []).join("");
    cur = s.end;
  }
  out += body.slice(cur);
  if (out === body) throw new Error("Không có thay đổi nào được áp dụng.");
  zip.file("word/document.xml", xml.slice(0, bodyStart) + out + xml.slice(bodyStart + body.length));
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), changes };
}
