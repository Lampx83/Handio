import { describe, expect, it } from "vitest";
import { GUIDE, GUIDE_COMMON, TIPS, searchGuide, type GuideSection } from "../src/guide-content";

const all = (tab: "code" | "work" | "design"): GuideSection[] => [...GUIDE[tab], ...GUIDE_COMMON];

describe("hướng dẫn trong ứng dụng", () => {
  it("mỗi tab có đủ mục: bắt đầu nhanh, tình huống mẫu, mẹo; và có các mục chung", () => {
    for (const tab of ["code", "work", "design"] as const) {
      const ids = GUIDE[tab].map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(["bat-dau", "tinh-huong", "meo"]));
      expect(TIPS[tab].length).toBeGreaterThanOrEqual(4);
    }
    expect(GUIDE_COMMON.map((s) => s.id)).toEqual(["noi-it", "anh-web", "phim-tat", "van-de", "rieng-tu"]);
  });

  it("nội dung đầy đặn: nhiều mẹo/tình huống, mỗi mục có tiêu đề và mô tả, câu mẫu đủ dài và không có chữ giữ chỗ (XXX, TBD, FIXME)", () => {
    let total = 0;
    for (const tab of ["code", "work", "design"] as const) {
      const ids = new Set<string>();
      for (const s of all(tab)) {
        expect(ids.has(s.id), `${tab}:${s.id} trùng`).toBe(false);
        ids.add(s.id);
        for (const i of s.items) {
          total++;
          expect(i.t.length).toBeGreaterThan(3);
          expect(i.d.length).toBeGreaterThan(15);
          if (i.tryIt) expect(i.tryIt.length).toBeGreaterThan(8);
          expect(`${i.t}${i.d}${i.tryIt ?? ""}`).not.toMatch(/\bXXX\b|\bTBD\b|\bFIXME\b/);
        }
      }
    }
    expect(total).toBeGreaterThan(70);
    expect(GUIDE.code.find((s) => s.id === "tinh-huong")!.items.length).toBeGreaterThanOrEqual(8);
    expect(GUIDE.work.find((s) => s.id === "tinh-huong")!.items.length).toBeGreaterThanOrEqual(8);
  });

  it("câu mẫu dùng đúng lệnh có thật của từng tab (không hướng dẫn lệnh không tồn tại)", async () => {
    const { PROFILES } = await import("../../core/src/profiles");
    for (const tab of ["code", "work", "design"] as const) {
      const cmds = new Set(Object.keys(PROFILES[tab].commands));
      for (const s of GUIDE[tab]) for (const i of s.items) {
        const m = /^\/([\w-]+)/.exec(i.tryIt ?? "");
        if (m) expect(cmds.has(m[1]), `/${m[1]} không có ở tab ${tab}`).toBe(true);
      }
    }
  });

  it("tìm kiếm không phân biệt dấu và hoa thường, mọi từ phải khớp", () => {
    const s = all("code");
    const r = searchGuide(s, "HAN MUC");
    expect(r.some((x) => x.section.id === "rieng-tu")).toBe(true);
    expect(searchGuide(s, "dán lỗi").flatMap((x) => x.items).length).toBeGreaterThan(0);
    expect(searchGuide(s, "zzzkhongco")).toEqual([]);
    expect(searchGuide(s, "  ")).toHaveLength(s.length);                       // rỗng: hiện tất cả
    expect(searchGuide(s, "token hôm nay").length).toBeGreaterThan(0);
  });
});
