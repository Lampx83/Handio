import { describe, expect, it } from "vitest";
import { makeController } from "./helpers";

// Số liệu thật (10/2026): một lượt chạy 141–200 bước tốn 2–2,9 triệu token, hơn nửa hạn mức ngày 5 triệu của sinh viên;
// người dùng hết hạn mức giữa buổi, bị chặn ba lượt liền rồi bỏ đi. Lượt quá tốn phải được báo sớm và dừng lại cho người dùng quyết.
const notices = (ev: any[]) => ev.filter((e) => e.type === "notice").map((e) => String(e.text));
const big = (i: number) => ({ calls: [{ name: "glob", args: { pattern: `**/*${i}*` } }], usage: { prompt_tokens: 100_000, completion_tokens: 1_000 }, text: `bước ${i}` });

describe("chốt token của một lượt", () => {
  it("có hạn mức: 25% thì báo và nhắc mô hình làm cho xong; 50% thì dừng, tóm tắt, nói gõ tiếp tục", async () => {
    const { c, events, llm } = await makeController((m, i) => (m.at(-1)?.content?.toString().includes("một nửa hạn mức") ? { text: "Đã làm A, còn B. Gõ “tiếp tục” để làm tiếp." } : big(i)), { settings: { maxSteps: 200 } as any });
    (c as any).quota = { limit: 1_000_000, used: 0, remaining: 1_000_000, pct: 0, state: "ok", resetAt: 0 };
    await c.send("làm việc dài");
    const n = notices(events);
    expect(n.some((t) => /đã dùng khoảng 0,3 triệu token \(30% hạn mức hôm nay\)/.test(t))).toBe(true);
    expect(n.some((t) => /một nửa hạn mức hôm nay/.test(t) && /tiếp tục/.test(t))).toBe(true);
    // mô hình được nhắc ngay sau mức 25%
    const toModel = llm.calls.flatMap((x) => x.messages).map((m: any) => String(m.content ?? ""));
    expect(toModel.some((t) => t.startsWith("[Hệ thống] Lượt này đã dùng"))).toBe(true);
    // dừng ở khoảng 50%, không chạy tới giới hạn 600 bước
    expect(llm.calls.length).toBeLessThanOrEqual(7);
    expect(llm.calls.at(-1)!.opts.tools ?? []).toHaveLength(0);
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: expect.stringContaining("tiếp tục") });
  });

  it("lượt nhỏ không bị báo gì", async () => {
    const { c, events } = await makeController([big(0), { text: "xong" }]);
    (c as any).quota = { limit: 5_000_000, used: 0, remaining: 5_000_000, pct: 0, state: "ok", resetAt: 0 };
    await c.send("x");
    expect(notices(events).some((t) => /token/.test(t))).toBe(false);
  });

  it("không biết hạn mức: chỉ nhắc khi quá 2 triệu token, không dừng", async () => {
    const { c, events, llm } = await makeController((_m, i) => (i < 25 ? big(i) : { text: "xong" }), { settings: { maxSteps: 200 } as any });
    await c.send("x");
    const n = notices(events);
    expect(n.filter((t) => /^Lượt này đã dùng khoảng 2(,\d)? triệu token\./.test(t))).toHaveLength(1); // không có "% hạn mức"
    expect(n.some((t) => /một nửa hạn mức/.test(t))).toBe(false);
    expect(llm.calls.length).toBeGreaterThanOrEqual(26); // chạy tới khi mô hình tự xong (tính cả lần tóm tắt ngữ cảnh)
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: "xong" });
  });

  it("hạn mức không giới hạn thì như không biết hạn mức", async () => {
    const { c, events } = await makeController((_m, i) => (i < 3 ? big(i) : { text: "xong" }));
    (c as any).quota = { limit: 0, used: 0, remaining: null, pct: null, state: "unlimited", resetAt: 0 };
    await c.send("x");
    expect(notices(events).some((t) => /token/.test(t))).toBe(false);
  });
});
