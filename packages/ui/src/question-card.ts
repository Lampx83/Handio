import type { AskQuestion, QuestionAnswer } from "@neu/agent-core";
import { h } from "./dom";

/** Trạng thái chọn của một câu hỏi (thuần, không DOM: để kiểm thử được). */
export interface QuestionPick {
  picked: number[];
  other: string;
}

/** Bấm vào một lựa chọn: câu một-lựa-chọn thì thay thế (và xoá chữ "Khác"); nhiều-lựa-chọn thì bật/tắt. */
export function togglePick(q: Pick<AskQuestion, "multiSelect">, cur: QuestionPick, index: number): QuestionPick {
  if (!q.multiSelect) return { picked: [index], other: "" };
  return { picked: cur.picked.includes(index) ? cur.picked.filter((k) => k !== index) : [...cur.picked, index].sort((a, b) => a - b), other: cur.other };
}

/** Gõ vào ô "Khác": câu một-lựa-chọn thì bỏ lựa chọn đang chọn (chỉ một trong hai). */
export function typeOther(q: Pick<AskQuestion, "multiSelect">, cur: QuestionPick, text: string): QuestionPick {
  return { picked: !q.multiSelect && text.trim() ? [] : cur.picked, other: text };
}

export const hasAnswer = (p: QuestionPick): boolean => p.picked.length > 0 || p.other.trim().length > 0;

/** Chuyển trạng thái thành câu trả lời gửi cho agent (cắt khoảng trắng; chữ "Khác" trống thì bỏ). */
export function toAnswers(picks: QuestionPick[]): QuestionAnswer[] {
  return picks.map((p) => ({ picked: [...p.picked].sort((a, b) => a - b), ...(p.other.trim() ? { other: p.other.trim() } : {}) }));
}

export interface QuestionCard {
  el: HTMLElement;
  /** Gửi trả lời (không làm gì nếu chưa trả lời câu nào). */
  submit(): void;
  /** "Để agent tự quyết". */
  skip(): void;
  focus(): void;
}

/**
 * Thẻ câu hỏi của `ask_user`: mỗi câu là một nhóm nút chọn (radio / checkbox gốc của trình duyệt nên dùng được bàn phím và trình đọc màn hình),
 * kèm ô "Khác…" gõ tay; nút "Gửi trả lời" và "Để agent tự quyết". `done(null)` = bỏ qua.
 */
export function buildQuestionCard(id: string, questions: AskQuestion[], done: (answers: QuestionAnswer[] | null) => void): QuestionCard {
  const picks: QuestionPick[] = questions.map(() => ({ picked: [], other: "" }));
  const inputs: HTMLInputElement[][] = [];
  const others: HTMLInputElement[] = [];
  let finished = false;
  const finish = (a: QuestionAnswer[] | null) => {
    if (finished) return;
    finished = true;
    done(a);
  };

  const sendBtn = h("button", { class: "btn primary", type: "button", disabled: true, onclick: () => submit() }, "Gửi trả lời ", h("kbd", {}, "Enter"));
  const refresh = () => {
    sendBtn.disabled = !picks.some(hasAnswer);
    questions.forEach((q, i) => {
      inputs[i].forEach((inp, k) => (inp.checked = picks[i].picked.includes(k)));
      if (others[i].value !== picks[i].other) others[i].value = picks[i].other;
    });
  };

  const groups = questions.map((q, i) => {
    const multi = q.multiSelect;
    const opts = q.options.map((o, k) => {
      const inp = h("input", { type: multi ? "checkbox" : "radio", name: `q-${id}-${i}`, value: String(k), onchange: () => {
        picks[i] = togglePick(q, picks[i], k);
        refresh();
      } }) as HTMLInputElement;
      (inputs[i] ??= []).push(inp);
      return h("label", { class: "opt" }, inp, h("span", { class: "ot" }, h("span", { class: "ol" }, o.label), o.description ? h("span", { class: "od" }, o.description) : null));
    });
    const other = h("input", { type: "text", class: "other", placeholder: "Khác…", maxlength: "500", "aria-label": `Khác: gõ câu trả lời của bạn${questions.length > 1 ? ` (câu ${i + 1})` : ""}`, autocomplete: "off", oninput: () => {
      picks[i] = typeOther(q, picks[i], other.value);
      refresh();
    } }) as HTMLInputElement;
    others[i] = other;
    return h("fieldset", { class: "qa" },
      h("legend", {}, q.header ? h("span", { class: "qh" }, q.header) : null, q.question, multi ? h("span", { class: "qhint" }, " (chọn nhiều)") : null),
      ...opts, other);
  });

  function submit(): void {
    if (!picks.some(hasAnswer)) return;
    finish(toAnswers(picks));
  }
  function skip(): void {
    finish(null);
  }

  const el = h("div", { class: "ask ask-q", role: "group", "aria-label": "Câu hỏi của agent" },
    ...groups,
    h("div", { class: "row" }, sendBtn, h("button", { class: "btn", type: "button", onclick: skip }, "Để agent tự quyết ", h("kbd", {}, "Esc"))));
  // Enter ở một lựa chọn hay ô "Khác" = gửi; Esc do trình xử lý phím chung của ứng dụng đổi thành "tự quyết"
  el.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !e.shiftKey && t.tagName === "INPUT") {
      e.preventDefault();
      e.stopPropagation();
      submit();
    }
  });
  refresh();
  return { el, submit, skip, focus: () => (inputs[0]?.[0] ?? others[0])?.focus({ preventScroll: true }) };
}
