import { describe, expect, it } from "vitest";
import { MemoryEnv } from "../src";
import { makeController } from "./helpers";

const results = (events: { type: string }[]) => (events.filter((e) => e.type === "tool_result") as unknown as { output: string; ok: boolean }[]).map((e) => e.output);
/** Cái mô hình nhìn thấy (kết quả công cụ kèm lời cảnh báo được gắn thêm). */
const seen = (llm: { calls: { messages: { content?: unknown }[] }[] }) => llm.calls.flatMap((x) => x.messages).map((m) => String(m.content ?? "")).join("\n");
const notices = (events: { type: string }[]) => (events.filter((e) => e.type === "notice") as unknown as { text: string }[]).map((e) => e.text);

describe("phát hiện kẹt theo (thao tác, kết quả) — không cần liền nhau", () => {
  it("cùng lệnh, cùng kết quả xen giữa các lệnh khác: nhắc ở lần 3, dừng ở lần 4", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "1", "b.txt": "2", "c.txt": "3" });
    env.exec = async () => ({ code: 1, output: "Error: Cannot find module 'x'\n[mã thoát 1]", timedOut: false });
    const others = ["a.txt", "b.txt", "c.txt", "a.txt", "b.txt"];
    const { c, llm, events } = await makeController(
      (_m, n) => (n < 30 ? (n % 2 === 0 ? { calls: [{ name: "bash", args: { command: "node app.js" } }] } : { calls: [{ name: "read_file", args: { path: others[(n >> 1) % others.length] } }] }) : { text: "xong" }),
      { profile: "code", env },
    );
    await c.send("chạy app");
    expect(llm.calls.length).toBeLessThan(12);
    expect(seen(llm)).toMatch(/Lần thứ 3 bạn làm đúng thao tác này/);
    expect(notices(events).some((t) => /cho cùng một kết quả nên đã dừng/.test(t))).toBe(true);
  });

  it("có sửa tệp giữa các lần chạy thì không coi là kẹt (chạy lại sau khi sửa là chính đáng)", async () => {
    const env = new MemoryEnv("/ws", { "app.js": "x" });
    env.exec = async () => ({ code: 1, output: "Error: boom\n[mã thoát 1]", timedOut: false });
    const steps = [];
    for (let i = 0; i < 5; i++) {
      steps.push({ calls: [{ name: "bash", args: { command: "node app.js" } }] });
      steps.push({ calls: [{ name: "write_file", args: { path: `fix${i}.js`, content: "v" + i } }] });
    }
    steps.push({ text: "xong" });
    const { c, events } = await makeController(steps, { profile: "code", env, settings: { mode: "auto" } as never });
    await c.send("sửa cho chạy");
    expect(notices(events).some((t) => /nên đã dừng/.test(t))).toBe(false);
  });
});

describe("lỗi liên tiếp ở nhiều công cụ khác nhau", () => {
  it("nhắc ở lần 4, dừng và hỏi người dùng ở lần 6", async () => {
    const paths = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"];
    const { c, llm, events } = await makeController(
      (_m, n) => (n < 20 ? { calls: [{ name: n % 2 ? "read_file" : "list_dir", args: { path: "khong-co/" + paths[n % paths.length] } }] } : { text: "xong" }),
      { profile: "code" },
    );
    await c.send("đọc giúp");
    expect(seen(llm)).toMatch(/4 thao tác liên tiếp đều lỗi/);
    expect(notices(events).some((t) => /gặp lỗi 6 lần liên tiếp nên đã dừng để hỏi bạn/.test(t))).toBe(true);
    expect(llm.calls.length).toBeLessThan(10);
  });
});

describe("máy chủ dev: tự chạy nền, không khởi động lại khi mã chưa đổi", () => {
  const mkEnv = () => {
    const env = new MemoryEnv("/ws", { "package.json": "{}", "src/a.js": "1" });
    const spawned: string[] = [];
    const stops: string[] = [];
    env.exec = async () => ({ code: 0, output: "", timedOut: false });
    env.spawn = (cmd, o) => {
      spawned.push(cmd);
      setTimeout(() => o.onData("  ➜  Local:   http://localhost:5173/\n"), 10);
      return { stop: () => stops.push(cmd) };
    };
    return { env, spawned, stops };
  };

  it("gọi `npm run dev` không có background thì tự chạy nền (không treo tới hết giờ)", async () => {
    const { env, spawned } = mkEnv();
    const { c, events } = await makeController([{ calls: [{ name: "bash", args: { command: "npm run dev" } }] }, { text: "xong" }], { profile: "code", env, settings: { mode: "auto" } as never });
    await c.send("chạy");
    expect(spawned).toEqual(["npm run dev"]);
    expect(results(events)[0]).toMatch(/tự chuyển sang chạy nền/);
    expect(results(events)[0]).toMatch(/id=p1/);
  });

  it("chạy lại khi chưa đổi tệp: giữ máy chủ cũ; đổi tệp rồi chạy lại: khởi động lại", async () => {
    const { env, spawned, stops } = mkEnv();
    const { c, events } = await makeController(
      [
        { calls: [{ name: "bash", args: { command: "npm run dev", background: true } }] },
        { calls: [{ name: "bash", args: { command: "npm run dev", background: true } }] },
        { calls: [{ name: "write_file", args: { path: "vite.config.js", content: "export default {}" } }] },
        { calls: [{ name: "bash", args: { command: "npm run dev", background: true } }] },
        { text: "xong" },
      ],
      { profile: "code", env, settings: { mode: "auto" } as never },
    );
    await c.send("chạy");
    const r = results(events);
    expect(r[1]).toMatch(/đã đang chạy \(id=p1/);
    expect(r[1]).toMatch(/KHÔNG khởi động lại/);
    expect(spawned).toEqual(["npm run dev", "npm run dev"]); // lần 2 không khởi động; lần 3 (sau khi sửa) có
    expect(stops).toEqual(["npm run dev"]);
  });

  it("lệnh dựng/kiểm thử không bị coi là máy chủ", async () => {
    const { isLongRunning } = await import("../src/processes");
    expect(isLongRunning("npm run dev")).toBe(true);
    expect(isLongRunning("cd app && npx vite")).toBe(true);
    expect(isLongRunning("streamlit run app.py")).toBe(true);
    expect(isLongRunning("npm run build")).toBe(false);
    expect(isLongRunning("vite build")).toBe(false);
    expect(isLongRunning("pkill -f vite")).toBe(false);
    expect(isLongRunning("npm test")).toBe(false);
  });
});
