/**
 * Kiểu "modern" của create_docx: tài liệu trình bày như do nhà thiết kế làm (khối tiêu đề, màu chủ đạo, bảng so le,
 * hộp lưu ý, khối mã, thanh biểu đồ bằng ô tô màu, đầu/chân trang). Kiểu "formal" (thể thức hành chính) KHÔNG đi qua đây.
 */
import type * as Docx from "docx";
import { colorHex } from "./colors";
import { parseChart, type ChartSpec } from "./chart";
import { parseBlocks, runsText, type Align, type Block, type Run } from "./mdblocks";

type D = typeof Docx;
type Para = InstanceType<D["Paragraph"]>;
export type Child = Para | InstanceType<D["Table"]>;

export interface Theme {
  /** Màu nhấn chính (nền hàng tiêu đề bảng, thanh biểu đồ, vạch). */
  accent: string;
  /** Bản đậm hơn của màu nhấn, dùng cho tiêu đề lớn. */
  dark: string;
  /** Màu chữ đặt trên nền accent. */
  onAccent: string;
  /** Nền rất nhạt (hàng so le, trích dẫn). */
  tint: string;
  /** Đường kẻ nhạt cùng tông. */
  rule: string;
  /** Màu chữ tiêu đề cấp 2 (accent, hoặc bản đậm nếu accent quá nhạt). */
  ink: string;
}

export const DEFAULT_ACCENT = "2F5597";
const DEFAULT_DARK = "1F3864";
const GREY = "595959";
const MUTED = "7F7F7F";
const HAIR = "D9DDE3";

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
/** Trộn a với b theo tỉ lệ t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return (hex2(x[0] + (y[0] - x[0]) * t) + hex2(x[1] + (y[1] - x[1]) * t) + hex2(x[2] + (y[2] - x[2]) * t)).toUpperCase();
}
const luminance = (h: string): number => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Màu chủ đạo → bảng màu. Ném lỗi tiếng Việt nếu không hiểu màu hoặc quá nhạt (chữ trắng trên nền đó không đọc được). */
export function makeTheme(accent?: unknown): Theme {
  if (accent === undefined || accent === null || accent === "") return build(DEFAULT_ACCENT, DEFAULT_DARK);
  const hex = colorHex(accent);
  if (!hex) throw new Error(`Màu chủ đạo “${String(accent).slice(0, 40)}” không hợp lệ: dùng mã #RRGGBB (vd #1F3864) hoặc tên màu (xanh dương, đỏ, xanh lá, cam, tím, xám đậm…).`);
  if (luminance(hex) > 0.75) throw new Error(`Màu chủ đạo #${hex} quá nhạt, chữ khó đọc: hãy chọn màu đậm hơn (vd #1F3864).`);
  return build(hex, hex === DEFAULT_ACCENT ? DEFAULT_DARK : mix(hex, "000000", 0.38));
}
function build(accent: string, dark: string): Theme {
  return { accent, dark, onAccent: luminance(accent) > 0.6 ? "1F1F1F" : "FFFFFF", tint: mix(accent, "FFFFFF", 0.93), rule: mix(accent, "FFFFFF", 0.72), ink: luminance(accent) > 0.5 ? dark : accent };
}

export interface Ctx {
  d: D;
  th: Theme;
  font: string;
  /** Bề rộng vùng chữ (twip). */
  width: number;
  /** Tạo tham chiếu đánh số mới cho một danh sách số thứ tự. */
  orderedRef: () => string;
  /** Kiểu formal chỉ dùng thanh biểu đồ; tiêu đề biểu đồ giữ màu đen theo thể thức. */
  formal?: boolean;
}

const algn = (d: D, a?: Align) => (a === "center" ? d.AlignmentType.CENTER : a === "right" ? d.AlignmentType.RIGHT : a === "justify" ? d.AlignmentType.JUSTIFIED : d.AlignmentType.LEFT);
const SINGLE = "single" as const;

function mkRuns(c: Ctx, rs: Run[], o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) {
  const { d } = c;
  return rs.map((r) => {
    const tr = new d.TextRun({
      text: r.text,
      bold: r.bold || o.bold,
      italics: r.italic || o.italics,
      size: r.code ? (o.size ?? 22) - 2 : o.size,
      color: r.link ? undefined : o.color,
      font: r.code ? "Consolas" : undefined,
      shading: r.code ? { type: d.ShadingType.CLEAR, fill: "EEF1F6", color: "auto" } : undefined,
      style: r.link ? "Hyperlink" : undefined,
    });
    return r.link ? new d.ExternalHyperlink({ link: r.link, children: [tr] }) : tr;
  });
}

/** Khoảng trống có chiều cao cố định (twip), thay cho đoạn rỗng cỡ chữ đầy đủ. */
const gap = (c: Ctx, twips: number): Para => new c.d.Paragraph({ spacing: { before: 0, after: 0, line: Math.max(20, twips), lineRule: c.d.LineRuleType.EXACT }, children: [] });

// ---- cấp độ danh sách ----
export function bulletLevels(d: D, th: Theme) {
  return [0, 1, 2, 3].map((level) => ({ level, format: d.LevelFormat.BULLET, text: ["•", "–", "▪", "·"][level], alignment: d.AlignmentType.LEFT, style: { run: { color: th.accent, bold: true }, paragraph: { indent: { left: 454 + level * 397, hanging: 284 } } } }));
}
export function orderedLevels(d: D, th: Theme) {
  return [0, 1, 2, 3].map((level) => ({ level, format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN, d.LevelFormat.DECIMAL][level], text: `%${level + 1}.`, alignment: d.AlignmentType.LEFT, style: { run: { color: th.accent, bold: true }, paragraph: { indent: { left: 454 + level * 397, hanging: 340 } } } }));
}

// ---- kiểu đoạn dùng cho Heading/Title/TOC ----
export function paragraphStyles(c: Ctx, withToc: boolean) {
  const { th, font } = c;
  const styles: object[] = [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, bold: true, size: 52, color: th.dark }, paragraph: { spacing: { before: 0, after: 100, line: 252 }, keepNext: true } },
    { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, size: 28, color: GREY }, paragraph: { spacing: { before: 0, after: 60, line: 264 } } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, bold: true, size: 32, color: th.dark }, paragraph: { outlineLevel: 0, keepNext: true, keepLines: true, spacing: { before: 380, after: 140, line: 264 }, border: { bottom: { style: SINGLE, size: 6, color: th.rule, space: 4 } } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, bold: true, size: 26, color: th.ink }, paragraph: { outlineLevel: 1, keepNext: true, keepLines: true, spacing: { before: 300, after: 100, line: 264 } } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font, bold: true, size: 23, color: "404040" }, paragraph: { outlineLevel: 2, keepNext: true, keepLines: true, spacing: { before: 220, after: 80, line: 264 } } },
  ];
  // kiểu Footer: kết quả trường số trang (PAGE/NUMPAGES) thừa hưởng cỡ chữ và màu từ đây
  styles.push({ id: "Footer", name: "footer", basedOn: "Normal", run: { font, size: 18, color: MUTED }, paragraph: { spacing: { before: 0, after: 0 } } });
  if (withToc) {
    [0, 1, 2].forEach((i) => styles.push({ id: `TOC${i + 1}`, name: `toc ${i + 1}`, basedOn: "Normal", next: "Normal", run: { font, bold: i === 0, size: i === 0 ? 22 : 21, color: i === 2 ? GREY : "262626" }, paragraph: { indent: { left: i * 284 }, spacing: { before: i === 0 ? 80 : 20, after: 20, line: 264 } } }));
  }
  return styles;
}

// ---- khối tiêu đề ----
/** subtitle nhiều dòng: dòng đầu là phụ đề, các dòng sau là thông tin (tác giả, ngày…) chữ nhỏ màu xám. */
export function titleBlock(c: Ctx, title: string | undefined, subtitle: string | undefined): Child[] {
  const { d, th } = c;
  const out: Child[] = [];
  if (title) {
    out.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun({ text: title })] }));
    // vạch nhấn: đoạn rỗng có đường kẻ dưới, thụt phải để chỉ còn ~3,5 cm
    out.push(new d.Paragraph({ spacing: { before: 0, after: 200, line: 40, lineRule: d.LineRuleType.EXACT }, indent: { right: Math.max(0, c.width - 1980) }, border: { bottom: { style: SINGLE, size: 24, color: th.accent, space: 1 } }, children: [] }));
  }
  const lines = (subtitle ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  lines.forEach((l, i) => {
    out.push(i === 0
      ? new d.Paragraph({ heading: undefined, style: "Subtitle", children: [new d.TextRun({ text: l })] })
      : new d.Paragraph({ spacing: { before: 0, after: 40, line: 252 }, children: [new d.TextRun({ text: l, size: 20, color: MUTED })] }));
  });
  if (title || lines.length) out.push(gap(c, 260));
  return out;
}

export function tocLabel(c: Ctx): Para {
  const { d, th } = c;
  return new d.Paragraph({ keepNext: true, spacing: { before: 120, after: 100 }, border: { bottom: { style: SINGLE, size: 6, color: th.rule, space: 4 } }, children: [new d.TextRun({ text: "Mục lục", bold: true, size: 26, color: th.dark })] });
}

// ---- đầu trang / chân trang ----
export function headerFooter(c: Ctx, docTitle: string | undefined, pageNumbers: boolean) {
  const { d } = c;
  const empty = () => new d.Paragraph({ children: [] });
  const out: { headers?: { default: InstanceType<D["Header"]>; first: InstanceType<D["Header"]> }; footers?: { default: InstanceType<D["Footer"]>; first: InstanceType<D["Footer"]> } } = {};
  if (docTitle) {
    const t = docTitle.length > 90 ? docTitle.slice(0, 89) + "…" : docTitle;
    out.headers = {
      default: new d.Header({ children: [new d.Paragraph({ border: { bottom: { style: SINGLE, size: 4, color: HAIR, space: 4 } }, spacing: { after: 0 }, children: [new d.TextRun({ text: t, size: 17, color: MUTED })] })] }),
      first: new d.Header({ children: [empty()] }),
    };
  }
  if (pageNumbers) {
    const st = { size: 18, color: MUTED };
    const mk = () => new d.Footer({ children: [new d.Paragraph({ style: "Footer", alignment: d.AlignmentType.RIGHT, spacing: { after: 0 }, border: { top: { style: SINGLE, size: 4, color: HAIR, space: 6 } }, children: [new d.TextRun({ text: "Trang ", ...st }), new d.TextRun({ children: [d.PageNumber.CURRENT], ...st }), new d.TextRun({ text: " / ", ...st }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], ...st })] })] });
    out.footers = { default: mk(), first: mk() };
  }
  return out;
}

// ---- hộp lưu ý / trích dẫn ----
type CalloutKind = "note" | "tip" | "warn";
const CALLOUT: Record<CalloutKind, { bar: string; fill: string; label: string }> = {
  note: { bar: "2E75B6", fill: "EAF2FB", label: "1F4E79" },
  tip: { bar: "D4A017", fill: "FFF7DB", label: "7A5C00" },
  warn: { bar: "C0392B", fill: "FDECEA", label: "922B21" },
};
const LABELS: [RegExp, CalloutKind][] = [
  [/^(lưu ý|chú ý|ghi chú|note)$/i, "note"],
  [/^(mẹo|gợi ý|tip|hint)$/i, "tip"],
  [/^(cảnh báo|quan trọng|warning|caution|important)$/i, "warn"],
];
const calloutOf = (r: Run | undefined): CalloutKind | null => {
  if (!r || !r.bold) return null;
  const t = r.text.trim().replace(/\s*[:：]\s*$/, "");
  return LABELS.find(([re]) => re.test(t))?.[1] ?? null;
};

/** Tách khối > thành các phần: mỗi nhãn đậm "Lưu ý:" / "Mẹo:" / "Cảnh báo:" mở một hộp riêng. */
function splitQuote(runs: Run[]): { kind: CalloutKind | null; runs: Run[] }[] {
  const out: { kind: CalloutKind | null; runs: Run[] }[] = [];
  runs.forEach((r) => {
    const k = calloutOf(r);
    if (k) out.push({ kind: k, runs: [r] });
    else if (!out.length) out.push({ kind: null, runs: [r] });
    else {
      const cur = out[out.length - 1];
      // "**Lưu ý**: nội dung" — dấu hai chấm nằm ngoài chữ đậm: gộp vào nhãn
      if (cur.kind && cur.runs.length === 1 && /^\s*[:：]/.test(r.text) && !/[:：]\s*$/.test(cur.runs[0].text)) cur.runs[0] = { ...cur.runs[0], text: cur.runs[0].text.trim() + ":" }, cur.runs.push({ ...r, text: r.text.replace(/^\s*[:：]\s*/, " ") });
      else cur.runs.push(r);
    }
  });
  return out;
}

function boxParagraph(c: Ctx, bar: string, fill: string, children: unknown[], opts: { after?: number } = {}): Para {
  const { d } = c;
  return new d.Paragraph({
    shading: { type: d.ShadingType.CLEAR, fill, color: "auto" },
    border: { left: { style: SINGLE, size: 24, color: bar, space: 9 }, top: { style: SINGLE, size: 4, color: fill, space: 5 }, bottom: { style: SINGLE, size: 4, color: fill, space: 5 } },
    indent: { left: 240, right: 120 },
    spacing: { before: 120, after: opts.after ?? 200, line: 288 },
    keepLines: true,
    children: children as never,
  });
}

export function quote(c: Ctx, runs: Run[]): Child[] {
  const { th } = c;
  return splitQuote(runs).map((seg) => {
    if (!seg.kind) return boxParagraph(c, th.accent, th.tint, mkRuns(c, seg.runs, { italics: true, color: "404040" }));
    const sty = CALLOUT[seg.kind];
    const [label, ...rest] = seg.runs;
    const lab = label.text.trim().replace(/\s*[:：]\s*$/, "") + ":";
    return boxParagraph(c, sty.bar, sty.fill, [...mkRuns(c, [{ text: lab, bold: true }], { color: sty.label }), ...mkRuns(c, rest.length ? rest.map((r, i) => (i === 0 ? { ...r, text: " " + r.text.replace(/^\s+/, "") } : r)) : [], { color: "262626" })]);
  });
}

// ---- khối mã ----
export function code(c: Ctx, text: string): Child[] {
  const { d, th } = c;
  const fill = "F4F5F7";
  const lines = text.replace(/\t/g, "    ").split("\n");
  return lines.map((l, i) =>
    new d.Paragraph({
      shading: { type: d.ShadingType.CLEAR, fill, color: "auto" },
      border: { left: { style: SINGLE, size: 18, color: th.accent, space: 8 }, top: { style: SINGLE, size: 4, color: fill, space: 3 }, bottom: { style: SINGLE, size: 4, color: fill, space: 3 } },
      indent: { left: 240, right: 120 },
      spacing: { before: 0, after: i === lines.length - 1 ? 200 : 0, line: 250, lineRule: d.LineRuleType.EXACT },
      children: [new d.TextRun({ text: l || " ", font: "Consolas", size: 19, color: "1F2937" })],
    }),
  );
}

// ---- bảng ----
const NUMERIC = /^[-+−–(]?\s*\d[\d.,\s]*\)?\s*(%|₫|đ|\$|€|[A-Za-z²³/]{1,6})?$/;
const isNum = (s: string) => NUMERIC.test(s.trim());
const isBlank = (s: string) => !s.trim() || /^[-–—−.…]+$/.test(s.trim());

export function table(c: Ctx, b: Extract<Block, { t: "table" }>): Child[] {
  const { d, th } = c;
  const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length), 1);
  const text = (row: Run[][], i: number) => runsText(row[i] ?? []).trim();
  const colStrs = Array.from({ length: cols }, (_, i) => b.rows.map((r) => text(r, i)));
  // cột số: mọi ô có nội dung đều là số; căn lề tường minh trong Markdown (:--: / --:) được ưu tiên
  const numeric = colStrs.map((s) => {
    const v = s.filter((x) => !isBlank(x));
    return v.length > 0 && v.every(isNum);
  });
  const align = (i: number): Align => (b.align[i] === "center" || b.align[i] === "right" ? b.align[i] : numeric[i] ? "right" : "left");
  const small = b.rows.length <= 12 && cols <= 6;
  // độ rộng cột theo tỉ lệ nội dung
  const weights = Array.from({ length: cols }, (_, i) => {
    const lens = [text(b.header, i), ...colStrs[i]].map((s) => s.length);
    const mx = Math.max(...lens);
    const avg = lens.reduce((a, n) => a + n, 0) / lens.length;
    // ~1 đơn vị = 1 ký tự chữ 10pt; +2,5 cho lề ô. Cột chữ rất dài thì lấy gần với độ dài trung bình để không chiếm hết chỗ
    if (numeric[i]) return Math.min(20, Math.max(6, lens[0] + 2.5, Math.max(...lens.slice(1)) + 2.5));
    return Math.min(46, Math.max(7, (mx <= 30 ? mx : 0.7 * mx + 0.3 * avg) + 2.5));
  });
  const sum = weights.reduce((a, n) => a + n, 0);
  const MIN = 760;
  let widths = weights.map((w) => Math.max(MIN, (w / sum) * c.width));
  const scale = c.width / widths.reduce((a, n) => a + n, 0);
  widths = widths.map((w) => Math.floor(w * scale));
  widths[widths.length - 1] += c.width - widths.reduce((a, n) => a + n, 0);

  const hair = { style: SINGLE, size: 4, color: HAIR };
  const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const isTotal = (row: Run[][]) => /^(tổng|cộng|total|tổng cộng)\b/i.test(text(row, 0));
  const cell = (runs: Run[], i: number, kind: "head" | "body" | "total", odd: boolean) =>
    new d.TableCell({
      width: { size: widths[i], type: d.WidthType.DXA },
      shading: kind === "head" ? { type: d.ShadingType.CLEAR, fill: th.accent, color: "auto" } : kind === "total" ? { type: d.ShadingType.CLEAR, fill: th.rule, color: "auto" } : odd ? { type: d.ShadingType.CLEAR, fill: th.tint, color: "auto" } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      verticalAlign: d.VerticalAlign.CENTER,
      borders: kind === "total" ? { top: { style: SINGLE, size: 8, color: th.accent }, bottom: none, left: none, right: none } : undefined,
      children: [new d.Paragraph({ alignment: algn(d, align(i)), keepNext: kind === "head", spacing: { before: 0, after: 0, line: 264 }, children: mkRuns(c, runs, { size: 20, bold: kind !== "body" || (small && i === 0 && !numeric[0]), color: kind === "head" ? th.onAccent : undefined }) })],
    });
  const pad = (row: Run[][]) => Array.from({ length: cols }, (_, i) => row[i] ?? [{ text: "" }]);
  return [
    new d.Table({
      width: { size: c.width, type: d.WidthType.DXA },
      columnWidths: widths,
      layout: d.TableLayoutType.FIXED,
      borders: { top: { style: SINGLE, size: 8, color: th.accent }, bottom: { style: SINGLE, size: 8, color: th.accent }, left: none, right: none, insideHorizontal: hair, insideVertical: none },
      rows: [
        new d.TableRow({ tableHeader: true, cantSplit: true, children: pad(b.header).map((r, i) => cell(r, i, "head", false)) }),
        ...b.rows.map((row, ri) => new d.TableRow({ cantSplit: true, children: pad(row).map((r, i) => cell(r, i, isTotal(row) ? "total" : "body", ri % 2 === 1)) })),
      ],
    }),
    gap(c, 220),
  ];
}

// ---- biểu đồ thanh bằng ô tô màu ----
const fmtNum = (v: number): string => {
  const s = String(Math.round(v * 100) / 100);
  const [i, f] = s.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? "," + f : "");
};
const SERIES_COLORS = ["", "ED7D31", "70AD47", "FFC000", "5B9BD5", "A5A5A5"];

/** Đọc lại ô gốc của bảng trong khối chart (để giữ "12%", "1.200 tr"...) và dòng "nguồn: …". */
function chartExtras(text: string): { raw: string[][]; source: string } {
  let source = "";
  const body = text.split("\n").filter((l) => {
    const m = /^\s*(?:source|nguồn)\s*:\s*(.+)$/i.exec(l);
    if (m) source = m[1].trim();
    return !m;
  }).join("\n");
  const tb = parseBlocks(body.split("\n").filter((l) => !/^\s*(?:title|tiêu đề)\s*:/i.test(l)).join("\n")).find((b) => b.t === "table");
  const raw = tb && tb.t === "table" ? tb.rows.map((r) => r.map((cell) => runsText(cell).trim())) : [];
  return { raw, source };
}

export function chartBars(c: Ctx, text: string, info: string): Child[] {
  const { d, th } = c;
  const spec: ChartSpec | { error: string } = parseChart(text, info);
  if ("error" in spec) throw new Error(`Khối biểu đồ (chart) bị lỗi: ${spec.error}. Sửa khối \`\`\`chart rồi gọi lại.`);
  const { raw, source } = chartExtras(text);
  const nS = spec.series.length;
  const pie = (spec.kind === "pie" || spec.kind === "doughnut") && nS === 1;
  const colorOf = (s: number, i: number): string => {
    if (pie) return i === 0 ? th.accent : SERIES_COLORS[i % SERIES_COLORS.length] || th.accent;
    return s === 0 ? th.accent : SERIES_COLORS[s % SERIES_COLORS.length];
  };
  const all = spec.series.flatMap((s) => s.values.map((v) => Math.abs(v)));
  const maxV = Math.max(...all, 0);
  const total = pie ? spec.series[0].values.reduce((a, v) => a + Math.max(0, v), 0) : 0;
  const K = 40;
  const BARMAX = 30;
  const longest = Math.max(...spec.labels.map((l) => l.length), 4);
  const labW0 = Math.min(Math.floor(c.width * 0.36), Math.max(Math.floor(c.width * 0.18), longest * 105 + 360));
  const unit = Math.floor((c.width - labW0) / K);
  const labW = c.width - unit * K;
  const widths = [labW, ...Array.from({ length: K }, () => unit)];
  const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const white = { style: SINGLE, size: nS > 1 ? 10 : 20, color: "FFFFFF" };
  const hair = { style: SINGLE, size: 4, color: HAIR };
  const tiny = (keep: boolean) => new d.Paragraph({ keepNext: keep, spacing: { before: 0, after: 0, line: 120, lineRule: d.LineRuleType.EXACT }, children: [] });

  const rows: InstanceType<D["TableRow"]>[] = [];
  spec.labels.forEach((label, i) => {
    spec.series.forEach((s, si) => {
      const v = s.values[i];
      const last = si === nS - 1;
      const n = maxV > 0 && v !== 0 ? Math.max(1, Math.round((Math.abs(v) / maxV) * BARMAX)) : 0;
      const shown = raw[i]?.[si + 1] || fmtNum(v);
      const valueText = pie && total > 0 ? `${shown}  (${fmtNum((Math.max(0, v) / total) * 100)}%)` : shown;
      const color = v < 0 ? "C0392B" : colorOf(si, i);
      const cells: InstanceType<D["TableCell"]>[] = [];
      if (si === 0) {
        cells.push(new d.TableCell({
          width: { size: labW, type: d.WidthType.DXA }, rowSpan: nS, verticalAlign: d.VerticalAlign.CENTER,
          margins: { top: 20, bottom: 20, left: 0, right: 140 },
          borders: { top: none, left: none, right: none, bottom: nS > 1 ? hair : none },
          children: [new d.Paragraph({ keepNext: true, spacing: { before: 0, after: 0, line: 252 }, children: [new d.TextRun({ text: label, size: 20, color: "262626" })] })],
        }));
      }
      const edge = { top: none, left: none, right: none, bottom: last && nS > 1 ? hair : none };
      if (n > 0) {
        cells.push(new d.TableCell({
          width: { size: unit * n, type: d.WidthType.DXA }, columnSpan: n, shading: { type: d.ShadingType.CLEAR, fill: color, color: "auto" },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          borders: { top: white, bottom: last && nS > 1 ? hair : white, left: none, right: none },
          children: [tiny(!(last && i === spec.labels.length - 1))],
        }));
      }
      cells.push(new d.TableCell({
        width: { size: unit * (K - n), type: d.WidthType.DXA }, columnSpan: K - n, verticalAlign: d.VerticalAlign.CENTER,
        margins: { top: 20, bottom: 20, left: 100, right: 0 },
        borders: edge,
        children: [new d.Paragraph({ keepNext: !(last && i === spec.labels.length - 1), spacing: { before: 0, after: 0, line: 240 }, children: [new d.TextRun({ text: valueText, size: 19, bold: true, color: "404040" })] })],
      }));
      rows.push(new d.TableRow({ cantSplit: true, height: { value: nS > 1 ? 300 : 360, rule: d.HeightRule.ATLEAST }, children: cells }));
    });
  });

  const out: Child[] = [];
  if (spec.title) out.push(new d.Paragraph({ keepNext: true, spacing: { before: 120, after: nS > 1 ? 40 : 100 }, children: [new d.TextRun({ text: spec.title, bold: true, size: 22, color: c.formal ? "000000" : th.dark })] }));
  if (nS > 1) {
    out.push(new d.Paragraph({
      keepNext: true, spacing: { before: 0, after: 100 },
      children: spec.series.flatMap((s, si) => [new d.TextRun({ text: "■ ", size: 20, color: colorOf(si, 0) }), new d.TextRun({ text: s.name + "     ", size: 19, color: GREY })]),
    }));
  }
  out.push(new d.Table({
    width: { size: c.width, type: d.WidthType.DXA }, columnWidths: widths, layout: d.TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows,
  }));
  out.push(source
    ? new d.Paragraph({ spacing: { before: 80, after: 220 }, children: [new d.TextRun({ text: `Nguồn: ${source}`, italics: true, size: 17, color: MUTED })] })
    : gap(c, 220));
  return out;
}

// ---- các khối còn lại của thân văn bản ----
/** Dựng một khối Markdown theo kiểu modern. null = để mã gọi tự xử (ngắt trang…). */
export function block(c: Ctx, b: Block, o: { first: boolean }): Child[] | null {
  const { d } = c;
  switch (b.t) {
    case "heading": {
      const lvl = Math.min(b.level, 3);
      const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][lvl - 1];
      return [new d.Paragraph({ heading, spacing: o.first ? { before: 0 } : undefined, children: mkRuns(c, b.runs) })];
    }
    case "para":
      return [new d.Paragraph({ alignment: algn(d, b.align), spacing: { before: 0, after: 140, line: 288 }, children: mkRuns(c, b.runs) })];
    case "quote":
      return quote(c, b.runs);
    case "code":
      return code(c, b.text);
    case "table":
      return table(c, b);
    case "list": {
      const ref = b.items.some((it) => it.ordered) ? c.orderedRef() : "bullets";
      return b.items.map((it, i) =>
        new d.Paragraph({ numbering: { reference: it.ordered ? ref : "bullets", level: it.level }, spacing: { before: 0, after: i === b.items.length - 1 ? 180 : 70, line: 288 }, children: mkRuns(c, it.runs) }),
      );
    }
    case "hr":
      return [new d.Paragraph({ border: { bottom: { style: SINGLE, size: 6, color: HAIR, space: 1 } }, spacing: { before: 120, after: 220 }, children: [] })];
    default:
      return null;
  }
}
