import { brandText } from "@neu/agent-core";
import { BRAND_MARK_SVG } from "./brand-mark.generated";

/** Bàn tay Handio (SVG nhúng sẵn, hằng số tin cậy). Vẫy tay khi rê chuột (CSS .brand-mark). `size` = chiều cao px. */
export function brandMark(size = 22, wave = false): HTMLElement {
  const el = document.createElement("span");
  el.className = "brand-mark" + (wave ? " wave" : "");
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--bm", size + "px");
  el.innerHTML = brandText(BRAND_MARK_SVG);
  return el;
}
