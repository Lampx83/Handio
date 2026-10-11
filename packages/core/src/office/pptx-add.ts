import { loadZip } from "./docx-read";
import { parseInline, runsText } from "./mdblocks";
import { CLOSING_RE, PPTX_THEMES, createPptx, deriveTheme, parseSlides, type Theme } from "./pptx";
import { cloneWithText, P_RE } from "./pptx-replace";
import { slideOrder, type PptxZip } from "./pptx-zip";

/**
 * Chèn/dựng lại slide trong một tệp .pptx CÓ SẴN bằng chính bộ dựng của create_pptx: dựng một bài nhỏ rồi ghép
 * (slide, ảnh, biểu đồ, ghi chú) sang tệp đích, dùng bố cục (layout) cùng tên của tệp đích nên slide mới đồng bộ phong cách.
 */

export interface Pkg {
  zip: PptxZip;
  /** Nội dung [Content_Types].xml (giữ trong bộ nhớ; ghi lại bằng savePkg). */
  types: string;
}

export async function openPkg(zip: PptxZip): Promise<Pkg> {
  return { zip, types: await zip.file("[Content_Types].xml")!.async("string") };
}
export const savePkg = (p: Pkg): void => void p.zip.file("[Content_Types].xml", p.types);

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const T_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const T_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const T_NOTESMASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpg", gif: "image/gif", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", svg: "image/svg+xml" };

// ---------------------------------------------------------------- kiểu của tệp đích

export interface DeckStyle {
  /** Tệp do bộ dựng của create_pptx tạo (có các bố cục CONTENT/COVER/SECTION/QUOTE). */
  builder: boolean;
  key?: string;
  spec?: Theme;
}

export async function layoutNames(zip: PptxZip): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).sort()) {
    const xml = await zip.file(f)!.async("string");
    const nm = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
    if (nm && !out.has(nm)) out.set(nm, f);
  }
  return out;
}

export async function readDeckStyle(zip: PptxZip): Promise<DeckStyle> {
  const names = await layoutNames(zip);
  const builder = ["CONTENT", "COVER", "SECTION"].every((n) => names.has(n));
  const th = Object.keys(zip.files).find((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  const xml = th ? await zip.file(th)!.async("string") : "";
  const key = /<a:clrScheme\b[^>]*\bname="Handio ([^"]+)"/.exec(xml)?.[1];
  if (key && PPTX_THEMES[key]) return { builder, key };
  const bg = async (name: string) => {
    const f = names.get(name);
    return f ? /<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(await zip.file(f)!.async("string"))?.[1] : undefined;
  };
  if (builder) {
    const spec = deriveTheme({ accent1: await bg("SECTION"), dk2: await bg("COVER") });
    if (spec) return { builder, spec };
  }
  const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
  const col = (tag: string) => new RegExp(`<a:${tag}>\\s*<a:(?:srgbClr val|sysClr\\b[^>]*\\blastClr)="([0-9A-Fa-f]{6})"`).exec(scheme)?.[1];
  const spec = deriveTheme({ dk1: col("dk1"), dk2: col("dk2"), lt2: col("lt2"), accent1: col("accent1"), accent2: col("accent2") });
  return { builder, spec: spec ?? undefined };
}

// ---------------------------------------------------------------- tiện ích gói

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Đường dẫn tuyệt đối (trong gói) của `target` viết trong quan hệ của phần `from`. */
function resolveTarget(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dirOf(from).split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
function relativeTo(fromDir: string, to: string): string {
  const a = fromDir.split("/");
  const b = to.split("/");
  while (a.length && b.length > 1 && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => ".."), ...b].join("/");
}
function uniq(pkg: Pkg, dir: string, stem: string, ext: string): string {
  const have = new Set(Object.keys(pkg.zip.files));
  for (let i = 1; ; i++) {
    const n = `${dir}/${stem}${i}.${ext}`;
    if (!have.has(n)) return n;
  }
}
export function addOverride(pkg: Pkg, part: string, type: string): void {
  if (!pkg.types.includes(`PartName="/${part}"`)) pkg.types = pkg.types.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
}
function ensureDefault(pkg: Pkg, ext: string, type: string): void {
  if (!new RegExp(`<Default\\b[^>]*\\bExtension="${ext}"`, "i").test(pkg.types)) pkg.types = pkg.types.replace("</Types>", `<Default Extension="${ext}" ContentType="${type}"/></Types>`);
}
const overrideType = (types: string, part: string) => new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*ContentType="([^"]+)"`).exec(types)?.[1] ?? new RegExp(`<Override\\b[^>]*ContentType="([^"]+)"[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(types)?.[1];
const defaultType = (types: string, ext: string) => new RegExp(`<Default\\b[^>]*Extension="${ext}"[^>]*ContentType="([^"]+)"`, "i").exec(types)?.[1];

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}
function parseRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => ({
    id: /\bId="([^"]*)"/.exec(m[0])?.[1] ?? "",
    type: /\bType="([^"]*)"/.exec(m[0])?.[1] ?? "",
    target: /\bTarget="([^"]*)"/.exec(m[0])?.[1] ?? "",
    external: /\bTargetMode="External"/.test(m[0]),
  }));
}
const relXml = (r: Rel) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ""}/>`;
const relsDoc = (rels: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${rels.join("")}</Relationships>`;

/** Chép một phần (kèm quan hệ con) từ gói nhỏ sang gói đích; trả về đường dẫn mới. */
async function copyPart(mini: Pkg, dst: Pkg, src: string, depth = 0): Promise<string> {
  const f = mini.zip.file(src);
  if (!f) throw new Error(`Thiếu phần ${src} trong gói dựng.`);
  const m = /^(.*)\/([^/]*?)(\d*)\.([^./]+)$/.exec(src);
  if (!m) throw new Error(`Tên phần lạ: ${src}`);
  const out = uniq(dst, m[1], m[2], m[4]);
  dst.zip.file(out, await f.async("uint8array"));
  const type = overrideType(mini.types, src);
  if (type) addOverride(dst, out, type);
  else ensureDefault(dst, m[4].toLowerCase(), defaultType(mini.types, m[4]) ?? MIME[m[4].toLowerCase()] ?? "application/octet-stream");
  const relsFile = `${m[1]}/_rels/${baseOf(src)}.rels`;
  const relsXml = await mini.zip.file(relsFile)?.async("string");
  if (relsXml && depth < 3) {
    const rels: string[] = [];
    for (const r of parseRels(relsXml)) {
      if (r.external) {
        rels.push(relXml(r));
        continue;
      }
      const np = await copyPart(mini, dst, resolveTarget(src, r.target), depth + 1);
      rels.push(relXml({ ...r, target: relativeTo(dirOf(out), np) }));
    }
    dst.zip.file(`${dirOf(out)}/_rels/${baseOf(out)}.rels`, relsDoc(rels));
  }
  return out;
}

// ---------------------------------------------------------------- ghép slide

async function notesBodyText(zip: PptxZip, part: string): Promise<string> {
  const nx = await zip.file(part)?.async("string");
  if (!nx) return "";
  return [...nx.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].filter((m) => /type="body"/.test(m[0])).map((m) => [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).join("").trim();
}

export interface TransplantOptions {
  /** Tên bố cục → tệp bố cục của tệp đích. */
  layouts: Map<string, string>;
  /** Đích đến (tương đối từ ppt/slides) của trang ghi chú cũ cần giữ lại khi dựng lại một slide. */
  keepNotes?: string;
  /** Tạo ghi chú từ gói nhỏ (cần tệp đích có trang ghi chú mẫu). */
  withNotes?: boolean;
}

/** Ghép slide `miniFile` của gói nhỏ vào `destFile` của tệp đích (ghi đè nếu đã có). Trả về cảnh báo (nếu có). */
export async function transplantSlide(mini: Pkg, miniLayouts: Map<string, string>, dst: Pkg, miniFile: string, destFile: string, o: TransplantOptions): Promise<string[]> {
  const warnings: string[] = [];
  let xml = await mini.zip.file(miniFile)!.async("string");
  const relsXml = (await mini.zip.file(`ppt/slides/_rels/${baseOf(miniFile)}.rels`)?.async("string")) ?? "";
  const nameOf = new Map([...miniLayouts].map(([n, f]) => [f, n]));
  const out: string[] = [];
  let bg = "";
  let notesText = "";
  for (const r of parseRels(relsXml)) {
    if (r.external) {
      out.push(relXml(r));
      continue;
    }
    const abs = resolveTarget(miniFile, r.target);
    if (/\/slideLayout$/.test(r.type)) {
      const name = nameOf.get(abs) ?? "";
      let file = o.layouts.get(name);
      if (!file) {
        // tệp đích không có bố cục cùng tên: chọn bố cục trống/chỉ có tiêu đề, và đặt nền slide theo bố cục gốc
        file = [...o.layouts.values()].find((f) => f) ?? "";
        for (const [, f] of o.layouts) {
          const head = (await dst.zip.file(f)!.async("string")).slice(0, 600);
          if (/\btype="(?:blank|titleOnly)"/.test(head)) {
            file = f;
            break;
          }
        }
        bg = /<p:bg>[\s\S]*?<\/p:bg>/.exec(await mini.zip.file(abs)!.async("string"))?.[0] ?? "";
      }
      out.push(relXml({ ...r, target: relativeTo("ppt/slides", file) }));
    } else if (r.type === T_NOTES) {
      notesText = await notesBodyText(mini.zip, abs);
    } else {
      const np = await copyPart(mini, dst, abs);
      out.push(relXml({ ...r, target: relativeTo("ppt/slides", np) }));
    }
  }
  if (bg && !/<p:bg>/.test(xml)) xml = xml.replace(/(<p:cSld\b[^>]*>)/, `$1${bg}`);
  const nextRid = () => `rId${Math.max(0, ...[...out.join("").matchAll(/\bId="rId(\d+)"/g)].map((m) => +m[1])) + 1}`;
  if (o.keepNotes) out.push(relXml({ id: nextRid(), type: T_NOTES, target: o.keepNotes, external: false }));
  if (o.withNotes && notesText) {
    const master = Object.keys(dst.zip.files).find((n) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(n));
    if (!master) warnings.push("Ghi chú người trình bày bị bỏ: tệp không có trang ghi chú mẫu.");
    else {
      const nf = uniq(dst, "ppt/notesSlides", "notesSlide", "xml");
      const miniNotes = parseRels(relsXml).find((r) => r.type === T_NOTES)!;
      dst.zip.file(nf, await mini.zip.file(resolveTarget(miniFile, miniNotes.target))!.async("string"));
      dst.zip.file(`ppt/notesSlides/_rels/${baseOf(nf)}.rels`, relsDoc([
        `<Relationship Id="rId1" Type="${T_NOTESMASTER}" Target="${relativeTo("ppt/notesSlides", master)}"/>`,
        `<Relationship Id="rId2" Type="${T_SLIDE}" Target="${relativeTo("ppt/notesSlides", destFile)}"/>`,
      ]));
      addOverride(dst, nf, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
      out.push(relXml({ id: nextRid(), type: T_NOTES, target: relativeTo("ppt/slides", nf), external: false }));
    }
  }
  dst.zip.file(destFile, xml);
  dst.zip.file(`ppt/slides/_rels/${baseOf(destFile)}.rels`, relsDoc(out));
  return warnings;
}

// ---------------------------------------------------------------- dựng bài nhỏ

export interface MiniDeck {
  pkg: Pkg;
  layouts: Map<string, string>;
  /** Tệp slide của phần nội dung thật (đã bỏ slide đệm), theo thứ tự. */
  files: string[];
  titles: string[];
  warnings: string[];
  /** Slide cuối của nội dung là slide “cảm ơn/hỏi đáp”. */
  endsClosing: boolean;
}

async function buildMini(markdown: string, deck: DeckStyle, images: Record<string, Uint8Array> | undefined, lead: boolean, trail: boolean): Promise<MiniDeck> {
  const body = markdown.replace(/^\s*---\s*\n/, "");
  const content = (lead ? "# .\n\n---\n\n" : "") + body + (trail ? "\n\n---\n\n# ." : "");
  const r = await createPptx({ content, auto: false, theme: deck.key, themeSpec: deck.spec, images });
  const zip = await loadZip(r.bytes);
  const order = await slideOrder(zip);
  const files = order.slice(lead ? 1 : 0, trail ? order.length - 1 : undefined);
  const titles = r.titles.slice(lead ? 1 : 0, trail ? r.titles.length - 1 : undefined);
  return { pkg: await openPkg(zip), layouts: await layoutNames(zip), files, titles, warnings: r.warnings, endsClosing: !trail };
}

/** Dựng các slide của `markdown` theo phong cách của tệp đích. Slide cuối là “cảm ơn” thì giữ dáng bìa kết thúc. */
export async function buildSlides(markdown: string, deck: DeckStyle, images?: Record<string, Uint8Array>): Promise<MiniDeck> {
  const specs = parseSlides(markdown.replace(/^\s*---\s*\n/, ""));
  const closingLast = specs.length > 0 && CLOSING_RE.test(specs[specs.length - 1].title);
  return buildMini(markdown, deck, images, true, !closingLast);
}

export type BodyKind = "cover" | "closing" | "section" | "quote" | "content";

/** Dựng lại MỘT slide với tiêu đề giữ nguyên và phần thân mới (mỗi dòng một ý). */
export async function buildBody(title: string, lines: string[], kind: BodyKind, deck: DeckStyle, images?: Record<string, Uint8Array>): Promise<MiniDeck> {
  const t = title.replace(/\n+/g, " ").trim();
  const plain = lines.map((l) => l.replace(/^\s*(?:[-*+•▪·–—]|\d+[.)])\s+/, "").trim());
  if (kind === "cover") return buildMini(`# ${t}\n${plain.join("\n")}`, deck, images, false, false);
  if (kind === "closing") return buildMini(`## ${t}\n${plain.join("\n")}`, deck, images, true, false);
  if (kind === "section") return buildMini(`## ${t}\n${plain.join("\n")}`, deck, images, true, true);
  if (kind === "quote") return buildMini(`## ${t}\n> ${plain[0] ?? ""}\n\n${plain.slice(1).join(" ")}`, deck, images, true, true);
  const items = lines.filter((l) => l.trim()).map((l) => {
    const indent = (/^[ \t]*/.exec(l)![0] ?? "").replace(/\t/g, "    ").length;
    return `${"  ".repeat(Math.min(3, Math.floor(indent / 2)))}- ${l.replace(/^\s*(?:[-*+•▪·–—]|\d+[.)])\s+/, "").trim()}`;
  });
  return buildMini(`## ${t}\n${items.join("\n")}`, deck, images, true, true);
}

// ---------------------------------------------------------------- sửa tại chỗ (tệp không do bộ dựng tạo)

/** Thay toàn bộ phần thân của slide ngay trên XML: giữ khung chữ thân và kiểu đoạn/run (gạch đầu dòng…), đoạn mới theo từng dòng. */
export function setBodyInPlace(xml: string, lines: string[]): string | null {
  const sps = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)];
  const cands = sps.filter((m) => /<p:txBody>/.test(m[0]) && !/<p:ph\b[^>]*\btype="(?:title|ctrTitle|sldNum|ftr|dt|hdr)"/.test(m[0]) && !/<p:cNvPr\b[^>]*\bname="deco"/.test(m[0]));
  if (!cands.length) return null;
  const textLen = (s: string) => [...s.matchAll(/<a:t>([^<]*)<\/a:t>/g)].reduce((n, t) => n + t[1].length, 0);
  const isBodyPh = (s: string) => /<p:ph\b(?![^>]*\btype="(?:title|ctrTitle)")[^>]*(?:\btype="(?:body|subTitle|obj)"|\bidx="1")/.test(s);
  const pick = cands.find((m) => isBodyPh(m[0])) ?? [...cands].sort((a, b) => textLen(b[0]) - textLen(a[0]))[0];
  const sp = pick[0];
  const paras = [...sp.matchAll(P_RE)].map((m) => m[0]);
  if (!paras.length) return null;
  const tpl = paras.find((p) => /<a:t>[^<]*\S/.test(p)) ?? paras[0];
  const mk = (line: string): string => {
    const indent = (/^[ \t]*/.exec(line)![0] ?? "").replace(/\t/g, "    ").length;
    const lvl = Math.min(4, Math.floor(indent / 2));
    const text = runsText(parseInline(line.replace(/^\s*(?:[-*+•▪·–—]|\d+[.)])\s+/, "").trim()));
    let p = cloneWithText(tpl, text);
    if (lvl > 0) {
      if (/^<a:p\b[^>]*>\s*<a:pPr\b/.test(p)) p = p.replace(/(<a:pPr\b)([^>]*?)(\/?>)/, (_m, a: string, b: string, c: string) => `${a}${b.replace(/\slvl="\d+"/, "")} lvl="${lvl}"${c}`);
      else p = p.replace(/^(<a:p\b[^>]*>)/, `$1<a:pPr lvl="${lvl}"/>`);
    }
    return p;
  };
  const items = lines.filter((l) => l.trim());
  if (!items.length) return null;
  const firstAt = sp.indexOf(paras[0]);
  const lastAt = sp.lastIndexOf(paras[paras.length - 1]) + paras[paras.length - 1].length;
  const rewritten = sp.slice(0, firstAt) + items.map(mk).join("") + sp.slice(lastAt);
  return xml.replace(sp, rewritten);
}
