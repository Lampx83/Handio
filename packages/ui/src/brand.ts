import { brandName, brandText, productName } from "@neu/agent-core";
import { BRAND_MARK_SVG } from "./brand-mark.generated";

/** Biểu tượng chữ N của NEU Agent (bản triển khai tại Trường ĐH Kinh tế Quốc dân): ô vuông bo góc xanh, chữ N trắng, gạch chân vàng. */
const NEU_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 64 896 896" width="64" height="64" role="img" aria-label="NEU Agent"><defs><linearGradient id="nm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1665d8"/><stop offset="1" stop-color="#0a2f6e"/></linearGradient></defs>' +
  '<rect x="64" y="64" width="896" height="896" rx="200" fill="url(#nm-g)"/><path d="M312 706V318h74l214 258V318h74v388h-74L386 448v258z" fill="#fff"/><rect x="312" y="770" width="400" height="26" rx="13" fill="#f2b134"/></svg>';

/**
 * Biểu tượng thương hiệu: bàn tay Handio khi chạy dưới tên "Handio"; chữ N khi triển khai dưới tên khác (mặc định "NEU Agent").
 * SVG nhúng sẵn, hằng số tin cậy. Bàn tay vẫy khi rê chuột (CSS .brand-mark). `size` = chiều cao px.
 */
let markSeq = 0;
export function brandMark(size = 22, wave = false): HTMLElement {
  const handio = brandName() === productName();
  const el = document.createElement("span");
  el.className = "brand-mark" + (handio ? "" : " neu-mark") + (wave && handio ? " wave" : "");
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--bm", size + "px");
  // id gradient riêng cho mỗi lần vẽ: nếu bản đầu tiên nằm trong khối bị ẩn (display:none) thì các bản khác vẫn tô đúng màu
  el.innerHTML = handio ? brandText(BRAND_MARK_SVG) : NEU_MARK_SVG.replace(/nm-g/g, "nm-g" + ++markSeq);
  return el;
}
