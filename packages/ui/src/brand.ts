import { BRAND_MARK_SVG } from "./brand-mark.generated";

/** Bàn tay Hando (SVG nhúng sẵn, hằng số tin cậy). Vẫy tay khi rê chuột (CSS .brand-mark). `size` = chiều cao px. */
export function brandMark(size = 22, wave = false): HTMLElement {
  const el = document.createElement("span");
  el.className = "brand-mark" + (wave ? " wave" : "");
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--bm", size + "px");
  el.innerHTML = BRAND_MARK_SVG;
  return el;
}
