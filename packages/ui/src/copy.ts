// Sao chép vào clipboard + nút chỉ có biểu tượng.
// Bản Desktop từ chối mọi quyền của trang (setPermissionRequestHandler/CheckHandler = false) nên navigator.clipboard.writeText bị chặn:
// phải có đường dự phòng bằng execCommand("copy") (cần thao tác của người dùng, không cần quyền). Ô tạm phải nằm TRONG hộp thoại modal đang mở
// (phần còn lại của trang bị vô hiệu khi modal mở thì không chọn/sao chép được).
import { h } from "./dom";

export const COPY_ICON = '<svg class="ic ic-copy" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.2V3.1A1.6 1.6 0 0 0 8.9 1.5H3.6A1.6 1.6 0 0 0 2 3.1v5.3a1.6 1.6 0 0 0 1.6 1.6h.1"/></svg>';
export const CHECK_ICON = '<svg class="ic ic-check" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';

export async function copyText(text: string, host?: Element | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* bị chặn quyền: dùng đường dự phòng */
  }
  const root = host ?? document.querySelector("dialog[open]") ?? document.body;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const prev = document.activeElement as HTMLElement | null;
  root.append(ta);
  let ok = false;
  try {
    ta.focus();
    ta.select();
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  try {
    prev?.focus?.();
  } catch {
    /* bỏ qua */
  }
  return ok;
}

/** Hiện dấu ✓ ở nút trong ~1,5 giây (hoặc báo lỗi nhẹ). */
export function flashCopied(btn: HTMLElement, ok: boolean): void {
  btn.classList.toggle("copied", ok);
  btn.classList.toggle("copy-failed", !ok);
  window.setTimeout(() => btn.classList.remove("copied", "copy-failed"), 1500);
}

/** Nút sao chép chỉ có biểu tượng. `onDone` nhận kết quả để hiện thông báo riêng nếu cần. */
export function copyButton(getText: () => string, o: { label?: string; primary?: boolean; onDone?: (ok: boolean) => void } = {}): HTMLButtonElement {
  const label = o.label ?? "Sao chép";
  const b = h("button", { class: "btn icon-copy sm" + (o.primary ? " primary" : ""), type: "button", title: label, "aria-label": label, html: COPY_ICON + CHECK_ICON }) as HTMLButtonElement;
  b.addEventListener("click", async () => {
    const ok = await copyText(getText(), b.closest("dialog"));
    flashCopied(b, ok);
    o.onDone?.(ok);
  });
  return b;
}
