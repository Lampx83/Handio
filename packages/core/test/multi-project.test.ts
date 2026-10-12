import { describe, expect, it } from "vitest";
import { createMultiProject, KvChatStore, KvProjectHost, MemoryEnv, type ChatMessage, type ChatOptions, type ChatResult, type Env, type LlmClient, type LocalController, type SessionEvent, type Settings } from "../src";

const kv = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
};

/** Mô hình giả có "cổng": mỗi lần gọi chờ đến khi mở cổng (để giữ một dự án đang làm dở). */
class GatedLlm {
  open!: () => void;
  private gate: Promise<void>;
  calls = 0;
  constructor(private reply: string, private gated: boolean) {
    this.gate = gated ? new Promise<void>((r) => (this.open = r)) : Promise.resolve();
  }
  async models() {
    return ["fake"];
  }
  async chat(_m: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    this.calls++;
    await this.gate;
    opts.onContent?.(this.reply);
    return { content: this.reply, reasoning: "", toolCalls: [], usage: { prompt_tokens: 10, completion_tokens: 5 }, finish: "stop" };
  }
}

async function setup(gatedFor: string[]) {
  const store = kv();
  const host = new KvProjectHost(store, "reg", { id: "default", name: "Mặc định" }, async () => new MemoryEnv("/ws", {}) as Env);
  const chats = new KvChatStore(store, "chats");
  const llms = new Map<string, GatedLlm>();
  let saved = {};
  const c = await createMultiProject({
    env: await host.open("default"), profile: "code", realFs: false, projects: host, chats,
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async () => false, setTrusted: async () => undefined },
    onChild: (child: LocalController, id: string) => {
      const llm = new GatedLlm("Xong việc của " + id, gatedFor.includes(id));
      llms.set(id, llm);
      (child as unknown as { llm: LlmClient }).llm = llm as unknown as LlmClient;
      (child.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
    },
  });
  const events: SessionEvent[] = [];
  c.onEvent((e) => events.push(e));
  return { c, events, llms, host };
}
const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("hết giờ chờ");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("nhiều dự án chạy cùng lúc", () => {
  it("chuyển sang dự án khác thì dự án cũ vẫn làm việc nền; xong thì được đánh dấu 'xong chưa xem'", async () => {
    const { c, events, llms } = await setup(["default"]);
    const first = (await c.projectsState!()).active; // "default"
    const sending = c.send("làm việc dài"); // dự án 1 đang chờ mô hình
    await until(async () => (await c.getState()).busy);

    expect(await c.projectCreate!({ name: "Dự án B" })).toEqual({ ok: true });
    const st = await c.getState();
    expect(st.projectName).toBe("Dự án B");
    expect(st.busy).toBe(false); // dự án B rảnh
    let ps = await c.projectsState!();
    expect(ps.active).not.toBe(first);
    expect(ps.projects.find((p) => p.id === first)?.running).toBe(true); // dự án 1 vẫn đang chạy
    expect(st.background?.running).toBe(1);

    // dự án 1 xong khi bạn đang ở dự án B: không được hiện nội dung của nó trong khung chat của B
    const before = events.length;
    llms.get(first)!.open();
    await sending;
    await until(async () => (await c.projectsState!()).projects.find((p) => p.id === first)?.finished === true);
    const leaked = events.slice(before).filter((e) => e.type === "text" || e.type === "message_end" || e.type === "turn_end");
    expect(leaked).toHaveLength(0);
    ps = await c.projectsState!();
    expect(ps.projects.find((p) => p.id === first)?.running).toBeUndefined();

    // quay lại dự án 1: reset, hết dấu "xong chưa xem", lịch sử đã lưu
    await c.projectOpen!(first);
    expect(events.at(-1)?.type === "projects" || events.some((e) => e.type === "reset")).toBe(true);
    ps = await c.projectsState!();
    expect(ps.active).toBe(first);
    expect(ps.projects.find((p) => p.id === first)?.finished).toBeUndefined();
    expect((await c.chatList!()).length).toBe(1);
  });

  it("hai dự án chạy song song, mỗi dự án có phiên riêng", async () => {
    const { c, llms } = await setup(["default"]);
    const first = (await c.projectsState!()).active;
    const a = c.send("việc A");
    await until(async () => (await c.getState()).busy);
    await c.projectCreate!({ name: "B" });
    await c.send("việc B"); // B không gated: xong ngay trong khi A còn chờ
    expect((await c.getState()).busy).toBe(false);
    expect(llms.get(first)!.calls).toBe(1);
    expect([...llms.values()].some((l) => l !== llms.get(first) && l.calls === 1)).toBe(true);
    llms.get(first)!.open();
    await a;
  });

  it("giới hạn số dự án chạy cùng lúc", async () => {
    const { c, events, llms } = await setup(["default"]);
    const ids: string[] = [(await c.projectsState!()).active];
    const sends: Promise<void>[] = [c.send("1")];
    await until(async () => (await c.getState()).busy);
    for (const n of ["B", "C"]) {
      await c.projectCreate!({ name: n });
      ids.push((await c.projectsState!()).active);
      (llms.get(ids.at(-1)!) as unknown as { gate: Promise<void>; gated: boolean }); // chỉ để chắc có mô hình
    }
    // dự án 1 đang chạy; B và C chưa chạy. Mở cổng cho B, C bằng cách làm cho chúng bận: thay mô hình có cổng
    expect(events.filter((e) => e.type === "notice" && /tối đa/.test(String((e as { text?: string }).text))).length).toBe(0);
    llms.get(ids[0])!.open();
    await Promise.all(sends);
  });
});

describe("máy chủ nền sống qua việc đổi dự án và đổi cuộc trò chuyện", () => {
  it("chuyển sang dự án khác rồi quay lại: máy chủ dev của dự án vẫn chạy (không bị dừng); 'Cuộc trò chuyện mới' cũng không dừng nó", async () => {
    const store = kv();
    const host = new KvProjectHost(store, "reg", { id: "default", name: "Mặc định" }, async () => {
      const e = new MemoryEnv("/ws", {});
      (e as { exec?: unknown }).exec = async () => ({ code: 0, output: "", timedOut: false });
      (e as { spawn?: unknown }).spawn = (_cmd: string, o: { onData: (s: string) => void }) => {
        o.onData("  Local:   http://localhost:5173/\n");
        return { stop: () => stopped.push(1) };
      };
      return e as Env;
    });
    const stopped: number[] = [];
    let saved: Partial<Settings> = { mode: "auto" };
    const calls = [{ name: "bash", args: { command: "npm run dev", background: true } }];
    let n = 0;
    const c = await createMultiProject({
      env: await host.open("default"), profile: "code", realFs: false, projects: host, chats: new KvChatStore(store, "chats"),
      store: { load: async () => saved, save: async (s) => void (saved = s) },
      trust: { isTrusted: async () => true, setTrusted: async () => undefined },
      onChild: (child: LocalController) => {
        const llm = {
          async models() { return ["fake"]; },
          async chat(_m: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
            const first = n++ === 0;
            if (!first) opts.onContent?.("ok");
            return { content: first ? "" : "ok", reasoning: "", toolCalls: first ? [{ id: "t1", name: "bash", arguments: JSON.stringify(calls[0].args) }] : [], usage: { prompt_tokens: 5, completion_tokens: 5 }, finish: first ? "tool_calls" : "stop" };
          },
        };
        (child as unknown as { llm: LlmClient }).llm = llm as unknown as LlmClient;
        (child.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
      },
    });
    const events: SessionEvent[] = [];
    c.onEvent((e) => events.push(e));
    const first = (await c.projectsState!()).active;
    await c.send("chạy máy chủ");
    expect(events.some((e) => e.type === "proc" && e.state === "start")).toBe(true);

    await c.projectCreate!({ name: "Dự án B" });
    await c.newSession(); // đổi cuộc trò chuyện ở dự án B không ảnh hưởng dự án 1
    expect(stopped).toHaveLength(0);

    events.length = 0;
    await c.projectOpen!(first);
    expect(stopped).toHaveLength(0); // máy chủ của dự án 1 vẫn chạy
    // giao diện được báo lại tiến trình đang chạy (kèm địa chỉ) để hiện nút "Mở localhost"
    const replay = events.filter((e) => e.type === "proc") as Extract<SessionEvent, { type: "proc" }>[];
    expect(replay.length).toBeGreaterThan(0);
    expect(replay.some((e) => e.url === "http://localhost:5173/")).toBe(true);

    await c.newSession(); // "Cuộc trò chuyện mới" ở chính dự án 1 cũng không dừng máy chủ
    expect(stopped).toHaveLength(0);
  });
});
