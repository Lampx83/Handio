import { describe, expect, it } from "vitest";
import { MemoryEnv, ProcessManager } from "../src";
import { serverSlot } from "../src/processes";
import { makeController } from "./helpers";

/** Env giả: spawn chạy mãi tới khi bị stop; ghi lại lệnh nào bị dừng. */
function fakeEnv(root = "/ws") {
  const env = new MemoryEnv(root, { "fe/index.html": "<h1>x</h1>", "be/main.py": "app=1" });
  const stopped: string[] = [];
  const started: string[] = [];
  env.exec = async () => ({ code: 0, output: "", timedOut: false });
  env.spawn = (command, o) => {
    started.push(command);
    const port = /--port[= ](\d+)/.exec(command)?.[1] ?? "5173";
    queueMicrotask(() => o.onData(`Local: http://localhost:${port}/\n`));
    return { stop: () => void stopped.push(command) };
  };
  return { env, stopped, started };
}

describe("frontend và backend chạy song song (lỗi thật từ phiên người dùng: bật backend là frontend chết)", () => {
  it("hai máy chủ ở hai thư mục con khác nhau: cả hai cùng sống", () => {
    const { env, stopped } = fakeEnv();
    const pm = new ProcessManager(env, () => undefined);
    const fe = pm.start("cd fe && npm run dev", "/ws");
    const be = pm.start("cd be && python -m uvicorn main:app --port 8000", "/ws");
    expect(stopped).toEqual([]);
    expect(be.replaced).toBeUndefined();
    expect(pm.get(fe.id)!.info.alive).toBe(true);
    expect(pm.get(be.id)!.info.alive).toBe(true);
  });

  it("cùng thư mục nhưng khác loại (vite và uvicorn): cả hai cùng sống", () => {
    const { env, stopped } = fakeEnv();
    const pm = new ProcessManager(env, () => undefined);
    pm.start("npm run dev", "/ws");
    pm.start("uvicorn main:app --reload", "/ws");
    expect(stopped).toEqual([]);
  });

  it("findRunning không nhầm backend với frontend đang chạy", () => {
    const { env } = fakeEnv();
    const pm = new ProcessManager(env, () => undefined);
    pm.start("cd fe && npm run dev", "/ws");
    expect(pm.findRunning("cd be && python -m uvicorn main:app", "/ws")).toBeUndefined();
    expect(pm.findRunning("cd fe && npm run dev", "/ws")).toBeDefined();
    expect(pm.findRunning("cd fe && npx vite", "/ws")).toBeDefined();
  });

  it("vẫn giữ quy tắc cũ: cùng máy chủ thì thay, không để nhiều cổng 5173–5176", () => {
    const { env, stopped } = fakeEnv();
    const pm = new ProcessManager(env, () => undefined);
    pm.start("cd fe && npm run dev", "/ws");
    const b = pm.start("cd fe && npx vite", "/ws");
    expect(stopped).toEqual(["cd fe && npm run dev"]);
    expect(b.replaced).toBeDefined();
    const c = pm.start("cd ./fe/ && vite --port 5174", "/ws");
    expect(c.replaced).toBeDefined();
  });

  it("cùng loại, cùng thư mục nhưng hai cổng ghi rõ khác nhau: cố ý chạy hai bản, không dừng", () => {
    const { env, stopped } = fakeEnv();
    const pm = new ProcessManager(env, () => undefined);
    pm.start("python -m http.server 8080", "/ws");
    pm.start("python -m http.server 8081", "/ws");
    expect(stopped).toEqual([]);
  });

  it("serverSlot đọc được cd của Windows, --prefix, --cwd, -C", () => {
    const dir = (c: string) => serverSlot(c)?.dir;
    expect(dir('cd /d "exam app\\fe" && npm run dev')).toBe("exam app/fe");
    expect(dir("cd fe; npm run dev")).toBe("fe");
    expect(dir("pushd fe && npm start")).toBe("fe");
    expect(dir("npm --prefix fe run dev")).toBe("fe");
    expect(dir("yarn --cwd fe dev")).toBe("fe");
    expect(dir("pnpm -C fe dev")).toBe("fe");
    expect(dir("npm run dev")).toBe("");
    expect(serverSlot("ls -la")).toBeUndefined();
  });
});

describe("agent bật cả hai máy chủ qua bash", () => {
  it("không dừng cái trước và kết quả cho agent biết cái kia vẫn đang chạy", async () => {
    const { env, stopped, started } = fakeEnv();
    const { c, events } = await makeController(
      [
        { calls: [{ name: "bash", args: { command: "cd fe && npm run dev" } }] },
        { calls: [{ name: "bash", args: { command: "cd be && python -m uvicorn main:app --port 8000" } }] },
        { text: "Xong." },
      ],
      { profile: "code", env, settings: { mode: "bypass" } },
    );
    await c.send("chạy dự án");
    expect(started).toHaveLength(2);
    expect(stopped).toEqual([]);
    const out = (events.filter((e) => e.type === "tool_result" && (e as { name: string }).name === "bash") as unknown as { output: string }[]).map((e) => e.output);
    expect(out[1]).not.toMatch(/KHÔNG khởi động lại|Đã dừng/);
    expect(out[1]).toMatch(/cùng lúc.*cd fe && npm run dev/s);
  });
});
