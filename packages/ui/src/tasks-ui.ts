import { describeEvery, MAX_RUNS_PER_DAY, MIN_MINUTES, WEEKDAYS, type AgentController, type Every, type ScheduledTask } from "@neu/agent-core";
import { h } from "./dom";

const when = (ts: number): string => {
  try {
    return new Date(ts).toLocaleString("vi-VN", { hour12: false });
  } catch {
    return "";
  }
};

/**
 * Hộp "Tác vụ định kỳ": hẹn giờ để agent tự chạy lại một việc (mỗi N phút / hằng ngày / hằng tuần).
 * Chỉ chạy khi ứng dụng (hoặc tab web) đang mở; quyền chặt hơn lúc trò chuyện (lõi quyết định, xem controller.taskRun).
 */
export function openTasks(ctl: AgentController, opts: { desktop: boolean }): void {
  if (!ctl.taskList) return;
  const dlg = h("dialog", { class: "tasks" });
  const list = h("div", { class: "tk-list" });
  const err = h("div", { class: "res bad", role: "alert" });
  const name = h("input", { type: "text", maxlength: "60", placeholder: "Tên tác vụ", "aria-label": "Tên tác vụ" }) as HTMLInputElement;
  const prompt = h("textarea", { rows: "3", maxlength: "2000", placeholder: "Việc agent cần làm, ví dụ: Tổng hợp các tệp Excel trong thư mục thành báo cáo Word", "aria-label": "Việc cần làm" }) as HTMLTextAreaElement;
  const kind = h("select", { "aria-label": "Lịch" }, h("option", { value: "daily" }, "Hằng ngày"), h("option", { value: "weekly" }, "Hằng tuần"), h("option", { value: "minutes" }, "Mỗi N phút")) as HTMLSelectElement;
  const day = h("select", { "aria-label": "Thứ" }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => h("option", { value: String(d) }, WEEKDAYS[d]))) as HTMLSelectElement;
  const time = h("input", { type: "time", value: "08:00", "aria-label": "Giờ" }) as HTMLInputElement;
  const mins = h("input", { type: "number", min: String(MIN_MINUTES), max: "10080", value: "60", "aria-label": "Số phút" }) as HTMLInputElement;
  const syncKind = () => {
    day.hidden = kind.value !== "weekly";
    time.hidden = kind.value === "minutes";
    mins.hidden = kind.value !== "minutes";
  };
  kind.addEventListener("change", syncKind);
  syncKind();

  const paint = async () => {
    const tasks: ScheduledTask[] = (await ctl.taskList!().catch(() => [])) ?? [];
    list.replaceChildren();
    if (!tasks.length) list.append(h("div", { class: "muted" }, "Chưa có tác vụ nào."));
    for (const t of tasks) {
      const lr = t.lastRun;
      const act = async (fn: () => Promise<unknown>) => {
        err.textContent = "";
        await fn();
        void paint();
      };
      list.append(h("div", { class: "tk-row" },
        h("div", { class: "tk-main" },
          h("b", {}, t.name), h("span", { class: "muted" }, " · " + describeEvery(t.every) + (t.enabled ? "" : " · đang tắt")),
          lr ? h("div", { class: "tk-last " + (lr.status === "ok" ? "" : "bad") }, `${when(lr.at)} · ${lr.status === "ok" ? "xong" : lr.status === "error" ? "lỗi" : "bỏ qua"}: ${lr.summary}`) : h("div", { class: "muted" }, "Chưa chạy lần nào")),
        h("div", { class: "tk-acts" },
          h("button", { class: "btn sm", type: "button", title: "Chạy ngay (tính vào giới hạn mỗi ngày)", onclick: (e: Event) => { (e.target as HTMLButtonElement).disabled = true; void act(async () => { const r = await ctl.taskRunNow!(t.id); if ("error" in r) err.textContent = r.error; }); } }, "Chạy ngay"),
          h("button", { class: "btn sm", type: "button", onclick: () => void act(() => ctl.taskSet!(t.id, !t.enabled)) }, t.enabled ? "Tắt" : "Bật"),
          h("button", { class: "btn sm danger", type: "button", "aria-label": "Xoá " + t.name, onclick: () => { if (confirm("Xoá tác vụ “" + t.name + "”?")) void act(() => ctl.taskRemove!(t.id)); } }, "Xoá"))));
    }
  };

  const add = async () => {
    err.textContent = "";
    const every: Every = kind.value === "minutes" ? { kind: "minutes", n: Number(mins.value) } : kind.value === "weekly" ? { kind: "weekly", day: Number(day.value), at: time.value } : { kind: "daily", at: time.value };
    const r = await ctl.taskAdd!({ name: name.value, prompt: prompt.value, every });
    if ("error" in r) err.textContent = r.error;
    else {
      name.value = prompt.value = "";
      void paint();
    }
  };

  dlg.append(
    h("div", { class: "dh" }, "⏰ Tác vụ định kỳ", h("button", { class: "btn sm", type: "button", "aria-label": "Đóng", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "db" },
      h("div", { class: "muted" }, `${opts.desktop ? "Chạy khi ứng dụng đang mở" : "Chỉ chạy khi tab này đang mở"}; tối đa ${MAX_RUNS_PER_DAY} lần/ngày/tác vụ. Chỉ sửa được tệp trong dự án: lệnh, mạng, tệp nhạy cảm sẽ bị từ chối.`),
      list,
      h("div", { class: "tk-new" }, name, prompt, h("div", { class: "tk-when" }, kind, day, time, mins), h("button", { class: "btn primary", type: "button", onclick: () => void add() }, "Thêm tác vụ")),
      err),
  );
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  void paint();
}
