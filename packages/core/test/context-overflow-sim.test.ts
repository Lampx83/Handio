import { describe, expect, it } from "vitest";
import { LlmError, MemoryEnv } from "../src";
import { makeController } from "./helpers";

// Mô phỏng máy chủ vLLM thật: từ chối (HTTP 400) khi token lời nhắc + max_tokens vượt 32.768.
// Tỉ lệ ký tự/token đo từ dữ liệu thật (11/2026): lời nhắc tiếng Anh + lược đồ công cụ ~3,8; nội dung mới thêm vào (tài liệu, kết quả công cụ) ~2,6–2,9.
const LIMIT = 32768;
const VI = "Theo kế hoạch năm học, khoa tổ chức hội thảo khoa học về chuyển đổi số trong giáo dục đại học với sự tham gia của giảng viên và sinh viên. ";
const doc = (n: number) => `# Tài liệu ${n}\n\n` + VI.repeat(Math.ceil(12000 / VI.length)).slice(0, 12000);
const realTokens = (messages: any[], tools: unknown[]) => {
  const sys = String(messages[0]?.content ?? "").length + JSON.stringify(tools ?? []).length;
  const rest = messages.slice(1).reduce((n, m) => n + String(m.content ?? "").length + JSON.stringify(m.tool_calls ?? "").length, 0);
  return Math.ceil(sys / 3.8 + rest / 2.6 + 6 * messages.length);
};

function server(script: (messages: any[], i: number) => any) {
  const rejected: { prompt: number; max: number }[] = [];
  let i = 0;
  const fn = (messages: any[], _n: number, opts: any) => {
    if (!opts.tools?.length && /summarize|tóm tắt/i.test(String(messages[0]?.content ?? "") + String(messages[1]?.content ?? "").slice(0, 200))) return { text: "Tóm tắt: đã đọc một số tài liệu.", usage: { prompt_tokens: realTokens(messages, []), completion_tokens: 100 } };
    const prompt = realTokens(messages, opts.tools ?? []);
    const max = opts.maxTokens ?? 4096;
    if (prompt + max > LIMIT) {
      rejected.push({ prompt, max });
      throw new LlmError("Ngữ cảnh vượt giới hạn của mô hình.", 400, "context", "", { limit: LIMIT, prompt });
    }
    const step = script(messages, i++);
    return { ...step, usage: { prompt_tokens: prompt, completion_tokens: 200 } };
  };
  return { fn, rejected };
}

describe("tràn ngữ cảnh: tab Design đọc nhiều tài liệu tiếng Việt", () => {
  it("đọc lần lượt 8 tài liệu dài: không bị máy chủ từ chối lần nào", async () => {
    const seed: Record<string, string> = {};
    for (let n = 1; n <= 8; n++) seed[`tai-lieu-${n}.md`] = doc(n);
    const sim = server((_m, i) => (i < 8 ? { calls: [{ name: "read_document", args: { path: `tai-lieu-${i + 1}.md` } }] } : { text: "Đã đọc xong 8 tài liệu." }));
    const { c, events } = await makeController((m, n, o) => sim.fn(m, n, o), { env: new MemoryEnv("/ws", seed), profile: "design", settings: { mode: "auto" } as any });
    await c.send("Đọc 8 tài liệu rồi tóm tắt để làm poster");
    expect(sim.rejected).toEqual([]);
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: "Đã đọc xong 8 tài liệu." });
  });

  it("máy chủ báo rõ số token: thử lại ngay với max_tokens vừa đủ, không phải tóm tắt hội thoại", async () => {
    let n = 0;
    const seen: number[] = [];
    const { c, events, llm } = await makeController((_m, _i, o: any) => {
      seen.push(o.maxTokens);
      if (n++ === 0) throw new LlmError("Ngữ cảnh vượt giới hạn của mô hình.", 400, "context", "", { limit: LIMIT, prompt: 25000 });
      return { text: "xong" };
    });
    await c.send("x");
    expect(llm.calls.length).toBe(2);
    expect(seen[1]).toBeLessThanOrEqual(LIMIT - 25000);
    expect(seen[1]).toBeGreaterThanOrEqual(1024);
    expect(events.some((e: any) => e.type === "notice" && /tóm tắt hội thoại|Ngữ cảnh đầy/.test(String(e.text)))).toBe(false);
  });

  it("chính lời nhắc đã quá giới hạn: vẫn tóm tắt rồi thử lại như trước", async () => {
    let n = 0;
    const { c, events } = await makeController(() => {
      if (n++ === 0) throw new LlmError("Ngữ cảnh vượt giới hạn của mô hình.", 400, "context", "", { limit: LIMIT, prompt: 40000 });
      return { text: "xong" };
    }, { seed: { "README.md": "#" } });
    await c.send("một"); // cần vài tin nhắn để có gì mà tóm tắt
    n = 0;
    await c.send("hai");
    expect(events.some((e: any) => e.type === "notice" && /Ngữ cảnh đầy/.test(String(e.text)))).toBe(true);
  });
});

describe("đọc số từ thông báo lỗi của vLLM", () => {
  it.each([
    ["This model's maximum context length is 32768 tokens. However, you requested 34000 tokens (21712 in the messages, 12288 in the completion). Please reduce the length of the messages or completion.", 32768, 21712],
    ["'max_tokens' or 'max_completion_tokens' is too large: 12288. This model's maximum context length is 32768 tokens and your request has 21712 input tokens (12288 > 32768 - 21712).", 32768, 21712],
    ["This model's maximum context length is 32768 tokens. However, you requested 12288 output tokens and your prompt contains at least 20481 input tokens, for a total of at least 32769 tokens.", 32768, 20481],
    ["This model's maximum context length is 16384 tokens. However, your request has 40000 input tokens. Please reduce the length of the input messages.", 16384, 40000],
  ])("%s", async (text, limit, prompt) => {
    const { contextNumbers } = await import("../src/llm");
    expect(contextNumbers(text)).toEqual({ limit, prompt });
  });
  it("thông báo khác: không đoán", async () => {
    const { contextNumbers } = await import("../src/llm");
    expect(contextNumbers("prompt is too long")).toEqual({});
  });
});
