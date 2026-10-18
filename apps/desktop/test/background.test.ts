import { describe, expect, it } from "vitest";
import type { ScheduledTask } from "@neu/agent-core";
import { applyPatch, atLoginSupported, authNotice, closeAction, DEFAULT_PREFS, hasActiveTasks, HIDDEN_ARG, keepEffective, loginItemFor, nextTaskLabel, readPrefs, shortName, startHidden, trayMenu } from "../src/background";

const at = (y: number, mo: number, d: number, hh: number, mm: number) => new Date(y, mo - 1, d, hh, mm).getTime();
const NOW = at(2026, 10, 18, 7, 0);
const task = (o: Partial<ScheduledTask> = {}): ScheduledTask => ({ id: "t1", name: "Báo cáo", prompt: "Tổng hợp", every: { kind: "daily", at: "08:00" }, enabled: true, profile: "work", projectId: "default", createdAt: at(2026, 10, 1, 0, 0), lastRun: { at: at(2026, 10, 17, 8, 0), status: "ok", summary: "x" }, ...o });

describe("chạy nền ở khay: lựa chọn", () => {
  it("mặc định tắt hết; tệp lạ/hỏng coi như tắt; mở cùng máy không bật được khi chưa giữ chạy nền", () => {
    expect(readPrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(readPrefs({ keep: "true", atLogin: 1 })).toEqual(DEFAULT_PREFS);
    expect(readPrefs({ keep: false, atLogin: true, told: true })).toEqual({ keep: false, atLogin: false, told: true });
    expect(readPrefs({ keep: true, atLogin: true })).toEqual({ keep: true, atLogin: true, told: false });
  });
  it("tắt chạy nền thì tắt luôn mở cùng máy; bản không hỗ trợ thì mở cùng máy luôn tắt", () => {
    const on = applyPatch(DEFAULT_PREFS, { keep: true }, true);
    expect(on).toEqual({ keep: true, atLogin: false, told: false });
    const both = applyPatch(on, { atLogin: true }, true);
    expect(both.atLogin).toBe(true);
    expect(applyPatch(both, { keep: false }, true)).toEqual({ keep: false, atLogin: false, told: false });
    expect(applyPatch(DEFAULT_PREFS, { atLogin: true }, true).atLogin).toBe(false); // chưa giữ chạy nền
    expect(applyPatch(on, { atLogin: true }, false).atLogin).toBe(false); // bản dev / Microsoft Store / Linux
    expect(applyPatch({ ...both, told: true }, { keep: true }, true).told).toBe(true);
  });
  it("mở cùng máy chỉ ở bản cài thật trên macOS/Windows", () => {
    expect(atLoginSupported({ platform: "darwin", packaged: true, windowsStore: false, smoke: false })).toBe(true);
    expect(atLoginSupported({ platform: "win32", packaged: true, windowsStore: false, smoke: false })).toBe(true);
    expect(atLoginSupported({ platform: "win32", packaged: true, windowsStore: true, smoke: false })).toBe(false);
    expect(atLoginSupported({ platform: "linux", packaged: true, windowsStore: false, smoke: false })).toBe(false);
    expect(atLoginSupported({ platform: "darwin", packaged: false, windowsStore: false, smoke: false })).toBe(false);
    expect(atLoginSupported({ platform: "darwin", packaged: true, windowsStore: false, smoke: true })).toBe(false);
    expect(loginItemFor(true, "win32")).toEqual({ openAtLogin: true, args: [HIDDEN_ARG] });
    expect(loginItemFor(false, "darwin")).toEqual({ openAtLogin: false });
  });
});

describe("chạy nền ở khay: đóng cửa sổ / khởi động", () => {
  it("chỉ ẩn xuống khay khi đã bật VÀ có tác vụ đang bật; đang thoát hẳn hoặc kiểm thử đầu-cuối thì đóng thật", () => {
    const base = { quitting: false, keep: true, hasTasks: true, smoke: false };
    expect(closeAction(base)).toBe("hide");
    expect(closeAction({ ...base, keep: false })).toBe("close"); // mặc định
    expect(closeAction({ ...base, hasTasks: false })).toBe("close");
    expect(closeAction({ ...base, quitting: true })).toBe("close"); // Thoát hẳn, Cmd+Q, cài bản cập nhật
    expect(closeAction({ ...base, smoke: true })).toBe("close");
    expect(keepEffective({ keep: true, hasTasks: true, smoke: true })).toBe(false);
  });
  it("mở ẩn ở khay chỉ khi được mở cùng máy và chạy nền có hiệu lực", () => {
    expect(startHidden({ keep: true, hasTasks: true, smoke: false, openedAtLogin: true })).toBe(true);
    expect(startHidden({ keep: true, hasTasks: true, smoke: false, openedAtLogin: false })).toBe(false);
    expect(startHidden({ keep: true, hasTasks: false, smoke: false, openedAtLogin: true })).toBe(false); // không có tác vụ: hiện cửa sổ như thường
    expect(startHidden({ keep: false, hasTasks: true, smoke: false, openedAtLogin: true })).toBe(false);
  });
  it("tác vụ đang bật = còn lịch chạy (lịch một lần đã chạy xong hoặc tác vụ tắt thì không tính)", () => {
    expect(hasActiveTasks([], NOW)).toBe(false);
    expect(hasActiveTasks([task({ enabled: false })], NOW)).toBe(false);
    expect(hasActiveTasks([task({ every: { kind: "once", date: "2026-10-10", at: "08:00" }, enabled: true, lastRun: undefined })], NOW)).toBe(false); // đã quá giờ hẹn lâu
    expect(hasActiveTasks([task({ enabled: false }), task({ id: "t2" })], NOW)).toBe(true);
  });
});

describe("chạy nền ở khay: menu", () => {
  it("tên tác vụ một dòng, cắt ngắn", () => {
    expect(shortName("  Báo cáo\n tuần  ")).toBe("Báo cáo tuần");
    const long = shortName("x".repeat(60));
    expect(long.length).toBe(28);
    expect(long.endsWith("…")).toBe(true);
  });
  it("dòng tác vụ kế tiếp: tác vụ gần nhất, giờ ngắn; không có thì nói rõ", () => {
    expect(nextTaskLabel([], NOW)).toBe("Không có tác vụ sắp chạy");
    expect(nextTaskLabel([task({ enabled: false })], NOW)).toBe("Không có tác vụ sắp chạy");
    const later = task({ id: "t2", name: "Tuần", every: { kind: "weekly", day: 1, at: "09:00" } });
    expect(nextTaskLabel([later, task()], NOW)).toBe("Kế tiếp: Báo cáo · 08:00");
    expect(nextTaskLabel([task({ every: { kind: "daily", at: "06:00" } })], NOW)).toBe("Kế tiếp: Báo cáo · sắp chạy");
    expect(nextTaskLabel([task({ every: { kind: "daily", at: "06:00" }, lastRun: { at: at(2026, 10, 18, 6, 0), status: "ok", summary: "" } })], NOW)).toBe("Kế tiếp: Báo cáo · mai 06:00");
  });
  it("menu có Mở, tác vụ kế tiếp, Tạm dừng, Thoát hẳn; chỉ có tên tác vụ, không có lời nhắc hay kết quả", () => {
    const t = task({ name: "Tổng hợp điểm lớp K65 gửi khoa", prompt: "BÍ MẬT lời nhắc", lastRun: { at: at(2026, 10, 17, 8, 0), status: "ok", summary: "KẾT QUẢ riêng tư" } });
    const m = trayMenu({ brand: "NEU Agent", tasks: [t], now: NOW, paused: false, signedIn: true });
    expect(m.map((x) => x.id)).toEqual(["open", "sep", "next", "pause", "sep", "quit"]);
    expect(m[0]).toEqual({ id: "open", label: "Mở NEU Agent" });
    expect(m.find((x) => x.id === "quit")).toEqual({ id: "quit", label: "Thoát hẳn" });
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/BÍ MẬT|KẾT QUẢ|default|work/);
    const off = trayMenu({ brand: "NEU Agent", tasks: [t], now: NOW, paused: true, signedIn: false });
    expect(off.find((x) => x.id === "pause")).toMatchObject({ checked: true });
    expect(off.some((x) => x.id === "signin")).toBe(true);
  });
});

describe("chạy nền: phiên đăng nhập hết hạn", () => {
  it("có tác vụ đến hạn mà chưa đăng nhập: báo một lần cho mỗi lần mất đăng nhập", () => {
    let s = authNotice({ signedIn: false, dueCount: 0, notified: false });
    expect(s).toEqual({ notify: false, notified: false });
    s = authNotice({ signedIn: false, dueCount: 1, notified: s.notified });
    expect(s).toEqual({ notify: true, notified: true });
    s = authNotice({ signedIn: false, dueCount: 2, notified: s.notified });
    expect(s.notify).toBe(false); // không báo lặp
    s = authNotice({ signedIn: true, dueCount: 2, notified: s.notified });
    expect(s).toEqual({ notify: false, notified: false }); // đăng nhập lại: lần mất sau lại báo
    expect(authNotice({ signedIn: false, dueCount: 1, notified: s.notified }).notify).toBe(true);
  });
});
