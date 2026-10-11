import { describe, expect, it } from "vitest";
import { formatAnswers, parseAskQuestions } from "@neu/agent-core";
import { hasAnswer, toAnswers, togglePick, typeOther, type QuestionPick } from "../src/question-card";

const empty: QuestionPick = { picked: [], other: "" };
const single = { multiSelect: false };
const multi = { multiSelect: true };

describe("thẻ câu hỏi (ask_user): trạng thái chọn", () => {
  it("một lựa chọn: chọn cái khác thì thay thế và xoá chữ 'Khác'", () => {
    let p = togglePick(single, empty, 1);
    expect(p).toEqual({ picked: [1], other: "" });
    p = typeOther(single, p, "ý khác của tôi");
    expect(p).toEqual({ picked: [], other: "ý khác của tôi" });
    p = togglePick(single, p, 0);
    expect(p).toEqual({ picked: [0], other: "" });
  });

  it("nhiều lựa chọn: bật/tắt độc lập, giữ thứ tự, chữ 'Khác' dùng được cùng lựa chọn", () => {
    let p = togglePick(multi, empty, 2);
    p = togglePick(multi, p, 0);
    expect(p.picked).toEqual([0, 2]);
    p = typeOther(multi, p, "thêm phần phụ lục");
    expect(p).toEqual({ picked: [0, 2], other: "thêm phần phụ lục" });
    p = togglePick(multi, p, 0);
    expect(p).toEqual({ picked: [2], other: "thêm phần phụ lục" });
  });

  it("chữ 'Khác' toàn khoảng trắng không tính là trả lời và không làm mất lựa chọn", () => {
    const p = typeOther(single, { picked: [1], other: "" }, "   ");
    expect(p.picked).toEqual([1]);
    expect(hasAnswer({ picked: [], other: "   " })).toBe(false);
    expect(hasAnswer({ picked: [0], other: "" })).toBe(true);
    expect(hasAnswer({ picked: [], other: "x" })).toBe(true);
  });

  it("toAnswers cắt khoảng trắng, bỏ 'Khác' trống; khớp văn bản gửi cho agent", () => {
    const qs = parseAskQuestions([
      { question: "Gửi cho ai?", options: [{ label: "Lãnh đạo" }, { label: "Giảng viên" }] },
      { question: "Cần phần nào?", options: [{ label: "Tóm tắt" }, { label: "Số liệu" }], multi_select: true },
    ]);
    const answers = toAnswers([{ picked: [], other: "  Hội đồng  " }, { picked: [1, 0], other: "" }]);
    expect(answers).toEqual([{ picked: [], other: "Hội đồng" }, { picked: [0, 1] }]);
    expect(formatAnswers(qs, answers).text).toBe("Gửi cho ai? → Hội đồng\nCần phần nào? → Tóm tắt, Số liệu");
  });
});
