import { describe, expect, it } from "vitest";
import type { QuotaInfo } from "@neu/agent-core";
import { contextTitle, contextView, fmtInt, fmtTokens, mergeParts, quotaView, resetText } from "../src/context-info";

const usage = { promptTokens: 12000, completionTokens: 3400, contextPct: 38, calls: 7 };

describe("định dạng token", () => {
  it("k và M, một chữ số thập phân kiểu Việt", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(1000)).toBe("1k");
    expect(fmtTokens(381_700)).toBe("381,7k");
    expect(fmtTokens(32_768)).toBe("32,8k");
    expect(fmtTokens(999_950)).toBe("1M");
    expect(fmtTokens(1_000_000)).toBe("1M");
    expect(fmtTokens(1_500_000)).toBe("1,5M");
  });
  it("giá trị lạ không làm vỡ", () => {
    expect(fmtTokens(-5)).toBe("0");
    expect(fmtTokens(Number.NaN)).toBe("0");
    expect(fmtInt(1234567)).toBe("1.234.567");
    expect(fmtInt(12)).toBe("12");
  });
});

describe("gộp các phần của cửa sổ ngữ cảnh", () => {
  it("gộp trùng tên, bỏ phần rỗng, giữ thứ tự gốc", () => {
    expect(mergeParts([{ name: "Công cụ", tokens: 100 }, { name: "Rỗng", tokens: 0 }, { name: "Tin nhắn", tokens: 50 }, { name: "Công cụ", tokens: 20 }, { name: "Âm", tokens: -4 }]))
      .toEqual([{ name: "Công cụ", tokens: 120 }, { name: "Tin nhắn", tokens: 50 }]);
  });
  it("quá nhiều phần thì dồn các phần nhỏ nhất vào 'Khác'", () => {
    const parts = ["a", "b", "c", "d", "e", "f", "g", "h"].map((name, i) => ({ name, tokens: (i + 1) * 10 }));
    const m = mergeParts(parts, 4);
    expect(m).toHaveLength(4);
    expect(m.map((p) => p.name)).toEqual(["f", "g", "h", "Khác"]);
    expect(m[3].tokens).toBe(10 + 20 + 30 + 40 + 50);
    expect(m.reduce((s, p) => s + p.tokens, 0)).toBe(parts.reduce((s, p) => s + p.tokens, 0));
  });
});

describe("số liệu cửa sổ ngữ cảnh", () => {
  it("có `context`: số token thật, % theo đã dùng/giới hạn, thanh co theo cửa sổ", () => {
    const v = contextView({ ...usage, context: { used: 381_700, limit: 1_000_000, parts: [{ name: "Lời nhắc hệ thống", tokens: 4000 }, { name: "Tin nhắn của bạn", tokens: 200_000 }, { name: "Kết quả công cụ", tokens: 177_700 }] } })!;
    expect(v.pct).toBe(38);
    expect(v.approx).toBe(false);
    expect(v.free).toBe(618_300);
    expect(contextTitle(v)).toBe("381,7k / 1M (38%)");
    expect(v.segments.map((s) => s.name)).toEqual(["Lời nhắc hệ thống", "Tin nhắn của bạn", "Kết quả công cụ"]);
    expect(v.segments[1].width).toBeCloseTo(20, 5);
    expect(v.segments.map((s) => s.color)).toEqual([0, 1, 2]);
  });
  it("tổng các phần vượt cửa sổ thì thanh không tràn", () => {
    const v = contextView({ ...usage, context: { used: 120, limit: 100, parts: [{ name: "A", tokens: 90 }, { name: "B", tokens: 30 }] } })!;
    expect(v.pct).toBe(100);
    expect(v.segments.reduce((s, p) => s + p.width, 0)).toBeCloseTo(100, 5);
    expect(v.free).toBe(0);
  });
  it("lõi cũ (không có `context`): dùng contextPct và cỡ cửa sổ trong cài đặt, đánh dấu ước lượng", () => {
    const v = contextView(usage, 32_768)!;
    expect(v.approx).toBe(true);
    expect(v.pct).toBe(38);
    expect(v.segments).toEqual([]);
    expect(contextTitle(v)).toMatch(/^~12,\dk \/ 32,8k \(38%\)$/);
    const noLimit = contextView(usage, 0)!;
    expect(contextTitle(noLimit)).toBe("38%");
  });
  it("chưa có số liệu", () => {
    expect(contextView(null)).toBeNull();
  });
});

describe("hạn mức hôm nay", () => {
  const q = (p: Partial<QuotaInfo>): QuotaInfo => ({ limit: 500_000, used: 120_000, remaining: 380_000, pct: 24, state: "ok", resetAt: 0, ...p });
  const now = new Date(2026, 9, 11, 10, 30);

  it("ẩn khi không giới hạn hoặc không có thông tin", () => {
    expect(quotaView(null, now)).toBeNull();
    expect(quotaView(undefined, now)).toBeNull();
    expect(quotaView(q({ state: "unlimited" }), now)).toBeNull();
    expect(quotaView(q({ limit: 0 }), now)).toBeNull();
  });
  it("bình thường, sắp hết, hết", () => {
    expect(quotaView(q({}), now)).toMatchObject({ used: "120k", limit: "500k", pct: 24, level: "ok", text: "", reset: null });
    expect(quotaView(q({ state: "warn", pct: 85 }), now)).toMatchObject({ level: "warn", text: "Sắp hết hạn mức" });
    expect(quotaView(q({ state: "exceeded", used: 500_000, pct: 100 }), now)).toMatchObject({ level: "err", text: "Đã hết hạn mức hôm nay" });
    expect(quotaView(q({ state: "grace", pct: 103 }), now)!.pct).toBe(100);
  });
  it("giờ đặt lại: hôm nay / ngày mai / ngày khác", () => {
    const at = (d: Date) => d.getTime() / 1000;
    expect(resetText(at(new Date(2026, 9, 12, 0, 0)), now)).toBe("Đặt lại lúc 00:00 ngày mai");
    expect(resetText(at(new Date(2026, 9, 11, 23, 5)), now)).toBe("Đặt lại lúc 23:05 hôm nay");
    expect(resetText(at(new Date(2026, 9, 15, 7, 0)), now)).toBe("Đặt lại lúc 07:00 ngày 15/10");
    expect(resetText(0, now)).toBeNull();
  });
});
