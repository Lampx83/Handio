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
    // lời nhắc chỉ nhắc check_page khi công cụ có thật (bài thử thật: mô hình gọi check_page không tồn tại rồi lỡ bước)
    expect(none.c.currentSession.systemPrompt(null, 0)).not.toContain("check_page");
    expect(code.c.currentSession.systemPrompt(null, 0)).toContain("check_page");
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

describe("tự kiểm tra trang trước khi báo xong (tab Code, Desktop)", () => {
  const html = (t: string) => `<!doctype html><body><h1>${t}</h1><script>new Grid()</script>`;
  const mk = (reports: PageReport[]) => {
    const seen: string[] = [];
    let i = 0;
    const env = new MemoryEnv("/ws", {});
    (env as { checkPage?: unknown }).checkPage = async (url: string) => (seen.push(url), reports[Math.min(i++, reports.length - 1)]);
    return { env, seen };
  };
  const lastUserMsgs = (llm: { calls: { messages: { role: string; content?: unknown }[] }[] }) =>
    llm.calls.flatMap((c) => c.messages).filter((m) => m.role === "user").map((m) => String(m.content));

  it("agent báo xong mà chưa tự kiểm tra: hệ thống mở thử trang, thấy lỗi thì bắt sửa rồi mới cho kết thúc", async () => {
    const { env, seen } = mk([base({ url: "file:///ws/index.html", blank: true, errors: ["Uncaught ReferenceError: Grid is not defined"] }), base({ url: "file:///ws/index.html", text: "Xin chào" })]);
    const { c, llm, events } = await makeController([
      { calls: [{ name: "write_file", args: { path: "index.html", content: html("a") } }] },
      { text: "Xong rồi" }, // báo xong khi chưa kiểm tra
      { calls: [{ name: "write_file", args: { path: "index.html", content: "<!doctype html><h1>Xin chào</h1>" } }] },
      { text: "Đã sửa lỗi Grid" },
    ], { profile: "code", env });
    await c.send("làm trang web");
    expect(seen).toHaveLength(2); // lần 1 thấy lỗi, lần 2 sạch
    expect(lastUserMsgs(llm).some((m) => m.includes("Bạn chưa tự kiểm tra trang") && m.includes("Grid is not defined"))).toBe(true);
    const end = events.filter((e) => e.type === "turn_end").at(-1) as { final: string };
    expect(end.final).toContain("Đã sửa lỗi Grid"); // không kết thúc ở "Xong rồi"
  });

  it("agent đã tự gọi check_page và sạch: không mở thêm lần nữa", async () => {
    const { env, seen } = mk([base({ text: "Xin chào" })]);
    const { c } = await makeController([
      { calls: [{ name: "write_file", args: { path: "index.html", content: "<h1>Xin chào</h1>" } }] },
      { calls: [{ name: "check_page", args: { url: "index.html" } }] },
      { text: "Xong" },
    ], { profile: "code", env });
    await c.send("làm trang web");
    expect(seen).toHaveLength(1);
  });

  it("không đụng tệp web (README, .py): không tự mở trang", async () => {
    const { env, seen } = mk([base({})]);
    const { c } = await makeController([
      { calls: [{ name: "write_file", args: { path: "notes.txt", content: "x" } }] },
      { text: "Xong" },
    ], { profile: "code", env });
    await c.send("ghi chú");
    expect(seen).toHaveLength(0);
  });
});
