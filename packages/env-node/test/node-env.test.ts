import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalController, resolveSafe, ToolError, type ToolContext } from "@neu/agent-core";
import { JsonSettingsStore, JsonTrustStore, NodeEnv, assertPublicHost, htmlToText, isPrivateAddress } from "../src";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-env-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const env = new NodeEnv(tmp);

describe("NodeEnv", () => {
  it("đọc/ghi/liệt kê/xoá file thật", async () => {
    await env.mkdirp(tmp + "/a/b");
    await env.writeText(tmp + "/a/b/x.txt", "xin chào");
    expect(new TextDecoder().decode(await env.readBytes(tmp + "/a/b/x.txt"))).toBe("xin chào");
    expect((await env.stat(tmp + "/a"))!.isDir).toBe(true);
    expect(await env.stat(tmp + "/nope")).toBeNull();
    expect(await env.readdir(tmp + "/a")).toEqual([{ name: "b", isDir: true }]);
    await env.remove(tmp + "/a");
    expect(await env.stat(tmp + "/a")).toBeNull();
  });
  it("chạy lệnh trong thư mục dự án, trả mã thoát và đầu ra gộp stdout+stderr", async () => {
    const r = await env.exec("echo hi; echo err 1>&2; pwd; exit 3", { cwd: tmp, timeoutMs: 5000 });
    expect(r.code).toBe(3);
    expect(r.output).toContain("hi");
    expect(r.output).toContain("err");
    expect(r.output).toContain(tmp);
  });
  it("hết giờ thì giết cả nhóm tiến trình", async () => {
    const t0 = Date.now();
    const r = await env.exec("sleep 30 & sleep 30", { cwd: tmp, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("AbortSignal dừng lệnh đang chạy", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    await env.exec("sleep 30", { cwd: tmp, timeoutMs: 20000, signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("symlink trỏ ra ngoài không vượt được rào thư mục dự án", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "neu-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "S");
    fs.symlinkSync(outside, path.join(tmp, "link"));
    const ctx: ToolContext = { env, root: tmp, extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
    await expect(resolveSafe(ctx, "link/secret.txt")).rejects.toThrow(ToolError);
    await expect(resolveSafe(ctx, "link/new.txt")).rejects.toThrow(ToolError);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("web_fetch an toàn", () => {
  it("nhận diện địa chỉ riêng tư", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("chặn localhost và IP nội bộ", async () => {
    await expect(env.fetchUrl("http://127.0.0.1:1/", { maxChars: 1000 })).rejects.toThrow(/nội bộ/);
    await expect(env.fetchUrl("http://localhost/", { maxChars: 1000 })).rejects.toThrow(/nội bộ/);
    await expect(env.fetchUrl("file:///etc/passwd", { maxChars: 1000 })).rejects.toThrow(/http/);
    await expect(assertPublicHost("[::1]")).rejects.toThrow(/nội bộ/);
  });
  it("htmlToText bỏ script/style", () => {
    expect(htmlToText("<html><head><title>x</title></head><body><script>alert(1)</script><p>Xin <b>chào</b></p><style>a{}</style></body></html>")).toBe("Xin chào");
  });
});

describe("kho cài đặt", () => {
  it("mã hoá khoá API khi có codec, và không lưu khoá dạng rõ", async () => {
    const codec = { encrypt: (s: string) => Buffer.from(s).toString("base64"), decrypt: (s: string) => Buffer.from(s, "base64").toString() };
    const f = path.join(tmp, "cfg", "settings.json");
    const st = new JsonSettingsStore(f, codec);
    await st.save({ baseUrl: "http://x", model: "m", key: "SECRET-KEY" } as any);
    expect(fs.readFileSync(f, "utf8")).not.toContain("SECRET-KEY");
    expect((await st.load())!.key).toBe("SECRET-KEY");
    expect(fs.statSync(f).mode & 0o077).toBe(0);
  });
  it("danh sách thư mục tin cậy", async () => {
    const t = new JsonTrustStore(path.join(tmp, "trust.json"));
    expect(await t.isTrusted("/a")).toBe(false);
    await t.setTrusted("/a", true);
    expect(await t.isTrusted("/a")).toBe(true);
    await t.setTrusted("/a", false);
    expect(await t.isTrusted("/a")).toBe(false);
  });
});

describe("đầu-cuối trên thư mục thật", () => {
  it("controller + NodeEnv: tạo file và chạy lệnh thật sau khi được duyệt", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-e2e-")));
    const e = new NodeEnv(dir);
    const c = await LocalController.create({ env: e, realFs: true, store: { load: async () => ({ mode: "acceptEdits" }), save: async () => undefined }, trust: { isTrusted: async () => false, setTrusted: async () => undefined } });
    const script = [
      { calls: [{ name: "write_file", args: { path: "hi.js", content: "console.log(6*7)\n" } }] },
      { calls: [{ name: "bash", args: { command: "node hi.js" } }] },
      { text: "In ra 42" },
    ];
    let i = 0;
    (c.currentSession.o as any).llm = { chat: async (_m: unknown, o: any) => { const s = script[i++]; return { content: s.text ?? "", reasoning: "", toolCalls: (s.calls ?? []).map((x, k) => ({ id: "t" + i + k, name: x.name, arguments: JSON.stringify(x.args) })), usage: {}, finish: "stop" }; } };
    const out: string[] = [];
    c.onEvent((ev) => {
      if (ev.type === "permission") c.respondPermission(ev.request.id, { allow: true });
      if (ev.type === "tool_result") out.push(ev.output);
    });
    await c.send("tạo và chạy hi.js");
    expect(fs.readFileSync(path.join(dir, "hi.js"), "utf8")).toContain("6*7");
    expect(out.at(-1)).toContain("42");
    expect(out.at(-1)).toContain("[mã thoát 0]");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("tuỳ chọn NodeEnv", () => {
  it("allowExec=false không cấp công cụ chạy lệnh", () => {
    expect(new NodeEnv(tmp, { allowExec: false }).exec).toBeUndefined();
    expect(typeof new NodeEnv(tmp).exec).toBe("function");
  });
  it("xuất PDF bằng LibreOffice nếu máy có", async () => {
    const e = new NodeEnv(tmp);
    if (!e.convertToPdf) return; // máy không cài LibreOffice: bỏ qua
    const { office } = await import("@neu/agent-core");
    fs.writeFileSync(path.join(tmp, "x.docx"), await office.createDocx({ content: "# Xin chào\n\nNội dung." }));
    await e.convertToPdf(path.join(tmp, "x.docx"), path.join(tmp, "x.pdf"), { timeoutMs: 120000 });
    expect(fs.readFileSync(path.join(tmp, "x.pdf")).subarray(0, 4).toString()).toBe("%PDF");
    const pdfText = await office.readDocumentSections(new Uint8Array(fs.readFileSync(path.join(tmp, "x.pdf"))), ".pdf");
    expect(pdfText.sections[0].text).toContain("Xin chào");
  }, 130000);
  it("writeBytes ghi nhị phân đúng", async () => {
    await env.writeBytes(path.join(tmp, "b.bin"), new Uint8Array([0, 1, 2, 255]));
    expect([...fs.readFileSync(path.join(tmp, "b.bin"))]).toEqual([0, 1, 2, 255]);
  });
});

describe("môi trường tiến trình con (không lộ bí mật)", () => {
  it("lọc biến môi trường theo danh sách cho phép", async () => {
    const { childEnv } = await import("../src");
    const e = childEnv({ PATH: "/usr/bin", HOME: "/h", LC_ALL: "C", NEU_BUILTIN_KEY: "S3CRET", AWS_SECRET_ACCESS_KEY: "A", GITHUB_TOKEN: "G", ANTHROPIC_API_KEY: "K", SSH_AUTH_SOCK: "/s", NODE_OPTIONS: "--inspect", npm_config_token: "T" });
    expect(Object.keys(e)).not.toEqual(expect.arrayContaining(["NEU_BUILTIN_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "SSH_AUTH_SOCK", "NODE_OPTIONS", "npm_config_token"]));
    expect(e.HOME).toBe("/h");
    expect(e.LC_ALL).toBe("C");
    expect(e.PATH).toContain("/usr/bin");
    expect(e.GIT_TERMINAL_PROMPT).toBe("0");
  });
  it("lệnh con thật sự không thấy biến bí mật của tiến trình cha", async () => {
    process.env.SUPER_SECRET_TEST = "dont-leak";
    const r = await env.exec('echo "[$SUPER_SECRET_TEST]"; env | grep -c SUPER_SECRET_TEST || true', { cwd: tmp, timeoutMs: 5000 });
    delete process.env.SUPER_SECRET_TEST;
    expect(r.output).toContain("[]");
    expect(r.output).not.toContain("dont-leak");
  });
});

describe("sandbox macOS (Seatbelt) cho lệnh của agent", () => {
  const mac = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-fakehome-")));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-proj-")));
  fs.mkdirSync(path.join(home, ".ssh"));
  fs.writeFileSync(path.join(home, ".ssh", "id_rsa"), "PRIVATE-KEY-MATERIAL");
  fs.writeFileSync(path.join(home, ".zsh_history"), "secret history");
  fs.writeFileSync(path.join(home, "notes.txt"), "ghi chu thuong");
  afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }); });
  const run = (e: NodeEnv, cmd: string) => e.exec(cmd, { cwd: proj, timeoutMs: 15000 });

  it.skipIf(!mac)("chạy lệnh bình thường và ghi được trong thư mục dự án", async () => {
    const e = new NodeEnv(proj, { sandbox: { home } });
    expect(e.sandbox).toMatchObject({ kind: "seatbelt" });
    const r = await run(e, "echo xin-chao > ok.txt && cat ok.txt && ls && node -e 'console.log(6*7)'");
    expect(r.code).toBe(0);
    expect(r.output).toContain("xin-chao");
    expect(r.output).toContain("42");
  });
  it.skipIf(!mac)("KHÔNG ghi được ra ngoài thư mục dự án (thư mục home thật, LaunchAgents, /Applications)", async () => {
    const realHome = os.homedir(); // nằm ngoài vùng được phép ghi; chỉ dùng tên tệp chưa tồn tại, dọn sau khi thử
    const tag = `.neu-sbx-${process.pid}-${Date.now()}`;
    const targets = [path.join(realHome, tag), path.join(realHome, "Library", "LaunchAgents", tag + ".plist"), `/Applications/${tag}`, path.join(realHome, "Documents", tag)];
    const e = new NodeEnv(proj, { sandbox: { home } });
    try {
      for (const t of targets) {
        const r = await run(e, `echo x > "${t}"`);
        expect(r.code, t).not.toBe(0);
        expect(fs.existsSync(t), t).toBe(false);
      }
      // đối chứng: cùng lệnh ở trong thư mục dự án thì được
      expect((await run(e, `echo x > "${path.join(proj, "inside.txt")}"`)).code).toBe(0);
    } finally {
      for (const t of targets) fs.rmSync(t, { force: true });
    }
  });
  it.skipIf(!mac)("KHÔNG đọc được kho bí mật (ssh, lịch sử shell) nhưng đọc được tệp thường", async () => {
    const e = new NodeEnv(proj, { sandbox: { home } });
    const a = await run(e, `cat "${home}/.ssh/id_rsa"`);
    expect(a.code).not.toBe(0);
    expect(a.output).not.toContain("PRIVATE-KEY-MATERIAL");
    expect((await run(e, `cat "${home}/.zsh_history"`)).output).not.toContain("secret history");
    expect((await run(e, `ls "${home}/.ssh"`)).code).not.toBe(0);
    expect((await run(e, `cat "${home}/notes.txt"`)).output).toContain("ghi chu thuong");
  });
  it.skipIf(!mac)("chính sách tắt mạng: không gọi ra Internet được, vẫn chạy cục bộ", async () => {
    const e = new NodeEnv(proj, { sandbox: { home, network: false } });
    const r = await run(e, "curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com; echo; echo local-ok");
    expect(r.output).not.toMatch(/\b200\b/);
    expect(r.output).toContain("local-ok");
  });
  it("không có sandbox thì không báo là có", () => {
    expect(new NodeEnv(proj).sandbox).toBeUndefined();
  });
});

describe("tiến trình nền thật", () => {
  it("chạy máy chủ nền, đọc đầu ra, nhận diện URL localhost, dừng được cả nhóm tiến trình", async () => {
    const { ProcessManager } = await import("@neu/agent-core");
    const events: any[] = [];
    const pm = new ProcessManager(env, (e) => events.push(e));
    const info = pm.start(`node -e "const s=require('http').createServer((q,r)=>r.end('hi')).listen(0,'127.0.0.1',()=>console.log('Serving on http://localhost:'+s.address().port+'/'));setInterval(()=>{},1000)"`, tmp);
    await pm.settle(info.id, 8000);
    const p = pm.get(info.id)!;
    expect(p.info.alive).toBe(true);
    expect(p.info.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(p.log).toContain("Serving on");
    expect(pm.stop(info.id)).toBe(true);
    for (let i = 0; i < 40 && pm.get(info.id)!.info.alive; i++) await new Promise((r) => setTimeout(r, 100));
    expect(pm.get(info.id)!.info.alive).toBe(false);
    expect(events.map((e) => e.state)).toEqual(expect.arrayContaining(["start", "data", "exit"]));
  }, 20000);
  it("báo lỗi khởi động ngay (lệnh thoát) và giới hạn số tiến trình nền", async () => {
    const { ProcessManager } = await import("@neu/agent-core");
    const pm = new ProcessManager(env, () => undefined, 2);
    const bad = pm.start("echo loi-khoi-dong 1>&2; exit 3", tmp);
    await pm.settle(bad.id, 5000);
    await new Promise((r) => setTimeout(r, 200));
    expect(pm.get(bad.id)!.info).toMatchObject({ alive: false, code: 3 });
    expect(pm.get(bad.id)!.log).toContain("loi-khoi-dong");
    const a = pm.start("sleep 30", tmp);
    const b = pm.start("sleep 30", tmp);
    expect(() => pm.start("sleep 30", tmp)).toThrow(/tiến trình nền/);
    pm.stopAll();
    expect([a, b].length).toBe(2);
  }, 20000);
});

describe("MCP thật qua stdio", () => {
  const server = `
    const rl = require("readline").createInterface({ input: process.stdin });
    rl.on("line", (l) => { const m = JSON.parse(l); const r = (result) => console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      if (m.method === "initialize") r({ protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "demo" } });
      else if (m.method === "tools/list") r({ tools: [{ name: "cong", description: "Cộng hai số", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } }] });
      else if (m.method === "tools/call") r({ content: [{ type: "text", text: String(m.params.arguments.a + m.params.arguments.b) + " env=" + (process.env.DEMO_VAR || "") + " secret=" + (process.env.SUPER_SECRET_TEST || "") }] }); });`;
  it("khởi động máy chủ MCP, liệt kê và gọi công cụ; biến môi trường chỉ gồm danh sách cho phép + biến khai báo", async () => {
    const { McpManager } = await import("@neu/agent-core");
    const dir = fs.mkdtempSync(path.join(tmp, "mcp-"));
    fs.writeFileSync(path.join(dir, "s.js"), server);
    process.env.SUPER_SECRET_TEST = "leak";
    const m = new McpManager({ demo: { command: "node", args: ["s.js"], env: { DEMO_VAR: "xin-chao" } } }, new NodeEnv(dir), dir);
    await m.startAll();
    delete process.env.SUPER_SECRET_TEST;
    expect(m.errors).toEqual([]);
    const [tool] = m.tools();
    expect(tool.name).toBe("mcp__demo__cong");
    const out = await tool.run({} as never, { a: 2, b: 3 });
    expect(out).toContain("5 env=xin-chao secret=");
    expect(out).not.toContain("leak");
    m.close();
  }, 20000);
});

describe("giáo trình: bắt đầu → chấm → làm đúng → chấm (lệnh thật, mọi bài tập)", () => {
  it("API học tập: mọi bài tập chấm đúng trên thư mục thật", async () => {
    const core = await import("@neu/agent-core");
    const { EXERCISES } = await import("../../core/src/curriculum");
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-learn-")));
    const e = new NodeEnv(dir);
    const failures: string[] = [];
    for (const ex of EXERCISES) {
      const started = await core.startExercise(e, dir, ex.id);
      expect(started.created.some((f) => f.endsWith("DE-BAI.md"))).toBe(true);
      expect(started.created.join()).not.toMatch(/solution|loi-giai/i);
      const before = await core.gradeExercise(e, dir, ex.id);
      if (!(before.total > 0 && before.passed < before.total && !before.error)) failures.push(`${ex.id}: bản khởi đầu phải chưa đạt (${before.passed}/${before.total} ${before.error ?? ""})`);
      for (const [rel, text] of Object.entries(ex.solution)) fs.writeFileSync(path.join(dir, "bai-tap", ex.id, rel), text);
      const after = await core.gradeExercise(e, dir, ex.id);
      if (!(after.total >= 3 && after.passed === after.total && !after.error)) failures.push(`${ex.id}: lời giải phải đạt hết (${after.passed}/${after.total} ${after.error ?? after.output.slice(-200)})`);
    }
    expect(failures).toEqual([]);
    // không ghi đè bài làm khi bấm "bắt đầu" lần nữa; kết quả được lưu và liệt kê
    const first = EXERCISES[0];
    fs.writeFileSync(path.join(dir, "bai-tap", first.id, Object.keys(first.files).find((f) => f !== first.check)!), "BÀI LÀM CỦA TÔI");
    const again = await core.startExercise(e, dir, first.id);
    expect(again.created).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "bai-tap", first.id, Object.keys(first.files).find((f) => f !== first.check)!), "utf8")).toBe("BÀI LÀM CỦA TÔI");
    const list = await core.listExercises(e, dir);
    expect(list.every((x) => x.started)).toBe(true);
    expect(list.find((x) => x.id === first.id)!.last).toBeTruthy();
    // dự án mẫu: tạo thư mục mới, không đè
    const t1 = await core.createFromTemplate(e, dir, core.listTemplates()[0].id);
    const t2 = await core.createFromTemplate(e, dir, core.listTemplates()[0].id);
    expect(t1.dir).not.toBe(t2.dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 240000);
  it("gợi ý theo bậc không lộ lời giải và không vượt bậc cuối", async () => {
    const core = await import("@neu/agent-core");
    const { EXERCISES } = await import("../../core/src/curriculum");
    for (const ex of EXERCISES) {
      const last = core.exerciseHint(ex.id, 99);
      expect(last.index).toBe(last.total);
      for (const sol of Object.values(ex.solution)) expect(last.text.includes(sol.trim())).toBe(false);
    }
  });
});
