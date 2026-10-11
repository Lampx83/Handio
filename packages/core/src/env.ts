import { basename, dirname, normalize } from "./path";

export interface DirEntry {
  name: string;
  isDir: boolean;
}
export interface StatInfo {
  isFile: boolean;
  isDir: boolean;
  mtimeMs: number;
  size: number;
}
export interface ExecResult {
  code: number;
  output: string;
  timedOut: boolean;
}
export interface RunJsResult {
  ok: boolean;
  logs: string[];
  result?: string;
  error?: string;
}

/**
 * Nơi agent làm việc: hệ thống file + (tuỳ chọn) chạy lệnh/JS/tải web.
 * Lõi chỉ nói chuyện với giao diện này nên chạy được ở Node (thật), Electron và trình duyệt (thư mục ảo).
 */
export interface Env {
  readonly root: string;
  readonly home?: string;
  /** Thư mục tạm NGOÀI dự án để đặt tệp đính kèm tạm (ảnh dán Ctrl+V…): không làm lẫn vào mã nguồn/thư mục làm việc của người dùng. */
  readonly scratchDir?: string;
  /** Mô tả hệ điều hành/nơi chạy, đưa vào system prompt. */
  readonly platform: string;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  stat(path: string): Promise<StatInfo | null>;
  readdir(path: string): Promise<DirEntry[]>;
  mkdirp(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Đường dẫn thật (theo symlink) của đường dẫn ĐÃ TỒN TẠI; ném lỗi nếu chưa có. */
  realpath(path: string): Promise<string>;
  /** Sandbox hệ điều hành đang bao quanh `exec` (nếu có). */
  readonly sandbox?: { kind: string; network: boolean };
  exec?(command: string, opts: { cwd: string; timeoutMs: number; signal?: AbortSignal; env?: Record<string, string> }): Promise<ExecResult>;
  /** Chạy lệnh nền (máy chủ web…): trả về điều khiển để dừng; dữ liệu và mã thoát qua callback. */
  spawn?(command: string, opts: { cwd: string; onData: (chunk: string) => void; onExit: (code: number) => void }): { stop(): void; readonly pid?: number };
  /** Chạy một tiến trình giao tiếp bằng từng dòng chữ qua stdin/stdout (MCP). `env` là biến môi trường người dùng khai báo rõ ràng. */
  spawnStdio?(command: string, args: string[], opts: { cwd: string; env?: Record<string, string>; onLine: (line: string) => void; onStderr?: (text: string) => void; onExit: (code: number) => void }): { write(line: string): void; stop(): void };
  runJs?(code: string, opts: { timeoutMs: number; files: Record<string, string>; cwd?: string }): Promise<RunJsResult>;
  fetchUrl?(url: string, opts: { maxChars: number; signal?: AbortSignal }): Promise<string>;
  /** Thu nhỏ ảnh (cạnh dài ≤ maxSide, JPEG) để gửi cho mô hình đọc ảnh; trả null nếu không làm được. Bản web dùng canvas, Desktop dùng nativeImage. */
  shrinkImage?(bytes: Uint8Array, mime: string, opts: { maxSide: number; quality: number }): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Chuyển Word/Excel/PowerPoint sang PDF (cần LibreOffice trên máy); không có thì để trống. */
  convertToPdf?(input: string, output: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void>;
  /** In HTML thành PDF (Desktop: Chromium sẵn có trong Electron, không cần LibreOffice). Dùng cho create_pdf. */
  htmlToPdf?(html: string, opts: { footer?: string; landscape?: boolean }): Promise<Uint8Array>;
  /**
   * Mở một trang (máy chủ dev trên localhost hoặc tệp HTML trong dự án) trong trình duyệt ẩn, cách ly, và báo lại lỗi console, yêu cầu hỏng,
   * trang trắng. Chỉ Desktop có (Chromium sẵn trong Electron). Dùng cho công cụ check_page của tab Code.
   */
  checkPage?(url: string, opts: { waitMs: number; signal?: AbortSignal }): Promise<PageReport>;
}

export interface PageReport {
  url: string;
  title: string;
  /** Không tải được (máy chủ chưa chạy, cổng sai…): `error` có lý do. */
  loaded: boolean;
  error?: string;
  /** Lỗi console + ngoại lệ chưa bắt (đã rút gọn, tối đa ~15). */
  errors: string[];
  /** Yêu cầu tài nguyên hỏng/bị chặn ("404 /src/x.js"). */
  failedRequests: string[];
  /** Chữ hiển thị trên trang (đầu trang), đã rút gọn. */
  text: string;
  /** Trang trắng: không có chữ và không có phần tử hiển thị nào đáng kể. */
  blank: boolean;
  /** Nội dung lớp phủ lỗi của Vite/webpack nếu có. */
  overlay?: string;
}

export class EnvError extends Error {}

/** Thư mục ảo trong bộ nhớ: dùng cho bản web và cho test. */
export class MemoryEnv implements Env {
  readonly root: string;
  readonly home = "/home/user";
  readonly scratchDir = "/.neu-scratch";
  readonly platform = "virtual in-memory workspace (no shell, no network)";
  private files = new Map<string, { data: Uint8Array; mtimeMs: number }>();
  private dirs = new Set<string>(["/"]);
  private clock = 1;
  private enc = new TextEncoder();
  runJs?: Env["runJs"];
  exec?: Env["exec"];
  spawn?: Env["spawn"];
  spawnStdio?: Env["spawnStdio"];
  fetchUrl?: Env["fetchUrl"];
  shrinkImage?: Env["shrinkImage"];
  /** Gọi sau mỗi thay đổi (để lưu bền, vd IndexedDB). */
  onChange?: () => void;

  constructor(root = "/workspace", seed: Record<string, string> = {}) {
    this.root = normalize(root);
    this.dirs.add(this.root);
    for (const [p, c] of Object.entries(seed)) this.setSync(normalize(this.root + "/" + p), c);
  }

  private setBytes(abs: string, data: Uint8Array): void {
    let d = dirname(abs);
    while (d !== "/" && !this.dirs.has(d)) {
      this.dirs.add(d);
      d = dirname(d);
    }
    this.files.set(abs, { data, mtimeMs: this.clock++ });
  }
  private setSync(abs: string, text: string): void {
    this.setBytes(abs, this.enc.encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const f = this.files.get(normalize(path));
    if (!f) throw new EnvError("ENOENT: " + path);
    return f.data;
  }
  async writeText(path: string, text: string): Promise<void> {
    this.setSync(normalize(path), text);
    this.onChange?.();
  }
  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.setBytes(normalize(path), data);
    this.onChange?.();
  }
  async stat(path: string): Promise<StatInfo | null> {
    const p = normalize(path);
    const f = this.files.get(p);
    if (f) return { isFile: true, isDir: false, mtimeMs: f.mtimeMs, size: f.data.length };
    if (this.dirs.has(p)) return { isFile: false, isDir: true, mtimeMs: 0, size: 0 };
    return null;
  }
  async readdir(path: string): Promise<DirEntry[]> {
    const p = normalize(path);
    if (!this.dirs.has(p)) throw new EnvError("ENOTDIR: " + path);
    const prefix = p === "/" ? "/" : p + "/";
    const seen = new Map<string, boolean>();
    for (const f of this.files.keys())
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        const i = rest.indexOf("/");
        seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
      }
    for (const d of this.dirs)
      if (d !== p && d.startsWith(prefix)) {
        const rest = d.slice(prefix.length);
        seen.set(rest.split("/")[0], true);
      }
    return [...seen].map(([name, isDir]) => ({ name, isDir }));
  }
  async mkdirp(path: string): Promise<void> {
    let d = normalize(path);
    while (d !== "/" && !this.dirs.has(d)) {
      this.dirs.add(d);
      d = dirname(d);
    }
    this.onChange?.();
  }
  async remove(path: string): Promise<void> {
    const p = normalize(path);
    this.files.delete(p);
    for (const f of [...this.files.keys()]) if (f.startsWith(p + "/")) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(p + "/")) this.dirs.delete(d);
    this.onChange?.();
  }
  async realpath(path: string): Promise<string> {
    const p = normalize(path);
    if (!this.files.has(p) && !this.dirs.has(p)) throw new EnvError("ENOENT: " + path);
    return p;
  }

  /** Toàn bộ file (đường dẫn tuyệt đối + nội dung) để lưu bền / nén zip. */
  exportEntries(): { path: string; data: Uint8Array }[] {
    return [...this.files].map(([path, f]) => ({ path, data: f.data }));
  }
  /** Nạp lại từ bản đã lưu (không phát onChange). */
  importEntries(entries: { path: string; data: Uint8Array }[]): void {
    for (const e of entries) this.setBytes(normalize(e.path), e.data);
  }
  isEmpty(): boolean {
    return this.files.size === 0;
  }

  /** Tiện ích cho giao diện/test. */
  snapshot(): Record<string, string> {
    const dec = new TextDecoder();
    const out: Record<string, string> = {};
    for (const [p, f] of this.files) out[p] = dec.decode(f.data);
    return out;
  }
  fileName(path: string): string {
    return basename(path);
  }
}
