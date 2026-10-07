// Các hàm bảo mật THUẦN (không phụ thuộc Electron) để kiểm thử được: giao thức app://, kiểm tra IPC, URL ngoài, tệp nguy hiểm.
import fs from "node:fs";
import path from "node:path";

export const APP_ORIGIN = "app://main";

/** CSP của giao diện: không mạng, không script ngoài, không nhúng. */
export const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "frame-src 'none'", "worker-src 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
export const mimeOf = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Chuyển app://main/<đường dẫn> thành tệp thật trong `root`; từ chối mọi cách thoát ra ngoài (../, mã hoá %2e, \, NUL, symlink). */
export function resolveAppAsset(root: string, requestUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(requestUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "app:" || u.host !== "main" || u.username || u.password) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  const base = fs.realpathSync(root);
  const candidate = path.join(base, rel);
  try {
    const real = fs.realpathSync(candidate);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

export const isTrustedSenderUrl = (url: string | undefined): boolean => !!url && (url === APP_ORIGIN || url.startsWith(APP_ORIGIN + "/"));

/** Chỉ mở liên kết https ra ngoài (và chỉ khi người dùng bấm); không mở file://, javascript:, app-protocol khác... */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Xem trước ứng dụng web chạy trên máy (http/https tới localhost) — chỉ khi người dùng bấm “Mở”. */
export function isLocalPreviewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Tệp thực thi/kịch bản: không bao giờ "mở bằng ứng dụng" từ nút trong giao diện. */
export const RISKY_EXT = /\.(app|command|sh|bash|zsh|fish|exe|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|hta|reg|msi|msp|scr|cpl|inf|lnk|url|webloc|jar|py|pyw|rb|pl|dmg|pkg|iso|workflow|terminal|action|apk|appimage|desktop|chm|dll|so|dylib)$/i;

// ---------------------------------------------------------------- kiểm tra tham số IPC

const MAX_TEXT = 400_000;
const MAX_UPLOAD_FILE = 50 * 1024 * 1024;
const MAX_UPLOAD_TOTAL = 200 * 1024 * 1024;
const str = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max && !v.includes("\0");

type Validator = (args: unknown[]) => boolean;
const MODES = ["default", "acceptEdits", "plan", "bypass"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const IPC_VALIDATORS: Record<string, Validator> = {
  getState: (a) => a.length === 0,
  send: (a) => a.length === 1 && str(a[0], MAX_TEXT),
  interrupt: (a) => a.length === 0,
  respondPermission: (a) => a.length === 2 && str(a[0], 100) && isObj(a[1]) && typeof a[1].allow === "boolean" && (a[1].always === undefined || typeof a[1].always === "boolean") && (a[1].note === undefined || str(a[1].note, 2000)) && (a[1].mode === undefined || MODES.includes(a[1].mode as string)),
  setMode: (a) => a.length === 1 && typeof a[0] === "string" && MODES.includes(a[0]),
  newSession: (a) => a.length === 0,
  listDir: (a) => a.length === 1 && str(a[0], 1000),
  readFile: (a) => a.length === 1 && str(a[0], 1000),
  uploadFiles: (a) => {
    if (a.length !== 1 || !Array.isArray(a[0]) || a[0].length > 50) return false;
    let total = 0;
    for (const f of a[0]) {
      if (!isObj(f) || !str(f.name, 300) || !(f.data instanceof Uint8Array) || f.data.length > MAX_UPLOAD_FILE) return false;
      total += f.data.length;
    }
    return total <= MAX_UPLOAD_TOTAL;
  },
  downloadFile: (a) => a.length === 1 && str(a[0], 1000),
  exportZip: (a) => a.length === 0,
  openExternally: (a) => a.length === 1 && str(a[0], 1000),
  revealWorkspace: (a) => a.length === 0,
  saveSettings: (a) => {
    if (a.length !== 1 || !isObj(a[0])) return false;
    const allowed = new Set(["baseUrl", "model", "key", "thinking", "allowInsecureHttp"]);
    return Object.entries(a[0]).every(([k, v]) => allowed.has(k) && (k === "thinking" || k === "allowInsecureHttp" ? typeof v === "boolean" : str(v, 2000)));
  },
  testConnection: (a) => a.length === 0,
  trustProject: (a) => a.length === 1 && typeof a[0] === "boolean",
  openFolder: (a) => a.length === 0,
  searchFiles: (a) => a.length === 1 && str(a[0], 200),
  stopProcess: (a) => a.length === 1 && str(a[0], 40),
  openUrl: (a) => a.length === 1 && str(a[0], 2000),
  learnLessons: (a) => a.length === 0,
  learnExercises: (a) => a.length === 0,
  learnExercise: (a) => a.length === 1 && str(a[0], 100),
  learnStart: (a) => a.length === 1 && str(a[0], 100),
  learnHint: (a) => a.length === 2 && str(a[0], 100) && Number.isInteger(a[1]) && (a[1] as number) >= 0 && (a[1] as number) < 20,
  learnGrade: (a) => a.length === 1 && str(a[0], 100),
  learnTemplates: (a) => a.length === 0,
  learnCreate: (a) => a.length === 1 && str(a[0], 100),
};

export const IPC_METHODS = new Set(Object.keys(IPC_VALIDATORS));

/** Giới hạn tần suất lệnh IPC (chống giao diện bị chiếm làm “bão” lệnh). */
export class RateLimiter {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number) {}
  allow(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}
