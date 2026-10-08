import { describe, expect, it } from "vitest";
import { KvChatStore, KvProjectHost, LocalController, MemoryEnv, messagesToHistory, PROFILE_ORDER, PROFILES, type Env, type LlmClient, type SessionEvent } from "../src";
import { FakeLlm } from "./helpers";

const kv = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), raw: m };
};

async function setup(profile: "work" | "code" | "design" = "work") {
  const store = kv();
  const envs = new Map<string, MemoryEnv>();
  const host = new KvProjectHost(store, "reg", { id: "default", name: "Mặc định" }, async (info) => {
    const e = new MemoryEnv("/ws", info.id === "default" ? { "README.md": "# mẫu\n" } : {});
    envs.set(info.id, e);
    return e as Env;
  });
  const chats = new KvChatStore(store, "chats");
  const first = (await host.open("default")) as MemoryEnv;
  let saved = {};
  const c = await LocalController.create({
    env: first, profile, realFs: false, projects: host, chats,
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async () => false, setTrusted: async () => undefined },
  });
  const llm = new FakeLlm([{ text: "Xin chào, tôi đã sẵn sàng." }]);
  (c as unknown as { llm: LlmClient }).llm = llm as unknown as LlmClient;
  (c.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
  const events: SessionEvent[] = [];
  c.onEvent((e) => events.push(e));
  return { c, host, chats, llm, events, envs, store };
}

describe("thứ tự tab và hồ sơ Design", () => {
  it("Work đứng trước Code, có thêm Design", () => {
    expect(PROFILE_ORDER).toEqual(["work", "code", "design"]);
    expect(Object.keys(PROFILES).sort()).toEqual(["code", "design", "work"]);
  });
  it("Design: có công cụ Office + file, không có terminal, có lệnh mẫu", async () => {
    const { c } = await setup("design");
    const tools = [...c.currentSession.tools.keys()];
    expect(tools).toContain("write_file");
    expect(tools).toContain("read_document");
    expect(tools).not.toContain("bash");
    expect(tools).not.toContain("run_javascript");
    const st = await c.getState();
    expect(st.commands.map((x) => x.name)).toEqual(expect.arrayContaining(["poster", "landing", "bienthe"]));
    expect(st.allowedModes).toContain("auto");
  });
});

describe("dự án", () => {
  it("tạo dự án mới: thư mục riêng, hướng dẫn thành AGENTS.md và được nạp vào agent", async () => {
    const { c, events, envs } = await setup();
    const r = await c.projectCreate({ name: "Hồ sơ tuyển sinh 2026", instructions: "Luôn xưng hô trang trọng." });
    expect(r).toEqual({ ok: true });
    const st = await c.getState();
    expect(st.projectName).toBe("Hồ sơ tuyển sinh 2026");
    expect(st.memoryFiles).toContain("AGENTS.md");
    expect(st.workspace).toBe("/ws");
    expect(events.some((e) => e.type === "reset")).toBe(true);
    const created = [...envs.values()].find((e) => e !== envs.get("default"))!;
    expect(new TextDecoder().decode(await created.readBytes("/ws/AGENTS.md"))).toContain("trang trọng");
    expect(new TextDecoder().decode(await envs.get("default")!.readBytes("/ws/README.md"))).toBe("# mẫu\n"); // dự án cũ không bị đụng tới
  });
  it("từ chối tên rỗng/trùng; chuyển qua lại giữ nguyên tệp từng dự án", async () => {
    const { c } = await setup();
    expect(await c.projectCreate({ name: "  " })).toHaveProperty("error");
    await c.projectCreate({ name: "A" });
    expect(await c.projectCreate({ name: "a" })).toHaveProperty("error");
    await c.listDir("."); // dự án A rỗng
    expect(await c.listDir(".")).toHaveLength(0);
    const list = (await c.projectsState()).projects;
    const def = list.find((p) => p.id === "default")!;
    await c.projectOpen(def.id);
    expect((await c.listDir(".")).map((e) => e.name)).toEqual(["README.md"]);
  });
  it("xoá dự án chỉ bỏ khỏi danh sách; không xoá dự án cuối cùng", async () => {
    const { c, envs } = await setup();
    expect(await c.projectRemove("default")).toHaveProperty("error"); // chỉ có 1
    await c.projectCreate({ name: "B" });
    const b = (await c.projectsState()).active;
    expect(await c.projectRemove("default")).toEqual({ ok: true });
    expect((await c.projectsState()).projects.map((p) => p.id)).toEqual([b]);
    expect(await envs.get("default")!.stat("/ws/README.md")).toBeTruthy(); // tệp còn nguyên
    expect(await c.projectRemove("../etc")).toHaveProperty("error");
  });
  it("sửa hướng dẫn dự án ghi AGENTS.md và nạp lại ngay", async () => {
    const { c } = await setup();
    await c.instructionsSet("Trả lời ngắn gọn.");
    expect(await c.instructionsGet()).toContain("ngắn gọn");
    expect((await c.getState()).memoryFiles).toContain("AGENTS.md");
    await c.instructionsSet("");
    expect(await c.instructionsGet()).toBe("");
    expect((await c.getState()).memoryFiles).not.toContain("AGENTS.md");
  });
});

describe("lịch sử trò chuyện", () => {
  it("lưu sau mỗi lượt, mở lại để làm tiếp, mỗi dự án một danh sách riêng", async () => {
    const { c, llm } = await setup();
    await c.send("Tóm tắt tài liệu cho tôi");
    const list = await c.chatList();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Tóm tắt tài liệu cho tôi", turns: 1 });
    const firstChat = list[0].id;
    await c.newSession();
    expect((await c.getState()).chatId).not.toBe(firstChat);
    await c.send("Câu hỏi khác");
    expect(await c.chatList()).toHaveLength(2);

    const opened = await c.chatOpen(firstChat);
    if ("error" in opened) throw new Error(opened.error);
    expect(opened.history).toEqual([{ kind: "user", text: "Tóm tắt tài liệu cho tôi" }, { kind: "assistant", text: "Xin chào, tôi đã sẵn sàng." }]);
    await c.send("Tiếp tục nhé");
    const last = llm.calls.at(-1)!.messages.filter((m) => m.role === "user").map((m) => m.content);
    expect(last).toEqual(["Tóm tắt tài liệu cho tôi", "Tiếp tục nhé"]); // ngữ cảnh cũ được khôi phục, không lẫn cuộc khác
    expect((await c.chatList()).find((x) => x.id === firstChat)!.turns).toBe(2);

    await c.projectCreate({ name: "Dự án khác" });
    expect(await c.chatList()).toHaveLength(0);
  });
  it("hiển thị đúng câu người dùng gõ khi dùng lệnh /…, không phải nội dung mẫu đã mở rộng", async () => {
    const { c } = await setup();
    await c.send("/tomtat bao-cao.docx");
    const [meta] = await c.chatList();
    const opened = await c.chatOpen(meta.id);
    if ("error" in opened) throw new Error(opened.error);
    expect(opened.history[0]).toEqual({ kind: "user", text: "/tomtat bao-cao.docx" });
  });
  it("xoá cuộc trò chuyện; xoá cuộc đang mở thì chuyển sang cuộc mới", async () => {
    const { c } = await setup();
    await c.send("một");
    const [m] = await c.chatList();
    await c.chatRemove(m.id);
    expect(await c.chatList()).toHaveLength(0);
    expect((await c.getState()).chatId).not.toBe(m.id);
    expect(await c.chatOpen("khong-co")).toHaveProperty("error");
    expect(await c.chatOpen("../x")).toHaveProperty("error");
  });
  it("giới hạn số cuộc lưu và rút gọn kết quả công cụ dài", async () => {
    const s = new KvChatStore(kv(), "c");
    for (let i = 0; i < 30; i++) await s.save("p", { id: "c" + i, title: "t", updated: i, turns: 1, messages: [] });
    expect(await s.list("p")).toHaveLength(25);
    expect((await s.list("p")).some((x) => x.id === "c0")).toBe(false);
    const h = messagesToHistory([{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] }]);
    expect(h[1]).toEqual({ kind: "tool", name: "read_file", text: "a.txt" });
  });
});
