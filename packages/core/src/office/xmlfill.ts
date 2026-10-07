/**
 * Viết lại chữ trong tệp Word/PowerPoint theo vị trí ký tự, giữ định dạng của run đầu tiên và an toàn XML.
 * Dùng chung cho trộn thư (thay {{cột}}) và che dữ liệu cá nhân.
 */
import { decodeXml, encodeXml, loadZip } from "./docx-read";

export interface Edit {
  start: number;
  end: number;
  text: string;
}
export interface Dialect {
  /** Tên các phần trong zip có chữ. */
  parts: RegExp;
  para: RegExp;
  t: RegExp;
}

export const DOCX: Dialect = {
  parts: /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/,
  para: /<w:p[\s>][\s\S]*?<\/w:p>/g,
  t: /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g,
};
export const PPTX: Dialect = {
  parts: /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/,
  para: /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g,
  t: /<a:t(\s[^>]*)?>([^<]*)<\/a:t>/g,
};

/** Bỏ ký tự điều khiển không hợp lệ trong XML 1.0 rồi mã hoá &, <, >. */
// eslint-disable-next-line no-control-regex
export const xmlText = (s: string): string => encodeXml(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ""));

export function rewriteParagraph(p: string, d: Dialect, fn: (full: string) => Edit[], tagName: "w:t" | "a:t"): { xml: string; n: number } {
  const re = new RegExp(d.t.source, "g");
  const nodes = [...p.matchAll(re)].map((m) => ({ index: m.index!, len: m[0].length, attrs: m[1] ?? "", text: decodeXml(m[2]) }));
  if (!nodes.length) return { xml: p, n: 0 };
  const full = nodes.map((n) => n.text).join("");
  const edits = fn(full).filter((e) => e.start >= 0 && e.end > e.start && e.end <= full.length).sort((a, b) => b.start - a.start);
  if (!edits.length) return { xml: p, n: 0 };
  for (const e of edits) {
    let pos = 0;
    let first = true;
    for (const n of nodes) {
      const s = pos;
      const end = pos + n.text.length;
      pos = end;
      if (end <= e.start || s >= e.end) continue; // chỉ các khoảng không rỗng
      const from = Math.max(e.start, s) - s;
      const to = Math.min(e.end, end) - s;
      n.text = n.text.slice(0, from) + (first ? e.text : "") + n.text.slice(to);
      first = false;
    }
  }
  let out = "";
  let last = 0;
  for (const n of nodes) {
    out += p.slice(last, n.index) + `<${tagName}${tagName === "a:t" || /xml:space=/.test(n.attrs) ? n.attrs : n.attrs + ' xml:space="preserve"'}>${xmlText(n.text)}</${tagName}>`;
    last = n.index + n.len;
  }
  return { xml: out + p.slice(last), n: edits.length };
}

/** Áp `fn` lên chữ của từng đoạn trong mọi phần có chữ của tệp; trả về tệp mới và tổng số chỗ sửa. */
export async function rewriteZipText(bytes: Uint8Array, d: Dialect, fn: (full: string) => Edit[]): Promise<{ bytes: Uint8Array; edits: number }> {
  const zip = await loadZip(bytes);
  const tag = d === PPTX ? "a:t" : "w:t";
  let total = 0;
  for (const name of Object.keys(zip.files).filter((n) => d.parts.test(n))) {
    const xml = await zip.file(name)!.async("string");
    const next = xml.replace(new RegExp(d.para.source, "g"), (p) => {
      const r = rewriteParagraph(p, d, fn, tag);
      total += r.n;
      return r.xml;
    });
    if (next !== xml) zip.file(name, next);
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), edits: total };
}
