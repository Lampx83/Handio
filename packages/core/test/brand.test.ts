import { afterEach, describe, expect, it } from "vitest";
import { brandify, brandName, brandText, setBrandName } from "../src";
import { PROFILES } from "../src/profiles";
import { listLessons } from "../src/learning";

describe("tên hiển thị theo nơi triển khai", () => {
  afterEach(() => setBrandName("NEU Agent"));

  it("mặc định là NEU Agent và nội dung viết sẵn đổi theo", () => {
    expect(brandName()).toBe("NEU Agent");
    expect(brandText("Handio làm việc giúp bạn; mở trong Handio")).toBe("NEU Agent làm việc giúp bạn; mở trong NEU Agent");
  });

  it("đặt tên khác chỉ bằng cấu hình; giá trị xấu bị bỏ qua", () => {
    expect(setBrandName("Handio")).toBe("Handio");
    expect(brandText("Handio ở đây")).toBe("Handio ở đây");
    expect(setBrandName("")).toBe("Handio");
    expect(setBrandName("<img onerror=x>")).toBe("Handio");
    expect(setBrandName("x".repeat(80))).toBe("Handio");
    expect(setBrandName("Tên Khác")).toBe("Tên Khác");
    expect(brandText("Handio")).toBe("Tên Khác");
  });

  it("brandify đổi mọi chuỗi trong cấu trúc lồng nhau mà không sửa bản gốc", () => {
    const src = { a: "Handio", b: ["x Handio y", { c: "Handio" }], n: 3 };
    const out = brandify(src);
    expect(out).toEqual({ a: "NEU Agent", b: ["x NEU Agent y", { c: "NEU Agent" }], n: 3 });
    expect(src.a).toBe("Handio");
  });

  it("lời nhắc hệ thống và bài học không còn chữ Handio khi tên là NEU Agent", () => {
    for (const id of ["work", "code", "design"] as const) {
      expect(brandText(PROFILES[id].systemBase)).not.toContain("Handio");
      expect(brandText(PROFILES[id].systemBase)).toContain("NEU Agent");
    }
    expect(JSON.stringify(listLessons())).not.toContain("Handio");
  });
});
