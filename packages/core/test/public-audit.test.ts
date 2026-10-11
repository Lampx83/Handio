import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// scripts/*.mjs là công cụ Node thuần (không có kiểu): nạp động để không ảnh hưởng typecheck
let A: any;
let R: any;
beforeAll(async () => {
  A = await import(pathToFileURL(path.resolve(__dirname, "../../../scripts/public-audit.mjs")).href);
  R = await import(pathToFileURL(path.resolve(__dirname, "../../../deploy/render-site.mjs")).href);
});

// Giá trị GIẢ hoàn toàn (không phải của tổ chức nào): đủ để kích hoạt từng luật quét
const ip = (...o: number[]) => o.join("."); // ghép lúc chạy để chính tệp này không bị công cụ quét báo
const FAKE_PRIVATE = ip(10, 77, 88, 99);       // địa chỉ riêng không nằm trong danh sách ví dụ
const FAKE_PUBLIC = ip(100, 100, 100, 100);    // địa chỉ công khai lạ
const FAKE_PUBLIC_2 = ip(198, 18, 7, 7);       // địa chỉ công khai lạ khác
const FAKE_GUID = ["9f1c2a3b", "4d5e", "4f60", "8a7b", "0c1d2e3f4a5b"].join("-");
const REAL_MAIL = "nguoi.that" + "@" + "gmail.com";

describe("public-audit: quét thông tin hạ tầng/định danh/bí mật", () => {
  const scan = (text: string, file = "docs/x.md") => A.scan([{ path: file, text }]) as { rule: string; value: string }[];

  it("báo IP lạ, kể cả địa chỉ trong dải riêng không có trong danh sách ví dụ", () => {
    const v = scan(`máy ${FAKE_PRIVATE} và ${FAKE_PUBLIC} và ${FAKE_PUBLIC_2}`).map((f) => f.value);
    expect(v).toEqual([FAKE_PRIVATE, FAKE_PUBLIC, FAKE_PUBLIC_2]);
  });

  it("cho phép loopback, dải tài liệu, địa chỉ riêng ví dụ chung và số phiên bản", () => {
    expect(scan("127.0.0.1 0.0.0.0 192.0.2.10 198.51.100.7 203.0.113.9 10.0.0.1 192.168.1.1 172.16.0.5 169.254.169.254 Chrome/120.0.0.0 1.2.3")).toEqual([]);
  });

  it("báo địa chỉ công khai lạ (IP người dùng) và GUID định danh, cho phép GUID ví dụ", () => {
    const f = scan(`khách ${FAKE_PUBLIC}; tenant ${FAKE_GUID}; mẫu 00000000-0000-0000-0000-000000000000`);
    expect(f.map((x) => x.rule).sort()).toEqual(["guid", "ip"]);
  });

  it("báo khoá/token và email cá nhân thật, bỏ qua email giả đã liệt kê", () => {
    const f = scan("ghp_" + "a".repeat(36) + ` và ${REAL_MAIL} và x@gmail.com`);
    expect(f.map((x) => x.rule).sort()).toEqual(["email", "secret"]);
  });

  it("báo tệp bí mật theo đường dẫn", () => {
    const f = A.scan([{ path: "deploy/.env", text: "" }, { path: "keys/server.pem", text: "" }, { path: "src/ok.ts", text: "" }]) as { rule: string; file: string }[];
    expect(f.map((x) => x.file).sort()).toEqual(["deploy/.env", "keys/server.pem"]);
  });
});

describe("render-site: điền dấu giữ chỗ cấu hình nơi triển khai", () => {
  it("điền đủ khoá, chỉ nhận giá trị an toàn", () => {
    const v = R.parseSiteConf("# chú thích\nSITE_GATEWAY_IP=192.0.2.10\nSITE_GATEWAY_HOSTPORT=192.0.2.10:8037\n");
    expect(R.renderText("proxy_pass http://@@SITE_GATEWAY_HOSTPORT@@/x; allow @@SITE_GATEWAY_IP@@;", v).text).toBe("proxy_pass http://192.0.2.10:8037/x; allow 192.0.2.10;");
    expect(() => R.parseSiteConf("SITE_X=192.0.2.4; rm -rf /")).toThrow(/ký tự không cho phép/);
    expect(() => R.parseSiteConf("khong_phai_khoa=1")).toThrow();
  });

  it("thiếu khoá thì báo, không điền dở", () => {
    const r = R.renderText("a @@SITE_A@@ b @@SITE_B@@", { SITE_A: "1" });
    expect(r.missing).toEqual(["SITE_B"]);
  });

  it("mẫu cấu hình ví dụ đủ khoá cho mọi dấu giữ chỗ trong deploy/", async () => {
    const fs = await import("node:fs");
    const root = path.resolve(__dirname, "../../../deploy");
    const vals = R.parseSiteConf(fs.readFileSync(path.join(root, "site.example.env"), "utf8"));
    const os = await import("node:os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neu-render-"));
    const r = R.renderTree(root, vals, { out: tmp });
    expect(r.missing).toEqual([]);
    expect(R.renderTree(tmp, {}, { check: true }).files).toEqual([]); // không còn dấu giữ chỗ
  });
});
