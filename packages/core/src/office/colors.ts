/** Màu người dùng/AI nói ra → "RRGGBB" (hex 6 ký tự, có hoặc không dấu #; hoặc tên màu thông dụng, tiếng Việt hoặc Anh). null nếu không hiểu. */
const NAMES: Record<string, string> = {
  do: "C00000", red: "C00000", "do tuoi": "FF0000", "do dam": "8B0000",
  cam: "ED7D31", orange: "ED7D31", vang: "FFC000", yellow: "FFC000",
  "xanh la": "2E7D32", green: "2E7D32", "xanh la nhat": "92D050", "xanh duong": "1F4E9E", blue: "1F4E9E", "xanh nhat": "9DC3E6", "xanh ngoc": "0F766E", teal: "0F766E",
  tim: "7030A0", purple: "7030A0", hong: "FF66B2", pink: "FF66B2", nau: "7B4A2A", brown: "7B4A2A",
  den: "000000", black: "000000", trang: "FFFFFF", white: "FFFFFF", xam: "7F7F7F", gray: "7F7F7F", grey: "7F7F7F", "xam nhat": "D9D9D9", "xam dam": "404040",
};

export function colorHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(t)) return t.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(t)) return t.split("").map((c) => c + c).join("").toUpperCase();
  const k = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");
  return NAMES[k] ?? null;
}
