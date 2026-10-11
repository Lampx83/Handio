import { describe, expect, it } from "vitest";
import { ASK_LIMITS, cleanAnswers, formatAnswers, parseAskQuestions, type AskQuestion, type PermissionResponse } from "../src";
import { makeController } from "./helpers";

const Q1 = { question: "Văn bản này gửi cho ai?", header: "Đối tượng", options: [{ label: "Lãnh đạo khoa", description: "Ngắn gọn, nêu quyết định" }, { label: "Toàn thể giảng viên" }] };
const Q2 = { question: "Chọn các phần cần có", options: [{ label: "Tóm tắt" }, { label: "Số liệu" }, { label: "Kiến nghị" }], multi_select: true };

/** Nội dung kết quả công cụ mà mô hình nhận được ở lần gọi thứ n. */
const toolReply = (llm: { calls: { messages: { role: string; content?: unknown }[] }[] }, n = 1) => String(llm.calls[n].messages.filter((m) => m.role === "tool").at(-1)!.content);
const results = (events: any[]) => events.filter((e) => e.type === "tool_result" && e.name === "ask_user") as { ok: boolean; output: string; errKind?: string }[];

describe("ask_user: hỏi người dùng có cấu trúc", () => {
  it("sự kiện permission kind 'question' có đủ câu hỏi; trả lời → mô hình nhận đúng văn bản", async () => {
    const { c, llm, requests, events } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: [Q1, Q2] } }] }, { text: "đã rõ" }],
      { profile: "work", decide: (r) => (r.kind === "question" ? { allow: true, answers: [{ picked: [0] }, { picked: [0, 2] }] } : { allow: true }) },
    );
    await c.send("soạn thông báo");
    expect(requests).toHaveLength(1);
    const r = requests[0];
    expect(r).toMatchObject({ kind: "question", tool: "ask_user", depth: 0 });
    expect(r.questions).toEqual([
      { question: "Văn bản này gửi cho ai?", header: "Đối tượng", options: [{ label: "Lãnh đạo khoa", description: "Ngắn gọn, nêu quyết định" }, { label: "Toàn thể giảng viên" }], multiSelect: false },
      { question: "Chọn các phần cần có", options: [{ label: "Tóm tắt" }, { label: "Số liệu" }, { label: "Kiến nghị" }], multiSelect: true },
    ]);
    expect(toolReply(llm)).toBe("Người dùng đã trả lời:\nVăn bản này gửi cho ai? → Lãnh đạo khoa\nChọn các phần cần có → Tóm tắt, Kiến nghị");
    expect(results(events)[0].ok).toBe(true);
    expect(events.find((e: any) => e.type === "permission_resolved")).toMatchObject({ id: r.id, allowed: true });
    expect((await c.getState()).busy).toBe(false);
  });

  it("chữ tự gõ ở ô 'Khác' được trả nguyên văn (gọn một dòng, giới hạn độ dài)", async () => {
    const { c, llm } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: [Q1] } }] }, { text: "ok" }],
      { decide: () => ({ allow: true, answers: [{ picked: [], other: "  Cho Hội đồng\nkhoa học  " }] }) },
    );
    await c.send("x");
    expect(toolReply(llm)).toBe("Người dùng đã trả lời:\nVăn bản này gửi cho ai? → Cho Hội đồng khoa học");
  });

  it("bấm 'Để agent tự quyết' (allow + không có câu trả lời) hoặc bị từ chối: mô hình được dặn tự quyết, không hỏi lại", async () => {
    for (const res of [{ allow: true, answers: [] }, { allow: true }, { allow: false }, { allow: true, answers: [{ picked: [] }] }] as PermissionResponse[]) {
      const { c, llm } = await makeController([{ calls: [{ name: "ask_user", args: { questions: [Q1] } }] }, { text: "ok" }], { decide: () => res });
      await c.send("x");
      const t = toolReply(llm);
      expect(t, JSON.stringify(res)).toContain("để bạn tự quyết");
      expect(t).toContain("Đừng hỏi lại");
    }
  });

  it("câu nào bỏ trống thì ghi rõ; chỉ số lạ bị bỏ; câu một lựa chọn chỉ lấy lựa chọn đầu", async () => {
    const { c, llm } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: [Q1, Q2] } }] }, { text: "ok" }],
      { decide: () => ({ allow: true, answers: [{ picked: [], other: "" }, { picked: [9, -1, 1, 1] }] }) },
    );
    await c.send("x");
    const t = toolReply(llm);
    expect(t).toContain("Văn bản này gửi cho ai? → (không trả lời: bạn tự quyết)");
    expect(t).toContain("Chọn các phần cần có → Số liệu");
    expect(t).toContain("Với câu không trả lời: hãy tự quyết");

    const one = await makeController([{ calls: [{ name: "ask_user", args: { questions: [Q1] } }] }, { text: "ok" }], { decide: () => ({ allow: true, answers: [{ picked: [1, 0] }] }) });
    await one.c.send("x");
    expect(toolReply(one.llm)).toContain("→ Toàn thể giảng viên");
    expect(toolReply(one.llm)).not.toContain("Lãnh đạo khoa");
  });

  it("tham số sai: lỗi tiếng Việt rõ, KHÔNG hiện hộp hỏi", async () => {
    const opt = (n: number) => Array.from({ length: n }, (_, i) => ({ label: "L" + i }));
    const cases: [string, unknown, RegExp][] = [
      ["0 câu hỏi", [], /1–4 câu hỏi.*nhận 0/],
      ["5 câu hỏi", Array.from({ length: 5 }, () => Q1), /1–4 câu hỏi.*nhận 5/],
      ["thiếu questions", undefined, /1–4 câu hỏi/],
      ["1 lựa chọn", [{ question: "Hỏi?", options: opt(1) }], /Câu hỏi 1 cần 2–4 lựa chọn.*nhận 1/],
      ["5 lựa chọn", [{ question: "Hỏi?", options: opt(5) }], /Câu hỏi 1 cần 2–4 lựa chọn.*nhận 5/],
      ["thiếu question", [Q1, { options: opt(2) }], /Câu hỏi 2 thiếu nội dung "question"/],
      ["question rỗng", [{ question: "   ", options: opt(2) }], /Câu hỏi 1 thiếu nội dung/],
      ["thiếu options", [{ question: "Hỏi?" }], /Câu hỏi 1 cần 2–4 lựa chọn.*nhận 0/],
      ["lựa chọn thiếu label", [{ question: "Hỏi?", options: [{ label: "A" }, { description: "x" }] }], /Lựa chọn 2 của câu hỏi 1 thiếu "label"/],
    ];
    for (const [name, questions, re] of cases) {
      const { c, llm, requests, events } = await makeController([{ calls: [{ name: "ask_user", args: { questions } }] }, { text: "ok" }]);
      await c.send("x");
      expect(requests, name).toHaveLength(0);
      const r = results(events)[0];
      expect(r.ok, name).toBe(false);
      expect(r.errKind, name).toBe("bad_args");
      expect(r.output, name).toMatch(/^Lỗi: /);
      expect(r.output, name).toMatch(re);
      expect(toolReply(llm), name).toMatch(re);
    }
  });

  it("nhận mảng gửi dưới dạng chuỗi JSON, lựa chọn là chuỗi trơn, nhãn dài bị cắt", async () => {
    const { c, requests } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: JSON.stringify([{ question: "Chọn?", header: "Nhãn rất rất dài vượt mức", options: ["Một", "Hai"], multiSelect: "true" }]) } }] }, { text: "ok" }],
    );
    await c.send("x");
    expect(requests[0].questions).toEqual([{ question: "Chọn?", header: "Nhãn rất rất", options: [{ label: "Một" }, { label: "Hai" }], multiSelect: true }]);
  });

  it("subagent không có công cụ ask_user (chỉ agent chính)", async () => {
    const { c, llm, events, requests } = await makeController((m, n) => {
      const sys = String(m[0].content);
      if (sys.includes("subagent 'general'")) return String(m.at(-1)?.role) === "tool" ? { text: "xong" } : { calls: [{ name: "ask_user", args: { questions: [Q1] } }] };
      if (n === 0) return { calls: [{ name: "task", args: { agent: "general", prompt: "làm việc X", description: "x" } }] };
      return { text: "ok" };
    });
    await c.send("x");
    const main = llm.calls[0].opts.tools!.map((t) => t.function.name);
    expect(main).toContain("ask_user");
    const sub = llm.calls.find((x) => String(x.messages[0].content).includes("subagent 'general'"))!;
    expect(sub.opts.tools!.map((t) => t.function.name)).not.toContain("ask_user");
    expect(requests).toHaveLength(0);
    expect(results(events)[0]).toMatchObject({ ok: false });
    expect(results(events)[0].output).toContain("không có công cụ 'ask_user'");
  });

  it("có ở cả ba tab và ở chế độ plan (chỉ đọc)", async () => {
    for (const profile of ["work", "code", "design"] as const) {
      const { c, llm } = await makeController([{ text: "ok" }], { profile });
      await c.send("x");
      expect(llm.calls[0].opts.tools!.map((t) => t.function.name), profile).toContain("ask_user");
    }
    const { c, llm, requests } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: [Q1] } }] }, { text: "ok" }],
      { profile: "work", settings: { mode: "plan" }, decide: () => ({ allow: true, answers: [{ picked: [0] }] }) },
    );
    await c.send("x");
    expect(requests.filter((r) => r.kind === "question")).toHaveLength(1); // (cuối lượt plan còn xin duyệt kế hoạch: kind "plan")
    expect(toolReply(llm)).toContain("Lãnh đạo khoa");
  });

  it("trả lời câu hỏi KHÔNG cấp quyền: always/mode bị bỏ qua, công cụ ghi vẫn phải hỏi", async () => {
    const { c, requests, env } = await makeController(
      [{ calls: [{ name: "ask_user", args: { questions: [Q1] } }] }, { calls: [{ name: "write_file", args: { path: "a.txt", content: "x" } }] }, { text: "ok" }],
      { decide: (r) => (r.kind === "question" ? { allow: true, always: true, mode: "bypass", plan: "x", answers: [{ picked: [0] }] } : { allow: false, note: "không" }) },
    );
    await c.send("x");
    expect(requests.map((r) => r.kind)).toEqual(["question", "tool"]);
    expect(requests[1].tool).toBe("write_file");
    expect(c.currentSession.perms.sessionAllow).toEqual([]);
    expect(c.currentSession.perms.mode).toBe("default");
    expect(await env.stat("/ws/a.txt")).toBeNull();
  });

  it("không ai trả lời: hết hạn chờ thì agent tự quyết, hộp hỏi được đóng, phiên không kẹt", async () => {
    const { c, llm, events } = await makeController(
      (_m, n) => (n % 2 === 0 ? { calls: [{ name: "ask_user", args: { questions: [Q1] } }] } : { text: "xong" }),
      { decide: () => new Promise<PermissionResponse>(() => {}) },
    );
    (c.currentSession.o as { questionTimeoutMs?: number }).questionTimeoutMs = 40;
    await c.send("x");
    expect(toolReply(llm)).toContain("hết thời gian chờ");
    const q = events.find((e: any) => e.type === "permission") as any;
    expect(events.find((e: any) => e.type === "permission_resolved" && e.id === q.request.id)).toMatchObject({ allowed: true });
    expect(events.some((e: any) => e.type === "notice" && /Hết thời gian chờ/.test(e.text))).toBe(true);
    expect((await c.getState()).busy).toBe(false);
    // gọi lại ở lượt sau vẫn chạy bình thường
    await c.send("lại");
    expect(events.filter((e: any) => e.type === "turn_end")).toHaveLength(2);
    expect(results(events)).toHaveLength(2);
  });

  it("người dùng bấm Dừng khi đang chờ trả lời: thẻ đóng, lượt kết thúc, phiên dùng tiếp được", async () => {
    const { c, events } = await makeController(
      (_m, n) => (n === 0 ? { calls: [{ name: "ask_user", args: { questions: [Q1] } }] } : { text: "ok" }),
      { decide: () => new Promise<PermissionResponse>(() => {}) },
    );
    const sent = c.send("x");
    for (let i = 0; i < 100 && !events.some((e: any) => e.type === "permission"); i++) await new Promise((r) => setTimeout(r, 5));
    c.interrupt();
    await sent;
    const q = events.find((e: any) => e.type === "permission") as any;
    expect(events.find((e: any) => e.type === "permission_resolved" && e.id === q.request.id)).toBeTruthy();
    expect(events.find((e: any) => e.type === "turn_end")).toMatchObject({ interrupted: true });
    expect((await c.getState()).busy).toBe(false);
    await c.send("tiếp");
    expect(events.filter((e: any) => e.type === "turn_end")).toHaveLength(2);
  });

  it("hỏi quá nhiều lần trong một yêu cầu thì bị nhắc tự quyết; sang yêu cầu mới thì hỏi lại được", async () => {
    let asked = 0;
    const { c, llm, requests } = await makeController(
      (m) => {
        const lastUser = m.map((x) => x.role).lastIndexOf("user");
        const done = m.slice(lastUser + 1).filter((x) => x.role === "tool").length;
        return done < 4 ? { calls: [{ name: "ask_user", args: { questions: [{ ...Q1, question: "Hỏi lần " + ++asked + "?" }] } }] } : { text: "xong" };
      },
      { decide: () => ({ allow: true, answers: [{ picked: [0] }] }) },
    );
    await c.send("x");
    expect(requests).toHaveLength(3);
    expect(toolReply(llm, 4)).toContain("Đã hỏi người dùng 3 lần");
    await c.send("y");
    expect(requests).toHaveLength(6);
  });
});

describe("ask_user: kiểm tra và định dạng (thuần)", () => {
  it("giới hạn khớp mô tả công cụ", () => {
    expect(ASK_LIMITS).toMatchObject({ questions: 4, options: 4, header: 12 });
  });
  it("cleanAnswers: kiểu lạ không làm hỏng; formatAnswers khớp thứ tự câu hỏi", () => {
    const qs: AskQuestion[] = parseAskQuestions([Q1, Q2]);
    expect(cleanAnswers("lạ", qs)).toEqual([{ picked: [] }, { picked: [] }]);
    expect(cleanAnswers([{ picked: "0" }, { picked: [2, "1", 1.5, 0], other: 5 }], qs)).toEqual([{ picked: [] }, { picked: [0, 2] }]);
    expect(formatAnswers(qs, [{ picked: [1] }]).text).toBe("Văn bản này gửi cho ai? → Toàn thể giảng viên\nChọn các phần cần có → (không trả lời: bạn tự quyết)");
  });
});
