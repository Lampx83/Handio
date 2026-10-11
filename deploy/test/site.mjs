// Dùng chung cho các bài e2e: bản sao deploy/ đã điền cấu hình site THỬ (địa chỉ ví dụ RFC 5737 trong deploy/site.example.env).
// Các tệp mẫu trong kho chỉ có dấu giữ chỗ @@SITE_…@@; script cài từ chối chạy nếu còn dấu giữ chỗ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSiteConf, renderTree } from "../render-site.mjs";

const deploy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = parseSiteConf(fs.readFileSync(path.join(deploy, "site.example.env"), "utf8"));

/** Thư mục chứa bản sao deploy/ đã điền giá trị thử (dùng thay cho deploy/ gốc). */
export function renderedDeploy() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "neu-deploy-site-"));
  const r = renderTree(deploy, SITE, { out });
  if (r.missing.length) throw new Error("deploy/site.example.env thiếu khoá: " + r.missing.join(", "));
  return out;
}
