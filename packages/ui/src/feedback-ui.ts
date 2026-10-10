import { FEEDBACK_KINDS, FEEDBACK_LABEL, FEEDBACK_MAX, feedbackProblem, type AgentController, type FeedbackKind } from "@neu/agent-core";
import { h } from "./dom";

const HINT: Record<FeedbackKind, string> = {
  bug: "Việc bạn đang làm, điều xảy ra, điều bạn mong đợi. Càng cụ thể càng dễ sửa.",
  idea: "Bạn muốn hệ thống làm thêm hoặc làm khác điều gì, và để làm gì?",
  praise: "Điều gì bạn thấy hữu ích? Nhóm phát triển rất muốn biết.",
  other: "Bất cứ điều gì bạn muốn nhóm phát triển biết.",
};

/** Hộp "Góp ý / báo lỗi": người dùng tự viết, tự bấm gửi; lưu ở máy chủ cho quản trị viên đọc. */
export function openFeedback(ctl: AgentController, opts: { track?: (a: string) => void; initial?: FeedbackKind } = {}): void {
  if (!ctl.sendFeedback) return;
  let kind: FeedbackKind = opts.initial ?? "bug";
  const dlg = h("dialog", { class: "fbk" });
  const chips = h("div", { class: "fbk-kinds", role: "radiogroup", "aria-label": "Loại góp ý" });
  const text = h("textarea", { class: "fbk-text", rows: "7", maxlength: String(FEEDBACK_MAX), "aria-label": "Nội dung góp ý" }) as HTMLTextAreaElement;
  const hint = h("div", { class: "muted" });
  const count = h("span", { class: "muted" });
  const tech = h("input", { type: "checkbox", id: "fbk-tech" }) as HTMLInputElement;
  tech.checked = true;
  const status = h("div", { class: "fbk-status", role: "status", "aria-live": "polite" });
  const send = h("button", { class: "btn primary", type: "button" }, "Gửi góp ý") as HTMLButtonElement;

  const paint = () => {
    chips.replaceChildren(...FEEDBACK_KINDS.map((k) => {
      const b = h("button", { class: "chip" + (k === kind ? " on" : ""), type: "button", role: "radio", "aria-checked": String(k === kind), onclick: () => { kind = k; paint(); text.focus(); } }, FEEDBACK_LABEL[k]);
      return b;
    }));
    hint.textContent = HINT[kind];
    text.placeholder = HINT[kind];
  };
  const upd = () => (count.textContent = `${text.value.length}/${FEEDBACK_MAX}`);
  text.addEventListener("input", upd);
  paint();
  upd();

  const say = (msg: string, ok: boolean) => {
    status.textContent = msg;
    status.className = "fbk-status " + (ok ? "ok" : "err");
  };
  send.addEventListener("click", () => {
    const bad = feedbackProblem(kind, text.value);
    if (bad) return say(bad, false);
    send.disabled = true;
    say("Đang gửi…", true);
    opts.track?.("feedback_send");
    void ctl.sendFeedback!({ kind, text: text.value, tech: tech.checked }).then((r) => {
      send.disabled = false;
      say(r.message, r.ok);
      if (r.ok) {
        text.value = "";
        upd();
        send.textContent = "Gửi thêm";
        setTimeout(() => dlg.isConnected && dlg.close(), 1800);
      }
    });
  });

  dlg.append(
    h("div", { class: "dh" }, "Góp ý / báo lỗi", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "fbk-body" },
      h("p", { class: "muted" }, "Cho nhóm phát triển biết điều gì chưa ổn hoặc nên cải thiện. Góp ý của bạn được lưu ở máy chủ của trường và chỉ quản trị viên đọc được."),
      chips, hint, text,
      h("div", { class: "fbk-row" }, count),
      h("label", { class: "fbk-chk", for: "fbk-tech" }, tech, " Gửi kèm thông tin kỹ thuật (phiên bản, hệ điều hành, tab, mô hình) — không kèm nội dung hội thoại hay tệp."),
      h("p", { class: "muted fbk-priv" }, "Góp ý được gửi kèm tên đăng nhập của bạn để nhóm có thể liên hệ lại. Đừng đưa mật khẩu, khoá truy cập hay dữ liệu cá nhân của người khác vào góp ý."),
      status,
      h("div", { class: "fbk-actions" }, send)));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  text.focus();
}
