import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { buildWorkSamples, LocalController, parsePolicy, SAMPLE_PROJECT, type Policy, type Profile, type SessionEvent } from "@neu/agent-core";
import { JsonSettingsStore, JsonTrustStore, NodeEnv, type KeyCodec } from "@neu/agent-env-node";
import { APP_ORIGIN, IPC_METHODS, IPC_VALIDATORS, isLocalPreviewUrl, isSafeExternalUrl, isTrustedSenderUrl, mimeOf, RateLimiter, resolveAppAsset, RISKY_EXT, SECURITY_HEADERS } from "./security";

// Hằng số lúc build (xem build.mjs): bản phát hành KHÔNG chứa mã kiểm thử/giả lập và KHÔNG chứa key.
declare const __SMOKE__: boolean;
declare const __DEV__: boolean;
declare const __DEFAULT_BASE_URL__: string;
declare const __BUILTIN_KEY__: string;

const PROFILES_LIST: Profile[] = ["code", "work"];
const LAN_GATEWAY = "http://192.0.2.11:8037/vllm/v1";
const SMOKE = __SMOKE__ ? process.env.NEU_SMOKE_DIR || "" : "";
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
  const files = profile === "code" ? SAMPLE_PROJECT : await buildWorkSamples();
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
  const dir = SMOKE ? path.join(SMOKE, profile === "code" ? "code" : "work") : path.join(app.getPath("documents"), profile === "code" ? "NEU Code" : "NEU Work");
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

async function buildController(profile: Profile): Promise<LocalController> {
  const dir = await folderFor(profile);
  const env = new NodeEnv(dir, { allowExec: profile === "code", sandbox: process.platform === "darwin" ? { network: policy.bashNetwork !== false } : false });
  const ctl = await LocalController.create({
    env,
    profile,
    policy,
    defaults: { baseUrl: __DEFAULT_BASE_URL__ },
    builtinKey: BUILTIN,
    realFs: true,
    store: new JsonSettingsStore(path.join(userData(), "settings.json"), codec(), { persistKeyWithoutCodec: false }),
    trust: new JsonTrustStore(path.join(userData(), "trusted-folders.json")),
    presets: [
      { label: "Máy chủ chính (HTTPS)", baseUrl: __DEFAULT_BASE_URL__, model: "qwen3.5-35b-a3b-int4", needsKey: !BUILTIN },
      { label: "Mạng nội bộ (HTTP, cần bật “Cho phép HTTP”)", baseUrl: LAN_GATEWAY, model: "qwen3.5-35b-a3b-int4", needsKey: true },
      ...(mockUrl ? [{ label: "Demo giả lập (không cần key)", baseUrl: mockUrl, model: "mock-agent", needsKey: false }] : []),
    ],
    openFolder: async () => void (await chooseFolder(profile)),
    openUrl: async (url) => {
      if (isLocalPreviewUrl(url)) await shell.openExternal(url);
    },
    openExternally: async (abs) => {
      // chỉ mở tài liệu: không bao giờ "mở" tệp thực thi/kịch bản (có thể do agent hoặc người khác tạo)
      if (RISKY_EXT.test(abs)) throw new Error("Không mở tệp thực thi/kịch bản từ đây. Hãy mở thủ công nếu bạn chắc chắn.");
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error("Không phải tệp.");
      const err = await shell.openPath(abs);
      if (err) throw new Error(err);
    },
    revealWorkspace: async () => void (await shell.openPath(dir)),
  });
  ctl.onEvent((e) => send(profile, e));
  return ctl;
}

async function chooseFolder(profile: Profile): Promise<boolean> {
  if (!win) return false;
  const r = await dialog.showOpenDialog(win, { title: profile === "code" ? "Chọn thư mục dự án" : "Chọn thư mục làm việc", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return false;
  controllers.get(profile)?.interrupt();
  await saveFolder(profile, r.filePaths[0]);
  controllers.set(profile, await buildController(profile));
  send(profile, { type: "reset" });
  return true;
}

// ---------------------------------------------------------------- IPC (mọi tham số được kiểm tra; không lộ chi tiết lỗi nội bộ)
const limiter = new RateLimiter(200, 1000);

function registerIpc(): void {
  ipcMain.handle("neu:call", async (e, profile: unknown, method: unknown, args: unknown) => {
    if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame || !isTrustedSenderUrl(e.senderFrame?.url)) throw new Error("Nguồn không hợp lệ");
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
}

function buildMenu(): void {
  const mac = process.platform === "darwin";
  const dev: MenuItemConstructorOptions[] = app.isPackaged ? [] : [{ role: "toggleDevTools" }, { role: "reload" }];
  const tpl: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    { label: "Tệp", submenu: [
      { label: "Mở thư mục Code…", accelerator: "CmdOrCtrl+O", click: () => void chooseFolder("code") },
      { label: "Mở thư mục Work…", accelerator: "CmdOrCtrl+Shift+O", click: () => void chooseFolder("work") },
      { type: "separator" },
      { label: "Nạp dữ liệu mẫu vào thư mục Work", click: async () => { const dir = await folderFor("work"); await seed("work", dir); send("work", { type: "files_changed", paths: [] }); } },
      { label: "Nạp dự án mẫu vào thư mục Code", click: async () => { const dir = await folderFor("code"); await seed("code", dir); send("code", { type: "files_changed", paths: [] }); } },
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
