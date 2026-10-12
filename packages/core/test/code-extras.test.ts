import { describe, expect, it } from "vitest";
import { MemoryEnv } from "../src";
import { makeController, SEED } from "./helpers";

const notices = (events: any[]) => events.filter((e) => e.type === "notice").map((e) => String(e.text));

describe("tab Code: /plan, /memory, /usage, /effort, ultrathink, dán ảnh, sửa kế hoạch", () => {
  it("kế hoạch người dùng tự sửa trước khi duyệt: agent nhận bản đã sửa", async () => {
    const { c, llm } = await makeController(
      [{ calls: [{ name: "exit_plan_mode", args: { plan: "1. làm A" } }] }, { text: "ok" }],
      { settings: { mode: "plan" }, decide: (r) => (r.kind === "plan" ? { allow: true, mode: "default", plan: "1. làm B thay vì A" } : { allow: true }) },
    );
    await c.send("x");
    const last = String(llm.calls[1].messages.at(-1)!.content);
    expect(last).toContain("tự sửa kế hoạch");
    expect(last).toContain("1. làm B thay vì A");
    expect((await c.getState()).mode).toBe("default");
  });

  it("kế hoạch duyệt nguyên văn: không có chú thích 'đã sửa'", async () => {
    const { c, llm } = await makeController(
      [{ calls: [{ name: "exit_plan_mode", args: { plan: "1. làm A" } }] }, { text: "ok" }],
      { settings: { mode: "plan" }, decide: (r) => (r.kind === "plan" ? { allow: true, mode: "auto", plan: "1. làm A\n" } : { allow: true }) },
    );
    await c.send("x");
    expect(String(llm.calls[1].messages.at(-1)!.content)).not.toContain("tự sửa kế hoạch");
  });

  it("/plan chuyển sang chế độ plan; kèm yêu cầu thì chạy luôn", async () => {
    const { c, llm, events } = await makeController([{ text: "đây là kế hoạch" }], { settings: { mode: "auto" }, decide: (r) => (r.kind === "plan" ? { allow: false } : { allow: true }) });
    await c.send("/plan");
    expect((await c.getState()).mode).toBe("plan");
    expect(llm.calls).toHaveLength(0);
    await c.setMode("auto");
    await c.send("/plan thêm chức năng X");
    expect((await c.getState()).mode).toBe("plan");
    expect(String(llm.calls[0].messages.at(-1)!.content)).toBe("thêm chức năng X");
    expect(notices(events).some((n) => /chế độ plan/.test(n))).toBe(true);
  });

  it("/memory liệt kê tệp đang nạp và quy tắc chưa nạp", async () => {
    const { c, events } = await makeController([{ text: "ok" }], {
      seed: { ...SEED, "AGENTS.md": "Luôn dùng tab.", ".agents/rules/py.md": "---\ntrigger: glob\nglobs: '*.py'\n---\nQuy ước py." },
    });
    await c.send("/memory");
    const n = notices(events).at(-1)!;
    expect(n).toContain("✓ AGENTS.md");
    expect(n).toContain(".agents/rules/py.md: chờ agent đụng tới *.py");
    const empty = await makeController([{ text: "ok" }]);
    await empty.c.send("/memory");
    expect(notices(empty.events).at(-1)).toContain("/init");
  });

  it("/usage báo token của phiên", async () => {
    const { c, events } = await makeController([{ text: "ok" }]);
    await c.send("xin chào");
    await c.send("/usage");
    expect(notices(events).at(-1)).toMatch(/100 token vào, 20 token ra, 1 lần gọi/);
  });

  it("/effort bật/tắt suy luận sâu; ultrathink chỉ bật cho đúng một lượt", async () => {
    const { c, llm, events } = await makeController([{ text: "ok" }]);
    await c.send("/effort");
    expect(notices(events).at(-1)).toContain("tắt");
    await c.send("hãy ultrathink về cách sắp xếp");
    expect(llm.calls[0].opts.thinking).toBe(true);
    await c.send("câu thường");
    expect(llm.calls[1].opts.thinking).toBe(false);
    await c.send("/effort high");
    await c.send("câu thường nữa");
    expect(llm.calls[2].opts.thinking).toBe(true);
    await c.send("/effort low");
    await c.send("lại thường");
    expect(llm.calls[3].opts.thinking).toBe(false);
    await c.send("/effort bậy");
    expect(notices(events).at(-1)).toContain("/effort high");
  });

  it("@ảnh.png đính kèm lời chỉ dẫn dùng read_image thay vì chép nhị phân", async () => {
    const env = new MemoryEnv("/ws", { ...SEED });
    await env.writeBytes("/ws/anh-dan-1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]));
    const { c, llm } = await makeController([{ text: "ok" }], { env });
    await c.send("Sửa giao diện theo @anh-dan-1.png");
    const p = String(llm.calls[0].messages.at(-1)!.content);
    expect(p).toContain('<image path="anh-dan-1.png">');
    expect(p).toContain("read_image");
  });

  it("uploadFiles lưu ảnh dán vào thư mục làm việc để @ nhắc tới được", async () => {
    const { c, env } = await makeController([{ text: "ok" }]);
    const r = await c.uploadFiles([{ name: "anh-dan-20261009-1.png", data: new Uint8Array([1, 2, 3]) }]);
    expect(r.saved).toEqual(["anh-dan-20261009-1.png"]);
    expect(env.snapshot()["/ws/anh-dan-20261009-1.png"]).toBeDefined();
  });

  it("/init dặn tạo CLAUDE.md một dòng @AGENTS.md và kiểm tra .gitignore; /commit không git add bừa và hỏi trước khi git init", async () => {
    const { c, llm } = await makeController([{ text: "ok" }]);
    await c.send("/init");
    const init = String(llm.calls[0].messages.at(-1)!.content);
    expect(init).toContain("`@AGENTS.md`");
    expect(init).toContain(".gitignore");
    await c.send("/commit");
    const commit = String(llm.calls[1].messages.at(-1)!.content);
    expect(commit).toContain("never `git add .` blindly");
    expect(commit).toContain("wait for the user's yes");
    expect(commit).toContain("NEVER run `git push`");
  });

  it("chế độ plan yêu cầu kế hoạch có tệp sẽ sửa, bước kiểm tra và câu hỏi mở", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { settings: { mode: "plan" }, decide: () => ({ allow: false }) });
    await c.send("làm gì đó");
    const sys = String(llm.calls[0].messages[0].content);
    expect(sys).toContain("files to change and anything you will NOT touch");
    expect(sys).toContain("how you will check each step");
  });

  it("/context liệt kê từng tệp hướng dẫn đang nạp", async () => {
    const { c, events } = await makeController([{ text: "ok" }], { seed: { ...SEED, "AGENTS.md": "Luôn dùng tab.", "CLAUDE.md": "@AGENTS.md" } });
    await c.send("/context");
    const n = notices(events).at(-1)!;
    expect(n).toMatch(/AGENTS\.md\s+\S+/);
    expect(n).toMatch(/CLAUDE\.md\s+\S+/);
  });
});

describe("ảnh dán Ctrl+V lưu tạm ngoài dự án", () => {
  const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const text = new TextEncoder().encode("không phải ảnh");

  it("không ghi vào thư mục dự án; trả tham chiếu dan/…; chỉ nhận ảnh thật", async () => {
    const { c, env } = await makeController([{ text: "ok" }], { seed: { "README.md": "# demo\n" } });
    const r = await c.pasteImages!([{ name: "anh-dan-1.png", data: PNG }, { name: "gia.png", data: text }, { name: "tai-lieu.txt", data: PNG }]);
    expect(r.refs).toEqual(["dan/anh-dan-1.png"]);
    expect(r.errors.length).toBe(2);
    const inProject = (await env.readdir(env.root)).map((e) => e.name);
    expect(inProject).toEqual(["README.md"]);
    expect(await env.stat(`${env.scratchDir}/anh-dan-1.png`)).not.toBeNull();
  });

  it("@dan/<tên> được đính kèm như ảnh (agent dùng read_image), không bị coi là tệp ngoài dự án", async () => {
    const { c, env } = await makeController([{ text: "ok" }], {});
    await c.pasteImages!([{ name: "loi.png", data: PNG }]);
    const out = await c.currentSession.handleInput("@dan/loi.png vỡ css à");
    expect(out.run).toContain(`<image path="${env.scratchDir}/loi.png">`);
    expect(out.run).toContain("read_image");
  });

  it("trùng tên thì thêm số; chỉ giữ 30 ảnh mới nhất", async () => {
    const { c, env } = await makeController([{ text: "ok" }], {});
    const a = await c.pasteImages!([{ name: "x.png", data: PNG }]);
    const b = await c.pasteImages!([{ name: "x.png", data: PNG }]);
    expect(a.refs).toEqual(["dan/x.png"]);
    expect(b.refs).toEqual(["dan/x-2.png"]);
    for (let i = 0; i < 35; i++) await c.pasteImages!([{ name: `n${i}.png`, data: PNG }]);
    expect((await env.readdir(env.scratchDir!)).length).toBeLessThanOrEqual(30);
  });

  it("read_image nhận 'dan/<tên>' và cả đường dẫn bị ghép vào thư mục dự án (lỗi thật: 'Không có tệp ảnh …/Đồng hồ/dan/anh-dan-….png')", async () => {
    const reads: string[] = [];
    const { c, env, events } = await makeController([
      { calls: [{ name: "read_image", args: { path: "/ws/dan/anh-dan-20261011-224814.png" } }] },
      { calls: [{ name: "read_image", args: { path: "dan/anh-dan-20261011-224814.png" } }] },
      { text: "xong" },
    ], {});
    (c.currentSession.o as unknown as { llm: { vision: (u: string) => Promise<string> } }).llm.vision = async (u: string) => (reads.push(u.slice(0, 22)), "Chữ trong ảnh");
    await c.pasteImages!([{ name: "anh-dan-20261011-224814.png", data: PNG }]);
    await c.send("@dan/anh-dan-20261011-224814.png lỗi gì đây");
    const res = events.filter((e) => e.type === "tool_result") as { name: string; ok: boolean; output: string }[];
    const imgs = res.filter((r) => r.name === "read_image");
    expect(imgs.map((r) => r.ok)).toEqual([true, true]);
    expect(imgs[0].output).not.toMatch(/Không có tệp ảnh/);
    expect(reads.length).toBe(2);
    expect(await env.stat(`${env.root}/dan`)).toBeNull(); // không tạo gì trong dự án
  });

  it("tệp trùng tên có thật trong dự án thì dùng tệp của dự án (không bị thay bằng ảnh tạm)", async () => {
    const { c, env } = await makeController([{ text: "ok" }], { seed: { "dan/anh-dan-1.png": "trong-du-an" } });
    await c.pasteImages!([{ name: "anh-dan-1.png", data: PNG }]);
    const { resolveSafe } = await import("../src/tools");
    const abs = await resolveSafe(c.currentSession.ctx, "dan/anh-dan-1.png");
    expect(abs).toBe(`${env.root}/dan/anh-dan-1.png`);
  });

  it("pasteImages trả thư mục đã lưu để giao diện báo cho người dùng", async () => {
    const { c, env } = await makeController([{ text: "ok" }], {});
    const r = await c.pasteImages!([{ name: "a.png", data: PNG }]);
    expect(r.dir).toBe(env.scratchDir);
  });

  it("đường dẫn lạ trong dan/ không thoát ra ngoài thư mục tạm", async () => {
    const { c } = await makeController([{ text: "ok" }], {});
    const out = await c.currentSession.handleInput("xem @dan/../../etc/passwd và @dan/../../../../../etc/hosts");
    expect(out.run).not.toContain("<file");
    expect(out.run).not.toContain("<image");
  });
});
