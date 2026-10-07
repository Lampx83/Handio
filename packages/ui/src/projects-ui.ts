import type { AgentController, Profile, UiState } from "@neu/agent-core";
import { clear, h } from "./dom";

const NOUN: Record<Profile, { one: string; ph: string; ex: string }> = {
  work: { one: "dự án", ph: "VD: Hồ sơ tuyển sinh 2026", ex: "VD: Dự án này là các văn bản của Phòng Đào tạo. Luôn xưng “Nhà trường”, dùng thể thức hành chính, ngày theo dd/mm/yyyy. Không nêu số tiền nếu tôi chưa cung cấp." },
  code: { one: "dự án", ph: "VD: Ứng dụng quản lý điểm", ex: "VD: Dự án Python dùng Streamlit. Chạy bằng `streamlit run app.py`. Không đổi cách đọc API key từ .env. Trả lời giải thích ngắn gọn cho người mới học." },
  design: { one: "dự án thiết kế", ph: "VD: Bộ nhận diện CLB Lập trình", ex: "VD: Màu chủ đạo xanh navy #10265c và vàng #f5b301. Font không chân. Luôn có logo [CLB] ở góc trên trái. Giọng văn trẻ trung." },
};

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return m + " phút trước";
  const hr = Math.round(m / 60);
  if (hr < 24) return hr + " giờ trước";
  return Math.round(hr / 24) + " ngày trước";
};
export { ago };

/** Hộp “Dự án mới”: tên, hướng dẫn riêng (lưu thành AGENTS.md), hoặc dùng thư mục có sẵn trên máy (Desktop). */
export function openNewProject(ctl: AgentController, st: UiState, done: () => void): void {
  const n = NOUN[st.profile];
  const dlg = h("dialog", { class: "proj-dlg" });
  const name = h("input", { type: "text", placeholder: n.ph, maxlength: "60", "aria-label": "Tên " + n.one });
  const ins = h("textarea", { rows: "6", placeholder: n.ex, maxlength: "20000", "aria-label": "Hướng dẫn riêng cho dự án" });
  const err = h("div", { class: "res bad", role: "alert" });
  const create = async () => {
    err.textContent = "";
    const r = await ctl.projectCreate!({ name: name.value, instructions: ins.value.trim() || undefined });
    if ("error" in r) err.textContent = r.error;
    else {
      dlg.close();
      done();
    }
  };
  dlg.append(
    h("div", { class: "dh" }, "Dự án mới", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "db" },
      h("label", {}, "Tên " + n.one, name),
      h("label", {}, "Hướng dẫn cho agent (không bắt buộc)", ins),
      err),
    h("div", { class: "df" },
      st.capabilities.pickFolder ? h("button", { class: "btn", type: "button", style: { marginRight: "auto" }, title: "Dùng một thư mục đã có trên máy làm dự án", onclick: async () => {
        const r = await ctl.projectPick!();
        if ("error" in r) err.textContent = r.error;
        else if (r.ok) {
          dlg.close();
          done();
        }
      } }, "Dùng thư mục có sẵn…") : null,
      h("button", { class: "btn primary", type: "button", onclick: () => void create() }, "Tạo dự án")));
  name.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), void create()));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}

/** Sửa hướng dẫn riêng của dự án đang mở (tệp AGENTS.md ở thư mục gốc dự án). */
export async function openInstructions(ctl: AgentController, st: UiState, done: () => void): Promise<void> {
  const cur = await ctl.instructionsGet!();
  const dlg = h("dialog", { class: "proj-dlg" });
  const ta = h("textarea", { rows: "14", maxlength: "20000", placeholder: NOUN[st.profile].ex, "aria-label": "Hướng dẫn dự án" });
  ta.value = cur;
  dlg.append(
    h("div", { class: "dh" }, "Hướng dẫn của dự án: " + st.projectName, h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "db" },
      h("p", { class: "hint", style: { marginTop: "0" } }, "Lưu trong ", h("code", {}, "AGENTS.md"), "; agent đọc ở mọi cuộc trò chuyện của dự án."),
      ta),
    h("div", { class: "df" }, h("button", { class: "btn primary", type: "button", onclick: async () => { await ctl.instructionsSet!(ta.value); dlg.close(); done(); } }, "Lưu")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  ta.focus();
}

/** Danh sách dự án (bật/tắt dưới nút tên dự án): chuyển dự án, đổi tên, bỏ khỏi danh sách (không xoá tệp). */
export async function toggleProjectMenu(anchor: HTMLElement, ctl: AgentController, st: UiState, hooks: { changed(): void; newProject(): void }): Promise<void> {
  const open = anchor.parentElement?.querySelector(".projmenu");
  if (open) return void open.remove();
  const ps = await ctl.projectsState!();
  const menu = h("div", { class: "projmenu", role: "menu" });
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", away, true);
  };
  const away = (e: Event) => {
    if (!(e.target as HTMLElement).closest(".projmenu") && e.target !== anchor && !anchor.contains(e.target as Node)) close();
  };
  const paint = (list: typeof ps.projects) => {
    clear(menu);
    for (const p of list) {
      const active = p.id === ps.active;
      menu.append(h("div", { class: "pm-row" + (active ? " on" : ""), role: "menuitem", tabindex: "0", title: p.path ?? p.name },
        h("span", { class: "pm-ck" }, active ? "✓" : ""),
        h("span", { class: "pm-nm", onclick: async () => {
          close();
          if (!active) {
            try {
              await ctl.projectOpen!(p.id);
            } catch (e) {
              alert((e as Error).message);
            }
            hooks.changed();
          }
        } }, p.name, p.path ? h("small", {}, p.path) : null),
        h("button", { type: "button", class: "pm-b", title: "Đổi tên", "aria-label": "Đổi tên " + p.name, onclick: async (ev: Event) => {
          ev.stopPropagation();
          const n = prompt("Tên mới cho dự án:", p.name);
          if (n && n.trim()) {
            await ctl.projectRename!(p.id, n.trim());
            close();
            hooks.changed();
          }
        } }, "✎"),
        list.length > 1 ? h("button", { type: "button", class: "pm-b", title: "Bỏ khỏi danh sách (không xoá tệp)", "aria-label": "Bỏ " + p.name + " khỏi danh sách", onclick: async (ev: Event) => {
          ev.stopPropagation();
          if (!confirm(`Bỏ “${p.name}” khỏi danh sách?\nTệp không bị xoá; lịch sử trò chuyện của dự án sẽ mất.`)) return;
          const r = await ctl.projectRemove!(p.id);
          if ("error" in r) alert(r.error);
          close();
          hooks.changed();
        } }, "×") : null));
    }
    menu.append(h("div", { class: "pm-sep" }), h("button", { class: "pm-act", type: "button", onclick: () => { close(); hooks.newProject(); } }, "＋ Dự án mới…"));
    if (st.capabilities.pickFolder)
      menu.append(h("button", { class: "pm-act", type: "button", onclick: async () => {
        close();
        const r = await ctl.projectPick!();
        if ("error" in r) alert(r.error);
        else if (r.ok) hooks.changed();
      } }, "📁 Mở thư mục có sẵn…"));
  };
  paint(ps.projects);
  anchor.after(menu);
  document.addEventListener("mousedown", away, true);
}
