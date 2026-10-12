import { describe, expect, it } from "vitest";
import { LlmClient, LlmError, LocalController, MemoryEnv, quotaFromHeaders, type QuotaInfo, type SessionEvent } from "../src";

const BASE = "https://ai.neu.edu.vn/agent/vllm/v1";
const cfg = () => ({ baseUrl: BASE, model: "m", key: "" });
const sse = (text = "chào") => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`;
const headers = (o: Record<string, string>) => new Headers({ "content-type": "text/event-stream", ...o });

describe("hạn mức token: đọc tiêu đề và mã lỗi 402", () => {
  it("quotaFromHeaders đọc X-Quota-* và bỏ qua khi thiếu/hỏng", () => {
    const q = quotaFromHeaders(new Headers({ "x-quota-state": "warn", "x-quota-limit": "1000000", "x-quota-used": "850000", "x-quota-remaining": "150000", "x-quota-reset": "1800000000", "x-quota-tier": "student" }));
    expect(q).toEqual({ limit: 1_000_000, used: 850_000, remaining: 150_000, pct: 85, state: "warn", resetAt: 1_800_000_000, tier: "student" });
    expect(quotaFromHeaders(new Headers())).toBeNull();
    expect(quotaFromHeaders(new Headers({ "x-quota-state": "<script>" }))).toBeNull();
    expect(quotaFromHeaders(new Headers({ "x-quota-state": "unlimited", "x-quota-limit": "x" }))).toMatchObject({ state: "unlimited", limit: 0, pct: null });
  });

  it("mỗi lần gọi mô hình thành công, hạn mức từ tiêu đề được báo cho onQuota", async () => {
    const seen: QuotaInfo[] = [];
    const fetchImpl = (async () => new Response(sse(), { headers: headers({ "x-quota-state": "ok", "x-quota-limit": "1000000", "x-quota-used": "15", "x-quota-reset": "1800000000" }) })) as unknown as typeof fetch;
    const llm = new LlmClient(cfg, fetchImpl);
    llm.onQuota = (q) => seen.push(q);
    const r = await llm.chat([{ role: "user", content: "x" }]);
    expect(r.content).toBe("chào");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ state: "ok", used: 15, limit: 1_000_000 });
  });

  it("402 quota_exceeded: lỗi có mã, thông báo của máy chủ, KHÔNG thử lại", async () => {
    let calls = 0;
    const body = JSON.stringify({ error: "quota_exceeded", message: "Bạn đã dùng hết hạn mức token hôm nay (1.000.000 token). Hạn mức sẽ làm mới lúc 00:00 ngày mai." });
    const fetchImpl = (async () => (calls++, new Response(body, { status: 402, headers: { "content-type": "application/json", "x-quota-state": "exceeded", "x-quota-limit": "1000000", "x-quota-used": "1100000", "x-quota-reset": "1800000000" } }))) as unknown as typeof fetch;
    const llm = new LlmClient(cfg, fetchImpl);
    let q: QuotaInfo | undefined;
    llm.onQuota = (x) => (q = x);
    const err = await llm.chat([{ role: "user", content: "x" }]).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ status: 402, kind: "quota", code: "quota_exceeded" });
    expect(err.message).toContain("00:00 ngày mai");
    expect(calls).toBe(1);
    expect(q?.state).toBe("exceeded");
  });

  it("402 với thân lạ vẫn ra thông báo dễ hiểu", async () => {
    const fetchImpl = (async () => new Response("quota_exceeded???", { status: 402 })) as unknown as typeof fetch;
    const err = await new LlmClient(cfg, fetchImpl).chat([{ role: "user", content: "x" }]).catch((e) => e);
    expect(err).toMatchObject({ kind: "quota", code: "quota_exceeded" });
    expect(err.message).toContain("hết hạn mức");
  });

  it("402 không có mã quota_exceeded vẫn được nhận là lỗi hạn mức (không rơi vào 'khác')", async () => {
    const fetchImpl = (async () => new Response('{"error":"payment_required"}', { status: 402 })) as unknown as typeof fetch;
    const err = await new LlmClient(cfg, fetchImpl).chat([{ role: "user", content: "x" }]).catch((e) => e);
    expect(err).toMatchObject({ status: 402, kind: "quota" });
    expect(err.message).toMatch(/hạn mức|nạp thêm/);
  });

  it("GET /quota: đọc được; máy chủ khác/lỗi/HTML thì null và không ném lỗi", async () => {
    let url = "";
    const ok = (async (u: string) => ((url = u), new Response(JSON.stringify({ state: "warn", limit: 1_000_000, used: 900_000, remaining: 100_000, pct: 90, reset_at: 1_800_000_000, tier: "student" }), { headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
    expect(await new LlmClient(cfg, ok).quota()).toMatchObject({ state: "warn", limit: 1_000_000, used: 900_000, pct: 90, tier: "student" });
    expect(url).toBe("https://ai.neu.edu.vn/agent/quota");
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect(await new LlmClient(cfg, html).quota()).toBeNull();
    const boom = (async () => { throw new Error("mạng"); }) as unknown as typeof fetch;
    expect(await new LlmClient(cfg, boom).quota()).toBeNull();
    expect(await new LlmClient(() => ({ baseUrl: "https://api.example.com/v1", model: "m" }), ok).quota()).toBeNull(); // không phải máy chủ NEU
    const bad = (async () => new Response(JSON.stringify({ state: "tùy" }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect(await new LlmClient(cfg, bad).quota()).toBeNull();
  });
});

describe("hạn mức token trong controller", () => {
  const make = async (chat: () => Response) => {
    const q = JSON.stringify({ state: "warn", limit: 1_000_000, used: 850_000, remaining: 150_000, pct: 85, reset_at: 1_800_000_000, tier: "student" });
    const fetchImpl = (async (u: string) => (String(u).endsWith("/quota") ? new Response(q, { headers: { "content-type": "application/json" } }) : chat())) as unknown as typeof fetch;
    let saved = {};
    const c = await LocalController.create({
      env: new MemoryEnv("/w", {}), realFs: false, fetchImpl, defaults: { baseUrl: BASE },
      store: { load: async () => saved, save: async (s: any) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    } as any);
    const events: SessionEvent[] = [];
    c.onEvent((e) => events.push(e));
    return { c, events };
  };

  it("lúc khởi động hỏi hạn mức và đưa vào trạng thái giao diện + sự kiện", async () => {
    const { c } = await make(() => new Response("{}"));
    await new Promise((r) => setTimeout(r, 20));
    expect((await c.getState()).quota).toMatchObject({ state: "warn", used: 850_000, limit: 1_000_000 });
  });

  it("hết hạn mức: người dùng nhận thông báo lỗi rõ ràng (có giờ làm mới), phiên không sập", async () => {
    const body = JSON.stringify({ error: "quota_exceeded", message: "Bạn đã dùng hết hạn mức token hôm nay (1.000.000 token). Hạn mức sẽ làm mới lúc 00:00 ngày mai." });
    const { c, events } = await make(() => new Response(body, { status: 402, headers: { "x-quota-state": "exceeded", "x-quota-limit": "1000000", "x-quota-used": "1100000", "x-quota-reset": "1800000000" } }));
    await c.send("xin chào");
    const n = events.find((e: any) => e.type === "notice" && e.level === "error") as any;
    expect(n.text).toContain("00:00 ngày mai");
    expect(events.some((e: any) => e.type === "quota" && e.quota.state === "exceeded")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn_end" });
    expect((await c.getState()).quota?.state).toBe("exceeded");
  });
});
