/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadZip, decodeXml } from "./docx-read";
import { parseChart, type ChartSpec } from "./chart";
import { parseBlocks, runsText, type Block, type Run } from "./mdblocks";

export interface PptxOptions {
  /** Markdown: các slide ngăn cách bằng dòng `---`. Slide đầu `# Tiêu đề` + dòng phụ = slide bìa. Dòng "Ghi chú: …" = ghi chú người trình bày. */
  content: string;
  /** Tên hiển thị ở chân slide (mặc định rỗng). */
  footer?: string;
}

const NAVY = "0B4A9E";
const FONT = "Calibri";

interface SlideSpec {
  title: string;
  blocks: Block[];
  notes: string;
  cover: boolean;
}

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
      let rest = hi >= 0 ? [...g.slice(0, hi), ...g.slice(hi + 1)] : g;
      let notes = "";
      rest = rest.filter((b) => {
        if (b.t === "para") {
          const m = /^(ghi chú|notes?|speaker notes?)\s*[:：]\s*([\s\S]*)$/i.exec(runsText(b.runs));
          if (m) {
            notes += (notes ? "\n" : "") + m[2];
            return false;
          }
        }
        return true;
      });
      const cover = idx === 0 && hi >= 0 && (g[hi] as Extract<Block, { t: "heading" }>).level === 1 && rest.every((b) => b.t === "para");
      return { title, blocks: rest, notes, cover };
    });
}

const textOfRuns = (runs: Run[]) => runs.map((r) => ({ text: r.text, options: { bold: r.bold, italic: r.italic, fontFace: r.code ? "Consolas" : undefined, hyperlink: r.link ? { url: r.link } : undefined } }));

export async function createPptx(o: PptxOptions): Promise<{ bytes: Uint8Array; slides: number; warnings: string[] }> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = "NEU Agent";
  pptx.defineSlideMaster({
    title: "MASTER",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.16, fill: { color: NAVY } } },
      ...(o.footer ? [{ text: { text: o.footer, options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 11, color: "808080", fontFace: FONT } } }] : []),
    ],
    slideNumber: { x: 12.3, y: 7.0, w: 0.6, h: 0.3, fontSize: 11, color: "808080", fontFace: FONT },
  });
  const specs = parseSlides(o.content);
  if (!specs.length) throw new Error("Nội dung trống: cần ít nhất một slide.");
  const warnings: string[] = [];

  specs.forEach((sp, idx) => {
    const slide = pptx.addSlide({ masterName: "MASTER" });
    if (sp.cover) {
      slide.background = { color: NAVY };
      slide.addText(sp.title, { x: 0.9, y: 2.3, w: 11.5, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", align: "left", valign: "bottom", fit: "shrink" });
      const sub = sp.blocks.filter((b): b is Extract<Block, { t: "para" }> => b.t === "para").map((b) => runsText(b.runs)).join("\n");
      if (sub) slide.addText(sub, { x: 0.9, y: 4.1, w: 11.5, h: 1.6, fontFace: FONT, fontSize: 22, color: "DCE6F5", align: "left", valign: "top", fit: "shrink" });
      slide.addShape("rect", { x: 0.9, y: 4.0, w: 1.6, h: 0.06, fill: { color: "F2B134" }, line: { color: "F2B134" } });
    } else {
      if (sp.title) slide.addText(sp.title, { x: 0.6, y: 0.35, w: 12.1, h: 0.95, fontFace: FONT, fontSize: sp.title.length > 60 ? 24 : 30, bold: true, color: NAVY, valign: "middle", fit: "shrink" });
      // ước lượng chiều cao nội dung để chọn cỡ chữ
      const W = 12.1;
      const H = 5.4;
      const est = (fs: number) => {
        let h = 0;
        for (const b of sp.blocks) {
          const cpl = Math.max(20, Math.floor((W * 72) / (fs * 0.52)));
          const lh = (fs * 1.45) / 72;
          if (b.t === "list") h += b.items.reduce((s, it) => s + Math.max(1, Math.ceil((runsText(it.runs).length + it.level * 4) / (cpl - 6))) * lh + 0.08, 0) + 0.1;
          else if (b.t === "para" || b.t === "quote") h += Math.max(1, Math.ceil(runsText(b.runs).length / cpl)) * lh + 0.12;
          else if (b.t === "code" && b.lang === "chart") h += 4.4;
          else if (b.t === "code") h += (b.text.split("\n").length + 0.5) * ((fs - 2) * 1.35) / 72;
          else if (b.t === "table") h += (b.rows.length + 1) * (((fs - 2) * 1.5) / 72 + 0.12) + 0.15;
        }
        return h;
      };
      let fs = 28;
      while (fs > 12 && est(fs) > H) fs -= 2;
      if (est(fs) > H) warnings.push(`Slide ${idx + 1}${sp.title ? ` “${sp.title}”` : ""}: nhiều nội dung, có thể bị tràn — nên tách thành 2 slide.`);
      let y = 1.5;
      for (const b of sp.blocks) {
        const cpl = Math.max(20, Math.floor((W * 72) / (fs * 0.52)));
        const lh = (fs * 1.45) / 72;
        if (b.t === "list") {
          const runs: any[] = [];
          b.items.forEach((it, i) => {
            const rs = textOfRuns(it.runs);
            rs.forEach((r, k) => runs.push({ text: r.text, options: { ...r.options, ...(k === 0 ? { bullet: it.ordered ? { type: "number" } : { code: "2022" }, indentLevel: it.level } : {}), breakLine: k === rs.length - 1 && i < b.items.length - 1, paraSpaceAfter: 6, fontSize: fs - it.level * 2 } }));
          });
          const h = b.items.reduce((s, it) => s + Math.max(1, Math.ceil((runsText(it.runs).length + it.level * 4) / (cpl - 6))) * lh + 0.08, 0) + 0.1;
          slide.addText(runs, { x: 0.7, y, w: W - 0.2, h, fontFace: FONT, color: "222222", valign: "top", fit: "shrink" });
          y += h;
        } else if (b.t === "para" || b.t === "quote") {
          const h = Math.max(1, Math.ceil(runsText(b.runs).length / cpl)) * lh + 0.12;
          slide.addText(textOfRuns(b.runs) as any, { x: 0.7, y, w: W - 0.2, h, fontFace: FONT, fontSize: fs, color: b.t === "quote" ? "555555" : "222222", italic: b.t === "quote", align: b.t === "para" && b.align && b.align !== "justify" ? b.align : "left", valign: "top", fit: "shrink" });
          y += h;
        } else if (b.t === "code" && b.lang === "chart") {
          const spec = parseChart(b.text, b.info ?? "");
          if ("error" in spec) {
            warnings.push(`Slide ${idx + 1}: biểu đồ lỗi — ${spec.error}.`);
            slide.addText(`[Biểu đồ không tạo được: ${spec.error}]`, { x: 0.7, y, w: W - 0.2, h: 0.5, fontFace: FONT, fontSize: 14, color: "B00020" });
            y += 0.6;
          } else {
            addChart(pptx, slide, spec, 0.7, y, W - 0.2, Math.min(4.4, Math.max(2.5, 6.9 - y)));
            y += Math.min(4.4, Math.max(2.5, 6.9 - y)) + 0.1;
          }
        } else if (b.t === "code") {
          const h = (b.text.split("\n").length + 0.5) * ((fs - 2) * 1.35) / 72;
          slide.addText(b.text, { x: 0.7, y, w: W - 0.2, h, fontFace: "Consolas", fontSize: fs - 4, color: "222222", fill: { color: "F2F2F2" }, valign: "top", fit: "shrink" });
          y += h + 0.1;
        } else if (b.t === "table") {
          const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
          const cell = (runs: Run[], head: boolean, i: number) => ({ text: runsText(runs), options: { bold: head || runs.some((r) => r.bold), color: head ? "FFFFFF" : "222222", fill: { color: head ? NAVY : "FFFFFF" }, align: head ? "center" : b.align[i] ?? "left", valign: "middle" } });
          const pad = (row: Run[][]) => Array.from({ length: cols }, (_, i) => row[i] ?? [{ text: "" }]);
          const rows = [pad(b.header).map((c, i) => cell(c, true, i)), ...b.rows.map((r) => pad(r).map((c, i) => cell(c, false, i)))];
          const rowH = ((fs - 2) * 1.5) / 72 + 0.12;
          slide.addTable(rows as any, { x: 0.7, y, w: W - 0.2, colW: Array(cols).fill((W - 0.2) / cols), fontFace: FONT, fontSize: fs - 2, border: { type: "solid", pt: 0.75, color: "BFBFBF" }, rowH, margin: 0.06 } as any);
          y += rows.length * rowH + 0.15;
        }
      }
    }
    if (sp.notes) slide.addNotes(sp.notes);
  });
  const out: any = await pptx.write({ outputType: "uint8array" });
  return { bytes: out instanceof Uint8Array ? out : new Uint8Array(out), slides: specs.length, warnings };
}

const CHART_COLORS = ["0B4A9E", "F2B134", "2E9E6B", "C8442F", "7A5BB5", "4FA3C7"];

function addChart(pptx: any, slide: any, c: ChartSpec, x: number, y: number, w: number, h: number): void {
  const T = pptx.charts;
  const type = c.kind === "line" ? T.LINE : c.kind === "pie" ? T.PIE : c.kind === "doughnut" ? T.DOUGHNUT : c.kind === "area" ? T.AREA : T.BAR;
  const pie = c.kind === "pie" || c.kind === "doughnut";
  const data = (pie ? c.series.slice(0, 1) : c.series).map((s) => ({ name: s.name, labels: c.labels, values: s.values }));
  slide.addChart(type, data, {
    x, y, w, h, fontFace: FONT, chartColors: pie ? c.labels.map((_l, i) => CHART_COLORS[i % CHART_COLORS.length]) : CHART_COLORS.slice(0, data.length),
    showTitle: !!c.title, title: c.title, titleFontSize: 16, titleColor: "333333",
    showLegend: pie || data.length > 1, legendPos: "b", legendFontSize: 12,
    showValue: c.labels.length <= 12, dataLabelFontSize: 11, dataLabelFormatCode: "#,##0.##",
    catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, valGridLine: { color: "E5E5E5", size: 0.5 },
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
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +/(\d+)\.xml$/.exec(a)![1] - +/(\d+)\.xml$/.exec(b)![1]);
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
