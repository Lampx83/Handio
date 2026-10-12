// Công thức toán trong câu trả lời: $x^2$, $$…$$, \( … \), \[ … \].
// Dựng bằng KaTeX ở dạng MathML thuần (không cần CSS/phông riêng: Chromium/Safari/Firefox đều vẽ MathML), không tin cậy lệnh nguy hiểm
// (\href, \includegraphics…), giới hạn độ lớn để một công thức độc không treo giao diện. Lỗi cú pháp: hiện nguyên mã, không ném lỗi.
import katex from "katex";
import { escapeHtml } from "./html";

const MAX_TEX = 4000;

export function renderTex(tex: string, display: boolean): string {
  const src = tex.trim();
  if (!src || src.length > MAX_TEX) return escapeHtml((display ? "$$" : "$") + tex + (display ? "$$" : "$"));
  try {
    return katex.renderToString(src, { displayMode: display, output: "mathml", throwOnError: false, errorColor: "#e5484d", strict: "ignore", trust: false, maxSize: 30, maxExpand: 1000 });
  } catch {
    return escapeHtml(src);
  }
}

export interface MathSpan {
  start: number;
  end: number; // loại trừ
  tex: string;
  display: boolean;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Tìm các đoạn công thức trong MỘT dòng chữ (đã bỏ phần mã `…`). `$5 và $10` (tiền) không bị nhận nhầm. */
export function findMath(s: string): MathSpan[] {
  const out: MathSpan[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "$") {
      i += 2; // \$ là ký tự đô la
      continue;
    }
    if (c === "$" && s[i + 1] === "$") {
      const j = s.indexOf("$$", i + 2);
      if (j > i + 2 && s.slice(i + 2, j).trim()) {
        out.push({ start: i, end: j + 2, tex: s.slice(i + 2, j), display: true });
        i = j + 2;
        continue;
      }
    } else if (c === "\\" && (s[i + 1] === "(" || s[i + 1] === "[")) {
      const close = s[i + 1] === "(" ? "\\)" : "\\]";
      const j = s.indexOf(close, i + 2);
      if (j > i + 2) {
        out.push({ start: i, end: j + 2, tex: s.slice(i + 2, j), display: s[i + 1] === "[" });
        i = j + 2;
        continue;
      }
    } else if (c === "$" && !isSpace(s[i + 1])) {
      // mở bằng $ liền chữ; đóng bằng $ liền sau chữ và không đứng trước chữ số (tránh "$5 … $10")
      let j = i + 1;
      let found = -1;
      while (j < s.length && j - i < 500) {
        if (s[j] === "\\") {
          j += 2;
          continue;
        }
        if (s[j] === "$") {
          if (!isSpace(s[j - 1]) && !/\d/.test(s[j + 1] ?? "")) found = j;
          break;
        }
        j++;
      }
      if (found > i + 1) {
        out.push({ start: i, end: found + 1, tex: s.slice(i + 1, found), display: false });
        i = found + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}
