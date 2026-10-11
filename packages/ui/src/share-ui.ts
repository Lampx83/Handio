import type { AgentController, SharedChatInfo } from "@neu/agent-core";
import { h } from "./dom";

const when = (ts: number): string => {
  try {
    return new Date(ts * 1000).toLocaleString("vi-VN", { hour12: false });
  } catch {
    return "";
  }
};

/**
 * Hộp "Chia sẻ cuộc trò chuyện": xem trước (đã che thông tin nhạy cảm), đồng ý rõ ràng, tạo liên kết cho người khác đọc, và thu hồi.
 * Nói thẳng cho người dùng: người có liên kết (đã đăng nhập NEU Agent) và nhóm phát triển đều đọc được bản chia sẻ.
 */
export function openShare(ctl: AgentController, opts: { track?: (a: string) => void; chatId?: string } = {}): void {
  if (!ctl.shareChat) return;
  const dlg = h("dialog", { class: "shr" });
  const title = h("input", { type: "text", class: "shr-title", maxlength: "120", "aria-label": "Tiêu đề chia sẻ" }) as HTMLInputElement;
  const preview = h("div", { class: "muted shr-prev" }, "Đang chuẩn bị bản xem trước…");
  const agree = h("input", { type: "checkbox", id: "shr-agree" }) as HTMLInputElement;
  const create = h("button", { class: "btn primary", type: "button", disabled: "" }, "Tạo liên kết chia sẻ") as HTMLButtonElement;
  const status = h("div", { class: "shr-status", role: "status", "aria-live": "polite" });
  const result = h("div", { class: "shr-result" });
  const list = h("div", { class: "shr-list" });
  let ready = false;

  const sync = () => {
    create.disabled = !(ready && agree.checked);
  };
  agree.addEventListener("change", sync);
  const say = (msg: string, ok: boolean) => {
    status.textContent = msg;
    status.className = "shr-status " + (ok ? "ok" : "err");
  };

  const paintList = async () => {
    const items: SharedChatInfo[] = (await ctl.sharedChats?.().catch(() => [])) ?? [];
    list.replaceChildren();
    if (!items.length) return;
    list.append(h("div", { class: "shr-h" }, `Liên kết bạn đã chia sẻ (${items.length})`));
    for (const it of items) {
      list.append(h("div", { class: "shr-row" },
        h("div", { class: "shr-t" }, it.title, h("span", { class: "muted" }, ` · ${it.items} mục · ${it.views} lượt xem · ${when(it.ts)}`)),
        h("div", { class: "shr-acts" },
          h("button", { class: "btn sm", type: "button", onclick: () => void copy(it.url) }, "Sao chép"),
          h("button", { class: "btn sm danger", type: "button", onclick: async (e: Event) => {
            const b = e.target as HTMLButtonElement;
            b.disabled = true;
            const r = await ctl.unshareChat!(it.id);
            say(r.message, r.ok);
            void paintList();
          } }, "Thu hồi"))));
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      say("Đã sao chép liên kết.", true);
    } catch {
      say("Không sao chép tự động được: hãy chọn và sao chép liên kết ở trên.", false);
    }
  };

  create.addEventListener("click", async () => {
    create.disabled = true;
    say("Đang tạo liên kết…", true);
    opts.track?.("share_create");
    const r = await ctl.shareChat!({ chatId: opts.chatId, title: title.value });
    if (!r.ok || !r.url) {
      say(r.message, false);
      sync();
      return;
    }
    say(r.message, true);
    const input = h("input", { type: "text", class: "shr-url", readonly: "", value: r.url, "aria-label": "Liên kết chia sẻ" }) as HTMLInputElement;
    result.replaceChildren(
      h("div", { class: "shr-h" }, "Liên kết (chỉ người đã đăng nhập NEU Agent mở được):"),
      h("div", { class: "shr-copy" }, input, h("button", { class: "btn primary sm", type: "button", onclick: () => void copy(r.url!) }, "Sao chép")));
    input.focus();
    input.select();
    void paintList();
  });

  dlg.append(
    h("div", { class: "dh" }, "Chia sẻ cuộc trò chuyện", h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Đóng")),
    h("div", { class: "shr-body" },
      h("p", {}, "Tạo một liên kết để người khác đọc lại cuộc trò chuyện này (ví dụ đồng nghiệp, bạn học, giảng viên)."),
      h("label", { class: "shr-lab" }, "Tiêu đề", title),
      preview,
      h("div", { class: "shr-warn" },
        h("b", {}, "Trước khi chia sẻ, hãy lưu ý:"),
        h("ul", {},
          h("li", {}, "Bất kỳ ai đã đăng nhập NEU Agent và có liên kết đều đọc được toàn bộ cuộc trò chuyện này."),
          h("li", {}, "Nhóm phát triển cũng đọc được các cuộc trò chuyện được chia sẻ để hiểu người dùng gặp gì và cải thiện hệ thống."),
          h("li", {}, "Khoá/mật khẩu, CCCD, số điện thoại, email, số tài khoản được tự che, nhưng bạn vẫn nên tự kiểm tra, đừng chia sẻ thông tin riêng tư của người khác."),
          h("li", {}, "Nội dung các tệp không được chia sẻ, chỉ có chữ trao đổi và tóm tắt thao tác."),
          h("li", {}, "Bạn thu hồi được bất cứ lúc nào: liên kết sẽ hết hiệu lực và bản chia sẻ bị xoá."))),
      h("label", { class: "shr-chk", for: "shr-agree" }, agree, " Tôi đã hiểu và đồng ý chia sẻ cuộc trò chuyện này."),
      status,
      h("div", { class: "shr-actions" }, create),
      result,
      list));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  void ctl.sharePreview?.(opts.chatId).then((p) => {
    if (!p.ok) {
      preview.textContent = p.message || "Chưa có nội dung để chia sẻ.";
      return;
    }
    title.value = p.title;
    preview.textContent = `${p.items} mục (câu hỏi, trả lời, thao tác)` + (p.redactions ? ` · đã tự che ${p.redactions} thông tin nhạy cảm.` : " · không phát hiện thông tin nhạy cảm cần che.");
    ready = true;
    sync();
  });
  void paintList();
}
