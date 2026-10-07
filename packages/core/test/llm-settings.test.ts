import { describe, expect, it } from "vitest";
import { LlmClient, LlmError, normalizeSettings, parseTextToolCalls, sanitizeProjectSettings, toPublic } from "../src";

const sse = (...chunks: unknown[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of chunks) c.enqueue(e.encode("data: " + (typeof x === "string" ? x : JSON.stringify(x)) + "\n\n")); c.close(); } }), { status: 200 });
const cfg = () => ({ baseUrl: "https://x/v1/", model: "m", key: "K", keyHeader: "x-k" });

describe("LlmClient", () => {
  it("đọc luồng SSE: nội dung, tool_calls gộp theo index, usage; gửi key đúng header", async () => {
    let seen: any;
    const f = (async (url: string, init: any) => {
      seen = { url, init };
      return sse({ choices: [{ delta: { content: "Xin " } }] }, { choices: [{ delta: { content: "chào" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "read_file", arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }, "[DONE]");
    }) as unknown as typeof fetch;
    const got: string[] = [];
    const r = await new LlmClient(cfg, f).chat([{ role: "user", content: "hi" }], { onContent: (t) => got.push(t) });
    expect(r.content).toBe("Xin chào");
    expect(got).toEqual(["Xin ", "chào"]);
    expect(r.toolCalls).toEqual([{ id: "t1", name: "read_file", arguments: '{"path":"a"}' }]);
    expect(r.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3 });
    expect(seen.url).toBe("https://x/v1/chat/completions");
    expect(seen.init.headers["x-k"]).toBe("K");
    expect(JSON.parse(seen.init.body)).toMatchObject({ stream: true, model: "m", chat_template_kwargs: { enable_thinking: false } });
  });
  it("tự thử lại khi 429 rồi thành công", async () => {
    let n = 0;
    const f = (async () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "Retry-After": "0" } }) : sse({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }))) as unknown as typeof fetch;
    const notes: string[] = [];
    const r = await new LlmClient(cfg, f).chat([], { notify: (m) => notes.push(m) });
    expect(r.content).toBe("ok");
    expect(n).toBe(2);
    expect(notes[0]).toMatch(/giới hạn/);
  }, 15000);
  it("phân loại lỗi: 401, 403, context", async () => {
    const mk = (status: number, body = "") => new LlmClient(cfg, (async () => new Response(body, { status })) as unknown as typeof fetch);
    await expect(mk(401).chat([])).rejects.toMatchObject({ kind: "auth" });
    await expect(mk(403).chat([])).rejects.toMatchObject({ kind: "auth" });
    await expect(mk(400, "maximum context length is 32768").chat([])).rejects.toMatchObject({ kind: "context" });
  });
  it("máy chủ trả về trang HTML (nginx 405) thì báo gọn, không in nguyên HTML", async () => {
    const mk = (status: number, body: string) => new LlmClient(cfg, (async () => new Response(body, { status })) as unknown as typeof fetch);
    const err = (await mk(405, "<html>\n<head><title>405 Not Allowed</title></head></html>").chat([]).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/chưa được cấu hình/);
    expect(err.message).not.toMatch(/<html/i);
    expect(err).toMatchObject({ status: 405 });
  });
  it("dừng được bằng AbortSignal", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(new LlmClient(cfg, (async () => sse()) as unknown as typeof fetch).chat([], { signal: ac.signal })).rejects.toBeInstanceOf(LlmError);
  });
  it("đọc lời gọi công cụ mà mô hình viết thành văn bản", () => {
    const a = parseTextToolCalls('Để xem.\n<tool_call>{"name":"read_file","arguments":{"path":"a.py"}}</tool_call>');
    expect(a.text).toBe("Để xem.");
    expect(a.calls[0]).toMatchObject({ name: "read_file", arguments: '{"path":"a.py"}' });
    const b = parseTextToolCalls("<tool_call><function=bash><parameter=command>ls -la</parameter></function></tool_call>");
    expect(JSON.parse(b.calls[0].arguments)).toEqual({ command: "ls -la" });
  });
});

describe("cấu hình", () => {
  it("cấu hình dự án chỉ được thêm quy tắc, không đổi máy chủ/key/hook, không tự bật bypass", () => {
    const p = sanitizeProjectSettings({ base_url: "http://evil", baseUrl: "http://evil", key: "K", hooks: { PreToolUse: [] }, mcpServers: { x: {} }, mode: "bypass", permissions: { allow: ["bash(*)"], deny: ["bash(rm *)", 5] } });
    expect(p).toEqual({ allow: ["bash(*)"], deny: ["bash(rm *)"], mode: undefined, hooks: {}, mcpServers: {} }); // hook/MCP hợp lệ mới được giữ (và chỉ chạy khi Tin cậy)
    expect(sanitizeProjectSettings({ mode: "plan" }).mode).toBe("plan");
    expect(sanitizeProjectSettings("lạ")).toEqual({ allow: [], deny: [], mode: undefined, hooks: {}, mcpServers: {} });
  });
  it("chuẩn hoá và không để lộ key cho giao diện", () => {
    const s = normalizeSettings({ baseUrl: "http://a/v1///", mode: "xyz" as any, maxSteps: 9999, key: "abcd1234" });
    expect(s).toMatchObject({ baseUrl: "http://a/v1", mode: "default", maxSteps: 200 });
    expect(toPublic(s)).toMatchObject({ hasKey: true, keyHint: "••••1234" });
    expect(JSON.stringify(toPublic(s))).not.toContain("abcd1234");
  });
});

describe("key tích hợp sẵn", () => {
  const builtin = { key: "K-BUILTIN", hosts: ["gw.example:8037"] };
  it("chỉ dùng cho máy chủ được phép và khi người dùng chưa nhập key", async () => {
    const { effectiveKey, toPublic } = await import("../src");
    expect(effectiveKey({ baseUrl: "https://gw.example:8037/vllm/v1" }, builtin)).toEqual({ key: "K-BUILTIN", builtin: true });
    expect(effectiveKey({ baseUrl: "https://evil.example/vllm/v1" }, builtin)).toEqual({ builtin: false }); // không gửi key sang máy chủ lạ
    expect(effectiveKey({ baseUrl: "https://gw.example:8037/v1", key: "MINE" }, builtin)).toEqual({ key: "MINE", builtin: false });
    expect(effectiveKey({ baseUrl: "https://gw.example:8037/vllm/v1" }, undefined)).toEqual({ builtin: false });
    expect(effectiveKey({ baseUrl: "không-phải-url" }, builtin)).toEqual({ builtin: false });
    const pub = toPublic(normalizeSettings({ baseUrl: "https://gw.example:8037/vllm/v1" }), builtin);
    expect(pub).toMatchObject({ hasKey: true, keyHint: "key tích hợp sẵn" });
    expect(JSON.stringify(pub)).not.toContain("K-BUILTIN");
  });
  it("controller gửi key tích hợp tới gateway đúng và không gửi tới địa chỉ khác", async () => {
    const { LocalController, MemoryEnv } = await import("../src");
    const seen: { url: string; key?: string }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push({ url, key: init?.headers?.["x-ollama-seckey"] });
      return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    let saved: any = { baseUrl: "https://gw.example:8037/vllm/v1" };
    const c = await LocalController.create({ env: new MemoryEnv("/w", {}), realFs: false, builtinKey: builtin, fetchImpl, store: { load: async () => saved, save: async (s) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined } });
    await c.testConnection();
    await c.saveSettings({ baseUrl: "https://evil.example/vllm/v1" });
    await c.testConnection();
    expect(seen[0]).toMatchObject({ url: "https://gw.example:8037/vllm/v1/models", key: "K-BUILTIN" });
    expect(seen[1].key).toBeUndefined();
    expect((await c.getState()).settings.hasKey).toBe(false);
  });
});


describe("an toàn kết nối", () => {
  it("bắt buộc https (trừ máy cục bộ), cấm tài khoản trong URL; bật allowInsecure mới cho http", async () => {
    const { assertSecureEndpoint } = await import("../src");
    for (const ok of ["https://ai.example/agent/vllm/v1", "http://localhost:8037/v1", "http://127.0.0.1:5173/mock/v1", "http://[::1]:1/v1"]) expect(() => assertSecureEndpoint(ok), ok).not.toThrow();
    for (const bad of ["http://192.0.2.11:8037/vllm/v1", "http://example.com/v1", "ftp://x/v1", "https://user:pw@example.com/v1", "không phải url"]) expect(() => assertSecureEndpoint(bad), bad).toThrow();
    expect(() => assertSecureEndpoint("http://192.0.2.11:8037/vllm/v1", true)).not.toThrow();
    expect(() => assertSecureEndpoint("https://user:pw@example.com/v1", true)).toThrow(/tên đăng nhập/);
  });
  it("LlmClient từ chối gửi key tới http không mã hoá và không gọi mạng", async () => {
    let called = 0;
    const f = (async () => (called++, new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const c = new LlmClient(() => ({ baseUrl: "http://192.0.2.11:8037/vllm/v1", model: "m", key: "K" }), f);
    await expect(c.chat([])).rejects.toMatchObject({ kind: "insecure" });
    await expect(c.models()).rejects.toMatchObject({ kind: "insecure" });
    expect(called).toBe(0);
    const ok = new LlmClient(() => ({ baseUrl: "http://192.0.2.11:8037/vllm/v1", model: "m", key: "K", allowInsecure: true }), (async () => sse({ choices: [{ delta: { content: "ok" } }] })) as unknown as typeof fetch);
    expect((await ok.chat([])).content).toBe("ok");
  });
  it("không theo chuyển hướng (key không bị gửi sang máy khác)", async () => {
    let init: any;
    const f = (async (_u: string, i: any) => ((init = i), sse({ choices: [{ delta: { content: "x" } }] }))) as unknown as typeof fetch;
    await new LlmClient(cfg, f).chat([]);
    expect(init.redirect).toBe("error");
  });
  it("báo lỗi rõ khi địa chỉ API trả về trang web", async () => {
    const f = (async () => new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(new LlmClient(cfg, f).chat([])).rejects.toThrow(/trang web/);
    await expect(new LlmClient(cfg, f).models()).rejects.toThrow(/trang web/);
  });
});
