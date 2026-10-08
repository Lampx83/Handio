// Ký lại .app bằng chứng chỉ CỐ ĐỊNH của máy dựng khi không có Developer ID (chỉ macOS).
// Vì sao: chữ ký "ad-hoc" đổi theo từng bản build nên Keychain của macOS coi mỗi bản là một ứng dụng lạ và hỏi lại quyền
// (“NEU Agent wants to use your confidential information…”). Ký bằng một chứng chỉ không đổi thì danh tính ổn định:
// bấm “Always Allow” một lần là đủ, kể cả khi cập nhật. Đây KHÔNG thay thế Developer ID + notarize (Gatekeeper vẫn cảnh báo lần đầu mở).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(ctx) {
  const name = process.env.NEU_LOCAL_SIGN_NAME;
  if (!name || ctx.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // đã có chứng chỉ thật: electron-builder lo
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--timestamp=none", "--sign", name, app], { stdio: "inherit" });
  console.log(`  • ký lại bằng chứng chỉ cố định "${name}"  app=${path.basename(app)}`);
};
