import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { buildWorkSamples, cleanProjectName, ID_RE, LocalController, newId, parsePolicy, PROFILE_ORDER, SAMPLE_DESIGN, SAMPLE_PROJECT, type Policy, type Profile, type ProjectHost, type ProjectInfo, type ProjectsState, type SessionEvent } from "@neu/agent-core";
import { JsonChatStore, JsonSettingsStore, JsonTrustStore, NodeEnv, type KeyCodec } from "@neu/agent-env-node";
import { Auth, type AuthConfig } from "./auth";
import { APP_ORIGIN, AUTH_METHODS, authBlocks, IPC_METHODS, IPC_VALIDATORS, isLocalPreviewUrl, isSafeExternalUrl, isTooBroadFolder, isTrustedSenderUrl, mimeOf, RateLimiter, resolveAppAsset, RISKY_EXT, SECURITY_HEADERS } from "./security";

// Hằng số lúc build (xem build.mjs): bản phát hành KHÔNG chứa mã kiểm thử/giả lập và KHÔNG chứa key.
declare const __SMOKE__: boolean;
declare const __DEV__: boolean;
declare const __DEFAULT_BASE_URL__: string;
declare const __BUILTIN_KEY__: string;
declare const __AUTH__: AuthConfig | null;

const PROFILES_LIST: Profile[] = PROFILE_ORDER;
const DEFAULT_DIR: Record<Profile, string> = { work: "NEU Work", code: "NEU Code", design: "NEU Design" };
const DEFAULT_NAME: Record<Profile, string> = { work: "Dự án mẫu", code: "Dự án mẫu", design: "Mẫu thiết kế" };
const LAN_GATEWAY = "http://192.0.2.11:8037/vllm/v1";
const SMOKE = __SMOKE__ ? process.env.NEU_SMOKE_DIR || "" : "";
// Đăng nhập SSO bắt buộc ở bản phát hành. Riêng chế độ kiểm thử đầu-cuối (SMOKE, không có trong bản phát hành) bỏ qua.
const AUTH_CFG: AuthConfig | null = SMOKE ? null : __AUTH__;
let auth: Auth | null = null;
const BUILTIN = __BUILTIN_KEY__ ? { key: __BUILTIN_KEY__, hosts: [new URL(__DEFAULT_BASE_URL__).host, "192.0.2.11:8037"] } : undefined;
const RENDERER_ROOT = path.join(__dirname, "renderer");

let win: BrowserWindow | null = null;
let policy: Policy = {};
const controllers = new Map<Profile, LocalController>();
let mockServer: Server | null = null;
let mockUrl = "";

// ---------------------------------------------------------------- khởi tạo an toàn (trước khi app sẵn sàng)
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }]);
app.enableSandbox();
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
if (SMOKE) app.setPath("userData", path.join(SMOKE, "userData"));

const userData = () => app.getPath("userData");
const cfgFile = () => path.join(userData(), "folders.json");

// ---------------------------------------------------------------- chính sách quản trị
async function loadPolicy(): Promise<Policy> {
  const files = [
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

function codec(): KeyCodec | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  return { encrypt: (s) => safeStorage.encryptString(s).toString("base64"), decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")) };
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
  const dir = SMOKE ? path.join(SMOKE, profile) : path.join(app.getPath("documents"), DEFAULT_DIR[profile]);
  let fresh = false;
  try {
    await fs.access(dir);
    fresh = (await fs.readdir(dir)).length === 0;
  } catch {
    await fs.mkdir(dir, { recursive: true });
    fresh = true;
  }
  if (fresh) await seed(profile, dir); // lần đầu: nạp dữ liệu mẫu để có cái mà thử
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
const makeEnv = (profile: Profile, dir: string) => new NodeEnv(dir, { allowExec: profile === "code", sandbox: process.platform === "darwin" ? { network: policy.bashNetwork !== false } : false });

/** Thư mục chứa các dự án do ứng dụng tạo: Tài liệu/NEU Agent/<Work|Code|Design>/<tên>. */
function projectsParent(profile: Profile): string {
  return SMOKE ? path.join(SMOKE, "projects", profile) : path.join(app.getPath("documents"), "NEU Agent", profile === "work" ? "Work" : profile === "code" ? "Code" : "Design");
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
      if (projects.length) return { active: projects.some((p) => p.id === r.active) ? r.active : projects[0].id, projects };
    } catch {
      /* chưa có: tạo dự án mặc định */
    }
    const now = Date.now();
    const r: Registry = { active: "default", projects: [{ id: "default", name: DEFAULT_NAME[profile], path: await folderFor(profile), created: now, lastUsed: now }] };
    await write(r);
    return r;
  };
  const uniqueDir = async (parent: string, name: string): Promise<string> => {
    await fs.mkdir(parent, { recursive: true });
    for (let n = 1; ; n++) {
      const dir = path.join(parent, n === 1 ? name : `${name} (${n})`);
      try {
        await fs.mkdir(dir);
        return dir;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  };
  const uniqueName = (r: Registry, name: string): string => {
    let out = name;
    for (let n = 2; r.projects.some((p) => p.name.toLowerCase() === out.toLowerCase()); n++) out = `${name} (${n})`;
    return out;
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
      const dir = await uniqueDir(projectsParent(profile), clean);
      const now = Date.now();
      const info: ProjectInfo = { id: newId(), name: uniqueName(r, path.basename(dir)), path: dir, created: now, lastUsed: now };
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
        info = { id: newId(), name: uniqueName(r, cleanProjectName(path.basename(dir)) || "Dự án"), path: dir, created: now, lastUsed: now };
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
async function renderDesign(html: string, o: { format: "pdf" | "png"; width: number; height?: number }): Promise<Uint8Array> {
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
    return await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: css, ...(css ? {} : { pageSize: { width: o.width / 96, height: full / 96 } }), margins: { top: 0, bottom: 0, left: 0, right: 0 } });
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
  ctl = await LocalController.create({
    env,
    profile,
    policy,
    defaults: { baseUrl: __DEFAULT_BASE_URL__ },
    builtinKey: BUILTIN,
    authToken: auth ? () => auth!.getBearer() : undefined,
    // tự chẩn đoán KHÔNG chứa nội dung (docs/DIAGNOSTICS.md): chỉ gửi khi đã đăng nhập, tới đúng máy chủ của ứng dụng
    diagnostics: { endpoint: __DEFAULT_BASE_URL__.replace(/\/vllm\/v1\/?$/, "/diag"), headers: (): Record<string, string> => { const t = auth?.peekBearer(); return t ? { Authorization: "Bearer " + t } : {}; }, enabled: () => !!auth && !SMOKE, version: app.getVersion(), platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux" },
    authHosts: [new URL(__DEFAULT_BASE_URL__).host],
    realFs: true,
    projects: host,
    chats: chatStore(),
    renderDesign: profile === "design" ? renderDesign : undefined,
    store: new JsonSettingsStore(path.join(userData(), "settings.json"), codec(), { persistKeyWithoutCodec: false }),
    trust: new JsonTrustStore(path.join(userData(), "trusted-folders.json")),
    presets: [
      { label: "Máy chủ chính (HTTPS)", baseUrl: __DEFAULT_BASE_URL__, model: "qwen3.5-35b-a3b-int4", needsKey: !BUILTIN },
      { label: "Mạng nội bộ (HTTP, cần bật “Cho phép HTTP”)", baseUrl: LAN_GATEWAY, model: "qwen3.5-35b-a3b-int4", needsKey: true },
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

// ---------------------------------------------------------------- IPC (mọi tham số được kiểm tra; không lộ chi tiết lỗi nội bộ)
const limiter = new RateLimiter(200, 1000);

function registerIpc(): void {
  const trusted = (e: Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && isTrustedSenderUrl(e.senderFrame?.url);
  // kênh đăng nhập: trạng thái / đăng nhập (mở trình duyệt hệ thống) / đăng xuất
  ipcMain.handle("neu:auth", async (e, method: unknown) => {
    if (!trusted(e)) throw new Error("Nguồn không hợp lệ");
    if (typeof method !== "string" || !AUTH_METHODS.has(method)) throw new Error("Yêu cầu không hợp lệ");
    if (!auth) return { enabled: false, signedIn: true };
    if (method === "status") return auth.status();
    if (method === "logout") {
      await auth.logout();
      return auth.status();
    }
    try {
      return await auth.login();
    } catch (err) {
      return { ...auth.status(), error: err instanceof Error ? err.message.slice(0, 300) : "Đăng nhập không thành công." };
    }
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
    width: 1280, height: 860, minWidth: 900, minHeight: 600, show: !SMOKE, backgroundColor: "#f6f6f3", title: "NEU Agent",
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
      { label: "Nạp dữ liệu mẫu vào dự án mẫu Work", click: async () => { await seed("work", await folderFor("work")); send("work", { type: "files_changed", paths: [] }); } },
      { label: "Nạp dự án mẫu vào dự án mẫu Code", click: async () => { await seed("code", await folderFor("code")); send("code", { type: "files_changed", paths: [] }); } },
      { label: "Nạp thiết kế mẫu vào dự án mẫu Design", click: async () => { await seed("design", await folderFor("design")); send("design", { type: "files_changed", paths: [] }); } },
      { type: "separator" },
      { label: "Mở thư mục cài đặt", click: () => void shell.openPath(userData()) },
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
    const c = codec();
    auth = new Auth(AUTH_CFG, {
      fetch: (...a) => fetch(...a),
      // chỉ mở đúng trang đăng nhập của nhà cấp đã cấu hình
      openExternal: async (url) => {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.host !== new URL(AUTH_CFG.issuer).host) throw new Error("Địa chỉ đăng nhập không hợp lệ.");
        await shell.openExternal(u.href);
      },
      // phiên đăng nhập (kể cả refresh token) chỉ lưu khi có kho mã hoá của hệ điều hành; không có thì chỉ giữ trong bộ nhớ
      storage: {
        load: async () => (c ? c.decrypt(await fs.readFile(file, "utf8")) : null),
        save: async (d) => {
          if (!c) return;
          if (d === null) await fs.rm(file, { force: true });
          else {
            await fs.mkdir(userData(), { recursive: true });
            await fs.writeFile(file, c.encrypt(d), { mode: 0o600 });
          }
        },
      },
    });
    auth.onChange((s) => win?.webContents.send("neu:auth-changed", s));
    await auth.init();
  }
  registerIpc();
  for (const p of PROFILES_LIST) controllers.set(p, await buildController(p));
  buildMenu();
  await createWindow();
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
app.on("window-all-closed", () => {
  mockServer?.close();
  if (process.platform !== "darwin" || SMOKE) app.quit();
});
app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) void createWindow();
});
