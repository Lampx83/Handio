import { describe, expect, it } from "vitest";
import { changelogEntries, inlineSpans } from "../src/changelog-ui";

describe("nhật ký thay đổi trong ứng dụng", () => {
  it("inlineSpans tách **đậm** và `mã`, giữ nguyên chữ thường; không biến HTML thành thẻ", () => {
    expect(inlineSpans("Thêm **Chỉ vào để sửa** và lệnh `/init` nữa")).toEqual([
      { text: "Thêm ", kind: "text" }, { text: "Chỉ vào để sửa", kind: "b" }, { text: " và lệnh ", kind: "text" }, { text: "/init", kind: "code" }, { text: " nữa", kind: "text" },
    ]);
    expect(inlineSpans("<img src=x onerror=alert(1)>")).toEqual([{ text: "<img src=x onerror=alert(1)>", kind: "text" }]);
    expect(inlineSpans("")).toEqual([]);
    expect(inlineSpans("**chưa đóng")).toEqual([{ text: "**chưa đóng", kind: "text" }]);
  });

  it("không có dữ liệu nhúng (khi chạy test) thì trả danh sách rỗng, không ném lỗi", () => {
    expect(changelogEntries()).toEqual([]);
  });
});
