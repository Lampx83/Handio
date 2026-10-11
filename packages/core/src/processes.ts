import type { Env } from "./env";

export interface ProcInfo {
  id: string;
  command: string;
  alive: boolean;
  code?: number;
  url?: string;
  startedAt: number;
  /** id của tiến trình cũ cùng loại đã bị dừng để thay bằng tiến trình này (không để hai máy chủ chiếm hai cổng). */
  replaced?: string;
}
export type ProcEvent = { id: string; command: string; state: "start" | "data" | "exit"; text?: string; code?: number; url?: string };

const MAX_LOG = 200_000;
/** Lệnh khởi động máy chủ dev/web: một dự án chỉ cần MỘT cái chạy. */
const DEV_SERVER = /(?:\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b|\bvite\b|\bnext\s+(?:dev|start)\b|\bwebpack(?:-dev-server)?\s+serve\b|\bhttp\.server\b|\blive-server\b|\bstreamlit\s+run\b|\bflask\s+run\b|\buvicorn\b|\bnodemon\b)/i;
const norm = (c: string) => c.trim().replace(/\s+/g, " ");
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}[^\s"'<>)]*/;

/** Quản lý các lệnh chạy nền (máy chủ web…) của một phiên; luôn dừng hết khi phiên kết thúc. */
export class ProcessManager {
  private procs = new Map<string, { info: ProcInfo; log: string; stop: () => void; cwd: string }>();
  private seq = 0;
  constructor(private env: Env, private emit: (e: ProcEvent) => void, private max = 5) {}

  start(command: string, cwd: string): ProcInfo {
    if (!this.env.spawn) throw new Error("Nơi chạy này không hỗ trợ chạy nền.");
    // chạy lại đúng lệnh cũ (hoặc một máy chủ dev khác trong cùng thư mục): dừng cái cũ trước, nếu không hai máy chủ sẽ chiếm hai cổng
    // và trình duyệt cứ mở nhầm bản cũ (đã gặp: 4 máy chủ ở cổng 5173–5176)
    let replaced: string | undefined;
    for (const p of this.procs.values()) {
      if (!p.info.alive || p.cwd !== cwd) continue;
      if (norm(p.info.command) === norm(command) || (DEV_SERVER.test(p.info.command) && DEV_SERVER.test(command))) {
        p.stop();
        p.info.alive = false;
        replaced = p.info.id;
      }
    }
    if ([...this.procs.values()].filter((p) => p.info.alive).length >= this.max) throw new Error(`Đang có ${this.max} tiến trình nền; hãy dừng bớt (kill_process).`);
    const id = "p" + ++this.seq;
    const info: ProcInfo = { id, command, alive: true, startedAt: Date.now(), ...(replaced ? { replaced } : {}) };
    const rec = { info, log: "", stop: () => undefined as void, cwd };
    this.procs.set(id, rec);
    this.emit({ id, command, state: "start" });
    const h = this.env.spawn(command, {
      cwd,
      onData: (chunk) => {
        rec.log = (rec.log + chunk).slice(-MAX_LOG);
        if (!info.url) {
          const m = LOCAL_URL.exec(rec.log);
          if (m) info.url = m[0].replace(/0\.0\.0\.0/, "localhost");
        }
        this.emit({ id, command, state: "data", text: chunk, url: info.url });
      },
      onExit: (code) => {
        info.alive = false;
        info.code = code;
        this.emit({ id, command, state: "exit", code });
      },
    });
    rec.stop = () => h.stop();
    return info;
  }

  get(id: string): { info: ProcInfo; log: string } | undefined {
    return this.procs.get(id);
  }
  list(): ProcInfo[] {
    return [...this.procs.values()].map((p) => p.info);
  }
  stop(id: string): boolean {
    const p = this.procs.get(id);
    if (!p || !p.info.alive) return false;
    p.stop();
    return true;
  }
  stopAll(): void {
    for (const p of this.procs.values()) if (p.info.alive) p.stop();
  }
  /** Đợi tối đa `ms` để có dữ liệu đầu hoặc tiến trình thoát (để agent thấy lỗi khởi động ngay). */
  async settle(id: string, ms: number): Promise<void> {
    const t0 = Date.now();
    const p = this.procs.get(id);
    while (p && p.info.alive && Date.now() - t0 < ms && !p.info.url) await new Promise((r) => setTimeout(r, 100));
  }
}
