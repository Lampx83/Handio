import { ToolError } from "./tools";
import type { AskQuestion, QuestionAnswer } from "./types";

/** Giới hạn của công cụ `ask_user` (lõi kiểm tra khi nhận lời gọi; Desktop kiểm tra lại ở IPC). */
export const ASK_LIMITS = { questions: 4, options: 4, header: 12, question: 300, label: 80, description: 200, other: 500 } as const;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** Mô hình đôi khi gửi mảng dưới dạng chuỗi JSON: chấp nhận cả hai. */
function asArray(v: unknown): unknown[] | null {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return Array.isArray(v) ? v : null;
}

/** Kiểm tra tham số `questions` của `ask_user`; lỗi thì ném ToolError tiếng Việt để mô hình sửa lại. */
export function parseAskQuestions(raw: unknown): AskQuestion[] {
  const list = asArray(raw);
  const n = list?.length ?? 0;
  if (!list || n < 1 || n > ASK_LIMITS.questions) throw new ToolError(`ask_user cần 1–${ASK_LIMITS.questions} câu hỏi trong "questions" (nhận ${n}). Chỉ hỏi điều thật sự cần; việc còn lại hãy tự quyết.`, "bad_args");
  return list.map((q, i) => {
    const no = i + 1;
    const o = q && typeof q === "object" && !Array.isArray(q) ? (q as Record<string, unknown>) : {};
    const question = text(o.question, ASK_LIMITS.question);
    if (!question) throw new ToolError(`Câu hỏi ${no} thiếu nội dung "question".`, "bad_args");
    const opts = asArray(o.options);
    const m = opts?.length ?? 0;
    if (!opts || m < 2 || m > ASK_LIMITS.options)
      throw new ToolError(`Câu hỏi ${no} cần 2–${ASK_LIMITS.options} lựa chọn trong "options" (nhận ${m}). Không cần thêm lựa chọn "Khác": giao diện đã có ô nhập tự do.`, "bad_args");
    const options = opts.map((p, j) => {
      const po = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : { label: p };
      const label = text(po.label, ASK_LIMITS.label);
      if (!label) throw new ToolError(`Lựa chọn ${j + 1} của câu hỏi ${no} thiếu "label".`, "bad_args");
      const description = text(po.description, ASK_LIMITS.description);
      return description ? { label, description } : { label };
    });
    const header = text(o.header, ASK_LIMITS.header);
    const ms = o.multi_select ?? o.multiSelect;
    return { question, ...(header ? { header } : {}), options, multiSelect: ms === true || ms === "true" };
  });
}

/** Làm sạch câu trả lời nhận từ giao diện: chỉ số hợp lệ, không trùng, một lựa chọn thì tối đa 1, chữ "Khác" gọn một dòng. */
export function cleanAnswers(raw: unknown, questions: AskQuestion[]): QuestionAnswer[] {
  const list = Array.isArray(raw) ? raw : [];
  return questions.map((q, i) => {
    const a = list[i] && typeof list[i] === "object" ? (list[i] as Record<string, unknown>) : {};
    const picked: number[] = [];
    if (Array.isArray(a.picked))
      for (const k of a.picked)
        if (Number.isInteger(k) && (k as number) >= 0 && (k as number) < q.options.length && !picked.includes(k as number)) picked.push(k as number);
    if (!q.multiSelect) picked.splice(1);
    const other = text(a.other, ASK_LIMITS.other);
    return { picked: picked.sort((x, y) => x - y), ...(other ? { other } : {}) };
  });
}

/** Một câu trả lời thành chữ: các lựa chọn đã chọn, rồi chữ tự gõ; null nếu để trống. */
export function answerText(q: AskQuestion, a: QuestionAnswer | undefined): string | null {
  if (!a) return null;
  const parts = a.picked.filter((k) => q.options[k]).map((k) => q.options[k].label);
  if (a.other) parts.push(a.other);
  return parts.length ? parts.join(", ") : null;
}

/** Số câu có trả lời, và văn bản gọn trả cho mô hình (mỗi câu một dòng "câu hỏi → trả lời"). */
export function formatAnswers(questions: AskQuestion[], answers: QuestionAnswer[]): { answered: number; text: string } {
  let answered = 0;
  const lines = questions.map((q, i) => {
    const t = answerText(q, answers[i]);
    if (t) answered++;
    return `${q.question} → ${t ?? "(không trả lời: bạn tự quyết)"}`;
  });
  return { answered, text: lines.join("\n") };
}
