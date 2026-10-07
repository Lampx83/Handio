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

// latest.json: phiên bản + mã băm + tình trạng ký số (trang tải dùng để hiện đúng sự thật; ứng dụng dùng để biết có bản mới)
try {
  const version = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version;
  const signing = fs.existsSync(path.join(out, "signing.json")) ? JSON.parse(fs.readFileSync(path.join(out, "signing.json"), "utf8")) : null;
  const fl = Object.fromEntries(files.map((f) => [f, { sha256: lines.find((l) => l.endsWith("  " + f)).split("  ")[0], size: fs.statSync(path.join(out, f)).size }]));
  const latest = { version, files: fl, signed: { mac: !!signing?.mac?.notarized, win: !!signing?.win?.signed }, signer: { mac: signing?.mac?.authority || "", win: signing?.win?.subject || "" } };
  fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(latest, null, 2));
  console.log("latest.json: ok", JSON.stringify(latest.signed));
} catch (e) {
  console.warn("Không tạo được latest.json:", e.message.split("\n")[0]);
}
fs.copyFileSync(path.resolve("../../docs/INSTALL.md"), path.join(out, "HUONG-DAN-CAI-DAT.md"));
fs.copyFileSync(path.resolve("../../docs/SECURITY.md"), path.join(out, "BAO-MAT.md"));
