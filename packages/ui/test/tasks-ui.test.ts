import { describe, expect, it } from "vitest";
import type { TaskView } from "@neu/agent-core";
import { taskStatus, when } from "../src/tasks-ui";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 19, 10, 0);
const t = (x: Partial<TaskView>): TaskView => ({ id: "a", name: "n", prompt: "p", every: { kind: "daily", at: "08:00" }, enabled: true, profile: "code", projectId: "p", createdAt: 0, ...x });

describe("hộp tác vụ định kỳ: dòng trạng thái", () => {
  it("giờ ngắn gọn: hôm nay / mai / hôm qua / ngày khác", () => {
    expect(when(at(2026, 10, 19, 8, 5), NOW)).toBe("hôm nay 08:05");
    expect(when(at(2026, 10, 20, 8, 0), NOW)).toBe("mai 08:00");
    expect(when(at(2026, 10, 18, 23, 0), NOW)).toBe("hôm qua 23:00");
    expect(when(at(2026, 11, 2, 7, 0), NOW)).toBe("07:00 02/11");
    expect(when(at(2027, 1, 2, 7, 0), NOW)).toBe("07:00 02/01/2027");
  });

  it("lần tới, lần trước, số thao tác bị từ chối, lỗi; đang chạy; lịch một lần đã xong", () => {
    expect(taskStatus(t({}), NOW)).toEqual({ next: "", last: "Chưa chạy lần nào", bad: false });
    const s = taskStatus(t({ next: at(2026, 10, 20, 8, 0), lastRun: { at: at(2026, 10, 19, 8, 0), status: "ok", summary: "x", denied: 2 } }), NOW);
    expect(s).toEqual({ next: "Lần tới: mai 08:00", last: "Lần trước: hôm nay 08:00 · Xong · 2 thao tác bị từ chối", bad: false });
    expect(taskStatus(t({ lastRun: { at: NOW, status: "error", summary: "x" } }), NOW).bad).toBe(true);
    expect(taskStatus(t({ running: true, next: NOW }), NOW).next).toBe("Đang chạy…");
    expect(taskStatus(t({ next: NOW }), NOW).next).toBe("Sắp chạy");
    expect(taskStatus(t({ enabled: false }), NOW).next).toBe("Đang tắt");
    expect(taskStatus(t({ enabled: false, every: { kind: "once", date: "2026-10-19", at: "08:00" }, lastRun: { at: NOW, status: "ok", summary: "" } }), NOW).next).toBe("Đã chạy xong lịch một lần");
  });
});
