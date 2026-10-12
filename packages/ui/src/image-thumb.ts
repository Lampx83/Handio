// Ảnh thu nhỏ cho ô nhập và tin nhắn. CSP chỉ cho img-src 'self' data:, nên dùng data: URL (không blob:).
// Thu về cạnh dài ≤ max bằng canvas (JPEG) cho nhẹ DOM; môi trường không có canvas thì dùng thẳng data URL gốc.

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
export const mimeOfName = (name: string): string => MIME[(/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? "").toLowerCase()] ?? "image/png";

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function thumbDataUrl(blob: Blob, max = 480): Promise<string> {
  const raw = await readDataUrl(blob);
  try {
    const img = new Image();
    img.src = raw;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
    if (k >= 1 && blob.size < 400_000) return raw;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext("2d");
    if (!g) return raw;
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return raw;
  }
}

/** Tham chiếu ảnh dán ở đầu/giữa tin nhắn: `@dan/<tên>` (ngoài dự án) hoặc `@.neuagent/pasted/<tên>` (bản web). */
export const PASTED_REF = /(^|\s)@((?:dan|\.neuagent\/pasted)\/[^\s]+?\.(?:png|jpe?g|webp|gif))(?=\s|$)/gi;

export function splitPastedRefs(text: string): { refs: string[]; body: string } {
  const refs: string[] = [];
  const body = text.replace(PASTED_REF, (_m, pre: string, r: string) => (refs.push(r), pre)).replace(/[ \t]{2,}/g, " ").trim();
  return { refs, body };
}
