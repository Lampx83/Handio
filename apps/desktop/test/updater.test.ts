import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pickFile, Updater, type UpdateState, type UpdaterDeps } from "../src/updater";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neu-upd-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const BASE = "https://ai.neu.edu.vn/agent/download/";
const PAYLOAD = Buffer.from("noi-dung-ban-cai-dat".repeat(5000));
const SHA = createHash("sha256").update(PAYLOAD).digest("hex");

function latest(o: Record<string, unknown> = {}) {
  return { version: "0.2.0", released: "2026-10-08", notes: "• Mới", files: { "NEU-Agent-0.2.0-mac-arm64.dmg": { sha256: SHA, size: PAYLOAD.length }, "NEU-Agent-0.2.0-mac-x64.dmg": { sha256: "b".repeat(64), size: 1 }, "NEU-Agent-0.2.0-win-x64.exe": { sha256: SHA, size: PAYLOAD.length } }, ...o };
}

function setup(over: { latest?: unknown; body?: Buffer; status?: number; type?: string; headers?: Record<string, string> | null; dismissed?: string; platform?: "mac" | "win" } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "dl-"));
  const states: UpdateState[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];
  const revealed: string[] = [];
  let dismissed = over.dismissed ?? "";
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("latest.json")) return new Response(JSON.stringify(over.latest ?? latest()), { headers: { "content-type": "application/json" } });
    const body = over.body ?? PAYLOAD;
    return new Response(over.status && over.status >= 400 ? null : new Uint8Array(body), { status: over.status ?? 200, headers: { "content-type": over.type ?? "application/octet-stream", "content-length": String(body.length) } });
  }) as unknown as typeof fetch;
  const deps: UpdaterDeps = {
    version: "0.1.0", platform: over.platform ?? "mac", arch: "arm64", baseUrl: BASE,
    headers: async () => (over.headers === undefined ? { Authorization: "Bearer tok" } : over.headers),
    fetch: fetchFn, downloadsDir: () => dir, reveal: (p) => revealed.push(p), onState: (s) => states.push(s),
    loadDismissed: async () => dismissed, saveDismissed: async (v) => void (dismissed = v),
  };
  return { u: new Updater(deps), dir, states, calls, revealed, getDismissed: () => dismissed };
}

describe("pickFile", () => {
  const files = [{ name: "NEU-Agent-0.2.0-mac-arm64.dmg", sha256: "a" }, { name: "NEU-Agent-0.2.0-mac-x64.dmg", sha256: "b" }, { name: "NEU-Agent-0.2.0-win-x64.zip", sha256: "c" }, { name: "NEU-Agent-0.2.0-win-x64.exe", sha256: "d" }];
  it("chọn đúng chip macOS và ưu tiên .exe trên Windows", () => {
    expect(pickFile(files, "mac", "arm64")?.sha256).toBe("a");
    expect(pickFile(files, "mac", "x64")?.sha256).toBe("b");
    expect(pickFile(files, "win", "x64")?.sha256).toBe("d");
    expect(pickFile(files.slice(0, 3), "win", "x64")?.sha256).toBe("c");
    expect(pickFile([], "mac", "arm64")).toBeUndefined();
  });
});

describe("Updater", () => {
  it("chỉ chấp nhận baseUrl https kết thúc bằng /", () => {
    const d = setup();
    expect(() => new Updater({ ...(d.u as unknown as { d: UpdaterDeps }).d, baseUrl: "http://x/" } as UpdaterDeps)).toThrow();
  });

  it("kiểm tra: có bản mới kèm đúng tệp cho máy, gửi tiêu đề đăng nhập, không theo chuyển hướng", async () => {
    const { u, calls } = setup();
    const s = await u.check();
    expect(s).toMatchObject({ phase: "available", latest: "0.2.0", current: "0.1.0", required: false, notes: "• Mới", file: { name: "NEU-Agent-0.2.0-mac-arm64.dmg", size: PAYLOAD.length } });
    expect(calls[0].url).toBe(BASE + "latest.json");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[0].init?.redirect).toBe("error");
  });

  it("chưa đăng nhập: không gọi mạng, không báo lỗi", async () => {
    const { u, calls } = setup({ headers: null });
    expect((await u.check()).phase).toBe("idle");
    expect(calls).toHaveLength(0);
  });

  it("không có bản mới thì ở trạng thái idle", async () => {
    const { u } = setup({ latest: latest({ version: "0.1.0" }) });
    expect((await u.check()).phase).toBe("idle");
  });

  it("minVersion: bắt buộc, không cho bỏ qua", async () => {
    const { u, getDismissed } = setup({ latest: latest({ minVersion: "0.1.5" }) });
    expect(await u.check()).toMatchObject({ phase: "available", required: true });
    expect((await u.dismiss()).phase).toBe("available");
    expect(getDismissed()).toBe("");
  });

  it('"Để sau" ẩn bản đó trong lần kiểm tra tự động nhưng hiện lại khi người dùng chủ động kiểm tra', async () => {
    const { u, getDismissed } = setup();
    await u.check();
    expect((await u.dismiss()).phase).toBe("idle");
    expect(getDismissed()).toBe("0.2.0");
    expect((await u.check()).phase).toBe("idle");
    expect((await u.check(true)).phase).toBe("available");
  });

  it("bản mới hơn nữa thì hiện lại dù đã 'Để sau' bản cũ", async () => {
    const { u } = setup({ dismissed: "0.1.9" });
    expect((await u.check()).phase).toBe("available");
  });

  it("tải: ghi tệp, kiểm tra SHA-256 và kích thước, mở thư mục, không để lại .part", async () => {
    const { u, dir, states, calls, revealed } = setup();
    await u.check();
    const s = await u.download();
    expect(s).toMatchObject({ phase: "ready", progress: 1, savedPath: path.join(dir, "NEU-Agent-0.2.0-mac-arm64.dmg") });
    expect(fs.readFileSync(s.savedPath!).equals(PAYLOAD)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["NEU-Agent-0.2.0-mac-arm64.dmg"]);
    expect(revealed).toEqual([s.savedPath]);
    expect(calls[1].url).toBe(BASE + "NEU-Agent-0.2.0-mac-arm64.dmg");
    expect(states.some((x) => x.phase === "downloading")).toBe(true);
    expect(fs.statSync(s.savedPath!).mode & 0o077).toBe(0); // chỉ chủ sở hữu (tệp tải về không chia sẻ rộng)
  });

  it("mã băm sai: xoá tệp, báo lỗi, không báo sẵn sàng", async () => {
    const { u, dir, revealed } = setup({ body: Buffer.from("x".repeat(PAYLOAD.length)) });
    await u.check();
    const s = await u.download();
    expect(s.phase).toBe("error");
    expect(s.error).toMatch(/SHA-256 không khớp/);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(revealed).toEqual([]);
  });

  it("kích thước thiếu: lỗi và dọn dẹp", async () => {
    const { u, dir } = setup({ body: PAYLOAD.subarray(0, 100) });
    await u.check();
    const s = await u.download();
    expect(s.phase).toBe("error");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("máy chủ trả trang HTML (hết phiên) hoặc 401: báo lỗi dễ hiểu", async () => {
    const a = setup({ type: "text/html" });
    await a.u.check();
    expect((await a.u.download()).error).toMatch(/trang web/);
    const b = setup({ status: 401 });
    await b.u.check();
    expect((await b.u.download()).error).toMatch(/đăng nhập/);
  });

  it("thử lại sau lỗi được", async () => {
    const { u } = setup({ status: 500 });
    await u.check();
    expect((await u.download()).phase).toBe("error");
    expect((await u.download()).phase).toBe("error");
  });

  it("Windows: tải .exe", async () => {
    const { u, dir } = setup({ platform: "win" });
    await u.check();
    expect((await u.download()).phase).toBe("ready");
    expect(fs.readdirSync(dir)).toEqual(["NEU-Agent-0.2.0-win-x64.exe"]);
  });

  it("không có tệp hợp nền tảng thì tải báo lỗi rõ ràng", async () => {
    const { u } = setup({ latest: latest({ files: { "NEU-Agent-0.2.0-win-x64.exe": { sha256: SHA } } }) });
    await u.check();
    expect((await u.download()).error).toMatch(/phù hợp/);
  });
});
