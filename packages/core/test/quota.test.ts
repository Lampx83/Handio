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

describe("phân quyền theo nhóm: tab được dùng", () => {
  const quotaJson = (tabs?: string[]) => JSON.stringify({ state: "ok", limit: 1_000_000, used: 10, remaining: 999_990, pct: 0, reset_at: 1_800_000_000, tier: "student", ...(tabs ? { tabs } : {}) });
  const jsonRes = (b: string) => new Response(b, { headers: { "content-type": "application/json" } });

  it("GET /quota đọc danh sách tab (bỏ tên lạ); thiếu = không giới hạn", async () => {
    const f = (tabs?: unknown) => (async () => jsonRes(JSON.stringify({ state: "ok", limit: 1, used: 0, remaining: 1, pct: 0, reset_at: 1, tabs }))) as unknown as typeof fetch;
    expect((await new LlmClient(cfg, f(["design", "work", "<x>"])).quota())?.tabs).toEqual(["work", "design"]);
    expect((await new LlmClient(cfg, f([])).quota())?.tabs).toEqual([]);
    expect((await new LlmClient(cfg, f(undefined)).quota())?.tabs).toBeUndefined();
    expect((await new LlmClient(cfg, f("work")).quota())?.tabs).toBeUndefined();
  });

  it("gửi X-Neu-Tab tới gateway NEU (…/vllm/v1) với tab hợp lệ; KHÔNG gửi tới máy chủ khác hoặc tên tab lạ", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => (seen.push(init.headers as Record<string, string>), new Response(sse(), { headers: headers({}) }))) as unknown as typeof fetch;
    await new LlmClient(() => ({ ...cfg(), tab: "design" }), fetchImpl).chat([{ role: "user", content: "x" }]);
    await new LlmClient(() => ({ baseUrl: "https://api.example.com/v1", model: "m", tab: "design" }), fetchImpl).chat([{ role: "user", content: "x" }]);
    await new LlmClient(() => ({ ...cfg(), tab: "hack\r\nX: y" }), fetchImpl).chat([{ role: "user", content: "x" }]);
    await new LlmClient(cfg, fetchImpl).chat([{ role: "user", content: "x" }]);
    expect(seen.map((h) => h["X-Neu-Tab"])).toEqual(["design", undefined, undefined, undefined]);
  });

  it("403 tab_not_allowed / tab_required: lỗi có mã, thông báo của máy chủ, KHÔNG thử lại", async () => {
    for (const code of ["tab_not_allowed", "tab_required"]) {
      let calls = 0;
      const fetchImpl = (async () => (calls++, new Response(JSON.stringify({ error: code, message: "Nhóm của bạn không được dùng tab Design (được dùng: Work)." }), { status: 403 }))) as unknown as typeof fetch;
      const err = await new LlmClient(cfg, fetchImpl).chat([{ role: "user", content: "x" }]).catch((e) => e);
      expect(err).toBeInstanceOf(LlmError);
      expect(err).toMatchObject({ status: 403, kind: "auth", code });
      expect(err.message).toContain("không được dùng tab Design");
      expect(calls).toBe(1);
    }
    // 403 thường (key sai) vẫn là thông báo cũ
    const plain = (async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    const e2 = await new LlmClient(cfg, plain).chat([{ role: "user", content: "x" }]).catch((e) => e);
    expect(e2.code).toBe("");
  });

  it("403 model_not_allowed và 402 tab_quota_exceeded: mã riêng, thông báo của máy chủ, KHÔNG thử lại", async () => {
    const cases: [number, string, string, string][] = [
      [403, "model_not_allowed", "Nhóm của bạn không được dùng mô hình x (được dùng: m). Hãy chọn lại mô hình ở Cài đặt.", "auth"],
      [402, "tab_quota_exceeded", "Bạn đã dùng hết hạn mức token hôm nay của tab Code (1.000 token).", "quota"],
    ];
    for (const [status, code, message, kind] of cases) {
      let calls = 0;
      const fetchImpl = (async () => (calls++, new Response(JSON.stringify({ error: code, message }), { status }))) as unknown as typeof fetch;
      const err = await new LlmClient(cfg, fetchImpl).chat([{ role: "user", content: "x" }]).catch((e) => e);
      expect(err).toMatchObject({ status, kind, code });
      expect(err.message).toBe(message);
      expect(calls).toBe(1);
    }
    // thân hỏng vẫn ra thông báo dễ hiểu, không phải "key embedding"
    const bad = (async () => new Response("model_not_allowed<<", { status: 403 })) as unknown as typeof fetch;
    const e3 = await new LlmClient(cfg, bad).chat([{ role: "user", content: "x" }]).catch((e) => e);
    expect(e3.message).toContain("không được dùng mô hình");
  });

  const make = async (profile: "work" | "code" | "design", tabs: string[] | undefined) => {
    const chats: string[] = [];
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      if (String(u).endsWith("/quota")) return jsonRes(quotaJson(tabs));
      chats.push(String((init?.headers as Record<string, string>)["X-Neu-Tab"]));
      return new Response(sse("ok"), { headers: headers({ "x-quota-state": "ok", "x-quota-limit": "1000000", "x-quota-used": "20", "x-quota-reset": "1800000000" }) });
    }) as unknown as typeof fetch;
    let saved = {};
    const c = await LocalController.create({
      env: new MemoryEnv("/w", {}), realFs: false, fetchImpl, defaults: { baseUrl: BASE }, profile,
      store: { load: async () => saved, save: async (s: any) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    } as any);
    const events: SessionEvent[] = [];
    c.onEvent((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 20));
    return { c, events, chats };
  };

  it("không cấu hình (máy chủ không báo tabs): mọi tab chạy như cũ", async () => {
    for (const p of ["work", "code", "design"] as const) {
      const { c, events, chats } = await make(p, undefined);
      await c.send("xin chào");
      expect(events.some((e: any) => e.type === "notice" && e.level === "error")).toBe(false);
      expect(chats.length).toBeGreaterThan(0);
      expect(new Set(chats)).toEqual(new Set([p])); // mọi lượt gọi mô hình đều khai đúng tab của controller
    }
  });

  it("tab được phép chạy; tab bị cấm bị từ chối NGAY ở lõi (không gọi mô hình) kèm lý do", async () => {
    const ok = await make("work", ["work"]);
    await ok.c.send("xin chào");
    expect(ok.chats.length).toBeGreaterThan(0);
    expect((await ok.c.getState()).quota?.tabs).toEqual(["work"]); // tiêu đề phản hồi không xoá danh sách tab đã biết

    const no = await make("design", ["work"]);
    await no.c.send("xin chào");
    expect(no.chats).toEqual([]);
    const n = no.events.find((e: any) => e.type === "notice" && e.level === "error") as any;
    expect(n.text).toContain("không được dùng tab");
    expect(no.events.some((e: any) => e.type === "turn_start")).toBe(false);
  });

  it("nhóm không có tab nào: mọi tab bị từ chối", async () => {
    for (const p of ["work", "code", "design"] as const) {
      const { c, chats } = await make(p, []);
      await c.send("xin chào");
      expect(chats).toEqual([]);
    }
  });

  it("máy chủ từ chối (phía máy chủ vẫn kiểm tra dù lõi chưa biết): người dùng thấy lý do, phiên không sập", async () => {
    const fetchImpl = (async (u: string) => (String(u).endsWith("/quota") ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ error: "tab_not_allowed", message: "Nhóm của bạn không được dùng tab Code (được dùng: Work)." }), { status: 403 }))) as unknown as typeof fetch;
    let saved = {};
    const c = await LocalController.create({
      env: new MemoryEnv("/w", {}), realFs: false, fetchImpl, defaults: { baseUrl: BASE }, profile: "code",
      store: { load: async () => saved, save: async (s: any) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    } as any);
    const events: SessionEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.send("xin chào");
    expect((events.find((e: any) => e.type === "notice" && e.level === "error") as any).text).toContain("không được dùng tab Code");
    expect(events.at(-1)).toMatchObject({ type: "turn_end" });
  });
});

describe("phân quyền mô hình: danh sách /models do cổng lọc", () => {
  const list = (ids: unknown[], h: Record<string, string> = {}) => (async () => new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), { headers: { "content-type": "application/json", ...h } })) as unknown as typeof fetch;

  it("danh sách đã lọc còn mô hình: trả đúng các mô hình đó (bỏ phần tử lạ)", async () => {
    expect(await new LlmClient(cfg, list(["m", 5, null], { "x-neu-models": "filtered" })).models()).toEqual(["m"]);
  });

  it("lọc xong không còn mô hình nào: lỗi rõ bằng tiếng Việt, có mã model_not_allowed", async () => {
    const err = await new LlmClient(cfg, list([], { "x-neu-models": "filtered" })).models().catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ status: 403, code: "model_not_allowed", message: "Tài khoản của bạn chưa được dùng mô hình nào, liên hệ quản trị viên." });
  });

  it("máy chủ khác trả danh sách rỗng (không có tiêu đề lọc): như cũ, không báo lỗi", async () => {
    expect(await new LlmClient(cfg, list([])).models()).toEqual([]);
  });

  it("Kiểm tra kết nối hiện đúng thông báo; listModels không ném lỗi", async () => {
    let saved = {};
    const c = await LocalController.create({
      env: new MemoryEnv("/w", {}), realFs: false, fetchImpl: list([], { "x-neu-models": "filtered" }), defaults: { baseUrl: BASE },
      store: { load: async () => saved, save: async (s: any) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    } as any);
    expect(await c.testConnection()).toEqual({ ok: false, message: "Tài khoản của bạn chưa được dùng mô hình nào, liên hệ quản trị viên." });
    expect(await c.listModels()).toEqual([]);
  });
});
