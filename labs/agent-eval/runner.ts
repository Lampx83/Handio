// Chuẩn bị đề, chạy agent, chấm; và kiểm chứng bộ chấm bằng lời giải mẫu. Không tự gọi mô hình: hàm chạy agent được truyền vào.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { Grader, sh } from "./grade";
import { startProcess, type EvalTask, type SolveCtx } from "./tasks";
import type { Attempt, CheckResult, Metrics, TaskResult } from "./stats";
import type { AgentRun } from "../code-bench/harness";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = net.createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });

async function waitPort(port: number, ms = 15_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise<boolean>((r) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.destroy();
        r(true);
      });
      s.on("error", () => r(false));
    });
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

export interface Prepared {
  dir: string;
  ports: Record<string, number>;
  prompt: string;
  seeded: Record<string, string>;
}

/** Tạo thư mục đề: tệp sẵn có, cổng trống, thay {{…}} trong đề và tệp. */
export async function prepare(t: EvalTask, base: string): Promise<Prepared> {
  fs.rmSync(base, { recursive: true, force: true });
  const dir = path.join(base, "app");
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir); // macOS: /tmp là liên kết; đường dẫn trong đề phải là đường dẫn thật
  const ports: Record<string, number> = {};
  for (const p of t.ports ?? []) ports[p] = await freePort();
  const fill = (s: string) => s.replaceAll("{{DIR}}", real).replace(/\{\{(\w+)\}\}/g, (m, k) => (ports[k] !== undefined ? String(ports[k]) : m));
  const seeded: Record<string, string> = {};
  for (const [p, text] of Object.entries(t.seed ?? {})) {
    const f = path.join(real, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, (seeded[p] = fill(text)));
  }
  await t.setup?.(real);
  return { dir: real, ports, prompt: fill(t.prompt), seeded };
}

export async function gradeTask(t: EvalTask, p: Prepared, o: { final: string; errKinds: Record<string, number>; root: string; tmpDir: string }): Promise<CheckResult[]> {
  const g = new Grader({ dir: p.dir, ports: p.ports, seeded: p.seeded, final: o.final, errKinds: o.errKinds, root: o.root, tmpDir: o.tmpDir });
  try {
    await t.grade(g);
  } catch (e) {
    g.add("bộ chấm chạy được", false, (e as Error).message);
  }
  return g.results;
}

const metricsOf = (r: AgentRun): Metrics => ({ seconds: r.seconds, steps: r.steps, calls: r.calls, promptTokens: r.promptTokens, completionTokens: r.completionTokens, cachedTokens: r.cachedTokens, toolErrors: r.toolErrors, errKinds: r.errKinds, asked: r.asked, endedBy: r.endedBy });

export type RunAgentFn = (o: { dir: string; prompt: string; profile: EvalTask["profile"]; beforeDispose: (run: AgentRun) => Promise<void> }) => Promise<AgentRun>;

/** Một lần chạy một bài. Chấm TRƯỚC khi dừng tiến trình nền, vì có bài chấm chính máy chủ agent đã bật. Hết giờ hay lỗi đều tính không đạt. */
export async function runAttempt(t: EvalTask, n: number, base: string, o: { runAgent: RunAgentFn; root: string; tmpDir: string }): Promise<{ attempt: Attempt; run: AgentRun }> {
  const p = await prepare(t, base);
  let checks: CheckResult[] = [];
  const run = await o.runAgent({
    dir: p.dir,
    prompt: p.prompt,
    profile: t.profile,
    beforeDispose: async (r) => {
      checks = await gradeTask(t, p, { final: r.final, errKinds: r.errKinds, root: o.root, tmpDir: o.tmpDir });
    },
  });
  if (run.endedBy !== "done") checks = [{ name: "agent kết thúc bình thường", ok: false, detail: `${run.endedBy}: ${run.errors.at(-1) ?? ""}`.slice(0, 300) }, ...checks];
  if (!checks.length) checks = [{ name: "bộ chấm chạy được", ok: false, detail: run.errors.at(-1) ?? "không có kết quả chấm" }];
  return { attempt: { n, pass: checks.every((c) => c.ok), checks, metrics: metricsOf(run) }, run };
}

/** Máy có lệnh bài yêu cầu không; thiếu thì bài bị bỏ qua, không tính là hỏng. */
export async function missingRequirement(t: EvalTask, cwd: string): Promise<string | null> {
  if (!t.requires) return null;
  return (await sh(t.requires, cwd, 20_000)).code === 0 ? null : `thiếu: ${t.requires}`;
}

export interface SelfCheck {
  id: string;
  /** Đề chưa làm không được đạt (đạt nghĩa là bộ chấm vô dụng). */
  unsolvedFails: boolean;
  solvedPasses: boolean;
  failed: CheckResult[];
}

/** Kiểm chứng bộ chấm của một bài: chưa làm phải đỏ, làm theo lời giải mẫu phải xanh. */
export async function selfCheck(t: EvalTask, base: string, o: { root: string; tmpDir: string }): Promise<SelfCheck> {
  const p = await prepare(t, base);
  const empty = await gradeTask(t, p, { final: "", errKinds: {}, root: o.root, tmpDir: o.tmpDir });
  const procs: ChildProcess[] = [];
  const s: SolveCtx = {
    dir: p.dir,
    ports: p.ports,
    final: "",
    write: (f, data) => {
      fs.mkdirSync(path.dirname(path.join(p.dir, f)), { recursive: true });
      fs.writeFileSync(path.join(p.dir, f), data);
    },
    read: (f) => fs.readFileSync(path.join(p.dir, f), "utf8"),
    serve: async (cmd, cwd, port) => {
      procs.push(startProcess(cmd, path.join(p.dir, cwd)));
      if (!(await waitPort(p.ports[port]))) throw new Error(`"${cmd}" không mở cổng ${port}`);
    },
  };
  try {
    await t.solve(s);
    const solved = await gradeTask(t, p, { final: s.final, errKinds: {}, root: o.root, tmpDir: o.tmpDir });
    return { id: t.id, unsolvedFails: empty.some((c) => !c.ok), solvedPasses: solved.length > 0 && solved.every((c) => c.ok), failed: solved.filter((c) => !c.ok) };
  } finally {
    for (const c of procs) {
      try {
        process.kill(-c.pid!, "SIGKILL");
      } catch {
        /* đã thoát */
      }
    }
  }
}

export const taskResult = (t: EvalTask): TaskResult => ({ id: t.id, title: t.title, group: t.group, profile: t.profile, attempts: [] });
