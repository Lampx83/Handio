import { describe, expect, it } from "vitest";
import { MemoryEnv, type Env } from "../src";
import { makeController } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const report = { url: "http://localhost:5173/", title: "Thi", loaded: true, errors: [], failedRequests: [], text: "Câu 1", blank: false };

describe("check_page chụp ảnh để agent nhìn được giao diện (phiên thật: agent than không nhìn thấy, người dùng phải tự chụp gửi)", () => {
  it("screenshot=true: lưu ảnh vào dự án, kết quả chỉ đường dẫn và cách xem bằng read_image", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "1" }) as MemoryEnv & Pick<Env, "checkPage">;
    let asked: boolean | undefined;
    env.checkPage = async (_u, o) => {
      asked = o.screenshot;
      return { ...report, screenshot: PNG };
    };
    const { c, events } = await makeController(
      [{ calls: [{ name: "check_page", args: { url: "http://localhost:5173/", screenshot: true } }] }, { text: "Xong." }],
      { profile: "code", env, settings: { mode: "bypass" } },
    );
    await c.send("xem giao diện");
    expect(asked).toBe(true);
    expect(Array.from(await env.readBytes("/ws/.neuagent/page-check.png"))).toEqual(Array.from(PNG));
    const r: any = events.find((e: any) => e.type === "tool_result" && e.name === "check_page");
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/\.neuagent\/page-check\.png/);
    expect(r.output).toMatch(/read_image/);
    expect(r.output).not.toContain("137,80"); // không đổ dữ liệu ảnh vào kết quả
  });

  it("không xin thì không chụp, không tạo tệp", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "1" }) as MemoryEnv & Pick<Env, "checkPage">;
    let asked: boolean | undefined = true;
    env.checkPage = async (_u, o) => {
      asked = o.screenshot;
      return { ...report };
    };
    const { c } = await makeController(
      [{ calls: [{ name: "check_page", args: { url: "http://localhost:5173/" } }] }, { text: "Xong." }],
      { profile: "code", env, settings: { mode: "bypass" } },
    );
    await c.send("kiểm tra");
    expect(asked).toBeFalsy();
    expect(await env.stat("/ws/.neuagent/page-check.png")).toBeFalsy();
  });
});
