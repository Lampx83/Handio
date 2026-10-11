import { describe, expect, it } from "vitest";
import { shouldShowModelPicker } from "../src/code-tools";

describe("nút chọn mô hình ở khung chat", () => {
  it("ẩn khi chỉ có một mô hình (kể cả khi danh sách trống hoặc trùng tên đang dùng)", () => {
    expect(shouldShowModelPicker([], "qwen3.5")).toBe(false);
    expect(shouldShowModelPicker(["qwen3.5"], "qwen3.5")).toBe(false);
    expect(shouldShowModelPicker(["qwen3.5", " "], "qwen3.5")).toBe(false);
    expect(shouldShowModelPicker([], "")).toBe(false);
  });
  it("hiện khi máy chủ có từ hai mô hình trở lên, hoặc mô hình đang dùng không nằm trong danh sách", () => {
    expect(shouldShowModelPicker(["a", "b"], "a")).toBe(true);
    expect(shouldShowModelPicker(["a"], "b")).toBe(true);
  });
});
