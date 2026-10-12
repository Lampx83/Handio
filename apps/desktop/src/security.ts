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
const MAX_INSTRUCTIONS = 20_000;
const MAX_UPLOAD_FILE = 50 * 1024 * 1024;
const MAX_UPLOAD_TOTAL = 200 * 1024 * 1024;
const str = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max && !v.includes("\0");

type Validator = (args: unknown[]) => boolean;
const idStr = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
const MODES = ["default", "acceptEdits", "auto", "plan", "bypass"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Câu trả lời cho `ask_user`: tối đa 4 câu, mỗi câu tối đa 4 chỉ số lựa chọn (số nguyên 0–3, không trùng) + một chữ "Khác" (≤ 500 ký tự); không nhận khoá lạ. */
const answersOk = (v: unknown): boolean =>
  Array.isArray(v) && v.length <= 4 && v.every((a) => isObj(a) && Object.keys(a).every((k) => k === "picked" || k === "other")
    && Array.isArray(a.picked) && a.picked.length <= 4 && a.picked.every((k, i, all) => Number.isInteger(k) && k >= 0 && k <= 3 && all.indexOf(k) === i)
    && (a.other === undefined || str(a.other, 500)));

export const IPC_VALIDATORS: Record<string, Validator> = {
  getState: (a) => a.length === 0,
  send: (a) => a.length === 1 && str(a[0], MAX_TEXT),
  interrupt: (a) => a.length === 0,
  respondPermission: (a) => a.length === 2 && str(a[0], 100) && isObj(a[1]) && typeof a[1].allow === "boolean" && (a[1].always === undefined || typeof a[1].always === "boolean") && (a[1].note === undefined || str(a[1].note, 2000)) && (a[1].mode === undefined || MODES.includes(a[1].mode as string)) && (a[1].plan === undefined || str(a[1].plan, 20000)) && (a[1].answers === undefined || answersOk(a[1].answers)),
  setMode: (a) => a.length === 1 && typeof a[0] === "string" && MODES.includes(a[0]),
  newSession: (a) => a.length === 0,
  listDir: (a) => a.length === 1 && str(a[0], 1000),
  readFile: (a) => a.length === 1 && str(a[0], 1000),
  writeTextFile: (a) => a.length === 2 && str(a[0], 1000) && str(a[1], 500_000),
  uploadFiles: (a) => {
    if (a.length !== 1 || !Array.isArray(a[0]) || a[0].length > 50) return false;
    let total = 0;
    for (const f of a[0]) {
      if (!isObj(f) || !str(f.name, 300) || !(f.data instanceof Uint8Array) || f.data.length > MAX_UPLOAD_FILE) return false;
      total += f.data.length;
    }
    return total <= MAX_UPLOAD_TOTAL;
  },
  pasteImages: (a) => a.length === 1 && Array.isArray(a[0]) && a[0].length <= 5 && a[0].every((f) => isObj(f) && str(f.name, 300) && f.data instanceof Uint8Array && f.data.length <= 20 * 1024 * 1024),
  downloadFile: (a) => a.length === 1 && str(a[0], 1000),
  exportZip: (a) => a.length === 0,
  openExternally: (a) => a.length === 1 && str(a[0], 1000),
  revealWorkspace: (a) => a.length === 0,
  saveSettings: (a) => {
    if (a.length !== 1 || !isObj(a[0])) return false;
    const allowed = new Set(["baseUrl", "model", "key", "thinking", "allowInsecureHttp", "diagnostics", "mode", "temperature", "maxOutputTokens", "maxSteps", "contextTokens"]);
    const num = (v: unknown, min: number, max: number, int: boolean) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v));
    const ok: Record<string, (v: unknown) => boolean> = {
      thinking: (v) => typeof v === "boolean", allowInsecureHttp: (v) => typeof v === "boolean", diagnostics: (v) => typeof v === "boolean",
      mode: (v) => typeof v === "string" && MODES.includes(v) && v !== "bypass", /* chế độ mặc định được LƯU không bao giờ là “Toàn quyền” */ temperature: (v) => num(v, 0, 2, false),
      maxOutputTokens: (v) => num(v, 256, 16384, true), maxSteps: (v) => num(v, 1, 200, true), contextTokens: (v) => num(v, 4096, 131072, true),
    };
    return Object.entries(a[0]).every(([k, v]) => allowed.has(k) && (ok[k] ? ok[k](v) : str(v, 2000)));
  },
  testConnection: (a) => a.length === 0,
  listModels: (a) => a.length === 0,
  track: (a) => a.length === 1 && typeof a[0] === "string" && /^[a-z_]{1,32}$/.test(a[0]),
  feedback: (a) => (a.length === 1 || a.length === 2) && (a[0] === "up" || a[0] === "down") && (a.length === 1 || (typeof a[1] === "string" && /^[a-z_]{1,32}$/.test(a[1]))),
  sharePreview: (a) => a.length === 0 || (a.length === 1 && typeof a[0] === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(a[0])),
  shareChat: (a) => a.length === 1 && isObj(a[0]) && Object.keys(a[0]).every((k) => k === "chatId" || k === "title") && (a[0].chatId === undefined || (typeof a[0].chatId === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(a[0].chatId))) && (a[0].title === undefined || str(a[0].title, 200)),
  sharedChats: (a) => a.length === 0,
  unshareChat: (a) => a.length === 1 && typeof a[0] === "string" && /^[A-Za-z0-9_-]{22}$/.test(a[0]),
  sendFeedback: (a) => a.length === 1 && isObj(a[0]) && typeof a[0].kind === "string" && ["bug", "idea", "praise", "other"].includes(a[0].kind) && str(a[0].text, 3000) && typeof a[0].tech === "boolean" && Object.keys(a[0]).length === 3,
  diagnosticsStatus: (a) => a.length === 0,
  diagnosticsPreview: (a) => a.length === 1 && str(a[0], 500),
  diagnosticsSend: (a) => a.length === 0,
  resetPermissions: (a) => a.length === 0,
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
  projectsState: (a) => a.length === 0,
  projectOpen: (a) => a.length === 1 && idStr(a[0]),
  projectCreate: (a) => a.length === 1 && isObj(a[0]) && str(a[0].name, 120) && (a[0].instructions === undefined || str(a[0].instructions, MAX_INSTRUCTIONS)) && Object.keys(a[0]).every((k) => k === "name" || k === "instructions"),
  projectPick: (a) => a.length === 0,
  projectRemove: (a) => a.length === 1 && idStr(a[0]),
  projectRename: (a) => a.length === 2 && idStr(a[0]) && str(a[1], 120),
  instructionsGet: (a) => a.length === 0,
  instructionsSet: (a) => a.length === 1 && str(a[0], MAX_INSTRUCTIONS),
  chatList: (a) => a.length === 0,
  chatOpen: (a) => a.length === 1 && idStr(a[0]),
  chatRemove: (a) => a.length === 1 && idStr(a[0]),
  // "Thay đổi"/quay lại: đường dẫn chỉ dùng để TRA trong nhật ký thay đổi của phiên, không bao giờ làm đường dẫn thật (lõi tự kiểm tra lại bằng resolveSafe)
  changesList: (a) => a.length === 0,
  changeDiff: (a) => a.length === 1 && str(a[0], 1000),
  changesRevert: (a) => a.length === 0 || (a.length === 1 && str(a[0], 1000)),
  rewindPoints: (a) => a.length === 0,
  rewind: (a) => a.length === 2 && Number.isInteger(a[0]) && (a[0] as number) >= 0 && (a[0] as number) < 10_000 && typeof a[1] === "boolean",
  runSuggestions: (a) => a.length === 0,
  // Work: xem tài liệu (chỉ đọc; lõi tự resolveSafe + chặn tệp nhạy cảm) và "Quy trình của tôi" (tên là slug, lõi tự kiểm tra lại)
  docView: (a) => (a.length === 1 || a.length === 2) && str(a[0], 1000) && (a[1] === undefined || str(a[1], 200)),
  procedureList: (a) => a.length === 0,
  procedureSave: (a) => (a.length === 1 || a.length === 2) && str(a[0], 60) && (a[1] === undefined || str(a[1], 200)),
  procedureRemove: (a) => a.length === 1 && str(a[0], 30) && /^[a-z0-9-]{1,30}$/.test(a[0] as string),
  exportDesign: (a) => a.length >= 3 && a.length <= 4 && str(a[0], 1000) && (a[1] === "pdf" || a[1] === "png") && Number.isInteger(a[2]) && (a[2] as number) >= 200 && (a[2] as number) <= 4000 && (a[3] === undefined || (Number.isInteger(a[3]) && (a[3] as number) >= 100 && (a[3] as number) <= 20000)),
};

export const IPC_METHODS = new Set(Object.keys(IPC_VALIDATORS));

/** Kênh đăng nhập riêng (neu:auth): chỉ ba lệnh, không tham số. */
export const AUTH_METHODS = new Set(["status", "login", "loginPassword", "logout", "remember"]);

/** Tham số của kênh đăng nhập: loginPassword nhận {username, password} (chuỗi, có giới hạn); remember nhận {value: boolean}; các lệnh còn lại không có tham số. */
export function authArgsOk(method: string, arg: unknown): boolean {
  if (method === "remember") return isObj(arg) && Object.keys(arg).length === 1 && typeof arg.value === "boolean";
  if (method !== "loginPassword") return arg === undefined;
  if (!isObj(arg) || Object.keys(arg).some((k) => k !== "username" && k !== "password")) return false;
  // eslint-disable-next-line no-control-regex
  return typeof arg.username === "string" && /^[A-Za-z0-9._@+-]{1,64}$/.test(arg.username) && typeof arg.password === "string" && arg.password.length >= 1 && arg.password.length <= 200 && !/[\u0000-\u001f]/.test(arg.password);
}

/** Khi SSO bật mà chưa đăng nhập, MỌI lệnh nghiệp vụ bị từ chối (giao diện chỉ được gọi kênh đăng nhập). */
export const authBlocks = (authEnabled: boolean, signedIn: boolean): boolean => authEnabled && !signedIn;

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

/**
 * Thư mục quá rộng hoặc nhạy cảm để làm dự án: gốc ổ đĩa, thư mục cá nhân, thư mục hệ thống, nơi chứa khoá/cấu hình (~/.ssh, ~/Library…).
 * Chọn những nơi này sẽ cho agent thấy/sửa gần như cả máy, nên từ chối ngay lúc chọn (không dựa hoàn toàn vào việc chặn đọc tệp nhạy cảm bên trong).
 */
export function isTooBroadFolder(dir: string, home: string, platform: string = process.platform): boolean {
  const win = platform === "win32";
  const norm = (p: string): string => {
    // so khớp không phân biệt hoa/thường (macOS và Windows mặc định không phân biệt; chặn thừa còn hơn thiếu)
    const n = (win ? path.win32.normalize(p).replace(/\\+$/, "") : path.posix.normalize(p).replace(/\/+$/, "")).toLowerCase();
    return n || "/";
  };
  const d = norm(dir);
  const h = norm(home);
  const under = (base: string): boolean => d === base || d.startsWith(base + (win ? "\\" : "/"));
  if (d === h || d === "/" || /^[a-z]:$/.test(d)) return true;
  if (win) {
    if (["c:\\users"].includes(d)) return true;
    return ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"].some(under) || ["\\appdata", "\\.ssh", "\\.aws", "\\.gnupg"].some((x) => under(h + x));
  }
  if (["/users", "/home", "/volumes", "/mnt", "/media"].includes(d)) return true;
  if (["/private/tmp", "/private/var/folders", "/var/folders", "/tmp"].some(under)) return false;
  if (["/system", "/library", "/applications", "/usr", "/bin", "/sbin", "/etc", "/var", "/private", "/dev", "/proc", "/sys", "/root", "/boot"].some(under)) return true;
  return ["/library", "/.ssh", "/.aws", "/.gnupg", "/.config", "/.kube", "/.docker"].some((x) => under(h + x));
}
