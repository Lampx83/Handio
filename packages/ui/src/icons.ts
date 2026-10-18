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

/** Bộ biểu tượng giao diện: nét mảnh 24×24, tô theo màu chữ (currentColor). Hằng số tin cậy, không lấy từ dữ liệu người dùng. */
const UI = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  message: '<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  gear: '<path d="M19 10.1L21.2 9.7L21.2 14.3L19 13.9L18.3 15.6L20.1 16.9L16.9 20.1L15.6 18.3L13.9 19L14.3 21.2L9.7 21.2L10.1 19L8.4 18.3L7.1 20.1L3.9 16.9L5.7 15.6L5 13.9L2.8 14.3L2.8 9.7L5 10.1L5.7 8.4L3.9 7.1L7.1 3.9L8.4 5.7L10.1 5L9.7 2.8L14.3 2.8L13.9 5L15.6 5.7L16.9 3.9L20.1 7.1L18.3 8.4Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M3 5.5C3 4.7 3.7 4 4.5 4H9a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4.5c-.8 0-1.5-.7-1.5-1.5z"/><path d="M21 5.5c0-.8-.7-1.5-1.5-1.5H15a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5c0-.8.7-1.5 1.5-1.5h3c.8 0 1.5.7 1.5 1.5V7M3 13h18"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.3 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="8" r="1.2"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  zap: '<path d="M13 3L4.5 14H11l-1 7 8.5-11H12z"/>',
  diff: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
} satisfies Record<string, string>;
export type IconName = keyof typeof UI;

/** Biểu tượng nét mảnh trong một <span class="i">, ẩn với trình đọc màn hình (nút phải có aria-label hoặc chữ đi kèm). */
export function icon(name: IconName, size = 18): HTMLElement {
  return h("span", { class: "i i-" + name, "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false">${UI[name]}</svg>` });
}

/** Hai phần tử đầu của một dòng cây tệp: mũi tên (chỉ thư mục) và biểu tượng. */
export function treeIcon(name: string, isDir: boolean, open: boolean): HTMLElement[] {
  return [
    h("span", { class: "cv" + (isDir ? (open ? " open" : "") : " none"), html: isDir ? CHEVRON : "" }),
    h("span", { class: "ic", html: isDir ? (open ? FOLDER_OPEN : FOLDER) : fileSvg(name) }),
  ];
}
