/**
 * Chạy lệnh shell của tab Code trong container Docker (tuỳ chọn, chỉ Desktop). Ở đây chỉ là logic THUẦN (không Node):
 * kiểm tra ảnh/cổng và quyết định "chạy trong container / chạy như cũ / từ chối" từ cài đặt người dùng + chính sách + kết quả dò Docker.
 * Phần gọi docker thật nằm ở packages/env-node/src/docker.ts. Xem docs/SECURITY.md (mục "Container Docker").
 *
 * Nguyên tắc: ảnh chỉ đến từ cài đặt người dùng hoặc chính sách, KHÔNG BAO GIỜ từ tệp trong thư mục dự án (repo lạ không được chọn ảnh);
 * Docker không chạy thì quay về cách cũ và nói rõ; chính sách bắt buộc container thì từ chối thay vì hạ cấp.
 */
import type { Policy } from "./policy";

export const DEFAULT_CONTAINER_IMAGE = "node:22-bookworm-slim";
/** Số cổng xem trước tối đa (mỗi cổng mở `127.0.0.1:P -> P` của container chạy nền). */
export const MAX_PREVIEW_PORTS = 5;

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
  /** Ảnh đã có trên máy (chưa có thì lần chạy đầu sẽ tải về). */
  imagePresent?: boolean;
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
  if (probe?.ok) return { ...base, mode: "docker" };
  const why = probe?.error || "không tìm thấy Docker";
  if (required) return { ...base, mode: "refuse", reason: `Quản trị viên yêu cầu chạy lệnh trong container Docker nhưng Docker không dùng được (${why}). Hãy mở Docker Desktop rồi thử lại.` };
  return { ...base, mode: "host", reason: `Docker không dùng được (${why}): lệnh đang chạy trực tiếp trên máy, không trong container.` };
}
