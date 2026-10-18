import { describe, expect, it } from "vitest";
import { DESIGN_MD_TEMPLATE, MemoryEnv, loadDesignMd } from "../src";
import { makeController } from "./helpers";

const sys = (llm: { calls: { messages: { content?: string | null }[] }[] }, n: number) => String(llm.calls[n].messages[0].content);
const DM = "# Hệ thống thiết kế\n- Chính: #7A1FA2\n- Phông: Georgia";

describe("DESIGN.md theo dự án (tab Design)", () => {
  it("tab Design: có DESIGN.md thì vào lời nhắc hệ thống ở lượt đầu", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "design", seed: { "DESIGN.md": DM } });
    await c.send("làm poster");
    expect(sys(llm, 0)).toContain("DESIGN SYSTEM of this project");
    expect(sys(llm, 0)).toContain("#7A1FA2");
  });

  it("không có DESIGN.md thì không thêm mục nào", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "design", seed: { "a.html": "<p>x</p>" } });
    await c.send("làm poster");
    expect(sys(llm, 0)).not.toContain("DESIGN SYSTEM");
  });

  it("sửa DESIGN.md giữa chừng thì lượt sau dùng bản mới (không cần mở lại phiên)", async () => {
    const { c, env, llm } = await makeController([{ text: "ok" }], { profile: "design", seed: { "DESIGN.md": DM } });
    await c.send("một");
    await env.writeText("/ws/DESIGN.md", "# Mới\n- Chính: #00AA55");
    await c.send("hai");
    const last = sys(llm, llm.calls.length - 1);
    expect(last).toContain("#00AA55");
    expect(last).not.toContain("#7A1FA2");
  });

  it("tab Work và Code không nạp DESIGN.md", async () => {
    for (const profile of ["work", "code"] as const) {
      const { c, llm } = await makeController([{ text: "ok" }], { profile, seed: { "DESIGN.md": DM } });
      await c.send("xin chào");
      expect(sys(llm, 0), profile).not.toContain("DESIGN SYSTEM");
    }
  });

  it("cắt bớt tệp quá dài và bỏ qua tệp rỗng", async () => {
    const big = new MemoryEnv("/ws", { "DESIGN.md": "x".repeat(20000) });
    const t = await loadDesignMd(big, "/ws");
    expect(t.length).toBeLessThan(4100);
    expect(t).toContain("đã cắt bớt");
    expect(await loadDesignMd(new MemoryEnv("/ws", { "DESIGN.md": "  \n" }), "/ws")).toBe("");
    expect(await loadDesignMd(new MemoryEnv("/ws", {}), "/ws")).toBe("");
  });

  it("/designmd có trong tab Design, kèm mẫu; chạy như prompt nhận tham số", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "design" });
    const s = c.currentSession;
    expect(s.slashCommands().map((x) => x.name)).toContain("designmd");
    const r = await s.handleInput("/designmd tông xanh lá, trang trọng");
    expect(r.run).toContain("tông xanh lá, trang trọng");
    expect(r.run).toContain("DESIGN.md");
    expect(r.run).toContain(DESIGN_MD_TEMPLATE.slice(0, 40));
    const code = (await makeController([{ text: "ok" }], { profile: "code" })).c.currentSession;
    expect(code.slashCommands().map((x) => x.name)).not.toContain("designmd");
  });

  it("mẫu DESIGN.md gọn và đủ các phần (màu, chữ, khoảng cách, giọng điệu)", () => {
    expect(DESIGN_MD_TEMPLATE.split("\n").length).toBeLessThanOrEqual(40);
    for (const h of ["## Màu", "## Chữ", "## Khoảng cách", "## Giọng điệu"]) expect(DESIGN_MD_TEMPLATE).toContain(h);
  });
});
