import type { AgentController, Mode, UiState } from "@neu/agent-core";
import { clear, h, store } from "./dom";

export interface AccountInfo {
  email: string;
  name?: string;
  /** Cách đăng nhập (để hiện trong hồ sơ). */
  kind?: "microsoft" | "password";
  logout(): void;
}

const MODE_LABEL: Record<Mode, string> = { default: "Hỏi trước", acceptEdits: "Tự sửa tệp", auto: "Tự động", plan: "Lập kế hoạch", bypass: "Toàn quyền" };
const THEME = store("neu.theme");
const ZOOM = store("neu.zoom");
const ZOOMS: Record<string, number> = { s: 0.92, m: 1, l: 1.12 };

/** Áp giao diện đã chọn (sáng/tối, cỡ chữ). Gọi một lần lúc khởi động và mỗi khi đổi. */
export function applyAppearance(): void {
  const t = THEME.get();
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const z = ZOOMS[ZOOM.get() ?? "m"] ?? 1;
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = z === 1 ? "" : String(z);
}

type Tab = "general" | "model" | "perm" | "account";

/** Hộp Cài đặt: mục Giao diện, Mô hình, Quyền, Tài khoản (nếu có đăng nhập). */
export function openSettings(ctl: AgentController, st: UiState, account: AccountInfo | undefined, done: () => void): void {
  const dlg = h("dialog", { class: "set" });
  const nav = h("nav", { class: "set-nav", role: "tablist" });
  const pane = h("div", { class: "set-pane" });
  let tab: Tab = "general";
  const s = st.settings;

  const seg = (opts: [string, string][], cur: string, on: (v: string) => void) => {
    const box = h("div", { class: "seg", role: "radiogroup" });
    for (const [v, label] of opts) box.append(h("button", { type: "button", role: "radio", "aria-checked": String(v === cur), onclick: () => { on(v); for (const b of box.children) b.setAttribute("aria-checked", String(b === box.children[opts.findIndex((o) => o[0] === v)])); } }, label));
    return box;
  };
  const row = (label: string, ...ctrl: (Node | string)[]) => h("div", { class: "set-row" }, h("span", { class: "lb" }, label), h("div", { class: "ct" }, ...ctrl));

  // ---- Chẩn đoán lỗi (không gửi nội dung): bật/tắt + báo lỗi kèm xem trước đúng dữ liệu sẽ gửi
  const diagRow = (): HTMLElement => {
    const box = h("div", { class: "set-row" }, h("span", { class: "lb" }, "Chẩn đoán lỗi"));
    const ct = h("div", { class: "ct" });
    box.append(ct);
    void ctl.diagnosticsStatus!().then((d) => {
      if (!d.available) return void box.remove();
      const on = h("input", { type: "checkbox", checked: d.enabled, disabled: d.lockedByPolicy, title: d.lockedByPolicy ? "Do quản trị viên quy định" : "Chỉ gửi số liệu lỗi, không gửi câu hỏi hay tệp" });
      on.addEventListener("change", () => void ctl.saveSettings({ diagnostics: on.checked }));
      ct.append(h("label", { class: "chk" }, on, "Gửi số liệu lỗi"), h("button", { class: "btn sm", type: "button", onclick: () => openReport(ctl) }, "Báo lỗi…"));
    });
    return box;
  };

  // ---- Giao diện
  const general = (): HTMLElement => h("div", {},
    row("Giao diện", seg([["auto", "Tự động"], ["light", "Sáng"], ["dark", "Tối"]], THEME.get() ?? "auto", (v) => { THEME.set(v); applyAppearance(); })),
    row("Cỡ chữ", seg([["s", "Nhỏ"], ["m", "Vừa"], ["l", "Lớn"]], ZOOM.get() ?? "m", (v) => { ZOOM.set(v); applyAppearance(); })),
    ctl.diagnosticsStatus ? diagRow() : null,
    st.capabilities.reset ? row("Dữ liệu mẫu", h("button", { class: "btn danger sm", type: "button", title: "Xoá thay đổi của dự án này và nạp lại dữ liệu mẫu", onclick: async () => { if (confirm("Xoá mọi tệp của dự án này và nạp lại dữ liệu mẫu?")) { await ctl.resetWorkspace?.(); dlg.close(); done(); } } }, "Khôi phục")) : null,
  );

  // ---- Mô hình
  const model = (): HTMLElement => {
    const base = h("input", { type: "text", value: s.baseUrl, spellcheck: "false", disabled: st.policy.baseUrl, "aria-label": "Địa chỉ API" });
    const modelSel = h("select", { "aria-label": "Mô hình" }, h("option", { value: s.model }, s.model));
    const modelTxt = h("input", { type: "text", value: s.model, spellcheck: "false", hidden: true, "aria-label": "Tên mô hình" });
    const key = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: s.hasKey ? `Đang dùng ${s.keyHint}` : "Dán key", "aria-label": "Key API" });
    const think = h("input", { type: "checkbox", checked: s.thinking });
    const num = (v: number, min: number, max: number, step = 1) => h("input", { type: "number", value: String(v), min: String(min), max: String(max), step: String(step) });
    const temp = num(s.temperature, 0, 2, 0.1);
    const maxOut = num(s.maxOutputTokens, 256, 16384, 256);
    const steps = num(s.maxSteps, 1, 200);
    const ctxTok = num(s.contextTokens, 4096, 131072, 1024);
    const res = h("span", { class: "res", role: "status" });
    const curModel = () => (modelTxt.hidden ? modelSel.value : modelTxt.value.trim());
    const patch = () => ({ baseUrl: base.value.trim(), model: curModel(), thinking: think.checked, temperature: +temp.value, maxOutputTokens: +maxOut.value, maxSteps: +steps.value, contextTokens: +ctxTok.value, ...(key.value.trim() ? { key: key.value.trim() } : {}) });
    const loadModels = async () => {
      const list = (await ctl.listModels?.().catch(() => [])) ?? [];
      if (!list.length) { modelSel.hidden = true; modelTxt.hidden = false; return; }
      clear(modelSel);
      for (const m of new Set([curModel() || s.model, ...list])) modelSel.append(h("option", { value: m }, m));
      modelSel.value = s.model;
    };
    void loadModels();
    return h("div", {},
      st.presets.length ? h("div", { class: "chips left" }, ...st.presets.map((p) => h("button", { class: "chip", type: "button", onclick: () => { base.value = p.baseUrl; modelTxt.value = p.model; modelTxt.hidden = false; modelSel.hidden = true; } }, p.label.replace(/ \(.*\)$/, "")))) : null,
      row("Địa chỉ API", base),
      row("Mô hình", modelSel, modelTxt),
      row("Key", key),
      row("Suy nghĩ sâu", h("label", { class: "chk" }, think, "Chậm hơn")),
      h("details", { class: "set-adv" }, h("summary", {}, "Nâng cao"),
        row("Nhiệt độ", temp), row("Token đầu ra tối đa", maxOut), row("Số bước tối đa", steps), row("Cửa sổ ngữ cảnh", ctxTok)),
      h("div", { class: "set-actions" }, res,
        h("button", { class: "btn", type: "button", onclick: async () => { await ctl.saveSettings({ key: "" }); dlg.close(); done(); } }, "Xoá key"),
        h("button", { class: "btn", type: "button", onclick: async () => { await ctl.saveSettings(patch()); res.className = "res"; res.textContent = "Đang thử…"; const r = await ctl.testConnection(); res.className = "res " + (r.ok ? "ok" : "bad"); res.textContent = r.message; } }, "Kiểm tra"),
        h("button", { class: "btn primary", type: "button", onclick: async () => { await ctl.saveSettings(patch()); dlg.close(); done(); } }, "Lưu")));
  };

  // ---- Quyền
  const perm = (): HTMLElement => {
    const n = s.permissions?.allow?.length ?? 0;
    const sel = h("select", { "aria-label": "Chế độ mặc định" }, ...st.allowedModes.filter((m) => m !== "bypass").map((m) => h("option", { value: m, selected: m === s.mode }, MODE_LABEL[m])));
    const cnt = h("span", {}, n ? `${n} quy tắc đã nhớ` : "Chưa nhớ quy tắc nào");
    const clearBtn = h("button", { class: "btn sm", type: "button", disabled: !n, title: "Bỏ các lựa chọn “Luôn cho phép” đã lưu", onclick: async () => { await ctl.resetPermissions?.(); cnt.textContent = "Chưa nhớ quy tắc nào"; clearBtn.disabled = true; } }, "Xoá");
    return h("div", {},
      row("Chế độ mặc định", sel, h("button", { class: "btn sm", type: "button", onclick: async () => { await ctl.saveSettings({ mode: sel.value as Mode }); await ctl.setMode(sel.value as Mode); done(); } }, "Áp dụng")),
      row("Luôn cho phép", cnt, clearBtn));
  };

  // ---- Tài khoản
  const acc = (): HTMLElement => h("div", {},
    row("Đăng nhập", h("span", {}, account?.name ? `${account.name} · ` : "", h("b", {}, account?.email ?? ""))),
    ...(account?.kind ? [row("Loại", h("span", {}, account.kind === "microsoft" ? "Microsoft 365" : "Tài khoản nội bộ"))] : []),
    h("div", { class: "set-actions" }, h("button", { class: "btn danger", type: "button", onclick: () => account?.logout() }, "Đăng xuất")));

  const tabs: [Tab, string, () => HTMLElement][] = [["general", "Giao diện", general], ["model", "Mô hình", model], ["perm", "Quyền", perm], ...(account ? ([["account", "Tài khoản", acc]] as [Tab, string, () => HTMLElement][]) : [])];
  const paint = () => {
    clear(nav);
    for (const [id, label] of tabs) nav.append(h("button", { type: "button", role: "tab", "aria-selected": String(id === tab), onclick: () => { tab = id; paint(); } }, label));
    clear(pane);
    pane.append(tabs.find((t) => t[0] === tab)![2]());
  };
  dlg.append(h("div", { class: "dh" }, "Cài đặt", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")), h("div", { class: "set-body" }, nav, pane));
  dlg.addEventListener("close", () => dlg.remove());
  paint();
  document.body.append(dlg);
  dlg.showModal();
}

/** Hộp “Báo lỗi”: ghi chú ngắn, XEM TRƯỚC đúng dữ liệu sẽ gửi (chỉ số liệu, không nội dung), rồi gửi. */
export function openReport(ctl: AgentController): void {
  const dlg = h("dialog", { class: "proj-dlg" });
  const note = h("textarea", { rows: "3", maxlength: "500", placeholder: "Mô tả ngắn vấn đề (không bắt buộc)", "aria-label": "Mô tả vấn đề" });
  const pre = h("pre", { class: "rep-pre" });
  const res = h("span", { class: "res", role: "status" });
  const send = h("button", { class: "btn primary", type: "button", disabled: true, onclick: async () => { send.disabled = true; const r = await ctl.diagnosticsSend!(); res.className = "res " + (r.ok ? "ok" : "bad"); res.textContent = r.ok ? "Đã gửi, cảm ơn bạn." : "Chưa gửi được. Thử lại sau."; if (r.ok) setTimeout(() => dlg.close(), 900); else send.disabled = false; } }, "Gửi");
  const refresh = async () => { const j = await ctl.diagnosticsPreview!(note.value); pre.textContent = j ?? "Chưa có dữ liệu để gửi."; send.disabled = !j; };
  note.addEventListener("input", () => void refresh());
  dlg.append(h("div", { class: "dh" }, "Báo lỗi", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "db" }, note, h("details", { class: "set-adv", open: true }, h("summary", {}, "Dữ liệu sẽ gửi (không có câu hỏi, tệp, đường dẫn)"), pre)),
    h("div", { class: "df" }, res, send));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  void refresh();
}
