import { describe, expect, it } from "vitest";
import { allowedUrl } from "../src/page-check";

describe("check_page: địa chỉ được phép tải", () => {
  it("cho localhost/127.0.0.1 qua http(s) và WebSocket (HMR của Vite dùng ws://localhost; thiếu nó trang luôn báo lỗi giả)", () => {
    for (const u of ["http://localhost:5173/", "https://127.0.0.1:3000/a?b=1", "http://[::1]:8080/", "ws://localhost:5173/?token=abc", "wss://127.0.0.1:5173/"]) expect(allowedUrl(u), u).toBe(true);
  });
  it("chặn mọi địa chỉ ra ngoài máy, kể cả WebSocket", () => {
    for (const u of ["https://example.com/", "http://localhost.evil.com/", "ws://evil.example/socket", "http://192.0.2.5:5173/", "ftp://localhost/x", "http://localhost@evil.com/"]) expect(allowedUrl(u), u).toBe(false);
  });
  it("tệp: chỉ trong thư mục dự án", () => {
    expect(allowedUrl("file:///ws/index.html", "/ws")).toBe(true);
    expect(allowedUrl("file:///etc/passwd", "/ws")).toBe(false);
    expect(allowedUrl("file:///ws-evil/x.html", "/ws")).toBe(false);
  });
});

import { BENIGN } from "../src/page-check";
describe("check_page: lỗi lành tính của công cụ dựng không bị báo", () => {
  it("bỏ qua '[vite] failed to connect to websocket' (HMR), vẫn báo lỗi thật", () => {
    const m = (s: string) => BENIGN.some((re) => re.test(s));
    expect(m("[vite] failed to connect to websocket. your current setup: (browser) localhost:5173/ <--[HTTP]-->")).toBe(true);
    expect(m("Uncaught ReferenceError: Grid is not defined")).toBe(false);
  });
});

import { stepScript } from "../src/page-check";
describe("check_page: mã chạy từng bước", () => {
  it("giá trị của mô hình chỉ đi vào dưới dạng JSON: chuỗi có dấu nháy/backtick/${} không phá được mã", () => {
    const evil = '"); window.__pwned = 1; ("`${x}`</script>';
    for (const st of [{ action: "click", text: evil }, { action: "type", selector: "#a", value: evil }, { action: "expect_text", text: evil }] as const) {
      const code = stepScript(st);
      expect(() => new Function("return " + code)).not.toThrow(); // vẫn là một biểu thức hợp lệ
      expect(code).toContain(JSON.stringify(st));
      expect(code.split(JSON.stringify(st)).join("")).not.toContain("__pwned");
    }
  });
});
