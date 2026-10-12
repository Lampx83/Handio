import { escapeHtml as esc } from "./html";
import { findMath, renderTex } from "./math";

function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/g)
    .map((part0, i) => {
      let part = part0;
      if (i % 2 === 1) return "<code>" + esc(part.slice(1, -1)) + "</code>";
      // công thức toán: thay bằng dấu giữ chỗ trước khi áp dụng in đậm/nghiêng (không để * _ trong công thức bị hiểu nhầm), dựng lại ở cuối
      const maths: string[] = [];
      const spans = findMath(part);
      if (spans.length) {
        let k = 0;
        let buf = "";
        for (const m of spans) {
          buf += part.slice(k, m.start) + "\u0000M" + maths.length + "\u0000";
          maths.push(renderTex(m.tex, m.display));
          k = m.end;
        }
        part = buf + part.slice(k);
      }
      part = part.replace(/\\\$/g, "$");
      let t = esc(part);
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
      t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
      return maths.length ? t.replace(/\u0000M(\d+)\u0000/g, (_m, n) => maths[Number(n)] ?? "") : t;
    })
    .join("");
}

const isTableSep = (l: string) => l.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Markdown tối giản và AN TOÀN: escape HTML trước, chỉ cho phép liên kết http(s). */
export function renderMarkdown(src: string): string {
  // <details><summary>…</summary>…</details>: do CHÚNG TA dựng thẻ, nội dung vẫn được escape/render an toàn
  if (/<details>/i.test(src)) {
    return src
      .split(/(<details>[\s\S]*?<\/details>)/i)
      .map((part) => {
        const m = /^<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>$/i.exec(part);
        return m ? `<details><summary>${inline(m[1].trim())}</summary>${renderMarkdown(m[2].trim())}</details>` : renderMarkdown(part.replace(/<\/?details>/gi, ""));
      })
      .join("");
  }
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<div class="code"><div class="code-h"><span>${esc(fence[1] || "mã")}</span><button type="button" data-copy>Sao chép</button></div><pre><code>${esc(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    // công thức khối: $$ … $$ hoặc \[ … \] (một dòng hoặc nhiều dòng), chỉ khi có dòng đóng
    const dm = /^\s*(\$\$|\\\[)(.*)$/.exec(line);
    if (dm) {
      const close = dm[1] === "$$" ? "$$" : "\\]";
      const body: string[] = [];
      let rest = dm[2];
      let j = i;
      let done = false;
      for (let n = 0; n < 80 && !done; n++) {
        const k = rest.indexOf(close);
        if (k >= 0) {
          body.push(rest.slice(0, k));
          done = rest.slice(k + close.length).trim() === "";
          if (!done) break; // chữ theo sau dấu đóng: để đoạn văn xử lý như công thức trong dòng
          continue;
        }
        body.push(rest);
        j++;
        if (j >= lines.length) break;
        rest = lines[j];
      }
      if (done && body.join("").trim()) {
        out.push('<div class="math-block">' + renderTex(body.join("\n"), true) + "</div>");
        i = j + 1;
        continue;
      }
    }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) {
      out.push(`<h${Math.min(hd[1].length + 2, 6)}>${inline(hd[2])}</h${Math.min(hd[1].length + 2, 6)}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push("<blockquote>" + inline(q.join(" ")) + "</blockquote>");
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m && /\d/.test(m[2]) === ordered) {
          items.push(inline(m[3]));
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += " " + inline(lines[i++].trim());
        else break;
      }
      out.push((ordered ? "<ol>" : "<ul>") + items.map((x) => `<li>${x}</li>`).join("") + (ordered ? "</ol>" : "</ul>"));
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|\$\$|\\\[|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]) && !(lines[i].includes("|") && lines[i + 1] && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    out.push("<p>" + para.map(inline).join("<br>") + "</p>");
  }
  return out.join("");
}

export { esc as escapeHtml };
