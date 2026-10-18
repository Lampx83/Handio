import { describe, expect, it } from "vitest";
import { makeController } from "./helpers";

describe("tóm tắt ngữ cảnh giữ các sự thật không qua mô hình", () => {
  it("sau /compact: lời người dùng nguyên văn, tệp đã sửa, việc cần làm vẫn còn dù bản tóm tắt của mô hình sót", async () => {
    const { c } = await makeController(
      [
        { calls: [{ name: "todo_write", args: { todos: [{ content: "Làm trang đăng nhập", status: "in_progress" }, { content: "Thêm kiểm tra mật khẩu", status: "pending" }] } }] },
        { calls: [{ name: "write_file", args: { path: "src/login.html", content: "<form></form>" } }] },
        { text: "Đã tạo trang đăng nhập." },
        { text: "Tóm tắt ngắn (mô hình nhỏ quên hết chi tiết)." }, // trả lời cho lời gọi tóm tắt
      ],
      { profile: "code", settings: { mode: "auto" } as never },
    );
    await c.send("Làm trang đăng nhập có kiểm tra mật khẩu tối thiểu 8 ký tự");
    await c.send("/compact");
    const first = String((c as any).currentSession.main.messages[0].content);
    expect(first).toContain("Tóm tắt ngắn");
    expect(first).toContain("[Sự thật ghi lại tự động]");
    expect(first).toContain("Làm trang đăng nhập có kiểm tra mật khẩu tối thiểu 8 ký tự");
    expect(first).toContain("src/login.html");
    expect(first).toContain("▶ Làm trang đăng nhập");
  });
});
