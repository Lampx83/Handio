// Dựng gói MSIX (.appx) cho Microsoft Store. Chỉ chạy trên Windows: GitHub Actions windows-latest (workflow store.yml), không cần máy Windows riêng.
//   node scripts/store.mjs          danh tính lấy từ STORE_* (xem store-identity.mjs); thiếu thì dừng
//   node scripts/store.mjs --test   thiếu STORE_* thì dùng danh tính giả: chỉ để kiểm tra đóng gói, không nộp được
// Store tự ký lại gói nên không cần chứng chỉ. Gói này KHÔNG lên trang tải: người dùng cài qua Store và Store tự cập nhật (ứng dụng tắt tự cập nhật của mình).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import builder from "electron-builder";
import { storeIdentity, TEST_IDENTITY } from "./store-identity.mjs";

if (process.platform !== "win32") {
  console.error("Gói MSIX chỉ dựng được trên Windows. Chạy workflow \"Store (MSIX)\" trên GitHub Actions (xem docs/RELEASE-SIGNING.md).");
  process.exit(2);
}
let id;
try {
  id = storeIdentity(process.env);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(2);
}
if (!id && process.argv.includes("--test")) {
  id = TEST_IDENTITY;
  console.log("Chưa có STORE_*: dựng THỬ bằng danh tính giả (gói không nộp lên Store được).");
}
if (!id) {
  console.error("Thiếu biến repo STORE_IDENTITY_NAME, STORE_PUBLISHER, STORE_PUBLISHER_DISPLAY_NAME (Partner Center → sản phẩm → Product identity).");
  process.exit(2);
}
console.log(`Gói Store: ${id.identityName} · ${id.publisher} · ${id.publisherDisplayName}`);

const b = spawnSync("node", ["build.mjs"], { stdio: "inherit", env: { ...process.env, RELEASE: "1" } });
if (b.status !== 0) process.exit(b.status ?? 1);

// cấu hình truyền qua API được gộp với electron-builder.yml (không qua shell nên tên có dấu cách/tiếng Việt không bị cắt)
const out = await builder.build({ targets: builder.Platform.WINDOWS.createTarget("appx", builder.Arch.x64), config: { appx: id } });
const pkgs = out.filter((f) => /\.(appx|msix)$/i.test(f));
if (!pkgs.length) {
  console.error("Không thấy gói .appx sau khi dựng.");
  process.exit(1);
}
for (const f of pkgs) console.log(`${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}  ${path.basename(f)}  (${(fs.statSync(f).size / 1e6).toFixed(1)} MB)`);
