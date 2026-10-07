import { describe, expect, it } from "vitest";
import { changeDiff, detectRun, listChanges, MemoryEnv, pushUndo, revertChanges, trackExec, type ToolContext } from "../src";
import { SEED, makeController } from "./helpers";

const ctxOf = (env: MemoryEnv): ToolContext => ({ env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [], turn: 1 });
const text = (env: MemoryEnv, p: string) => env.snapshot()[p];

describe("Thay đổi: so với bản gốc", () => {
  it("sửa nhiều lần vẫn so với bản GỐC đầu tiên; hoàn tác khôi phục đúng", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "một\nhai\nba\n" });
    const ctx = ctxOf(env);
    pushUndo(ctx, "/ws/a.txt", "một\nhai\nba\n");
    await env.writeText("/ws/a.txt", "một\nHAI\nba\n");
    pushUndo(ctx, "/ws/a.txt", "một\nHAI\nba\n");
    await env.writeText("/ws/a.txt", "một\nHAI\nba\nbốn\n");
    const ch = await listChanges(ctx);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ path: "a.txt", status: "modified", added: 2, removed: 1 });
    const d = await changeDiff(ctx, "a.txt");
    expect(d!.diff.some((l) => l.kind === "add" && l.text === "bốn")).toBe(true);
    const r = await revertChanges(ctx, { rel: "a.txt" });
    expect(r.reverted).toEqual(["a.txt"]);
    expect(text(env, "/ws/a.txt")).toBe("một\nhai\nba\n");
    expect(await listChanges(ctx)).toHaveLength(0);
    expect(ctx.undoStack).toHaveLength(0);
  });

  it("tệp mới bị xoá, tệp bị xoá được tạo lại, tệp sửa về như cũ; chỉ tệp được chọn bị đụng tới", async () => {
    const env = new MemoryEnv("/ws", { "keep.txt": "giữ\n", "gone.txt": "đã bị xoá\n", "edit.txt": "cũ\n" });
    const ctx = ctxOf(env);
    pushUndo(ctx, "/ws/new/dir/n.txt", null);
    await env.writeText("/ws/new/dir/n.txt", "mới\n");
    pushUndo(ctx, "/ws/gone.txt", "đã bị xoá\n");
    await env.remove("/ws/gone.txt");
    pushUndo(ctx, "/ws/edit.txt", "cũ\n");
    await env.writeText("/ws/edit.txt", "mới\n");
    expect((await listChanges(ctx)).map((c) => c.status).sort()).toEqual(["deleted", "modified", "new"]);
    // hoàn tác riêng tệp mới
    await revertChanges(ctx, { rel: "new/dir/n.txt" });
    expect(await env.stat("/ws/new/dir/n.txt")).toBeNull();
    expect(text(env, "/ws/edit.txt")).toBe("mới\n");
    // hoàn tác tất cả
    const r = await revertChanges(ctx);
    expect(r.reverted.sort()).toEqual(["edit.txt", "gone.txt"]);
    expect(text(env, "/ws/gone.txt")).toBe("đã bị xoá\n");
    expect(text(env, "/ws/edit.txt")).toBe("cũ\n");
    expect(text(env, "/ws/keep.txt")).toBe("giữ\n");
  });

  it("tạo rồi xoá chính tệp đó thì không còn là thay đổi", async () => {
    const env = new MemoryEnv("/ws", {});
    const ctx = ctxOf(env);
    pushUndo(ctx, "/ws/t.txt", null);
    await env.writeText("/ws/t.txt", "x");
    await env.remove("/ws/t.txt");
    expect(await listChanges(ctx)).toHaveLength(0);
  });

  it("an toàn đường dẫn: mục ngoài dự án bị bỏ qua, không bao giờ ghi/xoá ngoài thư mục dự án", async () => {
    const env = new MemoryEnv("/ws", { "ok.txt": "1" });
    await env.writeText("/other/secret.txt", "BÍ MẬT");
    await env.writeText("/ws-evil/x.txt", "x"); // cùng tiền tố nhưng là thư mục khác
    const ctx = ctxOf(env);
    ctx.undoStack.push({ path: "/other/secret.txt", old: "CŨ", turn: 1 }, { path: "/ws-evil/x.txt", old: null, turn: 1 }, { path: "/ws/../other/secret.txt", old: "CŨ", turn: 1 });
    expect(await listChanges(ctx)).toHaveLength(0);
    const r = await revertChanges(ctx);
    expect(r.reverted).toEqual([]);
    expect(text(env, "/other/secret.txt")).toBe("BÍ MẬT");
    expect(text(env, "/ws-evil/x.txt")).toBe("x");
    // tên tương đối do giao diện gửi chỉ để tra cứu: "../other/secret.txt" không khớp mục nào nên không làm gì
    const r2 = await revertChanges(ctx, { rel: "../other/secret.txt" });
    expect(r2.reverted).toEqual([]);
    expect(await changeDiff(ctx, "../other/secret.txt")).toBeNull();
  });

  it("tệp nhạy cảm: liệt kê nhưng không hiện nội dung và không hoàn tác từ bảng này", async () => {
    const env = new MemoryEnv("/ws", { ".env": "SECRET=1\n" });
    const ctx = ctxOf(env);
    pushUndo(ctx, "/ws/.env", "SECRET=1\n");
    await env.writeText("/ws/.env", "SECRET=2\n");
    const ch = await listChanges(ctx);
    expect(ch[0]).toMatchObject({ path: ".env", sensitive: true, added: 0, removed: 0 });
    expect((await changeDiff(ctx, ".env"))!.diff).toEqual([]);
    const r = await revertChanges(ctx);
    expect(r.reverted).toEqual([]);
    expect(r.skipped).toEqual([".env"]);
    expect(text(env, "/ws/.env")).toBe("SECRET=2\n");
  });

  it("tệp nhị phân: có trong danh sách, không có diff chữ; khôi phục đúng từng byte", async () => {
    const env = new MemoryEnv("/ws", {});
    const ctx = ctxOf(env);
    const old = new Uint8Array([1, 0, 2, 3]);
    await env.writeBytes("/ws/b.bin", old);
    pushUndo(ctx, "/ws/b.bin", old);
    await env.writeBytes("/ws/b.bin", new Uint8Array([9, 0, 9]));
    expect((await listChanges(ctx))[0]).toMatchObject({ path: "b.bin", binary: true });
    await revertChanges(ctx);
    expect([...(await env.readBytes("/ws/b.bin"))]).toEqual([1, 0, 2, 3]);
  });
});

describe("Thay đổi do lệnh bash", () => {
  it("ghi nhận tệp tạo/sửa/xoá và hoàn tác được cả nhóm; không đụng tệp không liên quan", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "a-cũ\n", "c.txt": "c-cũ\n", "same.txt": "giữ\n" });
    const ctx = ctxOf(env);
    await trackExec(ctx, async () => {
      await env.writeText("/ws/a.txt", "a-mới\n");
      await env.writeText("/ws/b.txt", "b-mới\n");
      await env.remove("/ws/c.txt");
      return "ok";
    });
    const ch = await listChanges(ctx);
    expect(ch.map((c) => `${c.path}:${c.status}`).sort()).toEqual(["a.txt:modified", "b.txt:new", "c.txt:deleted"]);
    expect(new Set(ctx.undoStack.map((e) => e.group)).size).toBe(1);
    await revertChanges(ctx);
    expect(text(env, "/ws/a.txt")).toBe("a-cũ\n");
    expect(text(env, "/ws/c.txt")).toBe("c-cũ\n");
    expect(await env.stat("/ws/b.txt")).toBeNull();
    expect(text(env, "/ws/same.txt")).toBe("giữ\n");
  });

  it("lệnh lỗi vẫn ghi nhận phần đã ghi; bỏ qua node_modules và tệp nhạy cảm", async () => {
    const env = new MemoryEnv("/ws", { ".env": "K=1\n" });
    const ctx = ctxOf(env);
    await expect(
      trackExec(ctx, async () => {
        await env.writeText("/ws/out.txt", "x");
        await env.writeText("/ws/node_modules/p/i.js", "y");
        await env.writeText("/ws/.env", "K=2\n");
        throw new Error("lệnh hỏng");
      }),
    ).rejects.toThrow("lệnh hỏng");
    expect((await listChanges(ctx)).map((c) => c.path)).toEqual(["out.txt"]);
  });
});

const edit = (p: string, o: string, n: string) => ({ name: "edit_file", args: { path: p, old_string: o, new_string: n } });
const read = (p: string) => ({ name: "read_file", args: { path: p } });

describe("agent thật: tổng kết lượt, undo nhóm, rewind", () => {
  it("tổng kết: sửa rồi chạy kiểm tra thành công → ok; không chạy → none; chạy lỗi → fail", async () => {
    const run = async (steps: { calls?: { name: string; args: unknown }[]; text?: string }[], exit = 0) => {
      const env = new MemoryEnv("/ws", SEED);
      env.exec = async () => ({ code: exit, output: exit ? "FAIL" : "ok", timedOut: false });
      const { c, events } = await makeController(steps, { env });
      await c.send("làm");
      const sm = events.find((e) => e.type === "summary");
      expect(events.at(-1)!.type).toBe("turn_end"); // tổng kết đến trước turn_end
      return sm as Extract<typeof sm, { type: "summary" }> | undefined;
    };
    const base = [{ calls: [read("hello.py")] }, { calls: [edit("hello.py", '"Hello"', '"Xin chào"')] }];
    const ok = await run([...base, { calls: [{ name: "bash", args: { command: "node test.js" } }] }, { text: "xong" }]);
    expect(ok).toMatchObject({ verify: "ok" });
    expect(ok!.files.map((f) => f.path)).toEqual(["hello.py"]);
    expect((await run([...base, { text: "xong" }]))!.verify).toBe("none");
    expect((await run([...base, { calls: [{ name: "bash", args: { command: "node test.js" } }] }, { text: "xong" }], 1))!.verify).toBe("fail");
    // chạy kiểm tra TRƯỚC khi sửa thì chưa tính là đã kiểm chứng
    expect((await run([{ calls: [{ name: "bash", args: { command: "node test.js" } }] }, ...base, { text: "xong" }]))!.verify).toBe("none");
    // lượt không đổi tệp nào: không có tổng kết
    expect(await run([{ calls: [read("hello.py")] }, { text: "xong" }])).toBeUndefined();
  });

  it("/undo hoàn tác cả nhóm thay đổi của một lệnh bash", async () => {
    const env = new MemoryEnv("/ws", SEED);
    env.exec = async () => {
      await env.writeText("/ws/g1.txt", "1");
      await env.writeText("/ws/g2.txt", "2");
      return { code: 0, output: "", timedOut: false };
    };
    const { c } = await makeController([{ calls: [{ name: "bash", args: { command: "gen" } }] }, { text: "xong" }], { env });
    await c.send("sinh file");
    expect(await c.changesList()).toHaveLength(2);
    expect(await c.currentSession.undo()).toContain("2 tệp");
    expect(await c.changesList()).toHaveLength(0);
    expect(await env.stat("/ws/g1.txt")).toBeNull();
  });

  const threeTurns = async () => {
    const { c, env, events } = await makeController((msgs) => {
      const t = msgs.filter((m) => m.role === "user" && !m.content!.startsWith("[")).length - 1; // lượt hiện tại
      if (msgs.at(-1)!.role === "user") return { calls: [read(t === 0 ? "hello.py" : t === 1 ? "src/util.py" : "README.md")] };
      const lastCall = msgs.filter((m) => m.role === "assistant").at(-1)!.tool_calls![0].function.name;
      if (lastCall !== "read_file") return { text: "xong" };
      if (t === 0) return { calls: [edit("hello.py", '"Hello"', '"Xin chào"')] };
      if (t === 1) return { calls: [{ name: "write_file", args: { path: "moi.txt", content: "mới\n" } }, edit("src/util.py", "a + b", "a - b")] };
      return { calls: [edit("README.md", "Demo", "Demo 3")] };
    });
    for (const q of ["lượt một", "lượt hai", "lượt ba"]) {
      await c.send(q);
      await c.currentSession.main.messages; // đảm bảo xong
    }
    return { c, env, events };
  };

  it("rewind: cắt hội thoại và khôi phục tệp từ lượt đó trở đi; giữ thay đổi của các lượt trước", async () => {
    const { c, env } = await threeTurns();
    const s = c.currentSession;
    const pts = await c.rewindPoints();
    expect(pts.map((p) => p.text)).toEqual(["lượt một", "lượt hai", "lượt ba"]);
    expect(pts.map((p) => p.files)).toEqual([4, 3, 1]);
    expect((await c.changesList()).length).toBe(4);
    const r = await c.rewind(1, true);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.text).toBe("lượt hai");
    expect(r.history.filter((h) => h.kind === "user").map((h) => h.text)).toEqual(["lượt một"]);
    expect(s.main.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const snap = env.snapshot();
    expect(snap["/ws/hello.py"]).toContain("Xin chào"); // lượt 1 còn nguyên
    expect(snap["/ws/src/util.py"]).toContain("a + b"); // lượt 2 đã hoàn tác
    expect(snap["/ws/moi.txt"]).toBeUndefined();
    expect(snap["/ws/README.md"]).toBe("# Demo\n"); // lượt 3 đã hoàn tác
    expect((await c.changesList()).map((f) => f.path)).toEqual(["hello.py"]);
    expect((await c.rewindPoints()).map((p) => p.text)).toEqual(["lượt một"]);
    // hỏi tiếp bình thường sau khi quay lại
    expect(await c.rewind(5, true)).toEqual({ error: "Không còn điểm này." });
  });

  it("rewind chỉ hội thoại: tệp giữ nguyên; rewind về đầu: hội thoại trống, mọi tệp về gốc", async () => {
    const { c, env } = await threeTurns();
    const r = await c.rewind(2, false);
    expect("error" in r).toBe(false);
    expect(env.snapshot()["/ws/README.md"]).toBe("# Demo 3\n");
    expect(c.currentSession.main.messages.filter((m) => m.role === "user")).toHaveLength(2);
    const r0 = await c.rewind(0, true);
    expect("error" in r0).toBe(false);
    expect(c.currentSession.main.messages).toHaveLength(0);
    const snap = env.snapshot();
    expect(snap["/ws/hello.py"]).toBe(SEED["hello.py"]);
    expect(snap["/ws/README.md"]).toBe("# Demo\n"); // lượt 3 chỉ-hội-thoại ở trên không hoàn tác được tệp, nhưng rewind về đầu đã làm
    expect(snap["/ws/moi.txt"]).toBeUndefined();
    expect(await c.changesList()).toEqual([]);
  });

  it("không hoàn tác/quay lại khi agent đang làm việc", async () => {
    const { c } = await threeTurns();
    (c as unknown as { busy: boolean }).busy = true;
    expect(await c.changesRevert()).toEqual({ error: expect.stringContaining("đang làm việc") });
    expect(await c.rewind(0, true)).toEqual({ error: expect.stringContaining("đang làm việc") });
  });
});

describe("@thư mục, /status, /context, /diff", () => {
  it("@thư_mục/ đính kèm cây thư mục (không có tệp nhạy cảm); gợi ý có cả thư mục", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { seed: { ...SEED, "src/a/deep.py": "x", "src/.env": "K=1", "src/node_modules/x.js": "y" } });
    await c.send("xem @src/ giúp tôi");
    const user = llm.calls[0].messages.find((m) => m.role === "user")!.content!;
    expect(user).toContain('<dir path="src">');
    expect(user).toContain("util.py");
    expect(user).toContain("a/");
    expect(user).toContain("  deep.py");
    expect(user).not.toContain(".env");
    expect(user).not.toContain("node_modules");
    const sug = await c.searchFiles("sr");
    expect(sug).toContain("src/");
    expect(sug[0]).toBe("src/");
    expect((await c.searchFiles("")).slice(0, 2)).toEqual(["src/", "README.md"]);
  });

  it("/status, /context, /diff trả lời có nội dung", async () => {
    const { c, events } = await makeController([{ calls: [read("hello.py")] }, { calls: [edit("hello.py", '"Hello"', '"Hi"')] }, { text: "xong" }]);
    await c.send("sửa");
    for (const cmd of ["/status", "/context", "/diff"]) await c.send(cmd);
    const notes = events.filter((e) => e.type === "notice").map((e) => (e as { text: string }).text);
    expect(notes.find((t) => t.startsWith("Mô hình:"))).toContain("Thư mục: /ws");
    expect(notes.find((t) => t.includes("Công cụ"))).toMatch(/token/);
    expect(notes.find((t) => t.includes("hello.py"))).toMatch(/✎ hello\.py {2}\+1 −1/);
    const st = await c.getState();
    expect(st.commands.map((x) => x.name)).toEqual(expect.arrayContaining(["status", "diff", "rewind", "context"]));
  });

  it("/diff và /rewind không có ở tab Work", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "work" });
    const names = (await c.getState()).commands.map((x) => x.name);
    expect(names).not.toContain("diff");
    expect(names).not.toContain("rewind");
    expect(names).toContain("status");
  });
});

describe("gợi ý chạy dự án", () => {
  const env = (files: Record<string, string>) => new MemoryEnv("/ws", files);
  it("Node: scripts dev/start/test; trình quản lý gói theo lockfile", async () => {
    const e = env({ "package.json": JSON.stringify({ scripts: { dev: "vite", test: "vitest", build: "tsc" } }), "pnpm-lock.yaml": "" });
    expect(await detectRun(e, "/ws")).toEqual([
      { command: "pnpm dev", background: true, kind: "run" },
      { command: "pnpm test", background: false, kind: "test" },
    ]);
  });
  it("Python: streamlit chạy nền, pytest, tệp main", async () => {
    const e = env({ "app.py": "import streamlit as st\nst.write(1)\n", "test_app.py": "def test_a(): pass\n" });
    const r = await detectRun(e, "/ws");
    expect(r[0]).toEqual({ command: "streamlit run app.py", background: true, kind: "run" });
    expect(r.map((x) => x.command)).toContain("python3 -m pytest");
  });
  it("dự án mẫu JS và trang web tĩnh", async () => {
    expect((await detectRun(env({ "src/grades.js": "x", "src/grades.test.js": "y" }), "/ws")).map((x) => x.command)).toEqual(["node src/grades.test.js"]);
    expect((await detectRun(env({ "index.html": "<p>" }), "/ws"))[0]).toEqual({ command: "python3 -m http.server 8000 --bind 127.0.0.1", background: true, kind: "run" });
    expect(await detectRun(env({ "README.md": "x" }), "/ws")).toEqual([]);
  });
  it("tên tệp có ký tự lạ không bao giờ được ghép vào lệnh", async () => {
    const e = env({ "x;rm -rf ~.py": "import streamlit\n", "main.py": "print(1)\n", "package.json": JSON.stringify({ scripts: { "dev;evil": "x", start: "node a" } }) });
    const cmds = (await detectRun(e, "/ws")).map((x) => x.command);
    expect(cmds.every((c) => !/[;&|$`]/.test(c))).toBe(true);
    expect(cmds).toContain("python3 main.py");
    expect(cmds).toContain("npm start");
  });
});
