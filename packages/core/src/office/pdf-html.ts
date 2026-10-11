import { colorHex } from "./colors";
import { parseChart, type ChartSpec } from "./chart";
import { parseBlocks, runsText, type Block, type Run } from "./mdblocks";

/**
 * Dựng HTML trình bày đẹp (A4, phông hệ thống có dấu tiếng Việt) từ Markdown để Desktop in thành PDF bằng Chromium (create_pdf).
 * Không script, không tài nguyên ngoài; biểu đồ là SVG nội tuyến. Chữ trong Markdown luôn được escape (không chèn HTML thô).
 */
export interface PdfDocOptions {
  content: string;
  title?: string;
  subtitle?: string;
  /** Dòng nhỏ dưới tiêu đề: tác giả, đơn vị, ngày. */
  meta?: string;
  /** Màu nhấn #RRGGBB hoặc tên màu; mặc định xanh đậm. */
  accent?: string;
  toc?: boolean;
  landscape?: boolean;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function mix(hex: string, white: number): string {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return c.map((v) => Math.round(v + (255 - v) * white).toString(16).padStart(2, "0")).join("");
}

const runsHtml = (runs: Run[]): string =>
  runs
    .map((r) => {
      let t = esc(r.text).replace(/\n/g, "<br>");
      if (r.code) t = `<code>${t}</code>`;
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      if (r.link && /^https?:\/\//i.test(r.link)) t = `<a href="${esc(r.link)}">${t}</a>`;
      return t;
    })
    .join("");

const fmt = (n: number): string => (Math.abs(n) >= 1000 ? n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : String(Math.round(n * 100) / 100).replace(".", ","));

/** Biểu đồ SVG nội tuyến (cột, ngang, đường, vùng, tròn, vành). */
export function chartSvg(c: ChartSpec, accent: string): string {
  const pal = [accent, "F2B134", "2E9E6B", "C8442F", "7A5BB5", "4FA3C7"].map((x) => "#" + x);
  const W = 640;
  const font = `font-family="Segoe UI, -apple-system, Roboto, Arial, sans-serif"`;
  const title = c.title ? `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="700" fill="#1f2937" ${font}>${esc(c.title)}</text>` : "";
  const top = c.title ? 40 : 14;
  const legend = (items: { name: string; color: string }[], y: number) =>
    items.map((it, i) => `<g transform="translate(${60 + i * 150},${y})"><rect width="12" height="12" rx="3" fill="${it.color}"/><text x="18" y="10.5" font-size="12" fill="#374151" ${font}>${esc(it.name.slice(0, 18))}</text></g>`).join("");
  if (c.kind === "pie" || c.kind === "doughnut") {
    const vals = c.series[0].values.map((v) => Math.max(0, v));
    const sum = vals.reduce((s, v) => s + v, 0) || 1;
    const cx = 170;
    const cy = top + 130;
    const R = 115;
    let a = -Math.PI / 2;
    const arcs = vals.map((v, i) => {
      const da = (v / sum) * Math.PI * 2;
      const x1 = cx + R * Math.cos(a);
      const y1 = cy + R * Math.sin(a);
      a += da;
      const x2 = cx + R * Math.cos(a);
      const y2 = cy + R * Math.sin(a);
      return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${da > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${pal[i % pal.length]}" stroke="#fff" stroke-width="2"/>`;
    });
    const hole = c.kind === "doughnut" ? `<circle cx="${cx}" cy="${cy}" r="${R * 0.55}" fill="#fff"/>` : "";
    const items = c.labels.map((l, i) => `<g transform="translate(340,${top + 20 + i * 24})"><rect width="12" height="12" rx="3" fill="${pal[i % pal.length]}"/><text x="20" y="11" font-size="13" fill="#1f2937" ${font}>${esc(l.slice(0, 26))} — ${fmt(vals[i])} (${Math.round((vals[i] / sum) * 100)}%)</text></g>`).join("");
    const H = Math.max(top + 270, top + 40 + c.labels.length * 24);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(c.title || "Biểu đồ")}">${title}${arcs.join("")}${hole}${items}</svg>`;
  }
  const n = c.labels.length;
  const all = c.series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const niceStep = (() => {
    const raw = span / 5;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  })();
  const hi = Math.ceil(max / niceStep) * niceStep;
  const lo = Math.floor(min / niceStep) * niceStep;
  const rng = hi - lo || 1;
  const showLegend = c.series.length > 1;
  if (c.kind === "barh") {
    const left = 120;
    const right = W - 30;
    const rowH = Math.min(34, Math.max(20, 260 / n));
    const H = top + n * rowH + 50;
    const x = (v: number) => left + ((v - lo) / rng) * (right - left);
    let g = "";
    for (let v = lo; v <= hi + 1e-9; v += niceStep) g += `<line x1="${x(v)}" y1="${top}" x2="${x(v)}" y2="${top + n * rowH}" stroke="#e5e7eb"/><text x="${x(v)}" y="${top + n * rowH + 16}" text-anchor="middle" font-size="11" fill="#6b7280" ${font}>${fmt(v)}</text>`;
    c.labels.forEach((l, i) => {
      g += `<text x="${left - 8}" y="${top + i * rowH + rowH / 2 + 4}" text-anchor="end" font-size="12" fill="#1f2937" ${font}>${esc(l.slice(0, 20))}</text>`;
      c.series.forEach((s, k) => {
        const bh = (rowH - 8) / c.series.length;
        const v = s.values[i];
        g += `<rect x="${x(Math.min(0, v))}" y="${top + i * rowH + 4 + k * bh}" width="${Math.max(1, Math.abs(x(v) - x(0)))}" height="${bh - 2}" rx="3" fill="${pal[k % pal.length]}"/><text x="${x(Math.max(0, v)) + 6}" y="${top + i * rowH + 4 + k * bh + bh / 2 + 3}" font-size="11" fill="#374151" ${font}>${fmt(v)}</text>`;
      });
    });
    return `<svg viewBox="0 0 ${W} ${H + (showLegend ? 24 : 0)}" width="100%" role="img" aria-label="${esc(c.title || "Biểu đồ")}">${title}${g}${showLegend ? legend(c.series.map((s, k) => ({ name: s.name, color: pal[k % pal.length] })), H) : ""}</svg>`;
  }
  const left = 56;
  const right = W - 20;
  const plotH = 230;
  const H = top + plotH + 60;
  const y = (v: number) => top + plotH - ((v - lo) / rng) * plotH;
  const bandW = (right - left) / n;
  let g = "";
  for (let v = lo; v <= hi + 1e-9; v += niceStep) g += `<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="#e5e7eb"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b7280" ${font}>${fmt(v)}</text>`;
  c.labels.forEach((l, i) => (g += `<text x="${left + bandW * (i + 0.5)}" y="${top + plotH + 18}" text-anchor="middle" font-size="12" fill="#1f2937" ${font}>${esc(l.length > 12 && n > 6 ? l.slice(0, 11) + "…" : l.slice(0, 18))}</text>`));
  if (c.kind === "bar") {
    const gw = bandW * 0.7;
    const bw = gw / c.series.length;
    c.series.forEach((s, k) =>
      s.values.forEach((v, i) => {
        const x0 = left + bandW * i + (bandW - gw) / 2 + k * bw;
        g += `<rect x="${x0.toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(1, Math.abs(y(v) - y(0))).toFixed(1)}" rx="3" fill="${pal[k % pal.length]}"/>`;
        if (n <= 12) g += `<text x="${(x0 + bw / 2 - 1).toFixed(1)}" y="${(Math.min(y(v), y(0)) - 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="#374151" ${font}>${fmt(v)}</text>`;
      }),
    );
  } else {
    c.series.forEach((s, k) => {
      const pts = s.values.map((v, i) => `${(left + bandW * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
      const col = pal[k % pal.length];
      if (c.kind === "area") g += `<polygon points="${left + bandW * 0.5},${y(0)} ${pts.join(" ")} ${left + bandW * (n - 0.5)},${y(0)}" fill="${col}" opacity="0.25"/>`;
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/>`;
      s.values.forEach((v, i) => {
        g += `<circle cx="${(left + bandW * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#fff" stroke="${col}" stroke-width="2.5"/>`;
        if (n <= 12) g += `<text x="${(left + bandW * (i + 0.5)).toFixed(1)}" y="${(y(v) - 9).toFixed(1)}" text-anchor="middle" font-size="11" fill="#374151" ${font}>${fmt(v)}</text>`;
      });
    });
  }
  return `<svg viewBox="0 0 ${W} ${H + (showLegend ? 24 : 0)}" width="100%" role="img" aria-label="${esc(c.title || "Biểu đồ")}">${title}${g}${showLegend ? legend(c.series.map((s, k) => ({ name: s.name, color: pal[k % pal.length] })), H - 4) : ""}</svg>`;
}

const CALLOUT: [RegExp, string][] = [
  [/^(lưu ý|chú ý|note)(?![\p{L}])/iu, "note"],
  [/^(mẹo|gợi ý|tip)(?![\p{L}])/iu, "tip"],
  [/^(cảnh báo|quan trọng|warning|important)(?![\p{L}])/iu, "warn"],
];

export function buildPdfHtml(o: PdfDocOptions): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  const accent = o.accent ? colorHex(o.accent) : "1F3864";
  if (!accent) throw new Error(`Không hiểu màu “${o.accent}” (dùng #RRGGBB hoặc tên màu thông dụng).`);
  const soft = mix(accent, 0.92);
  const mid = mix(accent, 0.75);
  const blocks = parseBlocks(o.content);
  const heads: { level: number; id: string; text: string }[] = [];
  let hn = 0;
  const html: string[] = [];
  const num = (b: Extract<Block, { t: "table" }>, c: number) => b.rows.every((r) => /^[\s+\-−]?[\d.,]+\s*(%|đ|₫|tr|tỷ)?$/.test(runsText(r[c] ?? [])) && runsText(r[c] ?? []).trim() !== "");
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t === "heading") {
      const level = Math.min(3, Math.max(1, b.level));
      const id = `h${++hn}`;
      heads.push({ level, id, text: runsText(b.runs) });
      html.push(`<h${level} id="${id}">${runsHtml(b.runs)}</h${level}>`);
    } else if (b.t === "para") {
      const align = b.align && b.align !== "left" ? ` style="text-align:${b.align}"` : "";
      html.push(`<p${align}>${runsHtml(b.runs)}</p>`);
    } else if (b.t === "list") {
      // nhóm theo cấp, dựng danh sách lồng nhau đơn giản
      let out = "";
      const stack: { tag: string }[] = [];
      for (const it of b.items) {
        const tag = it.ordered ? "ol" : "ul";
        while (stack.length > it.level + 1) out += `</li></${stack.pop()!.tag}>`;
        if (stack.length === it.level + 1) out += "</li>";
        while (stack.length < it.level + 1) {
          out += `<${tag}>`;
          stack.push({ tag });
        }
        out += `<li>${runsHtml(it.runs)}`;
      }
      while (stack.length) out += `</li></${stack.pop()!.tag}>`;
      html.push(out);
    } else if (b.t === "table") {
      const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
      const al = (c: number) => (b.align[c] === "center" || b.align[c] === "right" ? b.align[c] : num(b, c) ? "right" : "left"); // cột toàn số tự căn phải
      html.push(
        `<table><thead><tr>${Array.from({ length: cols }, (_, c) => `<th style="text-align:${al(c) === "left" ? "left" : al(c)}">${runsHtml(b.header[c] ?? [])}</th>`).join("")}</tr></thead><tbody>${b.rows
          .map((r) => `<tr>${Array.from({ length: cols }, (_, c) => `<td style="text-align:${al(c)}">${runsHtml(r[c] ?? [])}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
    } else if (b.t === "quote") {
      const text = runsText(b.runs);
      const kind = CALLOUT.find(([re]) => re.test(text.replace(/^\*+/, "")))?.[1];
      html.push(`<blockquote${kind ? ` class="callout ${kind}"` : ""}>${runsHtml(b.runs)}</blockquote>`);
    } else if (b.t === "code" && b.lang === "chart") {
      const spec = parseChart(b.text, b.info ?? "");
      if ("error" in spec) {
        warnings.push(`Biểu đồ lỗi: ${spec.error}.`);
        html.push(`<p class="err">[Biểu đồ không tạo được: ${esc(spec.error)}]</p>`);
      } else html.push(`<figure>${chartSvg(spec, accent)}</figure>`);
    } else if (b.t === "code") html.push(`<pre><code>${esc(b.text)}</code></pre>`);
    else if (b.t === "hr") html.push("<hr>");
    else if (b.t === "pagebreak") html.push('<div class="pb"></div>');
  }
  const toc = o.toc && heads.length >= 3 ? `<nav class="toc"><div class="toc-t">Mục lục</div>${heads.filter((h) => h.level <= 2).map((h) => `<a class="l${h.level}" href="#${h.id}">${esc(h.text)}</a>`).join("")}</nav>` : "";
  const head = o.title
    ? `<header class="doc"><div class="bar"></div><h1 class="doc-title">${esc(o.title)}</h1>${o.subtitle ? `<div class="doc-sub">${esc(o.subtitle)}</div>` : ""}${o.meta ? `<div class="doc-meta">${esc(o.meta)}</div>` : ""}</header>`
    : "";
  const css = `
@page { size: A4 ${o.landscape ? "landscape" : "portrait"}; margin: 20mm 18mm 22mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-scheme: light; background: #fff; }
body { margin: 0 auto; max-width: 794px; padding: 0; background: #fff; font: 10.5pt/1.6 "Segoe UI", -apple-system, "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; }
header.doc { margin: 0 0 8mm; padding-bottom: 5mm; border-bottom: 1px solid #${mid}; }
header.doc .bar { width: 22mm; height: 3mm; background: #${accent}; border-radius: 2mm; margin-bottom: 4mm; }
.doc-title { font-size: 25pt; line-height: 1.2; margin: 0; color: #${accent}; letter-spacing: -0.01em; }
.doc-sub { font-size: 13pt; color: #4b5563; margin-top: 2mm; }
.doc-meta { font-size: 9.5pt; color: #6b7280; margin-top: 3mm; }
h1, h2, h3 { color: #${accent}; line-height: 1.25; break-after: avoid; }
h1 { font-size: 17pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid #${mid}; }
h2 { font-size: 13.5pt; margin: 7mm 0 2.5mm; }
h3 { font-size: 11.5pt; margin: 5mm 0 2mm; }
p { margin: 0 0 3mm; text-align: left; }
ul, ol { margin: 0 0 3.5mm; padding-left: 6mm; }
li { margin: 0 0 1.2mm; }
li::marker { color: #${accent}; }
a { color: #${accent}; }
code { font: 9.5pt Consolas, "SF Mono", Menlo, monospace; background: #f3f4f6; padding: 0 1mm; border-radius: 1mm; }
pre { background: #f3f4f6; border-left: 3px solid #${accent}; padding: 3mm 4mm; margin: 0 0 4mm; border-radius: 0 2mm 2mm 0; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 5mm; font-size: 9.8pt; break-inside: avoid; }
th { background: #${accent}; color: #fff; text-align: left; padding: 2.2mm 3mm; font-weight: 600; }
td { padding: 2mm 3mm; border-bottom: 1px solid #e5e7eb; }
tbody tr:nth-child(even) td { background: #${soft}; }
blockquote { margin: 0 0 4mm; padding: 3mm 4mm; border-left: 4px solid #${accent}; background: #${soft}; border-radius: 0 2mm 2mm 0; font-style: italic; break-inside: avoid; }
blockquote.callout { font-style: normal; }
blockquote.note { border-color: #2563eb; background: #eff6ff; }
blockquote.tip { border-color: #16a34a; background: #f0fdf4; }
blockquote.warn { border-color: #d97706; background: #fffbeb; }
figure { margin: 2mm 0 5mm; break-inside: avoid; }
hr { border: 0; border-top: 1px solid #d1d5db; margin: 5mm 0; }
.pb { break-after: page; }
.err { color: #b00020; }
.toc { margin: 0 0 7mm; padding: 4mm 5mm; background: #${soft}; border-radius: 2mm; break-inside: avoid; }
.toc-t { font-weight: 700; color: #${accent}; margin-bottom: 2mm; }
.toc a { display: block; text-decoration: none; color: #1f2937; padding: 0.6mm 0; }
.toc a.l2 { padding-left: 5mm; color: #4b5563; }
`;
  return { html: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(o.title ?? "Tài liệu")}</title><style>${css}</style></head><body>${head}${toc}${html.join("\n")}</body></html>`, warnings };
}
