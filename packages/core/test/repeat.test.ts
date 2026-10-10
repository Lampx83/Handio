import { describe, expect, it } from "vitest";
import { findRepetition } from "../src";
import { makeController } from "./helpers";

const P = "Để giải quyết vấn đề này, tôi sẽ tạo file Excel với 203 bản ghi bằng cách tạo một danh sách dữ liệu hợp lý.";
const Q = "Thực tế, tôi sẽ tạo file Excel với 203 bản ghi bằng cách sử dụng xlsx_edit để thêm các hàng mới vào file đã tạo.";

describe("phát hiện mô hình lặp một đoạn văn", () => {
  it("nhận ra đoạn dài lặp từ 4 lần, cắt ngay trước lần lặp thứ hai", () => {
    const text = [P, Q, P, Q, P, Q, P, Q].join("\n\n");
    const r = findRepetition(text)!;
    expect(r).not.toBeNull();
    expect(text.slice(0, r.cut).trim()).toBe(P + "\n\n" + Q); // giữ lại đúng một chu kỳ
  });

  it("không báo nhầm văn bản bình thường, câu ngắn lặp lại hay mục danh sách giống nhau ngắn", () => {
    const normal = Array.from({ length: 12 }, (_, i) => `Bước ${i + 1}: mở tệp số ${i + 1} trong thư mục làm việc rồi đối chiếu số liệu với bảng tổng hợp ở tệp chính.`).join("\n");
    expect(findRepetition(normal)).toBeNull();
    expect(findRepetition("Xong.\n".repeat(50))).toBeNull();
    expect(findRepetition("- Có\n".repeat(80))).toBeNull();
    expect(findRepetition([P, Q, P].join("\n\n") + "\n" + normal)).toBeNull(); // mới lặp 2 lần
  });

  it("bỏ qua khác biệt về hoa/thường, dấu câu và khoảng trắng", () => {
    const v = (s: string, i: number) => (i % 2 ? s.toUpperCase() : s.replace(/,/g, " ,")) + (i % 3 ? "!!" : "");
    expect(findRepetition([0, 1, 2, 3].map((i) => v(P, i)).join("\n"))).not.toBeNull();
  });
});

describe("agent ngắt khi mô hình lặp văn bản", () => {
  it("dừng sinh, nhắc gọi công cụ rồi làm tiếp (không lặp vô tận)", async () => {
    const loop = [P, Q, P, Q, P, Q, P, Q, P, Q].join("\n\n");
    const { c, llm, events } = await makeController([{ text: loop }, { calls: [{ name: "write_file", args: { path: "a.txt", content: "x" } }] }, { text: "Đã tạo a.txt." }], { settings: { mode: "bypass" } });
    await c.send("tạo thêm 200 bản ghi");
    expect(events.some((e: any) => e.type === "notice" && /lặp lại một đoạn văn/.test(e.text))).toBe(true);
    const steer = llm.calls[1].messages.at(-1) as { role: string; content: string };
    expect(steer.role).toBe("user");
    expect(steer.content).toMatch(/GỌI CÔNG CỤ/);
    // phần lặp bị cắt khỏi lịch sử gửi lại cho mô hình: chỉ còn một bản
    const hist = JSON.stringify(llm.calls[1].messages);
    expect((hist.match(/Để giải quyết vấn đề này/g) ?? []).length).toBe(1);
    expect(llm.calls.length).toBe(3);
  });

  it("lặp ba lần liên tiếp thì dừng hẳn và báo", async () => {
    const loop = [P, Q, P, Q, P, Q, P, Q].join("\n\n");
    const { c, llm, events } = await makeController([{ text: loop }], {});
    const out = await c.send("làm đi");
    expect(llm.calls.length).toBe(3);
    expect(events.filter((e: any) => e.type === "notice" && /lặp lại một đoạn văn/.test(e.text)).length).toBe(3);
    expect(JSON.stringify(out ?? events.at(-1))).toBeTruthy();
  });
});
