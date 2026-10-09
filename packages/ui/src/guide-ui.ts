import { appVersion, changelogEntries, changelogEntryEl, openChangelog } from "./changelog-ui";
import { h, clear } from "./dom";
import { GUIDE, GUIDE_COMMON, searchGuide, type GuideItem, type GuideSection, type GuideTab } from "./guide-content";

interface GuideOpts {
  profile: GuideTab;
  /** Chèn câu mẫu vào ô nhập (nút "Dùng thử"). */
  onTry: (text: string) => void;
  /** Ghi nhận việc dùng tính năng (chỉ mã). */
  track?: (act: string) => void;
}

const WHATS_NEW = "co-gi-moi";

function itemEl(it: GuideItem, onTry: (t: string) => void, close: () => void): HTMLElement {
  return h("article", { class: "gd-item" },
    h("h4", {}, it.t),
    h("p", {}, it.d),
    it.tryIt ? h("div", { class: "gd-try" }, h("code", {}, it.tryIt), h("button", { class: "btn sm primary", type: "button", onclick: () => (close(), onTry(it.tryIt!)) }, "Dùng thử")) : null);
}

/** Hộp "Hướng dẫn" cho người đã đăng nhập: mẹo, thủ thuật, tình huống mẫu theo tab, tìm kiếm, và "Có gì mới". */
export function openGuide(o: GuideOpts): void {
  const dlg = h("dialog", { class: "guide" });
  const sections: GuideSection[] = [...GUIDE[o.profile], ...GUIDE_COMMON];
  const nav = h("nav", { class: "gd-nav", "aria-label": "Mục hướng dẫn" });
  const body = h("div", { class: "gd-body" });
  const search = h("input", { type: "search", class: "gd-search", placeholder: "Tìm: lỗi, hạn mức, Excel, màu…", "aria-label": "Tìm trong hướng dẫn" }) as HTMLInputElement;
  let cur = sections[0].id;
  const close = () => dlg.close();

  const paintNav = (): void => {
    clear(nav);
    for (const s of sections) nav.append(h("button", { type: "button", class: "gd-nb", "aria-current": s.id === cur ? "true" : undefined, onclick: () => { cur = s.id; search.value = ""; paint(); } }, `${s.icon} ${s.title}`));
    nav.append(h("button", { type: "button", class: "gd-nb", "aria-current": cur === WHATS_NEW ? "true" : undefined, onclick: () => { cur = WHATS_NEW; search.value = ""; paint(); } }, "🆕 Có gì mới"));
  };

  const paint = (): void => {
    paintNav();
    clear(body);
    const q = search.value.trim();
    if (q) {
      const res = searchGuide(sections, q);
      if (!res.length) body.append(h("p", { class: "muted" }, `Không thấy mục nào cho “${q}”. Thử từ khoá khác, ví dụ: lỗi, token, Excel, màu.`));
      for (const r of res) body.append(h("h3", { class: "gd-h" }, `${r.section.icon} ${r.section.title}`), ...r.items.map((i) => itemEl(i, o.onTry, close)));
      return;
    }
    if (cur === WHATS_NEW) {
      const list = changelogEntries().slice(0, 3);
      body.append(h("h3", { class: "gd-h" }, "🆕 Có gì mới"), h("p", { class: "muted" }, appVersion() ? `Bạn đang dùng phiên bản ${appVersion()}.` : "Các thay đổi gần đây."),
        ...(list.length ? list.map((e) => changelogEntryEl(e, appVersion())) : [h("p", { class: "muted" }, "Chưa có nhật ký thay đổi trong bản này.")]),
        h("button", { class: "btn sm", type: "button", onclick: () => (close(), openChangelog()) }, "Xem toàn bộ nhật ký thay đổi"));
      return;
    }
    const s = sections.find((x) => x.id === cur) ?? sections[0];
    body.append(h("h3", { class: "gd-h" }, `${s.icon} ${s.title}`));
    if (s.intro) body.append(h("p", { class: "gd-intro" }, s.intro));
    body.append(...s.items.map((i) => itemEl(i, o.onTry, close)));
  };

  search.addEventListener("input", paint);
  dlg.append(
    h("div", { class: "dh" }, "💡 Hướng dẫn", search, h("button", { class: "btn sm", type: "button", onclick: close }, "Đóng")),
    h("div", { class: "gd-main" }, nav, body));
  dlg.addEventListener("close", () => dlg.remove());
  paint();
  o.track?.("guide_open");
  document.body.append(dlg);
  dlg.showModal();
}
