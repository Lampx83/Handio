import { describe, expect, it } from "vitest";
import { containerImage, decideContainer, DEFAULT_CONTAINER_IMAGE, imageToolsHint, MemoryEnv, parseDockerSize, PIP_BOOTSTRAP, normalizeSettings, parsePolicy, sanitizeImage, sanitizePorts, sanitizeProjectSettings, type Env, type LlmClient, type SandboxStatus } from "../src";
import { makeController } from "./helpers";

const OK = { ok: true, version: "29.0.0", imagePresent: true };
const DOWN = { ok: false, error: "Docker chưa chạy" };

describe("container: kiểm tra ảnh và cổng", () => {
  it("chỉ nhận tên ảnh Docker hợp lệ, không bao giờ là cờ hay chuỗi có khoảng trắng/ký tự shell", () => {
    for (const ok of ["node:22-bookworm-slim", "python:3.12-slim", "ghcr.io/neu/fit-vibe:1.0", "localhost:5000/a/b", "node@sha256:" + "a".repeat(64)]) expect(sanitizeImage(ok), ok).toBe(ok);
    for (const bad of ["--privileged", "-v", "node:22 --privileged", "node;rm -rf /", "a\nb", "$(id)", "NODE", "", "x".repeat(300), 42, null]) expect(sanitizeImage(bad), String(bad)).toBeUndefined();
  });
  it("cổng xem trước: số nguyên 1024–65535, không trùng, tối đa 5", () => {
    expect(sanitizePorts([5173, 3000, 5173, 22, 70000, "8000", 5.5, 8000, 8001, 8002, 8003])).toEqual([5173, 3000, 8000, 8001, 8002]);
    expect(sanitizePorts("5173")).toEqual([]);
  });
  it("ảnh: chính sách > cài đặt người dùng > mặc định; giá trị sai bị bỏ", () => {
    expect(containerImage({}, undefined)).toBe(DEFAULT_CONTAINER_IMAGE);
    expect(containerImage({ containerImage: "python:3.12-slim" }, undefined)).toBe("python:3.12-slim");
    expect(containerImage({ containerImage: "python:3.12-slim" }, { containerImage: "node:20-slim" })).toBe("node:20-slim");
    expect(containerImage({ containerImage: "--privileged" }, { containerImage: "-v" })).toBe(DEFAULT_CONTAINER_IMAGE);
  });
});

describe("container: quyết định cách chạy lệnh", () => {
  it("mặc định tắt: chạy như cũ, không cần dò Docker", () => {
    const d = decideContainer({}, undefined, null);
    expect(d).toMatchObject({ mode: "host", wanted: false });
    expect(d.reason).toBeUndefined();
  });
  it("bật + Docker chạy: container, mạng mặc định TẮT, không có cổng", () => {
    expect(decideContainer({ container: true, containerPorts: [5173] }, undefined, OK)).toMatchObject({ mode: "docker", network: false, ports: [] });
  });
  it("bật mạng thì mới mở cổng xem trước; chính sách tắt mạng luôn thắng", () => {
    expect(decideContainer({ container: true, containerNetwork: true, containerPorts: [5173] }, undefined, OK)).toMatchObject({ network: true, ports: [5173] });
    expect(decideContainer({ container: true, containerNetwork: true, containerPorts: [5173] }, { bashNetwork: false }, OK)).toMatchObject({ network: false, ports: [] });
  });
  it("bật nhưng Docker không chạy: quay về cách cũ VÀ có lý do để báo (không im lặng)", () => {
    const d = decideContainer({ container: true }, undefined, DOWN);
    expect(d.mode).toBe("host");
    expect(d.reason).toMatch(/Docker không dùng được.*trực tiếp trên máy/);
    expect(decideContainer({ container: true }, undefined, null).reason).toContain("không tìm thấy Docker");
  });
  it("chính sách bắt buộc + thiếu Docker: TỪ CHỐI, không hạ cấp; người dùng không tắt được", () => {
    const d = decideContainer({ container: false }, { requireContainer: true }, DOWN);
    expect(d).toMatchObject({ mode: "refuse", required: true, wanted: true });
    expect(d.reason).toContain("Quản trị viên yêu cầu");
    expect(decideContainer({ container: false }, { requireContainer: true }, null).mode).toBe("refuse");
    expect(decideContainer({ container: false }, { requireContainer: true }, OK).mode).toBe("docker");
  });
});

describe("container: ảnh chưa có trên máy (không tự tải ngầm)", () => {
  const NOIMG = { ok: true, version: "29.0.0", imagePresent: false };
  it("bật + chưa có ảnh: chạy như cũ VÀ báo bấm “Tải ảnh”; bắt buộc thì từ chối", () => {
    const d = decideContainer({ container: true }, undefined, NOIMG);
    expect(d.mode).toBe("host");
    expect(d.reason).toMatch(/Chưa có ảnh Docker node:22-bookworm .*Tải ảnh.*trực tiếp trên máy/);
    const r = decideContainer({}, { requireContainer: true }, NOIMG);
    expect(r.mode).toBe("refuse");
    expect(r.reason).toMatch(/Quản trị viên yêu cầu.*chưa có ảnh.*Tải ảnh/);
  });
  it("imagePresent không rõ (chưa dò ảnh) thì vẫn chạy container như trước", () => {
    expect(decideContainer({ container: true }, undefined, { ok: true }).mode).toBe("docker");
  });
});

describe("container: ảnh mặc định có cả Node và Python", () => {
  it("ảnh mặc định là ảnh chính thức node:22-bookworm (bản đầy đủ, có python3), ghim theo thẻ", () => {
    expect(DEFAULT_CONTAINER_IMAGE).toBe("node:22-bookworm");
  });
  it("gợi ý công cụ chỉ cho ảnh mặc định; có cách tạo venv + pip", () => {
    expect(imageToolsHint(DEFAULT_CONTAINER_IMAGE)).toContain("Python 3.11");
    expect(imageToolsHint(DEFAULT_CONTAINER_IMAGE)).toContain(PIP_BOOTSTRAP);
    expect(imageToolsHint("python:3.12-slim")).toBe("");
    expect(PIP_BOOTSTRAP).not.toMatch(/\|\s*(ba|z|da)?sh\b/); // không "curl | sh" (bị chặn ở mọi chế độ)
  });
  it("parseDockerSize: đơn vị của docker (hệ 1000) và KiB/MiB", () => {
    expect(parseDockerSize("0B")).toBe(0);
    expect(parseDockerSize("3.122MB")).toBe(3_122_000);
    expect(parseDockerSize("1.2GB")).toBe(1_200_000_000);
    expect(parseDockerSize("512kB")).toBe(512_000);
    expect(parseDockerSize("2MiB")).toBe(2 * 1024 * 1024);
    for (const bad of ["N/A", "", "12", "1.2XB", null, 5]) expect(parseDockerSize(bad), String(bad)).toBeNull();
  });
});

describe("container: cấu hình chỉ đến từ người dùng/chính sách", () => {
  it("parsePolicy nhận requireContainer/containerImage đúng kiểu, bỏ ảnh sai", () => {
    expect(parsePolicy({ requireContainer: true, containerImage: "python:3.12-slim" })).toEqual({ requireContainer: true, containerImage: "python:3.12-slim" });
    expect(parsePolicy({ requireContainer: "yes", containerImage: "--privileged" })).toEqual({});
  });
  it("normalizeSettings bỏ giá trị sai kiểu", () => {
    const s = normalizeSettings({ container: "1", containerNetwork: true, containerPorts: [80, 5173], containerImage: "a b" } as never);
    expect(s.container).toBeUndefined();
    expect(s.containerNetwork).toBe(true);
    expect(s.containerPorts).toEqual([5173]);
    expect(s.containerImage).toBeUndefined();
  });
  it("cài đặt trong thư mục dự án (repo lạ) không đặt được ảnh, mạng hay bật/tắt container", () => {
    const p = sanitizeProjectSettings({ containerImage: "evil/miner:latest", container: false, containerNetwork: true, containerPorts: [22], permissions: { deny: ["rm"] } });
    expect(p).not.toHaveProperty("containerImage");
    expect(p).not.toHaveProperty("container");
    expect(p).not.toHaveProperty("containerNetwork");
    expect(JSON.stringify(p)).not.toContain("evil");
  });
  it("giao diện không đổi được ảnh qua saveSettings; chính sách bắt buộc thì không tắt được", async () => {
    const { c, settings } = await makeController([{ text: "ok" }], { settings: { containerImage: "python:3.12-slim" }, extra: { policy: { requireContainer: true } } });
    await c.saveSettings({ containerImage: "evil/miner:latest", container: false, containerNetwork: true });
    expect(settings().containerImage).toBe("python:3.12-slim");
    expect(settings().container).toBeUndefined();
    expect(settings().containerNetwork).toBe(true);
  });
  it("sandboxStatus: null khi nơi chạy không có container (web) hoặc không phải tab Code", async () => {
    const st: SandboxStatus = { ...decideContainer({ container: true }, undefined, OK), docker: OK, networkLocked: false };
    expect(await (await makeController([{ text: "ok" }])).c.sandboxStatus()).toBeNull();
    expect(await (await makeController([{ text: "ok" }], { extra: { sandbox: { status: async () => st } } })).c.sandboxStatus()).toMatchObject({ mode: "docker" });
    expect(await (await makeController([{ text: "ok" }], { profile: "work", extra: { sandbox: { status: async () => st } } })).c.sandboxStatus()).toBeNull();
  });
  it("cache/tải ảnh: chuyển đúng thư mục dự án + phạm vi hợp lệ; phạm vi lạ bị từ chối; tab khác không có", async () => {
    const seen: string[] = [];
    const sandbox = {
      status: async () => ({ ...decideContainer({ container: true }, undefined, OK), docker: OK, networkLocked: false }),
      pullImage: async () => ({ image: DEFAULT_CONTAINER_IMAGE, running: true, layersDone: 0, layersTotal: 0 }),
      pullStatus: () => null,
      cacheInfo: async (root: string) => (seen.push("info:" + root), null),
      clearCache: async (root: string, scope: string) => (seen.push(`clear:${root}:${scope}`), { ok: true, message: "ok" }),
    };
    const { c } = await makeController([{ text: "ok" }], { extra: { sandbox } });
    expect(await c.sandboxPullImage()).toMatchObject({ running: true });
    await c.sandboxCache();
    expect(await c.sandboxClearCache("orphans")).toMatchObject({ ok: true });
    expect(await c.sandboxClearCache("everything" as never)).toMatchObject({ ok: false });
    expect(seen).toEqual(["info:/ws", "clear:/ws:orphans"]);
    const w = (await makeController([{ text: "ok" }], { profile: "work", extra: { sandbox } })).c;
    expect(await w.sandboxCache()).toBeNull();
    expect(await w.sandboxPullImage()).toBeNull();
    expect((await w.sandboxClearCache("all")).ok).toBe(false);
  });
});

describe("container: lời nhắc hệ thống và /status nói đúng nơi lệnh chạy", () => {
  const withSandbox = (sandbox: Env["sandbox"]) => {
    const env = new MemoryEnv("/ws", { "a.txt": "x" });
    env.exec = async () => ({ code: 0, output: "", timedOut: false });
    Object.defineProperty(env, "sandbox", { value: sandbox });
    return env;
  };
  const prompt = async (env: MemoryEnv) => {
    const { c } = await makeController([{ text: "ok" }], { env });
    return c.currentSession.systemPrompt(null, 0);
  };
  it("docker: /workspace, không có công cụ của máy, không mạng", async () => {
    const p = await prompt(withSandbox({ kind: "docker", network: false, image: "node:22-bookworm-slim", ports: [] }));
    expect(p).toContain("Linux Docker container (image node:22-bookworm-slim)");
    expect(p).toContain("/workspace");
    expect(p).toContain("NO network access");
    expect(p).not.toContain("OS sandbox");
  });
  it("docker có mạng + cổng: dặn nghe ở 0.0.0.0 và đúng cổng", async () => {
    const p = await prompt(withSandbox({ kind: "docker", network: true, image: "node:22-bookworm-slim", ports: [5173] }));
    expect(p).toContain("0.0.0.0");
    expect(p).toContain("--port 5173");
  });
  it("quay về cách cũ: lời nhắc có lý do; bị từ chối: bảo agent đừng thử lại", async () => {
    expect(await prompt(withSandbox({ kind: "seatbelt", network: true, note: "Docker không dùng được (Docker chưa chạy)" }))).toContain("Note: Docker không dùng được");
    expect(await prompt(withSandbox({ kind: "none", network: true, note: "Docker không dùng được" }))).not.toContain("OS sandbox");
    expect(await prompt(withSandbox({ kind: "refuse", network: false, note: "Quản trị viên yêu cầu" }))).toContain("REFUSED");
  });
  it("seatbelt không ghi chú: lời nhắc giữ nguyên như trước", async () => {
    const p = await prompt(withSandbox({ kind: "seatbelt", network: false }));
    expect(p).toContain("shell commands run inside an OS sandbox");
    expect(p).toContain('and have NO network access. If a command fails with "Operation not permitted", explain that this is the sandbox and suggest a safe alternative instead of trying to bypass it.');
    expect(p).not.toContain("Note:");
  });
  it("ảnh mặc định: lời nhắc nói có Node + Python và cách tạo venv có pip; /status ghi Node + Python", async () => {
    const env = withSandbox({ kind: "docker", network: true, image: DEFAULT_CONTAINER_IMAGE, ports: [] });
    const p = await prompt(env);
    expect(p).toContain("Python 3.11");
    expect(p).toContain(PIP_BOOTSTRAP);
    const { c, events } = await makeController([{ text: "ok" }], { env });
    await c.send("/status");
    expect(JSON.stringify(events)).toContain("container Docker (node:22-bookworm: Node 22 + Python 3)");
  });
  it("/status báo container và lý do quay về", async () => {
    const env = withSandbox({ kind: "docker", network: false, image: "node:22-bookworm-slim", ports: [] });
    const { c, events } = await makeController([{ text: "ok" }], { env });
    await c.send("/status");
    const text = JSON.stringify(events);
    expect(text).toContain("container Docker (node:22-bookworm-slim), không mạng");
  });
});

describe("container: tác vụ định kỳ", () => {
  it("phiên của tác vụ dùng đúng Env (cùng lớp chạy lệnh) và lệnh shell vẫn bị từ chối (không nới quyền)", async () => {
    const env = new MemoryEnv("/ws", { "a.txt": "x" });
    let runs = 0;
    env.exec = async () => (runs++, { code: 0, output: "", timedOut: false });
    Object.defineProperty(env, "sandbox", { value: { kind: "docker", network: false, image: "node:22-bookworm-slim", ports: [] } });
    const r = await makeController([{ calls: [{ name: "bash", args: { command: "npm test" } }] }, { text: "xong" }], { env, extra: { tasks: { now: () => Date.UTC(2026, 9, 19, 1) } } });
    (r.c as unknown as { llm: LlmClient }).llm = r.llm as unknown as LlmClient;
    await r.c.taskAdd({ name: "n", prompt: "chạy test", every: { kind: "daily", at: "08:00" } });
    const out = await r.c.taskRunNow((await r.c.taskList())[0].id);
    expect(out).toMatchObject({ status: "ok", summary: expect.stringContaining("bash") });
    expect(runs).toBe(0);
    expect(r.llm.calls[0].opts).toBeDefined();
    expect(JSON.stringify(r.llm.calls[0].messages)).toContain("Linux Docker container");
  });
});
