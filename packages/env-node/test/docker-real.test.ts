// Chạy Docker THẬT (tự bỏ qua khi máy không có Docker đang chạy hoặc chưa có sẵn ảnh mặc định: bài thử không tự tải ảnh qua mạng).
// Kiểm chứng các rào của container: không root, không ghi được ngoài dự án, không thấy tệp ngoài dự án (kể cả qua symlink), không mạng, hết giờ thì dọn.
// CI (job "Container Docker thật"): HANDIO_REQUIRE_DOCKER=1 = thiếu Docker/ảnh thì ĐỎ thay vì bỏ qua; HANDIO_DOCKER_NET=1 = chạy cả bài cần mạng (pip).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CACHE_VOLUME_RE, decideContainer, DEFAULT_CONTAINER_IMAGE, PIP_BOOTSTRAP } from "@neu/agent-core";
import { CACHE_LABEL, cacheVolumeName, cleanupContainersSync, findDocker, listCacheVolumes, NodeEnv, removeCacheVolumes, type ContainerChoice } from "../src";

const bin = findDocker();
const why = (() => {
  if (!bin) return "không tìm thấy docker CLI";
  if (process.env.HANDIO_SKIP_DOCKER) return "HANDIO_SKIP_DOCKER";
  const v = spawnSync(bin, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 8000 });
  if (v.status !== 0) return "Docker daemon không chạy";
  if (spawnSync(bin, ["image", "inspect", DEFAULT_CONTAINER_IMAGE], { stdio: "ignore", timeout: 8000 }).status !== 0) return `chưa có ảnh ${DEFAULT_CONTAINER_IMAGE} (docker pull ${DEFAULT_CONTAINER_IMAGE})`;
  return "";
})();
const ready = !why;
const NET = !!process.env.HANDIO_DOCKER_NET;

describe.runIf(!!process.env.HANDIO_REQUIRE_DOCKER)("CI bắt buộc Docker thật", () => {
  it("Docker + ảnh mặc định dùng được (không được bỏ qua bộ bài)", () => {
    expect(why).toBe("");
  });
});

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-docker-real-")));
const proj = path.join(tmp, "Dự án thật");
const outside = path.join(tmp, "ngoai-du-an");
fs.mkdirSync(proj);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, "secret.txt"), "TOP-SECRET-OUTSIDE");
fs.symlinkSync(outside, path.join(proj, "link-ra-ngoai"));
afterAll(() => {
  if (bin && ready) cleanupContainersSync(bin);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const choice = (over: Partial<ContainerChoice> = {}): ContainerChoice => ({ ...decideContainer({ container: true }, undefined, { ok: true }), docker: bin ?? undefined, cache: false, ...over });
const env = new NodeEnv(proj, { container: { decide: async () => choice() } });
const run = (cmd: string, timeoutMs = 60_000) => env.exec(cmd, { cwd: proj, timeoutMs });

describe.skipIf(!ready)("Docker thật: rào của container", () => {
  it("không chạy bằng root; thư mục làm việc là /workspace; ghi được trong dự án (thấy trên máy)", async () => {
    const r = await run("id -u; pwd; echo xin-chao > tu-container.txt; ls");
    expect(r.code, r.output).toBe(0);
    const [uid, pwd] = r.output.trim().split("\n");
    expect(Number(uid)).not.toBe(0);
    expect(pwd).toBe("/workspace");
    expect(fs.readFileSync(path.join(proj, "tu-container.txt"), "utf8").trim()).toBe("xin-chao");
  });
  it("không ghi được ra ngoài dự án (rootfs chỉ đọc); /tmp ghi được nhưng mất sau lệnh", async () => {
    const r = await run("touch /etc/x 2>&1; echo etc=$?; touch /usr/local/bin/x 2>&1; echo usr=$?; echo t > /tmp/t && echo tmp-ok");
    expect(r.output).toMatch(/etc=[1-9]/);
    expect(r.output).toMatch(/usr=[1-9]/);
    expect(r.output).toContain("tmp-ok");
    expect((await run("cat /tmp/t 2>&1; echo code=$?")).output).toMatch(/code=[1-9]/);
  });
  it("không thấy tệp ngoài dự án: đường dẫn của máy không tồn tại, symlink ra ngoài không đọc được", async () => {
    const r = await run(`cat "${path.join(outside, "secret.txt")}" 2>&1; cat link-ra-ngoai/secret.txt 2>&1; ls ${JSON.stringify(os.homedir())} 2>&1; echo done`);
    expect(r.output).not.toContain("TOP-SECRET-OUTSIDE");
    expect(r.output).toContain("done");
    expect((await run("ls /var/run/docker.sock 2>&1; echo code=$?")).output).toMatch(/code=[1-9]/);
  });
  it("--network none: không ra được mạng (kể cả máy chủ nội bộ)", async () => {
    const r = await run(`node -e "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(4000)}).then(()=>console.log('NET-OK')).catch(e=>console.log('NET-FAIL',e.cause?.code||e.name))"; cat /sys/class/net/*/operstate 2>/dev/null | tr '\\n' ' '; ls /sys/class/net`);
    expect(r.output).not.toContain("NET-OK");
    expect(r.output).toContain("NET-FAIL");
    expect(r.output.trim().split(/\s+/)).toContain("lo");
    expect(r.output).not.toMatch(/\beth0\b/);
  });
  it("không có capability (không đổi chủ tệp, không nâng quyền)", async () => {
    const r = await run("grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status");
    expect(r.output).toMatch(/CapEff:\s+0+\b/);
    expect(r.output).toMatch(/NoNewPrivs:\s+1/);
  });
  it("hết giờ: dừng và xoá container", async () => {
    const r = await run("sleep 60", 2500);
    expect(r.timedOut).toBe(true);
    await new Promise((res) => setTimeout(res, 2000));
    const ps = spawnSync(bin!, ["ps", "-q", "--filter", "label=handio.sandbox=1"], { encoding: "utf8" });
    expect(ps.stdout.trim()).toBe("");
  });
  it("volume cache theo dự án: người dùng không root ghi được, còn lại giữa các lệnh", async () => {
    const cached = new NodeEnv(proj, { container: { decide: async () => choice({ cache: true }) } });
    const a = await cached.exec("npm config get cache; mkdir -p /cache/npm && echo giu-lai > /cache/npm/handio-test && echo ok", { cwd: proj, timeoutMs: 60_000 });
    expect(a.output, a.output).toContain("/cache/npm");
    expect(a.output).toContain("ok");
    expect((await cached.exec("cat /cache/npm/handio-test", { cwd: proj, timeoutMs: 60_000 })).output).toContain("giu-lai");
    spawnSync(bin!, ["volume", "rm", "-f", cacheVolumeName(fs.realpathSync(proj))], { stdio: "ignore" });
  });
  it("ảnh mặc định có cả Node và Python; venv (không pip) tạo được trong dự án dưới rootfs chỉ đọc, không root", async () => {
    const r = await run("node -v; python3 --version; rm -rf .venv && python3 -m venv --without-pip .venv && .venv/bin/python -c 'import sys; print(\"venv\", sys.prefix)'");
    expect(r.code, r.output).toBe(0);
    expect(r.output).toMatch(/v22\.\d+/);
    expect(r.output).toMatch(/Python 3\.\d+/);
    expect(r.output).toContain("venv /workspace/.venv");
    expect(fs.existsSync(path.join(proj, ".venv", "bin", "python"))).toBe(true);
    fs.rmSync(path.join(proj, ".venv"), { recursive: true, force: true });
  });
  it.skipIf(process.platform === "win32")("tệp tạo trong container thuộc người dùng của máy (uid/gid), không phải root", async () => {
    const r = await run("echo x > chu-so-huu.txt; id -u; id -g");
    expect(r.code, r.output).toBe(0);
    const st = fs.statSync(path.join(proj, "chu-so-huu.txt"));
    const [cu, cg] = r.output.trim().split("\n").map(Number);
    console.log(`[docker-real] máy: uid=${process.getuid?.()} gid=${process.getgid?.()} · container: uid=${cu} gid=${cg} · tệp: uid=${st.uid} gid=${st.gid}`);
    expect(cu).toBe(process.getuid?.() || 1000);
    if (process.platform === "linux") expect(st.uid).toBe(process.getuid?.()); // macOS (virtiofs) tự quy về người dùng của máy
  });
  it("chưa có ảnh: lệnh không chạy, báo “Tải ảnh”, KHÔNG tự docker pull", async () => {
    const missing = `handio-test-missing-${randomBytes(4).toString("hex")}:0`;
    const e = new NodeEnv(proj, { container: { decide: async () => choice({ image: missing }) } });
    const r = await e.exec("echo SHOULD-NOT-RUN", { cwd: proj, timeoutMs: 30_000 });
    expect(r.code).toBe(126);
    expect(r.output).toContain("Tải ảnh");
    expect(spawnSync(bin!, ["image", "inspect", missing], { stdio: "ignore" }).status).not.toBe(0);
  });
  it("cache: PIP_CACHE_DIR ghi được; liệt kê/xoá CHỈ volume có nhãn + tên của Handio", async () => {
    const vol = cacheVolumeName(fs.realpathSync(proj));
    const cached = new NodeEnv(proj, { container: { decide: async () => choice({ cache: true }) } });
    const a = await cached.exec('echo "pip=$PIP_CACHE_DIR"; mkdir -p "$PIP_CACHE_DIR" && echo x > "$PIP_CACHE_DIR/handio-test" && echo pip-ok', { cwd: proj, timeoutMs: 60_000 });
    expect(a.output, a.output).toContain("pip=/cache/pip");
    expect(a.output).toContain("pip-ok");
    // volume lạ: tên khác, và tên GIỐNG của Handio nhưng không có nhãn: không bao giờ bị xoá
    const other = `handio-test-other-${randomBytes(4).toString("hex")}`;
    const lookalike = "handio-cache-" + randomBytes(8).toString("hex");
    expect(CACHE_VOLUME_RE.test(lookalike)).toBe(true);
    for (const v of [other, lookalike]) expect(spawnSync(bin!, ["volume", "create", v], { stdio: "ignore" }).status).toBe(0);
    try {
      const list = (await listCacheVolumes(bin!))!.map((v) => v.name);
      expect(list).toContain(vol);
      expect(list).not.toContain(other);
      expect(list).not.toContain(lookalike);
      const r = await removeCacheVolumes(bin!, [vol, other, lookalike]);
      expect(r).toEqual({ removed: [vol], failed: [] });
      for (const v of [other, lookalike]) expect(spawnSync(bin!, ["volume", "inspect", v], { stdio: "ignore" }).status, v).toBe(0);
      // xoá xong: lần chạy sau tạo lại volume có nhãn và vẫn ghi được (không thành volume của root)
      const b = await cached.exec('mkdir -p "$PIP_CACHE_DIR" && echo y > "$PIP_CACHE_DIR/t" && echo again-ok', { cwd: proj, timeoutMs: 60_000 });
      expect(b.output, b.output).toContain("again-ok");
      expect(spawnSync(bin!, ["volume", "inspect", "--format", "{{json .Labels}}", vol], { encoding: "utf8" }).stdout).toContain(CACHE_LABEL.split("=")[0]);
    } finally {
      spawnSync(bin!, ["volume", "rm", "-f", other, lookalike, vol], { stdio: "ignore" });
    }
  });
  it.runIf(NET)("có mạng: tạo venv + cài pip theo đúng công thức trong lời nhắc, pip install dùng cache /cache/pip", async () => {
    const vol = cacheVolumeName(fs.realpathSync(proj));
    const e = new NodeEnv(proj, { container: { decide: async () => choice({ cache: true, network: true }) } });
    try {
      const r = await e.exec(`rm -rf .venv && ${PIP_BOOTSTRAP} && .venv/bin/pip install -q six && .venv/bin/python -c "import six; print('six-ok')" && ls /cache/pip`, { cwd: proj, timeoutMs: 300_000 });
      expect(r.code, r.output).toBe(0);
      expect(r.output).toContain("six-ok");
      expect(r.output).toMatch(/http|wheels/);
    } finally {
      fs.rmSync(path.join(proj, ".venv"), { recursive: true, force: true });
      spawnSync(bin!, ["volume", "rm", "-f", vol], { stdio: "ignore" });
    }
  }, 320_000);
  it("chạy nền + cổng xem trước trên 127.0.0.1 (có mạng): máy chủ trong container mở được từ máy", async () => {
    const port = 5000 + Math.floor(Math.random() * 3000);
    const bg = new NodeEnv(proj, { container: { decide: async () => choice({ network: true, ports: [port] }) } });
    let out = "";
    const h = bg.spawn(`node -e "require('http').createServer((q,s)=>s.end('tu-container')).listen(${port},'0.0.0.0',()=>console.log('listening'))"`, { cwd: proj, onData: (d) => (out += d), onExit: () => undefined });
    try {
      for (let i = 0; i < 40 && !out.includes("listening"); i++) await new Promise((res) => setTimeout(res, 250));
      expect(out).toContain("listening");
      // cổng của Docker Desktop có thể mở chậm hơn tiến trình trong container một chút (máy bận): thử lại tới ~5 giây
      let body = "";
      for (let i = 0; i < 20 && body !== "tu-container"; i++) {
        body = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()).catch((e: Error) => String(e.cause ?? e));
        if (body !== "tu-container") await new Promise((res) => setTimeout(res, 250));
      }
      expect(body).toBe("tu-container");
    } finally {
      h.stop();
    }
  });
});
