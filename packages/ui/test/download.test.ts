import { describe, expect, it } from "vitest";
import { fileVersion } from "../src/download";

describe("fileVersion", () => {
  it("lấy số phiên bản từ tên tệp cài đặt", () => {
    expect(fileVersion("NEU-Agent-0.8.3-mac-arm64.dmg")).toBe("0.8.3");
    expect(fileVersion("NEU-Agent-0.8.3-mac-x64.dmg")).toBe("0.8.3");
    expect(fileVersion("NEU-Agent-0.9.0-win-x64.exe")).toBe("0.9.0");
    expect(fileVersion("NEU-Agent-1.0.0-beta.1-win-x64.exe")).toBe("1.0.0-beta.1");
    expect(fileVersion("SHA256SUMS.txt")).toBeUndefined();
  });
});
