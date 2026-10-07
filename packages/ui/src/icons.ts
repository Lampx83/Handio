import { h } from "./dom";

/** Biểu tượng cây tệp: SVG tĩnh do ứng dụng tạo (không lấy từ nội dung tệp), màu theo loại tệp để nhìn là nhận ra. */
const BADGE: Record<string, [string, string, string?]> = {
  js: ["JS", "#e8b800", "#222"], mjs: ["JS", "#e8b800", "#222"], jsx: ["JSX", "#e8b800", "#222"], ts: ["TS", "#3178c6"], tsx: ["TSX", "#3178c6"],
  py: ["PY", "#3b7bbf"], html: ["HTML", "#e44d26"], htm: ["HTML", "#e44d26"], css: ["CSS", "#7e57c2"], json: ["{ }", "#6d8b74"], svg: ["SVG", "#d9822b"],
  md: ["MD", "#5f6b7a"], txt: ["TXT", "#7b8494"], csv: ["CSV", "#217346"], yml: ["YML", "#8a6d3b"], yaml: ["YML", "#8a6d3b"], sh: ["SH", "#4a5568"],
  docx: ["W", "#2b579a"], doc: ["W", "#2b579a"], xlsx: ["X", "#217346"], xls: ["X", "#217346"], pptx: ["P", "#d24726"], ppt: ["P", "#d24726"], pdf: ["PDF", "#d93025"],
  png: ["IMG", "#a050c0"], jpg: ["IMG", "#a050c0"], jpeg: ["IMG", "#a050c0"], gif: ["IMG", "#a050c0"], webp: ["IMG", "#a050c0"], zip: ["ZIP", "#7b8494"],
};

const svg = (inner: string): string => `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">${inner}</svg>`;

function fileSvg(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const b = name.startsWith(".") && !name.includes(".", 1) ? ["·", "#7b8494"] : BADGE[ext];
  if (!b) return svg('<path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="#8a919c" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 1.5v3h3" fill="none" stroke="#8a919c" stroke-width="1.2" stroke-linejoin="round"/>');
  const [label, bg, fg = "#fff"] = b;
  const size = label.length >= 4 ? 4.6 : label.length === 3 ? 5.4 : 7.4;
  return svg(`<rect x="1" y="1.5" width="14" height="13" rx="3" fill="${bg}"/><text x="8" y="${size > 6 ? 11.2 : 10.4}" text-anchor="middle" font-size="${size}" font-weight="700" font-family="system-ui,-apple-system,Segoe UI,sans-serif" fill="${fg}">${label}</text>`);
}

const FOLDER = svg('<path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1l1.4 1.5h6.1c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z" fill="#e3a72f"/>');
const FOLDER_OPEN = svg('<path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1l1.4 1.5h6.1c.7 0 1.2.5 1.2 1.2v1H1.5z" fill="#c98f1f"/><path d="M1.2 7.2h13.9l-1.4 6c-.1.4-.5.7-1 .7H2.9c-.5 0-.9-.3-1-.7z" fill="#f1c35b"/>');
const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Hai phần tử đầu của một dòng cây tệp: mũi tên (chỉ thư mục) và biểu tượng. */
export function treeIcon(name: string, isDir: boolean, open: boolean): HTMLElement[] {
  return [
    h("span", { class: "cv" + (isDir ? (open ? " open" : "") : " none"), html: isDir ? CHEVRON : "" }),
    h("span", { class: "ic", html: isDir ? (open ? FOLDER_OPEN : FOLDER) : fileSvg(name) }),
  ];
}
