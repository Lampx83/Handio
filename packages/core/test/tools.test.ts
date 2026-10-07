import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, resolveSafe, ToolError, type ToolContext } from "../src";
import { SEED } from "./helpers";

function ctxOf(env = new MemoryEnv("/ws", SEED)): { ctx: ToolContext; run: (n: string, a: any) => Promise<string>; env: MemoryEnv } {
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map(builtinTools(env).map((t) => [t.name, t]));
  return { ctx, env, run: (n, a) => tools.get(n)!.run(ctx, a) };
}

describe("đường dẫn", () => {
  it("chặn thoát khỏi thư mục dự án", async () => {
    const { ctx } = ctxOf();
    for (const p of ["../etc/passwd", "/etc/passwd", "src/../../x", "~/x"]) await expect(resolveSafe(ctx, p), p).rejects.toThrow(ToolError);
    await expect(resolveSafe(ctx, "src/util.py")).resolves.toBe("/ws/src/util.py");
    await expect(resolveSafe(ctx, "new/dir/file.txt")).resolves.toBe("/ws/new/dir/file.txt");
  });
});

describe("read_file", () => {
  it("đánh số dòng, đọc từng đoạn", async () => {
    const { run } = ctxOf();
    expect(await run("read_file", { path: "hello.py" })).toContain("     1\tdef greet(name):");
    const big = new MemoryEnv("/ws", { "big.txt": Array.from({ length: 700 }, (_, i) => "l" + i).join("\n") });
    const out = await ctxOf(big).run("read_file", { path: "big.txt" });
    expect(out).toContain("còn 200 dòng; đọc tiếp bằng offset=501");
    expect(await ctxOf(big).run("read_file", { path: "big.txt", offset: 698, limit: 5 })).toContain("l699");
  });
  it("báo lỗi file nhị phân và file không có", async () => {
    const env = new MemoryEnv("/ws", {});
    await env.writeText("/ws/bin.dat", "a\u0000b");
    const { run } = ctxOf(env);
    await expect(run("read_file", { path: "bin.dat" })).rejects.toThrow(/nhị phân/);
    await expect(run("read_file", { path: "nope" })).rejects.toThrow(/Không có file/);
  });
});

describe("edit_file / write_file", () => {
  it("bắt buộc đọc trước khi sửa", async () => {
    const { run } = ctxOf();
    await expect(run("edit_file", { path: "hello.py", old_string: "Hello", new_string: "Xin chào" })).rejects.toThrow(/đọc .* trước/);
    await expect(run("write_file", { path: "hello.py", content: "x" })).rejects.toThrow(/đọc .* trước/);
  });
  it("sửa đúng, báo lỗi khi không khớp hoặc trùng nhiều chỗ", async () => {
    const { run, env } = ctxOf();
    await run("read_file", { path: "hello.py" });
    expect(await run("edit_file", { path: "hello.py", old_string: '"Hello"', new_string: '"Xin chào"' })).toContain("Đã sửa hello.py");
    expect(env.snapshot()["/ws/hello.py"]).toContain("Xin chào");
    await expect(run("edit_file", { path: "hello.py", old_string: "zzz", new_string: "y" })).rejects.toThrow(/Không tìm thấy/);
    await expect(run("edit_file", { path: "hello.py", old_string: "greet", new_string: "hi" })).rejects.toThrow(/2 lần/);
    expect(await run("edit_file", { path: "hello.py", old_string: "greet", new_string: "hi", replace_all: true })).toContain("2 chỗ");
  });
  it("khớp gần đúng khi chỉ lệch thụt dòng", async () => {
    const { run, env } = ctxOf();
    await run("read_file", { path: "hello.py" });
    const msg = await run("edit_file", { path: "hello.py", old_string: 'def greet(name):\nprint("Hello", name)', new_string: 'def greet(name):\nprint("Chào", name)' });
    expect(msg).toContain("khớp gần đúng");
    expect(env.snapshot()["/ws/hello.py"]).toContain('def greet(name):\n    print("Chào", name)');
  });
  it("phát hiện file bị đổi sau lần đọc", async () => {
    const { run, env } = ctxOf();
    await run("read_file", { path: "hello.py" });
    await env.writeText("/ws/hello.py", "changed\n");
    await expect(run("edit_file", { path: "hello.py", old_string: "changed", new_string: "x" })).rejects.toThrow(/đã thay đổi/);
  });
  it("tạo file mới (kèm thư mục) và đưa vào ngăn xếp hoàn tác", async () => {
    const { run, ctx, env } = ctxOf();
    expect(await run("write_file", { path: "a/b/new.txt", content: "x\ny\n" })).toContain("Đã tạo a/b/new.txt");
    expect(env.snapshot()["/ws/a/b/new.txt"]).toBe("x\ny\n");
    expect(ctx.undoStack).toHaveLength(1);
  });
});

describe("tìm kiếm", () => {
  it("glob, grep, list_dir", async () => {
    const { run } = ctxOf();
    expect((await run("glob", { pattern: "**/*.py" })).split("\n").sort()).toEqual(["hello.py", "src/util.py"]);
    expect(await run("glob", { pattern: "*.py" })).toContain("hello.py");
    expect(await run("grep", { pattern: "def \\w+" })).toMatch(/hello\.py:1:def greet/);
    expect(await run("grep", { pattern: "ADD", ignore_case: true, glob: "*.py" })).toContain("src/util.py:1");
    expect(await run("grep", { pattern: "nothing-here" })).toBe("(không có kết quả)");
    expect(await run("list_dir", {})).toBe("src/\n.env\nhello.py\nREADME.md");
    await expect(run("grep", { pattern: "(" })).rejects.toThrow(/Biểu thức/);
  });
});

describe("todo_write, công cụ tuỳ khả năng", () => {
  it("todo_write kiểm tra tham số", async () => {
    const { run, ctx } = ctxOf();
    expect(await run("todo_write", { todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }] })).toContain("1/2");
    expect(ctx.todos).toHaveLength(2);
    await expect(run("todo_write", { todos: [{ content: "a", status: "x" }] })).rejects.toThrow(/status/);
  });
  it("chỉ có bash/run_javascript/web_fetch khi nơi chạy hỗ trợ", () => {
    const names = (e: MemoryEnv) => builtinTools(e).map((t) => t.name);
    expect(names(new MemoryEnv())).not.toContain("bash");
    const e = new MemoryEnv();
    e.exec = async () => ({ code: 0, output: "", timedOut: false });
    e.runJs = async () => ({ ok: true, logs: [] });
    expect(names(e)).toEqual(expect.arrayContaining(["bash", "run_javascript"]));
  });
});
