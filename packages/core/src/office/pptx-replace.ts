import { decodeXml, encodeXml } from "./docx-read";

/**
 * Thay chữ trong khung chữ (<p:txBody>/<a:txBody>) của PowerPoint ở mức KHUNG, không phải từng đoạn:
 * chuỗi `find` được phép trải qua nhiều đoạn của cùng một khung, kèm xuống dòng; lần so khớp "dễ tính"
 * bỏ qua hoa/thường, dấu, khoảng trắng, dấu câu, dấu gạch đầu dòng/số thứ tự và ngoặc kép cong/thẳng.
 */
export const TX_RE = /<(p:txBody|a:txBody)\b[^>]*>[\s\S]*?<\/\1>/g;
export const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
const TOK_RE = /<a:t(?:\s[^>]*)?>[^<]*<\/a:t>|<a:t\s*\/>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g;

interface Tok {
  kind: "t" | "br";
  index: number;
  len: number;
  attrs: string;
  text: string;
  gone?: boolean;
}

function tokens(p: string): Tok[] {
  const out: Tok[] = [];
  for (const m of p.matchAll(TOK_RE)) {
    if (m[0].startsWith("<a:br")) out.push({ kind: "br", index: m.index!, len: m[0].length, attrs: "", text: "\n" });
    else {
      const mm = /^<a:t((?:\s[^>]*)?)>([^<]*)<\/a:t>$/.exec(m[0]);
      out.push({ kind: "t", index: m.index!, len: m[0].length, attrs: mm?.[1] ?? "", text: decodeXml(mm?.[2] ?? "") });
    }
  }
  return out;
}

/** Chữ của một đoạn: các <a:t> nối nhau, <a:br/> là "\n". */
export const paraText = (p: string): string => tokens(p).map((t) => t.text).join("");

/** Chữ của cả khung: các đoạn cách nhau "\n". */
export const txText = (tx: string): string => [...tx.matchAll(P_RE)].map((m) => paraText(m[0])).join("\n");

/** Thay phạm vi [from,to) (toạ độ trong chữ của đoạn) bằng `insert`; giữ định dạng của run chứa chỗ bắt đầu. */
function setRange(p: string, from: number, to: number, insert: string): string {
  const toks = tokens(p);
  let pos = 0;
  let placed = false;
  for (const t of toks) {
    const s = pos;
    const e = pos + t.text.length;
    pos = e;
    if (e <= from || s >= to) continue;
    if (t.kind === "br") {
      t.gone = true;
      continue;
    }
    const a = Math.max(from, s) - s;
    const b = Math.min(to, e) - s;
    t.text = t.text.slice(0, a) + (placed ? "" : insert) + t.text.slice(b);
    placed = true;
  }
  if (!placed && insert) {
    // phạm vi chỉ phủ chỗ xuống dòng hoặc nằm cuối đoạn: nối vào run chữ gần nhất phía trước
    const target = [...toks].reverse().find((t) => t.kind === "t");
    if (target) target.text += insert;
    else return p.replace(/<\/a:p>$/, `<a:r><a:t>${encodeXml(insert)}</a:t></a:r></a:p>`);
  }
  let out = "";
  let last = 0;
  for (const t of toks) {
    out += p.slice(last, t.index);
    if (t.kind === "t") out += `<a:t${t.attrs}>${encodeXml(t.text)}</a:t>`;
    else if (!t.gone) out += p.slice(t.index, t.index + t.len);
    last = t.index + t.len;
  }
  return out + p.slice(last);
}

/** Đoạn mới giống `p` (cùng kiểu đoạn/run) nhưng chỉ chứa `text`. */
export function cloneWithText(p: string, text: string): string {
  const open = /^<a:p\b[^>]*>/.exec(p)?.[0] ?? "<a:p>";
  const inner = p.slice(open.length, p.length - "</a:p>".length);
  const pPr = /^\s*<a:pPr\b[^>]*\/>|^\s*<a:pPr\b[\s\S]*?<\/a:pPr>/.exec(inner)?.[0] ?? "";
  const rPr = /<a:r>\s*(<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>)/.exec(inner)?.[1] ?? "";
  const end = /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/.exec(inner)?.[0] ?? "";
  return `${open}${pPr}<a:r>${rPr}<a:t>${encodeXml(text)}</a:t></a:r>${end}</a:p>`;
}

const MARK_RE = /^\s*(?:[-*+•▪·–—]|\d+[.)])\s+/;
/** Bỏ dấu đầu dòng/số thứ tự ở đầu mỗi dòng. */
export const stripMarkers = (t: string): string => t.split("\n").map((l) => l.replace(MARK_RE, "")).join("\n");

/** Gấp chữ để so khớp dễ tính; `map[i]` = vị trí trong chuỗi gốc của ký tự thứ i của kết quả. */
function loose(text: string): { s: string; map: number[] } {
  let s = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        s += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    const digitBetween = /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "");
    if (/[\p{P}\p{S}]/u.test(ch) && !digitBetween) continue; // dấu câu, ngoặc kép, ký hiệu: bỏ qua
    const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
    for (const c of f) {
      s += c;
      map.push(i);
    }
    lastSpace = false;
  }
  return { s, map };
}

function findRange(flat: string, find: string, mode: "exact" | "loose"): { s: number; e: number } | null {
  if (mode === "exact") {
    const needle = find.replace(/^\n+|\n+$/g, "");
    if (!needle) return null;
    const at = flat.indexOf(needle);
    return at < 0 ? null : { s: at, e: at + needle.length };
  }
  const nd = loose(stripMarkers(find)).s.trim();
  if (nd.length < 2) return null;
  const hay = loose(flat);
  let from = 0;
  for (;;) {
    const at = hay.s.indexOf(nd, from);
    if (at < 0) return null;
    const okL = at === 0 || hay.s[at - 1] === " ";
    const okR = at + nd.length === hay.s.length || hay.s[at + nd.length] === " ";
    if (okL && okR) return { s: hay.map[at], e: hay.map[at + nd.length - 1] + 1 };
    from = at + 1;
  }
}

export interface TxRep {
  find: string;
  replace: string;
}

/**
 * Áp các thay thế lên một khung chữ. `counts[i]` được cộng số chỗ đã thay của `reps[i]`.
 * Trả về khung mới và chữ trước/sau (để ghi nhận thay đổi).
 */
export function replaceInTxBody(tx: string, reps: TxRep[], counts: number[], mode: "exact" | "loose"): { xml: string; before: string; after: string } {
  const ms = [...tx.matchAll(P_RE)];
  if (!ms.length) return { xml: tx, before: "", after: "" };
  let list = ms.map((m) => m[0]);
  const before = list.map(paraText).join("\n");
  let changed = false;
  reps.forEach((rep, k) => {
    if (!rep.find) return;
    const lines = (rep.replace.includes("\n") || MARK_RE.test(rep.replace) ? stripMarkers(rep.replace) : rep.replace).split("\n");
    const kept = lines.length > 1 ? lines.filter((l) => l.trim()) : lines;
    const outLines = kept.length ? kept : [""];
    for (let guard = 0; guard < 100; guard++) {
      const texts = list.map(paraText);
      const starts: number[] = [];
      let pos = 0;
      for (const t of texts) {
        starts.push(pos);
        pos += t.length + 1;
      }
      const flat = texts.join("\n");
      const r = findRange(flat, rep.find, mode);
      if (!r) return;
      const locate = (at: number) => {
        let i = 0;
        for (let j = 0; j < starts.length; j++) if (starts[j] <= at) i = j;
        return i;
      };
      const ps = locate(r.s);
      const pe = locate(Math.max(r.s, r.e - 1));
      const sOff = Math.min(r.s - starts[ps], texts[ps].length);
      const eOff = Math.min(Math.max(0, r.e - starts[pe]), texts[pe].length);
      const suffix = texts[pe].slice(eOff);
      const fullParas = sOff === 0 && eOff === texts[pe].length;
      if (outLines.length === 1 && outLines[0] === "" && fullParas && list.length > pe - ps + 1) {
        list.splice(ps, pe - ps + 1); // xoá nguyên các đoạn
      } else if (ps === pe && outLines.length === 1) {
        list[ps] = setRange(list[ps], sOff, eOff, outLines[0]);
      } else {
        const head = setRange(list[ps], sOff, texts[ps].length, outLines.length === 1 ? outLines[0] + suffix : outLines[0]);
        const extra: string[] = [];
        for (let li = 1; li < outLines.length; li++) extra.push(cloneWithText(list[ps], outLines[li] + (li === outLines.length - 1 ? suffix : "")));
        list.splice(ps, pe - ps + 1, head, ...extra);
      }
      counts[k]++;
      changed = true;
      if (mode === "loose" || rep.replace.includes(rep.find)) return; // một chỗ mỗi khung khi so khớp mờ; tránh lặp vô hạn
    }
  });
  if (!changed) return { xml: tx, before, after: before };
  // ghép lại: thay khối đoạn bằng danh sách mới, giữ phần ngoài khối
  const first = ms[0].index!;
  const end = ms[ms.length - 1].index! + ms[ms.length - 1][0].length;
  return { xml: tx.slice(0, first) + list.join("") + tx.slice(end), before, after: list.map(paraText).join("\n") };
}
