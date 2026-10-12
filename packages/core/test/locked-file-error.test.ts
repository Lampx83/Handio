import { describe, expect, it } from "vitest";
import { MemoryEnv } from "../src";
import { makeController } from "./helpers";

describe("tệp bị khoá bởi chương trình khác", () => {
  it("lỗi EBUSY của công cụ ghi tệp thường được nói bằng lời dễ hiểu, không phải 'Lỗi nội bộ'", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "x" });
    const real = env.writeText.bind(env);
    env.writeText = async (p: string, t: string) => {
      if (p.endsWith("a.txt")) throw Object.assign(new Error("EBUSY: resource busy or locked, open 'a.txt'"), { code: "EBUSY" });
      return real(p, t);
    };
    const { c, events } = await makeController([
      { calls: [{ name: "read_file", args: { path: "a.txt" } }] },
      { calls: [{ name: "write_file", args: { path: "a.txt", content: "y" } }] },
      { text: "ok" },
    ], { profile: "code", env });
    await c.send("ghi");
    const res = events.filter((e) => e.type === "tool_result") as { ok: boolean; output: string }[];
    expect(res[1].ok).toBe(false);
    expect(res[1].output).toMatch(/đang mở hoặc bị khoá/);
    expect(res[1].output).not.toMatch(/Lỗi nội bộ/);
  });
});
