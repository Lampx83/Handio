import { brandify, brandText } from "./brand";
import { EXERCISES, LESSONS, PROJECT_TEMPLATES } from "./curriculum";
import type { Env } from "./env";
import type { Exercise, Lesson, ProjectTemplate } from "./learning-types";
import { dirname, join } from "./path";

export interface ExerciseSummary {
  id: string;
  lang: Exercise["lang"];
  level: 1 | 2 | 3;
  title: string;
  goal: string;
  minutes: number;
  concepts: string[];
  hintCount: number;
  started: boolean;
  last?: GradeResult;
}
export interface GradeItem {
  name: string;
  ok: boolean;
  message: string;
}
export interface GradeResult {
  exercise: string;
  passed: number;
  total: number;
  items: GradeItem[];
  output: string;
  ranAt: number;
  error?: string;
}
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  lang: ProjectTemplate["lang"];
  startPrompts: string[];
}

export const listLessons = (): Lesson[] => brandify(LESSONS);
export const getExercise = (id: string): Exercise | undefined => EXERCISES.find((e) => e.id === id);
const exDir = (id: string) => `bai-tap/${id}`;
const metaFile = (id: string) => `.neuagent/exercises/${id}/result.json`;

export async function listExercises(env: Env, root: string): Promise<ExerciseSummary[]> {
  const out: ExerciseSummary[] = [];
  for (const e of EXERCISES) {
    const started = !!(await env.stat(join(root, exDir(e.id), "DE-BAI.md")));
    let last: GradeResult | undefined;
    if (started) {
      try {
        last = JSON.parse(new TextDecoder().decode(await env.readBytes(join(root, metaFile(e.id)))));
      } catch {
        /* chưa chấm */
      }
    }
    out.push({ id: e.id, lang: e.lang, level: e.level, title: e.title, goal: e.goal, minutes: e.minutes, concepts: e.concepts, hintCount: e.hints.length, started, last });
  }
  return out;
}

/** Tạo thư mục bài tập (KHÔNG ghi đè bài làm đang có). Lời giải không bao giờ được ghi ra. */
export async function startExercise(env: Env, root: string, id: string): Promise<{ dir: string; created: string[] }> {
  const ex = getExercise(id);
  if (!ex) throw new Error("Không có bài tập " + id);
  const dir = exDir(id);
  const created: string[] = [];
  const write = async (rel: string, text: string) => {
    const abs = join(root, dir, rel);
    if (await env.stat(abs)) return;
    await env.mkdirp(dirname(abs));
    await env.writeText(abs, text);
    created.push(`${dir}/${rel}`);
  };
  await write("DE-BAI.md", brandText(`# ${ex.title}\n\n*Mục tiêu: ${ex.goal}*\n\n${ex.instructions}\n`));
  for (const [rel, text] of Object.entries(ex.files)) await write(rel, text);
  return { dir, created };
}

export function exerciseHint(id: string, n: number): { text: string; index: number; total: number } {
  const ex = getExercise(id);
  if (!ex) throw new Error("Không có bài tập " + id);
  const i = Math.max(0, Math.min(Math.floor(n), ex.hints.length - 1));
  return { text: ex.hints[i], index: i + 1, total: ex.hints.length };
}

/** Phân tích đầu ra của tệp chấm theo giao thức PASS/FAIL. */
export function parseGrade(id: string, output: string, error?: string): GradeResult {
  const items: GradeItem[] = [];
  for (const line of output.split("\n")) {
    const m = /^(PASS|FAIL)\s+(.+?)(?::\s*(.*))?$/.exec(line.trim());
    if (m) items.push({ name: m[2].trim(), ok: m[1] === "PASS", message: m[3]?.trim() ?? "" });
  }
  return { exercise: id, passed: items.filter((i) => i.ok).length, total: items.length, items, output: output.slice(-4000), ranAt: Date.now(), error };
}

/** Chấm bài: chạy tệp chấm bằng lệnh thật (Desktop) hoặc hộp cát JavaScript (web). Python cần Python trên máy. */
export async function gradeExercise(env: Env, root: string, id: string): Promise<GradeResult> {
  const ex = getExercise(id);
  if (!ex) throw new Error("Không có bài tập " + id);
  const dir = exDir(id);
  if (!(await env.stat(join(root, dir, ex.check)))) throw new Error("Bạn chưa bắt đầu bài này (chưa có thư mục bài).");
  let result: GradeResult;
  if (env.exec) {
    const cmd = ex.check.endsWith(".py") ? `python3 ${ex.check} || python ${ex.check}` : `node ${ex.check}`;
    const r = await env.exec(cmd, { cwd: join(root, dir), timeoutMs: 20_000 });
    result = parseGrade(id, r.output, r.timedOut ? "Hết thời gian (có thể chương trình của bạn bị lặp vô hạn)." : r.code !== 0 && !/^(PASS|FAIL)/m.test(r.output) ? `Không chạy được tệp chấm: ${r.output.trim().slice(0, 300)}` : undefined);
  } else if (env.runJs && ex.check.endsWith(".js")) {
    const files: Record<string, string> = {};
    const dec = new TextDecoder();
    for (const e of await env.readdir(join(root, dir))) if (!e.isDir) files[`${dir}/${e.name}`] = dec.decode(await env.readBytes(join(root, dir, e.name)));
    const r = await env.runJs(`require("./${dir}/${ex.check}")`, { timeoutMs: 8000, files, cwd: dir });
    result = parseGrade(id, r.logs.join("\n"), !r.ok && !r.logs.some((l) => /^FAIL/.test(l)) && r.error && !/process\.exit/.test(r.error) ? r.error.split("\n")[0] : undefined);
  } else {
    throw new Error("Chấm bài Python cần bản Desktop (có Python trên máy). Bài JavaScript và HTML chấm được ngay trong trình duyệt.");
  }
  try {
    await env.mkdirp(join(root, ".neuagent", "exercises", id));
    await env.writeText(join(root, metaFile(id)), JSON.stringify(result));
  } catch {
    /* không lưu được kết quả: bỏ qua */
  }
  return result;
}

export const listTemplates = (): TemplateSummary[] => brandify(PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, lang: t.lang, startPrompts: t.startPrompts })));

export async function createFromTemplate(env: Env, root: string, id: string): Promise<{ dir: string; files: number }> {
  const t = PROJECT_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error("Không có dự án mẫu " + id);
  let dir = t.id;
  for (let n = 2; await env.stat(join(root, dir)); n++) dir = `${t.id}-${n}`;
  for (const [rel, text] of Object.entries(t.files)) {
    const abs = join(root, dir, rel);
    await env.mkdirp(dirname(abs));
    await env.writeText(abs, brandText(text));
  }
  return { dir, files: Object.keys(t.files).length };
}
