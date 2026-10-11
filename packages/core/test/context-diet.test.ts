import { describe, expect, it } from "vitest";
import { makeController, type Step } from "./helpers";

const names = (llm: { calls: { opts: { tools?: unknown } }[] }, i: number) =>
  ((llm.calls[i].opts.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name);

describe("ngân sách ngữ cảnh/đầu ra (dữ liệu thật: prompt ~22k/32k token làm ngân sách đầu ra rơi về 1024)", () => {
  it("không cộng đôi lược đồ công cụ: prompt thật 21k token vẫn còn >8k token cho câu trả lời", async () => {
    const script: Step[] = [
      { calls: [{ name: "list_dir", args: { path: "." } }], usage: { prompt_tokens: 21000, completion_tokens: 30 } },
      { text: "xong", usage: { prompt_tokens: 21200, completion_tokens: 10 } },
    ];
    const { c, llm } = await makeController(script, { profile: "work", settings: { contextTokens: 32768, maxOutputTokens: 4096 } });
    await c.send("liệt kê thư mục");
    expect(llm.calls.length).toBeGreaterThanOrEqual(2);
    const second = llm.calls[1].opts.maxTokens as number;
    expect(second).toBeGreaterThan(8000);
    expect(second).toBeLessThanOrEqual(16384);
  });

  it("gần đầy cửa sổ: tóm tắt trước thay vì xin câu trả lời chỉ vài trăm token", async () => {
    const script: Step[] = [
      { calls: [{ name: "list_dir", args: { path: "." } }], usage: { prompt_tokens: 30500, completion_tokens: 30 } },
      { text: "Tóm tắt: đã liệt kê.", usage: { prompt_tokens: 900, completion_tokens: 20 } },
      { text: "xong", usage: { prompt_tokens: 1500, completion_tokens: 10 } },
    ];
    const { c, llm } = await makeController(script, { profile: "work", settings: { contextTokens: 32768 } });
    await c.send("liệt kê");
    // chỉ các lần gọi của agent (có công cụ); lần tóm tắt ngữ cảnh có ngân sách riêng, nhỏ
    const budgets = llm.calls.filter((x) => (x.opts.tools ?? []).length > 0).map((x) => x.opts.maxTokens as number);
    expect(budgets.length).toBeGreaterThan(1);
    expect(Math.min(...budgets)).toBeGreaterThanOrEqual(2048);
    expect(llm.calls.some((x) => x.messages.some((m) => String(m.content).includes("Conversation to summarize")))).toBe(true);
  });

  it("sự kiện usage có chi tiết cửa sổ ngữ cảnh khớp tổng", async () => {
    const { c, events } = await makeController([{ text: "xong", usage: { prompt_tokens: 5000, completion_tokens: 10 } }], { profile: "work" });
    await c.send("xin chào");
    const u = events.filter((e) => e.type === "usage").at(-1) as { context?: { used: number; limit: number; parts: { name: string; tokens: number }[] } };
    expect(u.context).toBeTruthy();
    expect(u.context!.limit).toBeGreaterThan(0);
    const sum = u.context!.parts.reduce((n, p) => n + p.tokens, 0);
    expect(Math.abs(sum - u.context!.used)).toBeLessThanOrEqual(u.context!.parts.length + 2);
    expect(u.context!.parts.map((p) => p.name)).toContain("Công cụ");
  });
});

describe("nhóm công cụ nạp theo nhu cầu (tab Work ban đầu mang 47 công cụ ≈ 15k token)", () => {
  it("mặc định ẩn PDF/tiện ích/quản lý tệp; công cụ cốt lõi của Office vẫn có; có use_tools", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "work" });
    await c.send("chào bạn");
    const n = names(llm, 0);
    for (const hidden of ["pdf_split", "pdf_merge", "date_calc", "vn_number_words", "zip_files", "copy_file", "merge_documents"]) expect(n, hidden).not.toContain(hidden);
    for (const core of ["create_pptx", "pptx_edit", "create_docx", "docx_edit", "create_xlsx", "xlsx_edit", "read_document", "list_dir", "ask_user", "use_tools"]) expect(n, core).toContain(core);
  });

  it("nhắc tới PDF (kể cả không dấu) thì nhóm pdf được bật từ lần gọi sau và giữ đến hết phiên", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "work" });
    await c.send("gop 2 file pdf giup toi");
    expect(names(llm, 0)).toContain("pdf_merge");
    await c.send("cảm ơn");
    expect(names(llm, llm.calls.length - 1)).toContain("pdf_merge");
  });

  it("agent bật nhóm bằng use_tools, và gọi thẳng công cụ thuộc nhóm chưa bật vẫn chạy (không báo lỗi)", async () => {
    const script: Step[] = [
      { calls: [{ name: "use_tools", args: { groups: ["utils"] } }] },
      { calls: [{ name: "vn_number_words", args: { value: "1250000" } }] },
      { text: "xong" },
    ];
    const { c, llm, events } = await makeController(script, { profile: "work" });
    await c.send("đổi số 1250000 sang chữ giúp tôi");
    expect(names(llm, 0)).toContain("use_tools");
    expect(names(llm, 1)).toContain("vn_number_words");
    const res = events.filter((e) => e.type === "tool_result") as { name: string; ok: boolean; output: string }[];
    expect(res.find((r) => r.name === "use_tools")!.ok).toBe(true);
    expect(res.find((r) => r.name === "vn_number_words")!.output).not.toMatch(/không có công cụ/);

    const direct = await makeController([{ calls: [{ name: "date_calc", args: { op: "add", date: "2026-10-11", days: 5 } }] }, { text: "xong" }], { profile: "work" });
    await direct.c.send("làm việc khác");
    const r2 = (direct.events.filter((e) => e.type === "tool_result") as { name: string; output: string }[]).find((r) => r.name === "date_calc")!;
    expect(r2.output).not.toMatch(/không có công cụ/);
  });

  it("tab Code không bị ảnh hưởng (không có use_tools, giữ nguyên công cụ)", async () => {
    const { c, llm } = await makeController([{ text: "ok" }], { profile: "code" });
    await c.send("chào");
    expect(names(llm, 0)).not.toContain("use_tools");
    expect(names(llm, 0)).toContain("read_file");
  });
});

describe("hết bước không bắt người dùng gõ 'tiếp tục'", () => {
  it("tác tử chính được 3 lần số bước cài đặt trước khi chạm chặn an toàn, và thông báo không mời gõ 'tiếp tục'", async () => {
    let i = 0;
    const { c, events } = await makeController(() => (i++ < 100 ? { calls: [{ name: "list_dir", args: { path: ".", n: i } }] } : { text: "xong" }), { settings: { maxSteps: 4 } });
    await c.send("đọc mãi");
    const notices = events.filter((e) => e.type === "notice").map((e) => (e as { text: string }).text);
    expect(notices.some((t) => /giới hạn an toàn 12 bước/.test(t))).toBe(true);
    expect(notices.some((t) => /tiếp tục/.test(t))).toBe(false);
  });
});
