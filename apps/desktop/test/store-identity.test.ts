import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// scripts/store-identity.mjs là công cụ phát hành (Node thuần, không có kiểu): nạp động để không ảnh hưởng typecheck
let S: any;
beforeAll(async () => {
  S = await import(pathToFileURL(path.resolve(__dirname, "../scripts/store-identity.mjs")).href);
});

const ok = { STORE_IDENTITY_NAME: "12345PhamLam.NEUAgent", STORE_PUBLISHER: "CN=1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D", STORE_PUBLISHER_DISPLAY_NAME: "Phạm Lâm" };

describe("store-identity.mjs", () => {
  it("chưa đặt biến nào: undefined (để --test dùng danh tính giả)", () => {
    expect(S.storeIdentity({})).toBeUndefined();
    expect(S.storeIdentity({ STORE_IDENTITY_NAME: " " })).toBeUndefined();
  });

  it("đủ và đúng dạng: trả danh tính đã cắt khoảng trắng, tên có dấu giữ nguyên", () => {
    expect(S.storeIdentity({ ...ok, STORE_IDENTITY_NAME: ` ${ok.STORE_IDENTITY_NAME}\n` })).toEqual({ identityName: "12345PhamLam.NEUAgent", publisher: ok.STORE_PUBLISHER, publisherDisplayName: "Phạm Lâm" });
  });

  it("thiếu một phần hoặc sai dạng: báo đủ các chỗ sai", () => {
    expect(() => S.storeIdentity({ ...ok, STORE_PUBLISHER: "1A2B3C4D" })).toThrow(/STORE_PUBLISHER phải bắt đầu bằng CN=/);
    expect(() => S.storeIdentity({ ...ok, STORE_IDENTITY_NAME: "NEU Agent" })).toThrow(/STORE_IDENTITY_NAME/);
    expect(() => S.storeIdentity({ STORE_IDENTITY_NAME: ok.STORE_IDENTITY_NAME })).toThrow(/STORE_PUBLISHER phải[\s\S]*STORE_PUBLISHER_DISPLAY_NAME/);
    expect(() => S.storeIdentity({ ...ok, STORE_PUBLISHER_DISPLAY_NAME: "a\nb" })).toThrow(/STORE_PUBLISHER_DISPLAY_NAME/);
  });

  it("danh tính giả để dựng thử cũng qua được kiểm tra", () => {
    const t = S.TEST_IDENTITY;
    expect(S.storeIdentity({ STORE_IDENTITY_NAME: t.identityName, STORE_PUBLISHER: t.publisher, STORE_PUBLISHER_DISPLAY_NAME: t.publisherDisplayName })).toEqual(t);
  });
});
