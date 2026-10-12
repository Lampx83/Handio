import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron";
import { accessSync, constants as fsConstants, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { brandName, buildWorkSamples, cleanProjectName, createMultiProject, ID_RE, LocalController, newId, parsePolicy, uniqueProjectName, PROFILE_ORDER, SAMPLE_DESIGN, SAMPLE_PROJECT, type Policy, type Profile, type RawPack, type ProjectHost, type ProjectInfo, type ProjectsState, type SessionEvent } from "@neu/agent-core";
import { JsonChatStore, JsonSettingsStore, JsonTrustStore, NodeEnv, readPackDirs, type KeyCodec } from "@neu/agent-env-node";
import { Auth, type AuthConfig } from "./auth";
import { dropPristineSamples } from "./samples";
import { canInstallHere, launchInstaller } from "./installer";
import { checkPage } from "./page-check";
import { Updater, UPDATE_METHODS } from "./updater";
import { APP_ORIGIN, AUTH_METHODS, authArgsOk, authBlocks, IPC_METHODS, IPC_VALIDATORS, isLocalPreviewUrl, isSafeExternalUrl, isTooBroadFolder, isTrustedSenderUrl, mimeOf, RateLimiter, resolveAppAsset, RISKY_EXT, SECURITY_HEADERS } from "./security";

// Hằng số lúc build (xem build.mjs): bản phát hành KHÔNG chứa mã kiểm thử/giả lập và KHÔNG chứa key.
declare const __SMOKE__: boolean;
declare const __DEV__: boolean;
declare const __DEFAULT_BASE_URL__: string;
declare const __BUILTIN_KEY__: string;
declare const __LAN_GATEWAY__: string; // http://địa-chỉ:cổng/vllm/v1 trong mạng nội bộ, hoặc "" (không có)
declare const __AUTH__: AuthConfig | null;

const PROFILES_LIST: Profile[] = PROFILE_ORDER;
const DEFAULT_DIR: Record<Profile, string> = { work: "NEU Work", code: "NEU Code", design: "NEU Design" };
// Dự án đầu tiên luôn TRỐNG (không nạp dữ liệu mẫu). Tên cũ "Dự án mẫu"/"Mẫu thiết kế" chỉ còn để nhận ra và dọn ở bản đã cài trước đây.
const DEFAULT_NAME: Record<Profile, string> = { work: "Dự án của tôi", code: "Dự án của tôi", design: "Thiết kế của tôi" };
const LEGACY_NAME: Record<Profile, string> = { work: "Dự án mẫu", code: "Dự án mẫu", design: "Mẫu thiết kế" };
const LAN_GATEWAY = __LAN_GATEWAY__;
const SMOKE = __SMOKE__ ? process.env.NEU_SMOKE_DIR || "" : "";
// Đăng nhập SSO bắt buộc ở bản phát hành. Riêng chế độ kiểm thử đầu-cuối (SMOKE, không có trong bản phát hành) bỏ qua.
const AUTH_CFG: AuthConfig | null = SMOKE ? null : __AUTH__;
let auth: Auth | null = null;
let remember = false; // có lưu phiên đăng nhập trên máy không (mặc định không; xem codec())
let setRemember: (v: boolean) => Promise<void> = async () => undefined;
const BUILTIN = __BUILTIN_KEY__ ? { key: __BUILTIN_KEY__, hosts: [new URL(__DEFAULT_BASE_URL__).host, ...(LAN_GATEWAY ? [new URL(LAN_GATEWAY).host] : [])] } : undefined;
const RENDERER_ROOT = path.join(__dirname, "renderer");

let win: BrowserWindow | null = null;
let updater: Updater | null = null;
let policy: Policy = {};
const controllers = new Map<Profile, LocalController>();
/** Thư mục lần xuất PDF/PNG gần nhất (gợi ý cho hộp "Lưu thành…"). */
let lastExportDir = "";
let mockServer: Server | null = null;
let mockUrl = "";

// ---------------------------------------------------------------- khởi tạo an toàn (trước khi app sẵn sàng)
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }]);
app.enableSandbox();
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
if (SMOKE) app.setPath("userData", path.join(SMOKE, "userData"));

// Đổi tên hiển thị (NEU Agent / Hando / Handio) KHÔNG được đổi nơi lưu cài đặt/lịch sử/phiên đăng nhập: ghim đúng thư mục của bản cũ (@neu/agent-desktop).
if (!SMOKE) app.setPath("userData", path.join(app.getPath("appData"), "@neu", "agent-desktop"));
/** Tên thư mục dự án đã dùng qua các bản (ưu tiên giữ thư mục đang có): tên hiển thị hiện tại, NEU Agent, Hando, Handio. */
const BRAND_DIRS = [...new Set([brandName(), "NEU Agent", "Hando", "Handio"])];
const userData = () => app.getPath("userData");
const cfgFile = () => path.join(userData(), "folders.json");

// ---------------------------------------------------------------- chính sách quản trị
async function loadPolicy(): Promise<Policy> {
  const files = [
    process.platform === "darwin" ? "/Library/Application Support/Handio/policy.json" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "Handio", "policy.json") : "",
    // tên cũ ("Hando" của bản 0.8.0, "NEU Agent" trước đó): quản trị đã đặt chính sách ở đây vẫn có hiệu lực
    process.platform === "darwin" ? "/Library/Application Support/Hando/policy.json" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "Hando", "policy.json") : "",
    process.platform === "darwin" ? "/Library/Application Support/NEU Agent/policy.json" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "NEU Agent", "policy.json") : "",
    __DEV__ && process.env.NEU_POLICY_FILE ? process.env.NEU_POLICY_FILE : "",
  ].filter(Boolean);
  for (const f of files) {
    try {
      return parsePolicy(JSON.parse(await fs.readFile(f, "utf8")));
    } catch {
      /* không có hoặc hỏng: bỏ qua */
    }
  }
  return {};
}

// ---------------------------------------------------------------- gói mở rộng (docs/EXTENSIONS.md)
// Gói của tổ chức: thư mục `packs` cạnh policy.json (quản trị đặt), `resources/packs` đi kèm bản cài, hoặc NEU_PACKS_DIR khi phát triển.
// Gói của người dùng: <userData>/packs. Cả hai được tin cậy (gói trong dự án thì lõi tự đọc và không tin cậy).
async function loadPacks(): Promise<RawPack[]> {
  const orgDirs = [
    process.platform === "darwin" ? "/Library/Application Support/Handio/packs" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "Handio", "packs") : "",
    process.platform === "darwin" ? "/Library/Application Support/Hando/packs" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "Hando", "packs") : "",
    process.platform === "darwin" ? "/Library/Application Support/NEU Agent/packs" : "",
    process.platform === "win32" && process.env.ProgramData ? path.join(process.env.ProgramData, "NEU Agent", "packs") : "",
    app.isPackaged ? path.join(process.resourcesPath, "packs") : "",
    __DEV__ && process.env.NEU_PACKS_DIR ? process.env.NEU_PACKS_DIR : "",
  ].filter(Boolean);
  const out: RawPack[] = [];
  for (const d of orgDirs) out.push(...(await readPackDirs(d, "org")));
  out.push(...(await readPackDirs(path.join(userData(), "packs"), "user")));
  return out;
}

// ---------------------------------------------------------------- thư mục làm việc & cài đặt
async function readFolders(): Promise<Partial<Record<Profile, string>>> {
  try {
    return JSON.parse(await fs.readFile(cfgFile(), "utf8"));
  } catch {
    return {};
  }
}
async function saveFolder(p: Profile, dir: string): Promise<void> {
  const f = await readFolders();
  f[p] = dir;
  await fs.mkdir(userData(), { recursive: true });
  await fs.writeFile(cfgFile(), JSON.stringify(f, null, 2), { mode: 0o600 });
}

/** Bộ mã hoá bằng Keychain/kho khoá của hệ điều hành. LƯỜI: chỉ chạm vào Keychain khi thật sự mã hoá/giải mã (macOS hỏi quyền mỗi lần chạm). */
function codec(): KeyCodec {
  const ok = () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Không có kho khoá của hệ điều hành.");
  };
  return {
    encrypt: (s) => (ok(), safeStorage.encryptString(s).toString("base64")),
    decrypt: (s) => (ok(), safeStorage.decryptString(Buffer.from(s, "base64"))),
  };
}

async function seed(profile: Profile, dir: string): Promise<void> {
  const files = profile === "code" ? SAMPLE_PROJECT : profile === "design" ? SAMPLE_DESIGN : await buildWorkSamples();
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

async function folderFor(profile: Profile): Promise<string> {
  const saved = (await readFolders())[profile];
  if (saved) {
    try {
      if ((await fs.stat(saved)).isDirectory()) return saved;
    } catch {
      /* thư mục đã bị xoá: dùng mặc định */
    }
  }
  // người dùng đã có thư mục từ bản cũ ("NEU Work"…) thì giữ nguyên; cài mới dùng Tài liệu/<tên hiển thị>/<Work|Code|Design>
  const legacy = path.join(app.getPath("documents"), DEFAULT_DIR[profile]);
  const sub = profile === "work" ? "Work" : profile === "code" ? "Code" : "Design";
  const named = BRAND_DIRS.map((n) => path.join(app.getPath("documents"), n, sub)).find((p) => existsSync(p));
  const dir = SMOKE ? path.join(SMOKE, profile) : existsSync(legacy) ? legacy : named ?? path.join(app.getPath("documents"), brandName(), sub);
  let fresh = false;
  try {
    await fs.access(dir);
    fresh = (await fs.readdir(dir)).length === 0;
  } catch {
    await fs.mkdir(dir, { recursive: true });
    fresh = true;
  }
  if (fresh && SMOKE) await seed(profile, dir); // chỉ bài kiểm thử đầu-cuối cần dữ liệu mẫu có sẵn; người dùng thật bắt đầu với thư mục trống
  await saveFolder(profile, dir);
  return dir;
}

const send = (profile: Profile, e: SessionEvent) => win?.webContents.send("neu:event", profile, e);

// ---------------------------------------------------------------- dự án (mỗi tab có danh sách thư mục riêng)
interface Registry {
  active: string;
  projects: ProjectInfo[];
}
const chatStore = () => new JsonChatStore(path.join(userData(), "chats"));
// Thu nhỏ ảnh cho công cụ read_image (đọc ảnh/OCR bằng mô hình): nativeImage của Electron, chỉ xử lý trong bộ nhớ
const shrinkImage: NonNullable<NodeEnv["shrinkImage"]> = async (bytes, _mime, o) => {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const scale = Math.min(1, o.maxSide / Math.max(width, height));
    const out = scale < 1 ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" }) : img;
    return { bytes: new Uint8Array(out.toJPEG(Math.round(o.quality * 100))), mime: "image/jpeg" };
  } catch {
    return null;
  }
};
const makeEnv = (profile: Profile, dir: string) => {
  const env = new NodeEnv(dir, { allowExec: profile === "code", sandbox: process.platform === "darwin" ? { network: policy.bashNetwork !== false } : false });
  env.shrinkImage = shrinkImage;
  if (profile === "work") env.htmlToPdf = (html, o) => renderDesign(html, { format: "pdf", width: 794, footer: o.footer ?? "" });
  // tab Code: agent tự thấy lỗi console/trang trắng của ứng dụng web đang làm (trình duyệt ẩn, cách ly, chỉ localhost/tệp dự án)
  if (profile === "code") env.checkPage = (url, o) => checkPage(url, { waitMs: o.waitMs, root: dir, signal: o.signal });
  return env;
};

/** Thư mục chứa các dự án do ứng dụng tạo: Tài liệu/<tên hiển thị>/<Work|Code|Design>/<tên> (đã có sẵn thư mục tên cũ thì giữ để các dự án nằm cùng nơi). */
function projectsParent(profile: Profile): string {
  if (SMOKE) return path.join(SMOKE, "projects", profile);
  const docs = app.getPath("documents");
  const brand = BRAND_DIRS.find((n) => existsSync(path.join(docs, n))) ?? brandName();
  return path.join(docs, brand, profile === "work" ? "Work" : profile === "code" ? "Code" : "Design");
}

function desktopHost(profile: Profile): ProjectHost & { activePath(): Promise<string | undefined> } {
  const file = path.join(userData(), `projects-${profile}.json`);
  const write = async (r: Registry): Promise<void> => {
    await fs.mkdir(userData(), { recursive: true });
    await fs.writeFile(file, JSON.stringify(r, null, 2), { mode: 0o600 });
  };
  const read = async (): Promise<Registry> => {
    try {
      const r = JSON.parse(await fs.readFile(file, "utf8")) as Registry;
      const projects = (Array.isArray(r.projects) ? r.projects : []).filter((p) => p && ID_RE.test(String(p.id)) && typeof p.name === "string" && typeof p.path === "string" && path.isAbsolute(p.path));
      if (projects.length) {
        // dự án đầu tiên còn mang tên "mẫu" của bản cũ: đổi tên và dọn tệp mẫu chưa ai đụng tới (một lần)
        const d = projects.find((p) => p.id === "default" && p.name === LEGACY_NAME[profile]);
        if (d) {
          d.name = DEFAULT_NAME[profile];
          if (!SMOKE && d.path) await dropPristineSamples(profile === "code" ? SAMPLE_PROJECT : profile === "design" ? SAMPLE_DESIGN : await buildWorkSamples(), d.path).catch(() => undefined);
          const out: Registry = { active: projects.some((p) => p.id === r.active) ? r.active : projects[0].id, projects };
          await write(out);
          return out;
        }
        return { active: projects.some((p) => p.id === r.active) ? r.active : projects[0].id, projects };
      }
    } catch {
      /* chưa có: tạo dự án mặc định */
    }
    const now = Date.now();
    const r: Registry = { active: "default", projects: [{ id: "default", name: DEFAULT_NAME[profile], path: await folderFor(profile), created: now, lastUsed: now }] };
    await write(r);
    return r;
  };
  /**
   * Thư mục cho dự án mới tên `name`. Bỏ một dự án khỏi danh sách KHÔNG xoá thư mục trên đĩa, nên tạo lại cùng tên sẽ gặp thư mục cũ:
   * nếu nó TRỐNG và không thuộc dự án nào thì dùng lại (không đẻ ra "Bài 2 (2)" trên đĩa); còn lại thì thêm hậu tố.
   */
  const uniqueDir = async (parent: string, name: string, used: string[]): Promise<string> => {
    await fs.mkdir(parent, { recursive: true });
    for (let n = 1; ; n++) {
      const dir = path.join(parent, n === 1 ? name : `${name} (${n})`);
      try {
        await fs.mkdir(dir);
        return dir;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const empty = (await fs.readdir(dir).catch(() => ["?"])).length === 0;
        if (empty && !used.includes(dir)) return dir;
      }
    }
  };
  return {
    async list(): Promise<ProjectsState> {
      const r = await read();
      return { active: r.active, projects: [...r.projects].sort((a, b) => b.lastUsed - a.lastUsed), canPick: true };
    },
    async open(id) {
      const r = await read();
      const p = r.projects.find((x) => x.id === id);
      if (!p?.path) throw new Error("Không có dự án này.");
      try {
        if (!(await fs.stat(p.path)).isDirectory()) throw new Error();
      } catch {
        throw new Error(`Thư mục của dự án này không còn: ${p.path}. Hãy bỏ dự án khỏi danh sách hoặc chép thư mục về đúng chỗ cũ.`);
      }
      p.lastUsed = Date.now();
      r.active = id;
      await write(r);
      return makeEnv(profile, p.path);
    },
    async create({ name }) {
      const r = await read();
      const clean = cleanProjectName(name);
      if (!clean) throw new Error("Hãy đặt tên cho dự án.");
      const dir = await uniqueDir(projectsParent(profile), clean, r.projects.map((p) => p.path ?? ""));
      const now = Date.now();
      // tên hiển thị là đúng tên người dùng gõ (chỉ thêm "(2)" khi trùng với dự án ĐANG CÓ trong danh sách), không lấy theo tên thư mục
      const info: ProjectInfo = { id: newId(), name: uniqueProjectName(r.projects.map((p) => p.name), clean), path: dir, created: now, lastUsed: now };
      r.projects.push(info);
      r.active = info.id;
      await write(r);
      return { info, env: makeEnv(profile, dir) };
    },
    async pick() {
      if (!win) return null;
      const res = await dialog.showOpenDialog(win, { title: profile === "code" ? "Chọn thư mục dự án" : "Chọn thư mục làm việc", properties: ["openDirectory", "createDirectory"] });
      if (res.canceled || !res.filePaths[0]) return null;
      const dir = await fs.realpath(res.filePaths[0]);
      if (isTooBroadFolder(dir, app.getPath("home"))) throw new Error("Thư mục này quá rộng hoặc nhạy cảm (gốc ổ đĩa, thư mục cá nhân, thư mục hệ thống, ~/.ssh…). Hãy chọn một thư mục dự án cụ thể.");
      const r = await read();
      let info = r.projects.find((p) => p.path === dir);
      if (!info) {
        const now = Date.now();
        info = { id: newId(), name: uniqueProjectName(r.projects.map((p) => p.name), cleanProjectName(path.basename(dir)) || "Dự án"), path: dir, created: now, lastUsed: now };
        r.projects.push(info);
      }
      info.lastUsed = Date.now();
      r.active = info.id;
      await write(r);
      return { info, env: makeEnv(profile, dir) };
    },
    async remove(id) {
      const r = await read();
      if (r.projects.length <= 1) return;
      r.projects = r.projects.filter((p) => p.id !== id); // chỉ bỏ khỏi danh sách; KHÔNG xoá thư mục trên đĩa
      if (r.active === id) r.active = r.projects[0].id;
      await write(r);
    },
    async rename(id, name) {
      const r = await read();
      const p = r.projects.find((x) => x.id === id);
      if (!p) return;
      p.name = cleanProjectName(name) || p.name;
      await write(r);
    },
    async activePath() {
      const r = await read();
      return r.projects.find((p) => p.id === r.active)?.path;
    },
  };
}

// ---------------------------------------------------------------- xuất thiết kế ra PDF/PNG
/** Dựng HTML do agent viết trong cửa sổ ẩn: không script, không mạng, phiên riêng; chỉ trả về byte PDF/PNG. */
async function renderDesign(html: string, o: { format: "pdf" | "png"; width: number; height?: number; footer?: string }): Promise<Uint8Array> {
  if (html.length > 2_000_000) throw new Error("Tệp thiết kế quá lớn để xuất.");
  const part = "design-render";
  const ses = session.fromPartition(part); // phiên trong bộ nhớ, tách khỏi phiên giao diện
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith("data:") }));
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  // offscreen: vẽ ngay cả khi cửa sổ ẩn (chụp PNG cần trang đã được vẽ); zoom 1 để ảnh đúng số điểm ảnh
  const w = new BrowserWindow({ show: false, width: o.width, height: o.height ?? 800, useContentSize: true, webPreferences: { partition: part, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, devTools: false, spellcheck: false } });
  w.webContents.setFrameRate(10);
  const timer = setTimeout(() => w.destroy(), 30_000);
  try {
    await w.loadURL("data:text/html;charset=utf-8;base64," + Buffer.from(html, "utf8").toString("base64"));
    // đo chiều cao nội dung (JavaScript của TRANG đã tắt; lệnh đo do ứng dụng chạy, chỉ đọc kích thước)
    const full = o.height ?? Math.min(20000, Math.max(100, Number(await w.webContents.executeJavaScript("Math.ceil(document.documentElement.scrollHeight)")) || 800));
    if (o.format === "png") {
      w.setContentSize(o.width, full);
      const painted = new Promise<void>((r) => w.webContents.once("paint", () => r()));
      w.webContents.invalidate();
      await Promise.race([painted, new Promise((r) => setTimeout(r, 2500))]);
      await new Promise((r) => setTimeout(r, 200));
      let img = await w.webContents.capturePage({ x: 0, y: 0, width: o.width, height: full });
      const sz = img.getSize();
      if (sz.width !== o.width || sz.height !== full) img = img.resize({ width: o.width, height: full, quality: "best" });
      return img.toPNG();
    }
    const css = /@page\s*\{[^}]*size\s*:/i.test(html);
    // create_pdf: chân trang "tên · trang X / Y" do Chromium vẽ trong lề dưới (lề lấy từ @page của tài liệu)
    const footer = o.footer !== undefined
      ? { displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="width:100%;font:8px 'Segoe UI',Arial,sans-serif;color:#6b7280;padding:0 18mm;display:flex;justify-content:space-between"><span>${o.footer.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` }
      : {};
    return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: css, ...footer, ...(css ? {} : { pageSize: { width: o.width / 96, height: full / 96 } }), margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    clearTimeout(timer);
    if (!w.isDestroyed()) w.destroy();
  }
}

async function buildController(profile: Profile): Promise<LocalController> {
  const host = desktopHost(profile);
  const st = await host.list();
  const env = await host.open(st.active).catch(async () => host.open((await host.list()).projects[0].id));
  // eslint-disable-next-line prefer-const
  let ctl!: LocalController;
  // nhiều dự án chạy cùng lúc: mỗi dự án một phiên riêng, chuyển dự án không dừng việc đang làm (packages/core/src/multi.ts)
  ctl = await createMultiProject({
    env,
    profile,
    policy,
    defaults: { baseUrl: __DEFAULT_BASE_URL__, mode: SMOKE ? "default" : "auto" },
    builtinKey: BUILTIN,
    authHeaders: auth ? () => auth!.getHeaders() : undefined,
    // tự chẩn đoán KHÔNG chứa nội dung (docs/DIAGNOSTICS.md): chỉ gửi khi đã đăng nhập, tới đúng máy chủ của ứng dụng
    diagnostics: { endpoint: __DEFAULT_BASE_URL__.replace(/\/vllm\/v1\/?$/, "/diag"), headers: (): Record<string, string> => auth?.peekHeaders() ?? {}, enabled: () => !!auth && !SMOKE, version: app.getVersion(), platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux" },
    authHosts: [new URL(__DEFAULT_BASE_URL__).host],
    realFs: true,
    packs: loadPacks,
    toolsBase: __DEFAULT_BASE_URL__.replace(/\/vllm\/v1\/?$/, "/"),
    projects: host,
    chats: chatStore(),
    renderDesign: profile === "design" ? renderDesign : undefined,
    // xuất PDF/PNG: hỏi lưu vào thư mục nào (đóng hộp thoại = lưu vào thư mục mặc định cạnh tệp thiết kế). Nhớ thư mục vừa chọn cho lần sau.
    pickSavePath: profile === "design" && !SMOKE ? async ({ defaultPath, format }) => {
      const start = lastExportDir ? path.join(lastExportDir, path.basename(defaultPath)) : defaultPath;
      const opts = { title: "Lưu bản xuất", defaultPath: start, buttonLabel: "Lưu", filters: [{ name: format.toUpperCase(), extensions: [format] }], properties: ["createDirectory" as const, "showOverwriteConfirmation" as const] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      lastExportDir = path.dirname(r.filePath);
      return r.filePath;
    } : undefined,
    store: new JsonSettingsStore(path.join(userData(), "settings.json"), codec(), { persistKeyWithoutCodec: false }),
    trust: new JsonTrustStore(path.join(userData(), "trusted-folders.json")),
    presets: [
      { label: "Máy chủ chính (HTTPS)", baseUrl: __DEFAULT_BASE_URL__, model: "qwen3.5-35b-a3b-int4", needsKey: !BUILTIN && !auth }, // đã đăng nhập SSO thì máy chủ tự gắn key: người dùng không cần nhập
      ...(LAN_GATEWAY ? [{ label: "Mạng nội bộ (HTTP, cần bật “Cho phép HTTP”)", baseUrl: LAN_GATEWAY, model: "qwen3.5-35b-a3b-int4", needsKey: true }] : []),
      ...(mockUrl ? [{ label: "Demo giả lập (không cần key)", baseUrl: mockUrl, model: "mock-agent", needsKey: false }] : []),
    ],
    openFolder: async () => void (await ctl.projectPick()),
    openUrl: async (url) => {
      if (isLocalPreviewUrl(url)) await shell.openExternal(url);
    },
    openExternally: async (abs) => {
      // chỉ mở tài liệu: không bao giờ "mở" tệp thực thi/kịch bản (có thể do agent hoặc người khác tạo)
      if (RISKY_EXT.test(abs)) throw new Error("Không mở tệp thực thi/kịch bản từ đây. Hãy mở thủ công nếu bạn chắc chắn.");
      const stt = await fs.stat(abs);
      if (!stt.isFile()) throw new Error("Không phải tệp.");
      const err = await shell.openPath(abs);
      if (err) throw new Error(err);
    },
    revealWorkspace: async () => {
      const dir = await host.activePath();
      if (dir) await shell.openPath(dir);
    },
  });
  ctl.onEvent((e) => send(profile, e));
  return ctl;
}

/** Menu “Mở thư mục…”: thêm một thư mục có sẵn làm dự án và chuyển sang nó. */
async function pickFolder(profile: Profile): Promise<void> {
  const r = await controllers.get(profile)?.projectPick();
  if (r && "error" in r && win) await dialog.showMessageBox(win, { type: "warning", message: "Không mở được thư mục", detail: r.error });
}

// ---------------------------------------------------------------- cập nhật (docs/RELEASE.md): tự kiểm tra, chỉ tải khi người dùng bấm, kiểm tra mã băm, không tự cài
function startUpdater(): void {
  if (SMOKE || !app.isPackaged) return; // bản dev/kiểm thử không kiểm tra bản mới
  const base = __DEFAULT_BASE_URL__.replace(/vllm\/v1\/?$/, "download/");
  if (!/^https:\/\/[^/]+\/.*\/$/.test(base)) return; // chỉ khi máy chủ chính là https
  const file = path.join(userData(), "update.json");
  try {
    autoUpdate = JSON.parse(readFileSync(file, "utf8")).auto !== false; // mặc định BẬT
  } catch {
    autoUpdate = true;
  }
  updater = new Updater({
    version: app.getVersion(),
    platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux",
    arch: process.arch,
    baseUrl: base,
    headers: async () => (auth ? auth.getHeaders() : {}),
    fetch: (...a) => fetch(...a),
    downloadsDir: () => app.getPath("downloads"),
    reveal: (p) => shell.showItemInFolder(p),
    canInstall: (name) =>
      canInstallHere(process.platform, name, process.execPath, (d) => {
        try {
          accessSync(d, fsConstants.W_OK);
          return true;
        } catch {
          return false;
        }
      }),
    install: async (file, relaunch) => {
      await suspendForUpdate(); // việc đang dở được dừng gọn, lưu và ghi lại để làm tiếp sau khi mở lại
      const ok = launchInstaller({ platform: process.platform, file, execPath: process.execPath, pid: process.pid, tmpDir: os.tmpdir(), relaunch });
      if (ok && relaunch) setTimeout(() => app.quit(), 500); // trình cài chờ ứng dụng thoát rồi mới thay
      return ok;
    },
    auto: () => autoUpdate,
    updatesDir: () => path.join(userData(), "updates"),
    onState: (st) => win?.webContents.send("neu:update-changed", st),
    loadDismissed: async () => {
      try {
        return String(JSON.parse(await fs.readFile(file, "utf8")).dismissed ?? "");
      } catch {
        return "";
      }
    },
    saveDismissed: async (v) => {
      await saveUpdatePrefs({ dismissed: v });
    },
  });
  updater.start();
}

let autoUpdate = true;

// ---- làm tiếp việc đang dở sau khi cập nhật: dừng gọn + ghi resume.json trước khi thoát; mở lại thì tự nhắn agent làm tiếp
const RESUME_TTL_MS = 24 * 3600_000;
const resumeFile = () => path.join(userData(), "resume.json");
let suspended = false;

async function suspendForUpdate(): Promise<void> {
  if (suspended) return;
  suspended = true;
  const items: { profile: Profile; projectId: string; chatId: string }[] = [];
  for (const [profile, ctl] of controllers) {
    try {
      const at = await ctl.suspendForRestart();
      if (at) items.push({ profile, ...at });
    } catch {
      /* không ghi được thì thôi: chỉ mất khả năng tự làm tiếp */
    }
  }
  if (!items.length) return;
  try {
    await fs.mkdir(userData(), { recursive: true });
    await fs.writeFile(resumeFile(), JSON.stringify({ from: app.getVersion(), ts: Date.now(), items }), { mode: 0o600 });
  } catch {
    /* bỏ qua */
  }
}

/** Khởi động sau cập nhật: nếu có việc dở thì nhắn agent làm tiếp (một lần; bỏ qua khi chưa lên bản mới hoặc đã quá hạn). */
async function resumeAfterUpdate(): Promise<void> {
  let raw = "";
  try {
    raw = await fs.readFile(resumeFile(), "utf8");
  } catch {
    return;
  }
  await fs.rm(resumeFile(), { force: true }).catch(() => undefined); // chỉ chạy một lần
  let r: { from?: unknown; ts?: unknown; items?: unknown };
  try {
    r = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof r.from !== "string" || r.from === app.getVersion() || typeof r.ts !== "number" || Date.now() - r.ts > RESUME_TTL_MS || !Array.isArray(r.items)) return;
  const text = `Tiếp tục công việc đang làm dở (${brandName()} vừa cập nhật lên ${app.getVersion()}). Hãy kiểm tra các tệp hiện có trong thư mục rồi làm tiếp từ chỗ đã dừng, không làm lại phần đã xong.`;
  for (const it of r.items.slice(0, 3)) {
    const x = it as { profile?: unknown; projectId?: unknown; chatId?: unknown };
    if (typeof x.profile !== "string" || typeof x.projectId !== "string" || typeof x.chatId !== "string" || !PROFILES_LIST.includes(x.profile as Profile)) continue;
    await controllers.get(x.profile as Profile)?.resumeAfterRestart({ projectId: x.projectId, chatId: x.chatId }, text).catch(() => false);
  }
}

/** Ghi update.json (đã chọn "Để sau" + tự cập nhật bật/tắt), giữ các khoá còn lại. */
async function saveUpdatePrefs(patch: { dismissed?: string; auto?: boolean }): Promise<void> {
  const file = path.join(userData(), "update.json");
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    /* chưa có */
  }
  await fs.mkdir(userData(), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...cur, ...patch }), { mode: 0o600 });
}

/** Menu "Kiểm tra bản cập nhật…": người dùng chủ động, nên hiện cả bản từng chọn "Để sau" và báo rõ khi đã mới nhất. */
async function manualUpdateCheck(): Promise<void> {
  if (!updater) {
    await dialog.showMessageBox({ type: "info", message: "Kiểm tra bản cập nhật", detail: `Bạn đang dùng ${brandName()} ${app.getVersion()}. Việc tự kiểm tra bản mới chỉ có trong bản cài đặt chính thức.` });
    return;
  }
  const st = await updater.check(true);
  if (st.phase === "idle") await dialog.showMessageBox({ type: "info", message: "Bạn đang dùng bản mới nhất", detail: `${brandName()} ${st.current}.` });
  else if (st.phase === "error") await dialog.showMessageBox({ type: "warning", message: "Kiểm tra bản cập nhật", detail: st.error ?? "Không kiểm tra được." });
}

// ---------------------------------------------------------------- IPC (mọi tham số được kiểm tra; không lộ chi tiết lỗi nội bộ)
const limiter = new RateLimiter(200, 1000);

function registerIpc(): void {
  const trusted = (e: Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && isTrustedSenderUrl(e.senderFrame?.url);
  // kênh đăng nhập: trạng thái / đăng nhập (mở trình duyệt hệ thống) / đăng xuất
  ipcMain.handle("neu:auth", async (e, method: unknown, arg: unknown) => {
    if (!trusted(e)) throw new Error("Nguồn không hợp lệ");
    if (typeof method !== "string" || !AUTH_METHODS.has(method) || !authArgsOk(method, arg)) throw new Error("Yêu cầu không hợp lệ");
    if (!auth) return { enabled: false, signedIn: true };
    if (method === "status") return { ...auth.status(), remember };
    if (method === "remember") {
      await setRemember((arg as { value: boolean }).value);
      return { ...auth.status(), remember };
    }
    if (method === "logout") {
      await auth.logout();
      return auth.status();
    }
    try {
      if (method === "loginPassword") {
        const a = arg as { username: string; password: string };
        return await auth.loginPassword(a.username, a.password);
      }
      return await auth.login();
    } catch (err) {
      return { ...auth.status(), error: err instanceof Error ? err.message.slice(0, 300) : "Đăng nhập không thành công." };
    }
  });
  // kênh cập nhật: trạng thái / kiểm tra / tải / để sau / cài đặt (chỉ sau khi người dùng bấm) / mở thư mục chứa bản đã tải (không có tham số)
  ipcMain.handle("neu:update", async (e, method: unknown) => {
    if (!trusted(e)) throw new Error("Nguồn không hợp lệ");
    if (typeof method !== "string" || !UPDATE_METHODS.has(method)) throw new Error("Yêu cầu không hợp lệ");
    if (!updater) return { phase: "idle", current: app.getVersion() };
    if (method === "check") return updater.check(true);
    if (method === "download") return updater.download();
    if (method === "dismiss") return updater.dismiss();
    if (method === "install") return updater.install();
    if (method === "openFolder") {
      updater.openFolder();
      return updater.status();
    }
    return updater.status();
  });
  ipcMain.handle("neu:call", async (e, profile: unknown, method: unknown, args: unknown) => {
    if (!trusted(e)) throw new Error("Nguồn không hợp lệ");
    if (authBlocks(!!auth, !!auth?.status().signedIn)) throw new Error("Cần đăng nhập");
    if (!limiter.allow()) throw new Error("Quá nhiều yêu cầu, hãy thử lại sau giây lát.");
    if (typeof profile !== "string" || !PROFILES_LIST.includes(profile as Profile) || typeof method !== "string" || !IPC_METHODS.has(method) || !Array.isArray(args) || !IPC_VALIDATORS[method](args)) throw new Error("Yêu cầu không hợp lệ");
    const ctl = controllers.get(profile as Profile);
    if (!ctl) throw new Error("Chưa sẵn sàng");
    try {
      if (method === "send") {
        void ctl.send(String(args[0])); // chạy nền; tiến độ qua sự kiện
        return undefined;
      }
      return await (ctl as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message.slice(0, 500) : "Lỗi không xác định");
    }
  });
}

// ---------------------------------------------------------------- cửa sổ, giao thức app://, mạng
function registerAppProtocol(): void {
  protocol.handle("app", async (req) => {
    const file = resolveAppAsset(RENDERER_ROOT, req.url);
    if (!file) return new Response("Không tìm thấy", { status: 404, headers: SECURITY_HEADERS });
    return new Response(await fs.readFile(file), { headers: { ...SECURITY_HEADERS, "Content-Type": mimeOf(file) } });
  });
}

function hardenSession(): void {
  const s = session.defaultSession;
  // Giao diện không được tự gọi mạng: chỉ app:// và data: (ảnh nhúng). Mọi thứ khác bị huỷ.
  s.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(d.url.startsWith("app://main/") || d.url.startsWith("data:") || (__DEV__ && d.url.startsWith("devtools:"))) }));
  s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  s.setPermissionCheckHandler(() => false);
  s.setDevicePermissionHandler(() => false);
  void s.setSpellCheckerEnabled(false);
  app.on("web-contents-created", (_e, c) => {
    c.on("will-attach-webview", (ev) => ev.preventDefault());
    c.on("will-navigate", (ev) => ev.preventDefault());
    c.on("will-redirect", (ev) => ev.preventDefault());
    c.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, show: !SMOKE, backgroundColor: "#f6f6f3", title: brandName(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      experimentalFeatures: false, webviewTag: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      safeDialogs: true, spellcheck: false, devTools: !app.isPackaged,
    },
  });
  if (__DEV__) {
    win.webContents.on("render-process-gone", (_e, d) => console.error("[render-process-gone]", d.reason, d.exitCode));
    win.webContents.on("did-start-navigation", (d) => console.error("[nav]", d.url, "main=" + d.isMainFrame, "same=" + d.isSameDocument));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.error("[fail-load]", code, desc, url));
  }
  win.webContents.on("preload-error", (_e, file, err) => console.error("[preload-error]", file, err?.message));
  win.webContents.on("console-message", (_e, level, msg, line, src) => { if (__DEV__ && level >= 2) console.error("[renderer]", msg, src + ":" + line); });
  await win.loadURL(APP_ORIGIN + "/index.html");
  if (__DEV__ && process.env.NEU_SHOT) {
    // chỉ bản dev: chụp cửa sổ rồi thoát (để xem giao diện mà không cần thao tác tay)
    await new Promise((r) => setTimeout(r, 2500));
    await fs.writeFile(process.env.NEU_SHOT, (await win.webContents.capturePage()).toPNG());
    app.exit(0);
  }
}

function buildMenu(): void {
  const mac = process.platform === "darwin";
  const dev: MenuItemConstructorOptions[] = app.isPackaged ? [] : [{ role: "toggleDevTools" }, { role: "reload" }];
  const tpl: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    { label: "Tệp", submenu: [
      { label: "Mở thư mục Work…", accelerator: "CmdOrCtrl+Shift+O", click: () => void pickFolder("work") },
      { label: "Mở thư mục Code…", accelerator: "CmdOrCtrl+O", click: () => void pickFolder("code") },
      { label: "Mở thư mục Design…", click: () => void pickFolder("design") },
      { type: "separator" },
      { label: "Nạp dữ liệu mẫu cho Work (tuỳ chọn)", click: async () => { await seed("work", await folderFor("work")); send("work", { type: "files_changed", paths: [] }); } },
      { label: "Nạp dự án mẫu cho Code (tuỳ chọn)", click: async () => { await seed("code", await folderFor("code")); send("code", { type: "files_changed", paths: [] }); } },
      { label: "Nạp thiết kế mẫu cho Design (tuỳ chọn)", click: async () => { await seed("design", await folderFor("design")); send("design", { type: "files_changed", paths: [] }); } },
      { type: "separator" },
      { label: "Mở thư mục cài đặt", click: () => void shell.openPath(userData()) },
      { label: "Kiểm tra bản cập nhật…", click: () => void manualUpdateCheck() },
      { label: "Tự động cập nhật (cài khi đóng ứng dụng)", type: "checkbox" as const, checked: autoUpdate, click: (item) => { autoUpdate = item.checked; void saveUpdatePrefs({ auto: autoUpdate }).catch(() => undefined); if (autoUpdate) void updater?.check(); } },
      mac ? { role: "close" as const } : { role: "quit" as const },
    ] },
    { role: "editMenu" },
    { label: "Xem", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...dev] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

async function startMock(): Promise<void> {
  // chỉ có trong bản dev/kiểm thử (esbuild loại bỏ khỏi bản phát hành vì __SMOKE__/__DEV__ = false)
  const { mockHandler } = await import("../../web/dev/mock-llm.mjs");
  mockServer = createServer((req, res) => void mockHandler(req, res, new URL(req.url!, "http://x").pathname));
  await new Promise<void>((r) => mockServer!.listen(0, "127.0.0.1", r));
  mockUrl = `http://127.0.0.1:${(mockServer.address() as { port: number }).port}/mock/v1`;
}

app.whenReady().then(async () => {
  hardenSession();
  registerAppProtocol();
  policy = await loadPolicy();
  if ((__SMOKE__ && SMOKE) || (__DEV__ && process.env.NEU_MOCK)) await startMock();
  if (AUTH_CFG) {
    const file = path.join(userData(), "auth.json");
    const prefsFile = path.join(userData(), "auth-prefs.json");
    const c = codec();
    // Mặc định KHÔNG lưu phiên đăng nhập trên máy (không chạm Keychain, không bị hỏi quyền). Chỉ khi người dùng tích “Ghi nhớ” ở màn hình đăng nhập.
    remember = await fs.readFile(prefsFile, "utf8").then((t) => JSON.parse(t).remember === true).catch(() => false);
    setRemember = async (v) => {
      remember = v;
      await fs.mkdir(userData(), { recursive: true });
      await fs.writeFile(prefsFile, JSON.stringify({ remember: v }), { mode: 0o600 });
      if (!v) await fs.rm(file, { force: true });
    };
    auth = new Auth(AUTH_CFG, {
      fetch: (...a) => fetch(...a),
      // chỉ mở đúng trang đăng nhập của nhà cấp đã cấu hình
      openExternal: async (url) => {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.host !== new URL(AUTH_CFG.issuer).host) throw new Error("Địa chỉ đăng nhập không hợp lệ.");
        await shell.openExternal(u.href);
      },
      // phiên đăng nhập (kể cả refresh token) chỉ lưu khi người dùng chọn “Ghi nhớ” VÀ có kho mã hoá của hệ điều hành; không thì chỉ giữ trong bộ nhớ
      storage: {
        load: async () => {
          if (!remember) {
            await fs.rm(file, { force: true });
            return null;
          }
          return c.decrypt(await fs.readFile(file, "utf8"));
        },
        save: async (d) => {
          if (d === null) await fs.rm(file, { force: true });
          else if (remember) {
            await fs.mkdir(userData(), { recursive: true });
            await fs.writeFile(file, c.encrypt(d), { mode: 0o600 });
          }
        },
      },
    });
    // vào/ra đăng nhập → tải lại cửa sổ từ tiến trình chính (renderer không tự reload được vì mọi điều hướng đều bị chặn)
    let lastSigned: boolean | undefined;
    auth.onChange((s) => {
      win?.webContents.send("neu:auth-changed", s);
      if (lastSigned !== undefined && s.signedIn !== lastSigned) win?.webContents.reload();
      lastSigned = s.signedIn;
    });
    await auth.init();
  }
  registerIpc();
  for (const p of PROFILES_LIST) controllers.set(p, await buildController(p));
  buildMenu();
  await createWindow();
  startUpdater();
  if (!SMOKE && app.isPackaged) {
    // làm tiếp việc dở sau cập nhật: đợi cửa sổ tải xong và (nếu cần) đã đăng nhập
    const go = () => setTimeout(() => void resumeAfterUpdate(), 2500);
    const ready = () => {
      if (!auth || auth.status().signedIn) return go();
      const off = auth.onChange((st) => {
        if (st.signedIn) {
          off();
          go();
        }
      });
    };
    if (win?.webContents.isLoading()) win.webContents.once("did-finish-load", ready);
    else ready();
  }
  if (__SMOKE__ && SMOKE) {
    const { runSmoke } = await import("./smoke");
    const code = await runSmoke({ win: win!, dir: SMOKE, mockUrl, controllers, codeDir: await folderFor("code"), workDir: await folderFor("work") });
    app.exit(code);
  }
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
// tự cập nhật: bản đã tải nền và kiểm mã băm sẽ được cài khi người dùng đóng ứng dụng (không mở lại)
app.on("before-quit", (e) => {
  // sắp cài bản mới khi đóng: dừng gọn việc đang chạy (và ghi chỗ làm tiếp) rồi mới thoát
  if (!suspended && updater?.willInstallOnQuit()) {
    e.preventDefault();
    void suspendForUpdate().finally(() => app.quit());
  }
});
app.on("will-quit", () => {
  try {
    updater?.installOnQuit();
  } catch {
    /* không được làm kẹt việc thoát */
  }
});
app.on("window-all-closed", () => {
  mockServer?.close();
  if (process.platform !== "darwin" || SMOKE) app.quit();
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) void createWindow();
});
