/** Markdown → khối cấu trúc, dùng chung cho Word và PowerPoint. Chỉ hỗ trợ phần Markdown văn phòng cần. */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}
export type Align = "left" | "center" | "right" | "justify";
export interface ListItem {
  level: number;
  ordered: boolean;
  runs: Run[];
}
export type Block =
  | { t: "heading"; level: number; runs: Run[] }
  | { t: "para"; runs: Run[]; align?: Align; /** Các dòng gốc khi đoạn gồm nhiều dòng liền nhau (không có dòng trống). */ lines?: string[] }
  | { t: "list"; items: ListItem[] }
  | { t: "table"; header: Run[][]; rows: Run[][][]; align: Align[] }
  | { t: "code"; text: string; lang?: string; info?: string }
  | { t: "quote"; runs: Run[] }
  | { t: "hr" }
  | { t: "pagebreak" };

export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const push = (r: Run) => {
    if (!r.text) return;
    const last = runs[runs.length - 1];
    if (last && !last.link && !r.link && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.code === !!r.code) last.text += r.text;
    else runs.push(r);
  };
  const re = /(`[^`\n]+`)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|((?<![\w])_[^_\n]+_(?![\w]))/g;
  let i = 0;
  for (const m of src.matchAll(re)) {
    push({ text: src.slice(i, m.index) });
    const t = m[0];
    if (m[1]) push({ text: t.slice(1, -1), code: true });
    else if (m[2]) {
      const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!;
      push({ text: mm[1], link: mm[2] });
    } else if (m[3]) push({ text: t.slice(3, -3), bold: true, italic: true });
    else if (m[4] || m[5]) push({ text: t.slice(2, -2), bold: true });
    else push({ text: t.slice(1, -1), italic: true });
    i = m.index! + t.length;
  }
  push({ text: src.slice(i) });
  return runs.length ? runs : [{ text: "" }];
}

const isSep = (l: string) => l.includes("-") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && (l.includes("|") || /^\s*:?-{3,}:?\s*$/.test(l));
const splitCells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*```\s*([\w-]*)[ \t]*(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push({ t: "code", text: code.join("\n"), ...(fence[1] ? { lang: fence[1].toLowerCase(), info: fence[2].trim() } : {}) });
      continue;
    }
    if (/^\s*(<<<\s*(pagebreak|page-break)\s*>>>|\\pagebreak|<pagebreak\s*\/?>)\s*$/i.test(line)) {
      out.push({ t: "pagebreak" });
      i++;
      continue;
    }
    const hd = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (hd) {
      out.push({ t: "heading", level: hd[1].length, runs: parseInline(hd[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    const al = /^\s*<(center|right|left|justify)>([\s\S]*?)<\/\1>\s*$/i.exec(line);
    if (al) {
      out.push({ t: "para", runs: parseInline(al[2]), align: al[1].toLowerCase() as Align });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", runs: parseInline(q.join(" ")) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitCells(line).map(parseInline);
      const align = splitCells(lines[i + 1]).map((c): Align => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : "left"));
      i += 2;
      const rows: Run[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitCells(lines[i++]).map(parseInline));
      out.push({ t: "table", header, rows, align });
      continue;
    }
    const li = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          const indent = m[1].replace(/\t/g, "    ").length;
          items.push({ level: Math.min(Math.floor(indent / 2), 3), ordered: /\d/.test(m[2]), runs: parseInline(m[3]) });
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length && !/^\s*(```|#)/.test(lines[i])) {
          items[items.length - 1].runs.push(...parseInline(" " + lines[i++].trim()));
        } else break;
      }
      out.push({ t: "list", items });
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*+•]|\d+[.)])\s|<(center|right|left|justify)>)/.test(lines[i]) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) && !(lines[i].includes("|") && lines[i + 1] && isSep(lines[i + 1]))) para.push(lines[i++].trim());
    out.push({ t: "para", runs: parseInline(para.join(" ")), ...(para.length > 1 ? { lines: para } : {}) });
  }
  return out;
}

export const runsText = (runs: Run[]): string => runs.map((r) => r.text).join("");
