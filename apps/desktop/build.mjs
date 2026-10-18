import { changelogData } from "../../scripts/version.mjs";
import { build } from "esbuild";
import fs from "node:fs";

// Biến thể build:  (mặc định) dev = có giả lập/kiểm thử | RELEASE=1 = bản phát hành (không mã kiểm thử, không giả lập)
//                  SMOKE_PACK=1 = bản phát hành + mã kiểm thử đầu-cuối, chỉ để xác nhận gói cài chạy đúng (KHÔNG phát hành)
const release = process.env.RELEASE === "1";
const smoke = process.env.SMOKE_PACK === "1" || !release;
const dev = !release && process.env.SMOKE_PACK !== "1";
const baseUrl = process.env.NEU_DEFAULT_BASE_URL || "https://ai.neu.edu.vn/agent/vllm/v1";
const builtinKey = process.env.NEU_BUILTIN_KEY || ""; // mặc định KHÔNG nhúng key vào gói phát hành
if (!/^https:\/\//.test(baseUrl)) throw new Error("NEU_DEFAULT_BASE_URL phải là https://");
// Đăng nhập SSO Microsoft 365: tenant + client id là định danh CÔNG KHAI (không phải bí mật; bí mật chỉ nằm trên máy chủ). Bản phát hành BẮT BUỘC có.
// Giá trị thật do biến repo/biến môi trường cung cấp, KHÔNG nằm trong mã nguồn (docs/PUBLIC.md).
const tenant = process.env.NEU_AUTH_TENANT || "";
const authClient = process.env.NEU_AUTH_CLIENT_ID || "";
// Địa chỉ gateway trong mạng nội bộ (HTTP), tuỳ chọn: hiện thành lựa chọn "Mạng nội bộ" ở cài đặt. Trống = không có lựa chọn đó.
const lanGateway = (process.env.NEU_LAN_GATEWAY || "").replace(/\/+$/, "");
if (lanGateway && !/^http:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9/._-]*$/.test(lanGateway)) throw new Error("NEU_LAN_GATEWAY phải dạng http://địa-chỉ:cổng/đường-dẫn");
const domains = (process.env.NEU_AUTH_DOMAINS || "neu.edu.vn,st.neu.edu.vn").split(",").map((d) => d.trim()).filter(Boolean);
// Bản dev/thử nghiệm: tắt đăng nhập trừ khi đặt NEU_AUTH_FORCE=1. Bản phát hành: luôn bật (trừ khi cố ý NEU_ALLOW_NO_AUTH=1).
const authOn = release ? process.env.NEU_ALLOW_NO_AUTH !== "1" : process.env.NEU_AUTH_FORCE === "1";
if (authOn && (!/^[0-9a-f-]{36}$/i.test(tenant) || !/^[0-9a-f-]{36}$/i.test(authClient)))
  throw new Error("Đăng nhập SSO đang bật nhưng thiếu NEU_AUTH_TENANT / NEU_AUTH_CLIENT_ID (GUID). Đặt biến repo cùng tên (docs/PUBLIC.md).");
const authCfg = { issuer: `https://login.microsoftonline.com/${tenant}/v2.0`, clientId: authClient, domains, passwordLogin: { signInUrl: baseUrl.replace(/\/vllm\/v1\/?$/, "/oauth2/sign_in") } };
const auth = authOn ? authCfg : null;

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/renderer", { recursive: true });
const common = { bundle: true, sourcemap: !release, logLevel: "info", target: "es2022", legalComments: "none" };
await build({
  ...common, entryPoints: { main: "src/main.ts", preload: "src/preload.ts" }, outdir: "dist", platform: "node", format: "cjs", external: ["electron"],
  minify: release,
  define: { "process.env.NODE_ENV": '"production"', __SMOKE__: String(smoke), __DEV__: String(dev), __DEFAULT_BASE_URL__: JSON.stringify(baseUrl), __LAN_GATEWAY__: JSON.stringify(lanGateway), __BUILTIN_KEY__: JSON.stringify(builtinKey), __AUTH__: JSON.stringify(auth) },
});
const pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const changelog = changelogData(fs.readFileSync("../../CHANGELOG.md", "utf8")); // nhật ký thay đổi nhúng sẵn: xem được cả khi ngoại tuyến
await build({ ...common, entryPoints: { renderer: "renderer/main.ts" }, outdir: "dist/renderer", platform: "browser", format: "iife", loader: { ".css": "css" }, minify: release, define: { __CHANGELOG__: JSON.stringify(changelog), __APP_VERSION__: JSON.stringify(pkgVersion) } });
fs.copyFileSync("renderer/index.html", "dist/renderer/index.html");
fs.copyFileSync("build/icon.png", "dist/tray.png"); // biểu tượng khay (chạy nền khi đóng cửa sổ): icon chữ N của bản NEU, main.ts thu nhỏ lúc chạy
console.log(`build: ${release ? "RELEASE" : process.env.SMOKE_PACK === "1" ? "SMOKE_PACK" : "DEV"}; endpoint mặc định ${baseUrl}; key nhúng: ${builtinKey ? "CÓ" : "không"}; đăng nhập SSO: ${auth ? "BẬT" : "tắt"}`);
