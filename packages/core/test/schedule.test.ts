import { describe, expect, it } from "vitest";
import { describeEvery, dueState, MAX_RUNS_PER_DAY, MAX_TASKS, MIN_MINUTES, normalizeSettings, sanitizeEvery, sanitizeTasks, withRun, type LlmClient, type LocalController, type ScheduledTask } from "../src";
import { FakeLlm, makeController, type Step } from "./helpers";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
// 2026-10-19 là thứ Hai
const MON_8 = at(2026, 10, 19, 8, 0);
const base = (every: ScheduledTask["every"], createdAt: number): ScheduledTask => ({ id: "t1", name: "n", prompt: "p", every, enabled: true, profile: "code", projectId: "", createdAt });

describe("lịch: logic thuần", () => {
  it("sanitizeEvery chặn lịch sai và N quá nhỏ", () => {
    expect(sanitizeEvery({ kind: "minutes", n: MIN_MINUTES })).toEqual({ kind: "minutes", n: MIN_MINUTES });
    for (const bad of [{ kind: "minutes", n: MIN_MINUTES - 1 }, { kind: "minutes", n: 45.5 }, { kind: "minutes", n: 99999 }, { kind: "daily", at: "24:00" }, { kind: "daily", at: "8:00" }, { kind: "weekly", day: 7, at: "08:00" }, { kind: "weekly", at: "08:00" }, { kind: "cron", at: "08:00" }, null, "x"])
      expect(sanitizeEvery(bad), JSON.stringify(bad)).toBeNull();
    expect(sanitizeEvery({ kind: "weekly", day: 1, at: "08:30" })).toEqual({ kind: "weekly", day: 1, at: "08:30" });
  });

  it("mỗi N phút: đến hạn sau N phút kể từ lần chạy cuối (hoặc lúc tạo)", () => {
    const t = base({ kind: "minutes", n: 60 }, MON_8);
    expect(dueState(t, MON_8 + 59 * 60_000)).toBeNull();
    expect(dueState(t, MON_8 + 60 * 60_000)).toBe("run");
    const ran = withRun(t, MON_8 + 61 * 60_000, { status: "ok", summary: "x" }, true);
    expect(dueState(ran, MON_8 + 100 * 60_000)).toBeNull();
    expect(dueState(ran, MON_8 + 121 * 60_000)).toBe("run");
    expect(dueState({ ...t, enabled: false }, MON_8 + 9e9)).toBeNull();
  });

  it("hằng ngày: chạy một lần sau giờ hẹn; chưa tới giờ hoặc đã chạy hôm nay thì thôi", () => {
    const t = base({ kind: "daily", at: "08:00" }, at(2026, 10, 18, 20, 0));
    expect(dueState(t, at(2026, 10, 19, 7, 59))).toBeNull();
    expect(dueState(t, at(2026, 10, 19, 8, 1))).toBe("run");
    const ran = withRun(t, at(2026, 10, 19, 8, 1), { status: "ok", summary: "" }, true);
    expect(dueState(ran, at(2026, 10, 19, 12, 0))).toBeNull();
    expect(dueState(ran, at(2026, 10, 20, 8, 5))).toBe("run");
  });

  it("hằng tuần: đúng thứ; ứng dụng đóng quá 6 giờ qua giờ hẹn thì bỏ lỡ chứ không chạy bù", () => {
    const t = base({ kind: "weekly", day: 1, at: "08:00" }, at(2026, 10, 14, 9, 0)); // tạo thứ Tư
    expect(dueState(t, at(2026, 10, 16, 8, 30))).toBeNull(); // thứ Sáu
    expect(dueState(t, at(2026, 10, 19, 8, 30))).toBe("run"); // thứ Hai
    expect(dueState(t, at(2026, 10, 19, 13, 0))).toBe("run"); // trễ 5 giờ vẫn chạy bù
    expect(dueState(t, at(2026, 10, 19, 15, 0))).toBe("missed");
    expect(dueState(t, at(2026, 10, 21, 9, 0))).toBe("missed");
  });

  it("withRun đếm số lần trong ngày, sang ngày thì đếm lại, 'skipped' không tính", () => {
    let t = base({ kind: "minutes", n: 30 }, MON_8);
    t = withRun(t, MON_8, { status: "ok", summary: "" }, true);
    t = withRun(t, MON_8 + 1000, { status: "ok", summary: "" }, true);
    expect(t.runs).toBe(2);
    t = withRun(t, MON_8 + 2000, { status: "skipped", summary: "" }, false);
    expect(t.runs).toBe(2);
    expect(withRun(t, MON_8 + 86_400_000, { status: "ok", summary: "" }, true).runs).toBe(1);
  });

  it("describeEvery và sanitizeTasks (loại mục hỏng, cắt độ dài, trùng mã)", () => {
    expect(describeEvery({ kind: "weekly", day: 1, at: "08:00" })).toBe("Thứ hai hằng tuần 08:00");
    expect(describeEvery({ kind: "minutes", n: 90 })).toBe("Mỗi 90 phút");
    const good = base({ kind: "daily", at: "07:30" }, 1);
    const out = sanitizeTasks([good, good, { ...good, id: "../x" }, { ...good, id: "b", every: { kind: "x" } }, { ...good, id: "c", prompt: "" }, { ...good, id: "d", prompt: "a".repeat(5000) }, 5, null]);
    expect(out.map((t) => t.id)).toEqual(["t1", "d"]);
    expect(out[1].prompt).toHaveLength(2000);
    expect(normalizeSettings({}).tasks).toBeUndefined();
    expect(normalizeSettings({ tasks: "rác" as never }).tasks).toEqual([]);
  });
});

const EVERY = { kind: "minutes", n: 60 } as const;

async function setup(script: Step[] | ConstructorParameters<typeof FakeLlm>[0], extra: Parameters<typeof makeController>[1] = {}) {
  const clock = { now: MON_8 };
  const r = await makeController(script, { ...extra, extra: { tasks: { now: () => clock.now } } });
  // các phiên của tác vụ định kỳ dùng chung `llm` của bộ điều khiển: thay bằng mô hình giả
  (r.c as unknown as { llm: LlmClient }).llm = r.llm as unknown as LlmClient;
  return { ...r, clock };
}
const lastRun = async (c: LocalController) => (await c.taskList())[0].lastRun;

describe("tác vụ định kỳ: quản lý", () => {
  it("thêm, liệt kê, tắt/bật, xoá; lưu bền vào cài đặt và không lẫn dự án khác", async () => {
    const { c, settings } = await setup([{ text: "ok" }]);
    const r = await c.taskAdd({ name: "Báo cáo tuần", prompt: "Tổng hợp README", every: { kind: "weekly", day: 1, at: "08:00" } });
    expect("ok" in r).toBe(true);
    expect(settings().tasks).toHaveLength(1);
    expect((await c.taskList()).map((t) => t.name)).toEqual(["Báo cáo tuần"]);
    const id = (await c.taskList())[0].id;
    await c.taskSet(id, false);
    expect((await c.taskList())[0].enabled).toBe(false);
    await c.saveSettings({ thinking: true }); // lưu cài đặt khác không làm mất tác vụ
    expect(settings().tasks).toHaveLength(1);
    await c.taskRemove(id);
    expect(await c.taskList()).toEqual([]);
    expect(settings().tasks).toEqual([]);
  });

  it("từ chối lịch sai, thiếu tên/việc, và quá số tác vụ tối đa", async () => {
    const { c } = await setup([{ text: "ok" }]);
    expect(await c.taskAdd({ name: "", prompt: "x", every: EVERY })).toHaveProperty("error");
    expect(await c.taskAdd({ name: "a", prompt: " ", every: EVERY })).toHaveProperty("error");
    expect(await c.taskAdd({ name: "a", prompt: "x", every: { kind: "minutes", n: 1 } })).toHaveProperty("error");
    for (let i = 0; i < MAX_TASKS; i++) expect(await c.taskAdd({ name: "t" + i, prompt: "x", every: EVERY })).toHaveProperty("ok", true);
    expect(await c.taskAdd({ name: "thừa", prompt: "x", every: EVERY })).toHaveProperty("error");
  });
});

describe("tác vụ định kỳ: chạy", () => {
  it("đến hạn thì chạy bằng phiên riêng và ghi kết quả; chưa đến hạn thì không gọi mô hình", async () => {
    const { c, llm, clock, events } = await setup([{ text: "Đã tổng hợp xong." }]);
    await c.taskAdd({ name: "n", prompt: "Làm báo cáo", every: EVERY });
    clock.now += 59 * 60_000;
    await c.tasksTick();
    expect(llm.calls).toHaveLength(0);
    clock.now += 2 * 60_000;
    await c.tasksTick();
    expect(llm.calls).toHaveLength(1);
    expect(JSON.stringify(llm.calls[0].messages)).toContain("Làm báo cáo");
    const lr = await lastRun(c);
    expect(lr).toMatchObject({ status: "ok", at: clock.now });
    expect(lr!.summary).toContain("Đã tổng hợp xong.");
    expect(events.some((e) => e.type === "notice" && /Tác vụ định kỳ/.test(e.text))).toBe(true);
    // vừa chạy: chưa đến lần sau
    await c.tasksTick();
    expect(llm.calls).toHaveLength(1);
  });

  it("quyền chặt: ghi trong dự án được; tệp nhạy cảm, tệp cấu hình agent bị từ chối; không bao giờ hỏi người dùng", async () => {
    const script: Step[] = [
      { calls: [{ name: "write_file", args: { path: "bao-cao.md", content: "# Báo cáo" } }, { name: "write_file", args: { path: ".env.local", content: "X=1" } }, { name: "write_file", args: { path: "AGENTS.md", content: "đổi luật" } }] },
      { text: "Xong, có thao tác bị từ chối." },
    ];
    // người dùng "dễ tính": nếu có hỏi thì đồng ý — tác vụ định kỳ vẫn không được hưởng
    const { c, env, requests, clock } = await setup(script, { decide: () => ({ allow: true }), defaults: { mode: "bypass" } });
    await c.taskAdd({ name: "n", prompt: "p", every: EVERY });
    clock.now += 61 * 60_000;
    await c.tasksTick();
    expect(requests).toHaveLength(0); // không hiện yêu cầu quyền cho người dùng
    expect(new TextDecoder().decode(await env.readBytes("/ws/bao-cao.md"))).toBe("# Báo cáo");
    expect(await env.stat("/ws/.env.local")).toBeNull();
    expect(await env.stat("/ws/AGENTS.md")).toBeNull();
    const lr = (await lastRun(c))!;
    expect(lr.status).toBe("ok");
    expect(lr.summary).toMatch(/2 thao tác bị từ chối/);
  });

  it("tác vụ bị tắt thì không chạy; agent đang bận thì đợi lượt sau", async () => {
    const { c, llm, clock } = await setup([{ text: "ok" }]);
    await c.taskAdd({ name: "n", prompt: "p", every: EVERY });
    clock.now += 61 * 60_000;
    (c as unknown as { busy: boolean }).busy = true;
    await c.tasksTick();
    expect(llm.calls).toHaveLength(0);
    (c as unknown as { busy: boolean }).busy = false;
    await c.taskSet((await c.taskList())[0].id, false);
    await c.tasksTick();
    expect(llm.calls).toHaveLength(0);
    await c.taskSet((await c.taskList())[0].id, true);
    await c.tasksTick();
    expect(llm.calls).toHaveLength(1);
  });

  it("hết hạn mức token thì bỏ qua, ghi lý do, không gọi mô hình", async () => {
    const { c, llm, clock } = await setup([{ text: "ok" }]);
    (c as unknown as { quota: unknown }).quota = { state: "exceeded", limit: 10, used: 11, remaining: 0, pct: 110, resetAt: 0 };
    await c.taskAdd({ name: "n", prompt: "p", every: EVERY });
    clock.now += 61 * 60_000;
    await c.tasksTick();
    expect(llm.calls).toHaveLength(0);
    expect(await lastRun(c)).toMatchObject({ status: "skipped", summary: expect.stringContaining("hạn mức") });
  });

  it(`giới hạn ${MAX_RUNS_PER_DAY} lần/ngày/tác vụ (kể cả "Chạy ngay"), sang ngày mới thì chạy lại`, async () => {
    const { c, llm, clock } = await setup([{ text: "ok" }]);
    await c.taskAdd({ name: "n", prompt: "p", every: EVERY });
    const id = (await c.taskList())[0].id;
    for (let i = 0; i < MAX_RUNS_PER_DAY; i++) expect(await c.taskRunNow(id)).toMatchObject({ status: "ok" });
    expect(await c.taskRunNow(id)).toMatchObject({ status: "skipped", summary: expect.stringContaining("giới hạn mỗi ngày") });
    expect(llm.calls).toHaveLength(MAX_RUNS_PER_DAY);
    clock.now += 86_400_000;
    expect(await c.taskRunNow(id)).toMatchObject({ status: "ok" });
  });

  it("bỏ lỡ giờ hẹn quá lâu: ghi 'bỏ lỡ', không chạy", async () => {
    const { c, llm, clock } = await setup([{ text: "ok" }]);
    await c.taskAdd({ name: "n", prompt: "p", every: { kind: "daily", at: "08:00" } });
    clock.now = at(2026, 10, 20, 20, 0); // sáng hôm sau ứng dụng đóng, tối mới mở
    await c.tasksTick();
    expect(llm.calls).toHaveLength(0);
    expect(await lastRun(c)).toMatchObject({ status: "skipped", summary: expect.stringContaining("Bỏ lỡ") });
  });

  it("lỗi mô hình được ghi lại, không làm hỏng bộ điều khiển; chạy xong agent vẫn rảnh", async () => {
    const { c, llm, clock } = await setup(() => {
      throw new Error("mô hình hỏng");
    });
    await c.taskAdd({ name: "n", prompt: "p", every: EVERY });
    clock.now += 61 * 60_000;
    await c.tasksTick();
    expect(llm.calls).toHaveLength(1);
    expect(await lastRun(c)).toMatchObject({ status: "error" });
    expect((await c.getState()).busy).toBe(false);
  });

  it("chẩn đoán không nhận gì từ tác vụ định kỳ (không nội dung, không số liệu lượt)", async () => {
    const sent: string[] = [];
    const fetch = (async (_u: string, init: { body: string }) => (sent.push(init.body), new Response("{}"))) as unknown as typeof globalThis.fetch;
    const { c, clock } = await setup([{ text: "Bí mật 98765" }], { diagnostics: { endpoint: "/agent/diag", version: "0.1.0", platform: "web", fetch } });
    await c.taskAdd({ name: "n", prompt: "Lương của alice@neu.edu.vn", every: EVERY });
    clock.now += 61 * 60_000;
    await c.tasksTick();
    await (c as unknown as { diag?: { flush(): Promise<unknown> } }).diag?.flush();
    expect(sent.join("")).not.toMatch(/alice|98765|Bí mật/);
    expect(sent.join("")).not.toContain('"t":"turn"');
  });
});
