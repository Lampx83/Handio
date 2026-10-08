import { describe, expect, it } from "vitest";
import { MemoryEnv, DiagnosticsRecorder, type SessionEvent } from "../src";
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
