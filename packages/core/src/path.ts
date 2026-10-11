// Đường dẫn kiểu POSIX, không phụ thuộc Node để chạy được cả trong trình duyệt.
// Đường dẫn Windows có ổ đĩa ("E:\a\b", "e:/a") được đổi về "E:/a/b" để mọi hàm dưới đây dùng chung một cách xử lý
// (Node trên Windows trả về dấu "\" từ realpath; không đổi thì tệp nào trong dự án cũng bị coi là "ngoài thư mục").

const DRIVE = /^[A-Za-z]:(?=[\\/]|$)/;

export function normalize(p: string): string {
  const win = DRIVE.test(p);
  if (win) p = p.replace(/\\/g, "/");
  const drive = win ? p.slice(0, 2).toUpperCase() : "";
  const abs = win || p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.slice(drive.length).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(seg);
  }
  const s = out.join("/");
  if (win) return drive + "/" + s;
  return abs ? "/" + s : s || ".";
}

export const isAbsolute = (p: string): boolean => p.startsWith("/") || DRIVE.test(p);

export function resolve(base: string, p: string): string {
  return normalize(isAbsolute(p) ? p : base + "/" + p);
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join("/"));
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf("/");
  if (i < 0) return ".";
  const d = i === 0 ? "/" : n.slice(0, i);
  return /^[A-Za-z]:$/.test(d) ? d + "/" : d;
}

export function basename(p: string): string {
  const n = normalize(p);
  return n.slice(n.lastIndexOf("/") + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
}

/** `to` tính từ `from` (cả hai tuyệt đối). */
export function relative(from: string, to: string): string {
  const a = normalize(from).split("/").filter(Boolean);
  const b = normalize(to).split("/").filter(Boolean);
  const ci = DRIVE.test(from) || DRIVE.test(to); // ổ đĩa Windows không phân biệt hoa thường
  const eq = (x: string, y: string) => (ci ? x.toLowerCase() === y.toLowerCase() : x === y);
  let i = 0;
  while (i < a.length && i < b.length && eq(a[i], b[i])) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function isInside(root: string, p: string): boolean {
  let r = normalize(root);
  let q = normalize(p);
  if (DRIVE.test(r)) { r = r.toLowerCase(); q = q.toLowerCase(); }
  return q === r || q.startsWith(r.endsWith("/") ? r : r + "/");
}
