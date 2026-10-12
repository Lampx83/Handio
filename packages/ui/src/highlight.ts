// Tô màu mã rất gọn cho khối ``` (không phụ thuộc thư viện): chú thích, chuỗi, số, từ khoá, thẻ HTML. Đầu vào là mã THÔ, đầu ra là HTML đã escape.
import { escapeHtml as esc } from "./html";

const KW = {
  c: "abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|private|protected|public|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield|int|long|float|double|char|bool|boolean|string|struct|namespace|using|package|func|go|defer|chan|fn|mut|impl|pub|use|mod|match|self|final|throws|override|readonly",
  py: "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield|self|print",
  sh: "if|then|else|elif|fi|for|while|do|done|case|esac|function|in|return|export|echo|cd|ls|cat|grep|sudo|npm|npx|node|git|python|pip|mkdir|rm|cp|mv|curl|true|false",
  sql: "select|from|where|group|by|order|having|insert|into|values|update|set|delete|create|table|alter|drop|join|left|right|inner|outer|on|as|and|or|not|null|limit|distinct|union|count|sum|avg|min|max|primary|key|foreign|references|index|view",
  css: "important",
} as const;

type Family = "c" | "py" | "sh" | "sql" | "css" | "json" | "html" | "yaml";
const LANG: Record<string, Family> = {
  js: "c", javascript: "c", jsx: "c", ts: "c", typescript: "c", tsx: "c", java: "c", c: "c", cpp: "c", "c++": "c", cs: "c", csharp: "c", go: "c", rust: "c", rs: "c", php: "c", kotlin: "c", swift: "c",
  py: "py", python: "py", sh: "sh", bash: "sh", shell: "sh", zsh: "sh", powershell: "sh", ps1: "sh", cmd: "sh",
  sql: "sql", css: "css", scss: "css", json: "json", html: "html", xml: "html", svg: "html", vue: "html", yaml: "yaml", yml: "yaml", toml: "yaml",
};

const span = (cls: string, s: string) => `<span class="tk-${cls}">${esc(s)}</span>`;

function run(code: string, re: RegExp, cls: (m: RegExpExecArray) => string | null): string {
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    out += esc(code.slice(last, m.index));
    const c = cls(m);
    out += c ? span(c, m[0]) : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

export function highlight(code: string, lang: string): string {
  if (code.length > 30_000) return esc(code);
  const fam = LANG[lang.toLowerCase()];
  if (!fam) return esc(code);
  const kw = (k: keyof typeof KW, flags = "") => new RegExp("\\b(?:" + KW[k] + ")\\b", flags);
  switch (fam) {
    case "c": {
      const re = new RegExp(String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|` + "`(?:\\\\.|[^`\\\\])*`" + String.raw`)|(\b\d[\d_.]*(?:e[+-]?\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)`, "g");
      const k = kw("c");
      return run(code, re, (m) => (m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : m[4] && k.test(m[4]) ? "k" : null));
    }
    case "py":
    case "sh":
    case "yaml": {
      const re = new RegExp(String.raw`(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_.]*\b)|(\b[A-Za-z_][\w-]*\b)`, "g");
      const k = fam === "yaml" ? /^(?:true|false|null|yes|no)$/ : kw(fam === "py" ? "py" : "sh");
      return run(code, re, (m) => (m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : m[4] && k.test(m[4]) ? "k" : null));
    }
    case "sql": {
      const re = new RegExp(String.raw`(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*'|"[^"]*")|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)`, "g");
      const k = kw("sql", "i");
      return run(code, re, (m) => (m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : m[4] && k.test(m[4]) ? "k" : null));
    }
    case "css": {
      const re = new RegExp(String.raw`(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|(@[\w-]+)|([\w-]+)(?=\s*:)`, "g");
      return run(code, re, (m) => (m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : m[4] ? "k" : m[5] ? "t" : null));
    }
    case "json": {
      const re = new RegExp(String.raw`("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b`, "g");
      return run(code, re, (m) => (m[1] ? (m[2] ? "t" : "s") : m[3] ? "n" : "k"));
    }
    case "html": {
      const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|("(?:[^"\n])*"|'(?:[^'\n])*')|(\/?>)/g;
      return run(code, re, (m) => (m[1] ? "c" : m[2] ? "t" : m[3] ? "s" : "t"));
    }
  }
}
