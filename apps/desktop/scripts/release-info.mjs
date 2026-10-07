// Sau khi đóng gói: tạo SHA256SUMS.txt, SBOM.cdx.json và chép hướng dẫn cài đặt vào thư mục release/.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("release");
const files = fs.readdirSync(out).filter((f) => /\.(dmg|zip|exe)$/.test(f)).sort();
if (!files.length) throw new Error("Không có tệp cài đặt trong release/. Chạy `npm run dist` trước.");
const lines = files.map((f) => `${createHash("sha256").update(fs.readFileSync(path.join(out, f))).digest("hex")}  ${f}`);
fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));

try {
  const root = path.resolve("../..");
  const sbom = execFileSync("npm", ["sbom", "--sbom-format", "cyclonedx", "--omit=dev", "--package-lock-only"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  fs.writeFileSync(path.join(out, "SBOM.cdx.json"), sbom);
  console.log("SBOM.cdx.json: ok");
} catch (e) {
  console.warn("Không tạo được SBOM:", e.message.split("\n")[0]);
}
fs.copyFileSync(path.resolve("../../docs/INSTALL.md"), path.join(out, "HUONG-DAN-CAI-DAT.md"));
fs.copyFileSync(path.resolve("../../docs/SECURITY.md"), path.join(out, "BAO-MAT.md"));
