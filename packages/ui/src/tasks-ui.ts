import { describeEvery, MAX_RUNS_PER_DAY, MIN_MINUTES, WEEKDAYS, type AgentController, type BackgroundState, type Every, type TaskView } from "@neu/agent-core";
import { h } from "./dom";

const pad = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "hôm nay 08:00", "mai 08:00", "08:00 20/10" (ngắn, giờ máy). */
export function when(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStr(d) === dayStr(today)) return "hôm nay " + hm;
  if (dayStr(d) === dayStr(tomorrow)) return "mai " + hm;
  if (dayStr(d) === dayStr(yesterday)) return "hôm qua " + hm;
  return `${hm} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}` + (d.getFullYear() === today.getFullYear() ? "" : "/" + d.getFullYear());
}

const STATUS: Record<string, string> = { ok: "Xong", error: "Lỗi", skipped: "Bỏ qua" };

/** Dòng trạng thái của một tác vụ (lần tới, lần trước, số thao tác bị từ chối): tách riêng để kiểm thử. */
export function taskStatus(t: TaskView, now = Date.now()): { next: string; last: string; bad: boolean } {
  const next = t.running ? "Đang chạy…" : t.next !== undefined ? (t.next <= now ? "Sắp chạy" : "Lần tới: " + when(t.next, now)) : t.enabled ? "" : t.every.kind === "once" && t.lastRun ? "Đã chạy xong lịch một lần" : "Đang tắt";
  const lr = t.lastRun;
  const last = lr ? `Lần trước: ${when(lr.at, now)} · ${STATUS[lr.status]}` + (lr.denied ? ` · ${lr.denied} thao tác bị từ chối` : "") : "Chưa chạy lần nào";
  return { next, last, bad: !!lr && lr.status !== "ok" };
}

/**
 * Hộp "Tác vụ định kỳ": hẹn giờ để agent tự chạy lại một việc (mỗi N phút / hằng ngày / hằng tuần / một lần).
 * Chạy khi ứng dụng (hoặc tab web) đang mở; quyền chặt hơn lúc trò chuyện (lõi quyết định, xem controller.taskRun).
 */
export function openTasks(ctl: AgentController, opts: { desktop: boolean; onOpenChat?: (chatId: string) => void }): void {
  if (!ctl.taskList) return;
  const dlg = h("dialog", { class: "tasks", "aria-label": "Tác vụ định kỳ" });
  const list = h("div", { class: "tk-list", "aria-live": "polite" });
  const err = h("div", { class: "res bad", role: "alert" });
  const name = h("input", { type: "text", maxlength: "60", placeholder: "Tên tác vụ", "aria-label": "Tên tác vụ" }) as HTMLInputElement;
  const prompt = h("textarea", { rows: "3", maxlength: "2000", placeholder: "Việc agent cần làm, ví dụ: Tổng hợp các tệp Excel trong thư mục thành báo cáo Word", "aria-label": "Việc cần làm" }) as HTMLTextAreaElement;
  const kind = h("select", { "aria-label": "Lịch" }, h("option", { value: "daily" }, "Hằng ngày"), h("option", { value: "weekly" }, "Hằng tuần"), h("option", { value: "minutes" }, "Mỗi N phút"), h("option", { value: "once" }, "Một lần")) as HTMLSelectElement;
  const day = h("select", { "aria-label": "Thứ" }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => h("option", { value: String(d) }, WEEKDAYS[d]))) as HTMLSelectElement;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = h("input", { type: "date", value: dayStr(tomorrow), min: dayStr(new Date()), "aria-label": "Ngày" }) as HTMLInputElement;
  const time = h("input", { type: "time", value: "08:00", "aria-label": "Giờ" }) as HTMLInputElement;
  const mins = h("input", { type: "number", min: String(MIN_MINUTES), max: "10080", value: "60", "aria-label": "Số phút" }) as HTMLInputElement;
  const minsLbl = h("span", { class: "muted" }, "phút");
  const syncKind = () => {
    day.hidden = kind.value !== "weekly";
    date.hidden = kind.value !== "once";
    time.hidden = kind.value === "minutes";
    mins.hidden = minsLbl.hidden = kind.value !== "minutes";
  };
  kind.addEventListener("change", syncKind);
  syncKind();

  const act = async (fn: () => Promise<unknown>) => {
    err.textContent = "";
    try {
      await fn();
    } catch (e) {
      err.textContent = (e as Error).message;
    }
    void paint();
  };

  const row = (t: TaskView) => {
    const st = taskStatus(t);
    const btn = (label: string, onclick: () => void, extra: Record<string, string> = {}) => h("button", { class: "btn sm", type: "button", ...extra, onclick }, label);
    const acts: HTMLElement[] = [];
    if (t.running) acts.push(btn("Dừng", () => void act(() => ctl.taskStop!()), { title: "Dừng lần chạy này" }));
    else
      acts.push(btn("Chạy ngay", () => void act(async () => {
        const run = ctl.taskRunNow!(t.id);
        setTimeout(() => void paint(), 300); // hiện "Đang chạy" + nút Dừng
        const r = await run;
        if ("error" in r) err.textContent = r.error;
      }), { title: "Chạy ngay (tính vào giới hạn mỗi ngày)" }));
    if (t.lastRun?.chatId && opts.onOpenChat) acts.push(btn("Xem", () => { opts.onOpenChat!(t.lastRun!.chatId!); dlg.close(); }, { title: "Xem chi tiết lần chạy gần nhất (trong lịch sử trò chuyện)" }));
    if (t.canUndo && ctl.taskUndo && !t.running)
      acts.push(btn("Hoàn tác", () => {
        if (!confirm(`Đưa các tệp lần chạy gần nhất của “${t.name}” đã sửa về như trước? Tệp bạn sửa lại sau đó sẽ được giữ nguyên.`)) return;
        void act(async () => {
          const r = await ctl.taskUndo!(t.id);
          if ("error" in r) err.textContent = r.error;
          else err.textContent = r.skipped.length ? `Đã hoàn tác ${r.reverted.length} tệp; giữ nguyên ${r.skipped.length} tệp (đã sửa sau lần chạy hoặc là tệp nhạy cảm).` : "";
        });
      }, { title: "Hoàn tác các tệp lần chạy gần nhất đã sửa" }));
    if (!(t.every.kind === "once" && !t.enabled && t.lastRun)) acts.push(btn(t.enabled ? "Tắt" : "Bật", () => void act(() => ctl.taskSet!(t.id, !t.enabled))));
    acts.push(h("button", { class: "btn sm danger", type: "button", "aria-label": "Xoá " + t.name, onclick: () => { if (confirm("Xoá tác vụ “" + t.name + "”?")) void act(() => ctl.taskRemove!(t.id)); } }, "Xoá"));
    return h("div", { class: "tk-row" + (t.enabled || t.running ? "" : " off"), role: "listitem" },
      h("div", { class: "tk-main" },
        h("div", { class: "tk-title" }, h("b", {}, t.name), h("span", { class: "tk-when" }, describeEvery(t.every)), t.running ? h("span", { class: "tk-chip run" }, "Đang chạy") : !t.enabled ? h("span", { class: "tk-chip" }, "Tắt") : ""),
        st.next && !t.running ? h("div", { class: "tk-meta" }, st.next) : "",
        h("div", { class: "tk-meta" + (st.bad ? " bad" : "") }, st.last),
        t.lastRun?.summary ? h("div", { class: "tk-sum" + (st.bad ? " bad" : "") }, t.lastRun.summary) : ""),
      h("div", { class: "tk-acts" }, ...acts));
  };

  const paint = async () => {
    const tasks: TaskView[] = (await ctl.taskList!().catch(() => [])) ?? [];
    list.replaceChildren();
    list.setAttribute("role", "list");
    if (!tasks.length) list.append(h("div", { class: "muted tk-empty" }, "Chưa có tác vụ nào."));
    for (const t of tasks) list.append(row(t));
  };

  const add = async () => {
    err.textContent = "";
    const every: Every =
      kind.value === "minutes" ? { kind: "minutes", n: Number(mins.value) }
        : kind.value === "weekly" ? { kind: "weekly", day: Number(day.value), at: time.value }
          : kind.value === "once" ? { kind: "once", date: date.value, at: time.value }
            : { kind: "daily", at: time.value };
    const r = await ctl.taskAdd!({ name: name.value, prompt: prompt.value, every });
    if ("error" in r) err.textContent = r.error;
    else {
      name.value = prompt.value = "";
      void paint();
    }
  };

  const notify = opts.desktop && ctl.taskNotify ? (h("input", { type: "checkbox", "aria-label": "Thông báo của hệ thống khi tác vụ xong hoặc lỗi" }) as HTMLInputElement) : null;
  if (notify) {
    void ctl.taskNotify!().then((v) => (notify.checked = v)).catch(() => undefined);
    notify.addEventListener("change", () => void ctl.taskNotify!(notify.checked).catch(() => undefined));
  }

  // Desktop: giữ chạy nền ở khay khi đóng cửa sổ (chỉ có hiệu lực khi có tác vụ đang bật) + mở cùng máy (chỉ bật được khi đã giữ chạy nền)
  const bg = opts.desktop && ctl.taskBackground ? ctl.taskBackground.bind(ctl) : null;
  const keep = h("input", { type: "checkbox" }) as HTMLInputElement;
  const atLogin = h("input", { type: "checkbox" }) as HTMLInputElement;
  const atLoginRow = h("label", { class: "chk", title: "Cần “Ghi nhớ đăng nhập” để tác vụ chạy được sau khi khởi động máy." }, atLogin, "Mở cùng máy (ẩn ở khay)");
  const keepRow = h("label", { class: "chk", title: "Chỉ khi có tác vụ đang bật. Thoát hẳn ở biểu tượng khay." }, keep, "Giữ chạy nền khi đóng cửa sổ (để tác vụ định kỳ chạy)");
  const syncBg = (st: BackgroundState) => {
    keep.checked = st.keep;
    atLogin.checked = st.atLogin;
    atLogin.disabled = !st.keep;
    atLoginRow.hidden = !st.atLoginSupported;
  };
  atLoginRow.hidden = true;
  if (bg) {
    const set = (patch: { keep?: boolean; atLogin?: boolean }) => void bg(patch).then(syncBg).catch((e: Error) => {
      err.textContent = e.message;
      void bg().then(syncBg).catch(() => undefined);
    });
    void bg().then(syncBg).catch(() => undefined);
    keep.addEventListener("change", () => set({ keep: keep.checked }));
    atLogin.addEventListener("change", () => set({ atLogin: atLogin.checked }));
  }

  const off = ctl.onEvent((e) => {
    if (e.type === "task_done") void paint();
  });
  dlg.append(
    h("div", { class: "dh" }, "⏰ Tác vụ định kỳ", h("button", { class: "btn sm", type: "button", "aria-label": "Đóng", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "db" },
      h("div", { class: "hint" }, `${opts.desktop ? "Chạy khi ứng dụng đang mở, kể cả dự án chưa mở" : "Chỉ chạy khi tab này đang mở"}; tối đa ${MAX_RUNS_PER_DAY} lần/ngày. Chỉ sửa tệp trong dự án: lệnh, mạng, tệp nhạy cảm bị từ chối.`),
      list,
      h("div", { class: "tk-new" }, name, prompt, h("div", { class: "tk-sched" }, kind, day, date, time, mins, minsLbl), h("button", { class: "btn primary", type: "button", onclick: () => void add() }, "Thêm tác vụ")),
      err,
      notify ? h("label", { class: "chk" }, notify, "Thông báo của hệ thống khi xong hoặc lỗi") : "",
      bg ? keepRow : "",
      bg ? atLoginRow : ""),
  );
  dlg.addEventListener("close", () => {
    off();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  void paint();
}
