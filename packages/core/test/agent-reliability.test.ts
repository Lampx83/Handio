import { describe, expect, it } from "vitest";
import { MemoryEnv, DiagnosticsRecorder, LlmError, type SessionEvent } from "../src";
import { makeController, type Step } from "./helpers";

const results = (events: any[]) => events.filter((e) => e.type === "tool_result") as { name: string; ok: boolean; output: string; errKind?: string }[];
const notices = (events: any[]) => events.filter((e) => e.type === "notice").map((e) => e.text as string);

describe("B-01: lỗi công cụ có mã loại và gợi ý để agent tự sửa", () => {
  it("read_file sai thư mục: gợi ý đường dẫn đúng, mã not_found", async () => {
    const { c, events } = await makeController([{ calls: [{ name: "read_file", args: { path: "util.py" } }] }, { text: "ok" }], { seed: { "src/util.py": "x = 1\n", "README.md": "#\n" } });
    await c.send("đọc");
    const r = results(events)[0];
    expect(r).toMatchObject({ ok: false, errKind: "not_found" });
    expect(r.output).toContain("Có phải ý bạn là: src/util.py");
  });

  it("gõ sai tên gần giống: gợi ý tên đúng cùng thư mục; không tìm thấy gì thì liệt kê thư mục gốc", async () => {
    const { c, events } = await makeController([{ calls: [{ name: "read_file", args: { path: "src/utill.py" } }] }, { calls: [{ name: "read_file", args: { path: "zzz/khong-co.txt" } }] }, { text: "ok" }], { seed: { "src/util.py": "x\n", "README.md": "#\n" } });
    await c.send("đọc");
    const [a, b] = results(events);
    expect(a.output).toContain("src/util.py");
    expect(b.output).toContain("Thư mục dự án có:");
    expect(b.output).toContain("README.md");
  });

  it("list_dir trên file và read_file trên thư mục: wrong_type kèm hướng dẫn", async () => {
    const { c, events } = await makeController([{ calls: [{ name: "list_dir", args: { path: "README.md" } }] }, { calls: [{ name: "read_file", args: { path: "src" } }] }, { text: "ok" }], { seed: { "src/util.py": "x\n", "README.md": "#\n" } });
    await c.send("x");
    const [a, b] = results(events);
    expect(a).toMatchObject({ errKind: "wrong_type" });
    expect(a.output).toContain("read_file");
    expect(b).toMatchObject({ errKind: "wrong_type" });
    expect(b.output).toContain("list_dir");
  });

  it("sửa trước khi đọc → read_first; old_string sai → no_match; ngoài dự án → outside_project kèm cách sửa", async () => {
    const { c, events } = await makeController(
      [{ calls: [{ name: "edit_file", args: { path: "a.txt", old_string: "x", new_string: "y" } }] }, { calls: [{ name: "read_file", args: { path: "a.txt" } }] }, { calls: [{ name: "edit_file", args: { path: "a.txt", old_string: "KHÔNG CÓ", new_string: "y" } }] }, { calls: [{ name: "read_file", args: { path: "../ngoai.txt" } }] }, { text: "ok" }],
      { seed: { "a.txt": "hello\n" }, settings: { permissionMode: "auto" } as any },
    );
    c.onEvent((e) => e.type === "permission" && c.respondPermission(e.request.id, { allow: true }));
    await c.send("x");
    const kinds = results(events).map((r) => r.errKind ?? "ok");
    expect(kinds).toEqual(["read_first", "ok", "no_match", "outside_project"]);
    expect(results(events)[3].output).toContain("đường dẫn tương đối");
  });

  it("run_javascript: chương trình/test hỏng là 'program'; dùng nhầm fs/mạng là 'sandbox' kèm gợi ý", async () => {
    const env = new MemoryEnv("/ws", { "a.js": "1" });
    let n = 0;
    (env as any).runJs = async () => (n++ === 0 ? { ok: false, logs: ["FAIL"], error: "AssertionError: expected 1 to be 2" } : { ok: false, logs: [], error: "Error: Cannot find module 'fs'" });
    const { c, events } = await makeController([{ calls: [{ name: "run_javascript", args: { code: "a" } }] }, { calls: [{ name: "run_javascript", args: { code: "b" } }] }, { text: "ok" }], { env });
    c.onEvent((e) => e.type === "permission" && c.respondPermission(e.request.id, { allow: true }));
    await c.send("x");
    const [a, b] = results(events);
    expect(a).toMatchObject({ ok: false, errKind: "program" });
    expect(b).toMatchObject({ ok: false, errKind: "sandbox" });
    expect(b.output).toContain("files['");
  });
});

describe("B-02: chống lặp và hết bước", () => {
  it("cùng công cụ lỗi liên tiếp cùng lý do (tham số khác nhau): cảnh báo ở lần 3 và dừng ở lần 5, rồi giải thích không dùng công cụ", async () => {
    let n = 0;
    const { c, events, llm } = await makeController((m, i) => (i < 8 && !String(m.at(-1)?.content).includes("bị dừng vì cứ lặp lại") ? { calls: [{ name: "read_file", args: { path: `khong-co-${n++}.txt` } }] } : { text: "Mình bị kẹt vì không tìm thấy file; bạn cho biết tên file đúng nhé." }), { seed: { "README.md": "#\n" } });
    await c.send("đọc file");
    const fails = results(events);
    expect(fails.length).toBe(5);
    const toModel = llm.calls.at(-1)!.messages.filter((m: any) => m.role === "tool").map((m: any) => String(m.content));
    expect(toModel[2]).toContain("lỗi 3 lần liên tiếp"); // lời nhắc gắn vào nội dung gửi cho mô hình
    expect(notices(events).some((t) => /lặp lại cùng một thao tác/.test(t))).toBe(true);
    const last = llm.calls.at(-1)!;
    expect(last.opts.tools ?? []).toHaveLength(0); // lượt giải thích không có công cụ
    expect(last.messages.at(-1)!.content).toContain("bị dừng vì cứ lặp lại");
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: expect.stringContaining("bạn cho biết tên file đúng") });
  });

  it("xen kẽ A,B,A,B,A,B bị phát hiện và dừng", async () => {
    const { c, events, llm } = await makeController((_m, i) => (i < 40 ? { calls: [{ name: "list_dir", args: { path: i % 2 ? "." : "src" } }] } : { text: "dừng" }), { seed: { "src/a.txt": "1", "b.txt": "2" } });
    await c.send("x");
    expect(llm.calls.at(-1)!.messages.some((m: any) => m.role === "tool" && String(m.content).includes("lặp qua lại"))).toBe(true);
    expect(results(events).length).toBeLessThan(25);
    expect(notices(events).some((t) => /lặp lại cùng một thao tác/.test(t))).toBe(true);
  });

  it("chương trình của người dùng chạy hỏng nhiều lần (kind 'program') KHÔNG bị coi là lặp vô ích", async () => {
    const env = new MemoryEnv("/ws", { "a.js": "1" });
    (env as any).runJs = async () => ({ ok: false, logs: [], error: "AssertionError: expected 1 to be 2" });
    let i = 0;
    const { c, events } = await makeController(() => (i++ < 7 ? { calls: [{ name: "run_javascript", args: { code: `t${i}` } }] } : { text: "xong" }), { env, settings: { maxSteps: 20 } as any });
    c.onEvent((e) => e.type === "permission" && c.respondPermission(e.request.id, { allow: true }));
    await c.send("chạy test");
    expect(results(events).length).toBe(7);
    expect(notices(events).some((t) => /lặp lại/.test(t))).toBe(false);
  });

  it("hết bước: nhắc sớm khi còn ít bước và có lượt tóm tắt cuối không dùng công cụ", async () => {
    let i = 0;
    const { c, events, llm } = await makeController((m) => (m.at(-1)?.role === "user" && String(m.at(-1)!.content).includes("Đã hết số bước") ? { text: "Đã đọc 11 file; còn lại: tổng hợp. Gõ tiếp tục." } : { calls: [{ name: "read_file", args: { path: "README.md", offset: ++i } }] }), { settings: { maxSteps: 12 } as any });
    await c.send("đọc nhiều");
    expect(notices(events).some((t) => /giới hạn 12 bước/.test(t))).toBe(true);
    expect(llm.calls.some((x) => x.messages.some((m) => String(m.content).includes("Chỉ còn 3 bước")))).toBe(true);
    expect(llm.calls.at(-1)!.opts.tools ?? []).toHaveLength(0);
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: expect.stringContaining("Gõ tiếp tục") });
    expect(llm.calls.length).toBe(13); // 12 bước + 1 lượt tóm tắt
  });

  it("lượt tóm tắt thất bại không làm hỏng lượt và không để lại lời nhắc dở dang", async () => {
    let i = 0;
    const { c, events, llm } = await makeController((m) => {
      if (String(m.at(-1)?.content).includes("Đã hết số bước")) throw new Error("mô hình lỗi");
      return { calls: [{ name: "read_file", args: { path: "README.md", offset: ++i } }] };
    }, { settings: { maxSteps: 10 } as any });
    await c.send("x");
    expect(events.at(-1)).toMatchObject({ type: "turn_end" });
    expect(llm.calls.length).toBeGreaterThanOrEqual(11);
  });
});

describe("chẩn đoán: mã lý do lỗi công cụ", () => {
  const T0 = 1_800_000_000_000;
  const mk = () => {
    const sent: any[] = [];
    const r = new DiagnosticsRecorder({
      endpoint: "/agent/diag", enabled: () => true, version: "0.2.0", platform: "web", context: () => ({ profile: "code", model: "m", install: "0123456789abcdef0123456789abcdef" }),
      fetch: (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response("{}"))) as unknown as typeof fetch, now: () => T0, flushDelayMs: 1_000_000,
    });
    return { r, sent };
  };
  const pair = (id: string, name: string, ok: boolean, errKind?: string, args: Record<string, unknown> = {}): SessionEvent[] => [
    { type: "tool_start", id, name, summary: "x", args, depth: 0 },
    { type: "tool_result", id, name, ok, output: "x", depth: 0, ...(errKind ? { errKind } : {}) },
  ];

  it("ghi err (chỉ mã hợp lệ); program/denied không tạo repeat_tool_fail; lỗi thật lặp thì có", async () => {
    const { r, sent } = mk();
    r.onEvent({ type: "turn_start" });
    for (let i = 0; i < 4; i++) for (const e of pair("p" + i, "run_javascript", false, "program", { code: "c" + i })) r.onEvent(e);
    for (let i = 0; i < 3; i++) for (const e of pair("n" + i, "read_file", false, "not_found", { path: "p" + i })) r.onEvent(e);
    for (const e of pair("z", "bash", false, "Không có file /Users/x/luong.xlsx")) r.onEvent(e); // chuỗi lạ: bỏ, không rò
    r.onEvent({ type: "turn_end", interrupted: false, final: "" });
    await r.flush();
    const evs = sent.flatMap((p) => p.events);
    const tools = evs.filter((e) => e.t === "tool");
    expect(tools.filter((e) => e.err === "program")).toHaveLength(4);
    expect(tools.filter((e) => e.err === "not_found")).toHaveLength(3);
    expect(JSON.stringify(sent)).not.toContain("luong.xlsx");
    expect(tools.find((e) => e.name === "bash")).not.toHaveProperty("err");
    const sig = evs.filter((e) => e.t === "signal" && e.code === "repeat_tool_fail");
    expect(sig.map((e) => e.tool)).toEqual(["read_file"]);
  });
});

describe("lỗi đăng nhập luôn kèm việc cần làm", () => {
  it("máy chủ trả 401 login_required: thông báo có action 'login' (giao diện hiện nút Đăng nhập lại)", async () => {
    const { c, events } = await makeController(() => {
      throw new LlmError("Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.", 401, "auth", "login_required");
    });
    await c.send("xin chào");
    const n = events.find((e: any) => e.type === "notice" && e.level === "error") as any;
    expect(n).toMatchObject({ action: "login" });
    expect(n.text).toContain("đăng nhập");
  });

  it("lỗi key sai (401 thường) thì không có action login", async () => {
    const { c, events } = await makeController(() => {
      throw new LlmError("Key sai hoặc chưa nhập.", 401, "auth");
    });
    await c.send("x");
    expect((events.find((e: any) => e.type === "notice" && e.level === "error") as any)).not.toHaveProperty("action");
  });

  it("friendly(): phản hồi 401 login_required của máy chủ được nhận ra", async () => {
    const { LlmClient } = await import("../src");
    const fetchFn = (async () => new Response('{"error":"login_required","message":"Cần đăng nhập"}', { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const llm = new LlmClient(() => ({ baseUrl: "https://ai.neu.edu.vn/agent/vllm/v1", model: "m", key: "" } as any), fetchFn);
    const err = await llm.chat([{ role: "user", content: "x" }], {}).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ status: 401, kind: "auth", code: "login_required" });
  });
});

describe("chẩn đoán v2: số đo token, việc dùng tính năng và phản hồi (không nội dung)", () => {
  const T0 = 1_800_000_000_000;
  const mk = () => {
    const sent: any[] = [];
    const clock = { t: T0 };
    const r = new DiagnosticsRecorder({
      endpoint: "/agent/diag", enabled: () => true, version: "0.4.0", platform: "web", context: () => ({ profile: "code", model: "m", install: "0123456789abcdef0123456789abcdef" }),
      fetch: (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response("{}"))) as unknown as typeof fetch, now: () => clock.t, flushDelayMs: 1_000_000,
    });
    return { r, sent, clock };
  };
  const usage = (p: number, c: number, calls: number, cached = 0): SessionEvent => ({ type: "usage", promptTokens: p, completionTokens: c, contextPct: 10, calls, cachedTokens: cached });

  it("lượt có số lần gọi, đỉnh lời nhắc, token đệm, kết quả công cụ, lược bớt và thời gian tới công cụ đầu tiên", async () => {
    const { r, sent, clock } = mk();
    r.onEvent({ type: "turn_start" });
    clock.t += 2000;
    r.onEvent({ type: "tool_start", id: "a", name: "read_file", summary: "x", args: { path: "p" }, depth: 0 });
    r.onEvent({ type: "tool_result", id: "a", name: "read_file", ok: true, output: "x".repeat(3000), depth: 0 });
    r.onEvent(usage(4000, 100, 1, 1000));                       // lần gọi 1: lời nhắc 4000, đệm 1000
    r.onEvent({ type: "notice", level: "info", text: "Đã lược bớt kết quả công cụ cũ để tiết kiệm ngữ cảnh." });
    r.onEvent(usage(4000 + 9000, 250, 2, 4000));                // lần gọi 2: lời nhắc 9000 (đỉnh), đệm +3000
    r.onEvent(usage(13000, 250, 2, 4000));                      // sự kiện lặp sau lượt: không tính thêm
    r.onEvent({ type: "turn_end", interrupted: false, final: "" });
    await r.flush();
    const t = sent.flatMap((p) => p.events).find((e) => e.t === "turn");
    expect(t).toMatchObject({ calls: 2, peak_prompt_tok: 9000, cached_tok: 4000, tool_out_tok: 1000, pruned: 1, first_tool_s: 2, prompt_tok: 13000, completion_tok: 250 });
  });

  it("noteUi/noteFeedback chỉ nhận mã trong danh sách; chuỗi lạ bị bỏ, không rò", async () => {
    const { r, sent } = mk();
    r.noteUi("suggestion");
    r.noteUi("/Users/mac/luong-2026.xlsx");
    r.noteUi("tab_switch ; DROP");
    r.noteFeedback("down", "slow");
    r.noteFeedback("down", "ghi chú tự do: lương của An là 20 triệu");
    r.noteFeedback("xyz");
    await r.flush();
    const evs = sent.flatMap((p) => p.events);
    expect(evs.filter((e) => e.t === "ui").map((e) => e.act)).toEqual(["suggestion"]);
    expect(evs.filter((e) => e.t === "feedback")).toMatchObject([{ v: "down", reason: "slow" }, { v: "down" }]);
    expect(JSON.stringify(sent)).not.toMatch(/luong|lương|DROP/);
    expect(evs.filter((e) => e.t === "feedback")[1]).not.toHaveProperty("reason");
  });

  it("controller.track/feedback không ném lỗi dù chưa cấu hình chẩn đoán", async () => {
    const { c } = await makeController([{ text: "x" }]);
    expect(() => c.track("suggestion")).not.toThrow();
    expect(() => c.feedback("up")).not.toThrow();
    expect(() => c.feedback("down", "không-có-trong-danh-sách")).not.toThrow();
  });
});

describe("giảm token: không gửi lại nội dung tệp đã được đọc lại", () => {
  const big = (n: string) => `${n}\n` + "dòng nội dung dài của tệp ".repeat(40);
  it("đọc lại cả một tệp thì lần đọc cũ chỉ còn một dòng; tệp khác và đọc theo đoạn không bị đụng", async () => {
    const seed = { "a.txt": big("A"), "b.txt": big("B") };
    const { c, llm } = await makeController([
      { calls: [{ name: "read_file", args: { path: "a.txt" } }] },
      { calls: [{ name: "read_file", args: { path: "b.txt" } }] },
      { calls: [{ name: "read_file", args: { path: "a.txt", offset: 2, limit: 3 } }] },   // theo đoạn: giữ nguyên
      { calls: [{ name: "read_file", args: { path: "a.txt" } }] },                         // đọc lại cả tệp: lần 1 thành dòng ngắn
      { text: "xong" },
    ], { seed });
    await c.send("đọc");
    const toolMsgs = llm.calls.at(-1)!.messages.filter((m: any) => m.role === "tool").map((m: any) => String(m.content));
    expect(toolMsgs).toHaveLength(4);
    expect(toolMsgs[0]).toContain("đã được thay bằng lần đọc mới hơn");
    expect(toolMsgs[0].length).toBeLessThan(200);
    expect(toolMsgs[1]).toContain("dòng nội dung dài");     // b.txt giữ nguyên
    expect(toolMsgs[2]).toContain("dòng nội dung dài");     // đọc đoạn giữ nguyên
    expect(toolMsgs[3]).toContain("dòng nội dung dài");     // lần đọc mới nhất đầy đủ
  });

  it("lần đọc MỘT PHẦN (có limit) không thay thế và không làm mất nội dung lần đọc cả tệp", async () => {
    const { c, llm } = await makeController([
      { calls: [{ name: "read_file", args: { path: "a.txt" } }] },
      { calls: [{ name: "read_file", args: { path: "a.txt", limit: 1 } }] },
      { text: "xong" },
    ], { seed: { "a.txt": big("A") } });
    await c.send("đọc");
    const tool = llm.calls.at(-1)!.messages.filter((m: any) => m.role === "tool").map((m: any) => String(m.content));
    expect(tool[0]).toContain("dòng nội dung dài");
  });

  it("kết quả công cụ cũ được lược bớt khi ngữ cảnh phình to, kết quả mới nhất luôn đầy đủ", async () => {
    const seed: Record<string, string> = {};
    const calls: any[] = [];
    for (let i = 0; i < 8; i++) {
      seed[`f${i}.txt`] = big(String(i)).repeat(4);
      calls.push({ calls: [{ name: "read_file", args: { path: `f${i}.txt` } }] });
    }
    calls.push({ text: "xong" });
    const { c, llm } = await makeController(calls, { seed, settings: { contextTokens: 12000 } as any });
    await c.send("đọc nhiều");
    const last = llm.calls.at(-1)!.messages.filter((m: any) => m.role === "tool").map((m: any) => String(m.content));
    expect(last.some((m: string) => m.endsWith("[đã lược để tiết kiệm ngữ cảnh]"))).toBe(true);
    expect(last.at(-1)).not.toContain("[đã lược để tiết kiệm ngữ cảnh]");   // kết quả mới nhất luôn đầy đủ
  });
});

describe("cổng tự kiểm tra: vừa tạo/sửa mà chưa kiểm chứng thì nhắc một lần trước khi báo cáo", () => {
  const withExec = (seed: Record<string, string> = {}, code = 0) => {
    const env = new MemoryEnv("/ws", seed);
    (env as any).exec = async () => ({ output: code ? "AssertionError: lỗi" : "OK", code, timedOut: false });
    return env;
  };
  const sysMsgs = (llm: any) => llm.calls.flatMap((c: any) => c.messages).filter((m: any) => m.role === "user" && String(m.content).startsWith("[Hệ thống]")).map((m: any) => String(m.content)).filter((m: string, i: number, a: string[]) => a.indexOf(m) === i);   // mỗi tin xuất hiện lại ở các lần gọi sau: lấy một lần
  const nudgeNotices = (events: any[]) => events.filter((e) => e.type === "notice" && /tự kiểm tra lại/.test(e.text)).length;

  it("Code: tạo tệp rồi báo xong mà chưa chạy → nhắc chạy thử; chạy xong thì kết thúc, không nhắc lần hai", async () => {
    const { c, events, llm } = await makeController([
      { calls: [{ name: "write_file", args: { path: "app.js", content: "console.log(1)" } }] },
      { text: "Xong rồi!" },                                                  // chưa chạy → bị nhắc
      { calls: [{ name: "bash", args: { command: "node app.js" } }] },
      { text: "Đã chạy: OK." },
    ], { env: withExec() });
    await c.send("làm app");
    expect(nudgeNotices(events)).toBe(1);
    expect(sysMsgs(llm).filter((m: string) => m.includes("CHƯA chạy thử"))).toHaveLength(1);
    expect(events.filter((e: any) => e.type === "message_end").at(-1)).toMatchObject({ text: "Đã chạy: OK." });
    expect(llm.calls).toHaveLength(4);
  });

  it("Code: lần chạy gần nhất bị lỗi → nhắc sửa và chạy lại; chỉ nhắc một lần dù mô hình vẫn báo xong", async () => {
    const { c, events, llm } = await makeController([
      { calls: [{ name: "write_file", args: { path: "a.js", content: "x" } }] },
      { calls: [{ name: "bash", args: { command: "node a.js" } }] },
      { text: "Xong." },                                                     // lần chạy lỗi → bị nhắc
      { text: "Vẫn xong." },                                                  // không nhắc lần hai
    ], { env: withExec({}, 1) });
    await c.send("x");
    expect(nudgeNotices(events)).toBe(1);
    expect(sysMsgs(llm).some((m: string) => m.includes("bị LỖI"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn_end" });
  });

  it("Code: không nhắc khi chưa sửa gì, đã chạy sau lần sửa cuối, hoặc môi trường không có công cụ chạy", async () => {
    const a = await makeController([{ text: "Chỉ trả lời." }], { env: withExec() });
    await a.c.send("giải thích");
    expect(nudgeNotices(a.events)).toBe(0);
    const b = await makeController([{ calls: [{ name: "write_file", args: { path: "a.js", content: "x" } }] }, { calls: [{ name: "bash", args: { command: "node a.js" } }] }, { text: "Xong." }], { env: withExec() });
    await b.c.send("x");
    expect(nudgeNotices(b.events)).toBe(0);
    const c = await makeController([{ calls: [{ name: "write_file", args: { path: "a.js", content: "x" } }] }, { text: "Xong." }]);   // MemoryEnv không có bash/run_javascript
    await c.c.send("x");
    expect(nudgeNotices(c.events)).toBe(0);
  });

  it("Work: tạo tệp mà chưa đọc lại → nhắc đọc lại để đối chiếu; đã đọc lại thì thôi", async () => {
    const a = await makeController([{ calls: [{ name: "write_file", args: { path: "bao-cao.md", content: "# Báo cáo" } }] }, { text: "Xong." }, { calls: [{ name: "read_file", args: { path: "bao-cao.md" } }] }, { text: "Đã kiểm tra." }], { profile: "work" });
    await a.c.send("soạn báo cáo");
    expect(nudgeNotices(a.events)).toBe(1);
    expect(sysMsgs(a.llm).some((m: string) => m.includes("ĐỌC LẠI"))).toBe(true);
    const b = await makeController([{ calls: [{ name: "write_file", args: { path: "bao-cao.md", content: "# Báo cáo" } }] }, { calls: [{ name: "read_file", args: { path: "bao-cao.md" } }] }, { text: "Xong." }], { profile: "work" });
    await b.c.send("soạn báo cáo");
    expect(nudgeNotices(b.events)).toBe(0);
  });

  it("tin nhắc là tin nội bộ: không hiện như câu hỏi của người dùng và không làm đổi tiêu đề/số lượt", async () => {
    const { isInternalUser } = await import("../src/projects");
    expect(isInternalUser("[Hệ thống] Bạn vừa tạo hoặc sửa tệp nhưng CHƯA chạy thử.")).toBe(true);
    const { c } = await makeController([{ calls: [{ name: "write_file", args: { path: "a.js", content: "x" } }] }, { text: "Xong." }, { text: "Ok." }], { env: withExec() });
    await c.send("làm app");
    const { chatTitle, countTurns } = await import("../src/projects");
    const msgs = (c.currentSession.main as any).messages;
    expect(chatTitle(msgs)).toBe("làm app");     // tiêu đề là câu của người dùng, không phải tin nhắc nội bộ
    expect(countTurns(msgs)).toBe(1);
  });
});
