import { describe, expect, it } from "vitest";
import { MemoryEnv, office } from "../src";
import { makeController } from "./helpers";

const seedEnv = async () => {
  const env = new MemoryEnv("/ws", { ".env": "KEY=1\n" });
  await env.writeBytes("/ws/kh.docx", await office.createDocx({ content: "# Kế hoạch\n\nHội thảo ngày 17/10/2026.\n\nKinh phí 28.000.000 đồng." }));
  return env;
};

describe("Work: quy trình của tôi", () => {
  it("lưu việc vừa làm thành lệnh /tên trong dự án, liệt kê, xoá; không đè lệnh có sẵn", async () => {
    const env = await seedEnv();
    const { c } = await makeController([{ calls: [{ name: "read_document", args: { path: "kh.docx" } }] }, { text: "Xong." }], { env, profile: "work" });
    expect(await c.procedureSave("Tóm tắt kế hoạch")).toEqual({ error: expect.stringMatching(/Chưa có việc/) });
    await c.send("Tóm tắt kh.docx giúp tôi");
    const r = await c.procedureSave("Tóm tắt kế hoạch", "Tóm tắt một kế hoạch");
    expect(r).toEqual({ ok: true, name: "tom-tat-ke-hoach" });
    const md = new TextDecoder().decode(await env.readBytes("/ws/.neuagent/commands/tom-tat-ke-hoach.md"));
    expect(md).toContain("description: Tóm tắt một kế hoạch");
    expect(md).toContain("$ARGUMENTS");
    expect(md).toContain("Tóm tắt kh.docx giúp tôi");
    expect(md).toContain("read_document");
    expect((await c.procedureList()).map((p) => p.name)).toContain("tom-tat-ke-hoach");
    expect((await c.getState()).commands.map((x) => x.name)).toContain("tom-tat-ke-hoach");
    expect(await c.procedureSave("Tóm tắt kế hoạch")).toEqual({ error: expect.stringMatching(/đã có/) });
    expect(await c.procedureSave("tomtat")).toEqual({ error: expect.stringMatching(/có sẵn/) });
    expect(await c.procedureSave("!")).toEqual({ error: expect.stringMatching(/chưa hợp lệ/) });
    await c.procedureRemove("../../AGENTS");
    await c.procedureRemove("tom-tat-ke-hoach");
    expect(await env.stat("/ws/.neuagent/commands/tom-tat-ke-hoach.md")).toBeNull();
    expect((await c.getState()).commands.map((x) => x.name)).not.toContain("tom-tat-ke-hoach");
  });
  it("quy trình đã lưu chạy lại được như lệnh /tên với tham số", async () => {
    const env = await seedEnv();
    const { c, llm } = await makeController([{ calls: [{ name: "read_document", args: { path: "kh.docx" } }] }, { text: "Xong." }], { env, profile: "work" });
    await c.send("Tóm tắt kh.docx");
    expect(await c.procedureSave("tom tat")).toEqual({ ok: true, name: "tom-tat" });
    (c.currentSession.o as { llm: unknown }).llm = llm; // phiên được dựng lại sau khi lưu: gắn lại mô hình giả
    await c.send("/tom-tat bao-cao.docx");
    const last = llm.calls.at(-1)!.messages.filter((m) => m.role === "user").at(-1)!.content!;
    expect(last).toContain("Repeat the procedure below for: bao-cao.docx");
  });
});

describe("Work: trộn thư qua phiên làm việc", () => {
  it("/undo hoàn tác cả lô tệp do một lần trộn tạo ra", async () => {
    const env = await seedEnv();
    await env.writeBytes("/ws/mau.docx", await office.createDocx({ content: "Kính mời {{Họ tên}}" }));
    await env.writeBytes("/ws/ds.xlsx", (await office.createXlsx([{ name: "DS", rows: [["Họ tên"], ["An"], ["Bình"], ["Chi"]] }])).bytes);
    const { c, requests } = await makeController([{ calls: [{ name: "merge_documents", args: { template: "mau.docx", data: "ds.xlsx" } }] }, { text: "Xong." }], { env, profile: "work" });
    await c.send("Trộn thư");
    expect(requests.find((r) => r.tool === "merge_documents")?.preview?.outline).toContain("3 tệp từ 3 dòng"); // người dùng thấy bản mô tả + bản đầu trước khi duyệt
    expect(requests[0].preview?.outline).toContain("Kính mời An");
    expect((await env.readdir("/ws/mau-hang-loat")).length).toBe(3);
    await c.currentSession.undo();
    expect((await env.readdir("/ws/mau-hang-loat")).length).toBe(0);
  });
});

describe("Work: trích dẫn và xem tài liệu", () => {
  it("cảnh báo khi trích dẫn không có thật; trích dẫn đúng thì im lặng", async () => {
    const env = await seedEnv();
    const bad = await makeController([{ text: "Hội thảo 17/10 [[kh.docx|đoạn 2]]. Kinh phí 30 triệu [[kh.docx|đoạn 99]] [[khong-co.docx|đoạn 1]]." }], { env, profile: "work" });
    await bad.c.send("hỏi");
    const warn = bad.events.find((e) => e.type === "notice" && /trích dẫn không khớp/.test(e.text));
    expect(warn && "text" in warn && warn.text).toMatch(/2\/3 trích dẫn không khớp.*kh\.docx đoạn 99.*khong-co\.docx/);
    const ok = await makeController([{ text: "Đúng [[kh.docx|đoạn 2]]." }], { env: await seedEnv(), profile: "work" });
    await ok.c.send("hỏi");
    expect(ok.events.some((e) => e.type === "notice" && /trích dẫn/.test(e.text))).toBe(false);
  });
  it("docView: trả nội dung chữ thuần có đánh dấu; chặn tệp nhạy cảm, ngoài dự án, loại lạ", async () => {
    const env = await seedEnv();
    const { c } = await makeController([{ text: "." }], { env, profile: "work" });
    const v = await c.docView("kh.docx", "đoạn 2");
    expect("error" in v).toBe(false);
    if (!("error" in v)) {
      expect(v.found).toBe(true);
      expect(v.sections[0].blocks.find((b) => b.n === 2 && b.t === "p" && b.hit)).toBeTruthy();
    }
    expect(await c.docView(".env")).toEqual({ error: expect.stringMatching(/nhạy cảm/) });
    expect(await c.docView("../ngoai.docx")).toEqual({ error: expect.stringMatching(/ngoài thư mục/) });
    expect(await c.docView("khong-co.docx")).toHaveProperty("error");
    await env.writeBytes("/ws/a.exe", new Uint8Array([1, 2, 3]));
    expect(await c.docView("a.exe")).toEqual({ error: expect.stringMatching(/Chưa xem được/) });
  });
});
