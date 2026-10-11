/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandName } from "../brand";
import { loadZip, decodeXml } from "./docx-read";
import { slideOrder } from "./pptx-zip";
import { parseChart, type ChartSpec } from "./chart";
import { parseBlocks, parseInline, runsText, type Block, type Run } from "./mdblocks";

export interface PptxOptions {
  /** Markdown: các slide ngăn cách bằng dòng `---`. Slide đầu `# Tiêu đề` + dòng phụ = slide bìa. Dòng "Ghi chú: …" = ghi chú người trình bày. */
  content: string;
  /** Tên hiển thị ở chân slide (mặc định rỗng). */
  footer?: string;
  /** Chủ đề màu: xanh (mặc định), ngoc, xanhla, cam, tim, do, den. */
  theme?: string;
  /** Tiêu đề bài (cho trang bìa tự thêm); bỏ trống thì lấy tiêu đề slide đầu. */
  title?: string;
  /** Dòng phụ trang bìa (đơn vị, người trình bày, ngày). */
  subtitle?: string;
  /** Tự thêm trang bìa, mục lục (từ 5 slide nội dung) và trang cảm ơn nếu bài chưa có; mặc định bật. */
  auto?: boolean;
  /** Ảnh dùng trong `![mô tả](đường-dẫn)`: khoá = đúng chuỗi đường dẫn trong Markdown, giá trị = byte tệp ảnh (png/jpg/gif). */
  images?: Record<string, Uint8Array>;
  /** Tổng số slide người dùng yêu cầu (gồm bìa và cảm ơn): bộ dựng ĐẠT ĐÚNG số này (gộp slide ngắn nếu nhiều, không tách slide, mục lục chỉ khi còn chỗ và từ 8 slide). */
  slideCount?: number;
  /** Bảng màu tự đặt (thay cho `theme`), dùng khi chèn slide vào tệp không do bộ dựng tạo. */
  themeSpec?: Theme;
}

// ---------------------------------------------------------------- chủ đề màu

export interface Theme { primary: string; dark: string; accent: string; tint: string; text: string; muted: string; line: string }

export const PPTX_THEMES: Record<string, Theme> = {
  xanh: { primary: "0B4A9E", dark: "082F63", accent: "F2B134", tint: "EEF3FB", text: "1F2937", muted: "5B6472", line: "D9E1EE" },
  ngoc: { primary: "0F766E", dark: "0B4F4A", accent: "F59E0B", tint: "E9F6F4", text: "1F2937", muted: "56656A", line: "D3E6E3" },
  xanhla: { primary: "2F7D32", dark: "1B4D1E", accent: "F4B400", tint: "EDF6EC", text: "1F2937", muted: "5A6558", line: "D5E6D4" },
  cam: { primary: "D9480F", dark: "7A2A08", accent: "1F7A8C", tint: "FFF3EA", text: "1F2937", muted: "6B5E55", line: "F1DACB" },
  tim: { primary: "5B34B8", dark: "34206B", accent: "F59E0B", tint: "F1ECFB", text: "1F2937", muted: "5F5A6E", line: "DDD4F2" },
  do: { primary: "B42318", dark: "5E1410", accent: "F2B134", tint: "FDEEEC", text: "1F2937", muted: "6B5958", line: "F1D3D0" },
  den: { primary: "1F2937", dark: "0B0F19", accent: "F2B134", tint: "F3F4F6", text: "111827", muted: "6B7280", line: "E1E4EA" },
  // bảng màu gợi ý trong skill pptx của Claude (chọn theo chủ đề, một màu chiếm ưu thế)
  midnight: { primary: "1E2761", dark: "121A44", accent: "7C9CF0", tint: "EEF2FD", text: "1F2937", muted: "5B6475", line: "D6DDF0" },
  rung: { primary: "2C5F2D", dark: "1C3F1D", accent: "97BC62", tint: "F1F6EA", text: "1F2937", muted: "5A6558", line: "DCE8CF" },
  sanho: { primary: "E8474D", dark: "2F3C7E", accent: "F2B134", tint: "FFF1F1", text: "1F2937", muted: "6B5E60", line: "F4D5D6" },
  datnung: { primary: "B85042", dark: "6E2E26", accent: "A7BEAE", tint: "F7EDEA", text: "1F2937", muted: "6B5E5A", line: "EBD7D2" },
  daiduong: { primary: "065A82", dark: "21295C", accent: "1C7293", tint: "E6F1F6", text: "1F2937", muted: "546574", line: "CFE2EC" },
  than: { primary: "36454F", dark: "212121", accent: "F2B134", tint: "F2F2F2", text: "212121", muted: "6B7280", line: "E0E0E0" },
  man: { primary: "6D2E46", dark: "40182B", accent: "A26769", tint: "F6EDEF", text: "1F2937", muted: "6B5A60", line: "EAD7DC" },
  sage: { primary: "50808E", dark: "2F4F5A", accent: "84B59F", tint: "EAF3F0", text: "1F2937", muted: "56656A", line: "D3E4DE" },
  cherry: { primary: "990011", dark: "5E000B", accent: "2F3C7E", tint: "FBEDEE", text: "1F2937", muted: "6B5A5C", line: "F0D3D6" },
};
const THEME_ALIASES: Record<string, string> = {
  blue: "xanh", navy: "xanh", neu: "xanh", "xanh duong": "xanh", mac_dinh: "xanh", default: "xanh",
  teal: "ngoc", "xanh ngoc": "ngoc", green: "xanhla", "xanh la": "xanhla", la: "xanhla",
  orange: "cam", purple: "tim", violet: "tim", red: "do", black: "den", dark: "den", "den vang": "den",
  "xanh than": "midnight", "midnight executive": "midnight", forest: "rung", "xanh rung": "rung", coral: "sanho", "san ho": "sanho", terracotta: "datnung", "dat nung": "datnung", gach: "datnung",
  ocean: "daiduong", "dai duong": "daiduong", charcoal: "than", berry: "man", "tim than": "man", "do man": "man", "sage calm": "sage", "xanh sage": "sage", "do ruou": "cherry",
};

/** Chọn chủ đề theo chủ đề nói trong bài (khi người dùng không nêu): một màu chủ đạo hợp nội dung thay vì luôn xanh. */
export function themeForTopic(text: string): string {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/y tế|sức khỏe|sức khoẻ|dược|bệnh|thuốc|điều dưỡng|bác sĩ|dinh dưỡng/, "ngoc"],
    [/môi trường|nông nghiệp|thiên nhiên|sinh thái|rừng|bền vững|khí hậu|năng lượng xanh/, "rung"],
    [/tài chính|ngân hàng|kinh tế|đầu tư|kế toán|kiểm toán|thuế|chứng khoán|bảo hiểm/, "midnight"],
    [/công nghệ|trí tuệ nhân tạo|\bai\b|dữ liệu|phần mềm|an ninh mạng|chuyển đổi số|lập trình|blockchain|iot/, "daiduong"],
    [/marketing|truyền thông|sáng tạo|thiết kế|sự kiện|thương hiệu|quảng cáo|bán hàng/, "sanho"],
    [/lịch sử|văn hóa|văn hoá|di sản|truyền thống|nghệ thuật|du lịch|ẩm thực/, "datnung"],
    [/pháp luật|pháp lý|hành chính|nhân sự|quản trị|chiến lược|kiểm soát/, "than"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? "xanh";
}

export function pickTheme(name?: string): { key: string; theme: Theme; known: boolean } {
  const n = (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().trim();
  const key = PPTX_THEMES[n] ? n : THEME_ALIASES[n];
  return key ? { key, theme: PPTX_THEMES[key], known: true } : { key: "xanh", theme: PPTX_THEMES.xanh, known: !n };
}

/** Bảng màu suy ra từ màu của một tệp có sẵn (accent1/accent2, dk1/dk2, lt2); null nếu không đọc được. */
export function deriveTheme(c: Partial<Record<"dk1" | "dk2" | "lt2" | "accent1" | "accent2", string>>): Theme | null {
  const ok = (h?: string) => (h && /^[0-9A-Fa-f]{6}$/.test(h) ? h.toUpperCase() : null);
  const primary = ok(c.accent1);
  if (!primary) return null;
  const lum = (h: string) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };
  const dk2 = ok(c.dk2);
  const dark = dk2 && lum(dk2) < 110 ? dk2 : tintOf(primary, -0.45);
  const lt2 = ok(c.lt2);
  return {
    primary, dark,
    accent: ok(c.accent2) ?? "F2B134",
    tint: lt2 && lum(lt2) > 215 ? lt2 : tintOf(primary, 0.92),
    text: ok(c.dk1) && lum(ok(c.dk1)!) < 90 ? ok(c.dk1)! : "1F2937",
    muted: "5B6472",
    line: tintOf(primary, 0.85),
  };
}

/** Trộn màu hex với trắng (amt 0..1); amt âm = trộn với đen. */
function tintOf(hex: string, amt: number): string {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return c.map((v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)).toString(16).padStart(2, "0")).join("").toUpperCase();
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
  /** Slide mục lục tự tạo: các tiêu đề nội dung, hiện thành lưới đánh số. */
  agenda?: string[];
}

const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

type HeadingBlock = Extract<Block, { t: "heading" }>;

/**
 * Tách một nhóm khối (giữa hai dòng `---`) thành một hoặc nhiều slide:
 * - `##`/`###` NGAY SAU tiêu đề, khi sau đó chỉ còn đoạn văn = dòng phụ của slide (bìa);
 * - tiêu đề cùng cấp hoặc cao hơn, và `##` sau một `#` đầu nhóm = bắt đầu slide mới (không cần `---`);
 * - tiêu đề sâu hơn còn lại = dòng nhỏ in đậm trong slide (không bị mất chữ).
 */
function splitGroup(g: Block[]): Block[][] {
  const hi = g.findIndex((b) => b.t === "heading");
  if (hi < 0) return [g];
  const L = (g[hi] as HeadingBlock).level;
  const blocks = g.slice();
  let j = hi + 1;
  while (j < blocks.length && blocks[j].t === "heading" && (blocks[j] as HeadingBlock).level > L) j++;
  if (j > hi + 1 && blocks.slice(j).every((b) => b.t === "para")) {
    for (let k = hi + 1; k < j; k++) blocks[k] = { t: "para", runs: (blocks[k] as HeadingBlock).runs };
  }
  const parts: Block[][] = [[]];
  blocks.forEach((b, k) => {
    if (k > hi && b.t === "heading" && (b.level <= L || (L === 1 && b.level === 2))) parts.push([]);
    parts[parts.length - 1].push(b);
  });
  return parts.map((part) => {
    const first = part.findIndex((b) => b.t === "heading");
    return part.map((b, k): Block => (b.t === "heading" && k > first ? { t: "para", runs: b.runs.map((r) => ({ ...r, bold: true })) } : b));
  });
}

/** Đoạn nhiều dòng liền nhau: ≥ 3 dòng (hoặc dài) trên slide thường = danh sách ý; ngắn/bìa = giữ các dòng trong một đoạn. */
function splitLines(b: Extract<Block, { t: "para" }>, coverLike: boolean): Block {
  const lines = b.lines!;
  if (!coverLike && (lines.length >= 3 || lines.join("").length > 120)) return { t: "list", items: lines.map((l) => ({ level: 0, ordered: false, runs: parseInline(l) })) };
  const runs: Run[] = [];
  lines.forEach((l, i) => {
    if (i) runs.push({ text: "\n" });
    runs.push(...parseInline(l));
  });
  return { t: "para", runs, align: b.align };
}

/** “Slide 5: Tiêu đề” (nhãn do read_document in ra) → “Tiêu đề”. */
const cleanTitle = (t: string): string => t.replace(/^\s*slide\s*\d+\s*[a-z]?\s*[:：.\-–—]\s*/i, "").trim();

export function parseSlides(content: string): SlideSpec[] {
  const blocks = parseBlocks(content);
  const raw: Block[][] = [[]];
  for (const b of blocks) {
    if (b.t === "hr") raw.push([]);
    else raw[raw.length - 1].push(b);
  }
  const groups = raw.filter((g) => g.length).flatMap(splitGroup).filter((g) => g.length);
  return groups.map((g, idx) => {
    const hi = g.findIndex((b) => b.t === "heading");
    const head = hi >= 0 ? (g[hi] as HeadingBlock) : null;
    const title = head ? cleanTitle(runsText(head.runs)) : "";
    const body = hi >= 0 ? [...g.slice(0, hi), ...g.slice(hi + 1)] : g;
    const coverLike = idx === 0 && head?.level === 1;
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
        if (b.lines && b.lines.length > 1) {
          rest.push(splitLines(b, coverLike));
          continue;
        }
      }
      rest.push(b);
    }
    const cover = idx === 0 && head !== null && head.level === 1 && rest.every((b) => b.t === "para");
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

/** Chỉ cảnh báo tràn khi ước lượng vượt chỗ trống quá 20% (ước lượng của ta hơi dư so với PowerPoint thật). */
const OVERFLOW = 1.2;
const overflowMsg = (idx: number, title: string) => `Slide ${idx + 1}${title ? ` “${title.slice(0, 40)}”` : ""}: có thể tràn chữ, nên rút gọn.`;

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


const ICONS: [RegExp, string][] = [
  [/bảo mật|an toàn|an ninh|rủi ro|quyền|security/i, "🔒"],
  [/dữ liệu|data|thống kê|số liệu|báo cáo|phân tích/i, "📊"], [/mục tiêu|đích|kết quả|goal|target/i, "🎯"], [/con người|nhân (sự|lực)|nhóm|đội|người dùng|sinh viên|học viên|khách/i, "👥"],
[/chi phí|ngân sách|tài chính|doanh thu|lợi nhuận|giá|tiền|đầu tư/i, "💰"], [/thời gian|lộ trình|tiến độ|kế hoạch|lịch|deadline/i, "🗓"],
  [/công nghệ|hạ tầng|hệ thống|phần mềm|ai\b|trí tuệ|nền tảng|số hoá|chuyển đổi/i, "💻"], [/giáo dục|đào tạo|học|giảng|bài giảng|kiến thức|kỹ năng/i, "🎓"], [/quy trình|quy định|chính sách|thủ tục|phương pháp|giải pháp/i, "⚙️"],
  [/chất lượng|đánh giá|kiểm tra|tiêu chuẩn|hiệu quả/i, "✅"], [/hợp tác|đối tác|kết nối|truyền thông|liên hệ/i, "🤝"], [/ý tưởng|sáng tạo|đổi mới|nghiên cứu|phát triển/i, "💡"],
];
const iconFor = (label: string): string | null => ICONS.find(([re]) => re.test(label))?.[1] ?? null;

export const CLOSING_RE = /^\s*(cảm ơn|cam on|xin cảm ơn|hỏi đáp|hoi dap|q\s*&\s*a|thank|kết thúc|ket thuc|liên hệ|lien he)/i;
const THANKS_RE = /^\W*(xin\s+)?(cảm ơn|cam on|thank)/i;
const ds = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const para = (text: string): SlideBlock => ({ t: "para", runs: [{ text }] });

/** Slide kết thúc: tiêu đề kiểu “Cảm ơn/Hỏi đáp”, chỉ có tiêu đề, hoặc dòng cuối là lời cảm ơn. */
function isClosingSpec(s: SlideSpec, isFirst: boolean): boolean {
  if (isFirst) return false;
  if (CLOSING_RE.test(s.title) || (s.title && !s.blocks.length)) return true;
  const lb = s.blocks[s.blocks.length - 1];
  return !!lb && lb.t === "para" && THANKS_RE.test(runsText(lb.runs).trim());
}

const specWeight = (s: SlideSpec): number => s.blocks.reduce((w, b) => w + (b.t === "list" ? b.items.length : b.t === "para" ? Math.ceil(runsText(b.runs).length / 80) : 4), 0);
const isRichSpec = (s: SlideSpec): boolean => s.blocks.some((b) => b.t === "table" || b.t === "code" || b.t === "image" || b.t === "quote");
const agendaOf = (body: SlideSpec[]): SlideSpec => ({ title: "Nội dung chính", blocks: [], notes: "", cover: false, agenda: body.slice(0, 12).map((s) => s.title.replace(/^\s*\d+\s*[.)\-:]\s+/, "").replace(/\s*\(\d+\/\d+\)$/, "")).filter((t, i, a) => a.indexOf(t) === i) });
const isAgendaTitle = (t: string) => /^\s*(mục lục|nội dung( chính)?|agenda)\b/i.test(t);

/** Gộp hai slide liền nhau thành một: tiêu đề “A & B”, mỗi bên giữ tối đa vài ý đầu. */
function mergeSpecs(a: SlideSpec, b: SlideSpec): SlideSpec {
  const items = (s: SlideSpec) => s.blocks.flatMap((x) => (x.t === "list" ? x.items : x.t === "para" ? [{ level: 0, ordered: false, runs: x.runs }] : []));
  const ai = items(a);
  const bi = items(b);
  const cap = 6;
  const takeA = Math.min(ai.length, bi.length ? Math.max(cap - Math.min(bi.length, 3), 3) : cap);
  const takeB = Math.min(bi.length, cap - Math.min(takeA, ai.length));
  const rich = [...a.blocks, ...b.blocks].filter((x) => x.t === "table" || x.t === "code" || x.t === "image" || x.t === "quote");
  const merged = [...ai.slice(0, takeA), ...bi.slice(0, takeB)];
  const bt = b.title.replace(/^\s*\d+\s*[.)\-:]\s+/, "");
  const title = a.title && bt ? `${a.title} & ${bt}` : a.title || bt;
  return { title, blocks: [...(merged.length ? [{ t: "list" as const, items: merged }] : []), ...rich], notes: [a.notes, b.notes].filter(Boolean).join("\n"), cover: false };
}

/** Chia đôi slide có đúng một danh sách phẳng từ 4 ý (để đủ số slide yêu cầu). */
function halve(s: SlideSpec): SlideSpec[] | null {
  const only = s.blocks.length === 1 && s.blocks[0].t === "list" ? (s.blocks[0] as Extract<Block, { t: "list" }>) : null;
  if (!only || only.items.length < 4 || !only.items.every((i) => i.level === 0) || s.agenda) return null;
  const h = Math.ceil(only.items.length / 2);
  return [
    { ...s, title: `${s.title} (1/2)`, blocks: [{ t: "list", items: only.items.slice(0, h) }] },
    { ...s, title: `${s.title} (2/2)`, blocks: [{ t: "list", items: only.items.slice(h) }], notes: "" },
  ];
}

/** Đạt đúng `n` slide: bìa + nội dung + cảm ơn; gộp slide ngắn liền kề nếu nhiều, không tách (trừ khi thiếu), mục lục chỉ khi còn chỗ và từ 8 slide. */
function fitToCount(specs: SlideSpec[], o: PptxOptions, footer: string, n: number, warn: (t: string) => void): SlideSpec[] {
  const auto = o.auto !== false;
  const deckTitle = (o.title ?? "").trim() || specs.find((s) => s.title)?.title || "Bài trình chiếu";
  let body = specs.slice();
  if (body[0] && !body[0].cover && body[0].title.trim() === deckTitle) body[0] = { ...body[0], title: "Tổng quan" };
  let cover: SlideSpec | null = null;
  if (body[0]?.cover) cover = body.shift()!;
  else if (auto) {
    const sub = [(o.subtitle ?? "").trim() || footer, `Ngày ${ds(new Date())}`].filter(Boolean).join("\n");
    cover = { title: deckTitle, blocks: sub ? [para(sub)] : [], notes: "", cover: true };
  }
  if (cover && o.subtitle && !cover.blocks.length) cover = { ...cover, blocks: [para(o.subtitle)] };
  let closing: SlideSpec | null = null;
  if (body.length && isClosingSpec(body[body.length - 1], false) && (cover || body.length > 1)) closing = body.pop()!;
  else if (auto && n >= 3) closing = { title: "Cảm ơn quý vị đã lắng nghe", blocks: [para("Rất mong nhận được ý kiến đóng góp.")], notes: "", cover: false };
  let reserved = (cover ? 1 : 0) + (closing ? 1 : 0);
  if (n - reserved < 1 && closing) {
    closing = null;
    reserved--;
  }
  if (n - reserved < 1 && cover) {
    cover = null;
    reserved--;
  }
  const slots = Math.max(1, n - reserved);
  // nhiều hơn chỗ: gộp cặp liền kề nhẹ nhất
  let merged = 0;
  while (body.length > slots && body.length > 1) {
    let at = 0;
    let best = Infinity;
    for (let i = 0; i + 1 < body.length; i++) {
      const cost = specWeight(body[i]) + specWeight(body[i + 1]) + (isRichSpec(body[i]) || isRichSpec(body[i + 1]) ? 1000 : 0);
      if (cost < best) {
        best = cost;
        at = i;
      }
    }
    body.splice(at, 2, mergeSpecs(body[at], body[at + 1]));
    merged++;
  }
  if (merged) warn(`Nội dung nhiều hơn chỗ: đã gộp ${merged} cặp slide ngắn liền kề để đủ ${n} slide.`);
  // mục lục: chỉ khi còn chỗ và từ 8 slide
  const titled = body.filter((s) => s.title);
  if (auto && n >= 8 && body.length < slots && titled.length >= 5 && !body.some((s) => isAgendaTitle(s.title))) body = [agendaOf(body), ...body];
  // ít hơn chỗ: chia đôi danh sách dài (không bịa nội dung)
  while (body.length < slots) {
    let at = -1;
    let most = 3;
    body.forEach((s, i) => {
      const w = halve(s) ? specWeight(s) : 0;
      if (w > most) {
        most = w;
        at = i;
      }
    });
    if (at < 0) break;
    body.splice(at, 1, ...halve(body[at])!);
  }
  const out = [...(cover ? [cover] : []), ...body, ...(closing ? [closing] : [])];
  if (out.length < n) warn(`Chỉ có ${out.length}/${n} slide: thiếu ${n - out.length}, cần thêm nội dung (append hoặc add_slides).`);
  return out;
}

/**
 * Bài mô hình viết thường thiếu bộ khung: không bìa, không mục lục, danh sách quá dài, không trang cảm ơn.
 * Bổ sung ở đây (không phụ thuộc vào việc mô hình nhớ làm): bìa, mục lục (≥ 5 slide nội dung), chia danh sách > 6 mục thành nhiều slide, trang cảm ơn.
 * Có `slideCount` thì đi đường riêng để ĐẠT ĐÚNG số slide.
 */
function structureSpecs(specs: SlideSpec[], o: PptxOptions, footer: string, warn: (t: string) => void): SlideSpec[] {
  const want = Math.floor(Number(o.slideCount) || 0);
  if (want >= 1) return fitToCount(specs, o, footer, Math.min(want, 80), warn);
  if (o.auto === false) return specs;
  const out: SlideSpec[] = [];
  const deckTitle = (o.title ?? "").trim() || specs.find((s) => s.title)?.title || "Bài trình chiếu";
  // slide đầu là nội dung trùng tên bài: bìa lấy tên đó, slide nội dung đổi thành "Tổng quan"
  if (specs[0] && !specs[0].cover && specs[0].title.trim() === deckTitle) specs = [{ ...specs[0], title: "Tổng quan" }, ...specs.slice(1)];
  // chia danh sách quá dài (chỉ slide có đúng một danh sách phẳng) thành các slide ≤ 5 mục
  for (const sp of specs) {
    const only = sp.blocks.length === 1 && sp.blocks[0].t === "list" ? (sp.blocks[0] as Extract<Block, { t: "list" }>) : null;
    if (!sp.cover && only && only.items.length > 6 && only.items.every((i) => i.level === 0)) {
      const parts = Math.ceil(only.items.length / 5);
      const per = Math.ceil(only.items.length / parts);
      for (let k = 0; k < parts; k++) out.push({ ...sp, title: `${sp.title} (${k + 1}/${parts})`, blocks: [{ t: "list", items: only.items.slice(k * per, (k + 1) * per) }], notes: k === 0 ? sp.notes : "" });
      continue;
    }
    out.push(sp);
  }
  if (!out.length) return out;
  const title = deckTitle;
  if (!out[0].cover) {
    const sub = [(o.subtitle ?? "").trim() || footer, `Ngày ${ds(new Date())}`].filter(Boolean).join("\n");
    out.unshift({ title, blocks: sub ? [para(sub)] : [], notes: "", cover: true });
  } else if (o.subtitle && !out[0].blocks.length) out[0] = { ...out[0], blocks: [para(o.subtitle)] };
  const last = out[out.length - 1];
  const closing = out.length > 1 && isClosingSpec(last, last === out[0]);
  if (!closing) out.push({ title: "Cảm ơn quý vị đã lắng nghe", blocks: [para("Rất mong nhận được ý kiến đóng góp.")], notes: "", cover: false });
  // mục lục: từ 5 slide nội dung trở lên
  const body = out.filter((s, i) => i > 0 && !s.cover && s.title && !CLOSING_RE.test(s.title) && !(s.blocks.length === 0));
  if (body.length >= 5 && !out.some((s) => isAgendaTitle(s.title))) out.splice(1, 0, agendaOf(body));
  return out;
}

export interface PptxBuilt {
  bytes: Uint8Array;
  slides: number;
  warnings: string[];
  /** Cảnh báo gắn với một slide cụ thể (số slide tính từ 1). */
  slideWarnings: { slide: number; text: string }[];
  theme: string;
  /** Tiêu đề từng slide theo thứ tự (bìa, mục lục, cảm ơn cũng có). */
  titles: string[];
}

export async function createPptx(o: PptxOptions): Promise<PptxBuilt> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = brandName();
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const parsed = parseSlides(o.content);
  if (!parsed.length) throw new Error("Nội dung trống: cần ít nhất một slide.");
  const warnings: string[] = [];
  const slideWarnings: { slide: number; text: string }[] = [];
  const warn = (text: string, slide?: number) => {
    warnings.push(text);
    if (slide) slideWarnings.push({ slide, text });
  };
  const specs = structureSpecs(parsed, o, o.footer ?? "", warn);
  const picked = o.themeSpec
    ? { key: (o.theme ?? "").trim() || "tuychinh", theme: o.themeSpec, known: true }
    : o.theme ? pickTheme(o.theme) : pickTheme(themeForTopic([o.title ?? "", ...parsed.slice(0, 4).map((x) => x.title)].join(" ")));
  if (!picked.known) warn(`Chủ đề “${o.theme}” không có; đã dùng “xanh”. Chủ đề có sẵn: ${Object.keys(PPTX_THEMES).join(", ")}.`);
  const t = picked.theme;
  const soft = tintOf(t.primary, 0.78);

  const footerObj = (color: string) => (o.footer ? [{ text: { text: o.footer, options: { x: MX, y: 7.0, w: 8, h: 0.3, fontSize: 11, color, fontFace: FONT } } }] : []);
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "FFFFFF" },
    objects: [
      ...footerObj(t.muted),
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.5, w: CW, h: 1.05, fontFace: FONT, fontSize: 36, bold: true, color: t.dark, valign: "middle", align: "left", margin: 0, fit: "shrink" }, text: "" } },
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
    objects: [...footerObj(t.muted)],
    slideNumber: { x: 12.2, y: 7.03, w: 0.6, h: 0.3, fontSize: 11, color: t.muted, fontFace: FONT, align: "right" },
  });

  /** Thêm slide; mọi hộp chữ không phải placeholder được đánh dấu là hộp văn bản (trình đọc màn hình đọc đúng). */
  const newSlide = (masterName: string): any => {
    const sl = pptx.addSlide({ masterName });
    const add = sl.addText.bind(sl);
    sl.addText = (text: unknown, opts: Record<string, unknown> = {}) => add(text, opts.placeholder || opts.isTextBox !== undefined ? opts : { isTextBox: true, ...opts });
    return sl;
  };
  const shapes = pptx.ShapeType ?? {};
  const RECT = shapes.rect ?? "rect";
  const ROUND = shapes.roundRect ?? "roundRect";
  const OVAL = shapes.ellipse ?? "ellipse";

  // thẻ: nền (trắng hoặc nhạt) + bóng rất nhẹ; không viền sọc một cạnh (xem docs: dấu hiệu "slide do AI làm")
  const card = (slide: any, x: number, y: number, w: number, h: number, fill = "FFFFFF", line: string | null = t.line) =>
    slide.addShape(ROUND, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { color: fill, width: 0 }, shadow: { type: "outer", color: "000000", opacity: 0.1, blur: 6, offset: 2, angle: 90 } });

  // ---- khối nội dung xếp dọc; slide = null → chỉ đo chiều cao
  function stack(slide: any | null, blocks: SlideBlock[], x: number, y0: number, w: number, fs: number, idx: number): number {
    let y = y0;
    for (const b of blocks) {
      if (b.t === "list") {
        let h = 0;
        const heights = b.items.map((it) => {
          const size = Math.max(12, fs - it.level * 2);
          const tw = w - 0.45 - it.level * 0.45;
          return linesOf(runsText(it.runs), tw, size) * lhOf(size) + 0.17;
        });
        h = heights.reduce((s2, v) => s2 + v, 0);
        if (slide) {
          const runs: any[] = [];
          b.items.forEach((it, i) => {
            const size = Math.max(12, fs - it.level * 2);
            const rs = textOfRuns(it.runs, t.text);
            rs.forEach((r, k) =>
              runs.push({
                text: r.text,
                options: {
                  ...r.options, fontSize: size, color: t.text, fontFace: FONT,
                  ...(k === 0 ? { bullet: it.ordered ? { type: "number" } : { characterCode: it.level === 0 ? "2022" : "2013" }, indentLevel: it.level } : {}),
                  breakLine: k === rs.length - 1 && i < b.items.length - 1, paraSpaceAfter: 9,
                },
              }),
            );
          });
          slide.addText(runs, { x, y, w, h: h + 0.1, fontFace: FONT, color: t.text, valign: "top", margin: 0, isTextBox: true });
        }
        y += h + 0.1;
      } else if (b.t === "para" || b.t === "quote") {
        const text = runsText(b.runs);
        const quote = b.t === "quote";
        const tw = w - (quote ? 0.6 : 0);
        const h = linesOf(text, tw, fs) * lhOf(fs);
        if (slide) {
          if (quote) slide.addShape(ROUND, { x, y: y - 0.12, w, h: h + 0.28, rectRadius: 0.05, fill: { color: t.tint }, line: { color: t.tint, width: 0 } });
          slide.addText(textOfRuns(b.runs, quote ? t.muted : t.text) as any, { isTextBox: true, x: x + (quote ? 0.3 : 0), y, w: tw, h: h + 0.02, fontFace: FONT, fontSize: fs, color: quote ? t.muted : t.text, italic: quote, align: b.t === "para" && b.align && b.align !== "justify" ? b.align : "left", valign: "top", margin: 0, fit: "shrink" });
        }
        y += h + 0.2;
      } else if (b.t === "code" && b.lang === "chart") {
        const h = Math.min(4.2, Math.max(2.6, BOTTOM - y));
        if (slide) {
          const spec = parseChart(b.text, b.info ?? "");
          if ("error" in spec) {
            warn(`Slide ${idx + 1}: biểu đồ lỗi — ${spec.error}.`, idx + 1);
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
      warn(data ? `Ảnh “${b.src}” không đọc được (chỉ nhận png, jpg, gif).` : `Không tìm thấy ảnh “${b.src}” trong thư mục dự án.`);
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

  const titleOn = (slide: any, text: string, long = 48) => {
    const clean = text.replace(/[.。]+\s*$/, ""); // tiêu đề không kết thúc bằng dấu chấm
    slide.addText(clean, { placeholder: "title", ...(clean.length > long ? { fontSize: 28 } : {}) });
  };

  specs.forEach((sp, idx) => {
    const last = idx === specs.length - 1;
    const only = sp.blocks.filter((b) => b.t !== "image");
    const lists = sp.blocks.filter((b): b is Extract<Block, { t: "list" }> => b.t === "list");
    const paras = sp.blocks.filter((b): b is Extract<Block, { t: "para" }> => b.t === "para");
    const paraText = paras.map((b) => runsText(b.runs)).join("\n");
    let slide: any;

    if (sp.agenda) {
      slide = newSlide("CONTENT");
      titleOn(slide, sp.title);
      const items = sp.agenda;
      const cols = items.length > 6 ? 2 : 1;
      const per = Math.ceil(items.length / cols);
      const cw = (CW - (cols - 1) * 0.5) / cols;
      items.forEach((txt, i) => {
        const col = Math.floor(i / per);
        const row = i % per;
        const x = MX + col * (cw + 0.5);
        const rh = Math.min(0.82, (BOTTOM - TOP - 0.1) / per);
        const y = TOP + 0.1 + row * rh;
        slide.addShape(ROUND, { x, y, w: 0.56, h: 0.56, rectRadius: 0.12, fill: { color: i % 2 ? t.accent : t.primary }, line: { color: t.primary, width: 0 } });
        slide.addText(String(i + 1).padStart(2, "0"), { x, y, w: 0.56, h: 0.56, fontFace: FONT, fontSize: 16, bold: true, color: i % 2 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0 , objectName: "deco" });
        slide.addText(txt, { x: x + 0.78, y, w: cw - 0.8, h: 0.56, fontFace: FONT, fontSize: items.length > 8 ? 18 : 22, color: t.dark, valign: "middle", margin: 0, fit: "shrink" });
      });
    } else if (sp.cover) {
      slide = newSlide("COVER");
      slide.addShape(OVAL, { x: 8.6, y: -1.6, w: 7.4, h: 7.4, fill: { color: t.primary, transparency: 30 }, line: { color: t.primary, width: 0 } });
      slide.addShape(OVAL, { x: 10.6, y: 3.9, w: 4.4, h: 4.4, fill: { color: t.dark, transparency: 100 }, line: { color: t.accent, width: 1.5, transparency: 35 } });
      slide.addShape(OVAL, { x: 11.4, y: 1.0, w: 0.34, h: 0.34, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      titleOn(slide, sp.title, 38);
      if (paraText) slide.addText(paraText, { x: 0.9, y: 4.95, w: 7.4, h: 1.5, fontFace: FONT, fontSize: 20, color: tintOf(t.dark, 0.8), valign: "top", margin: 0, fit: "shrink" });
    } else if (!sp.blocks.length || (!lists.length && !sp.blocks.some((b) => b.t === "table" || b.t === "code" || b.t === "quote" || b.t === "image") && paras.length <= 1 && paraText.length <= 160)) {
      // mở đầu phần / kết thúc: chỉ có tiêu đề và tối đa một dòng phụ
      const closing = last && idx > 0;
      slide = newSlide(closing ? "COVER" : "SECTION");
      const num = /^(\d{1,2})\s*[.)\-:]\s+/.exec(sp.title);
      slide.addShape(OVAL, { x: 9.8, y: 3.6, w: 6.2, h: 6.2, fill: { color: closing ? t.primary : t.dark, transparency: closing ? 35 : 55 }, line: { color: t.dark, width: 0 } });
      if (num && !closing) {
        slide.addText(num[1].padStart(2, "0"), { x: 0.9, y: 1.55, w: 4, h: 1.1, fontFace: FONT, fontSize: 60, bold: true, color: tintOf(t.primary, 0.72), margin: 0, valign: "middle" , objectName: "deco" });
        slide.addText(sp.title.slice(num[0].length), { placeholder: "title" });
      } else {
        titleOn(slide, sp.title, 40);
      }
      if (paraText) slide.addText(paraText, { x: 0.9, y: closing ? 4.95 : 4.5, w: 8.6, h: 1.4, fontFace: FONT, fontSize: 20, color: tintOf(closing ? t.dark : t.primary, 0.8), valign: "top", margin: 0, fit: "shrink" });
    } else if (only.length >= 1 && only[0].t === "quote" && only.length <= 2 && only.slice(1).every((b) => b.t === "para")) {
      slide = newSlide("QUOTE");
      const q = only[0] as Extract<Block, { t: "quote" }>;
      slide.addText("“", { x: 0.9, y: 0.5, w: 2, h: 1.8, fontFace: "Georgia", fontSize: 130, bold: true, color: t.accent, margin: 0, valign: "top" , objectName: "deco" });
      if (sp.title) slide.addText(sp.title.toUpperCase(), { x: 2.7, y: 0.75, w: 9.5, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: t.primary, charSpacing: 3, margin: 0 });
      const qs = runsText(q.runs).length > 220 ? 26 : runsText(q.runs).length > 110 ? 30 : 36;
      slide.addText(textOfRuns(q.runs, t.dark) as any, { x: 1.4, y: 1.9, w: 10.6, h: 3.6, fontFace: "Georgia", fontSize: qs, italic: true, color: t.dark, valign: "middle", margin: 0, fit: "shrink" });
      if (only[1]) slide.addText("— " + runsText((only[1] as Extract<Block, { t: "para" }>).runs), { x: 1.4, y: 5.45, w: 10.6, h: 0.6, fontFace: FONT, fontSize: 18, color: t.muted, margin: 0 });
    } else {
      slide = newSlide("CONTENT");
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
          card(slide, x, 2.1, cw, 3.3, t.tint, null);
          slide.addText(s!.num, { x: x + 0.3, y: 2.45, w: cw - 0.6, h: 1.4, fontFace: FONT, fontSize: s!.num.length > 7 ? 40 : 60, bold: true, color: t.primary, align: "left", valign: "middle", margin: 0, fit: "shrink", isTextBox: true });
          slide.addText(s!.rest, { x: x + 0.3, y: 3.95, w: cw - 0.6, h: 1.3, fontFace: FONT, fontSize: 18, color: t.text, align: "left", valign: "top", margin: 0, fit: "shrink", isTextBox: true });
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
          slide.addText(String(i + 1), { x: x + cw / 2 - 0.4, y: 2.24, w: 0.8, h: 0.8, fontFace: FONT, fontSize: 24, bold: true, color: i === n - 1 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0 , objectName: "deco" });
          slide.addText(lab ? lab.label : runsText(it.runs), { x, y: 3.3, w: cw, h: 0.7, fontFace: FONT, fontSize: 19, bold: true, color: t.dark, align: "center", valign: "top", margin: 0, fit: "shrink" });
          if (lab) slide.addText(lab.rest, { x: x + 0.05, y: 4.05, w: cw - 0.1, h: 2.2, fontFace: FONT, fontSize: 17, color: t.text, align: "left", valign: "top", margin: 0, fit: "shrink", isTextBox: true });
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
          const icon = iconFor(lab.label || runsText(it.runs));
          slide.addShape(OVAL, { x: x + 0.3, y: y + 0.22, w: 0.52, h: 0.52, fill: { color: icon ? t.tint : i % 2 ? t.accent : t.primary }, line: { color: icon ? t.primary : t.primary, width: icon ? 1 : 0 } });
          slide.addText(icon ?? String(i + 1), { x: x + 0.3, y: y + 0.22, w: 0.52, h: 0.52, fontFace: icon ? "Segoe UI Emoji" : FONT, fontSize: icon ? 16 : 16, bold: !icon, color: icon ? t.dark : i % 2 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "deco" });
          slide.addText(lab.label || runsText(it.runs), { x: x + 0.98, y: y + 0.2, w: cw - 1.2, h: 0.56, fontFace: FONT, fontSize: 19, bold: true, color: t.dark, valign: "middle", margin: 0, fit: "shrink", isTextBox: true });
          if (lab.label) slide.addText(lab.rest, { x: x + 0.3, y: y + 0.9, w: cw - 0.5, h: ch - 1.05, fontFace: FONT, fontSize: lab.rest.length > 150 ? 15 : lab.rest.length > 90 ? 17 : 19, color: t.text, valign: "top", margin: 0, fit: "shrink", isTextBox: true });
        });
      } else if (flat && n >= 2 && n <= 6 && oneList!.items.every((i) => runsText(i.runs).length <= 140)) {
        // danh sách ngắn: mỗi ý một hàng có biểu tượng/số trong vòng tròn màu (không để slide chỉ có chữ gạch đầu dòng)
        const avail = BOTTOM - TOP - 0.1;
        const gap = 0.2;
        const rh = Math.min(1.0, (avail - gap * (n - 1)) / n);
        const size = n <= 3 ? 24 : n <= 4 ? 22 : 20;
        oneList!.items.forEach((it, i) => {
          const y = TOP + 0.1 + i * (rh + gap);
          const text = runsText(it.runs);
          const icon = iconFor(text);
          card(slide, MX, y, CW, rh, t.tint, null);
          const d = Math.min(0.62, rh - 0.2);
          slide.addShape(OVAL, { x: MX + 0.3, y: y + (rh - d) / 2, w: d, h: d, fill: { color: icon ? "FFFFFF" : i % 2 ? t.accent : t.primary }, line: { color: t.primary, width: icon ? 1 : 0 } });
          slide.addText(icon ?? String(i + 1), { x: MX + 0.3, y: y + (rh - d) / 2, w: d, h: d, fontFace: icon ? "Segoe UI Emoji" : FONT, fontSize: 18, bold: !icon, color: icon ? t.dark : i % 2 ? onColor(t.accent, t.dark) : "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "deco" });
          slide.addText(textOfRuns(it.runs, t.text) as any, { x: MX + 1.2, y, w: CW - 1.5, h: rh, fontFace: FONT, fontSize: size, color: t.text, valign: "middle", margin: 0, fit: "shrink", isTextBox: true });
        });
      } else if (vis.length === 1 && textual.length >= 1 && sp.blocks.length === textual.length + 1) {
        // chữ bên trái, hình/biểu đồ/bảng nhỏ bên phải
        const lw = 5.5;
        const rx = MX + lw + 0.4;
        const rw = SW - MX - rx;
        const avail = BOTTOM - TOP;
        const fs = fitSize(textual, lw, avail, 24);
        const h = stack(null, textual, 0, 0, lw, fs, idx);
        if (h > avail * OVERFLOW) warn(overflowMsg(idx, sp.title), idx + 1);
        stack(slide, textual, MX, TOP + 0.05, lw, fs, idx);
        const v = vis[0];
        if (v.t === "image") addPic(slide, v, rx, TOP, rw, avail - 0.1);
        else if (v.t === "table") stack(slide, [v], rx, TOP + 0.05, rw, 18, idx);
        else {
          const spec = v.t === "code" ? parseChart(v.text, v.info ?? "") : { error: "?" };
          if ("error" in spec) warn(`Slide ${idx + 1}: biểu đồ lỗi — ${spec.error}.`, idx + 1);
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
        if (h > avail * OVERFLOW) warn(overflowMsg(idx, sp.title), idx + 1);
        stack(slide, sp.blocks, MX, TOP + 0.05, CW, fs, idx);
      }
    }
    if (sp.notes) slide.addNotes(sp.notes);
  });
  const out: any = await pptx.write({ outputType: "uint8array" });
  const raw: Uint8Array = out instanceof Uint8Array ? out : new Uint8Array(out);
  return { bytes: await applyThemeColors(raw, t, picked.key), slides: specs.length, warnings, slideWarnings, theme: picked.key, titles: specs.map((sp) => sp.title || "(không tiêu đề)") };
}

/** Ghi bảng màu của chủ đề vào chính tệp (theme1.xml) để tab Design/Variants của PowerPoint và hình mới thêm dùng đúng màu. */
async function applyThemeColors(bytes: Uint8Array, t: Theme, key: string): Promise<Uint8Array> {
  try {
    const zip = await loadZip(bytes);
    const file = Object.keys(zip.files).find((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
    if (!file) return bytes;
    let xml = await zip.file(file)!.async("string");
    const c = (tag: string, hex: string) => `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
    const scheme = `<a:clrScheme name="Handio ${key}">${c("dk1", t.text)}${c("lt1", "FFFFFF")}${c("dk2", t.dark)}${c("lt2", t.tint)}${c("accent1", t.primary)}${c("accent2", t.accent)}${c("accent3", "1BAF7A")}${c("accent4", "EB6834")}${c("accent5", "4A3AA7")}${c("accent6", "EDA100")}${c("hlink", t.primary)}${c("folHlink", t.muted)}</a:clrScheme>`;
    if (!/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.test(xml)) return bytes;
    xml = xml.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, scheme);
    zip.file(file, xml);
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  } catch {
    return bytes; // không đổi được bảng màu thì giữ bản gốc (vẫn dùng được)
  }
}

function addChart(pptx: any, slide: any, c: ChartSpec, x: number, y: number, w: number, h: number, t: Theme): void {
  // thứ tự màu cố định theo nguyên tắc trực quan hoá dữ liệu: xanh chủ đề → cam → ngọc → vàng → hồng → lục → tím → đỏ (không xoay vòng)
  const colors = [t.primary, "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"];
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
      if (/<p:cNvPr\b[^>]*\bname="deco"/.test(sp)) continue; // số/biểu tượng trang trí, không phải nội dung
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
