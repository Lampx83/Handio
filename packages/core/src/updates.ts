/**
 * Nhận biết bản cập nhật cho Desktop: đọc `latest.json` (do deploy/220/make-latest.sh tạo từ SHA256SUMS.txt + phiên bản gói).
 * Chỉ BÁO có bản mới + mã băm để người dùng so; không tự tải, không tự cài. Không bao giờ ném lỗi.
 *
 * Định dạng latest.json: { "version": "0.2.0", "released": "2026-10-08", "notes": "…", "files": { "NEU-Agent-0.2.0-win-x64.exe": { "sha256": "<64 hex>", "size": 123 } } }
 */
export interface LatestFile {
  name: string;
  sha256: string;
  size?: number;
}
export interface UpdateInfo {
  available: boolean;
  current: string;
  latest: string;
  notes: string;
  released?: string;
  /** Các tệp cài đặt phù hợp nền tảng (hoặc tất cả nếu không chỉ định). */
  files: LatestFile[];
}

const VER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z.]{1,16}))?$/;

/** So sánh phiên bản dạng semver đơn giản (bản có hậu tố -beta < bản chính). Trả về <0, 0, >0. null nếu không hợp lệ. */
export function compareVersions(a: string, b: string): number | null {
  const x = VER.exec(a);
  const y = VER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  return x[4] < y[4] ? -1 : 1;
}

const PLATFORM_PATTERN: Record<string, RegExp> = {
  win: /win/i,
  mac: /mac/i,
  linux: /linux/i,
};

/**
 * @param currentVersion phiên bản đang chạy, vd "0.1.0"
 * @param fetchFn        fetch của môi trường (Desktop: kèm tiêu đề đăng nhập qua `opts.headers`)
 * @param opts.url       mặc định https://ai.neu.edu.vn/agent/download/latest.json
 * @param opts.platform  "mac" | "win" | "linux": lọc danh sách tệp
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchFn: typeof fetch,
  opts: { url?: string; platform?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<UpdateInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 8000);
  (timer as { unref?: () => void }).unref?.();
  try {
    const r = await fetchFn(opts.url ?? "https://ai.neu.edu.vn/agent/download/latest.json", { headers: { Accept: "application/json", ...(opts.headers ?? {}) }, redirect: "error", signal: ctl.signal });
    if (!r.ok) return null;
    if (/html/i.test(r.headers?.get?.("content-type") ?? "")) return null;
    const j = (await r.json()) as Record<string, unknown>;
    const latest = typeof j.version === "string" ? j.version : "";
    const cmp = compareVersions(latest, currentVersion);
    if (cmp === null) return null;
    const files: LatestFile[] = [];
    const rawFiles = j.files && typeof j.files === "object" && !Array.isArray(j.files) ? (j.files as Record<string, unknown>) : {};
    const pat = opts.platform ? PLATFORM_PATTERN[opts.platform] : undefined;
    for (const [name, v] of Object.entries(rawFiles).slice(0, 20)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) || !v || typeof v !== "object") continue;
      const f = v as Record<string, unknown>;
      if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) continue;
      if (pat && !pat.test(name)) continue;
      files.push({ name, sha256: f.sha256, ...(typeof f.size === "number" && f.size > 0 ? { size: f.size } : {}) });
    }
    return {
      available: cmp > 0,
      current: currentVersion,
      latest,
      notes: typeof j.notes === "string" ? j.notes.slice(0, 2000) : "",
      released: typeof j.released === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.released) ? j.released : undefined,
      files,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
