import { describe, expect, it } from "vitest";
import { MemoryEnv, office, PROFILES } from "../src";
import { SEED, makeController } from "./helpers";

const withExec = () => {
  const env = new MemoryEnv("/ws", { ...SEED });
  env.exec = async () => ({ code: 0, output: "", timedOut: false });
  env.runJs = async () => ({ ok: true, logs: [] });
  env.fetchUrl = async () => "x";
  return env;
};
const toolNames = (c: Awaited<ReturnType<typeof makeController>>["c"]) => [...c.currentSession.tools.keys()].sort();

describe("hồ sơ Code / Work", () => {
  it("Code có bash/JS/web; Work có công cụ văn phòng và KHÔNG có bash/JS", async () => {
    const code = await makeController([{ text: "ok" }], { env: withExec(), profile: "code" });
    const work = await makeController([{ text: "ok" }], { env: withExec(), profile: "work" });
    expect(toolNames(code.c)).toEqual(expect.arrayContaining(["bash", "run_javascript", "web_fetch", "edit_file"]));
    expect(toolNames(code.c)).not.toContain("create_docx");
    expect(toolNames(work.c)).toEqual(expect.arrayContaining(["read_document", "find_in_documents", "create_docx", "docx_replace", "create_xlsx", "xlsx_edit", "create_pptx", "web_fetch", "write_file"]));
    expect(toolNames(work.c)).not.toContain("bash");
    expect(toolNames(work.c)).not.toContain("run_javascript");
  });
  it("prompt, gợi ý, lệnh slash, chế độ riêng theo hồ sơ", async () => {
    const work = await makeController([{ text: "ok" }], { profile: "work" });
    await work.c.send("xin chào");
    const sys = String(work.llm.calls[0].messages[0].content);
    expect(sys).toContain("(Work mode)");
    expect(sys).toContain("EDIT IN PLACE");
    expect(sys).toContain("ASK FIRST, THEN BUILD");
    const st = await work.c.getState();
    expect(st.profile).toBe("work");
    expect(st.allowedModes).toEqual(["default", "acceptEdits", "auto", "plan", "bypass"]);
    expect(st.commands.map((c) => c.name)).toEqual(expect.arrayContaining(["tomtat", "soanthao", "bangtinh", "trinhchieu", "rasoat", "congvan", "hopdong", "email"]));
    expect(st.commands.map((c) => c.name)).not.toContain("fix-tests");
    expect(st.suggestions).toEqual(PROFILES.work.suggestions);
    const code = await makeController([{ text: "ok" }], { profile: "code" });
    expect((await code.c.getState()).commands.map((c) => c.name)).toEqual(expect.arrayContaining(["init", "vibe", "review", "fix-tests"]));
    expect((await code.c.getState()).allowedModes).toContain("bypass");
  });
  it("Work chọn được Toàn quyền trong phiên; chính sách quản trị có thể cấm", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "work", settings: { mode: "auto" } });
    expect((await c.getState()).mode).toBe("auto");
    await c.setMode("bypass");
    expect((await c.getState()).mode).toBe("bypass");
    await c.send("/mode auto");
    expect((await c.getState()).mode).toBe("auto");
  });
  it("lệnh /tomtat chạy như một lượt chat với nội dung đã mở rộng", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "work" });
    await c.send("/tomtat bao-cao.docx");
    expect(String(llm.calls[0].messages.at(-1)!.content)).toContain("bao-cao.docx");
    expect(String(llm.calls[0].messages.at(-1)!.content)).toContain("read_document");
  });
  it("tác vụ Work đầu-cuối: đọc Excel → tạo Word, có hỏi quyền kèm bản mô tả (outline)", async () => {
    const env = new MemoryEnv("/ws", {});
    await env.writeBytes("/ws/diem.xlsx", (await office.createXlsx([{ name: "Điểm", rows: [["Tên", "Điểm"], ["An", 8], ["Bình", 6]] }])).bytes);
    const { c, requests, events } = await makeController(
      [
        { calls: [{ name: "read_document", args: { path: "diem.xlsx" } }] },
        { calls: [{ name: "create_docx", args: { path: "bao-cao.docx", title: "BÁO CÁO", content: "## Kết quả\n\n| Tên | Điểm |\n|---|---|\n| An | 8 |\n| Bình | 6 |" } }] },
        { calls: [{ name: "read_document", args: { path: "bao-cao.docx" } }] },
        { text: "Đã tạo bao-cao.docx." },
      ],
      { env, profile: "work" },
    );
    await c.send("làm báo cáo từ file điểm");
    expect(requests.map((r) => r.tool)).toEqual(["create_docx"]); // đọc thì không hỏi, ghi thì hỏi
    expect(requests[0].preview!.outline).toContain("1 bảng");
    expect(requests[0].preview!.diff).toEqual([]);
    const last = events.filter((e: any) => e.type === "tool_result").at(-1) as any;
    expect(last.output).toContain("| An | 8 |");
    expect(await env.stat("/ws/bao-cao.docx")).toBeTruthy();
  });
  it("hoàn tác (/undo) khôi phục cả file nhị phân", async () => {
    const env = new MemoryEnv("/ws", {});
    const orig = (await office.createXlsx([{ name: "S", rows: [["a"], [1]] }])).bytes;
    await env.writeBytes("/ws/d.xlsx", orig);
    const { c } = await makeController(
      [{ calls: [{ name: "read_document", args: { path: "d.xlsx" } }] }, { calls: [{ name: "xlsx_edit", args: { path: "d.xlsx", set: { A2: 99 } } }] }, { text: "ok" }],
      { env, profile: "work", settings: { mode: "acceptEdits" } },
    );
    await c.send("sửa");
    expect(await env.readBytes("/ws/d.xlsx")).not.toEqual(orig);
    await c.send("/undo");
    expect(await env.readBytes("/ws/d.xlsx")).toEqual(orig);
  });
  it("quy tắc deny áp dụng cho đích thật sự của save_as", async () => {
    const env = new MemoryEnv("/ws", {});
    await env.writeBytes("/ws/d.xlsx", (await office.createXlsx([{ name: "S", rows: [["a"], [1]] }])).bytes);
    const { c, events } = await makeController(
      [{ calls: [{ name: "read_document", args: { path: "d.xlsx" } }] }, { calls: [{ name: "xlsx_edit", args: { path: "d.xlsx", set: { A2: 2 }, save_as: ".neuagent/settings.json" } }] }, { text: "ok" }],
      { env, profile: "work", settings: { mode: "acceptEdits", permissions: { allow: [], deny: ["xlsx_edit(secret/**)"] } } },
    );
    await c.send("x");
    // đích là file cấu hình dự án: phải hỏi (không tự duyệt dù acceptEdits); mặc định helper cho phép nên công cụ báo lỗi đuôi file
    expect(events.some((e: any) => e.type === "permission" && e.request.note)).toBe(true);
  });
});

describe("tải lên / tải xuống / zip", () => {
  it("tải lên làm sạch tên, chống trùng, giới hạn kích thước, và phát files_changed", async () => {
    const { c, env, events } = await makeController([{ text: "ok" }], { profile: "work" });
    const enc = (s: string) => new TextEncoder().encode(s);
    const r = await c.uploadFiles([{ name: "../../etc/passwd", data: enc("x") }, { name: "bao cao.docx", data: enc("a") }, { name: "bao cao.docx", data: enc("b") }, { name: "..", data: enc("z") }, { name: "co:lon?.txt", data: enc("t") }]);
    expect(r.saved).toEqual(["passwd", "bao cao.docx", "bao cao (2).docx", "co_lon_.txt"]);
    expect(r.errors).toHaveLength(1);
    expect(Object.keys(env.snapshot())).toEqual(expect.arrayContaining(["/ws/passwd", "/ws/bao cao.docx", "/ws/bao cao (2).docx"]));
    expect(events.some((e: any) => e.type === "files_changed" && e.paths.length === 4)).toBe(true);
    const big = await c.uploadFiles([{ name: "to.bin", data: new Uint8Array(51 * 1024 * 1024) }]);
    expect(big.saved).toEqual([]);
    expect(big.errors[0]).toContain("quá lớn");
  });
  it("tải xuống đúng nội dung, chặn đường dẫn ngoài thư mục; nén zip toàn bộ", async () => {
    const { c } = await makeController([{ text: "ok" }]);
    const d = await c.downloadFile("hello.py");
    expect("data" in d && new TextDecoder().decode(d.data)).toContain("def greet");
    expect(await c.downloadFile("../x")).toHaveProperty("error");
    const z = await c.exportZip();
    expect(z.name).toBe("ws.zip");
    const zip = await office.loadZip(z.data);
    expect(Object.keys(zip.files).sort()).toEqual([".env", "README.md", "hello.py", "src/", "src/util.py"].sort().filter((n) => zip.files[n]));
    expect(await zip.file("src/util.py")!.async("string")).toContain("def add");
  });
  it("xem trước tệp Office bằng chữ trích xuất", async () => {
    const env = new MemoryEnv("/ws", {});
    await env.writeBytes("/ws/t.docx", await office.createDocx({ content: "# Xin chào\n\nNội dung." }));
    const { c } = await makeController([{ text: "ok" }], { env, profile: "work" });
    const r = await c.readFile("t.docx");
    expect("text" in r && r.kind).toBe("document");
    expect("text" in r && r.text).toContain("# Xin chào");
  });
});

describe("chính sách quản trị", () => {
  const mk = async (policy: any, settings: any = {}, profile: "code" | "work" = "code") => {
    const { LocalController, MemoryEnv } = await import("../src");
    let saved: any = settings;
    const env = new MemoryEnv("/w", {});
    env.exec = async () => ({ code: 0, output: "", timedOut: false });
    return LocalController.create({ env, profile, policy, defaults: { baseUrl: "https://default.example/v1" }, realFs: false, store: { load: async () => saved, save: async (s) => void (saved = s) }, trust: { isTrusted: async () => false, setTrusted: async () => undefined } });
  };
  it("khoá địa chỉ API và HTTP: người dùng không đổi được", async () => {
    const c = await mk({ baseUrl: "https://locked.example/v1/", allowInsecureHttp: false }, { baseUrl: "http://evil.example/v1", allowInsecureHttp: true });
    let st = await c.getState();
    expect(st.settings.baseUrl).toBe("https://locked.example/v1");
    expect(st.settings.allowInsecureHttp).toBe(false);
    expect(st.policy).toMatchObject({ baseUrl: true, insecureHttp: true });
    await c.saveSettings({ baseUrl: "http://evil.example/v1", allowInsecureHttp: true, model: "m2" });
    st = await c.getState();
    expect(st.settings.baseUrl).toBe("https://locked.example/v1");
    expect(st.settings.allowInsecureHttp).toBe(false);
    expect(st.settings.model).toBe("m2"); // trường không bị khoá vẫn đổi được
  });
  it("cấm bypass và tắt bash theo chính sách", async () => {
    const c = await mk({ allowBypass: false, disableBash: true }, { mode: "bypass" });
    const st = await c.getState();
    expect(st.allowedModes).not.toContain("bypass");
    expect(st.mode).toBe("auto");
    expect(st.capabilities.exec).toBe(true); // môi trường có exec nhưng công cụ bị gỡ
    expect([...c.currentSession.tools.keys()]).not.toContain("bash");
    await c.setMode("bypass");
    expect((await c.getState()).mode).toBe("auto");
  });
  it("mặc định của bản phát hành áp dụng khi người dùng chưa đặt; parsePolicy lọc dữ liệu lạ", async () => {
    const { parsePolicy } = await import("../src");
    expect((await (await mk(undefined)).getState()).settings.baseUrl).toBe("https://default.example/v1");
    expect(parsePolicy({ baseUrl: "javascript:alert(1)", allowBypass: "yes", disableBash: true, evil: 1, notice: "x".repeat(900) })).toEqual({ disableBash: true, notice: "x".repeat(500) });
  });
});
