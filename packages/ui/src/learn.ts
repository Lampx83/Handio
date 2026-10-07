import type { AgentController, ExerciseSummary, GradeResult, Lesson, TemplateSummary } from "@neu/agent-core";
import { clear, h } from "./dom";
import { renderMarkdown } from "./markdown";

export interface LearnHooks {
  /** Điền một câu vào ô chat (không tự gửi). */
  onTry(prompt: string): void;
  /** Mở/hiện một đường dẫn trong thanh tệp. */
  onReveal(path: string): void;
}

type Tab = "lessons" | "exercises" | "templates";
const LANG: Record<string, string> = { js: "JavaScript", py: "Python", html: "HTML" };
const LEVEL = ["", "Nhập môn", "Cơ bản", "Nâng cao"];

/** Hộp “Học vibe coding”: giáo trình theo buổi, bài tập chấm tự động, dự án mẫu. */
export async function openLearn(ctl: AgentController, hooks: LearnHooks, initial: Tab = "lessons"): Promise<void> {
  const dlg = h("dialog", { class: "learn" });
  const body = h("div", { class: "learn-body" });
  const tabs = h("div", { class: "learn-tabs", role: "tablist" });
  let tab: Tab = initial;
  let lessons: Lesson[] = [];
  let exercises: ExerciseSummary[] = [];
  let templates: TemplateSummary[] = [];
  let selLesson = 0;
  let selEx = "";
  const hintShown = new Map<string, number>();
  const grades = new Map<string, GradeResult | { error: string }>();

  const close = () => dlg.close();
  const md = (src: string, cls = "msg-ai") => h("div", { class: cls, html: renderMarkdown(src) });
  const pill = (t: string, cls = "") => h("span", { class: "lp " + cls }, t);

  const paintTabs = () => {
    clear(tabs);
    for (const [id, label] of [["lessons", `Bài học (${lessons.length})`], ["exercises", `Bài tập (${exercises.length})`], ["templates", `Dự án mẫu (${templates.length})`]] as const)
      tabs.append(h("button", { class: "ltab", type: "button", role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; paint(); } }, label));
  };

  // ------------------------------------------------------------ bài học
  const paintLessons = () => {
    const list = h("div", { class: "learn-list", role: "listbox", "aria-label": "Danh sách bài học" }, ...lessons.map((l, i) =>
      h("button", { class: "li" + (i === selLesson ? " sel" : ""), type: "button", role: "option", "aria-selected": String(i === selLesson), onclick: () => { selLesson = i; paint(); } },
        h("span", { class: "n" }, l.id.startsWith("buoi-") ? "B" + l.order : "CĐ" + l.order), h("span", { class: "t" }, l.title), h("span", { class: "m" }, l.minutes + "′"))));
    const l = lessons[selLesson];
    const detail = h("div", { class: "learn-detail" });
    if (l) {
      detail.append(h("h3", {}, l.title), h("div", { class: "goals" }, ...l.goals.map((g) => pill("🎯 " + g))), md(l.intro));
      l.steps.forEach((s, i) => {
        const tries = (s.try ?? []).map((p) => h("button", { class: "chip try", type: "button", title: "Điền vào ô chat để thử", onclick: () => { hooks.onTry(p); close(); } }, "▶ Thử: " + (p.length > 90 ? p.slice(0, 88) + "…" : p)));
        detail.append(h("details", { class: "step", open: i === 0 }, h("summary", {}, `${i + 1}. ${s.title}`), md(s.body), ...tries, s.check ? h("div", { class: "hint" }, "Tự kiểm tra: " + s.check) : null));
      });
      if (l.takeaways.length) detail.append(h("div", { class: "take" }, h("b", {}, "Điều cần nhớ"), h("ul", {}, ...l.takeaways.map((t) => h("li", { html: renderMarkdown(t).replace(/^<p>|<\/p>$/g, "") })))));
      if (l.exercises?.length) detail.append(h("div", { class: "rel" }, h("b", {}, "Bài tập liên quan: "), ...l.exercises.map((id) => h("button", { class: "btn sm", type: "button", onclick: () => { tab = "exercises"; selEx = id; paint(); } }, exercises.find((e) => e.id === id)?.title ?? id))));
    }
    body.append(h("div", { class: "learn-split" }, list, detail));
  };

  // ------------------------------------------------------------ bài tập
  const status = (e: ExerciseSummary) => (!e.started ? pill("chưa làm") : !e.last ? pill("đã bắt đầu", "info") : e.last.total && e.last.passed === e.last.total ? pill("✓ đạt " + e.last.passed + "/" + e.last.total, "ok") : pill(`${e.last.passed}/${e.last.total || "?"}`, "warn"));
  const paintExercises = async () => {
    const list = h("div", { class: "learn-list", role: "listbox", "aria-label": "Danh sách bài tập" }, ...exercises.map((e) =>
      h("button", { class: "li" + (e.id === selEx ? " sel" : ""), type: "button", role: "option", "aria-selected": String(e.id === selEx), onclick: () => { selEx = e.id; paint(); } },
        h("span", { class: "n" }, LANG[e.lang]?.slice(0, 2).toUpperCase() ?? ""), h("span", { class: "t" }, e.title), status(e))));
    const detail = h("div", { class: "learn-detail" });
    const ex = exercises.find((e) => e.id === selEx);
    if (!ex) detail.append(h("div", { class: "hint", style: { padding: "20px" } }, "Chọn một bài tập ở bên trái. Mỗi bài có đề, gợi ý theo bậc và nút “Chấm bài” tự động. Bài làm nằm trong thư mục bai-tap/ của dự án."));
    else {
      const info = await ctl.learnExercise?.(ex.id);
      if (info && !("error" in info)) {
        const shown = hintShown.get(ex.id) ?? 0;
        const res = grades.get(ex.id) ?? (ex.last ? ex.last : undefined);
        const resBox = h("div", { class: "grade" });
        if (res && "error" in res && res.error && !("items" in res)) resBox.append(h("div", { class: "notice warn" }, res.error));
        else if (res && "items" in res) {
          resBox.append(h("div", { class: "gsum " + (res.total && res.passed === res.total ? "ok" : "warn") }, res.total && res.passed === res.total ? `🎉 Đạt tất cả ${res.total} bài kiểm tra!` : `Đạt ${res.passed}/${res.total || "?"} bài kiểm tra`));
          if (res.error) resBox.append(h("div", { class: "notice warn" }, res.error));
          for (const it of res.items) resBox.append(h("div", { class: "gi " + (it.ok ? "ok" : "bad") }, h("span", {}, it.ok ? "✓" : "✗"), h("b", {}, it.name), it.message ? h("span", { class: "msg" }, it.message) : null));
        }
        const dir = `bai-tap/${ex.id}`;
        const hintsBox = h("div", { class: "hints" });
        for (let i = 0; i < shown; i++) {
          const el = h("div", { class: "hintcard" }, h("b", {}, `Gợi ý ${i + 1}: `));
          hintsBox.append(el);
          void ctl.learnHint?.(ex.id, i).then((r) => { if (r && !("error" in r)) el.append(r.text); });
        }
        detail.append(
          h("h3", {}, info.title), h("div", { class: "goals" }, pill(LANG[info.lang] ?? info.lang), pill(LEVEL[info.level] ?? ""), pill("~" + info.minutes + " phút"), ...info.concepts.map((c) => pill("#" + c))),
          h("p", { class: "hint" }, "🎯 " + info.goal),
          h("div", { class: "learn-actions" },
            h("button", { class: "btn primary", type: "button", onclick: async () => { const r = await ctl.learnStart?.(ex.id); if (r && "error" in r) alert(r.error); else { hooks.onReveal(dir); exercises = (await ctl.learnExercises?.()) ?? exercises; paint(); } } }, ex.started ? "Mở lại thư mục bài" : "▶ Bắt đầu bài này"),
            h("button", { class: "btn", type: "button", disabled: !ex.started, onclick: async () => { const r = await ctl.learnGrade?.(ex.id); if (r) grades.set(ex.id, r); exercises = (await ctl.learnExercises?.()) ?? exercises; paint(); } }, "✔ Chấm bài"),
            h("button", { class: "btn", type: "button", disabled: shown >= info.hintCount, onclick: () => { hintShown.set(ex.id, shown + 1); paint(); } }, shown ? `Gợi ý tiếp (${shown}/${info.hintCount})` : "💡 Cần gợi ý?"),
            h("button", { class: "btn", type: "button", disabled: !ex.started, onclick: () => { hooks.onTry(`Tôi đang làm bài tập trong thư mục @${dir}. Hãy GỢI Ý (đừng đưa nguyên lời giải) để tôi tự làm tiếp.${res && "items" in res && res.passed < res.total ? " Kết quả chấm hiện tại: " + res.items.filter((i) => !i.ok).map((i) => `${i.name}: ${i.message}`).join("; ") : ""}`); close(); } }, "Hỏi AI (gợi ý)")),
          hintsBox,
          resBox,
          h("h4", {}, "Đề bài"), md(info.instructions),
        );
      }
    }
    clear(body);
    body.append(h("div", { class: "learn-split" }, list, detail));
  };

  // ------------------------------------------------------------ dự án mẫu
  const paintTemplates = () => {
    body.append(h("div", { class: "cards" }, ...templates.map((t) => {
      const out = h("div", { class: "hint" });
      return h("div", { class: "card" }, h("h4", {}, t.name), h("div", { class: "goals" }, pill(LANG[t.lang] ?? "Nhiều ngôn ngữ")), h("p", {}, t.description),
        h("button", { class: "btn primary", type: "button", onclick: async () => { const r = await ctl.learnCreate?.(t.id); if (r && "error" in r) out.textContent = r.error; else if (r) { hooks.onReveal(r.dir); out.textContent = `Đã tạo thư mục ${r.dir}/ (${r.files} tệp).`; } } }, "Tạo dự án này"),
        ...t.startPrompts.slice(0, 3).map((p) => h("button", { class: "chip try", type: "button", onclick: () => { hooks.onTry(p); close(); } }, "▶ " + (p.length > 80 ? p.slice(0, 78) + "…" : p))), out);
    })));
  };

  const paint = () => {
    paintTabs();
    clear(body);
    if (tab === "lessons") paintLessons();
    else if (tab === "exercises") void paintExercises();
    else paintTemplates();
  };

  dlg.append(h("div", { class: "dh" }, h("span", {}, "📚 Học vibe coding"), h("button", { class: "btn sm", type: "button", onclick: close }, "Đóng")), tabs, body);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  body.append(h("div", { class: "hint", style: { padding: "20px" } }, "Đang tải…"));
  [lessons, exercises, templates] = await Promise.all([ctl.learnLessons?.() ?? [], ctl.learnExercises?.() ?? [], ctl.learnTemplates?.() ?? []]);
  if (!selEx && exercises.length) selEx = "";
  paint();
}
