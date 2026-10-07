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

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/renderer", { recursive: true });
const common = { bundle: true, sourcemap: !release, logLevel: "info", target: "es2022", legalComments: "none" };
await build({
  ...common, entryPoints: { main: "src/main.ts", preload: "src/preload.ts" }, outdir: "dist", platform: "node", format: "cjs", external: ["electron"],
  minify: release,
  define: { "process.env.NODE_ENV": '"production"', __SMOKE__: String(smoke), __DEV__: String(dev), __DEFAULT_BASE_URL__: JSON.stringify(baseUrl), __BUILTIN_KEY__: JSON.stringify(builtinKey) },
});
await build({ ...common, entryPoints: { renderer: "renderer/main.ts" }, outdir: "dist/renderer", platform: "browser", format: "iife", loader: { ".css": "css" }, minify: release });
fs.copyFileSync("renderer/index.html", "dist/renderer/index.html");
console.log(`build: ${release ? "RELEASE" : process.env.SMOKE_PACK === "1" ? "SMOKE_PACK" : "DEV"}; endpoint mặc định ${baseUrl}; key nhúng: ${builtinKey ? "CÓ" : "không"}`);
