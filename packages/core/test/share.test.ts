import { describe, expect, it } from "vitest";
import { buildSharePayload, MemoryEnv, redactForShare, type HistoryItem } from "../src";
import { makeController, type Step } from "./helpers";

describe("che thông tin nhạy cảm trước khi chia sẻ", () => {
  it("che khoá/mật khẩu/token và dữ liệu cá nhân, đếm số chỗ che", () => {
    const text = [
      "key của tôi: sk-abcdefghijklmnop1234567890",
      "password: Matkhau12345",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      "CCCD của em: 001203012345, SĐT 0912 345 678, email an.nguyen@st.neu.edu.vn",
      "Câu hỏi bình thường về bảng điểm học phần Kinh tế vi mô.",
    ].join("\n");
    const r = redactForShare(text);
    expect(r.text).not.toMatch(/sk-abcdef|Matkhau12345|abcdefghijklmnopqrstuvwxyz0123456789|001203012345|0912 345 678|an\.nguyen/);
    expect(r.text).toContain("Câu hỏi bình thường về bảng điểm");
    expect(r.count).toBeGreaterThanOrEqual(5);
  });

  it("văn bản sạch không bị đổi", () => {
    const t = "Hãy tạo bảng điểm 24 sinh viên và tính trung bình theo trọng số 10/30/60.";
    expect(redactForShare(t)).toEqual({ text: t, count: 0 });
  });
});

describe("dựng bản chụp để chia sẻ", () => {
  const meta = { title: "Bảng điểm", profile: "work", version: "0.7.0", platform: "darwin arm64" };
  it("bỏ tin nhắn nội bộ, rút gọn công cụ, giữ thứ tự, che nhạy cảm và đếm", () => {
    const h: HistoryItem[] = [
      { kind: "user", text: "Tạo bảng điểm. Mật khẩu: abc12345678" },
      { kind: "user", text: "[Hệ thống] nhắc nội bộ không được lộ" },
      { kind: "tool", name: "create_xlsx", text: "x".repeat(2000) },
      { kind: "assistant", text: "Xong rồi." },
    ];
    const p = buildSharePayload(h, meta);
    expect(p.items.map((i) => i.k)).toEqual(["user", "tool", "assistant"]);
    expect(p.items[0].t).not.toContain("abc12345678");
    expect(p.items[1].t.length).toBeLessThanOrEqual(400);
    expect(p.items[1].n).toBe("create_xlsx");
    expect(p.redactions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(p)).not.toContain("nhắc nội bộ");
  });

  it("giới hạn số mục và kích thước", () => {
    const h: HistoryItem[] = Array.from({ length: 600 }, (_, i) => ({ kind: i % 2 ? "assistant" : "user", text: `Nội dung dòng số ${i} ` + "chữ ".repeat(1500) })) as HistoryItem[];
    const p = buildSharePayload(h, meta);
    expect(p.items.length).toBeLessThanOrEqual(400);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(400 * 1024);
  });
});

const diag = (fetchImpl: typeof fetch) => ({ endpoint: "https://ai.test/agent/diag", version: "0.7.0", platform: "darwin arm64", headers: () => ({ Authorization: "Bearer T" }), fetch: fetchImpl, enabled: () => false });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

describe("chia sẻ cuộc trò chuyện qua controller", () => {
  it("xem trước, tạo liên kết, liệt kê và thu hồi; gửi đã che nhạy cảm kèm đăng nhập", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/share")) return json({ ok: true, id: "AbCdEfGhIjKlMnOpQrStUv" });
      if (url.endsWith("/shares")) return json({ ok: true, items: [{ id: "AbCdEfGhIjKlMnOpQrStUv", title: "Bảng điểm", ts: 1, views: 3, nitems: 4, redactions: 1 }, { id: "bad id", title: "x" }] });
      if (url.endsWith("/share/revoke")) return json({ ok: true });
      return json({}, 404);
    }) as never;
    const { c } = await makeController([{ text: "Đây là câu trả lời." }], { profile: "work", diagnostics: diag(f) });
    expect((await c.sharePreview()).ok).toBe(false); // chưa có nội dung

    await c.send("Tạo bảng điểm, mật khẩu: Matkhau12345");
    const pv = await c.sharePreview();
    expect(pv).toMatchObject({ ok: true });
    expect(pv.items).toBeGreaterThanOrEqual(2);
    expect(pv.redactions).toBeGreaterThanOrEqual(1);

    const r = await c.shareChat({ title: "Bảng điểm của tôi" });
    expect(r).toMatchObject({ ok: true, id: "AbCdEfGhIjKlMnOpQrStUv", url: "https://ai.test/agent/share/AbCdEfGhIjKlMnOpQrStUv" });
    const sent = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe("https://ai.test/agent/share");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer T");
    expect(sent).toMatchObject({ v: 2, title: "Bảng điểm của tôi", profile: "work", version: "0.7.0" });
    expect(JSON.stringify(sent)).not.toContain("Matkhau12345");

    const mine = await c.sharedChats();
    expect(mine).toEqual([{ id: "AbCdEfGhIjKlMnOpQrStUv", title: "Bảng điểm", url: "https://ai.test/agent/share/AbCdEfGhIjKlMnOpQrStUv", ts: 1, views: 3, items: 4, redactions: 1 }]);
    expect((await c.unshareChat("AbCdEfGhIjKlMnOpQrStUv")).ok).toBe(true);
    expect((await c.unshareChat("../etc")).ok).toBe(false);
  });

  it("lỗi mạng/hết phiên/quá giới hạn: báo nhẹ nhàng, không ném lỗi; không có máy chủ thì từ chối ngay", async () => {
    const mk = (res: () => Response | Promise<Response>) => makeController([{ text: "ok" }], { diagnostics: diag((async () => res()) as never) });
    const a = await mk(() => json({}, 401));
    await a.c.send("xin chào bạn");
    expect((await a.c.shareChat({})).message).toMatch(/đăng nhập/);
    const b = await mk(() => json({ ok: false, message: "Bạn đã chia sẻ khá nhiều trong hôm nay." }, 429));
    await b.c.send("xin chào bạn");
    expect((await b.c.shareChat({})).message).toMatch(/khá nhiều/);
    const c2 = await mk(() => Promise.reject(new Error("net")));
    await c2.c.send("xin chào bạn");
    expect((await c2.c.shareChat({})).ok).toBe(false);
    const none = await makeController([{ text: "ok" }], {});
    await none.c.send("xin chào bạn");
    expect((await none.c.shareChat({})).message).toMatch(/chưa nối/);
  });
});

describe("chia sẻ đủ thông tin để cải tiến (bản v2)", () => {
  const sentOf = async (steps: Step[], after?: (c: any) => Promise<void>) => {
    const env = new MemoryEnv("/ws", {});
    (env as any).exec = async () => ({ output: "OK", code: 0, timedOut: false });
    const calls: RequestInit[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push(init);
      return url.endsWith("/share") ? json({ ok: true, id: "AbCdEfGhIjKlMnOpQrStUv" }) : json({}, 404);
    }) as never;
    const { c } = await makeController(steps, { profile: "code", diagnostics: diag(f), env, settings: { mode: "auto" } });
    await c.send("Làm ứng dụng trắc nghiệm Toán lớp 6");
    if (after) await after(c);
    const pv = await c.sharePreview();
    const r = await c.shareChat({});
    return { pv, r, sent: calls.length ? JSON.parse(calls[0].body as string) : null };
  };

  it("sau khi tóm tắt ngữ cảnh vẫn chia sẻ được, còn đủ câu hỏi gốc (trước đây báo 'chưa có nội dung')", async () => {
    const { pv, sent } = await sentOf(
      [{ calls: [{ name: "write_file", args: { path: "app.js", content: "console.log(1)" } }] }, { text: "Xong." }, { text: "Người dùng muốn app trắc nghiệm; đã tạo app.js." }],
      async (c) => void (await c.send("/compact")),
    );
    expect(pv.ok).toBe(true);
    const users = sent.items.filter((i: any) => i.k === "user").map((i: any) => i.t);
    expect(users).toContain("Làm ứng dụng trắc nghiệm Toán lớp 6");
    expect(sent.items.some((i: any) => i.k === "summary" && /trắc nghiệm/.test(i.t))).toBe(true);
  });

  it("kèm đối số và kết quả công cụ (đánh dấu lỗi), lời nhắc hệ thống, mô hình và chế độ; vẫn che bí mật", async () => {
    const { sent } = await sentOf([
      { calls: [{ name: "read_file", args: { path: "khong-co.js" } }] },
      { calls: [{ name: "write_file", args: { path: "app.js", content: "const token = 'sk-abcdefghijklmnop1234567890';\nconsole.log(1)" } }] },
      { text: "Xong rồi!" },
      { calls: [{ name: "bash", args: { command: "node app.js" } }] },
      { text: "Đã chạy." },
    ]);
    expect(sent).toMatchObject({ v: 2, profile: "code", version: "0.7.0", mode: "auto" });
    expect(typeof sent.model).toBe("string");
    const tools = sent.items.filter((i: any) => i.k === "tool");
    const read = tools.find((i: any) => i.n === "read_file");
    expect(read.t).toContain("khong-co.js");
    expect(read.e).toBe(true);
    expect(read.r).toMatch(/^Lỗi/);
    const write = tools.find((i: any) => i.n === "write_file");
    expect(write.t).toContain("console.log(1)");
    expect(write.e).toBeFalsy();
    expect(JSON.stringify(sent)).not.toContain("sk-abcdefghijklmnop");
    expect(sent.items.some((i: any) => i.k === "system" && /chạy thử|kiểm/i.test(i.t))).toBe(true);
  });
});
