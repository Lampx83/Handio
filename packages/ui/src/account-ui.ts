import { h } from "./dom";
import type { AccountInfo } from "./settings-ui";

const KIND_LABEL: Record<NonNullable<AccountInfo["kind"]>, string> = { microsoft: "Microsoft 365", password: "Tài khoản nội bộ" };

const initial = (a: AccountInfo): string => ((a.name || a.email).trim()[0] ?? "?").toUpperCase();

/** Ô tài khoản ở cuối thanh bên: bấm để xem hồ sơ (tên, email, loại đăng nhập) và đăng xuất. */
export function accountChip(account: AccountInfo, openSettings: () => void): HTMLElement {
  const label = account.name || account.email;
  const pop = h("div", { class: "acct-pop", role: "dialog", "aria-label": "Tài khoản", hidden: true },
    h("div", { class: "acct-card" },
      h("span", { class: "acct-av lg", "aria-hidden": "true" }, initial(account)),
      h("div", { class: "acct-who" },
        account.name ? h("b", {}, account.name) : null,
        h("span", { class: "muted" }, account.email),
        account.kind ? h("span", { class: "acct-kind" }, KIND_LABEL[account.kind]) : null)),
    h("button", { class: "btn", type: "button", onclick: () => { close(); openSettings(); } }, "Cài đặt"),
    h("button", { class: "btn danger", type: "button", onclick: () => account.logout() }, "Đăng xuất"));
  const btn = h("button", { class: "acct-btn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: account.email, onclick: () => (pop.hidden ? open() : close()) },
    h("span", { class: "acct-av", "aria-hidden": "true" }, initial(account)), h("span", { class: "acct-name" }, label));
  const wrap = h("div", { class: "acct" }, pop, btn);

  const onDoc = (e: Event) => { if (!wrap.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); btn.focus(); } };
  function open(): void {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onKey);
  }
  function close(): void {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey);
  }
  return wrap;
}
