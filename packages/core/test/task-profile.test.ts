import { describe, expect, it, vi } from "vitest";
import { DiagnosticsRecorder, type SessionEvent } from "../src";
import { artifactOf, classifyPrompt, isVerifyCommand, stackOf, verifyOutcome } from "../src/task-profile";

describe("phân loại yêu cầu (cục bộ, chỉ ra mã)", () => {
  it("nhận ra loại việc, kể cả gõ không dấu", () => {
    expect(classifyPrompt("Tạo cho tôi một trang web bán hàng").kind).toBe("build");
    expect(classifyPrompt("sửa lỗi nút đăng nhập không bấm được").kind).toBe("fix");
    expect(classifyPrompt("sua slide so 3 doi mau xanh").kind).toBe("edit");
    expect(classifyPrompt("chuyển file này sang PDF").kind).toBe("convert");
    expect(classifyPrompt("giải thích hàm reduce là gì").kind).toBe("explain");
    expect(classifyPrompt("so sánh hai phương án").kind).toBe("research");
    expect(classifyPrompt("ok cảm ơn").kind).toBe("followup");
    expect(classifyPrompt("làm tiếp đi").kind).toBe("followup");
    expect(classifyPrompt("cái nút này nằm ở đâu?").kind).toBe("explain");
    expect(classifyPrompt("hmm").kind).toBe("other");
  });
  it("nhận ra người dùng nói chưa đạt", () => {
    expect(classifyPrompt("vẫn lỗi như cũ").redoCue).toBe(true);
    expect(classifyPrompt("chưa đúng, làm lại đi").redoCue).toBe(true);
    expect(classifyPrompt("thêm một nút nữa").redoCue).toBe(false);
  });
  it("loại sản phẩm theo đuôi tệp; bộ khung theo package.json", () => {
    expect(artifactOf("src/App.jsx")).toBe("web");
    expect(artifactOf("báo cáo.docx")).toBe("word");
    expect(artifactOf("a/b/data.CSV")).toBe("data");
    expect(artifactOf("Makefile")).toBeNull();
    expect(stackOf({ pkg: JSON.stringify({ dependencies: { react: "18", "@chakra-ui/react": "2" } }) })).toEqual({ stack: "react", ui: "chakra" });
    expect(stackOf({ pkg: JSON.stringify({ devDependencies: { vite: "5", tailwindcss: "3" } }) })).toEqual({ stack: "vite", ui: "tailwind" });
    expect(stackOf({ reqs: "flask==3\nrequests" })).toEqual({ stack: "flask", ui: "none" });
    expect(stackOf({ hasHtml: true })).toEqual({ stack: "static", ui: "none" });
    expect(stackOf({})).toEqual({ stack: "none", ui: "none" }); // thư mục trống/chỉ có tài liệu: không phải "khác"
    expect(stackOf({ pkg: "{hỏng" })).toEqual({ stack: "node", ui: "none" });
  });
  it("lệnh kiểm chứng và kết quả", () => {
    expect(isVerifyCommand("cd app && npm run build")).toBe(true);
    expect(isVerifyCommand("npx vitest run")).toBe(true);
    expect(isVerifyCommand("ls -la")).toBe(false);
    expect(verifyOutcome("bash", "ok\n[mã thoát 0]")).toBe("pass");
    expect(verifyOutcome("bash", "err\n[mã thoát 2]")).toBe("fail");
    expect(verifyOutcome("bash", "[Hết thời gian 60s, đã dừng lệnh]")).toBeNull();
    expect(verifyOutcome("check_page", "KẾT QUẢ: ổn (không lỗi console)")).toBe("pass");
    expect(verifyOutcome("check_page", "KẾT QUẢ: CÓ VẤN ĐỀ — TRANG TRẮNG")).toBe("fail");
  });
});

describe("hồ sơ công việc trong sự kiện turn", () => {
  const T0 = 1_800_000_000_000;
  function rec() {
    const sent: string[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => (sent.push(String(init.body)), new Response("{}", { status: 200 })));
    const clock = { t: T0 };
    const r = new DiagnosticsRecorder({ endpoint: "/d", enabled: () => true, version: "0.1.0", platform: "web", context: () => ({ profile: "code", model: "m", install: "0123456789abcdef0123456789abcdef" }), fetch: f as unknown as typeof fetch, now: () => clock.t, flushDelayMs: 1e9 });
    return { r, sent, clock };
  }
  const D = { depth: 0 } as const;
  const pair = (id: string, name: string, args: Record<string, unknown>, output: string, ok = true): SessionEvent[] => [
    { type: "tool_start", id, name, summary: "x", args, ...D },
    { type: "tool_result", id, name, ok, output, ...D },
  ];
  const secret = "mat-khau-luong-2026-bi-mat";

  it("ghi loại việc, sản phẩm, bộ khung, kiểm chứng — và KHÔNG chứa chữ của người dùng", async () => {
    const { r, sent } = rec();
    r.onEvent({ type: "turn_start" });
    r.noteTask(`tạo trang web cho ${secret}`, { stack: "react", ui: "chakra" });
    for (const e of [
      ...pair("1", "write_file", { path: `src/${secret}.jsx`, content: "x" }, "ok"),
      ...pair("2", "edit_file", { path: "src/App.jsx" }, "ok"),
      ...pair("3", "bash", { command: `npm run build # ${secret}` }, "built\n[mã thoát 1]"),
      ...pair("4", "bash", { command: "npm run build" }, "built\n[mã thoát 0]"),
      { type: "message_end", text: "xong", ...D } as SessionEvent,
    ]) r.onEvent(e);
    r.onEvent({ type: "turn_end", interrupted: false, final: "" });
    await r.flush();
    const body = sent.join("");
    expect(body).not.toContain(secret);
    const ev = JSON.parse(sent[0]).events.find((e: { t: string }) => e.t === "turn");
    expect(ev).toMatchObject({ kind: "build", stack: "react", ui: "chakra", art: "web", files_new: 1, files_edit: 1, verify: "pass", nth: 1 });
    expect(ev.redo).toBeUndefined();
  });

  it("redo chỉ tính từ lượt thứ hai; về 1 khi tạo cuộc trò chuyện mới", async () => {
    const { r, sent } = rec();
    const one = (text: string) => {
      r.onEvent({ type: "turn_start" });
      r.noteTask(text);
      r.onEvent({ type: "message_end", text: "ok", ...D });
      r.onEvent({ type: "turn_end", interrupted: false, final: "" });
    };
    one("vẫn lỗi như cũ"); // lượt đầu: không phải làm lại
    one("vẫn lỗi như cũ");
    r.onEvent({ type: "reset" });
    one("chưa đúng");
    await r.flush();
    const turns = sent.flatMap((b) => JSON.parse(b).events).filter((e: { t: string }) => e.t === "turn");
    expect(turns.map((t: { redo?: boolean }) => !!t.redo)).toEqual([false, true, false]);
    expect(turns.map((t: { nth: number }) => t.nth)).toEqual([1, 2, 1]);
  });
});
