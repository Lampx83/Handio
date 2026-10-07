import "@neu/agent-ui/style.css";
import type { AgentController, ChatMeta, DirEntry, HistoryItem, PermissionResponse, Profile, ProjectsState, SessionEvent, Settings, UiState } from "@neu/agent-core";
import { mountShell } from "@neu/agent-ui";

interface AuthState {
  enabled: boolean;
  signedIn: boolean;
  email?: string;
  name?: string;
  error?: string;
}
interface Bridge {
  platform: string;
  auth: { status(): Promise<AuthState>; login(): Promise<AuthState>; logout(): Promise<AuthState>; onChange(cb: (s: AuthState) => void): () => void };
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
  downloadFile = (p: string) => this.call<any>("downloadFile", p);
  exportZip = () => this.call<any>("exportZip");
  openExternally = (p: string) => this.call<void>("openExternally", p);
  revealWorkspace = () => this.call<void>("revealWorkspace");
  saveSettings = (s: Partial<Settings>) => this.call<void>("saveSettings", s);
  testConnection = () => this.call<any>("testConnection");
  listModels = () => this.call<string[]>("listModels");
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
    if (r.signedIn) return void location.reload();
    btn.disabled = false;
    btn.textContent = "Đăng nhập Microsoft";
    err.textContent = r.error ?? "";
  });
  const card = document.createElement("div");
  card.className = "login-card";
  const title = document.createElement("h1");
  title.textContent = "NEU Agent";
  const note = document.createElement("div");
  note.className = "login-note";
  note.textContent = "@neu.edu.vn · @st.neu.edu.vn";
  card.append(title, btn, err, note);
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
  bridge.auth.onChange((s) => {
    if (s.enabled && !s.signedIn) location.reload(); // hết phiên: về màn hình đăng nhập
  });
  mountShell(root, { work: new IpcController("work"), code: new IpcController("code"), design: new IpcController("design") }, {
    productName: "NEU Agent",
    macInset: bridge.platform === "darwin",
    account: st.enabled && st.email ? { email: st.email, name: st.name, logout: () => void bridge.auth.logout().then(() => location.reload()) } : undefined,
  });
}
void start();
