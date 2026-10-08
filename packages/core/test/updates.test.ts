import { describe, expect, it } from "vitest";
import { checkForUpdate, compareVersions } from "../src/updates";

const SHA = "a".repeat(64);
const latest = (o: Record<string, unknown> = {}) => ({ version: "0.2.0", released: "2026-10-08", notes: "Có gì mới", files: { "NEU-Agent-0.2.0-mac-arm64.dmg": { sha256: SHA, size: 10 }, "NEU-Agent-0.2.0-win-x64.exe": { sha256: SHA } }, ...o });
const fetchJson = (body: unknown, init: { ok?: boolean; type?: string } = {}) =>
  (async () => ({ ok: init.ok ?? true, headers: { get: () => init.type ?? "application/json" }, json: async () => body })) as unknown as typeof fetch;

describe("compareVersions", () => {
  it("so sánh semver, bản có hậu tố thấp hơn bản chính, không hợp lệ trả null", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("abc", "1.0.0")).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("báo có bản mới và lọc tệp theo nền tảng", async () => {
    const r = await checkForUpdate("0.1.0", fetchJson(latest()), { platform: "mac" });
    expect(r).toMatchObject({ available: true, required: false, latest: "0.2.0", current: "0.1.0", notes: "Có gì mới", released: "2026-10-08" });
    expect(r?.files.map((f) => f.name)).toEqual(["NEU-Agent-0.2.0-mac-arm64.dmg"]);
  });
  it("không có bản mới khi bằng hoặc cao hơn", async () => {
    expect((await checkForUpdate("0.2.0", fetchJson(latest())))?.available).toBe(false);
    expect((await checkForUpdate("0.3.0", fetchJson(latest())))?.available).toBe(false);
  });
  it("minVersion: bản thấp hơn mức hỗ trợ thì bắt buộc cập nhật", async () => {
    const old = await checkForUpdate("0.1.0", fetchJson(latest({ minVersion: "0.1.5" })));
    expect(old).toMatchObject({ available: true, required: true, minVersion: "0.1.5" });
    const ok = await checkForUpdate("0.1.5", fetchJson(latest({ minVersion: "0.1.5" })));
    expect(ok).toMatchObject({ available: true, required: false });
    expect((await checkForUpdate("0.1.0", fetchJson(latest({ minVersion: "rác" }))))?.required).toBe(false);
  });
  it("bỏ tệp có tên/mã băm không hợp lệ và chặn phản hồi lạ", async () => {
    const r = await checkForUpdate("0.1.0", fetchJson(latest({ files: { "../x.exe": { sha256: SHA }, "ok-win.exe": { sha256: "zz" }, "good-win.exe": { sha256: SHA } } })));
    expect(r?.files.map((f) => f.name)).toEqual(["good-win.exe"]);
    expect(await checkForUpdate("0.1.0", fetchJson("<html>", { type: "text/html" }))).toBeNull();
    expect(await checkForUpdate("0.1.0", fetchJson(latest(), { ok: false }))).toBeNull();
    expect(await checkForUpdate("0.1.0", fetchJson({ version: "rác" }))).toBeNull();
    expect(await checkForUpdate("0.1.0", (async () => { throw new Error("mạng"); }) as unknown as typeof fetch)).toBeNull();
  });
});
