/**
 * Feedback Hub (https://github.com/Lampx83/FeedbackHub) cho bản web: MẶC ĐỊNH TẮT. Máy chủ chỉ trả token khi đã cấu hình hub (docs/FEEDBACKHUB.md).
 * Có hub thì nút "Góp ý" mở widget của hub; không có (hoặc hub lỗi/khác nguồn) thì vẫn dùng hộp góp ý cũ (feedback-ui.ts).
 * Widget phải CÙNG NGUỒN với ứng dụng (CSP của trang là `script-src 'self'; connect-src 'self'`), nên hub được đặt sau cùng tên miền
 * (vd. /agent/feedbackhub): không nới CSP, không gọi sang tên miền lạ.
 */
type Hub = { init: (o: Record<string, unknown>) => unknown; open: () => unknown; __loaded?: boolean };
type HubWindow = Window & { FeedbackHub?: Hub };

export type HubInfo = { hub: string; project: string };

/** Chỉ nhận hub cùng nguồn với ứng dụng; trả về địa chỉ chuẩn (không dấu / cuối) hoặc null. */
export function sameOriginHub(hub: unknown, pageUrl: string): string | null {
  if (typeof hub !== "string") return null;
  try {
    const u = new URL(hub, pageUrl);
    if (u.origin !== new URL(pageUrl).origin || u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface HubDeps {
  fetchImpl?: typeof fetch;
  loadScript?: (src: string) => Promise<void>;
  win?: HubWindow;
  pageUrl?: string;
}

const loadScriptDom = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("widget"));
    document.head.append(s);
  });

/** Nạp widget nếu máy chủ bật hub. Không bao giờ ném lỗi; trả true khi widget đã sẵn sàng. */
export async function initFeedbackHub(tokenUrl: string, ctx: () => Record<string, string> = () => ({}), deps: HubDeps = {}): Promise<boolean> {
  try {
    const win = deps.win ?? (window as HubWindow);
    const pageUrl = deps.pageUrl ?? location.href;
    const r = await (deps.fetchImpl ?? fetch)(tokenUrl, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: boolean; hub?: unknown; project?: unknown };
    const hub = sameOriginHub(j.hub, pageUrl);
    if (!j.ok || !hub || typeof j.project !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(j.project)) return false;
    await (deps.loadScript ?? loadScriptDom)(`${hub}/widget.js`);
    const fh = win.FeedbackHub;
    if (!fh) return false;
    fh.init({ project: j.project, hub, tokenUrl, fab: false, locale: "vi", getContext: () => ({ extra: ctx() }) });
    fh.__loaded = true;
    return true;
  } catch {
    return false;
  }
}

/** Mở widget của hub nếu đã nạp; trả false nếu chưa (khi đó dùng hộp góp ý cũ). */
export function openHubFeedback(win: HubWindow = window as HubWindow): boolean {
  const fh = win.FeedbackHub;
  if (!fh?.__loaded) return false;
  fh.open();
  return true;
}
