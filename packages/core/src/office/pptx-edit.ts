import { colorHex } from "./colors";
import { decodeXml, encodeXml, loadZip } from "./docx-read";

/**
 * Sửa một tệp PowerPoint CÓ SẴN mà giữ nguyên bố cục/định dạng của nó (khác create_pptx là dựng lại cả bài):
 * thay chữ (kể cả khi chữ bị chia thành nhiều đoạn định dạng), đổi hoa/thường tiêu đề hoặc toàn bộ chữ, xoá slide.
 */
export interface PptxEditOptions {
  replacements?: { find: string; replace: string; slide?: number }[];
  transform?: { case: "upper" | "lower" | "capitalize"; target?: "titles" | "all"; slides?: number[] };
  delete_slides?: number[];
  /** Nhân đôi slide (cùng bố cục, giữ định dạng); bản sao nằm ngay sau slide gốc, rồi sửa chữ của nó bằng lần gọi sau. Số theo bài TRƯỚC khi sửa. */
  duplicate_slides?: number[];
  /** Chuyển slide `slide` tới vị trí `to` (số theo bài trước khi sửa). */
  move_slide?: { slide: number; to: number };
  /** Định dạng chữ/hình: màu chữ, cỡ, đậm/nghiêng/gạch chân, phông, căn lề, màu nền hình. `target`: tiêu đề (mặc định), toàn bộ chữ, hoặc đoạn chứa `match`. */
  style?: PptxStyle[];
  /** Màu nền slide (mọi slide nếu bỏ trống `slides`). */
  background?: { slides?: number[]; color: string };
  /** Đặt lại tiêu đề của slide (số theo bài trước khi sửa): không cần biết chữ cũ. */
  set_title?: { slide: number; text: string }[];
}

export interface PptxStyle {
  slides?: number[];
  target?: "titles" | "all" | "match";
  match?: string;
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font?: string;
  align?: "left" | "center" | "right" | "justify";
  /** Màu nền của hình chứa chữ (hộp tiêu đề, thẻ…). */
  fill?: string;
}

export interface PptxEditResult {
  bytes: Uint8Array;
  /** Số slide sau khi sửa. */
  slides: number;
  /** Số chỗ đã thay của từng phần tử `replacements` (cùng thứ tự). */
  counts: number[];
  /** Mô tả từng thay đổi ("Slide 2: “a” → “b”"), tối đa 40. */
  changes: string[];
  deleted: number[];
  /** Với mỗi `replacements` không tìm thấy: vài đoạn chữ gần giống nhất trong bài (để lần sau chép đúng). */
  suggestions: Record<number, string[]>;
  /** Thứ tự cuối cùng: mỗi phần tử là số slide GỐC (hoặc "bản sao của N"). */
  layout: string[];
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const num = (n: string) => +/(\d+)\.xml$/.exec(n)![1];

/** Tên tệp slide theo ĐÚNG thứ tự trình chiếu (presentation.xml), không phải thứ tự tên tệp. */
export async function slideOrder(zip: Awaited<ReturnType<typeof loadZip>>): Promise<string[]> {
  const byName = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  try {
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    const target = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id && t) target.set(id, "ppt/" + t.replace(/^\/?(ppt\/)?/, ""));
    }
    const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => target.get(m[1])).filter((x): x is string => !!x && !!zip.file(x));
    return order.length === byName.length ? order : byName;
  } catch {
    return byName;
  }
}

const caseOf = (mode: "upper" | "lower" | "capitalize") => (t: string): string =>
  mode === "upper" ? t.toLocaleUpperCase("vi") : mode === "lower" ? t.toLocaleLowerCase("vi") : t.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w.charAt(0).toLocaleUpperCase("vi") + w.slice(1).toLocaleLowerCase("vi"));

const T_RE = /<a:t(\s[^>]*)?>([^<]*)<\/a:t>/g;
const P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;

/** Thay chữ trong một đoạn <a:p>; giữ định dạng của run chứa chỗ bắt đầu. Trả đoạn mới và số chỗ thay từng yêu cầu. */
function replaceInParagraph(p: string, reps: { find: string; replace: string }[], counts: number[]): { xml: string; before: string; after: string } {
  const nodes: { index: number; len: number; attrs: string; text: string }[] = [];
  for (const m of p.matchAll(T_RE)) nodes.push({ index: m.index!, len: m[0].length, attrs: m[1] ?? "", text: decodeXml(m[2]) });
  if (!nodes.length) return { xml: p, before: "", after: "" };
  const before = nodes.map((n) => n.text).join("");
  let changed = false;
  reps.forEach((rep, k) => {
    if (!rep.find) return;
    for (let guard = 0; guard < 100; guard++) {
      const full = nodes.map((n) => n.text).join("");
      const at = full.indexOf(rep.find);
      if (at < 0) return;
      counts[k]++;
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
      if (rep.replace.includes(rep.find)) return; // tránh lặp vô hạn
    }
  });
  if (!changed) return { xml: p, before, after: before };
  let out = "";
  let last = 0;
  for (const n of nodes) {
    out += p.slice(last, n.index) + `<a:t${n.attrs}>${encodeXml(n.text)}</a:t>`;
    last = n.index + n.len;
  }
  return { xml: out + p.slice(last), before, after: nodes.map((n) => n.text).join("") };
}

/** Các hình (<p:sp>) là tiêu đề: có <p:ph type="title|ctrTitle">; không có thì lấy hình chữ có cỡ chữ lớn nhất. */
function titleShapeIndexes(shapes: string[]): Set<number> {
  const ph = shapes.map((s, i) => (/<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(s) ? i : -1)).filter((i) => i >= 0);
  if (ph.length) return new Set(ph);
  let best = -1;
  let size = -1;
  shapes.forEach((s, i) => {
    if (!/<a:t>[^<]*\S[^<]*<\/a:t>|<a:t\s[^>]*>[^<]*\S/.test(s)) return;
    const sz = Math.max(0, ...[...s.matchAll(/\bsz="(\d+)"/g)].map((m) => +m[1]));
    if (sz > size) {
      size = sz;
      best = i;
    }
  });
  return best >= 0 ? new Set([best]) : new Set();
}


// ---------------------------------------------------------------- định dạng

const setAttr = (attrs: string, name: string, value: string | null): string => {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const base = attrs.replace(re, "");
  return value === null ? base : `${base} ${name}="${value}"`;
};

/** Áp định dạng lên một <a:rPr> (hoặc tạo mới). Giữ đúng thứ tự phần tử con theo chuẩn OOXML. */
function styleRPr(rpr: string | null, st: { color?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; font?: string }): string {
  const m = rpr ? /^<a:rPr\b([^>]*?)(?:\/>|>([\s\S]*)<\/a:rPr>)$/.exec(rpr) : null;
  let attrs = m ? m[1] : ' lang="vi-VN"';
  let inner = m?.[2] ?? "";
  if (st.size !== undefined) attrs = setAttr(attrs, "sz", String(Math.round(Math.min(400, Math.max(4, st.size)) * 100)));
  if (st.bold !== undefined) attrs = setAttr(attrs, "b", st.bold ? "1" : "0");
  if (st.italic !== undefined) attrs = setAttr(attrs, "i", st.italic ? "1" : "0");
  if (st.underline !== undefined) attrs = setAttr(attrs, "u", st.underline ? "sng" : "none");
  if (st.color || st.font) {
    const ln = /<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/.exec(inner)?.[0] ?? "";
    let rest = ln ? inner.replace(ln, "") : inner;
    let fill = /<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>|<a:gradFill\b[\s\S]*?<\/a:gradFill>/.exec(rest)?.[0] ?? "";
    if (st.color) {
      if (fill) rest = rest.replace(fill, "");
      fill = `<a:solidFill><a:srgbClr val="${st.color}"/></a:solidFill>`;
    } else if (fill) rest = rest.replace(fill, "");
    if (st.font) {
      rest = rest.replace(/<a:latin\b[^>]*\/>/, "");
      const tag = `<a:latin typeface="${encodeXml(st.font).replace(/"/g, "&quot;")}"/>`;
      const at = rest.search(/<a:(?:ea|cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/);
      rest = at >= 0 ? rest.slice(0, at) + tag + rest.slice(at) : rest + tag;
    }
    const lead = rest.search(/<a:(?:effectLst|effectDag|highlight|uLnTx|uLn|uFillTx|uFill|latin|ea|cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/);
    inner = ln + (lead >= 0 ? rest.slice(0, lead) + fill + rest.slice(lead) : rest + fill);
  }
  return inner ? `<a:rPr${attrs}>${inner}</a:rPr>` : `<a:rPr${attrs}/>`;
}

function stylePara(p: string, st: PptxStyle & { color?: string }): string {
  let out = p;
  if (st.align) {
    const algn = { left: "l", center: "ctr", right: "r", justify: "just" }[st.align];
    if (/^<a:p\b[^>]*>\s*<a:pPr\b/.test(out)) out = out.replace(/<a:pPr\b([^>]*?)(\/?)>/, (_m, a: string, sl: string) => `<a:pPr${setAttr(a, "algn", algn)}${sl}>`);
    else out = out.replace(/^(<a:p\b[^>]*>)/, `$1<a:pPr algn="${algn}"/>`);
  }
  if (st.color || st.size !== undefined || st.bold !== undefined || st.italic !== undefined || st.underline !== undefined || st.font) {
    out = out.replace(/<a:r>([\s\S]*?)<\/a:r>/g, (_m, body: string) => {
      const rpr = /^<a:rPr\b[^>]*\/>|^<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(body)?.[0] ?? null;
      const tail = rpr ? body.slice(rpr.length) : body;
      return `<a:r>${styleRPr(rpr, st)}${tail}</a:r>`;
    });
  }
  return out;
}

/** Đổi màu nền của hình (<p:sp>): thay khối tô cũ ở mức spPr, chèn sau hình học (hoặc xfrm). */
function fillShape(sp: string, hex: string): string {
  return sp.replace(/<p:spPr\b([^>]*)>([\s\S]*?)<\/p:spPr>/, (_m, a: string, inner: string) => {
    const lnAt = inner.search(/<a:ln\b/);
    let head = lnAt >= 0 ? inner.slice(0, lnAt) : inner;
    const tail = lnAt >= 0 ? inner.slice(lnAt) : "";
    head = head.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>|<a:gradFill\b[\s\S]*?<\/a:gradFill>|<a:pattFill\b[\s\S]*?<\/a:pattFill>|<a:blipFill\b[\s\S]*?<\/a:blipFill>/g, "");
    const fill = `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
    const geom = /<\/a:prstGeom>|<a:prstGeom\b[^>]*\/>|<\/a:custGeom>|<\/a:xfrm>/.exec(head);
    const pos = geom ? geom.index + geom[0].length : 0;
    return `<p:spPr${a}>${head.slice(0, pos)}${fill}${head.slice(pos)}${tail}</p:spPr>`;
  });
}


/** "Slide 9: Lợi ích" / "- Lợi ích" → "Lợi ích": nhãn do read_document thêm vào, không có trong slide. */
const stripLabel = (t: string): string => String(t ?? "").replace(/^\s*(?:slide\s*\d+\s*[:：.\-–—]\s*)/i, "").replace(/^\s*[-•·▪]\s+/, "").trim();

/** Gấp chữ để so khớp: bỏ dấu, không phân biệt hoa/thường, gộp khoảng trắng; `map[i]` = vị trí trong chuỗi gốc. */
function fold(text: string): { s: string; map: number[] } {
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
    const f = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
    for (const c of f) {
      s += c;
      map.push(i);
    }
    lastSpace = false;
  }
  return { s, map };
}

/** Thay chữ trong một đoạn bằng so khớp "mờ" (bỏ dấu, hoa/thường, khoảng trắng); trả về số chỗ đã thay. */
function fuzzyReplaceInParagraph(p: string, find: string, replace: string): { xml: string; count: number } {
  const nodes: { index: number; len: number; attrs: string; text: string }[] = [];
  for (const m of p.matchAll(T_RE)) nodes.push({ index: m.index!, len: m[0].length, attrs: m[1] ?? "", text: decodeXml(m[2]) });
  if (!nodes.length) return { xml: p, count: 0 };
  const needle = fold(find).s.trim();
  if (needle.length < 2) return { xml: p, count: 0 };
  const full = nodes.map((n) => n.text).join("");
  const f = fold(full);
  const at = f.s.indexOf(needle);
  if (at < 0) return { xml: p, count: 0 };
  const start = f.map[at];
  const end = (f.map[at + needle.length - 1] ?? full.length - 1) + 1;
  let pos = 0;
  let first = true;
  for (const n of nodes) {
    const s = pos;
    const e = pos + n.text.length;
    pos = e;
    if (e <= start || s >= end) continue;
    const from = Math.max(start, s) - s;
    const to = Math.min(end, e) - s;
    n.text = n.text.slice(0, from) + (first ? replace : "") + n.text.slice(to);
    first = false;
  }
  let out = "";
  let last = 0;
  for (const n of nodes) {
    out += p.slice(last, n.index) + `<a:t${n.attrs}>${encodeXml(n.text)}</a:t>`;
    last = n.index + n.len;
  }
  return { xml: out + p.slice(last), count: 1 };
}

/** Đặt chữ của cả đoạn: giữ định dạng của đoạn chữ đầu, xoá các đoạn chữ còn lại. */
function setParagraphText(p: string, text: string): string {
  let i = 0;
  return p.replace(T_RE, (_m, attrs: string | undefined) => `<a:t${attrs ?? ""}>${i++ === 0 ? encodeXml(text) : ""}</a:t>`);
}

/** Các đoạn chữ gần giống `find` nhất (theo số từ chung), mỗi mục "Slide N: chữ…". */
function nearest(find: string, slides: { n: number; texts: string[] }[]): string[] {
  const words = new Set(fold(find).s.split(" ").filter((w) => w.length > 1));
  if (!words.size) return [];
  const scored: { score: number; label: string }[] = [];
  for (const sl of slides)
    for (const t of sl.texts) {
      const tw = fold(t).s.split(" ");
      const score = tw.filter((w) => words.has(w)).length / Math.sqrt(Math.max(1, tw.length));
      if (score > 0) scored.push({ score, label: `Slide ${sl.n}: “${t.slice(0, 90)}${t.length > 90 ? "…" : ""}”` });
    }
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.label);
}

export async function editPptx(bytes: Uint8Array, o: PptxEditOptions): Promise<PptxEditResult> {
  const zip = await loadZip(bytes);
  const order = await slideOrder(zip);
  if (!order.length) throw new Error("Không thấy slide nào trong tệp PowerPoint này.");
  const reps = (o.replacements ?? []).map((r) => ({ ...r, find: stripLabel(r.find), replace: stripLabel(r.replace) }));
  const counts = reps.map(() => 0);
  const suggestions: Record<number, string[]> = {};
  const changes: string[] = [];
  const note = (s: string) => changes.length < 40 && changes.push(s);
  const del = [...new Set(o.delete_slides ?? [])].sort((a, b) => a - b);
  for (const d of del) if (!Number.isInteger(d) || d < 1 || d > order.length) throw new Error(`Không có slide ${d}: bài có ${order.length} slide.`);
  if (del.length >= order.length) throw new Error("Không thể xoá hết slide.");
  const tf = o.transform ? caseOf(o.transform.case) : null;
  const tfSlides = o.transform?.slides?.length ? new Set(o.transform.slides) : null;

  for (const [i, file] of order.entries()) {
    const n = i + 1;
    if (del.includes(n)) continue;
    const rels = (await zip.file(`ppt/slides/_rels/${file.split("/").pop()}.rels`)?.async("string")) ?? "";
    const notesFile = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1];
    const parts = [file, ...(notesFile ? [`ppt/notesSlides/${notesFile}`] : [])];
    for (const part of parts) {
      let xml = await zip.file(part)!.async("string");
      const orig = xml;
      const myReps = reps.map((r, k) => ({ ...r, k })).filter((r) => r.slide === undefined || r.slide === n);
      if (myReps.length) {
        const local = myReps.map(() => 0);
        xml = xml.replace(P_RE, (p) => {
          const r = replaceInParagraph(p, myReps, local);
          if (r.after !== r.before) note(`Slide ${n}${part === file ? "" : " (ghi chú)"}: “${r.before.slice(0, 50)}” → “${r.after.slice(0, 50)}”`);
          return r.xml;
        });
        myReps.forEach((r, j) => (counts[r.k] += local[j]));
      }
      if (tf && part === file && (!tfSlides || tfSlides.has(n))) {
        const apply = (s: string) =>
          s.replace(P_RE, (p) => {
            const b = [...p.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("");
            const out = p.replace(T_RE, (_m, attrs: string | undefined, t: string) => `<a:t${attrs ?? ""}>${encodeXml(tf(decodeXml(t)))}</a:t>`);
            const a = [...out.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("");
            if (a !== b) note(`Slide ${n}: “${b.slice(0, 50)}” → “${a.slice(0, 50)}”`);
            return out;
          });
        if ((o.transform!.target ?? "titles") === "all") xml = apply(xml);
        else {
          const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)];
          const idx = titleShapeIndexes(shapes.map((m) => m[0]));
          let k = -1;
          xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => (idx.has(++k) ? apply(sp) : sp));
        }
      }
      if (part === file && (o.style?.length || o.background)) {
        const paraText = (p: string) => [...p.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("");
        for (const st of o.style ?? []) {
          if (st.slides?.length && !st.slides.includes(n)) continue;
          const spec = { ...st, color: st.color ? colorHex(st.color) ?? undefined : undefined, fill: st.fill ? colorHex(st.fill) ?? undefined : undefined };
          if ((st.color && !spec.color) || (st.fill && !spec.fill)) throw new Error(`Không hiểu màu “${st.color && !spec.color ? st.color : st.fill}”. Dùng mã #RRGGBB hoặc tên màu thông dụng.`);
          const target = st.target ?? "titles";
          if (target === "match" && !st.match) throw new Error("style.target=match cần có match (chữ cần tìm).");
          const doShape = (sp: string, pick: (p: string) => boolean, whole: boolean): string => {
            const hit = [...sp.matchAll(P_RE)].some((p) => pick(p[0]));
            if (!hit) return sp;
            let out = sp.replace(P_RE, (p) => (pick(p) ? stylePara(p, spec) : p));
            if (spec.fill && (whole || hit)) out = fillShape(out, spec.fill);
            return out;
          };
          if (target === "all") xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => doShape(sp, () => true, true));
          else if (target === "match") xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => doShape(sp, (p) => paraText(p).includes(st.match!), true));
          else {
            const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)];
            const idx = titleShapeIndexes(shapes.map((m) => m[0]));
            let k = -1;
            xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => (idx.has(++k) ? doShape(sp, () => true, true) : sp));
          }
          if (xml !== orig) note(`Slide ${n}: đã định dạng ${target === "titles" ? "tiêu đề" : target === "all" ? "toàn bộ chữ" : `đoạn chứa “${st.match!.slice(0, 30)}”`}`);
        }
        if (o.background && (!o.background.slides?.length || o.background.slides.includes(n))) {
          const hex = colorHex(o.background.color);
          if (!hex) throw new Error(`Không hiểu màu nền “${o.background.color}”.`);
          const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
          xml = /<p:bg>[\s\S]*?<\/p:bg>/.test(xml) ? xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, bg) : xml.replace(/(<p:cSld\b[^>]*>)/, `$1${bg}`);
          note(`Slide ${n}: đổi màu nền`);
        }
      }
      if (xml !== orig) zip.file(part, xml);
    }
  }

  // set_title: đặt lại tiêu đề theo số slide (không cần chữ cũ)
  for (const t of o.set_title ?? []) {
    if (!Number.isInteger(t.slide) || t.slide < 1 || t.slide > order.length) throw new Error(`set_title: không có slide ${t.slide} (bài có ${order.length} slide).`);
    const file = order[t.slide - 1];
    let xml = await zip.file(file)!.async("string");
    const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
    const idx = [...titleShapeIndexes(shapes)][0];
    if (idx === undefined) throw new Error(`set_title: slide ${t.slide} không có tiêu đề để sửa (hãy dùng replacements).`);
    const before = shapes[idx];
    const oldTitle = [...before.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("");
    let done = false;
    const after = before.replace(P_RE, (p) => (done || !/<a:t[\s>]/.test(p) ? p : ((done = true), setParagraphText(p, stripLabel(String(t.text ?? ""))))));
    xml = xml.replace(before, after);
    zip.file(file, xml);
    note(`Slide ${t.slide}: tiêu đề “${oldTitle.slice(0, 50)}” → “${stripLabel(String(t.text ?? "")).slice(0, 50)}”`);
  }
  // bước 2 cho replacements chưa thấy: so khớp mờ (bỏ dấu, hoa/thường, khoảng trắng); vẫn không thấy thì gợi ý đoạn gần giống
  const missing = reps.map((_r, k) => k).filter((k) => counts[k] === 0 && reps[k].find);
  if (missing.length) {
    const texts: { n: number; texts: string[] }[] = [];
    for (const [i, file] of order.entries()) {
      const n = i + 1;
      let xml = await zip.file(file)!.async("string");
      const orig = xml;
      for (const k of missing) {
        const r = reps[k];
        if (r.slide !== undefined && r.slide !== n) continue;
        xml = xml.replace(P_RE, (p) => {
          const f = fuzzyReplaceInParagraph(p, r.find, r.replace);
          if (f.count) {
            counts[k] += f.count;
            note(`Slide ${n}: “${[...p.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("").slice(0, 50)}” → “${[...f.xml.matchAll(T_RE)].map((m) => decodeXml(m[2])).join("").slice(0, 50)}”`);
          }
          return f.xml;
        });
      }
      if (xml !== orig) zip.file(file, xml);
      texts.push({ n, texts: [...xml.matchAll(P_RE)].map((p) => [...p[0].matchAll(T_RE)].map((m) => decodeXml(m[2])).join("")).filter((t) => t.trim()) });
    }
    for (const k of missing) if (counts[k] === 0) suggestions[k] = nearest(reps[k].find, texts);
  }

  // cấu trúc: chuyển, nhân đôi, xoá (theo số slide GỐC); viết lại presentation.xml, quan hệ và kiểu nội dung cho khớp
  const dup = (o.duplicate_slides ?? []).slice(0, 20);
  for (const d of dup) if (!Number.isInteger(d) || d < 1 || d > order.length) throw new Error(`Không có slide ${d}: bài có ${order.length} slide.`);
  const mv = o.move_slide;
  if (mv && (!Number.isInteger(mv.slide) || !Number.isInteger(mv.to) || mv.slide < 1 || mv.slide > order.length || mv.to < 1 || mv.to > order.length)) throw new Error(`move_slide: số slide phải từ 1 đến ${order.length}.`);
  const delSet = new Set(del.map((d) => order[d - 1]));
  const layout: { file: string; label: string }[] = order.map((f, i) => ({ file: f, label: String(i + 1) }));
  if (del.length || dup.length || mv) {
    let pres = await zip.file("ppt/presentation.xml")!.async("string");
    let prels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    let ctypes = await zip.file("[Content_Types].xml")!.async("string");
    // ánh xạ: tệp slide ↔ (id số, rId)
    const relByFile = new Map<string, { id: string; tag: string; type: string }>();
    for (const m of prels.matchAll(/<Relationship\b[^>]*\/>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      const type = /\bType="([^"]+)"/.exec(m[0])?.[1] ?? "";
      if (id && t && /slides\/slide\d+\.xml$/.test(t)) relByFile.set("ppt/" + t.replace(/^\/?(ppt\/)?/, ""), { id, tag: m[0], type });
    }
    const idByRid = new Map<string, string>();
    for (const m of pres.matchAll(/<p:sldId\b[^>]*>/g)) {
      const id = /\bid="(\d+)"/.exec(m[0])?.[1];
      const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
      if (id && rid) idByRid.set(rid, id);
    }
    const ids = new Map<string, string>();
    const rids = new Map<string, string>();
    for (const f of order) {
      const r = relByFile.get(f);
      if (!r) throw new Error("Cấu trúc tệp PowerPoint không như dự kiến, không sửa được thứ tự/xoá slide.");
      rids.set(f, r.id);
      ids.set(f, idByRid.get(r.id) ?? "");
    }
    let nextId = Math.max(255, ...[...ids.values()].map(Number)) + 1;
    let nextRid = Math.max(0, ...[...prels.matchAll(/\bId="rId(\d+)"/g)].map((m) => +m[1])) + 1;
    let nextSlide = Math.max(...order.map(num)) + 1;
    let cur = layout.slice();
    if (mv && mv.slide !== mv.to) {
      const [x] = cur.splice(mv.slide - 1, 1);
      cur.splice(mv.to - 1, 0, x);
    }
    // nhân đôi
    const srcCtype = (f: string) => new RegExp(`<Override\\b[^>]*PartName="/${reEsc(f)}"[^>]*/>`).exec(ctypes)?.[0];
    for (const d of dup) {
      const src = order[d - 1];
      const srcBase = src.split("/").pop()!;
      const srcRels = (await zip.file(`ppt/slides/_rels/${srcBase}.rels`)?.async("string")) ?? "";
      if (/relationships\/(?:chart|oleObject|package|diagramData)"/.test(srcRels)) throw new Error(`Slide ${d} có biểu đồ/đối tượng nhúng nên không nhân đôi được. Hãy dùng create_pptx để dựng lại slide này.`);
      const file = `ppt/slides/slide${nextSlide++}.xml`;
      const base = file.split("/").pop()!;
      zip.file(file, await zip.file(src)!.async("string"));
      zip.file(`ppt/slides/_rels/${base}.rels`, srcRels.replace(/<Relationship\b[^>]*relationships\/notesSlide"[^>]*\/>/g, "").replace(/<Relationship\b[^>]*Target="[^"]*notesSlides[^"]*"[^>]*\/>/g, ""));
      const ov = srcCtype(src);
      if (ov) ctypes = ctypes.replace("</Types>", ov.replace(reEsc(src) === "" ? "" : `/${src}`, `/${file}`) + "</Types>");
      const rid = `rId${nextRid++}`;
      const type = relByFile.get(src)!.type;
      prels = prels.replace("</Relationships>", `<Relationship Id="${rid}" Type="${type}" Target="slides/${base}"/></Relationships>`);
      ids.set(file, String(nextId++));
      rids.set(file, rid);
      const at = cur.findIndex((c) => c.file === src);
      let ins = at + 1;
      while (ins < cur.length && cur[ins].label.startsWith("bản sao của " + d)) ins++; // nhiều bản sao của cùng một slide: giữ thứ tự
      cur.splice(ins, 0, { file, label: `bản sao của ${d}` });
    }
    // xoá
    if (del.length) {
      cur = cur.filter((c) => !delSet.has(c.file));
      for (const f of delSet) {
        const base = f.split("/").pop()!;
        const relsPath = `ppt/slides/_rels/${base}.rels`;
        const rels = (await zip.file(relsPath)?.async("string")) ?? "";
        const gone = [f, relsPath];
        for (const m of rels.matchAll(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/g)) gone.push(`ppt/notesSlides/${m[1]}`, `ppt/notesSlides/_rels/${m[1]}.rels`);
        for (const g of gone) {
          zip.remove(g);
          ctypes = ctypes.replace(new RegExp(`<Override\\b[^>]*PartName="/${reEsc(g)}"[^>]*/>`), "");
        }
        const r = relByFile.get(f);
        if (r) prels = prels.replace(r.tag, "");
      }
    }
    // viết lại danh sách slide theo thứ tự cuối
    pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${cur.map((c) => `<p:sldId id="${ids.get(c.file)}" r:id="${rids.get(c.file)}"/>`).join("")}</p:sldIdLst>`);
    // phần (section) của PowerPoint: danh sách id không còn khớp nếu đổi thứ tự/thêm/xoá → bỏ khai báo phần cho an toàn
    pres = pres.replace(/<p:extLst>\s*<p:ext\s+uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>\s*<\/p:extLst>/, "");
    zip.file("ppt/presentation.xml", pres);
    zip.file("ppt/_rels/presentation.xml.rels", prels);
    zip.file("[Content_Types].xml", ctypes);
    layout.length = 0;
    layout.push(...cur);
    for (const d of del) note(`Đã xoá slide ${d}`);
    for (const d of dup) note(`Đã nhân đôi slide ${d}: bản sao nằm ngay sau nó`);
    if (mv && mv.slide !== mv.to) note(`Đã chuyển slide ${mv.slide} tới vị trí ${mv.to}`);
  }
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), slides: layout.length, counts, changes, deleted: del, suggestions, layout: layout.map((l) => l.label) };
}
