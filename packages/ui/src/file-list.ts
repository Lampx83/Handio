/**
 * Danh sách tệp ở thanh bên phải: lọc tệp tạm/khoá của Office, sắp xếp (mới sửa lên đầu hoặc theo tên), cắt tên ở giữa.
 * Phần thuần để kiểm thử được; việc dựng DOM nằm ở app.ts.
 */

export interface Entry {
  name: string;
  isDir: boolean;
  /** Thời điểm sửa (ms). Lõi chưa gửi thì thiếu: khi đó chỉ dựa vào `recency`. */
  mtimeMs?: number;
}
export type SortBy = "recent" | "name";

/** Tệp tạm/khoá/rác hệ thống: `~$bai.pptx` (Office), `.~lock.bai.docx#` (LibreOffice), Thumbs.db, .DS_Store, desktop.ini. */
export function isTempFile(name: string): boolean {
  const n = name.trim();
  return n.startsWith("~$") || (n.startsWith(".~lock.") && n.endsWith("#")) || /^(thumbs\.db|\.ds_store|desktop\.ini)$/i.test(n);
}

export const visibleEntries = <T extends { name: string }>(items: T[]): T[] => items.filter((it) => !isTempFile(it.name));

const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
/** So sánh tên theo thứ tự tự nhiên: v2 trước v10. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Thư mục luôn đứng trước (theo tên). Tệp: `recent` = mới sửa/mới tạo lên đầu (lấy lớn nhất của `mtimeMs` và `recency(tên)`),
 * bằng nhau thì theo tên; `name` = theo tên.
 */
export function sortEntries<T extends Entry>(items: T[], by: SortBy, recency: (name: string) => number = () => 0): T[] {
  const key = (it: T): number => Math.max(it.mtimeMs ?? 0, recency(it.name) || 0);
  return [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (!a.isDir && by === "recent") {
      const d = key(b) - key(a);
      if (d) return d;
    }
    return naturalCompare(a.name, b.name);
  });
}

/** Tách tên để cắt ở GIỮA bằng CSS: `head` co lại và có "…", `tail` (đuôi + vài ký tự trước đuôi) luôn hiện. */
export function splitName(name: string, keep = 4): { head: string; tail: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.length - dot : 0;
  const tailLen = Math.min(name.length, ext + keep);
  if (name.length <= tailLen + 6) return { head: name, tail: "" };
  return { head: name.slice(0, name.length - tailLen), tail: name.slice(name.length - tailLen) };
}
