import { describe, expect, it, vi } from "vitest";
import { initFeedbackHub, openHubFeedback, sameOriginHub } from "../src/feedback-hub";

const PAGE = "https://ai.neu.edu.vn/agent/";
const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("Feedback Hub (web)", () => {
  it("chỉ nhận hub cùng nguồn, không kèm tài khoản/tham số", () => {
    expect(sameOriginHub("https://ai.neu.edu.vn/agent/feedbackhub/", PAGE)).toBe("https://ai.neu.edu.vn/agent/feedbackhub");
    expect(sameOriginHub("/agent/feedbackhub", PAGE)).toBe("https://ai.neu.edu.vn/agent/feedbackhub");
    for (const bad of ["https://evil.test/widget", "http://ai.neu.edu.vn/x", "https://u:p@ai.neu.edu.vn/x", "https://ai.neu.edu.vn/x?a=1", "javascript:alert(1)", 5, null, undefined]) {
      expect(sameOriginHub(bad, PAGE)).toBeNull();
    }
  });

  it("tắt (404) hoặc hub khác nguồn → không nạp script, không ném lỗi", async () => {
    const loadScript = vi.fn(async () => undefined);
    const win = {} as never;
    expect(await initFeedbackHub("t", undefined, { fetchImpl: reply({}, false), loadScript, win, pageUrl: PAGE })).toBe(false);
    expect(await initFeedbackHub("t", undefined, { fetchImpl: reply({ ok: true, hub: "https://evil.test", project: "handio" }), loadScript, win, pageUrl: PAGE })).toBe(false);
    expect(await initFeedbackHub("t", undefined, { fetchImpl: reply({ ok: true, hub: "/agent/fh", project: "Bad Slug" }), loadScript, win, pageUrl: PAGE })).toBe(false);
    expect(await initFeedbackHub("t", undefined, { fetchImpl: (async () => { throw new Error("mạng"); }) as never, loadScript, win, pageUrl: PAGE })).toBe(false);
    expect(loadScript).not.toHaveBeenCalled();
    expect(openHubFeedback(win)).toBe(false);
  });

  it("bật: nạp widget từ hub, khởi tạo không vẽ nút nổi, rồi nút Góp ý mở widget", async () => {
    const init = vi.fn();
    const open = vi.fn();
    const win = { FeedbackHub: { init, open } } as never;
    const loadScript = vi.fn(async () => undefined);
    const ok = await initFeedbackHub("https://ai.neu.edu.vn/agent/feedback-token", () => ({ platform: "web" }), { fetchImpl: reply({ ok: true, hub: "/agent/feedbackhub", project: "handio", token: "x" }), loadScript, win, pageUrl: PAGE });
    expect(ok).toBe(true);
    expect(loadScript).toHaveBeenCalledWith("https://ai.neu.edu.vn/agent/feedbackhub/widget.js");
    const o = init.mock.calls[0]![0];
    expect(o).toMatchObject({ project: "handio", hub: "https://ai.neu.edu.vn/agent/feedbackhub", tokenUrl: "https://ai.neu.edu.vn/agent/feedback-token", fab: false, locale: "vi" });
    expect(o.getContext()).toEqual({ extra: { platform: "web" } });
    expect(openHubFeedback(win)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });
});
