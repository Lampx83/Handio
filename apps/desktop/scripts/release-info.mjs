// Sau khi đóng gói: tạo SHA256SUMS.txt, SBOM.cdx.json và chép hướng dẫn cài đặt vào thư mục release/.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { notesFor } from "../../../scripts/version.mjs";

const out = path.resolve("release");
const version = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version;
// chỉ các tệp của PHIÊN BẢN HIỆN TẠI: bản cũ còn trong release/ không được lọt vào SHA256SUMS/latest.json (ứng dụng sẽ tải nhầm bản cũ)
const files = fs.readdirSync(out).filter((f) => /\.(dmg|zip|exe)$/.test(f) && f.includes(`-${version}-`)).sort();
if (!files.length) throw new Error(`Không có tệp cài đặt của phiên bản ${version} trong release/. Chạy \`npm run dist\` trước (bản cũ nên chuyển vào release/archive/).`);
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
  const signing = fs.existsSync(path.join(out, "signing.json")) ? JSON.parse(fs.readFileSync(path.join(out, "signing.json"), "utf8")) : null;
  const fl = Object.fromEntries(files.map((f) => [f, { sha256: lines.find((l) => l.endsWith("  " + f)).split("  ")[0], size: fs.statSync(path.join(out, f)).size }]));
  // ghi chú phát hành lấy từ CHANGELOG.md (mục của phiên bản này); NEU_MIN_VERSION (tuỳ chọn) = phiên bản thấp nhất còn được hỗ trợ: bản cũ hơn sẽ bị yêu cầu cập nhật
  const here = path.dirname(fileURLToPath(import.meta.url));
  const notes = notesFor(fs.readFileSync(path.resolve(here, "../../../CHANGELOG.md"), "utf8"), version);
  const minVersion = process.env.NEU_MIN_VERSION || "";
  if (minVersion && !/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,16})?$/.test(minVersion)) throw new Error("NEU_MIN_VERSION không hợp lệ: " + minVersion);
  const latest = { version, released: new Date().toISOString().slice(0, 10), notes, ...(minVersion ? { minVersion } : {}), files: fl, signed: { mac: !!signing?.mac?.notarized, win: !!signing?.win?.signed }, signer: { mac: signing?.mac?.authority || "", win: signing?.win?.subject || "" } };
  fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(latest, null, 2));
  console.log("latest.json: ok", JSON.stringify(latest.signed));
} catch (e) {
  console.warn("Không tạo được latest.json:", e.message.split("\n")[0]);
}
fs.copyFileSync(path.resolve("../../docs/INSTALL.md"), path.join(out, "HUONG-DAN-CAI-DAT.md"));
fs.copyFileSync(path.resolve("../../docs/SECURITY.md"), path.join(out, "BAO-MAT.md"));
