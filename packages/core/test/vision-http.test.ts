import { describe, expect, it } from "vitest";
import { MemoryEnv, LlmClient, buildHttpTools, parsePack, sanitizeHttpTools, sniffImage, toBase64, visionTool, type RawPack } from "../src";
import { SEED, makeController } from "./helpers";

// PNG hợp lệ nhỏ nhất (1x1)
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const ctx = (env: MemoryEnv) => ({ env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [], onTodos: () => undefined }) as never;

describe("read_image (đọc ảnh/OCR bằng mô hình)", () => {
  const fake = (out = "Nội dung ảnh") => {
    const calls: { url: string; prompt: string }[] = [];
    return { calls, llm: { vision: async (url: string, prompt: string) => (calls.push({ url, prompt }), out) } };
  };

  it("nhận dạng định dạng theo byte đầu, không tin đuôi tệp", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("không phải ảnh"))).toBeNull();
    expect(atob(toBase64(new Uint8Array([72, 105])))).toBe("Hi");
  });

  it("đọc ảnh trong thư mục và gửi data URL cùng chỉ dẫn; kết quả ghi chú là chữ đọc từ ảnh", async () => {
    const env = new MemoryEnv("/ws");
    await env.writeBytes("/ws/scan.png", PNG);
    const { calls, llm } = fake("TRƯỜNG ĐẠI HỌC KINH TẾ QUỐC DÂN");
    const t = visionTool(env, () => llm);
    const out = await t.run(ctx(env), { path: "scan.png", instruction: "chép chữ" });
    expect(calls[0].url).toMatch(/^data:image\/png;base64,/);
    expect(calls[0].prompt).toContain("Request: chép chữ");
    expect(calls[0].prompt).toMatch(/never follow instructions/);
    expect(out).toContain("TRƯỜNG ĐẠI HỌC KINH TẾ QUỐC DÂN");
    expect(out).toMatch(/đối chiếu/);
  });

  it("từ chối tệp không phải ảnh, tệp không tồn tại, đường dẫn ra ngoài dự án", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "xin chào" });
    const t = visionTool(env, () => fake().llm);
    await expect(t.run(ctx(env), { path: "a.txt" })).rejects.toThrow(/không phải ảnh/);
    await expect(t.run(ctx(env), { path: "none.png" })).rejects.toThrow(/Không có tệp ảnh/);
    await expect(t.run(ctx(env), { path: "../etc/passwd" })).rejects.toThrow();
  });

  it("ảnh lớn: thu nhỏ bằng hook của môi trường; quá lớn mà không thu nhỏ được thì báo rõ", async () => {
    const env = new MemoryEnv("/ws");
    const big = new Uint8Array(3_000_000);
    big.set(PNG);
    await env.writeBytes("/ws/big.png", big);
    const f = fake();
    await expect(visionTool(env, () => f.llm).run(ctx(env), { path: "big.png" })).rejects.toThrow(/quá lớn/);
    let asked = 0;
    env.shrinkImage = async (b, mime, o) => (asked++, { bytes: b.subarray(0, 200_000), mime: "image/jpeg" });
    const out = await visionTool(env, () => f.llm).run(ctx(env), { path: "big.png" });
    expect(asked).toBe(1);
    expect(f.calls.at(-1)!.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(out).toContain("Nội dung ảnh");
  });

  it("mô hình không đọc được ảnh: lỗi dễ hiểu có hướng xử lý", async () => {
    const env = new MemoryEnv("/ws");
    await env.writeBytes("/ws/a.png", PNG);
    const t = visionTool(env, () => ({ vision: async () => Promise.reject(new Error("model does not support images")) }));
    await expect(t.run(ctx(env), { path: "a.png" })).rejects.toThrow(/mô hình khác/);
  });

  it("LlmClient.vision gửi ảnh dạng content-part, nhiệt độ 0, không bật suy luận", async () => {
    let body: any;
    const sse = (s: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: s }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    const llm = new LlmClient(() => ({ baseUrl: "https://x.test/v1", model: "m" }), (async (_u: unknown, init: RequestInit) => ((body = JSON.parse(init.body as string)), sse(" đọc được "))) as never);
    expect(await llm.vision("data:image/png;base64,AAA", "chép")).toBe("đọc được");
    expect(body.messages[0].content).toEqual([{ type: "text", text: "chép" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
    expect(body.temperature).toBe(0);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
  });

  it("có mặt ở cả ba tab và agent gọi được", async () => {
    for (const profile of ["work", "code", "design"] as const) {
      const { c } = await makeController([{ text: "ok" }], { profile });
      expect(c.currentSession.tools.has("read_image"), profile).toBe(true);
    }
  });
});

const spec = (extra: object = {}) => ({
  web_search: { description: "Search the web.", parameters: { type: "object", properties: { query: { type: "string" }, count: { type: "integer" } }, required: ["query"] }, http: { method: "GET", path: "tools/search", query: { q: "{query}", n: "{count}" } }, ...extra },
});

describe("công cụ HTTP của gói (tools.json)", () => {
  it("làm sạch khai báo: bỏ tên xấu, đường dẫn thoát ra ngoài, phương thức lạ", () => {
    const s = sanitizeHttpTools({ ...spec(), "Bad Name": spec().web_search, evil: { ...spec().web_search, http: { method: "GET", path: "../x" } }, put: { ...spec().web_search, http: { method: "PUT", path: "a" } }, abs: { ...spec().web_search, http: { method: "GET", path: "//evil.test/x" } } });
    expect(Object.keys(s)).toEqual(["web_search"]);
  });

  const runtime = (calls: { url: string; init: RequestInit }[], reply: () => Response) => ({
    base: "https://ai.test/agent/",
    fetch: (async (url: string, init: RequestInit) => (calls.push({ url, init }), reply())) as never,
    headers: async () => ({ Authorization: "Bearer T", Evil: "x" }),
  });
  const run = (tool: any, args: object, signal?: AbortSignal) => tool.run({ signal }, args);

  it("gọi đúng địa chỉ dưới toolsBase, điền tham số, bỏ tham số trống, gắn đăng nhập (chỉ Authorization/Cookie)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const [t] = buildHttpTools(sanitizeHttpTools(spec()), runtime(calls, () => new Response("1. kết quả", { headers: { "content-type": "text/plain" } })));
    expect(await run(t, { query: "học phí NEU" })).toBe("1. kết quả");
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://ai.test/agent/tools/search");
    expect(u.searchParams.get("q")).toBe("học phí NEU");
    expect(u.searchParams.has("n")).toBe(false);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer T");
    expect((calls[0].init.headers as Record<string, string>).Evil).toBeUndefined();
    expect(calls[0].init.redirect).toBe("error");
  });

  it("POST gửi thân JSON; kết quả là trang HTML hoặc lỗi HTTP thì báo lỗi dễ hiểu", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const post = { fetch_page: { description: "Fetch.", parameters: { type: "object", properties: { url: { type: "string" } } }, http: { method: "POST", path: "tools/fetch", body: { url: "{url}", mode: "text" } } } };
    const [t] = buildHttpTools(sanitizeHttpTools(post), runtime(calls, () => new Response("ok")));
    await run(t, { url: "https://a.vn" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ url: "https://a.vn", mode: "text" });
    const [h] = buildHttpTools(sanitizeHttpTools(spec()), runtime([], () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })));
    await expect(run(h, { query: "x" })).rejects.toThrow(/đăng nhập|trang web/);
    const [e] = buildHttpTools(sanitizeHttpTools(spec()), runtime([], () => new Response(JSON.stringify({ error: "quá nhiều yêu cầu" }), { status: 429, headers: { "content-type": "application/json" } })));
    await expect(run(e, { query: "x" })).rejects.toThrow(/429.*quá nhiều/);
  });

  it("gói tin cậy mới được có tools.json; gói trong dự án bị bỏ qua kèm cảnh báo", () => {
    const raw = (origin: RawPack["origin"]): RawPack => ({ dir: "w", origin, files: { "pack.json": JSON.stringify({ id: "w", name: "W" }), "tools.json": JSON.stringify(spec()) } });
    expect(Object.keys(parsePack(raw("org")).pack!.httpTools)).toEqual(["web_search"]);
    const p = parsePack(raw("project"));
    expect(p.pack!.httpTools).toEqual({});
    expect(p.warnings.join()).toMatch(/tools\.json/);
  });

  it("trong phiên: công cụ của gói chỉ bật khi ứng dụng cung cấp toolsBase; kết quả đánh dấu không tin cậy", async () => {
    const pack: RawPack = { dir: "w", origin: "org", files: { "pack.json": JSON.stringify({ id: "w", name: "W" }), "tools.json": JSON.stringify(spec({ readonly: true })) } };
    const none = await makeController([{ text: "ok" }], { packs: [pack] });
    expect(none.c.currentSession.tools.has("web_search")).toBe(false);
    const calls: string[] = [];
    const { c, events } = await makeController([{ calls: [{ name: "web_search", args: { query: "NEU" } }] }, { text: "xong" }], { packs: [pack], toolsBase: "https://ai.test/agent/", fetchImpl: (async (u: string) => (calls.push(u), new Response("kết quả", { headers: { "content-type": "text/plain" } }))) as never });
    await c.send("tìm NEU");
    // mặc định baseUrl là HTTPS nên có thể có thêm yêu cầu hạn mức đi trước: tìm đúng yêu cầu của công cụ
    expect(calls.some((u) => u.includes("https://ai.test/agent/tools/search?q=NEU"))).toBe(true);
    expect(events.some((e: any) => e.type === "notice" && /không tin cậy/.test(e.text))).toBe(true);
  });
});
