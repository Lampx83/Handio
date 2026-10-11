import { describe, expect, it } from "vitest";
import { MemoryEnv, type Env, type PageReport } from "../src";
import { formatPageReport } from "../src/page-check";
import { makeController } from "./helpers";

const base = (o: Partial<PageReport>): PageReport => ({ url: "http://localhost:5173/", title: "Đồng hồ", loaded: true, errors: [], failedRequests: [], text: "", blank: false, ...o });

describe("check_page: báo cáo cho mô hình", () => {
  it("trang trắng + lỗi: nói rõ TRẮNG, liệt kê lỗi đánh số, nhắc sửa lỗi đầu tiên và không nhờ người dùng chép lỗi", () => {
    const out = formatPageReport(base({ blank: true, errors: ["Uncaught ReferenceError: Grid is not defined (App.jsx:602)"], failedRequests: ["404 /favicon.ico"] }));
    expect(out).toMatch(/TRANG TRẮNG/);
    expect(out).toContain("1. Uncaught ReferenceError: Grid is not defined");
    expect(out).toContain("404 /favicon.ico");
    expect(out).toMatch(/lỗi ĐẦU TIÊN/);
  });
  it("trang ổn: kết luận ngắn", () => {
    const out = formatPageReport(base({ text: "22:59:41 Chủ Nhật" }));
    expect(out).toMatch(/KẾT QUẢ: ổn/);
    expect(out).toContain("22:59:41");
  });
  it("không mở được: khuyên xem log máy chủ thay vì đoán", () => {
    expect(formatPageReport(base({ loaded: false, error: "ERR_CONNECTION_REFUSED" }))).toMatch(/KHÔNG MỞ ĐƯỢC: ERR_CONNECTION_REFUSED[\s\S]*log của máy chủ/);
  });
});

describe("check_page: công cụ", () => {
  const withCheck = (fn: NonNullable<Env["checkPage"]>) => {
    const env = new MemoryEnv("/ws", { "index.html": "<h1>x</h1>" });
    (env as { checkPage?: unknown }).checkPage = fn;
    return env;
  };

  it("chỉ có ở tab Code và chỉ khi môi trường hỗ trợ", async () => {
    const none = await makeController([{ text: "ok" }], { profile: "code" });
    expect(none.c.currentSession.tools.has("check_page")).toBe(false);
    const code = await makeController([{ text: "ok" }], { profile: "code", env: withCheck(async () => base({})) });
    expect(code.c.currentSession.tools.has("check_page")).toBe(true);
    const work = await makeController([{ text: "ok" }], { profile: "work", env: withCheck(async () => base({})) });
    expect(work.c.currentSession.tools.has("check_page")).toBe(false);
  });

  it("mở localhost và tệp trong dự án; từ chối địa chỉ ngoài máy", async () => {
    const seen: string[] = [];
    const env = withCheck(async (url) => (seen.push(url), base({ url, errors: ["Uncaught Error: x"] })));
    const { c, events } = await makeController([
      { calls: [{ name: "check_page", args: { url: "http://localhost:5173/" } }] },
      { calls: [{ name: "check_page", args: { url: "index.html" } }] },
      { calls: [{ name: "check_page", args: { url: "https://example.com/" } }] },
      { text: "xong" },
    ], { profile: "code", env });
    await c.send("kiểm tra trang");
    const res = events.filter((e) => e.type === "tool_result") as { ok: boolean; output: string }[];
    expect(res.map((r) => r.ok)).toEqual([true, true, false]);
    expect(seen[0]).toBe("http://localhost:5173/");
    expect(seen[1]).toMatch(/^file:\/\/\/ws\/index\.html$/);
    expect(res[2].output).toMatch(/localhost/);
  });
});

describe("lịch sử: nội dung tệp đã ghi không nằm mãi trong đối số của lời gọi cũ", () => {
  it("pruneToolResults thay chuỗi lớn trong đối số write_file/edit_file cũ bằng dấu vết ngắn, giữ JSON hợp lệ và giữ các lượt gần nhất", async () => {
    const big = "x".repeat(6000);
    const script = [
      ...Array.from({ length: 6 }, (_, i) => ({ calls: [{ name: "write_file", args: { path: `f${i}.txt`, content: big + i } }] })),
      { text: "xong" },
    ];
    const { c } = await makeController(script, { profile: "code" });
    await c.send("ghi sáu tệp");
    const main = c.currentSession.main as unknown as { messages: { role: string; tool_calls?: { function: { arguments: string } }[] }[]; pruneToolResults(k?: number): number };
    expect(main.pruneToolResults(2)).toBeGreaterThan(0);
    const calls = main.messages.filter((m) => m.role === "assistant" && m.tool_calls).flatMap((m) => m.tool_calls!);
    const parsed = calls.map((t) => JSON.parse(t.function.arguments) as { path: string; content: string });
    expect(parsed.slice(0, 4).every((a) => a.content.length < 200 && /đã ghi vào tệp/.test(a.content))).toBe(true);
    expect(parsed.slice(-2).every((a) => a.content.length > 5000)).toBe(true); // 2 lượt gần nhất giữ nguyên
    expect(parsed.every((a) => /^f\d\.txt$/.test(a.path))).toBe(true);
  });
});
