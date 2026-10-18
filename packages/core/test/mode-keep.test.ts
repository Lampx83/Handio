import { describe, expect, it } from "vitest";
import { makeController } from "./helpers";

// Đã gặp (15/10, 0.8.20): người dùng chọn "Toàn quyền", ứng dụng tạo lại phiên (mở lại cuộc trò chuyện sau cập nhật, lưu AGENTS.md,
// cuộc trò chuyện mới…) → phiên mới quay về chế độ mặc định nhưng nhãn dưới ô nhập vẫn ghi "Toàn quyền", agent cứ hỏi từng lệnh.
describe("chế độ quyền khi tạo lại phiên", () => {
  const curl = (c: any) => c.currentSession.perms.decide({ name: "bash", kind: "exec", readonly: false }, { command: 'curl -s http://localhost:8080/app.js | grep -A5 "start" | head -10' });

  it("giữ Toàn quyền khi tạo lại phiên trong cùng dự án (cuộc trò chuyện mới, lưu AGENTS.md)", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "code", settings: { mode: "auto" } });
    await c.setMode("bypass");
    await c.newSession();
    expect((await c.getState()).mode).toBe("bypass");
    expect(curl(c).decision).toBe("allow");
    await c.instructionsSet("Trả lời ngắn.");
    expect((await c.getState()).mode).toBe("bypass");
    expect(curl(c).decision).toBe("allow");
  });

  it("phiên mới luôn báo chế độ thật cho giao diện (nhãn không lệch với phiên)", async () => {
    const { c, events } = await makeController([{ text: "ok" }], { profile: "code", settings: { mode: "auto" } });
    await c.setMode("bypass");
    const before = events.length;
    await c.newSession();
    const modes = events.slice(before).filter((e: any) => e.type === "mode").map((e: any) => e.mode);
    expect(modes.at(-1)).toBe("bypass");
    expect(modes.at(-1)).toBe((await c.getState()).mode);
  });
});
