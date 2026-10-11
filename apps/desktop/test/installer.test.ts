import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canInstallHere, launchInstaller, macBundleOf, MAC_SCRIPT } from "../src/installer";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neu-inst-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const spy = () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = (cmd: string, args: string[]) => (calls.push({ cmd, args }), { unref() {}, on() { return this as never; } });
  return { calls, spawn: spawn as never };
};

describe("installer", () => {
  it("macBundleOf và canInstallHere", () => {
    const exe = "/Applications/NEU Agent.app/Contents/MacOS/NEU Agent";
    expect(macBundleOf(exe)).toBe("/Applications/NEU Agent.app");
    expect(macBundleOf("/usr/bin/node")).toBeNull();
    const w = () => true;
    expect(canInstallHere("darwin", "NEU-Agent-0.9.0-mac-arm64.dmg", exe, w)).toBe(true);
    expect(canInstallHere("darwin", "NEU-Agent-0.9.0-mac-arm64.zip", exe, w)).toBe(false);
    expect(canInstallHere("darwin", "x.dmg", exe, () => false)).toBe(false); // /Applications không ghi được (không phải quản trị)
    expect(canInstallHere("darwin", "x.dmg", "/private/var/folders/x/AppTranslocation/ABC/d/NEU Agent.app/Contents/MacOS/NEU Agent", w)).toBe(false);
    expect(canInstallHere("darwin", "x.dmg", "/Volumes/NEU Agent/NEU Agent.app/Contents/MacOS/NEU Agent", w)).toBe(false); // chạy thẳng từ ổ đĩa ảnh
    expect(canInstallHere("win32", "NEU-Agent-0.9.0-win-x64.exe", "C:\\x\\NEU Agent.exe", w)).toBe(true);
    expect(canInstallHere("win32", "x.zip", "C:\\x", w)).toBe(false);
    expect(canInstallHere("linux", "x.AppImage", "/x", w)).toBe(false);
  });

  it("Windows: chạy trình cài NSIS im lặng; mở lại hay không tuỳ relaunch", () => {
    const f = path.join(tmp, "Setup.exe");
    fs.writeFileSync(f, "x");
    const a = spy();
    expect(launchInstaller({ platform: "win32", file: f, execPath: "C:\\x.exe", pid: 1, tmpDir: tmp, spawn: a.spawn })).toBe(true);
    expect(a.calls[0]).toEqual({ cmd: f, args: ["/S", "--updated", "--force-run"] });
    const b = spy();
    launchInstaller({ platform: "win32", file: f, execPath: "C:\\x.exe", pid: 1, tmpDir: tmp, relaunch: false, spawn: b.spawn });
    expect(b.calls[0].args).toEqual(["/S", "--updated"]);
  });

  it("từ chối tệp lạ: không phải .exe/.dmg, không tồn tại, đường dẫn tương đối", () => {
    const z = path.join(tmp, "a.zip");
    fs.writeFileSync(z, "x");
    const a = spy();
    expect(launchInstaller({ platform: "win32", file: z, execPath: "", pid: 1, tmpDir: tmp, spawn: a.spawn })).toBe(false);
    expect(launchInstaller({ platform: "win32", file: path.join(tmp, "khong-co.exe"), execPath: "", pid: 1, tmpDir: tmp, spawn: a.spawn })).toBe(false);
    expect(launchInstaller({ platform: "win32", file: "Setup.exe", execPath: "", pid: 1, tmpDir: tmp, spawn: a.spawn })).toBe(false);
    expect(launchInstaller({ platform: "linux", file: z, execPath: "", pid: 1, tmpDir: tmp, spawn: a.spawn })).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it("macOS: chạy đoạn shell với pid, dmg, .app và cờ mở lại", () => {
    const dmg = path.join(tmp, "a.dmg");
    fs.writeFileSync(dmg, "x");
    const a = spy();
    expect(launchInstaller({ platform: "darwin", file: dmg, execPath: "/Applications/NEU Agent.app/Contents/MacOS/NEU Agent", pid: 4321, tmpDir: tmp, relaunch: false, spawn: a.spawn })).toBe(true);
    expect(a.calls[0].cmd).toBe("/bin/bash");
    expect(a.calls[0].args.slice(1)).toEqual(["4321", dmg, "/Applications/NEU Agent.app", "0"]);
    expect(fs.readFileSync(a.calls[0].args[0], "utf8")).toBe(MAC_SCRIPT);
    expect(fs.statSync(a.calls[0].args[0]).mode & 0o777).toBe(0o700);
  });

  it.runIf(process.platform === "darwin")("macOS thật: gắn dmg, thay .app, giữ nội dung mới, dọn ổ đĩa ảnh", () => {
    const work = fs.mkdtempSync(path.join(tmp, "mac-"));
    const make = (dir: string, version: string) => {
      const exe = path.join(dir, "Contents", "MacOS");
      fs.mkdirSync(exe, { recursive: true });
      fs.writeFileSync(path.join(exe, "App"), "#!/bin/sh\n");
      fs.writeFileSync(path.join(dir, "Contents", "version.txt"), version);
    };
    const src = path.join(work, "dmgsrc");
    fs.mkdirSync(src);
    make(path.join(src, "Demo.app"), "2.0");
    const dmg = path.join(work, "Demo.dmg");
    execFileSync("hdiutil", ["create", "-quiet", "-srcfolder", src, "-format", "UDZO", "-volname", "DemoUpd", dmg]);
    const installed = path.join(work, "Apps", "Demo.app");
    make(installed, "1.0");
    const script = path.join(work, "run.sh");
    fs.writeFileSync(script, MAC_SCRIPT, { mode: 0o700 });
    execFileSync("/bin/bash", [script, "999999", dmg, installed, "0"], { env: { ...process.env, TMPDIR: work + "/" } });
    expect(fs.readFileSync(path.join(installed, "Contents", "version.txt"), "utf8")).toBe("2.0");
    expect(fs.existsSync(installed + ".update-old")).toBe(false);
    expect(fs.existsSync(installed + ".update-new")).toBe(false);
    expect(execFileSync("hdiutil", ["info"]).toString()).not.toContain("DemoUpd");
  });
});
