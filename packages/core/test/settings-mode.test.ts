import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src";
import { makeController } from "./helpers";

describe("chế độ mặc định: cài đặt cũ lưu mode=default không đè mặc định sản phẩm", () => {
  it("mode đã lưu 'default' (dấu vết phiên bản cũ) → dùng mặc định sản phẩm 'auto'", () => {
    expect(normalizeSettings({ mode: "default" }, { mode: "auto" }).mode).toBe("auto");
  });

  it("không có mặc định sản phẩm (bài thử lõi): giữ 'default'", () => {
    expect(normalizeSettings({ mode: "default" }).mode).toBe("default");
    expect(normalizeSettings({}).mode).toBe("default");
  });

  it("giá trị khác đã lưu (plan/bypass…) được tôn trọng", () => {
    expect(normalizeSettings({ mode: "plan" }, { mode: "auto" }).mode).toBe("plan");
    expect(normalizeSettings({ mode: "bypass" }, { mode: "auto" }).mode).toBe("bypass");
  });

  it("phiên mới của người đã có cài đặt cũ bắt đầu ở 'auto'; lưu cài đặt khác không ghi mode (để đổi mặc định về sau có hiệu lực)", async () => {
    const { c, settings } = await makeController([{ text: "ok" }], { settings: { mode: "default", model: "m1" }, defaults: { mode: "auto" } });
    expect((await c.getState()).mode).toBe("auto");
    await c.saveSettings({ model: "m2" });
    expect(settings().model).toBe("m2");
  });
});
