import { colorHex } from "./colors";
import { decodeXml, encodeXml, loadZip } from "./docx-read";
import { buildBody, buildSlides, layoutNames, openPkg, readDeckStyle, savePkg, setBodyInPlace, transplantSlide, addOverride, type BodyKind, type MiniDeck } from "./pptx-add";
import { P_RE, TX_RE, replaceInTxBody, txText } from "./pptx-replace";
import { reEsc, slideNum as num, slideOrder } from "./pptx-zip";
import { CLOSING_RE } from "./pptx";

export { slideOrder };

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
  /** Thay TOÀN BỘ phần thân của slide (giữ tiêu đề, bố cục, chủ đề, ghi chú): mỗi dòng một ý, dòng thụt 2 dấu cách là ý con. */
  set_body?: { slide: number; text: string }[];
  /** Chèn slide mới (Markdown như create_pptx) sau slide `after` (số theo bài trước khi sửa; 0 = đầu bài; "end" = cuối). */
  add_slides?: { after?: number | "end"; content: string }[] | { after?: number | "end"; content: string };
  /** Ảnh dùng trong nội dung add_slides (khoá = đường dẫn trong Markdown). */
  images?: Record<string, Uint8Array>;
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
  /** Với mỗi `replacements` không tìm thấy: số slide có đoạn gần giống nhất (hoặc slide được chỉ định). */
  suggestSlide: Record<number, number>;
  /** Tiêu đề từng slide sau khi sửa (theo thứ tự). */
  titles: string[];
  /** Số slide được dựng lại/chèn bởi set_body / add_slides. */
  rebuilt: number[];
  added: number;
  /** Cảnh báo ngắn (ghi chú bị bỏ, ảnh thiếu…). */
  warnings: string[];
  /** Thứ tự cuối cùng: mỗi phần tử là số slide GỐC (hoặc "bản sao của N"). */
  layout: string[];
}

const caseOf = (mode: "upper" | "lower" | "capitalize") => (t: string): string =>
  mode === "upper" ? t.toLocaleUpperCase("vi") : mode === "lower" ? t.toLocaleLowerCase("vi") : t.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w.charAt(0).toLocaleUpperCase("vi") + w.slice(1).toLocaleLowerCase("vi"));

const T_RE = /<a:t(\s[^>]*)?>([^<]*)<\/a:t>/g;

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

/** Đặt chữ của cả đoạn: giữ định dạng của đoạn chữ đầu, xoá các đoạn chữ còn lại. */
function setParagraphText(p: string, text: string): string {
  let i = 0;
  return p.replace(T_RE, (_m, attrs: string | undefined) => `<a:t${attrs ?? ""}>${i++ === 0 ? encodeXml(text) : ""}</a:t>`);
}

/** Các đoạn chữ gần giống `find` nhất (theo số từ chung). */
function nearest(find: string, slides: { n: number; texts: string[] }[]): { slide: number; label: string }[] {
  const words = new Set(fold(find).s.split(" ").filter((w) => w.length > 1));
  if (!words.size) return [];
  const scored: { score: number; slide: number; label: string }[] = [];
  for (const sl of slides)
    for (const t of sl.texts) {
      const tw = fold(t).s.split(" ");
      const score = tw.filter((w) => words.has(w)).length / Math.sqrt(Math.max(1, tw.length));
      if (score > 0) scored.push({ score, slide: sl.n, label: `Slide ${sl.n}: “${t.slice(0, 90)}${t.length > 90 ? "…" : ""}”` });
    }
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map((x) => ({ slide: x.slide, label: x.label }));
}

const shapesOf = (xml: string): string[] => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const shapeText = (sp: string): string => [...sp.matchAll(P_RE)].map((p) => [...p[0].matchAll(T_RE)].map((m) => decodeXml(m[2])).join("")).filter((t) => t.trim()).join(" ");

/** Tiêu đề của slide: hình có <p:ph type=title>, không có thì hình chữ cỡ lớn nhất. */
function slideTitleOf(xml: string): string {
  const shapes = shapesOf(xml);
  const idx = [...titleShapeIndexes(shapes)][0];
  return (idx === undefined ? "" : shapeText(shapes[idx])).trim() || "(không tiêu đề)";
}

export async function editPptx(bytes: Uint8Array, o: PptxEditOptions): Promise<PptxEditResult> {
  const zip = await loadZip(bytes);
  const order = await slideOrder(zip);
  if (!order.length) throw new Error("Không thấy slide nào trong tệp PowerPoint này.");
  const reps = (o.replacements ?? []).map((r) => ({ ...r, find: stripLabel(r.find), replace: stripLabel(r.replace) }));
  const counts = reps.map(() => 0);
  const suggestions: Record<number, string[]> = {};
  const suggestSlide: Record<number, number> = {};
  const warnings: string[] = [];
  const rebuilt: number[] = [];
  const changes: string[] = [];
  const note = (s: string) => changes.length < 40 && changes.push(s);
  const del = [...new Set(o.delete_slides ?? [])].sort((a, b) => a - b);
  for (const d of del) if (!Number.isInteger(d) || d < 1 || d > order.length) throw new Error(`Không có slide ${d}: bài có ${order.length} slide.`);
  if (del.length >= order.length) throw new Error("Không thể xoá hết slide.");
  const tf = o.transform ? caseOf(o.transform.case) : null;
  const tfSlides = o.transform?.slides?.length ? new Set(o.transform.slides) : null;

  const pkg = await openPkg(zip);
  const needDeck = !!(o.set_body?.length || (Array.isArray(o.add_slides) ? o.add_slides.length : o.add_slides));
  const deck = needDeck ? await readDeckStyle(zip) : { builder: false };
  const layouts = needDeck ? await layoutNames(zip) : new Map<string, string>();

  // set_body: thay toàn bộ phần thân của slide (số theo bài trước khi sửa)
  for (const sb of o.set_body ?? []) {
    if (!sb || !Number.isInteger(sb.slide) || sb.slide < 1 || sb.slide > order.length) throw new Error(`set_body: không có slide ${sb?.slide} (bài có ${order.length} slide).`);
    if (typeof sb.text !== "string") throw new Error("set_body: thiếu text (mỗi dòng một ý).");
    if (del.includes(sb.slide)) continue;
    const file = order[sb.slide - 1];
    const xml = await zip.file(file)!.async("string");
    const title = slideTitleOf(xml);
    let lines = sb.text.replace(/\r\n?/g, "\n").split("\n");
    const first = lines.findIndex((l) => l.trim());
    if (first >= 0) {
      const head = stripLabel(lines[first].replace(/^\s*#{1,6}\s+/, ""));
      if (fold(head).s === fold(title).s) lines = lines.slice(first + 1); // dòng đầu chỉ lặp lại tiêu đề
      else lines[first] = lines[first].replace(/^(\s*)#{1,6}\s+/, "$1");
    }
    lines = lines.map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    if (!lines.length) throw new Error(`set_body: slide ${sb.slide} không có dòng nào để đặt.`);
    const relsFile = `ppt/slides/_rels/${file.split("/").pop()}.rels`;
    const rels = (await zip.file(relsFile)?.async("string")) ?? "";
    const layoutTarget = /Type="[^"]*\/slideLayout"[^>]*Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"|Target="\.\.\/slideLayouts\/(slideLayout\d+\.xml)"[^>]*Type="[^"]*\/slideLayout"/.exec(rels);
    const layoutFile = layoutTarget ? "ppt/slideLayouts/" + (layoutTarget[1] ?? layoutTarget[2]) : "";
    const layoutName = [...layouts].find(([, f]) => f === layoutFile)?.[0] ?? "";
    const hasGraphic = /<p:graphicFrame\b|<p:pic\b/.test(xml);
    const kind: BodyKind = layoutName === "COVER" ? (sb.slide === 1 ? "cover" : "closing") : layoutName === "SECTION" ? "section" : layoutName === "QUOTE" ? "quote" : "content";
    if (deck.builder && !hasGraphic && kind !== "quote") {
      let t = title;
      if (kind === "section") {
        const n = /name="deco"[\s\S]*?<a:t>(\d{1,2})<\/a:t>/.exec(xml)?.[1];
        if (n) t = `${+n}. ${title}`;
      }
      const mini = await buildBody(t, lines, kind, deck, o.images);
      const notes = /<Relationship\b[^>]*Type="[^"]*\/notesSlide"[^>]*Target="([^"]+)"|<Relationship\b[^>]*Target="([^"]+)"[^>]*Type="[^"]*\/notesSlide"/.exec(rels);
      for (const w of await transplantSlide(mini.pkg, mini.layouts, pkg, mini.files[0], file, { layouts, keepNotes: notes ? notes[1] ?? notes[2] : undefined })) warnings.push(w);
      for (const w of mini.warnings) warnings.length < 3 && warnings.push(w);
    } else {
      const out = setBodyInPlace(xml, lines);
      if (out === null) throw new Error(`set_body: slide ${sb.slide} không có khung chữ thân để thay. Dùng add_slides để thêm slide mới rồi delete_slides.`);
      zip.file(file, out);
    }
    rebuilt.push(sb.slide);
    note(`Slide ${sb.slide}: đã thay phần thân (${lines.length} dòng)`);
  }

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
        xml = xml.replace(TX_RE, (tx) => {
          const r = replaceInTxBody(tx, myReps, local, "exact");
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
  // bước 2 cho replacements chưa thấy: so khớp dễ tính (bỏ dấu, hoa/thường, dấu câu, gạch đầu dòng, nhiều đoạn); vẫn không thấy thì gợi ý đoạn gần giống
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
        xml = xml.replace(TX_RE, (tx) => {
          const loc = [0];
          const f = replaceInTxBody(tx, [r], loc, "loose");
          if (loc[0]) {
            counts[k] += loc[0];
            note(`Slide ${n}: “${f.before.slice(0, 50)}” → “${f.after.slice(0, 50)}”`);
          }
          return f.xml;
        });
      }
      if (xml !== orig) zip.file(file, xml);
      texts.push({ n, texts: [...xml.matchAll(TX_RE)].flatMap((tx) => txText(tx[0]).split("\n")).filter((t) => t.trim()) });
    }
    for (const k of missing)
      if (counts[k] === 0) {
        const near = nearest(reps[k].find, texts);
        suggestions[k] = near.map((x) => x.label);
        const sl = reps[k].slide ?? near[0]?.slide;
        if (sl) suggestSlide[k] = sl;
      }
  }

  // add_slides: dựng bằng bộ dựng của create_pptx rồi ghép vào tệp (slide mới đúng bố cục/chủ đề của tệp)
  const adds = (Array.isArray(o.add_slides) ? o.add_slides : o.add_slides ? [o.add_slides] : []).slice(0, 10);
  const batches: { after: number | "end"; files: string[]; beforeClosing: boolean }[] = [];
  const lastFile = order[order.length - 1];
  const lastIsClosing = CLOSING_RE.test(slideTitleOf(await zip.file(lastFile)!.async("string")));
  for (const ad of adds) {
    if (!ad || typeof ad.content !== "string" || !ad.content.trim()) throw new Error("add_slides: thiếu content (Markdown của slide mới, như create_pptx).");
    const after: number | "end" = ad.after === undefined || ad.after === null || ad.after === "end" ? "end" : Number(ad.after);
    if (after !== "end" && (!Number.isInteger(after) || after < 0 || after > order.length)) throw new Error(`add_slides: after phải từ 0 đến ${order.length} hoặc "end".`);
    const mini = await buildSlides(ad.content, deck as Awaited<ReturnType<typeof readDeckStyle>>, o.images);
    const files: string[] = [];
    for (const f of mini.files) {
      const k = Math.max(0, ...Object.keys(zip.files).map((nm) => +(/^ppt\/slides\/slide(\d+)\.xml$/.exec(nm)?.[1] ?? 0))) + 1;
      const dest = `ppt/slides/slide${k}.xml`;
      for (const w of await transplantSlide(mini.pkg, mini.layouts, pkg, f, dest, { layouts, withNotes: true })) warnings.length < 3 && warnings.push(w);
      files.push(dest);
    }
    for (const w of mini.warnings) warnings.length < 3 && warnings.push(w);
    batches.push({ after, files, beforeClosing: after === "end" && lastIsClosing && !mini.endsClosing });
  }

  // cấu trúc: chuyển, nhân đôi, xoá (theo số slide GỐC); viết lại presentation.xml, quan hệ và kiểu nội dung cho khớp
  const dup = (o.duplicate_slides ?? []).slice(0, 20);
  for (const d of dup) if (!Number.isInteger(d) || d < 1 || d > order.length) throw new Error(`Không có slide ${d}: bài có ${order.length} slide.`);
  const mv = o.move_slide;
  if (mv && (!Number.isInteger(mv.slide) || !Number.isInteger(mv.to) || mv.slide < 1 || mv.slide > order.length || mv.to < 1 || mv.to > order.length)) throw new Error(`move_slide: số slide phải từ 1 đến ${order.length}.`);
  const delSet = new Set(del.map((d) => order[d - 1]));
  const layout: { file: string; label: string }[] = order.map((f, i) => ({ file: f, label: String(i + 1) }));
  const added = batches.reduce((n, b) => n + b.files.length, 0);
  if (del.length || dup.length || mv || added) {
    let pres = await zip.file("ppt/presentation.xml")!.async("string");
    let prels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
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
    let nextSlide = Math.max(...Object.keys(zip.files).map((nm) => (/^ppt\/slides\/slide\d+\.xml$/.test(nm) ? num(nm) : 0))) + 1;
    let cur: { file: string; label: string; anchor?: string }[] = layout.slice();
    if (mv && mv.slide !== mv.to) {
      const [x] = cur.splice(mv.slide - 1, 1);
      cur.splice(mv.to - 1, 0, x);
    }
    // nhân đôi
    const srcCtype = (f: string) => new RegExp(`<Override\\b[^>]*PartName="/${reEsc(f)}"[^>]*/>`).exec(pkg.types)?.[0];
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
      if (ov) pkg.types = pkg.types.replace("</Types>", ov.replace(`/${src}`, `/${file}`) + "</Types>");
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
    // slide mới (add_slides): đăng ký vào bài rồi đặt đúng vị trí
    const slideType = [...relByFile.values()][0]?.type ?? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
    for (const b of batches) {
      let at: number;
      if (b.after === "end") {
        at = cur.length;
        const ci = b.beforeClosing ? cur.findIndex((c) => c.file === lastFile) : -1;
        if (ci >= 0) at = ci;
      } else if (b.after === 0) at = 0;
      else {
        const i0 = cur.findIndex((c) => c.file === order[(b.after as number) - 1]);
        at = i0 < 0 ? cur.length : i0 + 1;
        while (at < cur.length && (cur[at].label.startsWith("bản sao của " + b.after) || cur[at].anchor === String(b.after))) at++;
      }
      b.files.forEach((f, k) => {
        const rid = `rId${nextRid++}`;
        prels = prels.replace("</Relationships>", `<Relationship Id="${rid}" Type="${slideType}" Target="slides/${f.split("/").pop()}"/></Relationships>`);
        ids.set(f, String(nextId++));
        rids.set(f, rid);
        addOverride(pkg, f, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
        cur.splice(at + k, 0, { file: f, label: "mới", anchor: String(b.after) });
      });
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
          pkg.types = pkg.types.replace(new RegExp(`<Override\\b[^>]*PartName="/${reEsc(g)}"[^>]*/>`), "");
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
    layout.length = 0;
    layout.push(...cur);
    for (const d of del) note(`Đã xoá slide ${d}`);
    for (const d of dup) note(`Đã nhân đôi slide ${d}: bản sao nằm ngay sau nó`);
    if (added) note(`Đã thêm ${added} slide mới`);
    if (mv && mv.slide !== mv.to) note(`Đã chuyển slide ${mv.slide} tới vị trí ${mv.to}`);
  }
  savePkg(pkg);
  const titles: string[] = [];
  for (const l of layout) titles.push(slideTitleOf(await zip.file(l.file)!.async("string")));
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), slides: layout.length, counts, changes, deleted: del, suggestions, suggestSlide, titles, rebuilt, added, warnings, layout: layout.map((l) => l.label) };
}
