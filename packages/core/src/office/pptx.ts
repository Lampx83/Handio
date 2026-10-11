/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandName } from "../brand";
import { loadZip, decodeXml } from "./docx-read";
import { slideOrder } from "./pptx-edit";
import { parseChart, type ChartSpec } from "./chart";
import { parseBlocks, runsText, type Block, type Run } from "./mdblocks";

export interface PptxOptions {
  /** Markdown: các slide ngăn cách bằng dòng `---`. Slide đầu `# Tiêu đề` + dòng phụ = slide bìa. Dòng "Ghi chú: …" = ghi chú người trình bày. */
  content: string;
  /** Tên hiển thị ở chân slide (mặc định rỗng). */
  footer?: string;
  /** Chủ đề màu: xanh (mặc định), ngoc, xanhla, cam, tim, do, den. */
  theme?: string;
  /** Ảnh dùng trong `![mô tả](đường-dẫn)`: khoá = đúng chuỗi đường dẫn trong Markdown, giá trị = byte tệp ảnh (png/jpg/gif). */
  images?: Record<string, Uint8Array>;
}

// ---------------------------------------------------------------- chủ đề màu

interface Theme { primary: string; dark: string; accent: string; tint: string; text: string; muted: string; line: string }

export const PPTX_THEMES: Record<string, Theme> = {
  xanh: { primary: "0B4A9E", dark: "082F63", accent: "F2B134", tint: "EEF3FB", text: "1F2937", muted: "5B6472", line: "D9E1EE" },
  ngoc: { primary: "0F766E", dark: "0B4F4A", accent: "F59E0B", tint: "E9F6F4", text: "1F2937", muted: "56656A", line: "D3E6E3" },
  xanhla: { primary: "2F7D32", dark: "1B4D1E", accent: "F4B400", tint: "EDF6EC", text: "1F2937", muted: "5A6558", line: "D5E6D4" },
  cam: { primary: "D9480F", dark: "7A2A08", accent: "1F7A8C", tint: "FFF3EA", text: "1F2937", muted: "6B5E55", line: "F1DACB" },
  tim: { primary: "5B34B8", dark: "34206B", accent: "F59E0B", tint: "F1ECFB", text: "1F2937", muted: "5F5A6E", line: "DDD4F2" },
  do: { primary: "B42318", dark: "5E1410", accent: "F2B134", tint: "FDEEEC", text: "1F2937", muted: "6B5958", line: "F1D3D0" },
  den: { primary: "1F2937", dark: "0B0F19", accent: "F2B134", tint: "F3F4F6", text: "111827", muted: "6B7280", line: "E1E4EA" },
};
const THEME_ALIASES: Record<string, string> = {
  blue: "xanh", navy: "xanh", neu: "xanh", "xanh duong": "xanh", mac_dinh: "xanh", default: "xanh",
  teal: "ngoc", "xanh ngoc": "ngoc", green: "xanhla", "xanh la": "xanhla", la: "xanhla",
  orange: "cam", purple: "tim", violet: "tim", red: "do", black: "den", dark: "den", "den vang": "den",
};

export function pickTheme(name?: string): { key: string; theme: Theme; known: boolean } {
  const n = (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().trim();
  const key = PPTX_THEMES[n] ? n : THEME_ALIASES[n];
  return key ? { key, theme: PPTX_THEMES[key], known: true } : { key: "xanh", theme: PPTX_THEMES.xanh, known: !n };
}

/** Trộn màu hex với trắng (amt 0..1). */
function tintOf(hex: string, amt: number): string {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return c.map((v) => Math.round(v + (255 - v) * amt).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Màu chữ dễ đọc trên nền `hex` (trắng hoặc xanh đen). */
function onColor(hex: string, dark = "111827"): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? dark : "FFFFFF";
}

// ---------------------------------------------------------------- phân tích

type SlideBlock = Block | { t: "image"; alt: string; src: string };

interface SlideSpec {
  title: string;
  blocks: SlideBlock[];
  notes: string;
  cover: boolean;
}

const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

export function parseSlides(content: string): SlideSpec[] {
  const blocks = parseBlocks(content);
  const groups: Block[][] = [[]];
  for (const b of blocks) {
    if (b.t === "hr") groups.push([]);
    else groups[groups.length - 1].push(b);
  }
  return groups
    .filter((g) => g.length)
    .map((g, idx) => {
      const hi = g.findIndex((b) => b.t === "heading");
      const title = hi >= 0 ? runsText((g[hi] as Extract<Block, { t: "heading" }>).runs) : "";
      const body = hi >= 0 ? [...g.slice(0, hi), ...g.slice(hi + 1)] : g;
      let notes = "";
      const rest: SlideBlock[] = [];
      for (const b of body) {
        if (b.t === "para") {
          const txt = runsText(b.runs).trim();
          const m = /^(ghi chú|notes?|speaker notes?)\s*[:：]\s*([\s\S]*)$/i.exec(txt);
          if (m) {
            notes += (notes ? "\n" : "") + m[2];
            continue;
          }
          const im = IMG_RE.exec(txt);
          if (im) {
            rest.push({ t: "image", alt: im[1], src: im[2] });
            continue;
          }
        }
        rest.push(b);
      }
      const cover = idx === 0 && hi >= 0 && (g[hi] as Extract<Block, { t: "heading" }>).level === 1 && rest.every((b) => b.t === "para");
      return { title, blocks: rest, notes, cover };
    });
}

/** Đường dẫn ảnh được dùng trong nội dung (để công cụ đọc tệp trước khi dựng). */
export function pptxImageRefs(content: string): string[] {
  return [...new Set(parseSlides(content).flatMap((s) => s.blocks.filter((b): b is Extract<SlideBlock, { t: "image" }> => b.t === "image").map((b) => b.src)))];
}

// ---------------------------------------------------------------- dựng

const FONT = "Calibri";
const SW = 13.33;
const MX = 0.7;
const CW = SW - 2 * MX;
const TOP = 1.8;
const BOTTOM = 6.8;

const cplOf = (w: number, fs: number) => Math.max(8, Math.floor((w * 72) / (fs * 0.48)));
const linesOf = (text: string, w: number, fs: number) => Math.max(1, Math.ceil(text.length / cplOf(w, fs)));
const lhOf = (fs: number) => (fs * 1.32) / 72;

const textOfRuns = (runs: Run[], color?: string) => runs.map((r) => ({ text: r.text, options: { bold: r.bold, italic: r.italic, color, fontFace: r.code ? "Consolas" : undefined, hyperlink: r.link ? { url: r.link } : undefined } }));

/** "Nhãn: mô tả" / "**Nhãn** mô tả". */
function splitLabel(runs: Run[]): { label: string; rest: string } | null {
  const text = runsText(runs).trim();
  if (runs[0]?.bold && runs.length > 1) {
    const label = runs[0].text.trim().replace(/[:：]$/, "").trim();
    const rest = runs.slice(1).map((r) => r.text).join("").replace(/^\s*[:：–—-]?\s*/, "").trim();
    if (label.length >= 2 && label.length <= 42 && rest) return { label, rest };
  }
  const m = /^(.{2,42}?)\s*(?::|：|\s[–—-]\s)\s*(\S[\s\S]*)$/.exec(text);
  return m ? { label: m[1].trim(), rest: m[2].trim() } : null;
}

/** "85%: hài lòng" / "**1.200** sinh viên" → số lớn + chú thích. */
function splitStat(runs: Run[]): { num: string; rest: string } | null {
  const text = runsText(runs).trim();
  const num = /^([+\-−~≈]?\d[\d.,]*(?:\/\d+)?\s?(?:%|‰|tr|tỷ|triệu|nghìn|k|m|[a-zA-ZÀ-ỹ]{1,3}(?![a-zA-ZÀ-ỹ]))?)/;
  if (runs[0]?.bold && runs.length > 1 && /^[+\-−~≈]?\d[\d.,]*(?:\/\d+)?\s?[%‰\w]{0,6}$/.test(runs[0].text.trim())) {
    return { num: runs[0].text.trim(), rest: runs.slice(1).map((r) => r.text).join("").replace(/^\s*[:：–—|-]?\s*/, "").trim() };
  }
  const m = new RegExp(num.source + String.raw`\s*(?::|：|\||\s[–—-]\s|–|—)\s*(\S[\s\S]*)$`).exec(text);
  return m && m[1] ? { num: m[1].trim(), rest: m[2].trim() } : null;
}

function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  return null;
}
const b64 = (b: Uint8Array) => (typeof Buffer !== "undefined" ? Buffer.from(b).toString("base64") : btoa(String.fromCharCode(...b)));

export async function createPptx(o: PptxOptions): Promise<{ bytes: Uint8Array; slides: number; warnings: string[] }> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = brandName();
  const specs = parseSlides(o.content);
  if (!specs.length) throw new Error("Nội dung trống: cần ít nhất một slide.");
  const warnings: string[] = [];
  const picked = pickTheme(o.theme);
  if (!picked.known) warnings.push(`Chủ đề “${o.theme}” không có; đã dùng “xanh”. Chủ đề có sẵn: ${Object.keys(PPTX_THEMES).join(", ")}.`);
  const t = picked.theme;
  const soft = tintOf(t.primary, 0.78);

  const footerObj = (color: string) => (o.footer ? [{ text: { text: o.footer, options: { x: MX, y: 7.0, w: 8, h: 0.3, fontSize: 11, color, fontFace: FONT } } }] : []);
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 7.0, w: SW, h: 0.012, fill: { color: t.line } } },
      { rect: { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: t.primary } } },
      ...footerObj(t.muted),
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.55, w: CW, h: 1.0, fontFace: FONT, fontSize: 30, bold: true, color: t.dark, valign: "middle", align: "left", margin: 0, fit: "shrink" }, text: "" } },
    ],
    slideNumber: { x: 12.2, y: 7.03, w: 0.6, h: 0.3, fontSize: 11, color: t.muted, fontFace: FONT, align: "right" },
  });
  pptx.defineSlideMaster({
    title: "COVER",
    background: { color: t.dark },
    objects: [
      ...footerObj(tintOf(t.dark, 0.55)),
      { placeholder: { options: { name: "title", type: "title", x: 0.9, y: 1.9, w: 7.6, h: 2.5, fontFace: FONT, fontSize: 44, bold: true, color: "FFFFFF", valign: "bottom", align: "left", margin: 0, fit: "shrink" }, text: "" } },
    ],
  });
  pptx.defineSlideMaster({
    title: "SECTION",
    background: { color: t.primary },
    objects: [
      ...footerObj(tintOf(t.primary, 0.6)),
      { placeholder: { options: { name: "title", type: "title", x: 0.9, y: 2.6, w: 9.4, h: 1.7, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", valign: "middle", align: "left", margin: 0, fit: "shrink" }, text: "" } },
    ],
  });
  pptx.defineSlideMaster({
    title: "QUOTE",
    background: { color: t.tint },
    objects: [
      { rect: { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: t.accent } } },
      ...footerObj(t.muted),
    ],
    slideNumber: { x: 12.2, y: 7.03, w: 0.6, h: 0.3, fontSize: 11, color: t.muted, fontFace: FONT, align: "right" },
  });

  const shapes = pptx.ShapeType ?? {};
  const RECT = shapes.rect ?? "rect";
  const ROUND = shapes.roundRect ?? "roundRect";
  const OVAL = shapes.ellipse ?? "ellipse";

  const card = (slide: any, x: number, y: number, w: number, h: number, fill = "FFFFFF", line: string | null = t.line) =>
    slide.addShape(ROUND, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { color: fill, width: 0 } });

  // ---- khối nội dung xếp dọc; slide = null → chỉ đo chiều cao
  function stack(slide: any | null, blocks: SlideBlock[], x: number, y0: number, w: number, fs: number, idx: number): number {
    let y = y0;
    for (const b of blocks) {
      if (b.t === "list") {
        for (const it of b.items) {
          const indent = it.level * 0.45;
          const size = Math.max(12, fs - it.level * 2);
          const tw = w - 0.4 - indent;
          const text = runsText(it.runs);
          const lh = lhOf(size);
          const h = linesOf(text, tw, size) * lh;
          if (slide) {
            if (it.ordered) {
              const n = b.items.slice(0, b.items.indexOf(it) + 1).filter((z) => z.ordered && z.level === it.level).length;
              slide.addShape(OVAL, { x: x + indent, y: y + (lh - 0.32) / 2 + 0.02, w: 0.32, h: 0.32, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
              slide.addText(String(n), { x: x + indent, y: y + (lh - 0.32) / 2 + 0.02, w: 0.32, h: 0.32, fontFace: FONT, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
            } else if (it.level === 0) slide.addShape(OVAL, { x: x + 0.04, y: y + lh / 2 - 0.06, w: 0.13, h: 0.13, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
            else slide.addShape(RECT, { x: x + indent + 0.02, y: y + lh / 2 - 0.02, w: 0.16, h: 0.04, fill: { color: t.muted }, line: { color: t.muted, width: 0 } });
            slide.addText(textOfRuns(it.runs, t.text) as any, { x: x + 0.4 + indent, y, w: tw, h: h + 0.02, fontFace: FONT, fontSize: size, color: t.text, valign: "top", margin: 0, fit: "shrink" });
          }
          y += h + 0.17;
        }
        y += 0.05;
      } else if (b.t === "para" || b.t === "quote") {
        const text = runsText(b.runs);
        const quote = b.t === "quote";
        const tw = w - (quote ? 0.35 : 0);
        const h = linesOf(text, tw, fs) * lhOf(fs);
        if (slide) {
          if (quote) slide.addShape(RECT, { x, y, w: 0.07, h: h + 0.02, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
          slide.addText(textOfRuns(b.runs, quote ? t.muted : t.text) as any, { x: x + (quote ? 0.3 : 0), y, w: tw, h: h + 0.02, fontFace: FONT, fontSize: fs, color: quote ? t.muted : t.text, italic: quote, align: b.t === "para" && b.align && b.align !== "justify" ? b.align : "left", valign: "top", margin: 0, fit: "shrink" });
        }
        y += h + 0.2;
      } else if (b.t === "code" && b.lang === "chart") {
        const h = Math.min(4.2, Math.max(2.6, BOTTOM - y));
        if (slide) {
          const spec = parseChart(b.text, b.info ?? "");
          if ("error" in spec) {
            warnings.push(`Slide ${idx + 1}: biểu đồ lỗi — ${spec.error}.`);
            slide.addText(`[Biểu đồ không tạo được: ${spec.error}]`, { x, y, w, h: 0.5, fontFace: FONT, fontSize: 14, color: "B00020" });
          } else {
            card(slide, x, y, w, h);
            addChart(pptx, slide, spec, x + 0.15, y + 0.1, w - 0.3, h - 0.2, t);
          }
        }
        y += h + 0.15;
      } else if (b.t === "code") {
        const size = Math.max(11, fs - 6);
        const lines = b.text.split("\n").length;
        const h = lines * lhOf(size) + 0.3;
        if (slide) {
          slide.addShape(ROUND, { x, y, w, h, rectRadius: 0.05, fill: { color: "0F172A" }, line: { color: "0F172A", width: 0 } });
          slide.addText(b.text, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: h - 0.24, fontFace: "Consolas", fontSize: size, color: "E2E8F0", valign: "top", margin: 0, fit: "shrink" });
        }
        y += h + 0.15;
      } else if (b.t === "table") {
        const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length), 1);
        const size = Math.max(12, Math.min(20, fs - 2));
        const len = (i: number) => Math.max(4, ...[b.header[i], ...b.rows.map((r) => r[i])].map((c) => (c ? runsText(c).length : 0)));
        const weights = Array.from({ length: cols }, (_, i) => Math.min(40, Math.max(5, len(i))));
        const sum = weights.reduce((s, v) => s + v, 0);
        const colW = weights.map((v) => (w * v) / sum);
        const rowLines = (r: Run[][]) => Math.max(1, ...Array.from({ length: cols }, (_, i) => linesOf(r[i] ? runsText(r[i]) : "", colW[i] - 0.2, size)));
        const rowH = (r: Run[][]) => rowLines(r) * lhOf(size) + 0.2;
        const heights = [rowH(b.header), ...b.rows.map(rowH)];
        const total = heights.reduce((s, v) => s + v, 0);
        if (slide) {
          const pad = (row: Run[][]) => Array.from({ length: cols }, (_, i) => row[i] ?? [{ text: "" }]);
          const cell = (runs: Run[], head: boolean, i: number, r: number) => ({
            text: runsText(runs),
            options: { bold: head || runs.some((q) => q.bold) || i === 0, color: head ? "FFFFFF" : t.text, fill: { color: head ? t.primary : r % 2 ? t.tint : "FFFFFF" }, align: head ? "center" : b.align[i] ?? "left", valign: "middle", fontSize: size, fontFace: FONT },
          });
          const rows = [pad(b.header).map((c, i) => cell(c, true, i, 0)), ...b.rows.map((r, k) => pad(r).map((c, i) => cell(c, false, i, k + 1)))];
          slide.addTable(rows as any, { x, y, w, colW, rowH: heights, border: { type: "solid", pt: 0.75, color: t.line }, margin: [0.04, 0.1, 0.04, 0.1] } as any);
        }
        y += total + 0.2;
      } else if (b.t === "image") {
        const h = Math.min(4.2, Math.max(2.4, BOTTOM - y));
        if (slide) addPic(slide, b, x, y, w, h);
        y += h + 0.15;
      }
    }
    return y - y0;
  }

  const addPic = (slide: any, b: Extract<SlideBlock, { t: "image" }>, x: number, y: number, w: number, h: number) => {
    const data = o.images?.[b.src];
    const mime = data ? imageMime(data) : null;
    if (!data || !mime) {
      warnings.push(data ? `Ảnh “${b.src}” không đọc được (chỉ nhận png, jpg, gif).` : `Không tìm thấy ảnh “${b.src}” trong thư mục dự án.`);
      card(slide, x, y, w, h, t.tint, t.line);
      slide.addText(`[Ảnh: ${b.alt || b.src}]`, { x, y, w, h, fontFace: FONT, fontSize: 16, color: t.muted, align: "center", valign: "middle" });
      return;
    }
    slide.addImage({ data: `${mime};base64,${b64(data)}`, x, y, w, h, sizing: { type: "contain", w, h }, altText: b.alt || undefined });
  };

  const fitSize = (blocks: SlideBlock[], w: number, avail: number, max = 26): number => {
    let fs = max;
    while (fs > 14 && stack(null, blocks, 0, 0, w, fs, 0) > avail) fs -= 2;
    return fs;
  };

  const titleOn = (slide: any, text: string, long = 56) => slide.addText(text, { placeholder: "title", ...(text.length > long ? { fontSize: 24 } : {}) });

  specs.forEach((sp, idx) => {
    const last = idx === specs.length - 1;
    const only = sp.blocks.filter((b) => b.t !== "image");
    const lists = sp.blocks.filter((b): b is Extract<Block, { t: "list" }> => b.t === "list");
    const paras = sp.blocks.filter((b): b is Extract<Block, { t: "para" }> => b.t === "para");
    const paraText = paras.map((b) => runsText(b.runs)).join("\n");
    let slide: any;

    if (sp.cover) {
      slide = pptx.addSlide({ masterName: "COVER" });
      slide.addShape(OVAL, { x: 8.6, y: -1.6, w: 7.4, h: 7.4, fill: { color: t.primary, transparency: 30 }, line: { color: t.primary, width: 0 } });
      slide.addShape(OVAL, { x: 10.6, y: 3.9, w: 4.4, h: 4.4, fill: { color: t.dark, transparency: 100 }, line: { color: t.accent, width: 1.5, transparency: 35 } });
      slide.addShape(OVAL, { x: 11.4, y: 1.0, w: 0.34, h: 0.34, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      slide.addShape(RECT, { x: 0.9, y: 4.65, w: 1.4, h: 0.08, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      titleOn(slide, sp.title, 38);
      if (paraText) slide.addText(paraText, { x: 0.9, y: 4.95, w: 7.4, h: 1.5, fontFace: FONT, fontSize: 20, color: tintOf(t.dark, 0.8), valign: "top", margin: 0, fit: "shrink" });
    } else if (!sp.blocks.length || (!lists.length && !sp.blocks.some((b) => b.t === "table" || b.t === "code" || b.t === "quote" || b.t === "image") && paras.length <= 1 && paraText.length <= 160)) {
      // mở đầu phần / kết thúc: chỉ có tiêu đề và tối đa một dòng phụ
      const closing = last && idx > 0;
      slide = pptx.addSlide({ masterName: closing ? "COVER" : "SECTION" });
      const num = /^(\d{1,2})\s*[.)\-:]\s+/.exec(sp.title);
      slide.addShape(OVAL, { x: 9.8, y: 3.6, w: 6.2, h: 6.2, fill: { color: closing ? t.primary : t.dark, transparency: closing ? 35 : 55 }, line: { color: t.dark, width: 0 } });
      if (num && !closing) {
        slide.addText(num[1].padStart(2, "0"), { x: 0.9, y: 1.55, w: 4, h: 1.1, fontFace: FONT, fontSize: 60, bold: true, color: tintOf(t.primary, 0.72), margin: 0, valign: "middle" });
        slide.addText(sp.title.slice(num[0].length), { placeholder: "title" });
      } else {
        slide.addShape(RECT, { x: 0.9, y: closing ? 4.65 : 2.35, w: 1.4, h: 0.08, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
        titleOn(slide, sp.title, 40);
      }
      if (paraText) slide.addText(paraText, { x: 0.9, y: closing ? 4.95 : 4.5, w: 8.6, h: 1.4, fontFace: FONT, fontSize: 20, color: tintOf(closing ? t.dark : t.primary, 0.8), valign: "top", margin: 0, fit: "shrink" });
    } else if (only.length >= 1 && only[0].t === "quote" && only.length <= 2 && only.slice(1).every((b) => b.t === "para")) {
      slide = pptx.addSlide({ masterName: "QUOTE" });
      const q = only[0] as Extract<Block, { t: "quote" }>;
      slide.addText("“", { x: 0.9, y: 0.5, w: 2, h: 1.8, fontFace: "Georgia", fontSize: 130, bold: true, color: t.accent, margin: 0, valign: "top" });
      if (sp.title) slide.addText(sp.title.toUpperCase(), { x: 2.7, y: 0.75, w: 9.5, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: t.primary, charSpacing: 3, margin: 0 });
      const qs = runsText(q.runs).length > 220 ? 26 : runsText(q.runs).length > 110 ? 30 : 36;
      slide.addText(textOfRuns(q.runs, t.dark) as any, { x: 1.4, y: 1.9, w: 10.6, h: 3.6, fontFace: "Georgia", fontSize: qs, italic: true, color: t.dark, valign: "middle", margin: 0, fit: "shrink" });
      if (only[1]) slide.addText("— " + runsText((only[1] as Extract<Block, { t: "para" }>).runs), { x: 1.4, y: 5.45, w: 10.6, h: 0.6, fontFace: FONT, fontSize: 18, color: t.muted, margin: 0 });
    } else {
      slide = pptx.addSlide({ masterName: "CONTENT" });
      if (sp.title) titleOn(slide, sp.title);
      const oneList = lists.length === 1 && only.length === 1 ? lists[0] : null;
      const flat = oneList && oneList.items.every((i) => i.level === 0);
      const n = oneList?.items.length ?? 0;
      const stats = flat && n >= 2 && n <= 4 ? oneList!.items.map((i) => splitStat(i.runs)) : null;
      const labelled = flat && n >= 3 && n <= 6 ? oneList!.items.map((i) => splitLabel(i.runs)) : null;
      const process = flat && oneList!.items[0].ordered && n >= 3 && n <= 5 && oneList!.items.every((i) => runsText(i.runs).length <= 110);
      const vis = sp.blocks.filter((b) => (b.t === "code" && b.lang === "chart") || b.t === "image" || (b.t === "table" && Math.max(b.header.length) <= 3));
      const textual = sp.blocks.filter((b) => b.t === "list" || b.t === "para" || b.t === "quote");

      if (stats && stats.every(Boolean)) {
        const gap = 0.3;
        const cw = (CW - gap * (n - 1)) / n;
        stats.forEach((s, i) => {
          const x = MX + i * (cw + gap);
          card(slide, x, 2.1, cw, 3.3, t.tint, t.line);
          slide.addShape(RECT, { x, y: 2.1, w: cw, h: 0.1, fill: { color: i % 2 ? t.accent : t.primary }, line: { color: t.primary, width: 0 } });
          slide.addText(s!.num, { x: x + 0.2, y: 2.5, w: cw - 0.4, h: 1.3, fontFace: FONT, fontSize: s!.num.length > 7 ? 38 : 54, bold: true, color: t.primary, align: "center", valign: "middle", margin: 0, fit: "shrink" });
          slide.addText(s!.rest, { x: x + 0.25, y: 3.85, w: cw - 0.5, h: 1.3, fontFace: FONT, fontSize: 18, color: t.text, align: "center", valign: "top", margin: 0, fit: "shrink" });
        });
      } else if (process) {
        const items = oneList!.items;
        const gap = 0.25;
        const cw = (CW - gap * (n - 1)) / n;
        slide.addShape(RECT, { x: MX + cw / 2, y: 2.62, w: CW - cw, h: 0.04, fill: { color: t.line }, line: { color: t.line, width: 0 } });
        items.forEach((it, i) => {
          const x = MX + i * (cw + gap);
          const lab = splitLabel(it.runs);
          slide.addShape(OVAL, { x: x + cw / 2 - 0.4, y: 2.24, w: 0.8, h: 0.8, fill: { color: i === n - 1 ? t.accent : t.primary }, line: { color: "FFFFFF", width: 3 } });
          slide.addText(String(i + 1), { x: x + cw / 2 - 0.4, y: 2.24, w: 0.8, h: 0.8, fontFace: FONT, fontSize: 24, bold: true, color: i === n - 1 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0 });
          slide.addText(lab ? lab.label : runsText(it.runs), { x, y: 3.3, w: cw, h: 0.7, fontFace: FONT, fontSize: 19, bold: true, color: t.dark, align: "center", valign: "top", margin: 0, fit: "shrink" });
          if (lab) slide.addText(lab.rest, { x: x + 0.05, y: 4.05, w: cw - 0.1, h: 2.2, fontFace: FONT, fontSize: 17, color: t.text, align: "center", valign: "top", margin: 0, fit: "shrink" });
        });
      } else if (labelled && labelled.filter(Boolean).length >= Math.ceil(n * 0.7)) {
        const cols = n === 4 ? 2 : Math.min(3, n);
        const rows = Math.ceil(n / cols);
        const gap = 0.28;
        const cw = (CW - gap * (cols - 1)) / cols;
        const ch = Math.min(2.6, (BOTTOM - TOP - gap * (rows - 1)) / rows);
        oneList!.items.forEach((it, i) => {
          const lab = labelled[i] ?? { label: "", rest: runsText(it.runs) };
          const x = MX + (i % cols) * (cw + gap);
          const y = TOP + 0.05 + Math.floor(i / cols) * (ch + gap);
          card(slide, x, y, cw, ch);
          slide.addShape(RECT, { x, y, w: 0.09, h: ch, fill: { color: i % 2 ? t.accent : t.primary }, line: { color: t.primary, width: 0 } });
          slide.addShape(OVAL, { x: x + 0.3, y: y + 0.22, w: 0.46, h: 0.46, fill: { color: i % 2 ? t.accent : t.primary }, line: { color: t.primary, width: 0 } });
          slide.addText(String(i + 1), { x: x + 0.3, y: y + 0.22, w: 0.46, h: 0.46, fontFace: FONT, fontSize: 16, bold: true, color: i % 2 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0 });
          slide.addText(lab.label || runsText(it.runs), { x: x + 0.9, y: y + 0.18, w: cw - 1.1, h: 0.56, fontFace: FONT, fontSize: 19, bold: true, color: t.dark, valign: "middle", margin: 0, fit: "shrink" });
          if (lab.label) slide.addText(lab.rest, { x: x + 0.3, y: y + 0.9, w: cw - 0.5, h: ch - 1.05, fontFace: FONT, fontSize: lab.rest.length > 150 ? 15 : lab.rest.length > 90 ? 17 : 19, color: t.text, valign: "top", margin: 0, fit: "shrink" });
        });
      } else if (vis.length === 1 && textual.length >= 1 && sp.blocks.length === textual.length + 1) {
        // chữ bên trái, hình/biểu đồ/bảng nhỏ bên phải
        const lw = 5.5;
        const rx = MX + lw + 0.4;
        const rw = SW - MX - rx;
        const avail = BOTTOM - TOP;
        const fs = fitSize(textual, lw, avail, 24);
        const h = stack(null, textual, 0, 0, lw, fs, idx);
        if (h > avail) warnings.push(`Slide ${idx + 1}${sp.title ? ` “${sp.title}”` : ""}: nhiều nội dung, có thể bị tràn — nên tách thành 2 slide.`);
        stack(slide, textual, MX, TOP + 0.05, lw, fs, idx);
        const v = vis[0];
        if (v.t === "image") addPic(slide, v, rx, TOP, rw, avail - 0.1);
        else if (v.t === "table") stack(slide, [v], rx, TOP + 0.05, rw, 18, idx);
        else {
          const spec = v.t === "code" ? parseChart(v.text, v.info ?? "") : { error: "?" };
          if ("error" in spec) warnings.push(`Slide ${idx + 1}: biểu đồ lỗi — ${spec.error}.`);
          else {
            card(slide, rx, TOP, rw, avail - 0.1);
            addChart(pptx, slide, spec, rx + 0.15, TOP + 0.1, rw - 0.3, avail - 0.3, t);
          }
        }
      } else {
        const avail = BOTTOM - TOP;
        const sparse = sp.blocks.length === 1 && lists.length === 1 && lists[0].items.length <= 3;
        const fs = fitSize(sp.blocks, CW, avail, sparse ? 32 : 26);
        const h = stack(null, sp.blocks, 0, 0, CW, fs, idx);
        if (h > avail + 0.15) warnings.push(`Slide ${idx + 1}${sp.title ? ` “${sp.title}”` : ""}: nhiều nội dung, có thể bị tràn — nên tách thành 2 slide.`);
        stack(slide, sp.blocks, MX, TOP + 0.05, CW, fs, idx);
      }
    }
    if (sp.notes) slide.addNotes(sp.notes);
  });
  const out: any = await pptx.write({ outputType: "uint8array" });
  return { bytes: out instanceof Uint8Array ? out : new Uint8Array(out), slides: specs.length, warnings };
}

function addChart(pptx: any, slide: any, c: ChartSpec, x: number, y: number, w: number, h: number, t: Theme): void {
  const colors = [t.primary, t.accent, "2E9E6B", "C8442F", "7A5BB5", "4FA3C7"];
  const T = pptx.charts;
  const type = c.kind === "line" ? T.LINE : c.kind === "pie" ? T.PIE : c.kind === "doughnut" ? T.DOUGHNUT : c.kind === "area" ? T.AREA : T.BAR;
  const pie = c.kind === "pie" || c.kind === "doughnut";
  const data = (pie ? c.series.slice(0, 1) : c.series).map((s) => ({ name: s.name, labels: c.labels, values: s.values }));
  slide.addChart(type, data, {
    x, y, w, h, fontFace: FONT, chartColors: pie ? c.labels.map((_l, i) => colors[i % colors.length]) : colors.slice(0, data.length),
    showTitle: !!c.title, title: c.title, titleFontSize: 16, titleColor: t.dark,
    showLegend: pie || data.length > 1, legendPos: "b", legendFontSize: 12, legendColor: t.text,
    showValue: c.labels.length <= 12, dataLabelFontSize: 11, dataLabelColor: t.text, dataLabelFormatCode: "#,##0.##",
    catAxisLabelFontSize: 12, catAxisLabelColor: t.text, valAxisLabelFontSize: 11, valAxisLabelColor: t.muted, valGridLine: { color: t.line, size: 0.5 },
    ...(c.kind === "barh" ? { barDir: "bar" } : c.kind === "bar" ? { barDir: "col" } : {}),
  });
}

export function describePptx(content: string): string {
  const specs = parseSlides(content);
  return `Bài trình chiếu ${specs.length} slide:\n` + specs.map((s, i) => `  ${i + 1}. ${s.title || "(không tiêu đề)"}${s.cover ? " [bìa]" : ""}${s.notes ? " 🗒" : ""}${s.blocks.some((b) => b.t === "code" && b.lang === "chart") ? " 📊" : ""}`).slice(0, 25).join("\n");
}

// ---------------------------------------------------------------- đọc

const paraTexts = (xml: string): string[] => [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\s[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => {
  const inner = m[1] ?? m[2] ?? "";
  const text = [...inner.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>/g)].map((t) => (t[0] === "<a:br/>" ? "\n" : decodeXml(t[1]))).join("");
  const bullet = /<a:buChar|<a:buAutoNum/.test(inner) || /<a:pPr[^>]*\slvl="[1-9]"/.test(inner);
  const lvl = +(/<a:pPr[^>]*\slvl="(\d)"/.exec(inner)?.[1] ?? 0);
  return text.trim() ? (bullet ? "  ".repeat(lvl) + "- " : "") + text : "";
}).filter(Boolean);

/** Tóm tắt biểu đồ trong tệp pptx: loại, tiêu đề, nhãn và số liệu từng chuỗi (để đọc lại kiểm tra được). */
function chartText(xml: string): string {
  const kind = /<c:(bar|line|pie|doughnut|area)Chart\b/.exec(xml)?.[1] ?? "?";
  const dir = /<c:barDir val="(bar|col)"/.exec(xml)?.[1];
  const title = [...(/<c:title>([\s\S]*?)<\/c:title>/.exec(xml)?.[1] ?? "").matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join("");
  const vals = (s: string) => [...s.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map((v) => decodeXml(v[1]));
  const sers = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => ({ name: vals(/<c:tx>([\s\S]*?)<\/c:tx>/.exec(m[1])?.[1] ?? "").join(""), cat: vals(/<c:cat>([\s\S]*?)<\/c:cat>/.exec(m[1])?.[1] ?? ""), val: vals(/<c:val>([\s\S]*?)<\/c:val>/.exec(m[1])?.[1] ?? "") }));
  const label = { bar: dir === "bar" ? "ngang" : "cột", line: "đường", pie: "tròn", doughnut: "vành", area: "vùng" }[kind] ?? kind;
  return `[Biểu đồ ${label}${title ? ` “${title}”` : ""}] ` + (sers[0] ? `Nhãn: ${sers[0].cat.join(", ")}. ` : "") + sers.map((s) => `${s.name || "Chuỗi"}: ${s.val.join(", ")}`).join(" | ");
}

export async function readPptx(bytes: Uint8Array): Promise<{ label: string; text: string }[]> {
  const zip = await loadZip(bytes);
  const slideNames = await slideOrder(zip); // đúng thứ tự trình chiếu (presentation.xml), không phải thứ tự tên tệp
  const out: { label: string; text: string }[] = [];
  for (const [i, name] of slideNames.entries()) {
    const xml = await zip.file(name)!.async("string");
    let title = "";
    const lines: string[] = [];
    const slideRels = (await zip.file(`ppt/slides/_rels/${name.split("/").pop()}.rels`)?.async("string")) ?? "";
    for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>|<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g)) {
      const sp = m[0];
      if (sp.startsWith("<p:graphicFrame")) {
        const rid = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(sp)?.[1];
        if (rid) {
          const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`).exec(slideRels);
          const file = (target?.[1] ?? target?.[2] ?? "").replace(/^\/+/, "").replace(/^\.\.\//, "ppt/");
          const cx = file ? await zip.file(file)?.async("string") : undefined;
          if (cx) lines.push(chartText(cx));
          continue;
        }
        const rows = [...sp.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((r) => [...r[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((c) => paraTexts(c[0]).join(" ").replace(/\|/g, "\\|")));
        if (rows.length) {
          const cols = Math.max(...rows.map((r) => r.length));
          const pad = (r: string[]) => Array.from({ length: cols }, (_, k) => r[k] ?? "");
          lines.push("| " + pad(rows[0]).join(" | ") + " |", "|" + " --- |".repeat(cols), ...rows.slice(1).map((r) => "| " + pad(r).join(" | ") + " |"));
        }
        continue;
      }
      const texts = paraTexts(sp);
      if (!texts.length) continue;
      if (!title && /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp)) title = texts.join(" ");
      else lines.push(...texts);
    }
    let notes = "";
    const rels = await zip.file(`ppt/slides/_rels/${name.split("/").pop()}.rels`)?.async("string");
    const nt = rels && /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1];
    if (nt) {
      const nx = await zip.file("ppt/notesSlides/" + nt)?.async("string");
      if (nx) notes = [...nx.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].filter((m) => /type="body"/.test(m[0])).flatMap((m) => paraTexts(m[0])).join("\n");
    }
    out.push({ label: `Slide ${i + 1}${title ? ": " + title : ""}`, text: lines.join("\n") + (notes ? `\n[Ghi chú người trình bày] ${notes}` : "") });
  }
  return out;
}
