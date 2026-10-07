// Chạy kiểm thử đầu-cuối của bản Desktop: node smoke.mjs  (cần đã build)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neu-smoke-"));
console.log("Thư mục thử:", dir);
const r = spawnSync(electron, ["."], { stdio: "inherit", env: { ...process.env, NEU_SMOKE_DIR: dir, ELECTRON_ENABLE_LOGGING: "0" } });
console.log("Ảnh chụp màn hình & báo cáo:", dir);
process.exit(r.status ?? 1);
