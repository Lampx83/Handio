import { describe, expect, it } from "vitest";
import { createMultiProject, describeEvery, dueState, KvChatStore, KvProjectHost, MAX_TASK_CHATS, MemoryEnv, newTask, nextRun, sanitizeEvery, sanitizeTasks, withRun, type ChatMessage, type Env, type LlmClient, type LocalController, type ScheduledTask, type SessionEvent, type Settings, type TaskLock } from "../src";
import { FakeLlm, type Step } from "./helpers";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const MON_8 = at(2026, 10, 19, 8, 0); // thứ Hai
const base = (every: ScheduledTask["every"], createdAt: number): ScheduledTask => ({ id: "t1", name: "n", prompt: "p", every, enabled: true, profile: "code", projectId: "", createdAt });

describe("lịch một lần", () => {
  it("chỉ nhận ngày có thật + giờ HH:MM; không nhận thời điểm đã qua hoặc xa hơn một năm", () => {
    expect(sanitizeEvery({ kind: "once", date: "2026-10-20", at: "09:30" })).toEqual({ kind: "once", date: "2026-10-20", at: "09:30" });
    for (const bad of [{ kind: "once", date: "2026-02-30", at: "09:00" }, { kind: "once", date: "20-10-2026", at: "09:00" }, { kind: "once", date: "2026-10-20" }, { kind: "once", at: "09:00" }, { kind: "once", date: "2026-10-20", at: "9h" }])
      expect(sanitizeEvery(bad), JSON.stringify(bad)).toBeNull();
    const scope = { profile: "code", projectId: "p" };
    expect(newTask({ name: "a", prompt: "b", every: { kind: "once", date: "2026-10-19", at: "07:00" } }, scope, MON_8)).toMatch(/đã qua/);
    expect(newTask({ name: "a", prompt: "b", every: { kind: "once", date: "2028-01-01", at: "07:00" } }, scope, MON_8)).toMatch(/một năm/);
    expect(typeof newTask({ name: "a", prompt: "b", every: { kind: "once", date: "2026-10-19", at: "09:00" } }, scope, MON_8)).toBe("object");
    expect(describeEvery({ kind: "once", date: "2026-10-20", at: "09:30" })).toBe("Một lần 09:30 20/10/2026");
  });

  it("đến giờ thì chạy, chạy xong thì tự tắt; bấm 'Chạy ngay' trước giờ hẹn thì vẫn giữ lịch", () => {
    const t = base({ kind: "once", date: "2026-10-19", at: "10:00" }, MON_8);
    expect(dueState(t, at(2026, 10, 19, 9, 59))).toBeNull();
    expect(dueState(t, at(2026, 10, 19, 10, 1))).toBe("run");
    expect(dueState(t, at(2026, 10, 19, 17, 0))).toBe("missed");
    const early = withRun(t, at(2026, 10, 19, 9, 0), { status: "ok", summary: "" }, true);
    expect(early.enabled).toBe(true);
    expect(dueState(early, at(2026, 10, 19, 10, 1))).toBe("run");
    const ran = withRun(t, at(2026, 10, 19, 10, 1), { status: "ok", summary: "" }, true);
    expect(ran.enabled).toBe(false);
    expect(dueState({ ...ran, enabled: true }, at(2026, 10, 19, 11, 0))).toBeNull(); // bật lại cũng không chạy lần nữa
    expect(nextRun(ran, at(2026, 10, 19, 11, 0))).toBeUndefined();
  });

  it("nextRun: lần chạy tới của từng loại lịch", () => {
    expect(nextRun(base({ kind: "minutes", n: 60 }, MON_8), MON_8)).toBe(MON_8 + 3600_000);
    expect(nextRun(base({ kind: "daily", at: "08:00" }, MON_8), MON_8 + 1000)).toBe(at(2026, 10, 20, 8, 0));
    expect(nextRun(base({ kind: "daily", at: "09:00" }, MON_8), MON_8)).toBe(at(2026, 10, 19, 9, 0));
    expect(nextRun(base({ kind: "weekly", day: 3, at: "08:00" }, MON_8), MON_8)).toBe(at(2026, 10, 21, 8, 0));
    expect(nextRun(base({ kind: "once", date: "2026-10-25", at: "08:00" }, MON_8), MON_8)).toBe(at(2026, 10, 25, 8, 0));
    expect(nextRun({ ...base({ kind: "daily", at: "08:00" }, MON_8), enabled: false }, MON_8)).toBeUndefined();
  });

  it("sanitizeTasks giữ số thao tác bị từ chối và mã cuộc trò chuyện hợp lệ", () => {
    const t = { ...base({ kind: "daily", at: "07:30" }, 1), lastRun: { at: 5, status: "ok", summary: "x", denied: 3, chatId: "abc" } };
    expect(sanitizeTasks([t])[0].lastRun).toEqual({ at: 5, status: "ok", summary: "x", denied: 3, chatId: "abc" });
    const bad = { ...t, lastRun: { ...t.lastRun, denied: -1, chatId: "../x" } };
    expect(sanitizeTasks([bad])[0].lastRun).toEqual({ at: 5, status: "ok", summary: "x" });
  });
});

const kv = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
};

/** Mô hình giả: lượt đầu ghi tệp `out` (nếu có), lượt sau trả báo cáo. Có thể giữ lại bằng `gate`. */
const writer = (out: string | null, report = "Đã xong.") => (messages: ChatMessage[]): Step =>
  out && messages.at(-1)?.role !== "tool" ? { calls: [{ name: "write_file", args: { path: out, content: "kết quả " + messages.length } }] } : { text: report };

async function setup(o: { script?: ConstructorParameters<typeof FakeLlm>[0]; lock?: TaskLock; canRun?: () => boolean; settings?: Partial<Settings>; gate?: Promise<void> } = {}) {
  const store = kv();
  const envs = new Map<string, MemoryEnv>();
  const host = new KvProjectHost(store, "reg", { id: "default", name: "Mặc định" }, async (info) => {
    const e = new MemoryEnv("/ws", { "README.md": "# " + info.name + "\n" });
    envs.set(info.id, e);
    return e as Env;
  });
  // dự án B có trong danh sách nhưng chưa từng mở trong phiên này
  const b = (await host.create({ name: "B" })).info.id;
  await host.open("default");
  const chats = new KvChatStore(store, "chats");
  const clock = { now: MON_8 };
  let saved: Partial<Settings> = { ...o.settings };
  const llm = new FakeLlm(o.script ?? writer("bao-cao.md"));
  if (o.gate) {
    const chat = llm.chat.bind(llm);
    llm.chat = async (m, opts) => (await o.gate, chat(m, opts));
  }
  const created: string[] = [];
  const c = await createMultiProject({
    env: await host.open("default"), profile: "code", realFs: false, projects: host, chats,
    tasks: { enabled: true, background: true, now: () => clock.now, tickMs: 1e9, lock: o.lock, canRun: o.canRun },
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    onChild: (child: LocalController, id: string) => {
      created.push(id);
      (child as unknown as { llm: LlmClient }).llm = llm as unknown as LlmClient;
      (child.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
    },
  });
  const events: SessionEvent[] = [];
  c.onEvent((e) => {
    events.push(e);
    if (e.type === "permission") c.respondPermission(e.request.id, { allow: true }); // người dùng (phiên thường) đồng ý; phiên tác vụ không bao giờ hỏi
  });
  /** Thêm tác vụ cho dự án `projectId` (như khi người dùng đã tạo nó lúc mở dự án đó). */
  const addTask = (projectId: string, every: ScheduledTask["every"] = { kind: "minutes", n: 60 }, name = "Báo cáo") => {
    const t = newTask({ name, prompt: "Viết báo cáo", every }, { profile: "code", projectId }, clock.now) as ScheduledTask;
    saved = { ...saved, tasks: [...((saved.tasks as ScheduledTask[] | undefined) ?? []), t] };
    return t.id;
  };
  const tasks = () => (saved.tasks as ScheduledTask[] | undefined) ?? [];
  return { c, host, chats, clock, llm, events, envs, created, b, addTask, tasks, settings: () => saved };
}

describe("bộ lập lịch cấp ứng dụng (Desktop): chạy cả dự án chưa mở", () => {
  it("tác vụ của dự án chưa mở vẫn chạy: không đổi dự án đang mở, mở tạm rồi đóng lại, ghi kết quả", async () => {
    const { c, host, clock, llm, envs, created, b, addTask, tasks, events } = await setup();
    addTask(b);
    clock.now += 61 * 60_000;
    await c.tasksTick!();
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(await envs.get(b)!.readBytes("/ws/bao-cao.md"))).toContain("kết quả");
    expect(await envs.get("default")!.stat("/ws/bao-cao.md")).toBeNull();
    expect((await host.list()).active).toBe("default");
    expect((await c.projectsState!()).active).toBe("default");
    expect(created.filter((x) => x === b)).toHaveLength(1);
    expect(tasks()[0].lastRun).toMatchObject({ status: "ok", summary: expect.stringContaining("Đã xong.") });
    // sự kiện "xong" đi qua cả khi dự án không mở; không chứa kết quả
    const done = events.find((e) => e.type === "task_done");
    expect(done).toMatchObject({ type: "task_done", projectId: b, name: "Báo cáo", status: "ok", notify: true });
    expect(JSON.stringify(done)).not.toContain("Đã xong");
    // bộ điều khiển tạm đã đóng: lần chạy sau mở lại một bộ mới
    clock.now += 61 * 60_000;
    await c.tasksTick!();
    expect(created.filter((x) => x === b)).toHaveLength(2);
    c.dispose();
  });

  it("lưu mỗi lần chạy thành cuộc trò chuyện '⏰ tên' trong lịch sử dự án, giữ có giới hạn", async () => {
    const { c, chats, clock, b, addTask, tasks } = await setup();
    addTask(b, { kind: "minutes", n: 30 });
    for (let i = 0; i < MAX_TASK_CHATS + 2; i++) {
      clock.now += 31 * 60_000;
      await c.tasksTick!();
    }
    const list = await chats.list(b);
    expect(list).toHaveLength(MAX_TASK_CHATS);
    expect(list.every((m) => m.title === "⏰ Báo cáo" && m.task === tasks()[0].id)).toBe(true);
    const chatId = tasks()[0].lastRun!.chatId!;
    expect(list.map((m) => m.id)).toContain(chatId);
    // mở dự án B và xem lại lần chạy: thấy đúng việc người dùng giao (không lộ câu dặn nội bộ) và các bước agent đã làm
    await c.projectOpen!(b);
    const r = await c.chatOpen(chatId);
    if ("error" in r) throw new Error(r.error);
    expect(r.history[0]).toEqual({ kind: "user", text: "Viết báo cáo" });
    expect(r.history.some((x) => x.kind === "tool" && x.name === "write_file")).toBe(true);
    // nhắn tiếp trong cuộc trò chuyện đó: giữ tiêu đề, thành cuộc trò chuyện thường (không bị dọn cùng các lần chạy)
    await c.send("Thêm phần kết luận");
    const meta = (await chats.list(b)).find((m) => m.id === chatId)!;
    expect(meta.title).toBe("⏰ Báo cáo");
    expect(meta.task).toBeUndefined();
    c.dispose();
  });

  it("người dùng mở dự án đúng lúc tác vụ đang chạy ở đó: dùng lại bộ điều khiển, không đóng nó sau khi xong", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { c, clock, created, b, addTask, tasks } = await setup({ script: writer(null), gate });
    addTask(b);
    clock.now += 61 * 60_000;
    const tick = c.tasksTick!();
    await new Promise((r) => setTimeout(r, 20));
    await c.projectOpen!(b);
    expect((await c.taskList!())[0].running).toBe(true);
    open();
    await tick;
    expect(created.filter((x) => x === b)).toHaveLength(1);
    expect((await c.getState()).projectId).toBe(b);
    expect(tasks()[0].lastRun?.status).toBe("ok");
    expect((await c.taskList!())[0].running).toBeUndefined();
    c.dispose();
  });

  it("lịch một lần: chạy đúng một lần rồi tự tắt", async () => {
    const { c, clock, llm, b, addTask, tasks } = await setup({ script: writer(null) });
    addTask(b, { kind: "once", date: "2026-10-19", at: "09:00" });
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(0);
    clock.now = at(2026, 10, 19, 9, 0, ) + 30_000;
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ enabled: false, lastRun: { status: "ok" } });
    clock.now += 3600_000;
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(1);
    c.dispose();
  });

  it("bỏ lỡ giờ hẹn ở dự án chưa mở: ghi 'bỏ lỡ', không mở dự án, không gọi mô hình", async () => {
    const { c, clock, llm, created, b, addTask, tasks } = await setup();
    addTask(b, { kind: "daily", at: "08:30" });
    clock.now = at(2026, 10, 19, 20, 0);
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(0);
    expect(created).not.toContain(b);
    expect(tasks()[0].lastRun).toMatchObject({ status: "skipped", summary: expect.stringContaining("Bỏ lỡ") });
    c.dispose();
  });

  it("khoá dùng chung giữa các tab: đang có tác vụ khác chạy thì đợi; chưa đăng nhập thì không chạy", async () => {
    const lock: TaskLock = { held: true };
    let signedIn = false;
    const { c, clock, llm, b, addTask } = await setup({ lock, canRun: () => signedIn });
    addTask(b);
    clock.now += 61 * 60_000;
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(0);
    signedIn = true;
    await c.tasksTick!();
    expect(llm.calls).toHaveLength(0); // tab khác đang giữ khoá
    lock.held = false;
    await c.tasksTick!();
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(lock.held).toBe(false); // nhả khoá sau khi xong
    c.dispose();
  });

  it("tắt thông báo hệ thống: sự kiện vẫn có (để giao diện cập nhật) nhưng notify = false; 'Chạy ngay' không bao giờ báo", async () => {
    const { c, clock, events, addTask } = await setup({ script: writer(null) });
    expect(await c.taskNotify!()).toBe(true);
    expect(await c.taskNotify!(false)).toBe(false);
    const id = addTask("default");
    clock.now += 61 * 60_000;
    await c.tasksTick!();
    expect(events.filter((e) => e.type === "task_done").map((e) => (e as { notify: boolean }).notify)).toEqual([false]);
    await c.taskNotify!(true);
    await c.taskRunNow!(id);
    expect(events.filter((e) => e.type === "task_done").map((e) => (e as { notify: boolean }).notify)).toEqual([false, false]);
    c.dispose();
  });

  it("bỏ dự án khỏi danh sách thì tác vụ của nó cũng bị xoá", async () => {
    const { c, b, addTask, tasks } = await setup();
    addTask(b);
    addTask("default");
    expect((await c.projectRemove!(b))).toEqual({ ok: true });
    expect(tasks().map((t) => t.projectId)).toEqual(["default"]);
    c.dispose();
  });
});

describe("đang chạy, dừng, hoàn tác lần chạy", () => {
  it("đang chạy: danh sách hiện 'đang chạy', người dùng nhắn thì được báo đợi, bấm Dừng thì dừng", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { c, events, addTask, tasks } = await setup({ script: writer(null), gate });
    const id = addTask("default");
    const run = c.taskRunNow!(id);
    await new Promise((r) => setTimeout(r, 20));
    expect((await c.taskList!())[0].running).toBe(true);
    await c.send("việc khác");
    expect(events.some((e) => e.type === "notice" && /Tác vụ định kỳ đang chạy/.test(e.text))).toBe(true);
    await c.taskStop!();
    open();
    expect(await run).toMatchObject({ status: "error", summary: "Bị dừng." });
    expect((await c.taskList!())[0].running).toBeUndefined();
    expect(tasks()[0].lastRun?.status).toBe("error");
    c.dispose();
  });

  it("hoàn tác lần chạy: tệp mới bị xoá, tệp sửa về như cũ; tệp người dùng sửa lại sau đó thì giữ nguyên", async () => {
    const script = (_m: ChatMessage[], n: number): Step =>
      n === 0 ? { calls: [{ name: "read_file", args: { path: "README.md" } }] }
        : n === 1 ? { calls: [{ name: "write_file", args: { path: "moi.md", content: "mới" } }, { name: "write_file", args: { path: "README.md", content: "# đã sửa\n" } }, { name: "write_file", args: { path: "ghi-chu.md", content: "agent" } }] }
        : { text: "Xong." };
    const { c, envs, addTask } = await setup({ script });
    const env = envs.get("default")!;
    const id = addTask("default");
    await c.taskRunNow!(id);
    const t = (await c.taskList!())[0];
    expect(t.canUndo).toBe(true);
    expect(t.lastRun?.denied).toBeUndefined();
    await env.writeText("/ws/ghi-chu.md", "người dùng sửa sau"); // người dùng sửa lại sau lần chạy
    const r = await c.taskUndo!(id);
    if ("error" in r) throw new Error(r.error);
    expect(r.reverted.sort()).toEqual(["README.md", "moi.md"]);
    expect(r.skipped).toEqual(["ghi-chu.md"]);
    expect(await env.stat("/ws/moi.md")).toBeNull();
    expect(new TextDecoder().decode(await env.readBytes("/ws/README.md"))).toBe("# Mặc định\n");
    expect(new TextDecoder().decode(await env.readBytes("/ws/ghi-chu.md"))).toBe("người dùng sửa sau");
    expect((await c.taskList!())[0].canUndo).toBeUndefined();
    expect(await c.taskUndo!(id)).toHaveProperty("error");
    c.dispose();
  });

  it("hoàn tác không đụng tới tệp nhạy cảm và không dùng được cho dự án khác", async () => {
    const script = (messages: ChatMessage[]): Step => (messages.at(-1)?.role !== "tool" ? { calls: [{ name: "write_file", args: { path: "a.md", content: "x" } }, { name: "write_file", args: { path: ".env", content: "K=1" } }] } : { text: "Xong." });
    const { c, b, envs, addTask, clock } = await setup({ script });
    const id = addTask(b);
    clock.now += 61 * 60_000;
    await c.tasksTick!();
    expect(await envs.get(b)!.stat("/ws/.env")).toBeNull(); // tệp nhạy cảm bị từ chối ngay khi chạy
    expect(await c.taskUndo!(id)).toHaveProperty("error"); // đang mở dự án mặc định
    await c.projectOpen!(b);
    const v = (await c.taskList!())[0];
    expect(v).toMatchObject({ canUndo: true, lastRun: { denied: 1 } });
    const r = await c.taskUndo!(id);
    expect(r).toEqual({ reverted: ["a.md"], skipped: [] });
    c.dispose();
  });
});
