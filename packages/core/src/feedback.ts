/**
 * Góp ý / báo lỗi do người dùng tự viết và chủ động gửi tới nhóm phát triển (khác chẩn đoán: có nội dung, kèm tên đăng nhập).
 * Phía máy chủ: deploy/220/diag/feedback.py (SQLite); chỉ quản trị viên xem ở /agent/admin/feedback.
 */

export const FEEDBACK_KINDS = ["bug", "idea", "praise", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_MIN = 5;
export const FEEDBACK_MAX = 3000;

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  /** Gửi kèm thông tin kỹ thuật (phiên bản, hệ điều hành, tab, mô hình). Không gồm nội dung hội thoại hay tệp. */
  tech: boolean;
}

export interface FeedbackResult {
  ok: boolean;
  /** Lời nhắn hiển thị cho người dùng (thành công hoặc lý do thất bại). */
  message: string;
}

export const FEEDBACK_LABEL: Record<FeedbackKind, string> = { bug: "Báo lỗi", idea: "Đề xuất", praise: "Khen", other: "Khác" };

/** Lý do góp ý chưa hợp lệ (tiếng Việt), hoặc null nếu gửi được. */
export function feedbackProblem(kind: unknown, text: unknown): string | null {
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(kind)) return "Hãy chọn loại góp ý.";
  if (typeof text !== "string" || text.trim().length < FEEDBACK_MIN) return "Hãy viết rõ hơn một chút (ít nhất vài chữ).";
  if (text.length > FEEDBACK_MAX) return `Góp ý dài quá (tối đa ${FEEDBACK_MAX} ký tự).`;
  return null;
}
