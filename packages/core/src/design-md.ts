/**
 * DESIGN.md theo dự án (tab Design): hệ thống thiết kế của dự án (màu, phông, khoảng cách, giọng điệu).
 * Agent đọc mỗi lượt Design và tuân theo. Khác AGENTS.md (hướng dẫn làm việc chung): DESIGN.md chỉ nói về diện mạo.
 */
import type { Env } from "./env";
import { isInside, join } from "./path";

export const DESIGN_MD_FILE = "DESIGN.md";
const MAX_DESIGN_MD_CHARS = 4000;

/** Đọc DESIGN.md ở gốc dự án (rút gọn); không có, rỗng, hay là liên kết trỏ ra ngoài dự án thì trả "". */
export async function loadDesignMd(env: Env, root: string): Promise<string> {
  try {
    const p = join(root, DESIGN_MD_FILE);
    if (!(await env.stat(p))?.isFile) return "";
    const real = await env.realpath(p).catch(() => p);
    const rootReal = await env.realpath(root).catch(() => root);
    if (!isInside(rootReal, real)) return "";
    const text = new TextDecoder().decode(await env.readBytes(p)).trim();
    return text.length > MAX_DESIGN_MD_CHARS ? text.slice(0, MAX_DESIGN_MD_CHARS) + "\n… (đã cắt bớt)" : text;
  } catch {
    return "";
  }
}

/** Mẫu DESIGN.md để người dùng điền (màu, phông, khoảng cách, giọng điệu). Giá trị mẫu chỉ là gợi ý, không phải thương hiệu thật. */
export const DESIGN_MD_TEMPLATE = `# Hệ thống thiết kế

## Màu
- Chính: #0B4A9E
- Nhấn: #F2B134
- Chữ: #0F172A (phụ: #475569)
- Nền: #FFFFFF (khối nhạt: #F1F5F9)

## Chữ
- Tiêu đề: "Segoe UI", Roboto, Arial, sans-serif; đậm 800
- Nội dung: cùng họ phông, 17px, giãn dòng 1.65
- Chỉ dùng phông hệ thống, gõ đủ dấu tiếng Việt

## Khoảng cách và hình khối
- Thang khoảng cách: 8 / 16 / 24 / 32 / 48 / 64px
- Bo góc thẻ 16px, nút bo tròn; bóng nhẹ

## Giọng điệu
- Thân thiện, rõ ràng, xưng "bạn"; câu ngắn

## Không làm
- Không dùng logo hay tên tổ chức thật khi chưa có; để "[Tên tổ chức]"
`;
