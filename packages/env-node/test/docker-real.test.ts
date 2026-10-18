// Chạy Docker THẬT (tự bỏ qua khi máy không có Docker đang chạy hoặc chưa có sẵn ảnh mặc định: bài thử không tự tải ảnh qua mạng).
// Kiểm chứng các rào của container: không root, không ghi được ngoài dự án, không thấy tệp ngoài dự án (kể cả qua symlink), không mạng, hết giờ thì dọn.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decideContainer, DEFAULT_CONTAINER_IMAGE } from "@neu/agent-core";
import { cacheVolumeName, cleanupContainersSync, findDocker, NodeEnv, type ContainerChoice } from "../src";

const bin = findDocker();
const ready = (() => {
  if (!bin || process.env.HANDIO_SKIP_DOCKER) return false;
  const v = spawnSync(bin, ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 8000 });
  if (v.status !== 0) return false;
  return spawnSync(bin, ["image", "inspect", DEFAULT_CONTAINER_IMAGE], { stdio: "ignore", timeout: 8000 }).status === 0;
})();

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
  it("chạy nền + cổng xem trước trên 127.0.0.1 (có mạng): máy chủ trong container mở được từ máy", async () => {
    const port = 5000 + Math.floor(Math.random() * 3000);
    const bg = new NodeEnv(proj, { container: { decide: async () => choice({ network: true, ports: [port] }) } });
    let out = "";
    const h = bg.spawn(`node -e "require('http').createServer((q,s)=>s.end('tu-container')).listen(${port},'0.0.0.0',()=>console.log('listening'))"`, { cwd: proj, onData: (d) => (out += d), onExit: () => undefined });
    try {
      for (let i = 0; i < 40 && !out.includes("listening"); i++) await new Promise((res) => setTimeout(res, 250));
      expect(out).toContain("listening");
      const body = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
      expect(body).toBe("tu-container");
    } finally {
      h.stop();
    }
  });
});
