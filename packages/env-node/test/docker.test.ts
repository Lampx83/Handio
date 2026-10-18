// Lớp chạy lệnh trong container Docker: kiểm tra MẢNG ĐỐI SỐ docker sinh ra và các ca tấn công, KHÔNG cần Docker thật
// (dùng một "docker" giả ghi lại đối số). Bài chạy Docker thật nằm ở docker-real.test.ts (tự bỏ qua khi máy không có Docker).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decideContainer, DEFAULT_CONTAINER_IMAGE } from "@neu/agent-core";
import { cacheTargets, cacheVolumeName, checkMountSource, containerUser, containerWorkdir, dockerRunArgs, knownCacheVolumes, listCacheVolumes, MountError, NodeEnv, passableEnv, pullImage, pullProgress, removeCacheVolumes, summarizeCache, WORKSPACE, type ContainerChoice } from "../src";

const WIN = process.platform === "win32";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-docker-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (name: string): string => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ---- docker giả: ghi mỗi lần gọi (một dòng JSON) vào LOG; `run` in ra biến NEU_PROJECT_DIR/HOME_SEEN; lệnh có "sleep" thì treo
const LOG = path.join(tmp, "docker-calls.jsonl");
// danh sách volume của docker giả (một tên một dòng); `volume rm` xoá khỏi đây, tên tận cùng "beef" thì báo đang dùng
const VOLS = path.join(tmp, "docker-volumes.txt");
const FAKE = path.join(tmp, "fake-docker");
fs.writeFileSync(FAKE, `#!${process.execPath}
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify(a) + "\\n");
const vols = () => (fs.existsSync(${JSON.stringify(VOLS)}) ? fs.readFileSync(${JSON.stringify(VOLS)}, "utf8").split("\\n").filter(Boolean) : []);
if (a[0] === "image" && a[1] === "inspect" && /missing/.test(a[a.length - 1])) process.exit(1);
if (a[0] === "pull") {
  if (/nope/.test(a[1])) { process.stderr.write("Error response from daemon: manifest unknown"); process.exit(1); }
  process.stdout.write("22-bookworm: Pulling from library/node\\naaaaaaaaaaaa: Pulling fs layer\\nbbbbbbbbbbbb: Pulling fs layer\\naaaaaaaaaaaa: Pull complete\\nbbbbbbbbbbbb: Already exists\\nDigest: sha256:00\\n");
  process.exit(0);
}
if (a[0] === "volume" && a[1] === "create") { fs.appendFileSync(${JSON.stringify(VOLS)}, "\\n" + a[a.length - 1]); process.exit(0); }
if (a[0] === "volume" && a[1] === "inspect") { if (vols().includes(a[a.length - 1])) { process.stdout.write("2026-01-01T00:00:00Z\\n"); process.exit(0); } process.exit(1); }
if (a[0] === "volume" && a[1] === "ls") { process.stdout.write(vols().join("\\n") + "\\n"); process.exit(0); }
if (a[0] === "system" && a[1] === "df") { process.stdout.write(JSON.stringify(vols().map((n, i) => ({ Name: n, Size: (i + 1) + ".5MB" }))) + "\\n"); process.exit(0); }
if (a[0] === "volume" && a[1] === "rm") {
  if (/beef$/.test(a[2])) { process.stderr.write("volume is in use"); process.exit(1); }
  fs.writeFileSync(${JSON.stringify(VOLS)}, vols().filter((n) => n !== a[2]).join("\\n"));
  process.exit(0);
}
if (a[0] === "run" && a.includes("--entrypoint") && a[a.indexOf("--entrypoint") + 1] === "/bin/sh") {
  const cmd = a[a.length - 1];
  process.stdout.write("fake-run:" + cmd + "\\n");
  if (process.env.NEU_PROJECT_DIR) process.stdout.write("dir=" + process.env.NEU_PROJECT_DIR + "\\n");
  if (/sleep/.test(cmd)) setTimeout(() => {}, 30000);
  else process.exit(/exit 3/.test(cmd) ? 3 : 0);
}
`, { mode: 0o755 });
const calls = (): string[][] => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const runs = () => calls().filter((c) => c[0] === "run" && c[c.indexOf("--entrypoint") + 1] === "/bin/sh");
const clearLog = () => fs.rmSync(LOG, { force: true });

const choice = (over: Partial<ContainerChoice> = {}): ContainerChoice => ({ ...decideContainer({ container: true }, undefined, { ok: true, version: "29" }), docker: FAKE, ...over });
const envWith = (root: string, c: () => ContainerChoice | Promise<ContainerChoice>, required = false) => new NodeEnv(root, { container: { decide: async () => c(), required } });

describe("dockerRunArgs: cờ cứng hoá của container", () => {
  const args = dockerRunArgs({ name: "handio-x", realRoot: "/Users/a/Dự án 1", workdir: WORKSPACE, image: DEFAULT_CONTAINER_IMAGE, command: "npm test && echo ok; rm -rf / # $(id)", network: false, ports: [5173], user: "501:20", cacheVolume: "handio-cache-1" });
  const after = (flag: string) => args.filter((_, i) => args[i - 1] === flag);
  it("không root, bỏ capability, no-new-privileges, rootfs chỉ đọc + tmpfs /tmp, giới hạn tài nguyên, tự xoá", () => {
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(after("--user")).toEqual(["501:20"]);
    expect(after("--cap-drop")).toEqual(["ALL"]);
    expect(after("--security-opt")).toEqual(["no-new-privileges"]);
    expect(args).toContain("--read-only");
    expect(after("--tmpfs")[0]).toMatch(/^\/tmp:rw,nosuid,nodev,size=\d+m$/);
    expect(after("--pids-limit")).toEqual(["512"]);
    expect(after("--memory")).toEqual(["2048m"]);
    expect(after("--memory-swap")).toEqual(["2048m"]);
    expect(after("--cpus")).toEqual(["2"]);
    expect(after("--pull")).toEqual(["never"]);
    expect(after("--label")).toEqual(["handio.sandbox=1"]);
  });
  it("mạng mặc định tắt và KHÔNG mở cổng khi không có mạng", () => {
    expect(after("--network")).toEqual(["none"]);
    expect(args).not.toContain("--publish");
    const net = dockerRunArgs({ name: "n", realRoot: "/p", workdir: WORKSPACE, image: "node:22", command: "x", network: true, ports: [5173, 3000] });
    expect(net.filter((_, i) => net[i - 1] === "--network")).toEqual(["bridge"]);
    expect(net.filter((_, i) => net[i - 1] === "--publish")).toEqual(["127.0.0.1:5173:5173", "127.0.0.1:3000:3000"]); // chỉ loopback
  });
  it("chỉ gắn đúng thư mục dự án (+ volume cache), không home/socket docker; dùng --mount, không -v", () => {
    expect(after("--mount")).toEqual(["type=bind,source=/Users/a/Dự án 1,target=/workspace", "type=volume,source=handio-cache-1,target=/cache"]);
    expect(args).not.toContain("-v");
    expect(args).not.toContain("--volume");
    expect(args).not.toContain("--privileged");
    expect(args.join(" ")).not.toMatch(/docker\.sock|\.ssh|\$HOME/);
    expect(after("--env")).toContain("HOME=/tmp");
    expect(after("--env")).toContain("npm_config_cache=/cache/npm");
  });
  it("lệnh của agent là MỘT đối số của sh -c bên trong container (không qua shell của máy)", () => {
    expect(after("--entrypoint")).toEqual(["/bin/sh"]);
    expect(args.slice(-3)).toEqual([DEFAULT_CONTAINER_IMAGE, "-c", "npm test && echo ok; rm -rf / # $(id)"]);
  });
  it("người dùng trong container không bao giờ là root", () => {
    expect(containerUser(0, 0)).toBe("1000:1000");
    expect(containerUser(-1, NaN)).toBe("1000:1000");
    expect(containerUser(501, 20)).toBe("501:20");
  });
});

describe.skipIf(WIN)("đường dẫn gắn vào container: chuẩn hoá, realpath, chặn ký tự nguy hiểm", () => {
  it("tên thư mục có dấu phẩy, dấu hai chấm, nháy kép, xuống dòng bị từ chối (không làm sai --mount)", () => {
    for (const name of ["a,b", "x,target=/etc,y", "c:d", 'q"uote', "line\nbreak", "tab\tx"]) expect(() => checkMountSource(mk(name), "/nonexistent-home"), JSON.stringify(name)).toThrow(MountError);
  });
  it("tên tiếng Việt có dấu cách vẫn dùng được; symlink tới dự án được giải về đường dẫn thật", () => {
    const real = mk("Bài tập 1 (2)");
    expect(checkMountSource(real, "/nonexistent-home")).toBe(real);
    const link = path.join(tmp, "link-to-project");
    fs.symlinkSync(real, link);
    expect(checkMountSource(link, "/nonexistent-home")).toBe(real);
  });
  it("không gắn gốc ổ đĩa, thư mục cá nhân, thư mục cha của home hay nơi chứa khoá", () => {
    const home = mk("home-user");
    fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
    expect(() => checkMountSource("/", home)).toThrow(MountError);
    expect(() => checkMountSource(home, home)).toThrow(MountError);
    expect(() => checkMountSource(tmp, home)).toThrow(MountError); // cha của home
    expect(() => checkMountSource(path.join(home, ".ssh"), home)).toThrow(MountError);
    // symlink trỏ vào home cũng bị giải ra và chặn
    const sneaky = path.join(tmp, "innocent");
    fs.symlinkSync(home, sneaky);
    expect(() => checkMountSource(sneaky, home)).toThrow(MountError);
  });
  it("thư mục chạy lệnh phải nằm trong dự án: chặn `..` và symlink ra ngoài", () => {
    const root = mk("proj-wd");
    fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
    fs.symlinkSync(tmp, path.join(root, "escape"));
    expect(containerWorkdir(root, root)).toBe("/workspace");
    expect(containerWorkdir(root, path.join(root, "src", "a"))).toBe("/workspace/src/a");
    expect(() => containerWorkdir(root, path.join(root, ".."))).toThrow(MountError);
    expect(() => containerWorkdir(root, path.join(root, "src", "..", ".."))).toThrow(MountError);
    expect(() => containerWorkdir(root, path.join(root, "escape"))).toThrow(MountError);
  });
  it("biến môi trường của hook: tên hợp lệ, không trùng biến của docker CLI; NEU_PROJECT_DIR trỏ /workspace", () => {
    const p = passableEnv({ NEU_HOOK_EVENT: "x", NEU_PROJECT_DIR: "/host/p", HOME: "/Users/a", PATH: "/evil", DOCKER_HOST: "tcp://evil", "BAD-NAME": "1", "A=B": "1" }, "/host/p", "/host/p");
    expect(p).toEqual({ NEU_HOOK_EVENT: "x", NEU_PROJECT_DIR: "/workspace" });
  });
});

describe.skipIf(WIN)("NodeEnv + lớp container (docker giả)", () => {
  it("không đặt container: hành vi cũ, không gọi docker", async () => {
    clearLog();
    const r = await new NodeEnv(mk("plain")).exec("echo host-ok", { cwd: path.join(tmp, "plain"), timeoutMs: 5000 });
    expect(r.output).toContain("host-ok");
    expect(calls()).toEqual([]);
  });
  it("chạy lệnh qua docker run, gắn đúng thư mục dự án; ảnh/cấu hình nằm trong dự án bị bỏ qua", async () => {
    clearLog();
    const root = mk("proj-untrusted-config");
    fs.mkdirSync(path.join(root, ".devcontainer"), { recursive: true });
    fs.writeFileSync(path.join(root, ".devcontainer", "devcontainer.json"), JSON.stringify({ image: "evil/miner:latest", runArgs: ["--privileged", "-v", "/:/host"] }));
    fs.mkdirSync(path.join(root, ".neuagent"), { recursive: true });
    fs.writeFileSync(path.join(root, ".neuagent", "settings.json"), JSON.stringify({ containerImage: "evil/miner:latest", container: false }));
    fs.writeFileSync(path.join(root, "Dockerfile"), "FROM evil/miner\n");
    const env = envWith(root, () => choice());
    const r = await env.exec("npm test", { cwd: root, timeoutMs: 10_000 });
    expect(r.code).toBe(0);
    expect(r.output).toContain("fake-run:npm test");
    const [run] = runs();
    expect(run).toContain(`type=bind,source=${root},target=/workspace`);
    expect(run.slice(-3)).toEqual([DEFAULT_CONTAINER_IMAGE, "-c", "npm test"]);
    expect(JSON.stringify(calls())).not.toContain("evil");
    expect(JSON.stringify(calls())).not.toContain("--privileged");
    expect(env.sandbox).toMatchObject({ kind: "docker", network: false, image: DEFAULT_CONTAINER_IMAGE });
    expect(env.platform).toContain("Linux container");
  });
  it("mã thoát của lệnh trong container được trả về", async () => {
    const root = mk("proj-code");
    expect((await envWith(root, () => choice()).exec("exit 3", { cwd: root, timeoutMs: 10_000 })).code).toBe(3);
  });
  it("tên thư mục dự án có ký tự nguy hiểm: từ chối, không gọi docker run", async () => {
    clearLog();
    const root = mk("bad,name");
    const r = await envWith(root, () => choice()).exec("id", { cwd: root, timeoutMs: 5000 });
    expect(r.code).toBe(126);
    expect(r.output).toMatch(/ký tự không dùng được/);
    expect(runs()).toEqual([]);
  });
  it("thư mục chạy lệnh thoát ra ngoài dự án (symlink): từ chối", async () => {
    clearLog();
    const root = mk("proj-esc");
    fs.symlinkSync(tmp, path.join(root, "out"));
    const r = await envWith(root, () => choice()).exec("id", { cwd: path.join(root, "out"), timeoutMs: 5000 });
    expect(r.code).toBe(126);
    expect(runs()).toEqual([]);
  });
  it("chính sách bắt buộc + thiếu Docker: từ chối lệnh, lệnh nền và MCP; KHÔNG chạy trên máy", async () => {
    clearLog();
    const root = mk("proj-required");
    const refuse = { ...decideContainer({}, { requireContainer: true }, { ok: false, error: "Docker chưa chạy" }), docker: FAKE };
    const env = envWith(root, () => refuse, true);
    const r = await env.exec("echo SHOULD-NOT-RUN > leaked.txt", { cwd: root, timeoutMs: 5000 });
    expect(r.code).toBe(126);
    expect(r.output).toContain("Quản trị viên yêu cầu");
    expect(fs.existsSync(path.join(root, "leaked.txt"))).toBe(false);
    const bg = await new Promise<{ code: number; out: string }>((res) => { let out = ""; env.spawn("echo bg > leaked2.txt", { cwd: root, onData: (d) => (out += d), onExit: (code) => res({ code, out }) }); });
    expect(bg.code).toBe(126);
    expect(fs.existsSync(path.join(root, "leaked2.txt"))).toBe(false);
    const mcp = await new Promise<number>((res) => env.spawnStdio("node", ["-e", "1"], { cwd: root, onLine: () => undefined, onExit: res }));
    expect(mcp).toBe(126);
    expect(env.sandbox).toMatchObject({ kind: "refuse" });
    expect(runs()).toEqual([]);
  });
  it("lỗi bất ngờ khi quyết định: từ chối (không tự hạ cấp)", async () => {
    const root = mk("proj-throw");
    const env = new NodeEnv(root, { container: { decide: async () => { throw new Error("x"); } } });
    expect((await env.exec("echo hi", { cwd: root, timeoutMs: 5000 })).code).toBe(126);
  });
  it("Docker không chạy (không bắt buộc): chạy như cũ VÀ báo rõ trong đầu ra (một lần)", async () => {
    clearLog();
    const root = mk("proj-fallback");
    const fb = { ...decideContainer({ container: true }, undefined, { ok: false, error: "Docker chưa chạy" }), docker: FAKE };
    const env = envWith(root, () => fb);
    const a = await env.exec("echo host-ran", { cwd: root, timeoutMs: 5000 });
    expect(a.output).toMatch(/^\[Docker không dùng được \(Docker chưa chạy\)/);
    expect(a.output).toContain("host-ran");
    expect((await env.exec("echo again", { cwd: root, timeoutMs: 5000 })).output).not.toContain("Docker không dùng được");
    expect(env.sandbox?.note).toContain("Docker không dùng được");
    expect(runs()).toEqual([]);
  });
  it("hết giờ: giết docker CLI VÀ xoá container theo tên", async () => {
    clearLog();
    const root = mk("proj-timeout");
    const r = await envWith(root, () => choice()).exec("sleep 30", { cwd: root, timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
    const name = runs()[0][runs()[0].indexOf("--name") + 1];
    await new Promise((res) => setTimeout(res, 500));
    expect(calls()).toContainEqual(["rm", "-f", name]);
  });
  it("biến của hook vào container qua --env TÊN (giá trị không nằm trên dòng lệnh)", async () => {
    clearLog();
    const root = mk("proj-hook");
    const r = await envWith(root, () => choice()).exec("true", { cwd: root, timeoutMs: 10_000, env: { NEU_PROJECT_DIR: root, NEU_HOOK_JSON: '{"secret":"value-not-in-argv"}' } });
    expect(r.output).toContain("dir=/workspace");
    const [run] = runs();
    expect(run).toContain("NEU_HOOK_JSON");
    expect(JSON.stringify(run)).not.toContain("value-not-in-argv");
  });
  it("chạy nền: cổng xem trước chỉ cho MỘT container một lúc, chỉ khi có mạng; dừng thì xoá container", async () => {
    clearLog();
    const root = mk("proj-bg");
    const env = envWith(root, () => choice({ network: true, ports: [5173] }));
    const start = (cmd: string) => {
      let out = "";
      let code: number | undefined;
      const h = env.spawn(cmd, { cwd: root, onData: (d) => (out += d), onExit: (c) => (code = c) });
      return { h, out: () => out, code: () => code };
    };
    const a = start("sleep 30 # vite");
    await new Promise((res) => setTimeout(res, 1500));
    const b = start("sleep 30 # api");
    await new Promise((res) => setTimeout(res, 1500));
    const [ra, rb] = runs();
    expect(ra).toContain("127.0.0.1:5173:5173");
    expect(rb).not.toContain("--publish");
    expect(a.out()).toContain("http://localhost:5173");
    a.h.stop();
    b.h.stop();
    await new Promise((res) => setTimeout(res, 800));
    const name = ra[ra.indexOf("--name") + 1];
    expect(calls()).toContainEqual(["rm", "-f", name]);
    // không mạng: không mở cổng
    clearLog();
    const off = envWith(root, () => choice({ network: false, ports: [5173] }));
    const h = off.spawn("sleep 30", { cwd: root, onData: () => undefined, onExit: () => undefined });
    await new Promise((res) => setTimeout(res, 1500));
    expect(runs()[0]).not.toContain("--publish");
    h.stop();
  });
  it("volume cache theo dự án: tạo một lần, khởi tạo bằng container chỉ có quyền CHOWN, không mạng", async () => {
    clearLog();
    const root = mk("proj-cache");
    const env = envWith(root, () => choice());
    await env.exec("true", { cwd: root, timeoutMs: 10_000 });
    await env.exec("true", { cwd: root, timeoutMs: 10_000 });
    const all = calls();
    expect(all.filter((c) => c[0] === "volume" && c[1] === "create")).toHaveLength(1);
    expect(all.filter((c) => c[0] === "volume" && c[1] === "create")[0].slice(2, 4)).toEqual(["--label", "handio.cache=1"]);
    const init = all.filter((c) => c[0] === "run" && c.includes("chown"));
    expect(init).toHaveLength(1);
    const i = init[0];
    expect(i.filter((_, k) => i[k - 1] === "--cap-add")).toEqual(["CHOWN"]);
    expect(i.filter((_, k) => i[k - 1] === "--cap-drop")).toEqual(["ALL"]);
    expect(i.filter((_, k) => i[k - 1] === "--network")).toEqual(["none"]);
    expect(i.join(" ")).not.toContain("type=bind");
    expect(runs().every((r) => r.some((x) => /^type=volume,source=handio-cache-[0-9a-f]{16},target=\/cache$/.test(x)))).toBe(true);
  });
  it("volume cache bị xoá ngoài ứng dụng: tạo lại có nhãn + đổi chủ (không để docker tự tạo volume của root)", async () => {
    const root = mk("proj-cache-gone");
    const env = envWith(root, () => choice());
    await env.exec("true", { cwd: root, timeoutMs: 10_000 });
    fs.writeFileSync(VOLS, ""); // như `docker volume rm` từ bên ngoài
    clearLog();
    await env.exec("true", { cwd: root, timeoutMs: 10_000 });
    expect(calls().filter((c) => c[0] === "volume" && c[1] === "create")).toHaveLength(1);
    expect(calls().filter((c) => c[0] === "run" && c.includes("chown"))).toHaveLength(1);
  });
});

describe.skipIf(WIN)("ảnh Docker: không tự tải ngầm; “Tải ảnh” do người dùng bấm", () => {
  it("chưa có ảnh: lệnh không chạy, báo cách tải, KHÔNG gọi docker pull", async () => {
    clearLog();
    const root = mk("proj-no-image");
    const r = await envWith(root, () => choice({ image: "missing-image:1" })).exec("echo hi", { cwd: root, timeoutMs: 5000 });
    expect(r.code).toBe(126);
    expect(r.output).toMatch(/Chưa có ảnh Docker missing-image:1.*Tải ảnh/);
    expect(calls().some((c) => c[0] === "pull")).toBe(false);
    expect(runs()).toEqual([]);
  });
  it("pullImage: mảng đối số `pull <ảnh>`, báo tiến độ theo lớp; tên ảnh sai thì không gọi docker", async () => {
    clearLog();
    const states: string[] = [];
    const ok = await pullImage(FAKE, DEFAULT_CONTAINER_IMAGE, (st) => states.push(`${st.running}:${st.layersDone}/${st.layersTotal}`));
    expect(ok).toMatchObject({ ok: true, running: false, layersDone: 2, layersTotal: 2 });
    expect(states[0]).toBe("true:0/0");
    expect(calls()).toEqual([["pull", DEFAULT_CONTAINER_IMAGE]]);
    expect(await pullImage(FAKE, "nope:1", () => undefined)).toMatchObject({ ok: false, error: "không tìm thấy ảnh" });
    clearLog();
    for (const bad of ["--all-tags", "-a", "node:22 --platform x", "a;b"]) expect((await pullImage(FAKE, bad, () => undefined)).ok, bad).toBe(false);
    expect(calls()).toEqual([]);
  });
});

describe("cache container: chỉ volume của Handio", () => {
  const P = "handio-cache-" + "a".repeat(16);
  const Q = "handio-cache-" + "b".repeat(16);
  const ORPHAN = "handio-cache-" + "c".repeat(16);
  it("pullProgress đếm lớp xong/đã thấy, bỏ dòng khác", () => {
    expect(pullProgress(["x: Pulling from y", "0123456789ab: Pulling fs layer", "0123456789ab: Pull complete", "ba9876543210: Waiting", "Digest: sha256:1"])).toEqual({ layersDone: 1, layersTotal: 2 });
  });
  it("tóm tắt + phạm vi xoá: dự án này / tất cả / dự án đã bỏ khỏi danh sách", () => {
    const vols = [{ name: P, bytes: 1000 }, { name: Q, bytes: 2000 }, { name: ORPHAN, bytes: 500 }];
    const known = new Set([P, Q]);
    expect(summarizeCache(vols, P, known)).toEqual({ project: { name: P, exists: true, bytes: 1000 }, total: { count: 3, bytes: 3500 }, orphans: { count: 1, bytes: 500 } });
    expect(summarizeCache([], P, known).project).toEqual({ name: P, exists: false, bytes: 0 });
    expect(summarizeCache([{ name: P, bytes: null }], P, known).total.bytes).toBeNull();
    expect(cacheTargets(vols, "project", P, known)).toEqual([P]);
    expect(cacheTargets(vols, "orphans", P, known)).toEqual([ORPHAN]);
    expect(cacheTargets(vols, "all", P, known)).toEqual([P, Q, ORPHAN]);
    expect(cacheTargets([{ name: "my-db-data" }, { name: "handio-cache-evil" }], "all", P, new Set())).toEqual([]);
  });
  it("dự án còn trong danh sách được nhận theo cả đường dẫn đã lưu lẫn realpath", () => {
    const real = mk("proj-known");
    const link = path.join(tmp, "link-known");
    if (!WIN) fs.symlinkSync(real, link);
    const k = knownCacheVolumes([WIN ? real : link, "relative/x", 42 as never]);
    expect(k.has(cacheVolumeName(real))).toBe(true);
    if (!WIN) expect(k.has(cacheVolumeName(link))).toBe(true);
  });
  it.skipIf(WIN)("liệt kê/xoá qua docker: bỏ volume không phải của Handio, đang dùng thì để nguyên, không bao giờ prune", async () => {
    const busy = "handio-cache-" + "0".repeat(12) + "beef";
    fs.writeFileSync(VOLS, [P, Q, "my-db-data", "handio-cache-evil", "handio-cache-busy"].join("\n"));
    clearLog();
    const vols = await listCacheVolumes(FAKE);
    expect(vols?.map((v) => v.name)).toEqual([P, Q]);
    expect(vols?.[0].bytes).toBe(1_500_000);
    expect(calls()[0]).toEqual(["volume", "ls", "-q", "--filter", "label=handio.cache=1"]);
    // tên lạ/không có nhãn trong yêu cầu xoá bị bỏ qua dù được truyền vào
    const r = await removeCacheVolumes(FAKE, [P, "my-db-data", "handio-cache-evil", "/var/lib/docker", "-f"]);
    expect(r).toEqual({ removed: [P], failed: [] });
    expect(fs.readFileSync(VOLS, "utf8")).toContain("my-db-data");
    const rm = calls().filter((c) => c[0] === "volume" && c[1] === "rm");
    expect(rm).toEqual([["volume", "rm", P]]);
    expect(JSON.stringify(calls())).not.toMatch(/prune|"-f"/);
    // volume đang dùng: docker từ chối, báo lại
    fs.writeFileSync(VOLS, [Q, busy].join("\n"));
    expect(await removeCacheVolumes(FAKE, [Q, busy])).toEqual({ removed: [Q], failed: [busy] });
    expect(fs.readFileSync(VOLS, "utf8")).toContain(busy);
  });
});

describe.runIf(WIN)("Windows: đường dẫn ổ đĩa", () => {
  it("thư mục dự án trên ổ đĩa (C:\\…, có dấu cách/tiếng Việt) gắn được; gốc ổ đĩa và home bị từ chối", () => {
    const real = mk("Dự án 1");
    expect(checkMountSource(real, "C:\\nonexistent-home")).toMatch(/^[A-Za-z]:\\/);
    expect(() => checkMountSource(real.slice(0, 3), "C:\\nonexistent-home")).toThrow(MountError);
    expect(() => checkMountSource(os.homedir(), os.homedir())).toThrow(MountError);
  });
  it("thư mục chạy lệnh dùng dấu / trong container; ra ngoài dự án bị chặn", () => {
    const root = mk("proj-win");
    fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
    expect(containerWorkdir(root, path.join(root, "src", "a"))).toBe("/workspace/src/a");
    expect(() => containerWorkdir(root, path.join(root, ".."))).toThrow(MountError);
  });
  it("--mount giữ nguyên đường dẫn ổ đĩa Windows", () => {
    const args = dockerRunArgs({ name: "n", realRoot: "C:\\Users\\a\\Dự án", workdir: WORKSPACE, image: DEFAULT_CONTAINER_IMAGE, command: "x", network: false });
    expect(args).toContain("type=bind,source=C:\\Users\\a\\Dự án,target=/workspace");
  });
});
