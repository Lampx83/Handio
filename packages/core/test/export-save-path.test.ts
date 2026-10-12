import { describe, expect, it } from "vitest";
import { LocalController, MemoryEnv } from "../src";

async function mk(pick: ((o: { defaultPath: string; format: "pdf" | "png" }) => Promise<string | null>) | undefined) {
  const env = new MemoryEnv("/ws", { "poster.html": "<h1>Poster</h1>" });
  let saved = {};
  const c = await LocalController.create({
    env, profile: "design", realFs: false,
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async () => true, setTrusted: async () => undefined },
    renderDesign: async () => new Uint8Array([37, 80, 68, 70]),
    pickSavePath: pick,
  });
  return { c, env };
}

describe("xuất PDF/PNG: hỏi lưu vào đâu", () => {
  it("người dùng chọn nơi lưu: ghi đúng chỗ đó (kể cả ngoài dự án), tự thêm đuôi nếu thiếu", async () => {
    const asked: string[] = [];
    const { c, env } = await mk(async (o) => (asked.push(o.defaultPath), "/Users/x/Desktop/ap-phich"));
    const r = await c.exportDesign("poster.html", "pdf", 794);
    expect(asked).toEqual(["/ws/poster.pdf"]); // gợi ý mặc định: cạnh tệp thiết kế
    expect(r).toEqual({ saved: "/Users/x/Desktop/ap-phich.pdf" });
    expect(await env.stat("/Users/x/Desktop/ap-phich.pdf")).toBeTruthy();
    expect(await env.stat("/ws/poster.pdf")).toBeNull();
  });

  it("không chọn (đóng hộp thoại): xuất vào thư mục mặc định cạnh tệp thiết kế", async () => {
    const { c, env } = await mk(async () => null);
    const r = await c.exportDesign("poster.html", "png", 794);
    expect(r).toEqual({ saved: "poster.png" });
    expect(await env.stat("/ws/poster.png")).toBeTruthy();
  });

  it("không có hộp chọn (web/kiểm thử): lưu cạnh tệp, tự đổi tên khi trùng", async () => {
    const { c } = await mk(undefined);
    expect(await c.exportDesign("poster.html", "pdf", 794)).toEqual({ saved: "poster.pdf" });
    expect(await c.exportDesign("poster.html", "pdf", 794)).toEqual({ saved: "poster (2).pdf" });
  });
});
