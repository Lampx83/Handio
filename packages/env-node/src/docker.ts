// Chạy lệnh shell của agent trong container Docker (tab Code, Desktop, tuỳ chọn). Xem docs/SECURITY.md, mục "Container Docker".
//  - Gọi docker CLI bằng MẢNG đối số (không qua shell ngoài); lệnh của agent là MỘT đối số cho `sh -c` BÊN TRONG container.
//  - Chỉ gắn đúng thư mục dự án (đã realpath, kiểm ký tự) vào /workspace; không gắn home, bí mật hay socket docker.
//  - Không root, bỏ mọi capability, no-new-privileges, rootfs chỉ đọc (+ tmpfs /tmp), giới hạn CPU/RAM/số tiến trình; mạng mặc định tắt.
//  - Ảnh do cài đặt người dùng/chính sách đặt (lõi: container.ts); không bao giờ đọc ảnh từ tệp trong dự án.
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_VOLUME_RE, parseDockerSize, sanitizeImage, type CacheInfo, type CacheScope, type ContainerDecision, type DockerProbe, type ImagePullState } from "@neu/agent-core";

/** Nơi gắn thư mục dự án trong container. */
export const WORKSPACE = "/workspace";
/** Nhãn của mọi container do ứng dụng tạo (để dọn khi thoát / khi khởi động lại sau khi ứng dụng bị tắt ngang). */
export const SANDBOX_LABEL = "handio.sandbox=1";
/** Nhãn của volume cache do ứng dụng tạo. Chỉ volume có nhãn NÀY và tên khớp CACHE_VOLUME_RE mới được xoá. */
export const CACHE_LABEL = "handio.cache=1";

export interface ContainerLimits {
  cpus: number;
  memoryMb: number;
  pids: number;
  tmpMb: number;
}
export const DEFAULT_LIMITS: ContainerLimits = { cpus: 2, memoryMb: 2048, pids: 512, tmpMb: 512 };

/** Quyết định của lõi + những gì cần để gọi docker (do Desktop cấp). */
export interface ContainerChoice extends ContainerDecision {
  /** Đường dẫn tuyệt đối tới docker CLI (bắt buộc khi mode = docker). */
  docker?: string;
  limits?: ContainerLimits;
  /** Volume cache npm/pip riêng theo dự án (mặc định bật). */
  cache?: boolean;
}

export class MountError extends Error {}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/;

/**
 * Thư mục dự án ĐƯỢC PHÉP gắn vào container: realpath (theo cả symlink), không chứa ký tự làm sai tham số `--mount`
 * (dấu phẩy, nháy kép, ký tự điều khiển/xuống dòng, dấu `:` ngoài ký hiệu ổ đĩa Windows), và không quá rộng (gốc, home, nơi chứa khoá).
 */
export function checkMountSource(root: string, home: string = os.homedir()): string {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    throw new MountError("Không tìm thấy thư mục dự án để gắn vào container.");
  }
  if (!path.isAbsolute(real)) throw new MountError("Đường dẫn dự án không hợp lệ.");
  const bad = CTRL.test(real) || real.includes(",") || real.includes('"') || real.replace(/^[A-Za-z]:\\/, "").includes(":");
  if (bad) throw new MountError("Tên thư mục dự án có ký tự không dùng được với container (dấu phẩy, dấu hai chấm, nháy kép hoặc xuống dòng). Hãy đổi tên thư mục.");
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase() || "/";
  const r = norm(real);
  let h = norm(home);
  try {
    h = norm(realpathSync(home));
  } catch {
    /* home không tồn tại: so theo chuỗi */
  }
  const sep = (p: string) => p + (process.platform === "win32" ? "\\" : "/");
  const under = (base: string) => r === base || r.startsWith(sep(base));
  if (r === "/" || /^[a-z]:$/.test(r) || r === h || h.startsWith(sep(r))) throw new MountError("Thư mục dự án quá rộng để gắn vào container (gốc ổ đĩa hoặc thư mục cá nhân).");
  if ([".ssh", ".aws", ".gnupg", ".docker", ".kube", ".config", "Library"].some((x) => under(norm(path.join(h, x))))) throw new MountError("Không gắn thư mục chứa khoá/cấu hình vào container.");
  return real;
}

/** Thư mục làm việc trong container cho `cwd` (phải nằm trong dự án sau realpath; chặn `..` và symlink ra ngoài). */
export function containerWorkdir(realRoot: string, cwd: string): string {
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    throw new MountError("Thư mục chạy lệnh không tồn tại.");
  }
  const rel = path.relative(realRoot, real);
  if (rel.startsWith("..") || path.isAbsolute(rel) || CTRL.test(rel)) throw new MountError("Thư mục chạy lệnh nằm ngoài dự án.");
  return rel ? path.posix.join(WORKSPACE, ...rel.split(path.sep)) : WORKSPACE;
}

/** Volume cache (npm/pip/…) riêng cho từng dự án: cài lại nhanh mà không gắn thư mục home. */
export const cacheVolumeName = (realRoot: string): string => "handio-cache-" + createHash("sha1").update(realRoot).digest("hex").slice(0, 16);

/** Người dùng trong container: uid/gid của người dùng hiện tại (tệp tạo ra thuộc về họ trên Linux); không bao giờ là root (0). */
export function containerUser(uid = process.getuid?.(), gid = process.getgid?.()): string {
  const u = uid && uid > 0 ? uid : 1000;
  const g = gid && gid > 0 ? gid : 1000;
  return `${u}:${g}`;
}

/** Biến môi trường cố định trong container (không lấy gì từ máy của người dùng). */
export function containerEnv(cache: boolean): Record<string, string> {
  return {
    HOME: "/tmp", TERM: "dumb", LANG: "C.UTF-8", CI: "1", NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat", PYTHONUNBUFFERED: "1",
    NPM_CONFIG_UPDATE_NOTIFIER: "false", GIT_TERMINAL_PROMPT: "0", PIP_DISABLE_PIP_VERSION_CHECK: "1",
    ...(cache ? { npm_config_cache: "/cache/npm", PIP_CACHE_DIR: "/cache/pip", YARN_CACHE_FOLDER: "/cache/yarn", XDG_CACHE_HOME: "/cache/xdg" } : {}),
  };
}

export interface RunSpec {
  name: string;
  realRoot: string;
  workdir: string;
  image: string;
  command: string;
  network: boolean;
  /** Cổng xem trước mở trên 127.0.0.1 (chỉ dùng khi có mạng). */
  ports?: number[];
  user?: string;
  limits?: ContainerLimits;
  cacheVolume?: string;
  /** Tên biến lấy giá trị từ môi trường của docker CLI (`--env TÊN`, giá trị không nằm trên dòng lệnh). */
  passEnv?: string[];
}

/** Mảng đối số cho `docker run`. Thuần (không I/O) để kiểm thử được từng cờ. */
export function dockerRunArgs(s: RunSpec): string[] {
  const l = s.limits ?? DEFAULT_LIMITS;
  const env = containerEnv(!!s.cacheVolume);
  return [
    "run", "--rm", "--pull", "never",
    "--name", s.name, "--label", SANDBOX_LABEL, "--init",
    "--user", s.user ?? containerUser(),
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", `/tmp:rw,nosuid,nodev,size=${l.tmpMb}m`,
    "--network", s.network ? "bridge" : "none",
    ...(s.network ? (s.ports ?? []).flatMap((p) => ["--publish", `127.0.0.1:${p}:${p}`]) : []),
    "--cpus", String(l.cpus), "--memory", `${l.memoryMb}m`, "--memory-swap", `${l.memoryMb}m`, "--pids-limit", String(l.pids),
    "--mount", `type=bind,source=${s.realRoot},target=${WORKSPACE}`,
    ...(s.cacheVolume ? ["--mount", `type=volume,source=${s.cacheVolume},target=/cache`] : []),
    "--workdir", s.workdir,
    ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    ...(s.passEnv ?? []).flatMap((k) => ["--env", k]),
    "--entrypoint", "/bin/sh",
    s.image, "-c", s.command,
  ];
}

export const newContainerName = (): string => "handio-" + randomBytes(6).toString("hex");

/** Môi trường cho chính docker CLI (tìm socket/context/credential helper). KHÔNG truyền vào container (container chỉ nhận containerEnv + passEnv). */
const CLI_ENV = /^(PATH|HOME|USER|LOGNAME|TMPDIR|LANG|LC_ALL|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PATHEXT|USERPROFILE|USERNAME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|DOCKER_[A-Z_]+)$/i;
export function dockerCliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && CLI_ENV.test(k)) out[k] = v;
  const pathKey = Object.keys(out).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  if (process.platform !== "win32") out[pathKey] = [out[pathKey], "/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin"].filter(Boolean).join(":");
  return out;
}

/** Tìm docker CLI (ứng dụng mở từ Finder không có PATH của terminal). */
export function findDocker(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  const win = process.platform === "win32";
  const name = win ? "docker.exe" : "docker";
  const fromPath = (env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean).map((d) => path.join(d, name));
  const extra = win
    ? [path.join(env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", name)]
    : ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", path.join(home, ".docker", "bin", "docker"), "/Applications/Docker.app/Contents/Resources/bin/docker", "/usr/bin/docker"];
  for (const c of [...fromPath, ...extra]) if (path.isAbsolute(c) && existsSync(c)) return c;
  return null;
}

/** Chạy docker CLI (mảng đối số, không shell), gom đầu ra; hết giờ thì giết. */
export function runDocker(bin: string, args: string[], opts: { timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = nodeSpawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: opts.env ?? dockerCliEnv(), windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => { if (out.length < 200_000) out += b.toString("utf8"); });
    child.stderr.on("data", (b: Buffer) => { if (err.length < 200_000) err += b.toString("utf8"); });
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* đã thoát */ } };
    const timer = setTimeout(kill, opts.timeoutMs);
    opts.signal?.addEventListener("abort", kill, { once: true });
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      resolve({ code, out, err });
    };
    child.on("error", (e) => { err += e.message; finish(127); });
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** Lỗi docker rút gọn cho người dùng (không kèm đường dẫn socket/tên người dùng). */
function shortDockerError(err: string, code: number): string {
  if (/cannot connect|is the docker daemon running|daemon is not running|pipe.*docker_engine|connection refused/i.test(err)) return "Docker chưa chạy";
  if (/permission denied/i.test(err)) return "không có quyền dùng Docker";
  if (code === 127) return "không chạy được docker";
  return `docker báo lỗi (mã ${code})`;
}

/** Dò Docker: daemon có chạy không, ảnh đã có trên máy chưa. */
export async function probeDocker(bin: string | null, image: string, timeoutMs = 6000): Promise<DockerProbe> {
  if (!bin) return { ok: false, error: "không tìm thấy Docker" };
  const v = await runDocker(bin, ["version", "--format", "{{.Server.Version}}"], { timeoutMs });
  const version = v.out.trim().split("\n")[0]?.slice(0, 40);
  if (v.code !== 0 || !version) return { ok: false, error: shortDockerError(v.err, v.code) };
  const i = await runDocker(bin, ["image", "inspect", "--format", "{{.Id}}", image], { timeoutMs });
  return { ok: true, version, imagePresent: i.code === 0 };
}

const readyImages = new Set<string>();
/** Ảnh đã có trên máy chưa. Chưa có thì trả lỗi để báo người dùng: KHÔNG tự tải ngầm (người dùng bấm "Tải ảnh", xem pullImage). */
export async function ensureImage(bin: string, image: string, signal?: AbortSignal): Promise<string | null> {
  if (readyImages.has(bin + "\0" + image)) return null;
  if ((await runDocker(bin, ["image", "inspect", "--format", "{{.Id}}", image], { timeoutMs: 10_000, signal })).code !== 0) {
    return `Chưa có ảnh Docker ${image} trên máy. Mở Cài đặt → Quyền → “Tải ảnh” rồi thử lại.`;
  }
  readyImages.add(bin + "\0" + image);
  return null;
}

/** Tiến độ docker pull (không TTY: mỗi dòng "<lớp>: <trạng thái>"). Thuần để kiểm thử. */
export function pullProgress(lines: string[]): { layersDone: number; layersTotal: number } {
  const seen = new Set<string>();
  const done = new Set<string>();
  for (const l of lines) {
    const m = /^([a-f0-9]{12,64}): (.+)$/.exec(l.trim());
    if (!m) continue;
    seen.add(m[1]);
    if (/^(Pull complete|Already exists)/.test(m[2])) done.add(m[1]);
  }
  return { layersDone: done.size, layersTotal: seen.size };
}

/**
 * "Tải ảnh" do người dùng bấm: `docker pull <ảnh>` (mảng đối số; ảnh kiểm lại theo dạng tên, không thể là cờ). `onState` nhận tiến độ.
 * Hết giờ 30 phút. Trả trạng thái cuối.
 */
export async function pullImage(bin: string, image: string, onState: (s: ImagePullState) => void, signal?: AbortSignal): Promise<ImagePullState> {
  const st: ImagePullState = { image, running: true, layersDone: 0, layersTotal: 0 };
  if (sanitizeImage(image) !== image) return { ...st, running: false, ok: false, error: "Tên ảnh không hợp lệ." };
  onState({ ...st });
  const lines: string[] = [];
  const r = await new Promise<{ code: number; err: string }>((resolve) => {
    const child = nodeSpawn(bin, ["pull", image], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: dockerCliEnv(), windowsHide: true });
    let buf = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => {
      buf += b.toString("utf8");
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      if (lines.length < 5000) lines.push(...parts);
      Object.assign(st, pullProgress(lines));
      onState({ ...st });
    });
    child.stderr.on("data", (b: Buffer) => { if (err.length < 20_000) err += b.toString("utf8"); });
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* đã thoát */ } };
    const timer = setTimeout(kill, 30 * 60_000);
    signal?.addEventListener("abort", kill, { once: true });
    let done = false;
    const finish = (code: number) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", kill); resolve({ code, err }); };
    child.on("error", (e) => { err += e.message; finish(127); });
    child.on("close", (code) => finish(code ?? 1));
  });
  st.running = false;
  st.ok = r.code === 0;
  if (st.ok) {
    if (st.layersTotal) st.layersDone = st.layersTotal;
  } else {
    st.error = /not found|manifest unknown|repository does not exist|pull access denied/i.test(r.err) ? "không tìm thấy ảnh" : /timeout|network|dial tcp|no such host|TLS/i.test(r.err) ? "lỗi mạng" : shortDockerError(r.err, r.code);
  }
  onState({ ...st });
  return st;
}

/** Volume đã đổi chủ cho người dùng: khoá → thời điểm tạo của volume lúc đó ("" = khởi tạo lỗi, chạy không cache). */
const readyVolumes = new Map<string, string>();
/**
 * Volume cache theo dự án. Volume mới thuộc root nên chạy MỘT container dọn sẵn: chỉ có quyền CHOWN (mọi quyền khác bị bỏ), không mạng,
 * rootfs chỉ đọc, chỉ gắn đúng volume đó, lệnh cố định `chown` (không có gì từ agent hay dự án). Lỗi thì chạy không có cache.
 * Mỗi lần đều hỏi lại volume còn không (`volume inspect`): volume bị xoá ngoài ứng dụng (Docker Desktop, `docker volume rm`) mà để
 * `docker run` tự tạo lại thì nó thuộc root, không có nhãn, và người dùng trong container không ghi được.
 */
export async function ensureCacheVolume(bin: string, volume: string, image: string, user: string, signal?: AbortSignal): Promise<boolean> {
  const key = bin + "\0" + volume + "\0" + user;
  if (readyVolumes.get(key) === "") return false;
  const createdAt = async () => {
    const r = await runDocker(bin, ["volume", "inspect", "--format", "{{.CreatedAt}}", volume], { timeoutMs: 15_000, signal });
    return r.code === 0 ? r.out.trim() || "?" : "";
  };
  let created = await createdAt();
  if (created && readyVolumes.get(key) === created) return true;
  let ok = !!created || (await runDocker(bin, ["volume", "create", "--label", CACHE_LABEL, volume], { timeoutMs: 15_000, signal })).code === 0;
  if (ok) {
    const r = await runDocker(bin, ["run", "--rm", "--pull", "never", "--label", SANDBOX_LABEL, "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--security-opt", "no-new-privileges",
      "--user", "0:0", "--mount", `type=volume,source=${volume},target=/cache`, "--entrypoint", "chown", image, user, "/cache"], { timeoutMs: 30_000, signal });
    ok = r.code === 0;
  }
  if (ok && !created) created = (await createdAt()) || "?";
  readyVolumes.set(key, ok ? created : "");
  return ok;
}

/** Volume cache của Handio: CHỈ volume vừa có nhãn CACHE_LABEL vừa có tên dạng handio-cache-<16 hex>. null = Docker không trả lời. */
export async function listCacheVolumes(bin: string): Promise<{ name: string; bytes: number | null }[] | null> {
  const ls = await runDocker(bin, ["volume", "ls", "-q", "--filter", "label=" + CACHE_LABEL], { timeoutMs: 15_000 });
  if (ls.code !== 0) return null;
  const names = [...new Set(ls.out.split(/\s+/).filter((x) => CACHE_VOLUME_RE.test(x)))];
  const sizes = new Map<string, number | null>();
  if (names.length) {
    // dung lượng: docker system df -v (có thể chậm trên máy nhiều ảnh); lỗi thì để null, vẫn xoá được
    const df = await runDocker(bin, ["system", "df", "-v", "--format", "{{json .Volumes}}"], { timeoutMs: 30_000 });
    try {
      const vols = JSON.parse(df.out.trim() || "[]") as { Name?: unknown; Size?: unknown }[];
      if (Array.isArray(vols)) for (const v of vols) if (typeof v?.Name === "string") sizes.set(v.Name, parseDockerSize(v.Size));
    } catch {
      /* bản Docker cũ không có --format cho df -v */
    }
  }
  return names.map((name) => ({ name, bytes: sizes.get(name) ?? null }));
}

/**
 * Xoá volume cache: chỉ những tên khớp CACHE_VOLUME_RE VÀ đang có nhãn CACHE_LABEL (liệt kê lại ngay trước khi xoá), từng cái một
 * (volume đang được lệnh chạy dùng thì docker từ chối: để nguyên). Không bao giờ dùng `volume prune` hay xoá volume khác.
 */
export async function removeCacheVolumes(bin: string, names: string[]): Promise<{ removed: string[]; failed: string[] }> {
  const labeled = new Set((await listCacheVolumes(bin))?.map((v) => v.name) ?? []);
  const removed: string[] = [];
  const failed: string[] = [];
  for (const n of new Set(names)) {
    if (!CACHE_VOLUME_RE.test(n) || !labeled.has(n)) continue;
    const r = await runDocker(bin, ["volume", "rm", n], { timeoutMs: 30_000 });
    (r.code === 0 ? removed : failed).push(n);
  }
  forgetCacheVolumes(removed);
  return { removed, failed };
}

/** Tên volume cache của các dự án còn trong danh sách (theo đường dẫn đã lưu và realpath hiện tại: dự án đã đổi chỗ vẫn được nhận). */
export function knownCacheVolumes(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (typeof p !== "string" || !path.isAbsolute(p)) continue;
    out.add(cacheVolumeName(p));
    try {
      out.add(cacheVolumeName(realpathSync(p)));
    } catch {
      /* thư mục không còn: chỉ theo đường dẫn đã lưu */
    }
  }
  return out;
}

const sumBytes = (v: { bytes: number | null }[]): number | null => (v.some((x) => x.bytes === null) ? null : v.reduce((a, x) => a + (x.bytes ?? 0), 0));

/** Tóm tắt dung lượng cache (thuần): `project` = volume của dự án đang mở, `known` = volume của mọi dự án còn trong danh sách. */
export function summarizeCache(vols: { name: string; bytes: number | null }[], project: string, known: Set<string>): CacheInfo {
  const mine = vols.find((v) => v.name === project);
  const orphans = vols.filter((v) => !known.has(v.name) && v.name !== project);
  return { project: { name: project, exists: !!mine, bytes: mine ? mine.bytes : 0 }, total: { count: vols.length, bytes: sumBytes(vols) }, orphans: { count: orphans.length, bytes: sumBytes(orphans) } };
}

/** Volume sẽ xoá cho mỗi phạm vi (thuần; removeCacheVolumes còn kiểm lại tên + nhãn). */
export function cacheTargets(vols: { name: string }[], scope: CacheScope, project: string, known: Set<string>): string[] {
  const names = vols.map((v) => v.name).filter((n) => CACHE_VOLUME_RE.test(n));
  if (scope === "project") return names.filter((n) => n === project);
  if (scope === "orphans") return names.filter((n) => !known.has(n) && n !== project);
  return names;
}

/** Quên trạng thái "đã khởi tạo" của volume (sau khi xoá: lần chạy sau tạo lại + đổi chủ, nếu không docker tự tạo volume thuộc root). */
export function forgetCacheVolumes(names: string[]): void {
  for (const k of [...readyVolumes.keys()]) if (names.some((n) => k.split("\0")[1] === n)) readyVolumes.delete(k);
}

let started = 0;
/** Đã chạy container nào trong lần mở ứng dụng này (để chỉ dọn khi cần). */
export const containersStarted = (): boolean => started > 0;
export const noteContainerStarted = (): void => void started++;

/** Dừng + xoá một container theo tên (khi huỷ/hết giờ: giết docker CLI không dừng container). */
export function killContainer(bin: string, name: string): void {
  try {
    const c = nodeSpawn(bin, ["rm", "-f", name], { shell: false, stdio: "ignore", env: dockerCliEnv(), windowsHide: true });
    c.on("error", () => undefined);
  } catch {
    /* docker không còn: container (nếu có) sẽ được dọn ở lần khởi động sau */
  }
}

/** Dọn mọi container mang nhãn của ứng dụng (khi thoát, hoặc khởi động lại sau khi bị tắt ngang). Đồng bộ, có giới hạn thời gian. */
export function cleanupContainersSync(bin: string, timeoutMs = 8000): number {
  try {
    const env = dockerCliEnv();
    const ls = spawnSync(bin, ["ps", "-aq", "--filter", "label=" + SANDBOX_LABEL], { encoding: "utf8", timeout: timeoutMs, env, windowsHide: true });
    const ids = (ls.stdout ?? "").split(/\s+/).filter((x) => /^[a-f0-9]{6,64}$/.test(x));
    if (ids.length) spawnSync(bin, ["rm", "-f", ...ids], { stdio: "ignore", timeout: timeoutMs, env, windowsHide: true });
    return ids.length;
  } catch {
    return 0;
  }
}

/** Như cleanupContainersSync nhưng không chặn tiến trình chính (dùng lúc khởi động). */
export async function cleanupContainers(bin: string): Promise<number> {
  const ls = await runDocker(bin, ["ps", "-aq", "--filter", "label=" + SANDBOX_LABEL], { timeoutMs: 8000 });
  const ids = ls.out.split(/\s+/).filter((x) => /^[a-f0-9]{6,64}$/.test(x));
  if (ids.length) await runDocker(bin, ["rm", "-f", ...ids], { timeoutMs: 15_000 });
  return ids.length;
}

/** Tên biến (của hook…) được chuyển vào container: dạng tên biến thường, không trùng biến của docker CLI hay biến cố định. */
export function passableEnv(extra: Record<string, string> | undefined, realRoot: string, hostRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  const reserved = new Set(Object.keys(containerEnv(true)).map((k) => k.toUpperCase()));
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) || CLI_ENV.test(k) || reserved.has(k.toUpperCase()) || typeof v !== "string" || v.length > 100_000) continue;
    out[k] = v === hostRoot || v === realRoot ? WORKSPACE : v; // NEU_PROJECT_DIR của hook trỏ đúng thư mục trong container
  }
  return out;
}
