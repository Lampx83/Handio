/**
 * Chạy lệnh shell của tab Code trong container Docker (tuỳ chọn, chỉ Desktop). Ở đây chỉ là logic THUẦN (không Node):
 * kiểm tra ảnh/cổng và quyết định "chạy trong container / chạy như cũ / từ chối" từ cài đặt người dùng + chính sách + kết quả dò Docker.
 * Phần gọi docker thật nằm ở packages/env-node/src/docker.ts. Xem docs/SECURITY.md (mục "Container Docker").
 *
 * Nguyên tắc: ảnh chỉ đến từ cài đặt người dùng hoặc chính sách, KHÔNG BAO GIỜ từ tệp trong thư mục dự án (repo lạ không được chọn ảnh);
 * Docker không chạy thì quay về cách cũ và nói rõ; chính sách bắt buộc container thì từ chối thay vì hạ cấp.
 */
import type { Policy } from "./policy";

/**
 * Ảnh mặc định: ảnh chính thức `node:22-bookworm` (bản đầy đủ, ~400 MB tải về, ~1,1 GB trên đĩa): Node 22 + npm, Python 3.11, gcc/make, git, curl.
 * Không có ảnh chính thức nào có sẵn cả Node lẫn pip/venv; Python của Debian ở đây thiếu pip/ensurepip nên venv tạo bằng `--without-pip`
 * rồi cài pip khi có mạng (PIP_BOOTSTRAP). Bản `-slim` trước đây không có Python.
 */
export const DEFAULT_CONTAINER_IMAGE = "node:22-bookworm";
/** Mô tả ngắn của ảnh mặc định (Cài đặt, /status). */
export const DEFAULT_IMAGE_INFO = { tools: "Node 22 + Python 3", downloadMb: 400 };
/** Tạo venv trong dự án và cài pip (cần mạng) cho ảnh mặc định. Dùng nguyên văn trong lời nhắc hệ thống và bài thử Docker thật. */
export const PIP_BOOTSTRAP = "python3 -m venv --without-pip .venv && curl -fsSL -o /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py && .venv/bin/python /tmp/get-pip.py -q";
/** Số cổng xem trước tối đa (mỗi cổng mở `127.0.0.1:P -> P` của container chạy nền). */
export const MAX_PREVIEW_PORTS = 5;
/** Tên volume cache của Handio (chỉ những volume khớp tên NÀY và có nhãn cache mới được liệt kê/xoá). */
export const CACHE_VOLUME_RE = /^handio-cache-[a-f0-9]{16}$/;
/** Phạm vi "Xoá cache": dự án đang mở, mọi volume của Handio, hoặc chỉ volume của dự án đã bỏ khỏi danh sách. */
export const CACHE_SCOPES = ["project", "all", "orphans"] as const;
export type CacheScope = (typeof CACHE_SCOPES)[number];

/** Tên ảnh Docker: [máy-chủ[:cổng]/]tên[/tên…][:thẻ][@sha256:…]. Không bắt đầu bằng "-" (không thể bị hiểu thành cờ của docker). */
const IMAGE_RE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

export function sanitizeImage(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= 200 && IMAGE_RE.test(v) ? v : undefined;
}

/** Cổng xem trước hợp lệ: số nguyên 1024–65535, không trùng, tối đa MAX_PREVIEW_PORTS. */
export function sanitizePorts(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const p of v) if (Number.isInteger(p) && p >= 1024 && p <= 65535 && !out.includes(p) && out.length < MAX_PREVIEW_PORTS) out.push(p);
  return out;
}

/** Kết quả dò Docker (do Desktop làm: `docker version`, `docker image inspect`). */
export interface DockerProbe {
  ok: boolean;
  version?: string;
  /** Lý do không dùng được (đã rút gọn, không chứa đường dẫn người dùng). */
  error?: string;
  /** Ảnh đã có trên máy (chưa có thì người dùng bấm "Tải ảnh"; ứng dụng không tự tải ngầm). */
  imagePresent?: boolean;
}

/** Tiến độ "Tải ảnh" (docker pull do người dùng bấm). */
export interface ImagePullState {
  image: string;
  running: boolean;
  /** Số lớp đã xong / đã thấy (docker pull không có TTY chỉ báo theo lớp). */
  layersDone: number;
  layersTotal: number;
  ok?: boolean;
  error?: string;
}

/** Dung lượng cache container (volume `handio-cache-*`). Byte = null khi Docker không báo được. */
export interface CacheInfo {
  /** Volume của dự án đang mở (exists=false: chưa tạo). */
  project: { name: string; exists: boolean; bytes: number | null };
  total: { count: number; bytes: number | null };
  /** Volume của dự án không còn trong danh sách dự án nào. */
  orphans: { count: number; bytes: number | null };
}

/** Phân tích dung lượng kiểu docker ("3.122MB", "0B", "1.2GB"; hệ 1000). Không hiểu được thì null. */
export function parseDockerSize(v: unknown): number | null {
  const m = typeof v === "string" ? /^\s*([\d.]+)\s*([kKMGTP]?i?)B\s*$/.exec(v) : null;
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase().replace("I", "");
  const pow = unit ? "KMGTP".indexOf(unit) + 1 : 0;
  return Math.round(n * (m[2].toLowerCase().endsWith("i") ? 1024 : 1000) ** pow);
}

/** Công cụ có trong ảnh (để lời nhắc hệ thống nói đúng). Chỉ biết ảnh mặc định; ảnh khác: không đoán. */
export function imageToolsHint(image: string | undefined): string {
  if (image !== DEFAULT_CONTAINER_IMAGE) return "";
  return ` The image has Node 22 + npm, Python 3.11 (python3), gcc/make, git and curl. Python's pip/ensurepip are NOT installed: plain \`python3 -m venv .venv\` fails; with network on, create the venv and install pip in one command: \`${PIP_BOOTSTRAP}\`, then use \`.venv/bin/pip install ...\` and \`.venv/bin/python\`. Never try apt-get or sudo (read-only, non-root).`;
}

export interface ContainerDecision {
  /** docker: chạy trong container; host: như cũ (sandbox hệ điều hành nếu có); refuse: không chạy. */
  mode: "docker" | "host" | "refuse";
  /** Người dùng bật hoặc chính sách bắt buộc. */
  wanted: boolean;
  /** Chính sách quản trị bắt buộc (`requireContainer`). */
  required: boolean;
  image: string;
  network: boolean;
  /** Cổng xem trước (chỉ khi có mạng). */
  ports: number[];
  /** Lý do quay về cách cũ / từ chối (để báo cho người dùng). */
  reason?: string;
}

/** Trạng thái hiển thị trong Cài đặt (tab Code). */
export interface SandboxStatus extends ContainerDecision {
  docker: DockerProbe;
  /** Chính sách tắt mạng của lệnh (`bashNetwork:false`): không bật mạng/cổng được. */
  networkLocked: boolean;
  /** "Tải ảnh" đang chạy hoặc vừa xong (null = chưa bấm). */
  pull?: ImagePullState | null;
}

/** Phần Desktop cấp cho bộ điều khiển (tab Code). `root` = thư mục dự án đang mở (để tìm volume cache của nó). */
export interface SandboxHost {
  status(): Promise<SandboxStatus>;
  /** Tải ĐÚNG ảnh đang cấu hình (cài đặt người dùng/chính sách; không nhận tên ảnh từ giao diện). Trả ngay, tiến độ qua pullStatus. */
  pullImage?(): Promise<ImagePullState>;
  pullStatus?(): ImagePullState | null;
  cacheInfo?(root: string): Promise<CacheInfo | null>;
  clearCache?(root: string, scope: CacheScope): Promise<{ ok: boolean; message: string }>;
}

export interface ContainerSettings {
  container?: boolean;
  containerNetwork?: boolean;
  containerPorts?: number[];
  containerImage?: string;
}

/** Ảnh sẽ dùng: chính sách > cài đặt người dùng > mặc định. Giá trị không hợp lệ bị bỏ qua. */
export function containerImage(s: ContainerSettings, p: Policy | undefined): string {
  return sanitizeImage(p?.containerImage) ?? sanitizeImage(s.containerImage) ?? DEFAULT_CONTAINER_IMAGE;
}

/**
 * Quyết định cách chạy lệnh. `probe=null` nghĩa là chưa dò / không có Docker CLI.
 * Chỉ đọc `ContainerSettings` (cài đặt NGƯỜI DÙNG); cấu hình dự án không bao giờ được truyền vào đây.
 */
export function decideContainer(s: ContainerSettings, p: Policy | undefined, probe: DockerProbe | null): ContainerDecision {
  const required = p?.requireContainer === true;
  const wanted = required || s.container === true;
  const network = wanted && s.containerNetwork === true && p?.bashNetwork !== false;
  const base = { wanted, required, image: containerImage(s, p), network, ports: network ? sanitizePorts(s.containerPorts) : [] };
  if (!wanted) return { ...base, mode: "host" };
  if (probe?.ok && probe.imagePresent !== false) return { ...base, mode: "docker" };
  if (probe?.ok) {
    // chưa có ảnh: KHÔNG tự tải ngầm (vài trăm MB); người dùng bấm "Tải ảnh" trong Cài đặt
    const where = "Cài đặt → Quyền → “Tải ảnh”";
    if (required) return { ...base, mode: "refuse", reason: `Quản trị viên yêu cầu chạy lệnh trong container Docker nhưng máy chưa có ảnh ${base.image}. Mở ${where} rồi thử lại.` };
    return { ...base, mode: "host", reason: `Chưa có ảnh Docker ${base.image} (${where}): lệnh đang chạy trực tiếp trên máy, không trong container.` };
  }
  const why = probe?.error || "không tìm thấy Docker";
  if (required) return { ...base, mode: "refuse", reason: `Quản trị viên yêu cầu chạy lệnh trong container Docker nhưng Docker không dùng được (${why}). Hãy mở Docker Desktop rồi thử lại.` };
  return { ...base, mode: "host", reason: `Docker không dùng được (${why}): lệnh đang chạy trực tiếp trên máy, không trong container.` };
}
