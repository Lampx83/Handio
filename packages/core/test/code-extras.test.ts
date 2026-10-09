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
