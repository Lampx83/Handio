import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CSP, IPC_METHODS, IPC_VALIDATORS, isSafeExternalUrl, isTrustedSenderUrl, RateLimiter, resolveAppAsset, RISKY_EXT, SECURITY_HEADERS } from "../src/security";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "neu-sec-")));
const root = path.join(tmp, "renderer");
const outside = path.join(tmp, "secret.txt");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), "<html>ok</html>");
fs.writeFileSync(path.join(root, "sub", "a.js"), "1");
fs.writeFileSync(outside, "TOP SECRET");
fs.symlinkSync(outside, path.join(root, "link.txt"));
fs.symlinkSync(tmp, path.join(root, "dirlink"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("giao thức app:// (chống đọc tệp ngoài thư mục giao diện)", () => {
  it("phục vụ tệp hợp lệ", () => {
    expect(resolveAppAsset(root, "app://main/")).toBe(path.join(root, "index.html"));
    expect(resolveAppAsset(root, "app://main/index.html")).toBe(path.join(root, "index.html"));
    expect(resolveAppAsset(root, "app://main/sub/a.js")).toBe(path.join(root, "sub", "a.js"));
    expect(resolveAppAsset(root, "app://main/index.html?x=1#y")).toBe(path.join(root, "index.html"));
  });
  it("từ chối mọi cách thoát ra ngoài", () => {
    for (const u of [
      "app://main/../secret.txt", "app://main/%2e%2e/secret.txt", "app://main/sub/../../secret.txt", "app://main/%2e%2e%2fsecret.txt", "app://main/..%5csecret.txt",
      "app://main/sub%00/a.js", "app://main/link.txt", "app://main/dirlink/secret.txt", "app://main//etc/passwd", "app://main/%2Fetc%2Fpasswd",
      "app://other/index.html", "file:///etc/passwd", "http://main/index.html", "app://user:pw@main/index.html", "app://main/sub", "app://main/missing.js", "không phải url",
    ])
      expect(resolveAppAsset(root, u), u).toBeNull();
  });
  it("CSP và header an toàn đầy đủ, không cho ra mạng", () => {
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|https?:|\*/);
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });
});

describe("kiểm tra yêu cầu IPC", () => {
  const ok = (m: string, ...a: unknown[]) => IPC_VALIDATORS[m](a);
  it("chỉ nhận người gửi là giao diện của app", () => {
    expect(isTrustedSenderUrl("app://main/index.html")).toBe(true);
    for (const u of [undefined, "", "file:///x/index.html", "https://evil.com/", "app://mainx/index.html", "app://main.evil/index.html", "http://app://main/"]) expect(isTrustedSenderUrl(u), String(u)).toBe(false);
  });
  it("chỉ các lệnh có trong danh sách và đúng kiểu tham số", () => {
    expect(IPC_METHODS.has("exec")).toBe(false);
    expect(IPC_METHODS.has("constructor")).toBe(false);
    expect(ok("send", "xin chào")).toBe(true);
    expect(ok("send", 123)).toBe(false);
    expect(ok("send", "a".repeat(500_000))).toBe(false);
    expect(ok("send", "có\0nul")).toBe(false);
    expect(ok("send")).toBe(false);
    expect(ok("setMode", "bypass")).toBe(true);
    expect(ok("setMode", "root")).toBe(false);
    expect(ok("respondPermission", "id1", { allow: true, always: false })).toBe(true);
    expect(ok("respondPermission", "id1", { allow: "yes" })).toBe(false);
    expect(ok("respondPermission", "id1", { allow: true, mode: "god" })).toBe(false);
    expect(ok("listDir", "src")).toBe(true);
    expect(ok("listDir", { path: "x" })).toBe(false);
  });
  it("saveSettings chỉ nhận các trường cho phép (không thể đặt quyền/quy tắc qua IPC)", () => {
    expect(ok("saveSettings", { baseUrl: "https://x/v1", model: "m", key: "k", thinking: true, allowInsecureHttp: false })).toBe(true);
    expect(ok("saveSettings", { permissions: { allow: ["bash"] } })).toBe(false);
    expect(ok("saveSettings", { mode: "bypass" })).toBe(false);
    expect(ok("saveSettings", { thinking: "yes" })).toBe(false);
    expect(ok("saveSettings", { baseUrl: "x".repeat(5000) })).toBe(false);
  });
  it("tải tệp lên: giới hạn số lượng, kích thước, kiểu", () => {
    const f = (name: string, n: number) => ({ name, data: new Uint8Array(n) });
    expect(ok("uploadFiles", [f("a.txt", 10)])).toBe(true);
    expect(ok("uploadFiles", Array.from({ length: 51 }, (_, i) => f(`a${i}`, 1)))).toBe(false);
    expect(ok("uploadFiles", [f("big.bin", 51 * 1024 * 1024)])).toBe(false);
    expect(ok("uploadFiles", Array.from({ length: 5 }, (_, i) => f(`b${i}`, 45 * 1024 * 1024)))).toBe(false); // tổng > 200 MB
    expect(ok("uploadFiles", [{ name: "a", data: "chuỗi" }])).toBe(false);
    expect(ok("uploadFiles", [{ name: "a\0b", data: new Uint8Array(1) }])).toBe(false);
  });
  it("giới hạn tần suất", () => {
    const r = new RateLimiter(3, 1000);
    expect([r.allow(0), r.allow(10), r.allow(20), r.allow(30)]).toEqual([true, true, true, false]);
    expect(r.allow(1500)).toBe(true);
  });
});

describe("liên kết ngoài và tệp nguy hiểm", () => {
  it("chỉ mở https không kèm tài khoản", () => {
    expect(isSafeExternalUrl("https://example.com/a?b=1")).toBe(true);
    for (const u of ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "ms-msdt:/id", "smb://x/y", "https://u:p@example.com", "data:text/html,x", "app://main/"]) expect(isSafeExternalUrl(u), u).toBe(false);
  });
  it("không mở tệp thực thi/kịch bản bằng nút “Mở bằng ứng dụng”", () => {
    for (const f of ["a.exe", "b.APP", "c.sh", "d.command", "e.bat", "f.ps1", "g.js", "h.py", "i.lnk", "j.jar", "k.msi", "l.hta", "m.dmg", "n.reg", "o.vbs", "p.url"]) expect(RISKY_EXT.test(f), f).toBe(true);
    for (const f of ["a.docx", "b.xlsx", "c.pptx", "d.pdf", "e.html", "f.txt", "g.png", "h.csv", "i.md"]) expect(RISKY_EXT.test(f), f).toBe(false);
  });
});

describe("IPC mới và xem trước localhost", () => {
  it("chỉ mở http(s) tới localhost", async () => {
    const { isLocalPreviewUrl } = await import("../src/security");
    for (const u of ["http://localhost:8501/", "http://127.0.0.1:3000", "https://localhost:8443/x", "http://[::1]:80/"]) expect(isLocalPreviewUrl(u), u).toBe(true);
    for (const u of ["http://localhost.evil.com/", "http://evil.com:8501/", "file:///etc/passwd", "http://u:p@localhost/", "javascript:1", "http://127.0.0.1.evil.com/", "x"]) expect(isLocalPreviewUrl(u), u).toBe(false);
  });
  it("kiểm tra tham số các lệnh học tập/tiến trình", () => {
    const ok = (m: string, ...a: unknown[]) => IPC_VALIDATORS[m](a);
    expect(ok("learnHint", "js-01-x", 0)).toBe(true);
    expect(ok("learnHint", "js-01-x", -1)).toBe(false);
    expect(ok("learnHint", "js-01-x", "1")).toBe(false);
    expect(ok("learnGrade", "../../etc")).toBe(true); // id được tra trong danh sách tĩnh nên đường dẫn lạ chỉ cho "không có bài tập"
    expect(ok("learnGrade")).toBe(false);
    expect(ok("stopProcess", "p1")).toBe(true);
    expect(ok("openUrl", "http://localhost:8501/")).toBe(true);
    expect(ok("searchFiles", "app")).toBe(true);
    expect(ok("searchFiles", { q: 1 })).toBe(false);
  });
});
