// Phát hành: chọn chế độ ký theo chứng chỉ có sẵn, đóng gói, kiểm tra chữ ký, tạo SHA256SUMS/SBOM/latest.json.
//   node scripts/release.mjs [--mac] [--win]        (mặc định cả hai)
// Biến môi trường (KHÔNG bao giờ ghi vào mã nguồn):
//   macOS ký:        CSC_LINK (đường dẫn/base64 của .p12 "Developer ID Application") + CSC_KEY_PASSWORD, hoặc chứng chỉ có sẵn trong Keychain (CSC_NAME)
//   macOS notarize:  APPLE_API_KEY (đường dẫn .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER   — hoặc —   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   Windows ký:      WIN_CSC_LINK (.pfx) + WIN_CSC_KEY_PASSWORD (nên dựng trên Windows; xem docs/RELEASE-SIGNING.md)
//   Cấu hình ứng dụng: NEU_DEFAULT_BASE_URL, NEU_AUTH_* (xem build.mjs)
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const wantMac = args.has("--mac") || !args.has("--win");
const wantWin = args.has("--win") || !args.has("--mac");
const env = process.env;

const macCert = !!(env.CSC_LINK || env.CSC_NAME);
const notaryKey = !!(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER);
const notaryId = !!(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID);
const macSign = macCert && (notaryKey || notaryId);
const winCert = !!(env.WIN_CSC_LINK || (env.CSC_LINK && wantWin && !wantMac));
const onWin = process.platform === "win32";

console.log("== Kế hoạch phát hành ==");
if (wantMac) console.log(macSign ? "macOS: KÝ + NOTARIZE (Hardened Runtime) → tải về chạy ngay" : `macOS: KHÔNG ký (${macCert ? "có chứng chỉ nhưng thiếu khoá notarize" : "chưa có chứng chỉ Developer ID"}) → macOS sẽ cảnh báo lần đầu mở`);
if (wantWin) console.log(winCert && onWin ? "Windows: KÝ SỐ (Authenticode)" : winCert ? "Windows: có chứng chỉ nhưng đang ở máy không phải Windows → KHÔNG ký (hãy dựng bản Windows trên Windows/GitHub Actions)" : "Windows: KHÔNG ký → SmartScreen hiện “Nhà phát hành không xác định”");
if (env.NEU_REQUIRE_SIGNED === "1" && ((wantMac && !macSign) || (wantWin && !(winCert && onWin)))) {
  console.error("NEU_REQUIRE_SIGNED=1 nhưng thiếu điều kiện ký ở trên. Dừng (không phát hành bản không ký).");
  process.exit(2);
}

const run = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { stdio: "inherit", env: { ...env, ...opts.env }, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("node", ["build.mjs"], { env: { RELEASE: "1" } });
const builder = ["electron-builder"];
const macArgs = ["--mac", ...(macSign
  ? ["-c.mac.hardenedRuntime=true", "-c.mac.notarize=true"]
  : ["-c.mac.identity=-", "-c.mac.hardenedRuntime=false"])];
const winArgs = ["--win", ...(winCert && onWin ? [] : ["-c.win.signAndEditExecutable=false"])];
const cliArgs = [...(wantMac ? macArgs : []), ...(wantWin ? winArgs : [])];
// electron-builder tự bỏ qua chứng chỉ Windows khi không có WIN_CSC_*; tránh dùng nhầm chứng chỉ macOS (CSC_LINK) để ký .exe
const childEnv = wantWin && !winCert ? { CSC_LINK: wantMac ? env.CSC_LINK : "" } : {};
run("npx", [...builder, ...cliArgs], { env: childEnv });
run("node", ["scripts/verify-signature.mjs"]);
run("node", ["scripts/release-info.mjs"]);
