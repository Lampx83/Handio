import { describe, expect, it } from "vitest";
import { expandVars, findPythonDirs, mergeWindowsPath, parseRegPath } from "../src/win-path";

describe("PATH trên Windows (cài Python khi ứng dụng đang mở)", () => {
  it("đọc `reg query` và mở rộng %BIẾN%", () => {
    const out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Programs\\Python\\Python312\;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps\r\n";
    const v = parseRegPath(out);
    expect(v).toContain("Python312");
    expect(expandVars(v, { USERPROFILE: "C:\\Users\\a" })).toBe("C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python312\;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps");
    expect(parseRegPath("ERROR: The system was unable to find the specified registry key")).toBe("");
  });

  it("tìm thư mục cài Python (bản mới trước, kèm Scripts), bỏ thư mục không có python.exe", () => {
    const tree: Record<string, string[]> = {
      "C:\\Users\\a\\AppData\\Local\\Programs\\Python": ["Python311", "Python312", "pip-cache"],
      "C:\\": ["Python39", "Windows", "Python313"],
    };
    const has = (f: string) => ["C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python311\\python.exe", "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python312\\python.exe", "C:\\Python39\\python.exe"].includes(f);
    const dirs = findPythonDirs(Object.keys(tree), (d) => tree[d] ?? [], has);
    expect(dirs).toEqual([
      "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python312", "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python312\\Scripts",
      "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python311", "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python311\\Scripts",
      "C:\\Python39", "C:\\Python39\\Scripts",
    ]);
    expect(findPythonDirs(["C:\\nope"], () => { throw new Error("không có"); }, () => true)).toEqual([]);
  });

  it("ghép PATH: thư mục Python đứng đầu (thắng bí danh WindowsApps), bỏ trùng, giữ cả PATH trong registry mới cài", () => {
    const p = mergeWindowsPath({
      pythonDirs: ["C:\\Py312", "C:\\Py312\\Scripts"],
      processPath: "C:\\Windows\\System32;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps;c:\\py312\\",
      registryPaths: ["C:\\Program Files\\nodejs;C:\\Windows\\System32"],
    });
    expect(p.split(";")).toEqual(["C:\\Py312", "C:\\Py312\\Scripts", "C:\\Windows\\System32", "C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps", "C:\\Program Files\\nodejs"]);
  });
});
