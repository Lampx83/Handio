// Tổng hợp và so sánh kết quả: thuần dữ liệu, không gọi mô hình, không đụng tệp.
export type Group = "regression" | "capability";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Metrics {
  seconds: number;
  steps: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  toolErrors: number;
  errKinds: Record<string, number>;
  asked: number;
  endedBy: string;
}

export interface Attempt {
  n: number;
  pass: boolean;
  checks: CheckResult[];
  metrics: Metrics;
}

export interface TaskResult {
  id: string;
  title: string;
  group: Group;
  profile: string;
  attempts: Attempt[];
  /** Không chạy được trên máy này (thiếu python…). */
  skipped?: string;
}

export interface RunSummary {
  stamp: string;
  /** Commit đang chạy; `dirty` = có thay đổi chưa commit. */
  sha: string;
  dirty: boolean;
  model: string;
  k: number;
  tasks: TaskResult[];
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface TaskStats {
  passes: number;
  k: number;
  rate: number;
  steps: number;
  tokens: number;
  toolErrors: number;
  seconds: number;
}

export function taskStats(t: TaskResult): TaskStats {
  const a = t.attempts;
  return {
    passes: a.filter((x) => x.pass).length,
    k: a.length,
    rate: a.length ? a.filter((x) => x.pass).length / a.length : 0,
    steps: median(a.map((x) => x.metrics.steps)),
    tokens: median(a.map((x) => x.metrics.promptTokens + x.metrics.completionTokens)),
    toolErrors: median(a.map((x) => x.metrics.toolErrors)),
    seconds: median(a.map((x) => x.metrics.seconds)),
  };
}

export interface Overview {
  tasks: number;
  /** Trung bình tỉ lệ đạt của các bài. */
  rate: number;
  /** pass@k: số bài đạt ít nhất một lần trong k lần. */
  atLeastOnce: number;
  /** Số bài đạt cả k lần. */
  always: number;
}

export function overview(ts: TaskResult[]): Overview {
  const run = ts.filter((t) => t.attempts.length);
  const st = run.map(taskStats);
  return {
    tasks: run.length,
    rate: st.length ? st.reduce((n, s) => n + s.rate, 0) / st.length : 0,
    atLeastOnce: st.filter((s) => s.passes > 0).length,
    always: st.filter((s) => s.passes === s.k).length,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const GROUP_LABEL: Record<Group, string> = { regression: "Regression (đã từng sửa, phải luôn đạt)", capability: "Capability (đang cải thiện)" };

/** Mọi lỗi công cụ của một bài, gộp theo loại, nhiều nhất trước. */
function topErrKinds(t: TaskResult, max = 3): string {
  const n = new Map<string, number>();
  for (const a of t.attempts) for (const [k, v] of Object.entries(a.metrics.errKinds)) n.set(k, (n.get(k) ?? 0) + v);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, v]) => `${k} ×${v}`).join(", ");
}

export function formatReport(s: RunSummary): string {
  const out = [`# Kết quả eval: ${s.stamp}`, "", `Commit \`${s.sha}\`${s.dirty ? " (có thay đổi chưa commit)" : ""}, mô hình \`${s.model}\`, ${s.k} lần mỗi bài.`, ""];
  for (const g of ["regression", "capability"] as Group[]) {
    const ts = s.tasks.filter((t) => t.group === g);
    if (!ts.length) continue;
    const o = overview(ts);
    out.push(`## ${GROUP_LABEL[g]}`, "", `Tỉ lệ đạt ${pct(o.rate)}; luôn đạt ${o.always}/${o.tasks}; đạt ít nhất một lần (pass@${s.k}) ${o.atLeastOnce}/${o.tasks}.`, "");
    out.push("| Bài | Đạt | Bước | Token | Lỗi công cụ | Giây | Lỗi hay gặp |", "|---|---|---|---|---|---|---|");
    for (const t of ts) {
      if (t.skipped) {
        out.push(`| ${t.id} | bỏ qua | | | | | ${t.skipped} |`);
        continue;
      }
      const st = taskStats(t);
      out.push(`| ${t.id} | ${st.passes}/${st.k} | ${st.steps} | ${st.tokens} | ${st.toolErrors} | ${st.seconds} | ${topErrKinds(t)} |`);
    }
    out.push("");
  }
  const cached = s.tasks.flatMap((t) => t.attempts).reduce((n, a) => n + a.metrics.cachedTokens, 0);
  const prompt = s.tasks.flatMap((t) => t.attempts).reduce((n, a) => n + a.metrics.promptTokens, 0);
  out.push(prompt && cached ? `Token lời nhắc dùng lại từ bộ nhớ đệm: ${pct(cached / prompt)}.` : "Máy chủ không báo token dùng lại từ bộ nhớ đệm.", "");
  const failed = s.tasks.filter((t) => t.attempts.some((a) => !a.pass));
  if (failed.length) out.push("## Kiểm tra không đạt", "");
  for (const t of failed) {
    const n = new Map<string, number>();
    for (const a of t.attempts) for (const c of a.checks) if (!c.ok) n.set(c.name, (n.get(c.name) ?? 0) + 1);
    out.push(`- **${t.id}**: ${[...n].map(([k, v]) => `${k} (${v}/${t.attempts.length})`).join("; ")}`);
  }
  return out.join("\n").trimEnd() + "\n";
}

export interface CompareRow {
  id: string;
  group: Group;
  a?: TaskStats;
  b?: TaskStats;
  /** "tụt": B đạt ít hơn A; "tăng": đạt nhiều hơn; "=" như nhau; "?" một bên không có dữ liệu. */
  verdict: "tụt" | "tăng" | "=" | "?";
}

export interface Comparison {
  rows: CompareRow[];
  /** Bài regression bị tụt: thay đổi đang làm hỏng thứ đã chạy được. */
  regressionDrops: string[];
  warnings: string[];
}

export function compareRuns(a: RunSummary, b: RunSummary): Comparison {
  const ids = [...new Set([...a.tasks, ...b.tasks].map((t) => t.id))];
  const find = (s: RunSummary, id: string) => s.tasks.find((t) => t.id === id && t.attempts.length);
  const rows = ids.map((id): CompareRow => {
    const ta = find(a, id), tb = find(b, id);
    const sa = ta && taskStats(ta), sb = tb && taskStats(tb);
    const verdict = !sa || !sb ? "?" : sb.rate < sa.rate ? "tụt" : sb.rate > sa.rate ? "tăng" : "=";
    return { id, group: (tb ?? ta ?? a.tasks.find((t) => t.id === id) ?? b.tasks.find((t) => t.id === id))!.group, a: sa, b: sb, verdict };
  });
  const warnings: string[] = [];
  if (a.model !== b.model) warnings.push(`Hai lần chạy dùng mô hình khác nhau (${a.model} / ${b.model}): không chỉ đo thay đổi mã.`);
  if (a.k !== b.k) warnings.push(`Số lần mỗi bài khác nhau (${a.k} / ${b.k}).`);
  if (a.dirty || b.dirty) warnings.push("Có lần chạy trên mã chưa commit: khó chạy lại đúng như vậy.");
  if (Math.min(a.k, b.k) < 5) warnings.push(`Mỗi bài chỉ chạy ${Math.min(a.k, b.k)} lần: chênh một lần đạt có thể chỉ là ngẫu nhiên, chạy thêm trước khi kết luận.`);
  return { rows, regressionDrops: rows.filter((r) => r.group === "regression" && r.verdict === "tụt").map((r) => r.id), warnings };
}

const signed = (from: number, to: number) => (to === from ? String(to) : `${from} → ${to}`);

export function formatComparison(a: RunSummary, b: RunSummary, c: Comparison = compareRuns(a, b)): string {
  const oa = overview(a.tasks), ob = overview(b.tasks);
  const out = [`# So sánh eval: \`${a.sha}\` → \`${b.sha}\``, "", `Tỉ lệ đạt ${pct(oa.rate)} → ${pct(ob.rate)}; luôn đạt ${oa.always}/${oa.tasks} → ${ob.always}/${ob.tasks}.`, ""];
  for (const w of c.warnings) out.push(`- Lưu ý: ${w}`);
  if (c.warnings.length) out.push("");
  if (c.regressionDrops.length) out.push(`**Regression bị tụt: ${c.regressionDrops.join(", ")}**`, "");
  out.push("| Bài | Nhóm | Đạt | Bước | Token | Lỗi công cụ | Kết luận |", "|---|---|---|---|---|---|---|");
  for (const r of c.rows) {
    const cell = (f: (s: TaskStats) => number | string) => (r.a && r.b ? signed(f(r.a) as number, f(r.b) as number) : "");
    const rate = r.a && r.b ? (r.a.passes === r.b.passes && r.a.k === r.b.k ? `${r.b.passes}/${r.b.k}` : `${r.a.passes}/${r.a.k} → ${r.b.passes}/${r.b.k}`) : r.b ? `mới ${r.b.passes}/${r.b.k}` : r.a ? `bỏ ${r.a.passes}/${r.a.k}` : "";
    out.push(`| ${r.id} | ${r.group} | ${rate} | ${cell((s) => s.steps)} | ${cell((s) => s.tokens)} | ${cell((s) => s.toolErrors)} | ${r.verdict} |`);
  }
  return out.join("\n") + "\n";
}
