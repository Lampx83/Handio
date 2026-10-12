import { escapeHtml as esc } from "./html";
import { findMath, renderTex } from "./math";
import { highlight } from "./highlight";
import { CHECK_ICON, COPY_ICON } from "./copy";

/** Giữ chỗ cho đoạn HTML đã dựng an toàn (công thức, liên kết, ảnh) để các bước định dạng sau không đụng vào. */
class Stash {
  private items: string[] = [];
  hold(html: string): string {
    return "\u0000" + (this.items.push(html) - 1) + "\u0000";
  }
  restore(s: string): string {
    for (let k = 0; k < 4 && s.includes("\u0000"); k++) s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => this.items[Number(n)] ?? "");
    return s;
  }
}

const SAFE_TAGS = "b|i|u|em|strong|del|ins|mark|kbd|sub|sup|small|code";

/** Đường dẫn ảnh trong dự án: tương đối, không có giao thức, không nhảy ra ngoài. */
const localImage = (src: string): boolean => !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//") && !/(^|[\\/])\.\.([\\/]|$)/.test(src) && /\.(png|jpe?g|gif|webp|svg)$/i.test(src);

function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/g)
    .map((part0, i) => {
      let part = part0;
      if (i % 2 === 1) return "<code>" + esc(part.slice(1, -1)) + "</code>";
      const st = new Stash();
      // công thức toán: giữ chỗ trước khi áp dụng in đậm/nghiêng (không để * _ trong công thức bị hiểu nhầm), dựng lại ở cuối
      const spans = findMath(part);
      if (spans.length) {
        let k = 0;
        let buf = "";
        for (const m of spans) {
          buf += part.slice(k, m.start) + st.hold(renderTex(m.tex, m.display));
          k = m.end;
        }
        part = buf + part.slice(k);
      }
      part = part.replace(/\\\$/g, "$");
      let t = esc(part);
      // ảnh: ![mô tả](đường dẫn). Ảnh từ mạng KHÔNG được tải (nội dung do mô hình sinh ra không được phép gọi ra ngoài): hiện thành liên kết.
      t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_m, alt: string, src: string) => {
        const url = src.replace(/&amp;/g, "&");
        if (/^https?:\/\//i.test(url)) return st.hold(`<a href="${src}" target="_blank" rel="noopener noreferrer">🖼 ${alt || "ảnh"}</a>`);
        if (localImage(url)) return st.hold(`<img class="md-img" data-path="${src}" alt="${alt}">`);
        return alt || "ảnh";
      });
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => st.hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`));
      // địa chỉ trần: https://…
      t = t.replace(/(^|[\s(])(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]])/g, (_m, pre: string, url: string) => pre + st.hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
      t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
      t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
      t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
      // vài thẻ HTML an toàn KHÔNG thuộc tính, chỉ khi có cặp mở/đóng (không sinh thẻ mở dở làm lệch phần sau)
      t = t.replace(new RegExp(`&lt;(${SAFE_TAGS})&gt;([\\s\\S]*?)&lt;\\/\\1&gt;`, "gi"), (_m, tag: string, body: string) => `<${tag.toLowerCase()}>${body}</${tag.toLowerCase()}>`);
      t = t.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
      return st.restore(t);
    })
    .join("");
}

const isTableSep = (l: string) => l.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string): string[] => l.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const alignOf = (c: string): string => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : "");

const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const width = (s: string) => s.replace(/\t/g, "    ").length;

/** Khối ghi chú kiểu GitHub: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]. */
const CALLOUT: Record<string, [string, string]> = {
  NOTE: ["note", "ℹ️ Ghi chú"], TIP: ["tip", "💡 Mẹo"], IMPORTANT: ["important", "❗ Quan trọng"], WARNING: ["warning", "⚠️ Cảnh báo"], CAUTION: ["caution", "🛑 Thận trọng"],
};

const taskItem = (text: string): string => {
  const m = /^\[( |x|X)\]\s+(.*)$/.exec(text);
  return m ? `<span class="task${m[1] === " " ? "" : " done"}">${m[1] === " " ? "☐" : "☑"}</span> ${inline(m[2])}` : inline(text);
};

/** Danh sách (có lồng nhau, có dòng trống giữa các mục, số bắt đầu bất kỳ). */
function parseList(lines: string[], start: number): { html: string; next: number } {
  const first = LI.exec(lines[start])!;
  const base = width(first[1]);
  const ordered = /\d/.test(first[2]);
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    let m = LI.exec(lines[i]);
    if (!m && !lines[i].trim()) {
      // một dòng trống giữa hai mục cùng cấp (hoặc mục con): vẫn là cùng một danh sách
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const nm = j < lines.length && j - i <= 1 ? LI.exec(lines[j]) : null;
      if (nm && (width(nm[1]) > base || (width(nm[1]) === base && /\d/.test(nm[2]) === ordered))) {
        i = j;
        m = nm;
      } else break;
    }
    if (!m) {
      // dòng tiếp của mục trước (thụt vào)
      if (items.length && width(/^\s*/.exec(lines[i])![0]) > base && !/^\s*(```|#{1,6}\s|>)/.test(lines[i])) {
        items[items.length - 1] += " " + inline(lines[i++].trim());
        continue;
      }
      break;
    }
    const ind = width(m[1]);
    if (ind < base) break;
    if (ind > base && items.length) {
      const sub = parseList(lines, i);
      items[items.length - 1] += sub.html;
      i = sub.next;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    items.push(taskItem(m[3]));
    i++;
  }
  const n = ordered ? parseInt(first[2], 10) : 1;
  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}${ordered && n > 1 ? ` start="${n}"` : ""}>` + items.map((x) => `<li>${x}</li>`).join("") + `</${tag}>`, next: i };
}

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
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)[^\n]*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !new RegExp("^\\s*" + fence[1] + "\\s*$").test(lines[i])) code.push(lines[i++]);
      i++;
      const lang = fence[2] || "";
      out.push(`<div class="code"><div class="code-h"><span>${esc(lang || "mã")}</span><button type="button" data-copy title="Sao chép" aria-label="Sao chép">${COPY_ICON}${CHECK_ICON}</button></div><pre><code>${highlight(code.join("\n"), lang)}</code></pre></div>`);
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
    if (/^\s*<<<\s*pagebreak\s*>>>\s*$/i.test(line)) {
      out.push('<div class="pagebreak"><span>ngắt trang</span></div>');
      i++;
      continue;
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
      const tag = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(q[0] ?? "");
      if (tag) {
        const [cls, label] = CALLOUT[tag[1].toUpperCase()];
        out.push(`<div class="callout ${cls}"><div class="callout-t">${label}</div>${renderMarkdown(q.slice(1).join("\n"))}</div>`);
      } else out.push("<blockquote>" + renderMarkdown(q.join("\n")) + "</blockquote>");
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const al = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag: string, c: string, k: number) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ""}>${inline(c)}</${tag}>`;
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c, k) => cell("th", c, k)).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c, k) => cell("td", c, k)).join("") + "</tr>").join("") + "</tbody></table></div>");
      continue;
    }
    if (LI.test(line)) {
      const l = parseList(lines, i);
      out.push(l.html);
      i = l.next;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|\$\$|\\\[|<<<|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]) && !(lines[i].includes("|") && lines[i + 1] && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    out.push("<p>" + para.map(inline).join("<br>") + "</p>");
  }
  return out.join("");
}

export { esc as escapeHtml };
