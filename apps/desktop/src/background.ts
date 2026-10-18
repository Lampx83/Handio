// Chạy nền ở khay hệ thống / thanh menu để tác vụ định kỳ vẫn chạy khi đóng cửa sổ. Các hàm THUẦN (không phụ thuộc Electron) để kiểm thử;
// main.ts nối chúng với Tray, Menu, BrowserWindow, app.setLoginItemSettings. Xem docs/SECURITY.md (Tác vụ định kỳ).
import { nextRun, type ScheduledTask } from "@neu/agent-core";

/** Lựa chọn của người dùng (lưu ở <userData>/background.json). Mặc định TẮT hết. */
export interface BackgroundPrefs {
  /** Đóng cửa sổ thì giữ ứng dụng chạy nền ở khay (chỉ có hiệu lực khi có tác vụ đang bật). */
  keep: boolean;
  /** Mở cùng máy (ẩn ở khay). Chỉ bật được khi `keep` bật. */
  atLogin: boolean;
  /** Đã báo "vẫn chạy ở khay" lần đầu chưa (chỉ báo một lần). */
  told: boolean;
}

export const DEFAULT_PREFS: BackgroundPrefs = { keep: false, atLogin: false, told: false };

/** Đọc tệp lựa chọn: chỉ nhận đúng `true`, còn lại coi như tắt. */
export function readPrefs(raw: unknown): BackgroundPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const keep = r.keep === true;
  return { keep, atLogin: keep && r.atLogin === true, told: r.told === true };
}

/** Áp thay đổi từ giao diện: tắt chạy nền thì tắt luôn "Mở cùng máy"; không hỗ trợ mở cùng máy thì luôn tắt. */
export function applyPatch(prev: BackgroundPrefs, patch: { keep?: boolean; atLogin?: boolean }, atLoginSupported: boolean): BackgroundPrefs {
  const keep = patch.keep ?? prev.keep;
  const atLogin = atLoginSupported && keep && (patch.atLogin ?? prev.atLogin);
  return { keep, atLogin, told: prev.told };
}

/** Có tác vụ nào đang bật và còn lịch chạy không (mọi tab). */
export const hasActiveTasks = (tasks: ScheduledTask[], now: number): boolean => tasks.some((t) => t.enabled && nextRun(t, now) !== undefined);

/** Chạy nền đang có hiệu lực: người dùng đã bật VÀ có tác vụ để chạy. Kiểm thử đầu-cuối không bao giờ chạy nền. */
export const keepEffective = (o: { keep: boolean; hasTasks: boolean; smoke: boolean }): boolean => !o.smoke && o.keep && o.hasTasks;

/** Bấm đóng cửa sổ: ẩn xuống khay (chạy nền) hay đóng thật. Đang thoát hẳn (menu Thoát, Cmd+Q, cài bản cập nhật) thì luôn đóng thật. */
export function closeAction(o: { quitting: boolean; keep: boolean; hasTasks: boolean; smoke: boolean }): "hide" | "close" {
  return !o.quitting && keepEffective(o) ? "hide" : "close";
}

/** Lúc khởi động: mở ẩn ở khay khi được hệ điều hành mở cùng máy và chạy nền có hiệu lực; còn lại hiện cửa sổ như thường. */
export function startHidden(o: { keep: boolean; hasTasks: boolean; smoke: boolean; openedAtLogin: boolean }): boolean {
  return o.openedAtLogin && keepEffective(o);
}

/** Tham số dòng lệnh đánh dấu "mở cùng máy" (Windows; macOS dùng app.getLoginItemSettings().wasOpenedAtLogin). */
export const HIDDEN_ARG = "--background";

/** "Mở cùng máy" chỉ có ở bản cài thật trên macOS/Windows (không ở bản dev — sẽ đăng ký nhầm Electron —, không ở Microsoft Store, không trong kiểm thử). */
export const atLoginSupported = (o: { platform: string; packaged: boolean; windowsStore: boolean; smoke: boolean }): boolean =>
  !o.smoke && o.packaged && !o.windowsStore && (o.platform === "darwin" || o.platform === "win32");

/** Tham số cho app.setLoginItemSettings. */
export function loginItemFor(on: boolean, platform: string): { openAtLogin: boolean; args?: string[] } {
  return platform === "win32" ? { openAtLogin: on, args: [HIDDEN_ARG] } : { openAtLogin: on };
}

/** Tên tác vụ cho menu khay: một dòng, cắt ngắn (menu khay không hiện nội dung, kết quả hay tên tệp). */
export function shortName(name: string, max = 28): string {
  const one = name.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** "08:00" (hôm nay), "mai 08:00", "08:00 20/10" — giờ máy. */
export function shortWhen(ts: number, now: number): string {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(d) === day(new Date(now))) return hm;
  if (day(d) === day(tomorrow)) return "mai " + hm;
  return `${hm} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** Dòng "tác vụ kế tiếp" trong menu khay. */
export function nextTaskLabel(tasks: ScheduledTask[], now: number): string {
  let best: { t: ScheduledTask; at: number } | null = null;
  for (const t of tasks) {
    const at = nextRun(t, now);
    if (at !== undefined && (!best || at < best.at)) best = { t, at };
  }
  if (!best) return "Không có tác vụ sắp chạy";
  return `Kế tiếp: ${shortName(best.t.name)} · ${best.at <= now ? "sắp chạy" : shortWhen(best.at, now)}`;
}

export type TrayItem =
  | { id: "open"; label: string }
  | { id: "next"; label: string }
  | { id: "signin"; label: string }
  | { id: "pause"; label: string; checked: boolean }
  | { id: "quit"; label: string }
  | { id: "sep" };

/** Mô hình menu khay (main.ts dựng thành Menu của Electron). */
export function trayMenu(o: { brand: string; tasks: ScheduledTask[]; now: number; paused: boolean; signedIn: boolean }): TrayItem[] {
  return [
    { id: "open", label: `Mở ${o.brand}` },
    { id: "sep" },
    { id: "next", label: nextTaskLabel(o.tasks, o.now) },
    ...(o.signedIn ? [] : [{ id: "signin" as const, label: "Cần đăng nhập lại để chạy tác vụ" }]),
    { id: "pause", label: "Tạm dừng tác vụ", checked: o.paused },
    { id: "sep" },
    { id: "quit", label: "Thoát hẳn" },
  ];
}

/**
 * Phiên đăng nhập hết hạn khi đang chạy nền: tác vụ đến hạn bị bỏ qua (lõi không chạy khi chưa đăng nhập) và báo MỘT lần cho mỗi lần mất đăng nhập.
 * Không bao giờ tự mở trình duyệt đăng nhập: người dùng mở cửa sổ rồi tự đăng nhập. Trả về có báo không và trạng thái "đã báo" mới.
 */
export function authNotice(o: { signedIn: boolean; dueCount: number; notified: boolean }): { notify: boolean; notified: boolean } {
  if (o.signedIn) return { notify: false, notified: false };
  if (o.dueCount > 0 && !o.notified) return { notify: true, notified: true };
  return { notify: false, notified: o.notified };
}
