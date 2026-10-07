/**
 * Gợi ý cấu trúc prompt theo bài giảng: Mục tiêu – Ngữ cảnh (@file) – Ràng buộc (phạm vi + điểm dừng).
 * Chỉ là gợi ý nhẹ (không chặn gửi): kiểm tra bằng quy tắc đơn giản, không dùng AI.
 */
export interface PromptTip {
  part: "Mục tiêu" | "Ngữ cảnh" | "Ràng buộc";
  tip: string;
}

const CONSTRAINT = /\b(không|đừng|chỉ|tối đa|trước khi|dừng|giữ nguyên|đừng đụng|không được|only|don'?t|do not|without|stop)\b/i;
const FILE_LIKE = /(@[\w./-]+|\b[\w-]+\.(py|js|ts|tsx|jsx|html|css|json|md|txt|csv|java|c|cpp|go|rs|yml|yaml)\b)/i;

export function promptTips(text: string): PromptTip[] {
  const t = text.trim();
  if (!t || t.startsWith("/") || t.startsWith("!")) return [];
  const words = t.split(/\s+/).length;
  if (words >= 40) return []; // prompt dài thường đã đủ ý
  const tips: PromptTip[] = [];
  if (words < 5) tips.push({ part: "Mục tiêu", tip: "Nói rõ cần làm gì (động từ + kết quả mong muốn) thay vì một cụm ngắn." });
  if (!FILE_LIKE.test(t)) tips.push({ part: "Ngữ cảnh", tip: "Chỉ rõ tệp liên quan bằng @tên-tệp để agent khỏi phải đoán." });
  if (!CONSTRAINT.test(t)) tips.push({ part: "Ràng buộc", tip: "Nêu phạm vi thay đổi và điểm dừng (vd “chỉ sửa …, không đổi …; lập kế hoạch và dừng lại để tôi rà soát”)." });
  return tips.length >= 2 || (tips.length === 1 && words < 5) ? tips : [];
}

export const PROMPT_TEMPLATE = "Mục tiêu: \nNgữ cảnh: @\nRàng buộc: ";
