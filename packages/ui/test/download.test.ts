import { describe, expect, it } from "vitest";
import { fileVersion, storeWinUrl } from "../src/download";

describe("fileVersion", () => {
  it("lấy số phiên bản từ tên tệp cài đặt", () => {
    expect(fileVersion("NEU-Agent-0.8.3-mac-arm64.dmg")).toBe("0.8.3");
    expect(fileVersion("NEU-Agent-0.8.3-mac-x64.dmg")).toBe("0.8.3");
    expect(fileVersion("NEU-Agent-0.9.0-win-x64.exe")).toBe("0.9.0");
    expect(fileVersion("NEU-Agent-1.0.0-beta.1-win-x64.exe")).toBe("1.0.0-beta.1");
    expect(fileVersion("SHA256SUMS.txt")).toBeUndefined();
  });
});

describe("storeWinUrl", () => {
  it("chỉ nhận trang ứng dụng trên apps.microsoft.com (https), sai dạng thì bỏ qua để vẫn đưa tệp .exe", () => {
    expect(storeWinUrl({ store: { win: "https://apps.microsoft.com/detail/9NCW18C30ZNM" } })).toBe("https://apps.microsoft.com/detail/9NCW18C30ZNM");
    expect(storeWinUrl({})).toBeUndefined();
    expect(storeWinUrl({ store: { win: "http://apps.microsoft.com/detail/9NCW18C30ZNM" } })).toBeUndefined();
    expect(storeWinUrl({ store: { win: "https://evil.example/detail/9NCW18C30ZNM" } })).toBeUndefined();
    expect(storeWinUrl({ store: { win: "javascript:alert(1)" } })).toBeUndefined();
    expect(storeWinUrl({ store: { win: 42 } })).toBeUndefined();
  });
});
