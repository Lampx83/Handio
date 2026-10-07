import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIAG_SCHEMA, DiagnosticsRecorder, LlmError, LocalController, MemoryEnv, buildPayload, checkForUpdate, chunkEvents, compareVersions, parsePolicy, safeModelName, safeToolName, sanitizeApp, sanitizeEvent, type LlmClient, type Policy, type SessionEvent, type Settings } from "../src";
import { FakeLlm, SEED, type Step } from "./helpers";

const T0 = 1_800_000_000_000;
const INSTALL = "0123456789abcdef0123456789abcdef";
const SECRETS = ["sk-LIVE-SECRET-12345", "/Users/mac/Documents/luong-2026.xlsx", "alice.nguyen@neu.edu.vn", "https://intranet.neu.edu.vn/private?token=abc", "C:\\Users\\mac\\.ssh\\id_rsa", "rm -rf /home/secret", "ghp_ABCDEF1234567890"];

interface Sent {
  url: string;
  body: string;
  headers: Record<string, string>;
}
function fakeFetch(status: number | (() => number | Error) = 200) {
  const sent: Sent[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: String(init.body), headers: init.headers as Record<string, string> });
    const s = typeof status === "function" ? status() : status;
    if (s instanceof Error) throw s;
    return new Response("{}", { status: s, headers: s === 429 ? { "Retry-After": "7" } : {} });
  });
  return { f: f as unknown as typeof fetch, sent, mock: f };
}

function mkRecorder(over: Partial<ConstructorParameters<typeof DiagnosticsRecorder>[0]> = {}) {
  const net = fakeFetch();
  const clock = { t: T0 };
  const r = new DiagnosticsRecorder({
    endpoint: "/agent/diag",
    enabled: () => true,
    version: "0.1.0",
    platform: "web",
    context: () => ({ profile: "code", model: "qwen3.5-35b-a3b-int4", install: INSTALL }),
    fetch: net.f,
    now: () => clock.t,
    flushDelayMs: 1_000_000, // không tự gửi trong test; gọi flush() tay
    ...over,
  });
  return { r, net, clock };
}

const base = { depth: 0 } as const;
function turn(r: DiagnosticsRecorder, clock: { t: number }, evs: (SessionEvent | number)[], interrupted = false) {
  r.onEvent({ type: "turn_start" });
  for (const e of evs) {
    if (typeof e === "number") clock.t += e;
    else r.onEvent(e);
  }
  r.onEvent({ type: "turn_end", interrupted, final: "" });
}
const toolPair = (id: string, name: string, ok: boolean, args: Record<string, unknown> = {}): SessionEvent[] => [
  { type: "tool_start", id, name, summary: "x", args, ...base },
  { type: "tool_result", id, name, ok, output: "x", ...base },
];
const msgEnd = (text: string): SessionEvent => ({ type: "message_end", text, ...base });

async function payloads(r: DiagnosticsRecorder, net: ReturnType<typeof fakeFetch>) {
  await r.flush();
  return net.sent.map((s) => JSON.parse(s.body));
}
const allEvents = (ps: any[]) => ps.flatMap((p) => p.events as any[]);
const sigCodes = (ps: any[]) => allEvents(ps).filter((e) => e.t === "signal").map((e) => e.code);

describe("diagnostics: bộ lọc danh sách cho phép (không rò nội dung)", () => {
  it("tên công cụ/mô hình lạ hoặc chứa bí mật bị thay bằng 'other'", () => {
    for (const s of SECRETS) {
      expect(safeToolName(s)).toBe("other");
      expect(safeModelName(s)).toBe("other");
    }
    expect(safeToolName("mcp__srv__do_stuff")).toBe("mcp");
    expect(safeToolName("bash")).toBe("bash");
    expect(safeModelName("Qwen/Qwen3-8B")).toBe("Qwen3-8B");
    expect(safeModelName("qwen3.5-35b-a3b-int4")).toBe("qwen3.5-35b-a3b-int4");
  });

  it("trường lạ bị bỏ; trường sai kiểu/ngoài danh sách bị bỏ; thiếu trường bắt buộc => bỏ cả sự kiện", () => {
    const ev = sanitizeEvent({ t: "tool", ts: T0 / 1000, name: "bash", ok: true, dur: "lt1s", path: SECRETS[1], cmd: SECRETS[5], email: SECRETS[2] });
    expect(ev).toEqual({ t: "tool", ts: T0 / 1000, name: "bash", ok: true, dur: "lt1s" });
    expect(sanitizeEvent({ t: "tool", ts: T0 / 1000, name: "bash", ok: "true", dur: "lt1s" })).toBeNull();
    expect(sanitizeEvent({ t: "tool", ts: T0 / 1000, name: "bash", ok: true, dur: SECRETS[0] })).toBeNull();
    expect(sanitizeEvent({ t: "nope", ts: T0 / 1000 })).toBeNull();
    expect(sanitizeEvent({ t: "constructor", ts: T0 / 1000 })).toBeNull();
    expect(sanitizeEvent({ t: "signal", ts: T0 / 1000, code: "loop", tool: SECRETS[0], n: 1e12 })).toEqual({ t: "signal", ts: T0 / 1000, code: "loop", tool: "other", n: 100000 });
    // ghi chú tự do CHỈ có ở sự kiện "report" và bị cắt độ dài
    expect(sanitizeEvent({ t: "turn", ts: T0 / 1000, end: "ok", note: "bí mật" })).toEqual({ t: "turn", ts: T0 / 1000, end: "ok" });
    expect((sanitizeEvent({ t: "report", ts: T0 / 1000, note: "x".repeat(900) }) as any).note).toHaveLength(500);
  });

  it("sanitizeApp: chỉ nhận mã cài 32 hex + phiên bản hợp lệ; profile/nền tảng ngoài danh sách bị đưa về mặc định", () => {
    expect(sanitizeApp({ install: "alice@neu.edu.vn", version: "0.1.0", platform: "web", profile: "code", model: "m" })).toBeNull();
    expect(sanitizeApp({ install: INSTALL, version: "../../etc", platform: "web", profile: "code", model: "m" })).toBeNull();
    const a = sanitizeApp({ install: INSTALL, version: "0.1.0", build: "zzzz", platform: SECRETS[0], profile: SECRETS[1], model: SECRETS[2], extra: SECRETS[3] })!;
    expect(a).toEqual({ install: INSTALL, version: "0.1.0", platform: "other", profile: "code", model: "other" });
  });

  it("fuzz: không chuỗi bí mật nào lọt vào gói dù nhét vào mọi trường của mọi sự kiện", async () => {
    const { r, net, clock } = mkRecorder({ context: () => ({ profile: SECRETS[1], model: SECRETS[2], install: INSTALL }) });
    for (const s of SECRETS) {
      turn(r, clock, [
        { type: "text", delta: s, ...base },
        { type: "reasoning", delta: s, ...base },
        { type: "tool_start", id: s, name: s, summary: s, args: { path: s, command: s, url: s, [s]: s }, ...base },
        { type: "tool_result", id: s, name: s, ok: false, output: s, ...base },
        { type: "permission", request: { id: s, kind: "tool", tool: s, summary: s, args: { p: s }, note: s, plan: s, depth: 0 } },
        { type: "permission_resolved", id: s, allowed: false },
        { type: "notice", level: "error", text: "Lỗi " + s },
        msgEnd(s),
        { type: "files_changed", paths: [s] },
        { type: "proc", id: s, command: s, state: "data", text: s },
        { type: "usage", promptTokens: 10, completionTokens: 5, contextPct: 90, calls: 1 },
      ]);
      r.onError(new LlmError("Lỗi 500: " + s, 500, "server"));
      r.onError(new Error("boom " + s));
    }
    r.prepareReport("ghi chú an toàn");
    const ps = await payloads(r, net);
    expect(ps.length).toBeGreaterThan(0);
    const raw = net.sent.map((s) => s.body).join("\n");
    for (const s of SECRETS) {
      expect(raw).not.toContain(s);
      expect(raw).not.toContain(s.slice(0, 12));
    }
    expect(raw).not.toMatch(/@|\/Users|https?:|\\\\/);
    // mọi khoá xuất hiện phải nằm trong lược đồ
    const allowedKeys = new Set(["t", "ts", ...Object.values(DIAG_SCHEMA.events).flatMap((e) => Object.keys(e))]);
    for (const e of allEvents(ps)) for (const k of Object.keys(e)) expect(allowedKeys.has(k)).toBe(true);
    expect(Object.keys(ps[0]).sort()).toEqual(["app", "events", "sent", "v"].concat(ps[0].dropped ? ["dropped"] : []).sort());
    expect(Object.keys(ps[0].app).sort()).toEqual(["install", "model", "platform", "profile", "version"]);
  });

  it("fuzz ngẫu nhiên: sanitizeEvent không bao giờ cho ra giá trị chuỗi ngoài danh sách cho phép", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const types = Object.keys(DIAG_SCHEMA.events).concat(["x", "__proto__", "toString"]);
    const vals: unknown[] = [...SECRETS, 1, -5, 1e99, NaN, true, null, undefined, [], {}, "bash", "ok", "loop"];
    const known = new Set<string>(["tool", "dur", "end", "kind", "code", "name", "t"]);
    for (let i = 0; i < 2000; i++) {
      const o: Record<string, unknown> = { t: pick(types), ts: T0 / 1000 };
      for (let k = 0; k < 6; k++) o[pick(["name", "ok", "dur", "end", "kind", "code", "tool", "note", "status", "n", "path", "text", ...SECRETS])] = pick(vals);
      const e = sanitizeEvent(o);
      if (!e) continue;
      const js = JSON.stringify(e);
      for (const s of SECRETS) if (e.t !== "report") expect(js).not.toContain(s);
      for (const [k, v] of Object.entries(e)) if (typeof v === "string" && k !== "note") expect(known.has(k) || k === "t").toBe(true);
    }
  });

  it("buildPayload và chunkEvents giữ gói trong giới hạn của bộ thu", () => {
    const evs = Array.from({ length: 500 }, (_, i) => ({ t: "turn", ts: T0 / 1000 + i, end: "ok", dur_s: i, steps: 1, tools: 1, tool_fail: 0, prompt_tok: 123456, completion_tok: 1234, ctx_pct: 10, compactions: 0, perm_allow: 0, perm_deny: 0, ttft_ms: 900 }));
    const p = buildPayload({ install: INSTALL, version: "0.1.0", platform: "web", profile: "work", model: "m" }, evs)!;
    expect(p.events.length).toBe(DIAG_SCHEMA.limits.maxEvents);
    for (const c of chunkEvents(p.events)) {
      const body = JSON.stringify(buildPayload({ install: INSTALL, version: "0.1.0", platform: "web", profile: "work", model: "m" }, c));
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(DIAG_SCHEMA.limits.maxBodyBytes);
      expect(c.length).toBeLessThanOrEqual(80);
    }
  });

  it("lược đồ TS trùng với deploy/220/diag/schema.json (bộ thu dùng chung tệp này)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const json = JSON.parse(readFileSync(join(here, "../../../deploy/220/diag/schema.json"), "utf8"));
    expect(json).toEqual(JSON.parse(JSON.stringify(DIAG_SCHEMA)));
  });
});

describe("diagnostics: phát hiện vấn đề", () => {
  it("vòng lặp: cùng công cụ + cùng tham số ≥3 lần liên tiếp", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [...toolPair("1", "list_dir", true, { p: "a" }), ...toolPair("2", "list_dir", true, { p: "a" }), ...toolPair("3", "list_dir", true, { p: "a" }), msgEnd("x")]);
    const ev = allEvents(await payloads(r, net));
    expect(ev.filter((e) => e.t === "signal" && e.code === "loop")).toEqual([expect.objectContaining({ tool: "list_dir", n: 3 })]);
    expect(ev.filter((e) => e.t === "tool")).toHaveLength(3);
  });

  it("tham số khác nhau thì không phải vòng lặp", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [...toolPair("1", "list_dir", true, { p: "a" }), ...toolPair("2", "list_dir", true, { p: "b" }), ...toolPair("3", "list_dir", true, { p: "a" })]);
    expect(sigCodes(await payloads(r, net))).not.toContain("loop");
  });

  it("công cụ thất bại lặp lại ≥3 lần trong lượt; báo cả tên công cụ", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [...toolPair("1", "bash", false, { c: 1 }), ...toolPair("2", "bash", false, { c: 2 }), ...toolPair("3", "bash", false, { c: 3 }), ...toolPair("4", "read_file", false)]);
    const ev = allEvents(await payloads(r, net));
    expect(ev.filter((e) => e.code === "repeat_tool_fail")).toEqual([expect.objectContaining({ tool: "bash", n: 3 })]);
    const t = ev.find((e) => e.t === "turn");
    expect(t).toMatchObject({ tools: 4, tool_fail: 4, end: "ok" });
  });

  it("chạm giới hạn bước, vòng lặp do phiên chặn, tràn ngữ cảnh, câu trả lời bị cắt", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [msgEnd("a"), { type: "notice", level: "warn", text: 'Đã đạt giới hạn 40 bước. Gõ "tiếp tục" nếu muốn làm tiếp.' }]);
    turn(r, clock, [{ type: "notice", level: "warn", text: "Agent lặp lại cùng một thao tác 5 lần nên đã dừng." }, msgEnd("a")]);
    turn(r, clock, [{ type: "notice", level: "warn", text: "Ngữ cảnh đầy, đang rút gọn rồi thử lại…" }, { type: "notice", level: "info", text: "Đang tóm tắt hội thoại để giải phóng ngữ cảnh…" }, { type: "notice", level: "warn", text: "Câu trả lời bị cắt do hết độ dài tối đa." }, msgEnd("a")]);
    const ev = allEvents(await payloads(r, net));
    expect(sigCodes([{ events: ev }])).toEqual(expect.arrayContaining(["step_limit", "loop", "context_overflow", "truncated"]));
    const turns = ev.filter((e) => e.t === "turn");
    expect(turns.map((t) => t.end)).toEqual(["step_limit", "loop", "ok"]);
    expect(turns[2].compactions).toBe(1);
  });

  it("chậm: token đầu tiên > 20s và cả lượt > 300s", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [25_000, { type: "text", delta: "x", ...base }, 400_000, msgEnd("x")]);
    const ev = allEvents(await payloads(r, net));
    expect(sigCodes([{ events: ev }])).toEqual(expect.arrayContaining(["slow_first_token", "slow_turn"]));
    expect(ev.find((e) => e.t === "turn")).toMatchObject({ ttft_ms: 25_000, dur_s: 425 });
  });

  it("lượt nhanh không có tín hiệu chậm; ngữ cảnh >85% được báo; token được tính theo lượt", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [{ type: "usage", promptTokens: 1000, completionTokens: 100, contextPct: 50, calls: 1 }, 2000, { type: "text", delta: "x", ...base }, msgEnd("x")]);
    turn(r, clock, [{ type: "usage", promptTokens: 3000, completionTokens: 250, contextPct: 88, calls: 2 }, msgEnd("x")]);
    const ev = allEvents(await payloads(r, net));
    expect(sigCodes([{ events: ev }])).toEqual(["ctx_high"]);
    const ts = ev.filter((e) => e.t === "turn");
    expect(ts[0]).toMatchObject({ prompt_tok: 1000, completion_tok: 100 });
    expect(ts[1]).toMatchObject({ prompt_tok: 2000, completion_tok: 150, ctx_pct: 88 });
  });

  it("bấm Dừng ngay sau khi bắt đầu => early_interrupt; Dừng muộn thì không; quyền bị ngắt không tính là từ chối", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [1000], true);
    turn(r, clock, [60_000, msgEnd("x")], true);
    r.onEvent({ type: "turn_start" });
    r.onEvent({ type: "permission", request: { id: "p1", kind: "tool", tool: "bash", summary: "", args: {}, depth: 0 } });
    r.onInterrupt();
    r.onEvent({ type: "permission_resolved", id: "p1", allowed: false });
    r.onEvent({ type: "turn_end", interrupted: true, final: "" });
    const ev = allEvents(await payloads(r, net));
    expect(ev.filter((e) => e.code === "early_interrupt")).toHaveLength(2); // lượt 1 (1s) và lượt 3 (0s)
    expect(ev.filter((e) => e.t === "turn").map((e) => e.perm_deny)).toEqual([0, 0, 0]);
  });

  it("từ chối quyền lặp lại, đầu ra rỗng, tham số không hợp lệ, công cụ không tồn tại", async () => {
    const { r, net, clock } = mkRecorder();
    const perm = (id: string, tool: string, allowed: boolean): SessionEvent[] => [{ type: "permission", request: { id, kind: "tool", tool, summary: "", args: {}, depth: 0 } }, { type: "permission_resolved", id, allowed }];
    turn(r, clock, [...perm("a", "write_file", false), ...perm("b", "write_file", false), ...perm("c", "bash", false), ...perm("d", "bash", true), msgEnd("")]);
    turn(r, clock, [{ type: "tool_start", id: "z", name: "write_file", summary: "tham số không hợp lệ", args: {}, ...base }, { type: "tool_result", id: "z", name: "write_file", ok: false, output: "Lỗi: tham số không phải JSON hợp lệ", ...base }, ...toolPair("q", "nope", false).slice(0, 1), { type: "tool_result", id: "q", name: "nope", ok: false, output: "Lỗi: không có công cụ 'nope'. Công cụ hiện có: x", ...base }, msgEnd("ok")]);
    const ev = allEvents(await payloads(r, net));
    const codes = sigCodes([{ events: ev }]);
    expect(codes).toEqual(expect.arrayContaining(["perm_denied", "empty_output", "invalid_tool_args", "unknown_tool"]));
    expect(ev.filter((e) => e.t === "turn")[0]).toMatchObject({ perm_allow: 1, perm_deny: 3 });
    expect(ev.filter((e) => e.t === "tool").map((e) => e.name)).toContain("other"); // "nope" -> other
  });

  it("câu trả lời cuối rỗng sau khi gọi công cụ không bị coi là rỗng nếu có câu trả lời sau đó", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [msgEnd(""), ...toolPair("1", "read_file", true), msgEnd("xong")]);
    expect(sigCodes(await payloads(r, net))).toEqual([]);
  });

  it("lỗi LLM: chỉ loại + mã HTTP; bỏ qua abort; thử lại được đếm", async () => {
    const { r, net, clock } = mkRecorder();
    r.onEvent({ type: "turn_start" });
    r.onEvent({ type: "notice", level: "warn", text: "Chạm giới hạn lệnh/phút, thử lại sau 5s…" });
    r.onEvent({ type: "notice", level: "warn", text: "Mô hình đang khởi động hoặc quá tải. Thử lại sau 5s (lần 1)…" });
    r.onEvent({ type: "notice", level: "warn", text: "Mất kết nối (fetch failed). Thử lại sau 3s…" });
    r.onError(new LlmError("Key sai " + SECRETS[0], 401, "auth"));
    r.onError(new LlmError("Đã dừng.", 0, "abort"));
    r.onError(new Error("boom"));
    clock.t += 1000;
    r.onEvent({ type: "turn_end", interrupted: false, final: "" });
    const ev = allEvents(await payloads(r, net));
    expect(ev.filter((e) => e.t === "llm_error")).toEqual([expect.objectContaining({ kind: "auth", status: 401 }), expect.objectContaining({ kind: "unexpected", status: 0 })]);
    expect(ev.filter((e) => e.t === "llm_retry").map((e) => e.kind)).toEqual(["rate", "server", "network"]);
    expect(ev.find((e) => e.t === "turn")).toMatchObject({ end: "error" });
  });

  it("lệnh gạch chéo (không có bước nào) không tạo sự kiện lượt", async () => {
    const { r } = mkRecorder();
    turn(r, { t: T0 }, []);
    expect(r.pending).toBe(0);
  });
});

describe("diagnostics: gửi theo lô, lùi dần, không bao giờ ném lỗi", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fill = (r: DiagnosticsRecorder, clock: { t: number }, n: number) => {
    for (let i = 0; i < n; i++) turn(r, clock, [msgEnd("x"), ...toolPair("t" + i, "bash", true)]);
  };

  it("thành công: gửi theo lô nhỏ, xoá bộ đệm, kèm tiêu đề do máy chủ chủ nhà cấp, không có danh tính", async () => {
    const { r, net, clock } = mkRecorder({ headers: () => ({ Authorization: "Bearer t" }) });
    fill(r, clock, 60); // 120 sự kiện
    for (let i = 0; i < 5 && r.pending; i++) await r.flush();
    expect(r.pending).toBe(0);
    expect(net.sent.length).toBeGreaterThan(1);
    for (const s of net.sent) {
      expect(new TextEncoder().encode(s.body).length).toBeLessThanOrEqual(16384);
      expect(JSON.parse(s.body).events.length).toBeLessThanOrEqual(80);
      expect(s.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer t" });
      expect(s.body).not.toMatch(/email|user/i);
    }
  });

  it("lỗi mạng: lùi dần (không gửi lại ngay), thử lại sau khi hết thời gian chờ, giữ nguyên sự kiện", async () => {
    let fail = true;
    const net = fakeFetch(() => (fail ? new Error("offline") : 200));
    const { r, clock } = mkRecorder({ fetch: net.f });
    fill(r, clock, 2);
    await r.flush();
    expect(net.mock).toHaveBeenCalledTimes(1);
    expect(r.pending).toBe(4);
    await r.flush(); // còn trong thời gian lùi dần
    expect(net.mock).toHaveBeenCalledTimes(1);
    clock.t += 31 * 60_000; // quá thời gian lùi tối đa
    await r.flush();
    expect(net.mock).toHaveBeenCalledTimes(2);
    clock.t += 31 * 60_000;
    fail = false;
    await r.flush();
    expect(net.mock).toHaveBeenCalledTimes(3);
    expect(r.pending).toBe(0);
  });

  it("429 theo Retry-After; 5xx/401 lùi dần; 400 thì bỏ lô (không gửi lại mãi)", async () => {
    let st = 429;
    const net = fakeFetch(() => st);
    const { r, clock } = mkRecorder({ fetch: net.f });
    fill(r, clock, 1);
    await r.flush();
    expect(r.pending).toBe(2);
    clock.t += 6000;
    await r.flush();
    expect(net.mock).toHaveBeenCalledTimes(1); // Retry-After: 7s chưa hết
    clock.t += 2000;
    st = 400;
    await r.flush();
    expect(net.mock).toHaveBeenCalledTimes(2);
    expect(r.pending).toBe(0);
  });

  it("không bao giờ ném lỗi: fetch ném đồng bộ, headers/enabled/context ném, đầu vào rác", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const a = mkRecorder({ fetch: boom as unknown as typeof fetch });
    fill(a.r, a.clock, 1);
    await expect(a.r.flush()).resolves.toBeUndefined();
    const b = mkRecorder({ headers: boom });
    fill(b.r, b.clock, 1);
    await expect(b.r.flush()).resolves.toBeUndefined();
    const c = mkRecorder({ enabled: boom });
    expect(() => turn(c.r, c.clock, [msgEnd("x")])).not.toThrow();
    const d = mkRecorder({ context: boom });
    fill(d.r, d.clock, 1);
    await expect(d.r.flush()).resolves.toBeUndefined();
    expect(() => d.r.onEvent(null as unknown as SessionEvent)).not.toThrow();
    expect(() => d.r.onEvent({ type: "tool_result", id: 1, name: {}, ok: 1, output: null } as unknown as SessionEvent)).not.toThrow();
    expect(() => d.r.onError(undefined)).not.toThrow();
    expect(d.r.prepareReport("x")).toBeNull(); // context hỏng
  });

  it("bộ đệm có giới hạn: bỏ sự kiện cũ nhất và đếm 'dropped'", async () => {
    const { r, net, clock } = mkRecorder({ maxBuffer: 10 });
    fill(r, clock, 20);
    expect(r.pending).toBe(10);
    const ps = await payloads(r, net);
    expect(ps[0].dropped).toBeGreaterThanOrEqual(30);
  });

  it("tắt (người dùng/chính sách): không ghi, không gửi, xoá bộ đệm", async () => {
    let on = true;
    const { r, net, clock } = mkRecorder({ enabled: () => on });
    fill(r, clock, 2);
    expect(r.pending).toBe(4);
    on = false;
    fill(r, clock, 2);
    expect(r.pending).toBe(0);
    await r.flush();
    expect(net.mock).not.toHaveBeenCalled();
    const forb = mkRecorder({ forbidden: () => true });
    fill(forb.r, forb.clock, 2);
    expect(forb.r.pending).toBe(0);
    expect(forb.r.prepareReport("x")).toBeNull();
  });

  it("tự gửi sau khi hết lượt (bộ hẹn giờ), không giữ tiến trình sống", async () => {
    const { r, net, clock } = mkRecorder({ flushDelayMs: 5000 });
    turn(r, clock, [msgEnd("x")]);
    expect(net.mock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5100);
    expect(net.mock).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it("không theo chuyển hướng (đăng nhập SSO hết hạn không được làm gói đi nơi khác)", async () => {
    const { r, net, clock } = mkRecorder();
    fill(r, clock, 1);
    await r.flush();
    const init = (net.mock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });
});

describe("diagnostics: Báo lỗi (xem trước đúng gói rồi gửi chính gói đó)", () => {
  it("gói xem trước = gói gửi; ghi chú ngắn của người dùng nằm trong sự kiện 'report'; chỉ gửi một lần", async () => {
    const { r, net, clock } = mkRecorder();
    turn(r, clock, [msgEnd("x"), ...toolPair("1", "bash", false)]);
    const preview = r.prepareReport("  Agent bị treo\nkhi mở file  ")!;
    turn(r, clock, [msgEnd("sự kiện đến sau khi xem trước")]); // không được lọt vào gói đã xem
    const res = await r.sendPrepared();
    expect(res.ok).toBe(true);
    expect(JSON.parse(net.sent[0].body)).toEqual(JSON.parse(preview));
    expect(JSON.parse(preview).events.at(-1)).toMatchObject({ t: "report", note: "Agent bị treo khi mở file" });
    expect((await r.sendPrepared()).ok).toBe(false);
    expect(net.mock).toHaveBeenCalledTimes(1);
  });

  it("gửi thất bại => ok:false, không ném lỗi; vẫn gửi được khi người dùng tắt tự động nhưng chính sách không cấm", async () => {
    const net = fakeFetch(500);
    const { r } = mkRecorder({ fetch: net.f, enabled: () => false });
    expect(r.prepareReport("x")).not.toBeNull();
    expect(await r.sendPrepared()).toEqual({ ok: false });
  });

  it("gói báo lỗi luôn vừa 16 KB", async () => {
    const { r, clock } = mkRecorder({ maxBuffer: 500 });
    for (let i = 0; i < 150; i++) turn(r, clock, [msgEnd("x"), ...toolPair("t" + i, "bash", true)]);
    const p = r.prepareReport("é".repeat(500))!;
    expect(new TextEncoder().encode(JSON.stringify(JSON.parse(p))).length).toBeLessThan(16384);
  });
});

// ---------------------------------------------------------------- tích hợp với controller + phiên thật
async function makeDiag(script: ConstructorParameters<typeof FakeLlm>[0] | LlmClient, o: { policy?: Policy; settings?: Partial<Settings>; diagnostics?: boolean; status?: number; allow?: boolean } = {}) {
  const env = new MemoryEnv("/ws", SEED);
  const net = fakeFetch(o.status ?? 200);
  let saved: Partial<Settings> = { ...o.settings };
  const c = await LocalController.create({
    env,
    realFs: false,
    policy: o.policy,
    store: { load: async () => saved, save: async (s) => void (saved = { ...s }) },
    trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    diagnostics: o.diagnostics === false ? undefined : { endpoint: "/agent/diag", version: "0.1.0", platform: "web", fetch: net.f },
  });
  const llm = Array.isArray(script) || typeof script === "function" ? new FakeLlm(script as Step[]) : script;
  (c.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
  c.onEvent((e) => e.type === "permission" && c.respondPermission(e.request.id, { allow: o.allow !== false }));
  const flush = async () => {
    await (c as unknown as { diag?: DiagnosticsRecorder }).diag?.flush();
    return net.sent.map((s) => JSON.parse(s.body));
  };
  return { c, net, flush, saved: () => saved };
}

describe("diagnostics: tích hợp LocalController (phiên thật, mô hình giả)", () => {
  it("lượt bình thường: sự kiện lượt + công cụ, không có nội dung nào của người dùng/tệp/lệnh", async () => {
    const { c, flush } = await makeDiag([{ calls: [{ name: "read_file", args: { path: "hello.py" } }] }, { text: "Đây là câu trả lời bí mật 12345" }]);
    await c.send("đọc file lương của alice@neu.edu.vn giúp tôi");
    const ps = await flush();
    const raw = JSON.stringify(ps);
    expect(raw).not.toMatch(/alice|lương|bí mật|hello\.py|12345/);
    const ev = allEvents(ps);
    expect(ev.map((e) => e.t)).toEqual(["tool", "turn"]);
    expect(ev[0]).toMatchObject({ name: "read_file", ok: true });
    expect(ev[1]).toMatchObject({ end: "ok", steps: 2, tools: 1, tool_fail: 0, prompt_tok: 200, completion_tok: 40 });
    expect(ps[0].app).toMatchObject({ version: "0.1.0", platform: "web", profile: "code" });
    expect(ps[0].app.install).toMatch(/^[0-9a-f]{32}$/);
  });

  it("mã cài đặt ngẫu nhiên được lưu lại và dùng lại; UI không ghi đè được", async () => {
    const { c, flush, saved } = await makeDiag([{ text: "a" }]);
    await c.send("x");
    const ps = await flush();
    await new Promise((r) => setTimeout(r, 5));
    expect(saved().diagId).toBe(ps[0].app.install);
    await c.saveSettings({ diagId: "ffffffffffffffffffffffffffffffff" } as Partial<Settings>);
    expect(saved().diagId).toBe(ps[0].app.install);
    expect(JSON.stringify(await c.getState())).not.toContain(ps[0].app.install);
  });

  it("giới hạn bước (phiên thật) => step_limit; lặp vô ích (phiên thật) => loop; công cụ bịa + tham số hỏng", async () => {
    const a = await makeDiag(() => ({ calls: [{ name: "list_dir", args: { n: Math.random() } }] }), { settings: { maxSteps: 3 } });
    await a.c.send("lặp");
    const ea = allEvents(await a.flush());
    expect(ea.find((e) => e.t === "turn")).toMatchObject({ end: "step_limit", steps: 3 });
    expect(ea.some((e) => e.code === "step_limit")).toBe(true);

    const b = await makeDiag(() => ({ calls: [{ name: "list_dir", args: {} }] }));
    await b.c.send("lặp");
    const eb = allEvents(await b.flush());
    expect(eb.find((e) => e.t === "turn")).toMatchObject({ end: "loop" });
    expect(eb.filter((e) => e.code === "loop")).toHaveLength(1);

    const c = await makeDiag([{ calls: [{ name: "sk-LIVE-SECRET-12345", args: {} }] }, { text: "ok" }]);
    await c.c.send("x");
    const pc = await c.flush();
    expect(JSON.stringify(pc)).not.toContain("sk-LIVE");
    expect(sigCodes(pc)).toContain("unknown_tool");
  });

  it("lỗi LLM thật: chỉ loại + mã HTTP, không có thông điệp lỗi", async () => {
    const llm = {
      models: async () => [],
      chat: async () => {
        throw new LlmError("Lỗi 429: token sk-LIVE-SECRET-12345 vượt hạn mức", 429, "rate");
      },
    } as unknown as LlmClient;
    const { c, flush } = await makeDiag(llm);
    await c.send("x");
    const ps = await flush();
    expect(JSON.stringify(ps)).not.toContain("sk-LIVE");
    expect(allEvents(ps).find((e) => e.t === "llm_error")).toMatchObject({ kind: "rate", status: 429 });
    expect(allEvents(ps).find((e) => e.t === "turn")).toMatchObject({ end: "error" });
  });

  it("từ chối quyền thật + Dừng thật", async () => {
    const { c, flush } = await makeDiag([{ calls: [{ name: "write_file", args: { path: "a.txt", content: "1" } }, { name: "write_file", args: { path: "b.txt", content: "1" } }] }, { text: "ok" }], { allow: false });
    await c.send("x");
    const ev = allEvents(await flush());
    expect(ev.find((e) => e.t === "turn")).toMatchObject({ perm_deny: 2 });
    expect(ev.some((e) => e.code === "perm_denied" && e.tool === "write_file")).toBe(true);
  });

  it("chính sách diagnostics:false => không gửi gì, không cho xem trước/gửi báo lỗi", async () => {
    expect(parsePolicy({ diagnostics: false })).toEqual({ diagnostics: false });
    expect(parsePolicy({ diagnostics: "no" })).toEqual({});
    const { c, net, flush } = await makeDiag([{ text: "a" }], { policy: { diagnostics: false } });
    await c.send("x");
    await flush();
    expect(net.mock).not.toHaveBeenCalled();
    expect(await c.diagnosticsStatus()).toEqual({ available: true, enabled: false, lockedByPolicy: true });
    expect(await c.diagnosticsPreview("x")).toBeNull();
    expect(await c.diagnosticsSend()).toEqual({ ok: false });
  });

  it("công tắc của người dùng (Settings.diagnostics=false) và tắt giữa chừng", async () => {
    const off = await makeDiag([{ text: "a" }], { settings: { diagnostics: false } });
    await off.c.send("x");
    await off.flush();
    expect(off.net.mock).not.toHaveBeenCalled();
    expect((await off.c.diagnosticsStatus()).enabled).toBe(false);

    const on = await makeDiag([{ text: "a" }, { text: "b" }]);
    expect(await on.c.diagnosticsStatus()).toEqual({ available: true, enabled: true, lockedByPolicy: false });
    await on.c.send("1");
    await on.c.saveSettings({ diagnostics: false });
    await on.c.send("2");
    expect(allEvents(await on.flush())).toHaveLength(0); // bộ đệm bị xoá khi tắt
  });

  it("không cấu hình diagnostics => không có gì xảy ra; Báo lỗi trả về null", async () => {
    const { c, net } = await makeDiag([{ text: "a" }], { diagnostics: false });
    await c.send("x");
    expect(net.mock).not.toHaveBeenCalled();
    expect(await c.diagnosticsStatus()).toMatchObject({ available: false, enabled: false });
    expect(await c.diagnosticsPreview("x")).toBeNull();
  });

  it("Báo lỗi qua controller: xem trước JSON rồi gửi đúng gói đó", async () => {
    const { c, net } = await makeDiag([{ text: "a" }]);
    await c.send("x");
    const preview = (await c.diagnosticsPreview("Nút Dừng không phản hồi"))!;
    expect(JSON.parse(preview).events.at(-1)).toMatchObject({ t: "report", note: "Nút Dừng không phản hồi" });
    expect(await c.diagnosticsSend()).toEqual({ ok: true });
    expect(JSON.parse(net.sent[0].body)).toEqual(JSON.parse(preview));
  });

  it("chẩn đoán không làm chậm/hỏng agent khi máy chủ thu lỗi", async () => {
    const { c, flush } = await makeDiag([{ text: "a" }], { status: 503 });
    await expect(c.send("x")).resolves.toBeUndefined();
    await expect(flush()).resolves.toBeDefined();
    expect((await c.getState()).busy).toBe(false);
  });
});

// ---------------------------------------------------------------- cập nhật
describe("checkForUpdate / compareVersions", () => {
  const sha = "a".repeat(64);
  const resp = (body: unknown, init: ResponseInit = {}) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init })) as unknown as typeof fetch;
  const latest = { version: "0.2.0", released: "2026-10-08", notes: "Sửa lỗi", files: { "NEU-Agent-0.2.0-win-x64.exe": { sha256: sha, size: 10 }, "NEU-Agent-0.2.0-mac-arm64.dmg": { sha256: sha }, "../evil": { sha256: sha }, "bad.dmg": { sha256: "xyz" } } };

  it("so sánh phiên bản", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("abc", "1.0.0")).toBeNull();
  });
  it("có bản mới: lọc theo nền tảng, bỏ tệp tên lạ/mã băm sai", async () => {
    const r = (await checkForUpdate("0.1.0", resp(latest), { platform: "win" }))!;
    expect(r).toMatchObject({ available: true, latest: "0.2.0", current: "0.1.0", notes: "Sửa lỗi", released: "2026-10-08" });
    expect(r.files).toEqual([{ name: "NEU-Agent-0.2.0-win-x64.exe", sha256: sha, size: 10 }]);
    expect((await checkForUpdate("0.1.0", resp(latest)))!.files.map((f) => f.name)).toEqual(["NEU-Agent-0.2.0-win-x64.exe", "NEU-Agent-0.2.0-mac-arm64.dmg"]);
  });
  it("đã mới nhất / bản đang chạy mới hơn", async () => {
    expect((await checkForUpdate("0.2.0", resp(latest)))!.available).toBe(false);
    expect((await checkForUpdate("0.3.0", resp(latest)))!.available).toBe(false);
  });
  it("mọi lỗi => null, không ném: mạng, 401, HTML đăng nhập, JSON hỏng, phiên bản lạ", async () => {
    expect(await checkForUpdate("0.1.0", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await checkForUpdate("0.1.0", resp({}, { status: 401 }))).toBeNull();
    expect(await checkForUpdate("0.1.0", resp("<html>", { headers: { "content-type": "text/html" } }))).toBeNull();
    expect(await checkForUpdate("0.1.0", resp("{nope"))).toBeNull();
    expect(await checkForUpdate("0.1.0", resp({ version: "../../x" }))).toBeNull();
    expect(await checkForUpdate("x", resp(latest))).toBeNull();
  });
  it("không theo chuyển hướng và dùng tiêu đề đăng nhập do bên gọi cấp", async () => {
    const f = vi.fn(resp(latest));
    await checkForUpdate("0.1.0", f as unknown as typeof fetch, { headers: { Authorization: "Bearer t" }, url: "https://x.test/latest.json" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/latest.json");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ Authorization: "Bearer t" });
  });
});
