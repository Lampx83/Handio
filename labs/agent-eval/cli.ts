// Dòng lệnh của bộ eval (xem README.md). Được run.mjs đóng gói bằng esbuild rồi gọi.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectModel, probeCheckPage } from "../code-bench/shared.mjs";
import { runAgent } from "../code-bench/harness";
import { missingRequirement, runAttempt, selfCheck, taskResult, type RunAgentFn } from "./runner";
import { compareRuns, formatComparison, formatReport, taskStats, type RunSummary } from "./stats";
import { TASKS, type EvalTask } from "./tasks";

const gitInfo = (root: string) => {
  const q = (c: string) => {
    try {
      return execSync(c, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return { sha: q("git rev-parse --short HEAD") || "?", dirty: !!q("git status --porcelain -- packages apps") };
};

function pick(args: string[]): EvalTask[] {
  const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : "");
  const only = opt("--only").split(",").map((s) => s.trim()).filter(Boolean);
  const group = opt("--group");
  return TASKS.filter((t) => (!only.length || only.some((p) => t.id.startsWith(p))) && (!group || t.group === group));
}

export async function main(args: string[], root: string): Promise<number> {
  const opt = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const tasks = pick(args);

  if (args.includes("--list")) {
    for (const t of tasks) console.log(`\n### ${t.id} [${t.group}, tab ${t.profile}] ${t.title}\nVì sao: ${t.why}\n\n${t.prompt}`);
    return 0;
  }
  if (args.includes("--compare")) {
    const i = args.indexOf("--compare");
    const load = (d: string): RunSummary => JSON.parse(fs.readFileSync(path.join(d, "summary.json"), "utf8"));
    if (!args[i + 2]) {
      console.error("Cần hai thư mục kết quả: --compare <trước> <sau>");
      return 2;
    }
    const a = load(args[i + 1]), b = load(args[i + 2]);
    const c = compareRuns(a, b);
    console.log(formatComparison(a, b, c));
    return c.regressionDrops.length ? 1 : 0;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // Mặc định NGOÀI kho: `npm install` của agent trong thư mục trống sẽ leo lên sửa package.json gần nhất.
  const outDir = path.resolve(opt("--out", path.join(os.tmpdir(), "handio-agent-eval", stamp)));
  fs.mkdirSync(outDir, { recursive: true });

  if (args.includes("--self-test")) {
    let bad = 0;
    for (const t of tasks) {
      const r = await selfCheck(t, path.join(outDir, t.id), { root, tmpDir: outDir });
      const ok = r.unsolvedFails && r.solvedPasses;
      if (!ok) bad++;
      console.log(`${ok ? "✓" : "✗"} ${t.id}${r.unsolvedFails ? "" : "  — đề chưa làm mà vẫn đạt"}${r.solvedPasses ? "" : "  — lời giải mẫu không đạt: " + r.failed.map((c) => `${c.name} (${c.detail ?? ""})`).join("; ")}`);
    }
    console.log(bad ? `\n${bad}/${tasks.length} bộ chấm có vấn đề.` : `\nCả ${tasks.length} bộ chấm hoạt động đúng.`);
    fs.rmSync(outDir, { recursive: true, force: true });
    return bad ? 1 : 0;
  }

  // Chỉ tới đây mới cần mô hình thật. Chạy tuần tự vì máy chủ chỉ có một GPU.
  const k = Math.max(1, Number(opt("--k", "3")) || 3);
  const timeoutMs = Number(opt("--timeout-min", "15")) * 60_000;
  const conn = await connectModel({ retry: "node labs/agent-eval/run.mjs --only 01 --k 1" });
  const go: RunAgentFn = (o) => runAgent({ ...o, ...conn, timeoutMs, checkPage: (url, c) => probeCheckPage(url, c, { root, tmpDir: outDir }) });
  const summary: RunSummary = { stamp, ...gitInfo(root), model: conn.model, k, tasks: [] };
  const save = () => {
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(outDir, "report.md"), formatReport(summary));
  };
  for (const t of tasks) {
    const res = taskResult(t);
    summary.tasks.push(res);
    const skip = await missingRequirement(t, outDir);
    if (skip) {
      res.skipped = skip;
      console.log(`\n▷ ${t.id}: bỏ qua (${skip})`);
      save();
      continue;
    }
    console.log(`\n▶ ${t.id} — ${t.title}`);
    for (let n = 1; n <= k; n++) {
      const base = path.join(outDir, t.id, String(n));
      const { attempt, run } = await runAttempt(t, n, base, { runAgent: go, root, tmpDir: outDir });
      res.attempts.push(attempt);
      fs.writeFileSync(path.join(base, "agent.log"), [`# ${t.id} lần ${n}: ${run.endedBy}, ${run.seconds}s, ${run.steps} bước, ${run.toolErrors} lỗi công cụ`, "", ...run.trace, "", "## Lời cuối", run.final, "", "## Thông báo", ...run.notices].join("\n"));
      fs.writeFileSync(path.join(base, "checks.json"), JSON.stringify(attempt.checks, null, 2));
      console.log(`  ${attempt.pass ? "✓" : "✗"} lần ${n}: ${run.seconds}s, ${run.steps} bước, ${run.toolErrors} lỗi công cụ${attempt.pass ? "" : " — " + attempt.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`);
      save();
      if (run.endedBy === "error" && run.steps === 0) {
        console.error(`\nAgent không làm được bước nào: ${[...run.notices, ...run.errors].join(" | ") || "không rõ lý do"}\nDừng cả lượt chạy (lỗi cấu hình/kết nối, không phải lỗi của bài).`);
        return 2;
      }
    }
    const st = taskStats(res);
    console.log(`  → đạt ${st.passes}/${st.k}`);
  }
  console.log(`\n${formatReport(summary)}\nChi tiết: ${outDir}`);
  // Regression không được hỏng; capability chỉ đo, không làm đỏ.
  return summary.tasks.some((t) => t.group === "regression" && t.attempts.some((a) => !a.pass)) ? 1 : 0;
}
