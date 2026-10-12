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

function setup(over: { latest?: unknown; body?: Buffer; status?: number; type?: string; headers?: Record<string, string> | null; dismissed?: string; platform?: "mac" | "win"; deps?: Partial<UpdaterDeps> } = {}) {
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
    ...over.deps,
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

describe("Updater: tự cập nhật và cài ngay", () => {
  const mkAuto = (over: Parameters<typeof setup>[0] = {}, install: UpdaterDeps["install"] = async () => true) => {
    const installs: { file: string; relaunch: boolean }[] = [];
    const updates = fs.mkdtempSync(path.join(tmp, "bg-"));
    const d = setup({
      ...over,
      deps: { canInstall: () => true, install: async (file, relaunch) => (installs.push({ file, relaunch }), install!(file, relaunch)), auto: () => true, updatesDir: () => updates, ...over.deps },
    });
    return { ...d, installs, updates };
  };
  const settle = async (u: Updater) => {
    for (let i = 0; i < 200 && u.status().phase !== "ready" && u.status().phase !== "error"; i++) await new Promise((r) => setTimeout(r, 10));
  };

  it("bật tự cập nhật: tải nền vào thư mục riêng, kiểm mã băm, không mở thư mục Tải xuống", async () => {
    const { u, updates, revealed, dir } = mkAuto();
    await u.check();
    await settle(u);
    const s = u.status();
    expect(s).toMatchObject({ phase: "ready", auto: true, canInstall: true });
    expect(s.savedPath && path.dirname(s.savedPath)).toBe(updates);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(revealed).toEqual([]);
  });

  it("tắt tự cập nhật hoặc máy không cài thẳng được: chỉ báo 'có bản mới', không tự tải", async () => {
    const off = mkAuto({ deps: { auto: () => false } });
    expect((await off.u.check()).phase).toBe("available");
    expect(off.calls.some((c) => !c.url.endsWith("latest.json"))).toBe(false);
    const noInstall = mkAuto({ deps: { canInstall: () => false } });
    expect((await noInstall.u.check()).phase).toBe("available");
    expect(noInstall.calls.some((c) => !c.url.endsWith("latest.json"))).toBe(false);
  });

  it("đóng ứng dụng: cài bản đã tải nền, KHÔNG mở lại; chỉ một lần", async () => {
    const { u, installs } = mkAuto();
    await u.check();
    await settle(u);
    expect(u.installOnQuit()).toBe(true);
    expect(installs).toEqual([{ file: u.status().savedPath, relaunch: false }]);
    expect(u.installOnQuit()).toBe(false); // đang cài: không chạy lần hai (will-quit có thể gọi lại sau khi tự thoát)
  });

  it("tệp đã tải bị thay đổi trước khi cài: không chạy trình cài (cả lúc đóng lẫn bấm cài ngay)", async () => {
    const a = mkAuto();
    await a.u.check();
    await settle(a.u);
    fs.appendFileSync(a.u.status().savedPath!, "x");
    expect(a.u.installOnQuit()).toBe(false);
    expect((await a.u.install()).phase).toBe("error");
    expect(a.installs).toEqual([]);
    expect(fs.existsSync(a.u.status().savedPath ?? "/khong-co")).toBe(false);
  });

  it("bấm 'Cài đặt và khởi động lại': chạy trình cài với mở lại; thất bại thì rơi về mở thư mục", async () => {
    const ok = mkAuto();
    await ok.u.check();
    await settle(ok.u);
    expect((await ok.u.install()).phase).toBe("installing");
    expect(ok.installs).toEqual([{ file: ok.u.status().savedPath, relaunch: true }]);

    const bad = mkAuto({}, async () => false);
    await bad.u.check();
    await settle(bad.u);
    const s = await bad.u.install();
    expect(s).toMatchObject({ phase: "ready", canInstall: false });
    expect(s.error).toContain("mở tệp vừa tải");
    expect(bad.revealed).toEqual([s.savedPath]);
  });

  it("tải thủ công (tự cập nhật tắt) với máy cài thẳng được: sẵn sàng cài, không tự mở thư mục", async () => {
    const m = mkAuto({ deps: { auto: () => false } });
    await m.u.check();
    const s = await m.u.download();
    expect(s).toMatchObject({ phase: "ready", canInstall: true });
    expect(s.auto).toBeFalsy();
    expect(m.revealed).toEqual([]);
    expect(m.u.installOnQuit()).toBe(false); // thủ công: chỉ cài khi người dùng bấm
  });
});

describe("thanh cập nhật không bị hộp Nhật ký che", () => {
  it("chỉ coi là 'cần chú ý' khi chuyển sang bước có bản mới / đã tải / lỗi, không lặp theo từng lần tiến độ", async () => {
    const { needsAttention } = await import("../renderer/update-banner");
    const st = (phase: string, extra: object = {}) => ({ phase, current: "0.8.15", latest: "0.8.17", ...extra }) as never;
    expect(needsAttention("idle" as never, st("available"))).toBe(true);
    expect(needsAttention("downloading" as never, st("ready"))).toBe(true);
    expect(needsAttention("downloading" as never, st("downloading"))).toBe(false);
    expect(needsAttention("ready" as never, st("ready"))).toBe(false);
    expect(needsAttention("downloading" as never, st("error", { latest: "0.8.17" }))).toBe(true);
    expect(needsAttention("idle" as never, st("idle"))).toBe(false);
  });
  it("đóng hộp Nhật ký đang mở, không đụng hộp khác", async () => {
    const { closeInfoDialogs } = await import("../renderer/update-banner");
    const mk = (cls: string) => {
      const d = { cls, open: true, close() { this.open = false; } };
      return d;
    };
    const a = mk("chlog");
    const b = mk("settings");
    const root = { querySelectorAll: (sel: string) => ({ forEach: (f: (d: unknown) => void) => [a, b].filter((d) => sel.startsWith("dialog." + d.cls) && d.open).forEach(f) }) };
    expect(closeInfoDialogs(root as never)).toBe(1);
    expect(a.open).toBe(false);
    expect(b.open).toBe(true);
  });
});
