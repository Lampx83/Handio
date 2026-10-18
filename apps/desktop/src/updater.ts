import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkForUpdate, type LatestFile, type UpdateInfo } from "@neu/agent-core";

/**
 * Cập nhật bản Desktop: tự KIỂM TRA (khi mở và mỗi 6 giờ), nhưng chỉ TẢI khi người dùng bấm, kiểm tra mã băm SHA-256 và KHÔNG tự cài/chạy
 * (cam kết "không tự cập nhật ngầm" trong docs/RELEASE-SIGNING.md). Cài đặt chỉ xảy ra khi người dùng bấm "Cài đặt và khởi động lại"
 * (nếu máy hỗ trợ; xem installer.ts), hoặc tự mở bản đã tải.
 * Chỉ tải từ đúng thư mục tải về của máy chủ ứng dụng (https), kèm tiêu đề đăng nhập; không theo chuyển hướng.
 */
export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  current: string;
  /** Có bản mới (đã loại bản người dùng chọn "Để sau", trừ khi bắt buộc). */
  latest?: string;
  notes?: string;
  released?: string;
  /** Bản hiện tại thấp hơn mức máy chủ còn hỗ trợ: không được bỏ qua. */
  required?: boolean;
  file?: { name: string; size?: number };
  /** 0..1 khi đang tải. */
  progress?: number;
  /** Thư mục/tệp đã lưu (khi phase = ready). */
  savedPath?: string;
  /** Máy này cài thẳng được từ trong ứng dụng (nút "Cài đặt và khởi động lại"). */
  canInstall?: boolean;
  /** Bản này được tải nền: sẽ tự cài khi đóng ứng dụng. */
  auto?: boolean;
  error?: string;
  checkedAt?: number;
}

export const UPDATE_METHODS = new Set(["status", "check", "download", "dismiss", "openFolder", "install"]);
export const CHECK_INTERVAL_MS = 6 * 3600_000;
export const FIRST_CHECK_DELAY_MS = 15_000;
const MAX_BYTES = 1024 * 1024 * 1024;

export interface UpdaterDeps {
  version: string;
  platform: "mac" | "win" | "linux";
  arch: string;
  /** Thư mục tải về của máy chủ, kết thúc bằng "/" (vd https://ai.neu.edu.vn/agent/download/). Phải là https. */
  baseUrl: string;
  /** Tiêu đề đăng nhập; null = chưa đăng nhập (bỏ qua, không báo lỗi). */
  headers(): Promise<Record<string, string> | null>;
  fetch: typeof fetch;
  downloadsDir(): string;
  reveal(p: string): void;
  /** Có cài thẳng được tệp này không (đúng loại, quyền ghi). Bỏ trống = không hỗ trợ. */
  canInstall?(fileName: string): boolean;
  /** Chạy trình cài đặt trên tệp đã kiểm mã băm; true = đã chạy. relaunch=true: cài ngay và mở lại (ứng dụng sẽ thoát); false: đang đóng ứng dụng, không mở lại. */
  install?(file: string, relaunch: boolean): Promise<boolean>;
  /** Tự cập nhật đang bật (tải nền, cài khi đóng ứng dụng)? Bỏ trống = tắt. */
  auto?(): boolean;
  /** Thư mục riêng cho bản tải nền (không làm bừa thư mục Tải xuống). */
  updatesDir?(): string;
  onState(s: UpdateState): void;
  loadDismissed?(): Promise<string>;
  saveDismissed?(v: string): Promise<void>;
  now?(): number;
}

/** Ứng dụng có tự tải/cài bản mới không: bản cài từ Microsoft Store (MSIX, `process.windowsStore`) thì không, Store lo cập nhật. */
export function selfUpdateAllowed(p: { windowsStore?: boolean }): boolean {
  return p.windowsStore !== true;
}

/** Chọn tệp cài đặt hợp nền tảng/kiến trúc (macOS: đúng chip; Windows: trình cài .exe ưu tiên hơn .zip). */
export function pickFile(files: LatestFile[], platform: string, arch: string): LatestFile | undefined {
  if (platform === "mac") return files.find((f) => /mac-/i.test(f.name) && f.name.toLowerCase().includes(arch === "arm64" ? "arm64" : "x64") && /\.dmg$/i.test(f.name));
  if (platform === "win") return files.find((f) => /\.exe$/i.test(f.name)) ?? files.find((f) => /\.zip$/i.test(f.name));
  return files[0];
}

export class Updater {
  private state: UpdateState;
  private info: UpdateInfo | null = null;
  private dismissed = "";
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  /** SHA-256 mong đợi của tệp đã tải (để kiểm lại ngay trước khi cài). */
  private savedSha = "";

  constructor(private d: UpdaterDeps) {
    if (!/^https:\/\//.test(d.baseUrl) || !d.baseUrl.endsWith("/")) throw new Error("baseUrl của bộ cập nhật phải là https và kết thúc bằng '/'");
    this.state = { phase: "idle", current: d.version };
  }

  status(): UpdateState {
    return { ...this.state };
  }

  start(): void {
    const first = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    const every = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    for (const t of [first, every]) t.unref?.();
    this.timers.push(first, every);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private set(s: Partial<UpdateState>): void {
    this.state = { ...this.state, ...s };
    this.d.onState(this.status());
  }

  /** Kiểm tra bản mới. `manual`: người dùng chủ động bấm (hiện cả khi họ từng chọn "Để sau"). */
  async check(manual = false): Promise<UpdateState> {
    if (this.busy || this.state.phase === "downloading") return this.status();
    this.busy = true;
    try {
      const headers = await this.d.headers();
      if (!headers) return this.status(); // chưa đăng nhập: không kiểm tra
      if (manual) this.set({ phase: "checking", error: undefined });
      this.dismissed = (await this.d.loadDismissed?.().catch(() => "")) ?? "";
      const info = await checkForUpdate(this.d.version, this.d.fetch, { url: new URL("latest.json", this.d.baseUrl).href, platform: this.d.platform, headers });
      const checkedAt = (this.d.now ?? Date.now)();
      if (!info) {
        this.set({ phase: manual ? "error" : this.state.phase === "checking" ? "idle" : this.state.phase, error: manual ? "Không kiểm tra được bản mới lúc này. Hãy thử lại sau." : undefined, checkedAt });
        return this.status();
      }
      this.info = info;
      const hidden = info.available && !info.required && !manual && this.dismissed === info.latest;
      if (!info.available || hidden) {
        this.set({ phase: "idle", latest: info.available ? info.latest : undefined, notes: undefined, required: false, file: undefined, error: undefined, checkedAt });
        return this.status();
      }
      const f = pickFile(info.files, this.d.platform, this.d.arch);
      this.set({ phase: this.state.phase === "ready" && this.state.latest === info.latest ? "ready" : "available", latest: info.latest, notes: info.notes, released: info.released, required: info.required,
        file: f ? { name: f.name, ...(f.size ? { size: f.size } : {}) } : undefined, canInstall: !!(f && this.d.canInstall?.(f.name)), error: undefined, checkedAt });
      // tự cập nhật: tải nền ngay khi có bản mới và máy cài thẳng được (kiểm mã băm như thường; cài khi đóng ứng dụng)
      if (this.state.phase === "available" && f && this.state.canInstall && this.d.auto?.() && this.d.install && !(this.state.error)) void this.download(true);
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  async dismiss(): Promise<UpdateState> {
    if (this.info && !this.info.required) {
      this.dismissed = this.info.latest;
      await this.d.saveDismissed?.(this.dismissed).catch(() => undefined);
      this.set({ phase: "idle", notes: undefined, file: undefined });
    }
    return this.status();
  }

  openFolder(): void {
    if (this.state.savedPath) this.d.reveal(this.state.savedPath);
  }

  /** Sắp có bản cài khi đóng ứng dụng (đã tải nền xong)? Dùng để dừng gọn việc đang chạy và ghi chỗ làm tiếp trước khi thoát. */
  willInstallOnQuit(): boolean {
    return this.state.phase === "ready" && !!this.state.auto && !!this.state.canInstall && !!this.state.savedPath && !!this.savedSha && !!this.d.install;
  }

  /**
   * Gọi lúc người dùng đóng ứng dụng (will-quit): nếu có bản đã tải nền và kiểm mã băm khớp thì chạy trình cài, KHÔNG mở lại.
   * Đồng bộ (hết thời gian là ứng dụng thoát). Trả true nếu đã chạy trình cài.
   */
  installOnQuit(): boolean {
    const file = this.state.savedPath;
    if (this.state.phase !== "ready" || !this.state.auto || !this.state.canInstall || !file || !this.savedSha || !this.d.install) return false;
    try {
      const h = createHash("sha256");
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.allocUnsafe(1 << 20);
        for (;;) {
          const n = fs.readSync(fd, buf, 0, buf.length, null);
          if (!n) break;
          h.update(buf.subarray(0, n));
        }
      } finally {
        fs.closeSync(fd);
      }
      if (h.digest("hex") !== this.savedSha) return false;
    } catch {
      return false;
    }
    this.state = { ...this.state, phase: "installing" };
    void this.d.install(file, false);
    return true;
  }

  /** "Cài đặt và khởi động lại": kiểm lại mã băm của tệp đã tải rồi chạy trình cài; lỗi thì rơi về mở thư mục. */
  async install(): Promise<UpdateState> {
    const file = this.state.savedPath;
    if (this.state.phase !== "ready" || !file || !this.savedSha || !this.d.install || !this.state.canInstall) return this.status();
    try {
      const h = createHash("sha256");
      for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
      if (h.digest("hex") !== this.savedSha) {
        await fs.promises.rm(file, { force: true }).catch(() => undefined);
        this.set({ phase: "error", savedPath: undefined, canInstall: false, error: "Tệp đã tải bị thay đổi sau khi kiểm tra nên đã bị xoá. Hãy tải lại." });
        return this.status();
      }
    } catch {
      this.set({ phase: "error", savedPath: undefined, canInstall: false, error: "Không đọc được tệp đã tải. Hãy tải lại." });
      return this.status();
    }
    this.set({ phase: "installing", error: undefined });
    let ok = false;
    try {
      ok = await this.d.install(file, true);
    } catch {
      ok = false;
    }
    if (!ok) {
      this.set({ phase: "ready", canInstall: false, error: "Chưa tự cài được. Hãy đóng ứng dụng rồi mở tệp vừa tải." });
      this.d.reveal(file);
    }
    return this.status();
  }

  /** Tải bản cài về thư mục Tải xuống, kiểm tra kích thước và SHA-256 theo latest.json, rồi báo sẵn sàng. */
  async download(auto = false): Promise<UpdateState> {
    const info = this.info;
    const f = info && info.available ? pickFile(info.files, this.d.platform, this.d.arch) : undefined;
    if (!info || !f) {
      this.set({ phase: "error", error: "Chưa có tệp cài đặt phù hợp với máy này trên máy chủ." });
      return this.status();
    }
    if (this.state.phase === "downloading") return this.status();
    const bg = auto && !!this.d.updatesDir;
    const dir = bg ? this.d.updatesDir!() : this.d.downloadsDir();
    if (bg) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined); // bản tải nền cũ không giữ lại
    const part = path.join(dir, f.name + ".part");
    const final = path.join(dir, f.name);
    this.set({ phase: "downloading", progress: 0, error: undefined });
    let fh: fs.promises.FileHandle | undefined;
    try {
      const headers = await this.d.headers();
      if (!headers) throw new Error("Cần đăng nhập để tải bản cập nhật.");
      const r = await this.d.fetch(new URL(encodeURIComponent(f.name), this.d.baseUrl).href, { headers, redirect: "error" });
      if (!r.ok || !r.body) throw new Error(r.status === 401 || r.status === 403 ? "Phiên đăng nhập đã hết hạn: hãy đăng nhập lại rồi thử lại." : `Máy chủ trả lỗi ${r.status}.`);
      if (/html/i.test(r.headers.get("content-type") ?? "")) throw new Error("Máy chủ trả về trang web thay vì tệp cài đặt (có thể cần đăng nhập lại).");
      const total = f.size ?? (Number(r.headers.get("content-length")) || 0);
      if (total > MAX_BYTES) throw new Error("Tệp lớn bất thường, đã dừng.");
      await fs.promises.mkdir(dir, { recursive: true });
      fh = await fs.promises.open(part, "w", 0o600);
      const hash = createHash("sha256");
      let got = 0;
      let lastEmit = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        if (got > MAX_BYTES) throw new Error("Tệp lớn bất thường, đã dừng.");
        hash.update(value);
        await fh.write(value);
        const t = Date.now();
        if (total && t - lastEmit > 250) {
          lastEmit = t;
          this.set({ progress: Math.min(got / total, 0.99) });
        }
      }
      await fh.close();
      fh = undefined;
      if (f.size && got !== f.size) throw new Error("Tải chưa đủ hoặc bị lỗi (kích thước không khớp). Hãy thử lại.");
      if (hash.digest("hex") !== f.sha256) throw new Error("Mã băm SHA-256 không khớp: tệp có thể bị hỏng hoặc bị thay đổi. Đã xoá, KHÔNG dùng tệp này.");
      await fs.promises.rename(part, final);
      this.savedSha = f.sha256;
      const direct = !!this.d.install && !!this.d.canInstall?.(f.name);
      this.set({ phase: "ready", progress: 1, savedPath: final, canInstall: direct, auto: bg && direct });
      if (!direct && !bg) this.d.reveal(final); // không cài thẳng được: mở thư mục để người dùng tự mở tệp
    } catch (e) {
      await fh?.close().catch(() => undefined);
      await fs.promises.rm(part, { force: true }).catch(() => undefined);
      this.set({ phase: "error", progress: undefined, error: e instanceof Error ? e.message.slice(0, 300) : "Tải không thành công." });
    }
    return this.status();
  }
}
