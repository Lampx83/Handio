/**
 * TÊN HIỂN THỊ của hệ thống, cấu hình được theo từng nơi triển khai (không sửa mã).
 * Mặc định là "NEU Agent" (bản của Trường ĐH Kinh tế Quốc dân). Nơi khác — hoặc bản công khai dưới tên Handio sau này —
 * đặt tên khác bằng `setBrandName` (web đọc `brand.json` cạnh ứng dụng, xem docs/EXTENSIONS.md).
 *
 * Nội dung viết sẵn (hướng dẫn, bài học, lời nhắc) dùng chữ "Handio" làm tên SẢN PHẨM; `brandText`/`brandify` đổi nó sang tên triển khai
 * khi hiển thị. Chuỗi mới nên gọi `brandName()` thay vì viết cứng một tên.
 */
const PRODUCT = "Handio";
let name = "NEU Agent";

export const brandName = (): string => name;
export const productName = (): string => PRODUCT;

/** Đặt tên hiển thị (bỏ qua giá trị rỗng/quá dài/có ký tự điều khiển). Trả về tên đang dùng. */
export function setBrandName(next: unknown): string {
  if (typeof next === "string") {
    const t = next.trim();
    if (t && t.length <= 40 && !/[\u0000-\u001f<>"'`]/.test(t)) name = t;
  }
  return name;
}

export const brandText = (s: string): string => (name === PRODUCT || !s.includes(PRODUCT) ? s : s.split(PRODUCT).join(name));

/** Đổi tên sản phẩm trong mọi chuỗi của một cấu trúc (mảng/đối tượng lồng nhau); không sửa bản gốc. */
export function brandify<T>(v: T): T {
  if (name === PRODUCT) return v;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return brandText(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return walk(v) as T;
}
