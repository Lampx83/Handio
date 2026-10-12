import { describe, expect, it } from "vitest";
import { installPitfall } from "../src/pitfalls";
import { MemoryEnv } from "../src";
import { makeController } from "./helpers";

describe("bẫy phiên bản khi cài gói", () => {
  it("chặn cài Chakra UI không ghi phiên bản (sẽ ra v3), cho qua khi ghi rõ phiên bản", () => {
    expect(installPitfall("npm install @chakra-ui/react @emotion/react @emotion/styled framer-motion")).toMatch(/@chakra-ui\/react@2/);
    expect(installPitfall("cd app && npm i @chakra-ui/react")).toMatch(/v3/);
    expect(installPitfall("pnpm add @chakra-ui/react framer-motion")).not.toBeNull();
    expect(installPitfall("npm install @chakra-ui/react@2 @emotion/react")).toBeNull();
    expect(installPitfall("npm install @chakra-ui/react@^2.10.0")).toBeNull();
    expect(installPitfall("npm install @chakra-ui/react@3")).toBeNull();
    expect(installPitfall("npm install @chakra-ui/react-use-disclosure")).toBeNull(); // gói khác
    expect(installPitfall("npm run build")).toBeNull();
    expect(installPitfall("grep chakra-ui/react package.json")).toBeNull(); // không phải lệnh cài
  });

  it("công cụ bash: lệnh cài mơ hồ KHÔNG được chạy và agent nhận lời giải thích để chọn lại", async () => {
    const ran: string[] = [];
    const env = new MemoryEnv("/ws", { "package.json": "{}" });
    env.exec = async (cmd: string) => (ran.push(cmd), { code: 0, output: "ok", timedOut: false });
    const { c, events } = await makeController([
      { calls: [{ name: "bash", args: { command: "npm install @chakra-ui/react" } }] },
      { calls: [{ name: "bash", args: { command: "npm install @chakra-ui/react@2 @emotion/react" } }] },
      { text: "ok" },
    ], { profile: "code", env });
    await c.send("cài chakra");
    const res = events.filter((e) => e.type === "tool_result") as { ok: boolean; output: string }[];
    expect(res[0].ok).toBe(false);
    expect(res[0].output).toMatch(/@chakra-ui\/react@2/);
    expect(res[1].ok).toBe(true);
    expect(ran).toEqual(["npm install @chakra-ui/react@2 @emotion/react"]); // lệnh mơ hồ không bao giờ chạy
  });
});

describe("Python không có trong PATH", () => {
  it("nhận ra bí danh Microsoft Store và 'not recognized', không nhầm với lỗi khác", async () => {
    const { pythonMissingHint } = await import("../src/pitfalls");
    expect(pythonMissingHint("Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut")).toMatch(/AGENTS\.md/);
    expect(pythonMissingHint("'python' is not recognized as an internal or external command")).not.toBeNull();
    expect(pythonMissingHint("bash: python3: command not found")).not.toBeNull();
    expect(pythonMissingHint("ModuleNotFoundError: No module named 'fastapi'")).toBeNull();
  });
  it("công cụ bash: thêm gợi ý vào kết quả khi lệnh thất bại vì không thấy Python", async () => {
    const env = new MemoryEnv("/ws", { "main.py": "print(1)" });
    env.exec = async () => ({ code: 9009, output: "Python was not found; run without arguments to install from the Microsoft Store", timedOut: false });
    const { c, events } = await makeController([
      { calls: [{ name: "bash", args: { command: "python main.py" } }] },
      { text: "ok" },
    ], { profile: "code", env });
    await c.send("chạy");
    const res = events.filter((e) => e.type === "tool_result") as { output: string }[];
    expect(res[0].output).toMatch(/Gợi ý: Python chưa có trong PATH/);
  });
});
