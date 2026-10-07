import type JSZipType from "jszip";

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxEntryBytes: 150 * 1024 * 1024, maxTotalBytes: 400 * 1024 * 1024 };

/** Mở tệp zip (Word/Excel/PowerPoint) và TỪ CHỐI tệp giải nén ra quá lớn (zip bomb) trước khi đọc nội dung. */
export async function loadZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<JSZipType> {
  const mod = await import("jszip");
  const JSZip = (mod as unknown as { default: typeof JSZipType }).default ?? (mod as unknown as typeof JSZipType);
  let zip: JSZipType;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("File không phải định dạng Office hợp lệ (có thể bị hỏng hoặc có mật khẩu).");
  }
  let total = 0;
  let n = 0;
  for (const f of Object.values(zip.files)) {
    n++;
    const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    total += size;
    if (size > limits.maxEntryBytes || total > limits.maxTotalBytes || n > limits.maxEntries)
      throw new Error("Tệp Office giải nén ra quá lớn hoặc có quá nhiều thành phần (nghi ngờ tệp độc hại), đã từ chối mở.");
  }
  return zip;
}

export const decodeXml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
export const encodeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Văn bản của một đoạn <w:p>: chỉ lấy <w:t>, <w:tab/>, <w:br/>. */
export function paragraphText(p: string): string {
  let out = "";
  for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:noBreakHyphen\/>/g)) out += m[0].startsWith("<w:t") ? decodeXml(m[1]) : m[0].startsWith("<w:tab") ? "\t" : m[0].startsWith("<w:br") ? "\n" : "-";
  return out;
}

/** Tách các phần tử cấp cao <w:p> và <w:tbl> (bảng lồng nhau được tính đúng độ sâu). */
function topLevel(body: string): { kind: "p" | "tbl"; xml: string }[] {
  const out: { kind: "p" | "tbl"; xml: string }[] = [];
  let i = 0;
  while (i < body.length) {
    const t = body.indexOf("<w:tbl>", i);
    const t2 = body.indexOf("<w:tbl ", i);
    const tblStart = [t, t2].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? -1;
    const pm = /<w:p[\s>]/g;
    pm.lastIndex = i;
    const pRes = pm.exec(body);
    const pStart = pRes ? pRes.index : -1;
    if (tblStart < 0 && pStart < 0) break;
    if (tblStart >= 0 && (pStart < 0 || tblStart < pStart)) {
      let depth = 0;
      const re = /<w:tbl[\s>]|<\/w:tbl>/g;
      re.lastIndex = tblStart;
      let m: RegExpExecArray | null;
      let end = body.length;
      while ((m = re.exec(body))) {
        depth += m[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      }
      out.push({ kind: "tbl", xml: body.slice(tblStart, end) });
      i = end;
    } else {
      const close = body.indexOf("</w:p>", pStart);
      const selfClose = /^<w:p\s*\/>/.exec(body.slice(pStart));
      if (selfClose) {
        i = pStart + selfClose[0].length;
        out.push({ kind: "p", xml: selfClose[0] });
      } else {
        const end = close < 0 ? body.length : close + 6;
        out.push({ kind: "p", xml: body.slice(pStart, end) });
        i = end;
      }
    }
  }
  return out;
}

interface NumInfo {
  ordered: Map<string, boolean>; // `${numId}:${ilvl}` -> có đánh số?
}
function parseNumbering(xml: string | null): NumInfo {
  const ordered = new Map<string, boolean>();
  if (!xml) return { ordered };
  const abs = new Map<string, Map<string, boolean>>();
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const lv = new Map<string, boolean>();
    for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) lv.set(l[1], !/<w:numFmt\s+w:val="(bullet|none)"/.test(l[2]));
    abs.set(m[1], lv);
  }
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId\s+w:val="(\d+)"/g)) for (const [lvl, isOrd] of abs.get(m[2]) ?? []) ordered.set(`${m[1]}:${lvl}`, isOrd);
  return { ordered };
}

const cellText = (tc: string): string =>
  topLevel(tc.replace(/^<w:tc[^>]*>/, "").replace(/<\/w:tc>$/, ""))
    .map((e) => (e.kind === "p" ? paragraphText(e.xml) : ""))
    .filter(Boolean)
    .join(" / ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();

function tableToMarkdown(tbl: string): string {
  const rows = [...tbl.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((c) => cellText(c[0])));
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  const [head, ...rest] = rows.map(pad);
  return ["| " + head.join(" | ") + " |", "|" + " --- |".repeat(cols), ...rest.map((r) => "| " + r.join(" | ") + " |")].join("\n");
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const zip = await loadZip(bytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Không tìm thấy nội dung Word (word/document.xml).");
  const xml = await docFile.async("string");
  const num = parseNumbering((await zip.file("word/numbering.xml")?.async("string")) ?? null);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: string[] = [];
  for (const el of topLevel(body)) {
    if (el.kind === "tbl") {
      const t = tableToMarkdown(el.xml);
      if (t) out.push("", t, "");
      continue;
    }
    const text = paragraphText(el.xml).replace(/\s+$/, "");
    if (!text.trim()) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(el.xml)?.[1] ?? "";
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(el.xml)?.[1];
    const hm = /^(?:Heading|heading|Tiêu\s*đề)\s*(\d)$/.exec(style);
    if (/^Title$/i.test(style)) out.push("", "# " + text, "");
    else if (hm || outline !== undefined) out.push("", "#".repeat(Math.min(6, (hm ? +hm[1] : +outline! + 1) + (/^Title$/i.test(style) ? 0 : 0))) + " " + text, "");
    else if (/<w:numPr>/.test(el.xml)) {
      const ilvl = /<w:ilvl\s+w:val="(\d+)"/.exec(el.xml)?.[1] ?? "0";
      const numId = /<w:numId\s+w:val="(\d+)"/.exec(el.xml)?.[1] ?? "";
      const ord = num.ordered.get(`${numId}:${ilvl}`) ?? false;
      out.push("  ".repeat(+ilvl) + (ord ? "1. " : "- ") + text);
    } else if (/<w:jc\s+w:val="center"/.test(el.xml)) out.push(`<center>${text}</center>`);
    else out.push(text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Tên các file Word có thể chứa chữ cần thay. */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export interface Replacement {
  find: string;
  replace: string;
}
export interface ReplaceResult {
  bytes: Uint8Array;
  counts: number[];
}

/** Thay chữ trong từng đoạn, kể cả khi chữ bị tách qua nhiều run định dạng; run đầu tiên của chỗ khớp giữ định dạng. */
export async function docxReplace(bytes: Uint8Array, reps: Replacement[]): Promise<ReplaceResult> {
  const zip = await loadZip(bytes);
  const counts = reps.map(() => 0);
  for (const name of Object.keys(zip.files).filter((n) => TEXT_PARTS.test(n))) {
    const xml = await zip.file(name)!.async("string");
    const next = xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (p) => replaceInParagraph(p, reps, counts));
    if (next !== xml) zip.file(name, next);
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), counts };
}

function replaceInParagraph(p: string, reps: Replacement[], counts: number[]): string {
  const nodes = [...p.matchAll(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => ({ index: m.index!, len: m[0].length, attrs: m[1] ?? "", text: decodeXml(m[2]) }));
  if (!nodes.length) return p;
  let changed = false;
  reps.forEach((rep, ri) => {
    if (!rep.find) return;
    for (;;) {
      const full = nodes.map((n) => n.text).join("");
      const at = full.indexOf(rep.find);
      if (at < 0) return;
      counts[ri]++;
      changed = true;
      let pos = 0;
      let first = true;
      for (const n of nodes) {
        const s = pos;
        const e = pos + n.text.length;
        pos = e;
        if (e <= at || s >= at + rep.find.length) continue;
        const from = Math.max(at, s) - s;
        const to = Math.min(at + rep.find.length, e) - s;
        n.text = n.text.slice(0, from) + (first ? rep.replace : "") + n.text.slice(to);
        first = false;
      }
      if (rep.replace.includes(rep.find)) return; // tránh lặp vô hạn khi chuỗi thay chứa chuỗi tìm
    }
  });
  if (!changed) return p;
  let out = "";
  let last = 0;
  for (const n of nodes) {
    out += p.slice(last, n.index) + `<w:t${/xml:space=/.test(n.attrs) ? n.attrs : n.attrs + ' xml:space="preserve"'}>${encodeXml(n.text)}</w:t>`;
    last = n.index + n.len;
  }
  return out + p.slice(last);
}
