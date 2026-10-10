import fs from "node:fs/promises";
import path from "node:path";

/**
 * Bản cài trước đây tự nạp dữ liệu mẫu vào thư mục đầu tiên. Dọn MỘT lần: chỉ xoá tệp còn nguyên như bản mẫu (người dùng đã sửa hay tạo thì
 * giữ nguyên), rồi dọn thư mục con rỗng. Tệp Office có dấu thời gian nên so kích thước (lệch ≤ 2 byte). Trả về số tệp đã xoá.
 */
export async function dropPristineSamples(files: Record<string, string | Uint8Array>, dir: string): Promise<number> {
  let removed = 0;
  const dirs = new Set<string>();
  for (const [rel, want] of Object.entries(files)) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) continue;
    const p = path.join(dir, rel);
    try {
      const cur = await fs.readFile(p);
      const w = typeof want === "string" ? Buffer.from(want, "utf8") : Buffer.from(want);
      const same = typeof want === "string" ? cur.equals(w) : Math.abs(cur.length - w.length) <= 2;
      if (!same) continue;
      await fs.unlink(p);
      removed++;
      for (let d = path.dirname(p); d !== dir && d.startsWith(dir); d = path.dirname(d)) dirs.add(d);
    } catch {
      /* không có tệp này: bỏ qua */
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) await fs.rmdir(d).catch(() => undefined); // chỉ xoá được khi đã rỗng
  return removed;
}
