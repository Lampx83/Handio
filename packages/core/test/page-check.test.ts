import { describe, expect, it } from "vitest";
import { MemoryEnv, type Env, type PageReport } from "../src";
import { formatPageReport, parsePageSteps } from "../src/page-check";
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

describe("hết lượt tự sửa mà trang vẫn lỗi", () => {
  it("báo THẲNG cho người dùng (cảnh báo), không để lời 'xong' của mô hình che mất", async () => {
    const env = new MemoryEnv("/ws", {});
    (env as { checkPage?: unknown }).checkPage = async () => base({ url: "file:///ws/index.html", errors: ["Uncaught ReferenceError: Grid is not defined"] });
    const { c, events } = await makeController([
      { calls: [{ name: "write_file", args: { path: "index.html", content: "<script>new Grid()</script>" } }] },
      { text: "Xong rồi" },
    ], { profile: "code", env });
    await c.send("làm trang");
    const warns = events.filter((e) => e.type === "notice" && e.level === "warn") as { text: string }[];
    expect(warns.some((w) => /vẫn còn lỗi sau 3 lần/.test(w.text) && /Grid is not defined/.test(w.text))).toBe(true);
  });
});

describe("tự bật máy chủ dev để kiểm tra trang (chế độ Tự động)", () => {
  const mkEnv = () => {
    const env = new MemoryEnv("/ws", { "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { vite: "^5" } }) });
    const spawned: string[] = [];
    (env as { exec?: unknown }).exec = async () => ({ code: 0, output: "", timedOut: false });
    (env as { spawn?: unknown }).spawn = (cmd: string, o: { onData: (s: string) => void }) => {
      spawned.push(cmd);
      o.onData("  Local:   http://localhost:5173/\n");
      return { stop: () => undefined };
    };
    const seen: string[] = [];
    (env as { checkPage?: unknown }).checkPage = async (url: string) => (seen.push(url), base({ url, text: "Xin chào" }));
    return { env, spawned, seen };
  };

  it("agent sửa mã mà chưa bật máy chủ: hệ thống tự bật `npm run dev`, kiểm tra trang và để máy chủ chạy", async () => {
    const { env, spawned, seen } = mkEnv();
    const { c, events } = await makeController([
      { calls: [{ name: "write_file", args: { path: "src/App.jsx", content: "export default () => null" } }] },
      { text: "Xong" },
    ], { profile: "code", env, settings: { mode: "auto" } });
    await c.send("làm app");
    expect(spawned.length).toBe(1);
    expect(seen).toEqual(["http://localhost:5173/"]);
    expect(events.some((e) => e.type === "notice" && /Đã bật ứng dụng để kiểm tra: http:\/\/localhost:5173\//.test((e as { text: string }).text))).toBe(true);
  });

  it("chế độ Hỏi trước: không tự chạy lệnh nào", async () => {
    const { env, spawned, seen } = mkEnv();
    const { c } = await makeController([
      { calls: [{ name: "write_file", args: { path: "src/App.jsx", content: "export default () => null" } }] },
      { text: "Xong" },
    ], { profile: "code", env, settings: { mode: "default" }, decide: () => ({ allow: true }) });
    await c.send("làm app");
    expect(spawned).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
});

describe("nút ▶ chạy nền không qua mô hình (startBackground)", () => {
  it("chỉ chạy lệnh có trong gợi ý của dự án", async () => {
    const env = new MemoryEnv("/ws", { "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { vite: "^5" } }) });
    const spawned: string[] = [];
    (env as { spawn?: unknown }).spawn = (cmd: string, o: { onData: (s: string) => void }) => {
      spawned.push(cmd);
      o.onData("Local: http://localhost:5173/\n");
      return { stop: () => undefined };
    };
    const { c } = await makeController([{ text: "ok" }], { profile: "code", env });
    const sug = await c.runSuggestions();
    const dev = sug.find((s) => s.background)!;
    expect(dev).toBeTruthy();
    const r = await c.startBackground(dev.command);
    expect("error" in r).toBe(false);
    expect((r as { url?: string }).url).toBe("http://localhost:5173/");
    expect(spawned).toEqual([dev.command]);
    expect(await c.startBackground("rm -rf /")).toHaveProperty("error"); // lệnh ngoài gợi ý bị từ chối
    expect(spawned).toHaveLength(1);
  });
});

describe("check_page: các bước tương tác (steps)", () => {
  it("đọc dạng đầy đủ, dạng gọn và mảng bị mã hoá thành chuỗi; phân biệt bộ chọn CSS với chữ trên nút", () => {
    expect(parsePageSteps([{ action: "click", text: "Bắt đầu làm bài" }, { action: "type", selector: "#ten", value: "An" }, { action: "wait", ms: 99999 }, { action: "expect_text", text: "Câu 1" }])).toEqual([
      { action: "click", text: "Bắt đầu làm bài" },
      { action: "type", selector: "#ten", value: "An" },
      { action: "wait", ms: 3000 },
      { action: "expect_text", text: "Câu 1" },
    ]);
    expect(parsePageSteps([{ click: "#start" }, { click: "A. 12" }, { click: "A." }, { click: "button.primary" }, { wait: 200 }, { expect: "Điểm" }, { fill: "input[name=x]", value: 3 }])).toEqual([
      { action: "click", selector: "#start" },
      { action: "click", text: "A. 12" },
      { action: "click", text: "A." },
      { action: "click", selector: "button.primary" },
      { action: "wait", ms: 200 },
      { action: "expect_text", text: "Điểm" },
      { action: "type", selector: "input[name=x]", value: "3" },
    ]);
    expect(parsePageSteps('[{"action":"click","text":"Nộp bài"}]')).toEqual([{ action: "click", text: "Nộp bài" }]);
    expect(parsePageSteps(undefined)).toEqual([]);
  });

  it("từ chối: quá 8 bước, thiếu đích bấm, action lạ, không phải mảng", () => {
    expect(() => parsePageSteps(Array.from({ length: 9 }, () => ({ action: "wait", ms: 1 })))).toThrow(/Tối đa 8 bước/);
    expect(() => parsePageSteps([{ action: "click" }])).toThrow(/Bước 1 \(click\) cần selector/);
    expect(() => parsePageSteps([{ action: "wait" }, { action: "hover", text: "x" }])).toThrow(/Bước 2: action 'hover'/);
    expect(() => parsePageSteps({ action: "click", text: "x" })).toThrow(/phải là mảng/);
    expect(() => parsePageSteps([{ action: "expect_text" }])).toThrow(/cần text/);
  });

  it("báo cáo: lỗi phát sinh SAU bước nào thì ghi rõ số bước; trang tải sạch vẫn là CÓ VẤN ĐỀ", () => {
    const out = formatPageReport(base({
      text: "Câu 1: 2 + 3 = ?",
      steps: [
        { label: "bấm “Bắt đầu làm bài”", ok: true, errors: ["Uncaught ReferenceError: questions is not defined (App.jsx:42)"] },
        { label: "bấm “Nộp bài”", ok: false, note: "không tìm thấy nút “Nộp bài”; nút đang hiện: “Bắt đầu làm bài”", errors: [] },
      ],
    }));
    expect(out).toMatch(/KẾT QUẢ: CÓ VẤN ĐỀ — LỖI KHI THAO TÁC/);
    expect(out).toContain("Bước 1: bấm “Bắt đầu làm bài” — làm được nhưng PHÁT SINH LỖI");
    expect(out).toContain("1. lỗi sau bước 1: Uncaught ReferenceError: questions is not defined");
    expect(out).toMatch(/Bước 2: bấm “Nộp bài” — KHÔNG LÀM ĐƯỢC: không tìm thấy nút/);
    expect(out).toContain("Chữ trên trang sau bước cuối (đầu): Câu 1");
    expect(out).toMatch(/HỎNG KHI BẤM/);
    expect(out).not.toMatch(/KẾT QUẢ: ổn/);
  });

  it("báo cáo sạch có bước: vẫn là 'KẾT QUẢ: ổn' (cổng tự kiểm tra nhận ra); trang có nút mà chưa bấm thì gợi ý steps", () => {
    const ok = formatPageReport(base({ text: "Điểm: 10/10", steps: [{ label: "bấm “Bắt đầu”", ok: true, errors: [], dialogs: ["confirm: Nộp bài?"] }] }));
    expect(ok).toMatch(/^KẾT QUẢ: ổn \(.*1 bước tương tác/m);
    expect(ok).toContain("hộp thoại: “confirm: Nộp bài?”");
    const hint = formatPageReport(base({ text: "Trắc nghiệm", buttons: ["Bắt đầu làm bài"] }));
    expect(hint).toMatch(/KẾT QUẢ: ổn/);
    expect(hint).toContain("Nút đang hiện: “Bắt đầu làm bài”");
    expect(hint).toMatch(/gọi lại check_page với steps[\s\S]*"text":"Bắt đầu làm bài"/);
  });

  it("công cụ chuyển steps đã chuẩn hoá xuống môi trường; steps sai thì báo lỗi, không mở trang", async () => {
    const seen: { url: string; steps?: unknown }[] = [];
    const env = new MemoryEnv("/ws", { "index.html": "<h1>x</h1>" });
    (env as { checkPage?: unknown }).checkPage = async (url: string, o: { steps?: unknown }) => (seen.push({ url, steps: o.steps }), base({ url }));
    const { c, events } = await makeController([
      { calls: [{ name: "check_page", args: { url: "http://localhost:5173/", steps: [{ click: "Bắt đầu" }, { action: "expect_text", text: "Câu 1" }] } }] },
      { calls: [{ name: "check_page", args: { url: "http://localhost:5173/", steps: [{ action: "click" }] } }] },
      { text: "xong" },
    ], { profile: "code", env });
    await c.send("kiểm tra");
    const res = events.filter((e) => e.type === "tool_result") as { ok: boolean; output: string }[];
    expect(res.map((r) => r.ok)).toEqual([true, false]);
    expect(seen).toEqual([{ url: "http://localhost:5173/", steps: [{ action: "click", text: "Bắt đầu" }, { action: "expect_text", text: "Câu 1" }] }]);
    expect(res[1].output).toMatch(/cần selector/);
  });
});

describe("cổng tự kiểm tra: bấm thử luồng chính trước khi báo xong", () => {
  const quiz = (o: Partial<PageReport>) => base({ url: "http://localhost:5173/", text: "Trắc nghiệm Toán 6", buttons: ["Bắt đầu làm bài"], ...o });
  const mkEnv = (fn: (url: string, o: { steps?: unknown[] }) => PageReport) => {
    const env = new MemoryEnv("/ws", {});
    const seen: { url: string; steps?: unknown[] }[] = [];
    (env as { checkPage?: unknown }).checkPage = async (url: string, o: { steps?: unknown[] }) => (seen.push({ url, steps: o.steps }), fn(url, o));
    return { env, seen };
  };
  const userMsgs = (llm: { calls: { messages: { role: string; content?: unknown }[] }[] }) =>
    llm.calls.at(-1)!.messages.filter((m) => m.role === "user").map((m) => String(m.content));

  it("trang tải sạch, có nút, chưa ai bấm: nhắc MỘT lần dùng steps; agent bấm thấy lỗi, sửa xong thì hệ thống chạy lại đúng luồng đó", async () => {
    let fixed = false;
    const { env, seen } = mkEnv((_u, o) => {
      if (!o.steps?.length) return quiz({});
      return fixed
        ? quiz({ text: "Câu 1: 2 + 3 = ?", steps: [{ label: "bấm “Bắt đầu làm bài”", ok: true, errors: [] }] })
        : quiz({ steps: [{ label: "bấm “Bắt đầu làm bài”", ok: true, errors: ["Uncaught ReferenceError: questions is not defined"] }] });
    });
    const steps = [{ action: "click", text: "Bắt đầu làm bài" }];
    const { c, llm, events } = await makeController((_m, n) => {
      if (n === 0) return { calls: [{ name: "write_file", args: { path: "src/App.jsx", content: "x" } }] };
      if (n === 1) return { calls: [{ name: "check_page", args: { url: "http://localhost:5173/" } }] };
      if (n === 2) return { text: "Xong rồi" }; // trang tải sạch → cổng nhắc bấm thử
      if (n === 3) return { calls: [{ name: "check_page", args: { url: "http://localhost:5173/", steps } }] }; // thấy lỗi sau bước 1
      if (n === 4) return { calls: [{ name: "write_file", args: { path: "src/App.jsx", content: "y" } }] };
      if (n === 5) { fixed = true; return { text: "Đã sửa lỗi questions" }; }
      return { text: "?" };
    }, { profile: "code", env });
    await c.send("làm ứng dụng trắc nghiệm");
    const nudges = llm.calls.flatMap((x) => x.messages).filter((m) => m.role === "user" && String(m.content).includes("CHƯA ai bấm thử"));
    expect(nudges.length).toBeGreaterThan(0);
    expect(new Set(nudges.map((m) => String(m.content))).size).toBe(1); // chỉ một lời nhắc
    // lần cuối: hệ thống tự chạy lại luồng agent đã viết (không chỉ tải trang)
    expect(seen.at(-1)).toEqual({ url: "http://localhost:5173/", steps });
    expect(seen).toHaveLength(3);
    const end = events.filter((e) => e.type === "turn_end").at(-1) as { final: string };
    expect(end.final).toContain("Đã sửa lỗi questions");
    expect(userMsgs(llm).some((m) => m.includes("Bạn chưa tự kiểm tra trang"))).toBe(false);
  });

  it("sửa xong mà luồng bấm vẫn lỗi: hệ thống chạy lại luồng, đưa lỗi cho agent, không cho kết thúc ở lời 'xong'", async () => {
    const { env, seen } = mkEnv((_u, o) => (o.steps?.length ? quiz({ steps: [{ label: "bấm “Bắt đầu làm bài”", ok: true, errors: ["Uncaught TypeError: x is undefined"] }] }) : quiz({})));
    const steps = [{ action: "click", text: "Bắt đầu làm bài" }];
    const { c, llm } = await makeController([
      { calls: [{ name: "check_page", args: { url: "http://localhost:5173/", steps } }] },
      { calls: [{ name: "write_file", args: { path: "src/App.jsx", content: "y" } }] },
      { text: "Xong" },
      { text: "Xong lần 2" },
    ], { profile: "code", env });
    await c.send("sửa nút");
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.slice(1).every((x) => JSON.stringify(x.steps) === JSON.stringify(steps))).toBe(true);
    expect(llm.calls.flatMap((x) => x.messages).some((m) => m.role === "user" && String(m.content).includes("chạy lại luồng bấm") && String(m.content).includes("x is undefined"))).toBe(true);
  });

  it("trang không có nút nào: không nhắc bấm thử", async () => {
    const { env, seen } = mkEnv(() => base({ text: "Đồng hồ 22:59" }));
    const { c, llm } = await makeController([
      { calls: [{ name: "write_file", args: { path: "index.html", content: "<h1>x</h1>" } }] },
      { text: "Xong" },
    ], { profile: "code", env });
    await c.send("làm đồng hồ");
    expect(seen).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
  });
});
