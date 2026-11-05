import { describe, expect, it } from "vitest";
import { toProbeSteps } from "../../code-bench/shared.mjs";
import { compareRuns, formatComparison, formatReport, median, overview, taskStats, type Attempt, type RunSummary, type TaskResult } from "../stats";

const att = (pass: boolean, steps = 5, extra: Partial<Attempt["metrics"]> = {}): Attempt => ({
  n: 1,
  pass,
  checks: [{ name: "kiểm tra A", ok: pass }],
  metrics: { seconds: 10, steps, calls: 3, promptTokens: 100, completionTokens: 20, cachedTokens: 0, toolErrors: 0, errKinds: {}, asked: 0, endedBy: "done", ...extra },
});
const task = (id: string, group: TaskResult["group"], attempts: Attempt[]): TaskResult => ({ id, title: id, group, profile: "code", attempts });
const run = (sha: string, tasks: TaskResult[], o: Partial<RunSummary> = {}): RunSummary => ({ stamp: "t", sha, dirty: false, model: "m", k: 5, tasks, ...o });

describe("tổng hợp kết quả", () => {
  it("trung vị đúng với số lẻ, số chẵn và mảng rỗng", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("tỉ lệ đạt, pass@k và luôn đạt tách bạch nhau", () => {
    const ts = [task("a", "capability", [att(true), att(true)]), task("b", "capability", [att(true), att(false)]), task("c", "capability", [att(false), att(false)])];
    expect(taskStats(ts[1])).toMatchObject({ passes: 1, k: 2, rate: 0.5 });
    expect(overview(ts)).toMatchObject({ tasks: 3, rate: 0.5, atLeastOnce: 2, always: 1 });
  });

  it("bài bị bỏ qua không tính vào tỉ lệ", () => {
    expect(overview([task("a", "capability", [att(true)]), { ...task("b", "capability", []), skipped: "thiếu python" }])).toMatchObject({ tasks: 1, rate: 1 });
  });

  it("báo cáo tách hai nhóm, nêu kiểm tra không đạt và loại lỗi công cụ", () => {
    const md = formatReport(run("abc", [task("a", "regression", [att(true)]), task("b", "capability", [att(false, 5, { toolErrors: 2, errKinds: { "pptx_edit:no_match": 2 } })])]));
    expect(md).toContain("## Regression");
    expect(md).toContain("## Capability");
    expect(md).toContain("pptx_edit:no_match ×2");
    expect(md).toContain("**b**: kiểm tra A (1/1)");
    expect(md).toContain("Máy chủ không báo token dùng lại");
  });

  it("có số token dùng lại thì báo tỉ lệ", () => {
    expect(formatReport(run("a", [task("a", "capability", [att(true, 5, { cachedTokens: 40 })])]))).toContain("bộ nhớ đệm: 40%");
  });
});

describe("so sánh hai lần chạy", () => {
  const before = run("aaa", [task("r", "regression", [att(true), att(true)]), task("c", "capability", [att(false), att(false)]), task("cu", "capability", [att(true)])]);
  const after = run("bbb", [task("r", "regression", [att(true), att(false)]), task("c", "capability", [att(true), att(false)]), task("moi", "capability", [att(true)])]);

  it("nhận ra tụt, tăng và bài chỉ có ở một bên", () => {
    const c = compareRuns(before, after);
    const v = Object.fromEntries(c.rows.map((r) => [r.id, r.verdict]));
    expect(v).toEqual({ r: "tụt", c: "tăng", cu: "?", moi: "?" });
    expect(c.regressionDrops).toEqual(["r"]);
  });

  it("capability tụt không tính là regression", () => {
    const c = compareRuns(run("a", [task("c", "capability", [att(true)])]), run("b", [task("c", "capability", [att(false)])]));
    expect(c.regressionDrops).toEqual([]);
  });

  it("cảnh báo khi hai lần chạy không so được với nhau", () => {
    const w = compareRuns(run("a", [], { model: "m1", k: 3, dirty: true }), run("b", [], { model: "m2", k: 5 })).warnings.join("\n");
    expect(w).toContain("mô hình khác nhau");
    expect(w).toContain("Số lần mỗi bài khác nhau");
    expect(w).toContain("chưa commit");
    expect(w).toContain("ngẫu nhiên");
  });

  it("bảng so sánh ghi rõ trước → sau", () => {
    const md = formatComparison(before, after);
    expect(md).toContain("2/2 → 1/2");
    expect(md).toContain("Regression bị tụt: r");
    expect(md).toContain("mới 1/1");
  });
});

describe("bước của check_page sang trình duyệt ẩn", () => {
  it("đổi đủ bốn loại bước", () => {
    expect(toProbeSteps([{ action: "click", text: "Nộp" }, { action: "click", selector: "#a" }, { action: "type", text: "Tên", value: "An" }, { action: "wait", ms: 200 }])).toEqual([{ click: { text: "Nộp" } }, { click: { selector: "#a" } }, { fill: { placeholder: "Tên" }, value: "An" }, { wait: 200 }]);
  });

  it("chữ cần thấy có ngoặc kép không làm hỏng biểu thức", () => {
    const [st] = toProbeSteps([{ action: "expect_text", text: 'Nút "Lưu"' }]);
    expect(st.eval).toBe('document.body.innerText.includes("Nút \\"Lưu\\"")');
  });
});
