import "@neu/agent-ui/style.css";
import type { AgentController, ChatMeta, DirEntry, HistoryItem, PermissionResponse, Profile, ProjectsState, SessionEvent, Settings, UiState } from "@neu/agent-core";
import { mountShell } from "@neu/agent-ui";
import { mountUpdateBanner, type UpdateBridge } from "./update-banner";

interface AuthState {
  enabled: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
  kind?: "microsoft" | "password";
  error?: string;
  passwordLogin?: boolean;
  remember?: boolean;
}
interface Bridge {
  platform: string;
  auth: { status(): Promise<AuthState>; login(): Promise<AuthState>; loginPassword(u: string, p: string): Promise<AuthState>; setRemember(value: boolean): Promise<AuthState>; logout(): Promise<AuthState>; onChange(cb: (s: AuthState) => void): () => void };
  update: UpdateBridge;
  call(profile: string, method: string, args: unknown[]): Promise<any>;
  onEvent(cb: (profile: string, e: unknown) => void): () => void;
}
const bridge = (window as unknown as { neu: Bridge }).neu;

/** Điều khiển từ xa: mọi lệnh đi qua IPC tới tiến trình chính, nơi agent chạy trên thư mục và lệnh thật. */
class IpcController implements AgentController {
  constructor(private profile: Profile) {}
  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    return bridge.call(this.profile, method, args);
  }
  getState = () => this.call<UiState>("getState");
  onEvent(cb: (e: SessionEvent) => void): () => void {
    return bridge.onEvent((p, e) => p === this.profile && cb(e as SessionEvent));
  }
  send = (text: string) => this.call<void>("send", text);
  interrupt(): void {
    void this.call("interrupt");
  }
  respondPermission(id: string, res: PermissionResponse): void {
    void this.call("respondPermission", id, res);
  }
  setMode = (m: string) => this.call<void>("setMode", m);
  newSession = () => this.call<void>("newSession");
  listDir = (p: string) => this.call<DirEntry[]>("listDir", p);
  readFile = (p: string) => this.call<any>("readFile", p);
  uploadFiles = (f: { name: string; data: Uint8Array }[]) => this.call<any>("uploadFiles", f);
  pasteImages = (f: { name: string; data: Uint8Array }[]) => this.call<any>("pasteImages", f);
  downloadFile = (p: string) => this.call<any>("downloadFile", p);
  exportZip = () => this.call<any>("exportZip");
  openExternally = (p: string) => this.call<void>("openExternally", p);
  revealWorkspace = () => this.call<void>("revealWorkspace");
  saveSettings = (s: Partial<Settings>) => this.call<void>("saveSettings", s);
  testConnection = () => this.call<any>("testConnection");
  listModels = () => this.call<string[]>("listModels");
  track = (act: string) => void this.call("track", act).catch(() => undefined);
  feedback = (v: "up" | "down", reason?: string) => void this.call("feedback", ...(reason ? [v, reason] : [v])).catch(() => undefined);
  sharePreview = (id?: string) => this.call<any>("sharePreview", ...(id ? [id] : [])).catch(() => ({ ok: false, message: "Không xem trước được.", title: "", items: 0, redactions: 0 }));
  shareChat = (f: { chatId?: string; title?: string }) => this.call<any>("shareChat", f).catch(() => ({ ok: false, message: "Không chia sẻ được." }));
  sharedChats = () => this.call<any>("sharedChats").catch(() => []);
  unshareChat = (id: string) => this.call<any>("unshareChat", id).catch(() => ({ ok: false, message: "Không thu hồi được." }));
  sendFeedback = (f: { kind: string; text: string; tech: boolean }) => this.call<any>("sendFeedback", f).catch(() => ({ ok: false, message: "Không gửi được góp ý." }));
  diagnosticsStatus = () => this.call<any>("diagnosticsStatus");
  diagnosticsPreview = (n: string) => this.call<string | null>("diagnosticsPreview", n);
  diagnosticsSend = () => this.call<any>("diagnosticsSend");
  resetPermissions = () => this.call<void>("resetPermissions");
  trustProject = (t: boolean) => this.call<void>("trustProject", t);
  openFolder = () => this.call<void>("openFolder");
  searchFiles = (q: string) => this.call<string[]>("searchFiles", q);
  stopProcess = (id: string) => this.call<void>("stopProcess", id);
  openUrl = (u: string) => this.call<void>("openUrl", u);
  learnLessons = () => this.call<any>("learnLessons");
  learnExercises = () => this.call<any>("learnExercises");
  learnExercise = (id: string) => this.call<any>("learnExercise", id);
  learnStart = (id: string) => this.call<any>("learnStart", id);
  learnHint = (id: string, n: number) => this.call<any>("learnHint", id, n);
  learnGrade = (id: string) => this.call<any>("learnGrade", id);
  learnTemplates = () => this.call<any>("learnTemplates");
  learnCreate = (id: string) => this.call<any>("learnCreate", id);
  projectsState = () => this.call<ProjectsState>("projectsState");
  projectOpen = (id: string) => this.call<void>("projectOpen", id);
  projectCreate = (spec: { name: string; instructions?: string }) => this.call<any>("projectCreate", spec);
  projectPick = () => this.call<any>("projectPick");
  projectRemove = (id: string) => this.call<any>("projectRemove", id);
  projectRename = (id: string, name: string) => this.call<void>("projectRename", id, name);
  instructionsGet = () => this.call<string>("instructionsGet");
  instructionsSet = (t: string) => this.call<void>("instructionsSet", t);
  chatList = () => this.call<ChatMeta[]>("chatList");
  chatOpen = (id: string) => this.call<{ id: string; title: string; history: HistoryItem[] } | { error: string }>("chatOpen", id);
  chatRemove = (id: string) => this.call<void>("chatRemove", id);
  changesList = () => this.call<any>("changesList");
  changeDiff = (p: string) => this.call<any>("changeDiff", p);
  changesRevert = (p?: string) => this.call<any>("changesRevert", ...(p === undefined ? [] : [p]));
  rewindPoints = () => this.call<any>("rewindPoints");
  rewind = (i: number, files: boolean) => this.call<any>("rewind", i, files);
  runSuggestions = () => this.call<any>("runSuggestions");
  docView = (p: string, loc?: string) => this.call<any>("docView", ...(loc === undefined ? [p] : [p, loc]));
  procedureList = () => this.call<any>("procedureList");
  procedureSave = (n: string, d?: string) => this.call<any>("procedureSave", ...(d === undefined ? [n] : [n, d]));
  procedureRemove = (n: string) => this.call<void>("procedureRemove", n);
  exportDesign = (p: string, f: "pdf" | "png", w: number, h?: number) => this.call<any>("exportDesign", ...(h === undefined ? [p, f, w] : [p, f, w, h]));
}

/** Màn hình đăng nhập (SSO Microsoft 365 qua trình duyệt hệ thống). */
function renderLogin(root: HTMLElement, st: AuthState): void {
  const err = document.createElement("div");
  err.className = "login-err";
  err.setAttribute("role", "alert");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn primary lg";
  btn.textContent = "Đăng nhập Microsoft";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Đang chờ trên trình duyệt…";
    err.textContent = "";
    const r = await bridge.auth.login().catch((e: Error) => ({ enabled: true, signedIn: false, error: e.message } as AuthState));
    if (r.signedIn) return; // tiến trình chính tải lại cửa sổ
    btn.disabled = false;
    btn.textContent = "Đăng nhập Microsoft";
    err.textContent = r.error ?? "";
  });
  try {
    if (sessionStorage.getItem("neu.expired")) {
      sessionStorage.removeItem("neu.expired");
      err.textContent = "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục; cuộc trò chuyện của bạn vẫn còn.";
    }
  } catch {
    /* bỏ qua */
  }
  const card = document.createElement("div");
  card.className = "login-card";
  const title = document.createElement("h1");
  title.textContent = "Handio";
  const note = document.createElement("div");
  note.className = "login-note";
  note.textContent = "@neu.edu.vn · @st.neu.edu.vn";
  // mặc định KHÔNG lưu phiên trên máy (macOS sẽ không hỏi quyền Keychain); tích chọn để khỏi đăng nhập lại mỗi lần mở
  const rem = document.createElement("input");
  rem.type = "checkbox";
  rem.id = "remember";
  rem.checked = !!st.remember;
  rem.addEventListener("change", () => void bridge.auth.setRemember(rem.checked));
  const remLabel = document.createElement("label");
  remLabel.className = "login-note login-remember";
  remLabel.htmlFor = "remember";
  remLabel.append(rem, " Ghi nhớ đăng nhập trên máy này");
  remLabel.title = "macOS sẽ hỏi quyền dùng Keychain (một lần mỗi bản cập nhật)";
  card.append(title, btn, note, remLabel);
  if (st.passwordLogin) {
    // đăng nhập bằng tên + mật khẩu (tài khoản do quản trị tạo): gửi một lần, ứng dụng chỉ giữ phiên, không giữ mật khẩu
    const mk = (type: string, ph: string, ac: string) => {
      const i = document.createElement("input");
      i.type = type;
      i.placeholder = ph;
      i.setAttribute("autocomplete", ac);
      i.maxLength = type === "password" ? 200 : 64;
      i.className = "login-in";
      return i;
    };
    const user = mk("text", "Tên đăng nhập", "username");
    const pass = mk("password", "Mật khẩu", "current-password");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn lg";
    go.textContent = "Đăng nhập";
    const submit = async () => {
      if (!user.value || !pass.value) return;
      go.disabled = true;
      err.textContent = "";
      const r = await bridge.auth.loginPassword(user.value.trim(), pass.value).catch((e: Error) => ({ enabled: true, signedIn: false, error: e.message } as AuthState));
      pass.value = "";
      if (r.signedIn) return; // tiến trình chính tải lại cửa sổ
      go.disabled = false;
      err.textContent = r.error ?? "";
    };
    go.addEventListener("click", () => void submit());
    for (const i of [user, pass]) i.addEventListener("keydown", (e) => e.key === "Enter" && void submit());
    const or = document.createElement("div");
    or.className = "login-or";
    or.textContent = "hoặc";
    card.append(or, user, pass, go);
  }
  card.append(err);
  const wrap = document.createElement("div");
  wrap.className = "login";
  wrap.append(card);
  root.replaceChildren(wrap);
  void st;
}

async function start(): Promise<void> {
  const root = document.getElementById("root")!;
  const st = await bridge.auth.status();
  if (st.enabled && !st.signedIn) return renderLogin(root, st);
  mountShell(root, { work: new IpcController("work"), code: new IpcController("code"), design: new IpcController("design") }, {
    productName: "Handio",
    macInset: bridge.platform === "darwin",
    account: st.enabled && st.email ? { email: st.email, name: st.name, kind: st.kind, logout: () => void bridge.auth.logout() } : undefined,
    // phiên hết hạn giữa chừng: đăng xuất cục bộ → tiến trình chính tải lại cửa sổ về màn hình đăng nhập (kèm lời giải thích)
    onLogin: st.enabled ? () => {
      try {
        sessionStorage.setItem("neu.expired", "1");
      } catch {
        /* bỏ qua */
      }
      void bridge.auth.logout();
    } : null,
  });
  mountUpdateBanner(bridge.update);
}
void start();
