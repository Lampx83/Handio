import { describe, expect, it } from "vitest";
import { MemoryEnv } from "../src";
import { makeController } from "./helpers";

const dec = new TextDecoder();

describe("sửa tệp chữ trong ứng dụng (writeTextFile)", () => {
  const mk = async (seed: Record<string, string>) => {
    const env = new MemoryEnv("/ws", seed);
    const { c, events } = await makeController([{ text: "ok" }], { profile: "code", env });
    return { c, env, events };
  };

  it("sửa được tệp chữ đã có (mọi loại: md, json, css…) và báo files_changed", async () => {
    const { c, env, events } = await mk({ "AGENTS.md": "cũ\n", "src/a.css": "a{}", "data.json": "{}" });
    for (const [p, t] of [["AGENTS.md", "mới\n"], ["src/a.css", "a{color:red}"], ["data.json", '{"x":1}']] as const) {
      expect(await c.writeTextFile(p, t)).toEqual({ ok: true });
      expect(dec.decode(await env.readBytes("/ws/" + p))).toBe(t);
    }
    expect(events.some((e) => e.type === "files_changed")).toBe(true);
  });

  it("không tạo tệp mới, không sửa ngoài dự án, không sửa tệp nhị phân/Office/quá lớn", async () => {
    const { c, env } = await mk({ "a.txt": "x" });
    await env.writeBytes("/ws/bin.dat", new Uint8Array([1, 2, 0, 3]));
    await env.writeBytes("/ws/b.docx", new Uint8Array([80, 75, 3, 4]));
    await env.writeText("/ws/big.txt", "x".repeat(250_000));
    expect(await c.writeTextFile("moi.txt", "x")).toHaveProperty("error");
    expect(await env.stat("/ws/moi.txt")).toBeNull();
    expect(await c.writeTextFile("../ngoai.txt", "x")).toHaveProperty("error");
    expect(await c.writeTextFile("/etc/hosts", "x")).toHaveProperty("error");
    expect(await c.writeTextFile("bin.dat", "x")).toHaveProperty("error");
    expect(await c.writeTextFile("b.docx", "x")).toHaveProperty("error");
    expect(await c.writeTextFile("big.txt", "y")).toHaveProperty("error"); // xem bị cắt: lưu sẽ làm mất phần cuối
    expect(await c.writeTextFile("a.txt", "x".repeat(300_000))).toHaveProperty("error");
    expect(dec.decode(await env.readBytes("/ws/a.txt"))).toBe("x");
  });

  it("giữ kiểu xuống dòng CRLF của tệp gốc", async () => {
    const { c, env } = await mk({ "w.txt": "a\r\nb\r\n" });
    expect(await c.writeTextFile("w.txt", "a\nb\nc\n")).toEqual({ ok: true });
    expect(dec.decode(await env.readBytes("/ws/w.txt"))).toBe("a\r\nb\r\nc\r\n");
  });
});
