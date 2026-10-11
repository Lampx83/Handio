/**
 * Sửa Word dưới dạng ĐỀ XUẤT (Track Changes thật: <w:del>/<w:ins>) để người dùng bấm Chấp nhận/Từ chối trong Word.
 * Chỉ tách được các run đơn giản (một <w:t>); chỗ khớp rơi vào run phức tạp (tab, ngắt dòng, trường…) được báo là "bỏ qua".
 */
import { decodeXml, loadZip } from "./docx-read";
import { xmlText } from "./xmlfill";

export interface SuggestRule {
  find: string;
  replace: string;
}
export interface SuggestResult {
  bytes: Uint8Array;
  /** Số chỗ đã đánh dấu theo từng quy tắc. */
  counts: number[];
  /** Số chỗ khớp nhưng không đánh dấu được (run phức tạp). */
  skipped: number[];
  /** Danh sách trước → sau, kèm một đoạn ngữ cảnh. */
  changes: { find: string; replace: string; context: string }[];
}

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const SIMPLE = /^(<w:r(?:\s[^>]*)?>)(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t(?:\s[^>]*)?>([^<]*)<\/w:t><\/w:r>$/;

interface Seg {
  xml: string;
  start: number;
  /** null: không phải run chữ đơn giản hoặc không có chữ. */
  open?: string;
  rpr?: string;
  text: string;
  simple: boolean;
}

export async function docxSuggest(bytes: Uint8Array, rules: SuggestRule[], author = "Handio", date = new Date().toISOString().replace(/\.\d+Z$/, "Z")): Promise<SuggestResult> {
  const zip = await loadZip(bytes);
  const counts = rules.map(() => 0);
  const skipped = rules.map(() => 0);
  const changes: SuggestResult["changes"] = [];
  let id = 90000;
  const attrs = () => `w:id="${id++}" w:author="${xmlText(author)}" w:date="${date}"`;
  for (const name of Object.keys(zip.files).filter((n) => PARTS.test(n))) {
    const xml = await zip.file(name)!.async("string");
    const next = xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (p) => {
      // chia đoạn thành các run
      const segs: Seg[] = [];
      let pos = 0;
      for (const m of p.matchAll(RUN)) {
        const sm = SIMPLE.exec(m[0]);
        const anyText = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => decodeXml(x[1])).join("");
        segs.push({ xml: m[0], start: m.index!, open: sm?.[1], rpr: sm?.[2], text: sm ? decodeXml(sm[3]) : anyText, simple: !!sm });
        pos = m.index! + m[0].length;
      }
      void pos;
      const full = segs.map((s) => s.text).join("");
      if (!full) return p;
      // tìm các chỗ khớp trên văn bản gốc (không chồng lấn; quy tắc đứng trước ưu tiên)
      const matches: { start: number; end: number; rule: number }[] = [];
      rules.forEach((r, ri) => {
        if (!r.find) return;
        for (let at = full.indexOf(r.find); at >= 0; at = full.indexOf(r.find, at + r.find.length)) if (!matches.some((m) => m.end > at && m.start < at + r.find.length)) matches.push({ start: at, end: at + r.find.length, rule: ri });
      });
      if (!matches.length) return p;
      matches.sort((a, b) => a.start - b.start);
      // vị trí ký tự của từng run
      let off = 0;
      const span = segs.map((s) => ((off += s.text.length), { from: off - s.text.length, to: off }));
      const applied: typeof matches = [];
      for (const m of matches) {
        const touched = segs.filter((_s, i) => span[i].to > m.start && span[i].from < m.end);
        if (!touched.length || touched.some((s) => !s.simple)) skipped[m.rule]++;
        else applied.push(m);
      }
      if (!applied.length) return p;
      // dựng lại từng run bị đụng tới
      const replaced = new Map<number, string>();
      segs.forEach((s, i) => {
        const ms = applied.filter((m) => span[i].to > m.start && span[i].from < m.end);
        if (!ms.length) return;
        let out = "";
        let cur = 0; // vị trí trong s.text
        const piece = (t: string, tag: "t" | "delText") => (t ? `<w:r>${s.rpr ?? ""}<w:${tag} xml:space="preserve">${xmlText(t)}</w:${tag}></w:r>` : "");
        for (const m of ms) {
          const a = Math.max(m.start, span[i].from) - span[i].from;
          const b = Math.min(m.end, span[i].to) - span[i].from;
          out += piece(s.text.slice(cur, a), "t");
          out += `<w:del ${attrs()}>${piece(s.text.slice(a, b), "delText")}</w:del>`;
          if (m.start >= span[i].from && rules[m.rule].replace) out += `<w:ins ${attrs()}>${piece(rules[m.rule].replace, "t")}</w:ins>`; // chữ mới đặt ngay sau chữ bị xoá, ở run chứa điểm đầu
          cur = b;
        }
        out += piece(s.text.slice(cur), "t");
        replaced.set(i, out);
      });
      for (const m of applied) {
        counts[m.rule]++;
        const ctxFrom = Math.max(0, m.start - 25);
        changes.push({ find: rules[m.rule].find, replace: rules[m.rule].replace, context: (ctxFrom > 0 ? "…" : "") + full.slice(ctxFrom, m.start) + "「" + full.slice(m.start, m.end) + "」" + full.slice(m.end, m.end + 25) + (m.end + 25 < full.length ? "…" : "") });
      }
      let out = "";
      let last = 0;
      segs.forEach((s, i) => {
        out += p.slice(last, s.start) + (replaced.get(i) ?? s.xml);
        last = s.start + s.xml.length;
      });
      return out + p.slice(last);
    });
    if (next !== xml) zip.file(name, next);
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), counts, skipped, changes };
}
