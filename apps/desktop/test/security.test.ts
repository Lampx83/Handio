import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AUTH_METHODS, authArgsOk, authBlocks, CSP, IPC_METHODS, IPC_VALIDATORS, isSafeExternalUrl, isTooBroadFolder, isTrustedSenderUrl, RateLimiter, resolveAppAsset, RISKY_EXT, SECURITY_HEADERS } from "../src/security";

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
    expect(ok("respondPermission", "id1", { allow: true, mode: "auto", plan: "1. làm A" })).toBe(true);
    expect(ok("respondPermission", "id1", { allow: true, plan: 5 })).toBe(false);
    expect(ok("respondPermission", "id1", { allow: true, plan: "x".repeat(20001) })).toBe(false);
    expect(ok("sendFeedback", { kind: "bug", text: "Nút gửi không bấm được", tech: true })).toBe(true);
    expect(ok("sendFeedback", { kind: "hack", text: "xin chào các bạn", tech: true })).toBe(false);
    expect(ok("sendFeedback", { kind: "bug", text: "x".repeat(3001), tech: false })).toBe(false);
    expect(ok("sendFeedback", { kind: "bug", text: "ok ok ok", tech: "yes" })).toBe(false);
    expect(ok("sendFeedback", { kind: "bug", text: "ok ok ok", tech: true, endpoint: "https://evil.test" })).toBe(false);
    expect(ok("sendFeedback", "text")).toBe(false);
    expect(ok("pasteImages", [{ name: "anh-dan-1.png", data: new Uint8Array([1, 2, 3]) }])).toBe(true);
    expect(ok("pasteImages", Array.from({ length: 6 }, () => ({ name: "a.png", data: new Uint8Array([1]) })))).toBe(false);
    expect(ok("pasteImages", [{ name: "a.png", data: "not-bytes" }])).toBe(false);
    expect(ok("pasteImages", [{ name: "a.png", data: new Uint8Array(21 * 1024 * 1024) }])).toBe(false);
    expect(ok("listDir", "src")).toBe(true);
    expect(ok("listDir", { path: "x" })).toBe(false);
  });
  it("saveSettings chỉ nhận các trường cho phép (không thể đặt quyền/quy tắc qua IPC)", () => {
    expect(ok("saveSettings", { baseUrl: "https://x/v1", model: "m", key: "k", thinking: true, allowInsecureHttp: false })).toBe(true);
    expect(ok("saveSettings", { permissions: { allow: ["bash"] } })).toBe(false);
    expect(ok("saveSettings", { mode: "bypass" })).toBe(false);
    expect(ok("saveSettings", { mode: "plan", temperature: 0.3, maxSteps: 40, maxOutputTokens: 4096, contextTokens: 32768 })).toBe(true);
    expect(ok("saveSettings", { mode: "evil" })).toBe(false);
    expect(ok("saveSettings", { temperature: 9 })).toBe(false);
    expect(ok("saveSettings", { maxSteps: 0 })).toBe(false);
    expect(ok("saveSettings", { contextTokens: 1e9 })).toBe(false);
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

describe("IPC dự án / lịch sử / xuất thiết kế", () => {
  const ok = (m: string, ...a: unknown[]) => IPC_VALIDATORS[m](a);
  it("chỉ nhận mã dự án/cuộc trò chuyện đúng dạng (không đường dẫn)", () => {
    expect(ok("projectOpen", "abc123-x")).toBe(true);
    for (const bad of ["", "../x", "a/b", "A", "x".repeat(41), 5, null, "a\0b"]) {
      expect(ok("projectOpen", bad)).toBe(false);
      expect(ok("chatOpen", bad)).toBe(false);
      expect(ok("projectRemove", bad)).toBe(false);
    }
  });
  it("projectCreate: chỉ name + instructions, giới hạn độ dài, không có trường lạ (không đặt được đường dẫn)", () => {
    expect(ok("projectCreate", { name: "Hồ sơ", instructions: "x" })).toBe(true);
    expect(ok("projectCreate", { name: "Hồ sơ", path: "/etc" })).toBe(false);
    expect(ok("projectCreate", { name: 1 })).toBe(false);
    expect(ok("projectCreate", { name: "a", instructions: "y".repeat(20001) })).toBe(false);
    expect(ok("projectCreate", "x")).toBe(false);
  });
  it("instructionsSet và exportDesign kiểm tra kiểu và biên", () => {
    expect(ok("instructionsSet", "ok")).toBe(true);
    expect(ok("instructionsSet", 5)).toBe(false);
    expect(ok("exportDesign", "a.html", "pdf", 794)).toBe(true);
    expect(ok("exportDesign", "a.html", "png", 1080, 1080)).toBe(true);
    expect(ok("exportDesign", "a.html", "exe", 794)).toBe(false);
    expect(ok("exportDesign", "a.html", "png", 99999)).toBe(false);
    expect(ok("exportDesign", "a.html", "png", 800, 1)).toBe(false);
    expect(ok("exportDesign", "a.html", "png", 800.5)).toBe(false);
  });
  it("mọi phương thức mới đều có trong danh sách IPC", () => {
    for (const m of ["projectsState", "projectOpen", "projectCreate", "projectPick", "projectRemove", "projectRename", "instructionsGet", "instructionsSet", "chatList", "chatOpen", "chatRemove", "exportDesign"]) expect(IPC_METHODS.has(m)).toBe(true);
  });
});

describe("isTooBroadFolder", () => {
  const home = "/Users/lan";
  it("từ chối gốc, thư mục cá nhân, thư mục hệ thống và nơi chứa khoá", () => {
    for (const d of ["/", "/Users/lan", "/Users/lan/", "/Users", "/System/Library", "/Applications", "/usr/local", "/etc", "/Library/Application Support", "/Users/lan/.ssh", "/Users/lan/Library/Keychains", "/Users/lan/.aws/x", "/Volumes", "/private/etc"]) expect(isTooBroadFolder(d, home, "darwin"), d).toBe(true);
  });
  it("cho phép thư mục dự án thông thường", () => {
    for (const d of ["/Users/lan/Documents/Code/app", "/Users/lan/Desktop/bai-tap", "/Volumes/Usb/du-an", "/tmp/x", "/private/var/folders/ab/T/x", "/Users/lan/.vibe/proj"]) expect(isTooBroadFolder(d, home, "darwin"), d).toBe(false);
  });
  it("Windows: ổ đĩa, Windows, Program Files, hồ sơ người dùng", () => {
    const wh = "C:\\Users\\Lan";
    for (const d of ["C:\\", "C:\\Windows\\System32", "C:\\Program Files\\X", "C:\\Users", "C:\\Users\\Lan", "C:\\Users\\Lan\\AppData\\Roaming", "C:\\Users\\Lan\\.ssh"]) expect(isTooBroadFolder(d, wh, "win32"), d).toBe(true);
    for (const d of ["C:\\Users\\Lan\\Documents\\app", "D:\\code\\app"]) expect(isTooBroadFolder(d, wh, "win32"), d).toBe(false);
  });
});

describe("IPC: thay đổi, quay lại, gợi ý chạy", () => {
  const ok = (m: string, ...a: unknown[]) => IPC_VALIDATORS[m](a);
  it("có trong danh sách và chỉ nhận đúng kiểu tham số", () => {
    for (const m of ["changesList", "changeDiff", "changesRevert", "rewindPoints", "rewind", "runSuggestions"]) expect(IPC_METHODS.has(m), m).toBe(true);
    expect(ok("changesList")).toBe(true);
    expect(ok("changesList", "x")).toBe(false);
    expect(ok("rewindPoints")).toBe(true);
    expect(ok("runSuggestions", 1)).toBe(false);
  });
  it("changeDiff / changesRevert: chuỗi có giới hạn, không NUL; revert có thể không tham số (tất cả)", () => {
    expect(ok("changeDiff", "src/a.js")).toBe(true);
    expect(ok("changeDiff")).toBe(false);
    expect(ok("changeDiff", 5)).toBe(false);
    expect(ok("changeDiff", "a\0b")).toBe(false);
    expect(ok("changeDiff", "x".repeat(1001))).toBe(false);
    expect(ok("changesRevert")).toBe(true);
    expect(ok("changesRevert", "a.txt")).toBe(true);
    expect(ok("changesRevert", { path: "a" })).toBe(false);
    expect(ok("changesRevert", "a", "b")).toBe(false);
    expect(ok("changesRevert", "a\0")).toBe(false);
  });
  it("rewind: chỉ số nguyên trong khoảng và cờ boolean", () => {
    expect(ok("rewind", 0, true)).toBe(true);
    expect(ok("rewind", 12, false)).toBe(true);
    for (const bad of [[-1, true], [1.5, true], [10_000, true], ["1", true], [1, "yes"], [1], [1, true, 2], [Number.NaN, true], [null, true]]) expect(ok("rewind", ...(bad as unknown[])), JSON.stringify(bad)).toBe(false);
  });
});

describe("IPC: Work — xem tài liệu và quy trình của tôi", () => {
  const ok = (m: string, ...a: unknown[]) => IPC_VALIDATORS[m](a);
  it("có trong danh sách, đúng số tham số và kiểu", () => {
    for (const m of ["docView", "procedureList", "procedureSave", "procedureRemove"]) expect(IPC_METHODS.has(m), m).toBe(true);
    expect(ok("docView", "a.docx")).toBe(true);
    expect(ok("docView", "a.xlsx", "Điểm!C5")).toBe(true);
    for (const bad of [[], [5], ["a", 7], ["a", "b", "c"], ["a\0"], ["x".repeat(1001)], ["a", "x".repeat(201)], [{ path: "a" }], ["a", "b\0"]]) expect(ok("docView", ...(bad as unknown[])), JSON.stringify(bad)).toBe(false);
    expect(ok("procedureList")).toBe(true);
    expect(ok("procedureList", 1)).toBe(false);
    expect(ok("procedureSave", "ten-lenh")).toBe(true);
    expect(ok("procedureSave", "Tên có dấu", "mô tả")).toBe(true);
    for (const bad of [[], [1], ["a", 2], ["a", "b", "c"], ["x".repeat(61)], ["a\0"], ["a", "d".repeat(201)]]) expect(ok("procedureSave", ...(bad as unknown[])), JSON.stringify(bad)).toBe(false);
  });
  it("procedureRemove chỉ nhận slug (không thể trỏ ra đường dẫn)", () => {
    expect(ok("procedureRemove", "tom-tat-2")).toBe(true);
    for (const bad of ["../../AGENTS", "a/b", "a.md", "A", "", "x".repeat(31), "a b", "a\0"]) expect(ok("procedureRemove", bad), bad).toBe(false);
    expect(ok("procedureRemove")).toBe(false);
    expect(ok("procedureRemove", "a", "b")).toBe(false);
  });
});

describe("cổng đăng nhập SSO", () => {
  it("SSO bật mà chưa đăng nhập thì chặn mọi lệnh; đã đăng nhập hoặc SSO tắt thì cho qua", () => {
    expect(authBlocks(true, false)).toBe(true);
    expect(authBlocks(true, true)).toBe(false);
    expect(authBlocks(false, false)).toBe(false);
  });
  it("kênh đăng nhập chỉ có đúng năm lệnh, và không trùng lệnh nghiệp vụ", () => {
    expect([...AUTH_METHODS].sort()).toEqual(["login", "loginPassword", "logout", "remember", "status"]);
    for (const m of AUTH_METHODS) expect(IPC_METHODS.has(m)).toBe(false);
  });
});

describe("tham số kênh đăng nhập", () => {
  it("loginPassword chỉ nhận {username, password} hợp lệ; các lệnh khác không có tham số", () => {
    expect(authArgsOk("loginPassword", { username: "khach01", password: "mat-khau-dung-123" })).toBe(true);
    expect(authArgsOk("loginPassword", { username: "a@neu.edu.vn", password: "x" })).toBe(true);
    for (const bad of [undefined, null, "x", { username: "a b", password: "x" }, { username: "khach01" }, { username: "khach01", password: "" }, { username: "khach01", password: "x".repeat(201) }, { username: "khach01", password: "a\nb" }, { username: "khach01", password: "x", extra: 1 }, { username: 5, password: "x" }]) expect(authArgsOk("loginPassword", bad), JSON.stringify(bad)).toBe(false);
    expect(authArgsOk("status", undefined)).toBe(true);
    expect(authArgsOk("status", { x: 1 })).toBe(false);
    expect(authArgsOk("login", "x")).toBe(false);
  });
  it("remember chỉ nhận đúng {value: boolean}", () => {
    expect(AUTH_METHODS.has("remember")).toBe(true);
    expect(authArgsOk("remember", { value: true })).toBe(true);
    expect(authArgsOk("remember", { value: false })).toBe(true);
    for (const bad of [undefined, null, true, { value: "true" }, { value: 1 }, {}, { value: true, extra: 1 }, { val: true }]) expect(authArgsOk("remember", bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("IPC chẩn đoán: track và feedback chỉ nhận mã ngắn", () => {
  it("track chỉ nhận một chuỗi [a-z_]; feedback nhận up/down và lý do tuỳ chọn", () => {
    const v = IPC_VALIDATORS;
    expect(IPC_METHODS.has("track") && IPC_METHODS.has("feedback")).toBe(true);
    expect(v.track(["suggestion"])).toBe(true);
    for (const bad of [[], ["a", "b"], [1], ["Có Dấu"], ["x".repeat(40)], ["../etc"], [{ a: 1 }]]) expect(v.track(bad as unknown[]), JSON.stringify(bad)).toBe(false);
    expect(v.feedback(["up"])).toBe(true);
    expect(v.feedback(["down", "slow"])).toBe(true);
    for (const bad of [[], ["maybe"], ["up", "a b"], ["up", 1], ["up", "x", "y"], ["down", "Rất tệ, lương của An 20tr"]]) expect(v.feedback(bad as unknown[]), JSON.stringify(bad)).toBe(false);
  });
});
