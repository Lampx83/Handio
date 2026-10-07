// Đường dẫn kiểu POSIX, không phụ thuộc Node để chạy được cả trong trình duyệt.

export function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
    } else out.push(seg);
  }
  const s = out.join("/");
  return abs ? "/" + s : s || ".";
}

export const isAbsolute = (p: string): boolean => p.startsWith("/");

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
  return i === 0 ? "/" : n.slice(0, i);
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
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function isInside(root: string, p: string): boolean {
  const r = normalize(root);
  const q = normalize(p);
  return q === r || q.startsWith(r === "/" ? "/" : r + "/");
}
