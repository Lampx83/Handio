import type { AgentController, Profile } from "@neu/agent-core";
import { PROFILES } from "@neu/agent-core/profiles";
import { mountApp, type AppHandle } from "./app";
import { h, store } from "./dom";
import { openDownload } from "./download";

export interface ShellOptions {
  productName?: string;
  /** Chừa chỗ cho nút đóng/thu nhỏ của cửa sổ macOS (Electron). */
  macInset?: boolean;
  /** Danh sách tab; mặc định Code + Work. */
  profiles?: Profile[];
  /** Địa chỉ thư mục chứa các bản cài Desktop (kết thúc bằng “/”); có thì hiện nút “Tải ứng dụng”. Chỉ đặt ở bản web. */
  downloadsBase?: string;
}

/** Khung chứa hai tab (Code/Work), mỗi tab là một phiên agent độc lập vẫn chạy khi bạn chuyển tab. */
export function mountShell(root: HTMLElement, controllers: Partial<Record<Profile, AgentController>>, opts: ShellOptions = {}): { select(p: Profile): void } {
  const ids = (opts.profiles ?? (["code", "work"] as Profile[])).filter((p) => controllers[p]);
  const pref = store("neu.tab");
  let active: Profile = (ids.includes(pref.get() as Profile) ? pref.get() : ids[0]) as Profile;
  const tabs = new Map<Profile, HTMLButtonElement>();
  const panels = new Map<Profile, HTMLElement>();
  const handles = new Map<Profile, AppHandle>();

  const bar = h("div", { class: "topbar" + (opts.macInset ? " mac-inset" : "") },
    h("span", { class: "brand" }, opts.productName ?? "NEU Agent"),
    h("div", { class: "tabs", role: "tablist", "aria-label": "Chế độ làm việc" }, ...ids.map((id) => {
      const b = h("button", { class: "tab", type: "button", role: "tab", id: "tab-" + id, "aria-controls": "panel-" + id, title: PROFILES[id].tagline, onclick: () => select(id) },
        h("span", { class: "tl" }, PROFILES[id].label), h("span", { class: "dot", "aria-hidden": "true" }));
      tabs.set(id, b);
      return b;
    })),
    h("span", { class: "tagline" }, ""),
    opts.downloadsBase ? h("button", { class: "iconbtn dl-btn", type: "button", title: "Tải ứng dụng Desktop cho macOS/Windows", onclick: () => void openDownload(opts.downloadsBase!) }, "⬇ Tải ứng dụng") : null,
  );
  const body = h("div", { class: "panels" });
  root.append(h("div", { class: "shell" }, bar, body));
  const tagline = bar.querySelector<HTMLElement>(".tagline")!;

  for (const id of ids) {
    const panel = h("section", { class: "panel", role: "tabpanel", id: "panel-" + id, "aria-labelledby": "tab-" + id });
    panels.set(id, panel);
    body.append(panel);
    handles.set(id, mountApp(panel, controllers[id]!, {
      onAttention: (kind) => {
        const t = tabs.get(id)!;
        if (kind === "clear") delete t.dataset.attn;
        else if (id !== active) t.dataset.attn = kind;
      },
    }));
  }

  function select(id: Profile): void {
    if (!ids.includes(id)) return;
    handles.get(active)?.hidden();
    active = id;
    pref.set(id);
    for (const p of ids) {
      const on = p === id;
      panels.get(p)!.hidden = !on;
      tabs.get(p)!.setAttribute("aria-selected", String(on));
      tabs.get(p)!.tabIndex = on ? 0 : -1;
    }
    tagline.textContent = PROFILES[id].tagline;
    document.title = `NEU Agent — ${PROFILES[id].label}`;
    handles.get(id)?.shown();
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key) && ids[+e.key - 1]) {
      e.preventDefault();
      select(ids[+e.key - 1]);
    }
  });
  bar.querySelector(".tabs")!.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "ArrowRight" || k === "ArrowLeft") {
      const i = ids.indexOf(active);
      select(ids[(i + (k === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]);
      tabs.get(active)!.focus();
    }
  });
  select(active);
  return { select };
}
