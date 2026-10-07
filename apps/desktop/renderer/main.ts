import "@neu/agent-ui/style.css";
import type { AgentController, DirEntry, PermissionResponse, Profile, SessionEvent, Settings, UiState } from "@neu/agent-core";
import { mountShell } from "@neu/agent-ui";

interface Bridge {
  platform: string;
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
}

mountShell(document.getElementById("root")!, { code: new IpcController("code"), work: new IpcController("work") }, { productName: "NEU Agent", macInset: bridge.platform === "darwin" });
