import { describe, expect, it } from "vitest";
import { FEEDBACK_MAX, feedbackProblem } from "../src";
import { makeController } from "./helpers";

describe("góp ý: kiểm tra đầu vào", () => {
  it("loại và độ dài", () => {
    expect(feedbackProblem("bug", "Không mở được tệp Word")).toBeNull();
    expect(feedbackProblem("nope", "Không mở được tệp Word")).toMatch(/loại/);
    expect(feedbackProblem("idea", "  ab ")).toMatch(/rõ hơn/);
    expect(feedbackProblem("idea", 5)).toMatch(/rõ hơn/);
    expect(feedbackProblem("idea", "x".repeat(FEEDBACK_MAX + 1))).toMatch(/dài quá/);
  });
});

const diag = (fetchImpl: typeof fetch, endpoint = "https://ai.test/agent/diag") => ({ endpoint, version: "0.5.0", platform: "darwin arm64", headers: () => ({ Authorization: "Bearer T" }), fetch: fetchImpl, enabled: () => false });

describe("góp ý: gửi lên máy chủ", () => {
  it("gửi đúng địa chỉ /feedback, kèm đăng nhập; thông tin kỹ thuật chỉ khi người dùng đồng ý", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ ok: true, id: 7 }), { headers: { "content-type": "application/json" } }))) as never;
    const { c } = await makeController([{ text: "ok" }], { profile: "work", diagnostics: diag(f) });
    const r = await c.sendFeedback({ kind: "bug", text: "  Bấm Gửi mà không thấy gì xảy ra  ", tech: true });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://ai.test/agent/feedback");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer T");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ kind: "bug", text: "Bấm Gửi mà không thấy gì xảy ra", ctx: { version: "0.5.0", platform: "darwin arm64", tab: "work", model: "qwen3.5-35b-a3b-int4" } });
    await c.sendFeedback({ kind: "idea", text: "Thêm chế độ tối cho bảng", tech: false });
    expect(JSON.parse(calls[1].init.body as string).ctx).toEqual({});
    expect(calls[1].init.redirect).toBe("error");
  });

  it("lỗi máy chủ, hết phiên, quá giới hạn, mất mạng: trả lời nhẹ nhàng, không ném lỗi", async () => {
    const mk = (res: () => Response | Promise<Response>) => makeController([{ text: "ok" }], { diagnostics: diag((async () => res()) as never) });
    const input = { kind: "bug" as const, text: "Một lỗi nào đó rất lạ", tech: false };
    expect((await (await mk(() => new Response("{}", { status: 401 }))).c.sendFeedback(input)).message).toMatch(/đăng nhập/);
    const lim = await (await mk(() => new Response(JSON.stringify({ ok: false, message: "Bạn đã gửi khá nhiều góp ý." }), { status: 429 }))).c.sendFeedback(input);
    expect(lim).toEqual({ ok: false, message: "Bạn đã gửi khá nhiều góp ý." });
    expect((await (await mk(() => new Response("<html>502</html>", { status: 502 }))).c.sendFeedback(input)).ok).toBe(false);
    expect((await (await mk(() => Promise.reject(new Error("net")))).c.sendFeedback(input)).message).toMatch(/Không kết nối/);
  });

  it("không có địa chỉ máy chủ hoặc đầu vào sai thì từ chối ngay, không gọi mạng", async () => {
    let n = 0;
    const f = (async () => (n++, new Response("{}"))) as never;
    const none = await makeController([{ text: "ok" }], {});
    expect((await none.c.sendFeedback({ kind: "bug", text: "Một lỗi nào đó rất lạ", tech: false })).message).toMatch(/chưa nối/);
    const bad = await makeController([{ text: "ok" }], { diagnostics: diag(f) });
    expect((await bad.c.sendFeedback({ kind: "bug", text: "ab", tech: false })).ok).toBe(false);
    expect((await bad.c.sendFeedback({ kind: "zzz" as never, text: "Một lỗi nào đó rất lạ", tech: false })).ok).toBe(false);
    expect(n).toBe(0);
  });
});
