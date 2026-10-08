import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXERCISES, LESSONS, PROJECT_TEMPLATES } from "../src/curriculum";

/** Gom mọi chuỗi trong một giá trị lồng nhau (để quét từ cấm). */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (out.push(k), allStrings(x, out)));
  return out;
}

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

function runCheck(dir: string, check: string) {
  const isPy = check.endsWith(".py");
  const r = spawnSync(isPy ? "python3" : "node", [check], {
    cwd: dir,
    timeout: 10000,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
  });
  const lines = (r.stdout ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return { status: r.status, lines, stderr: r.stderr ?? "", timedOut: r.error != null };
}

const LINE_RE = /^(PASS .+|FAIL .+?: .+)$/;

describe("giáo trình: cấu trúc dữ liệu", () => {
  it("có đủ số lượng nội dung", () => {
    expect(LESSONS).toHaveLength(12);
    expect(EXERCISES.length).toBeGreaterThanOrEqual(16);
    expect(EXERCISES.filter((e) => e.lang === "js").length).toBeGreaterThanOrEqual(7);
    expect(EXERCISES.filter((e) => e.lang === "py").length).toBeGreaterThanOrEqual(7);
    expect(EXERCISES.filter((e) => e.lang === "html").length).toBeGreaterThanOrEqual(2);
    expect(PROJECT_TEMPLATES).toHaveLength(7);
    expect(PROJECT_TEMPLATES.map((p) => p.id)).toContain("chatbot-streamlit");
  });

  it("id duy nhất", () => {
    for (const list of [LESSONS, EXERCISES, PROJECT_TEMPLATES]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("id bài tập đúng quy ước theo ngôn ngữ", () => {
    for (const e of EXERCISES) expect(e.id, e.id).toMatch(new RegExp(`^${e.lang}-\\d{2}-[a-z0-9-]+$`));
  });

  it("thứ tự bài học liên tục 1..12; buổi 1..8 có id buoi-N-...", () => {
    expect(LESSONS.map((l) => l.order)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const l of LESSONS) if (l.order <= 8) expect(l.id, l.id).toMatch(new RegExp(`^buoi-${l.order}-[a-z0-9-]+$`));
    for (const l of LESSONS) if (l.order > 8) expect(l.id, l.id).toMatch(new RegExp(`^chuyen-de-${l.order}-[a-z0-9-]+$`));
  });

  it("buổi 1 bám sát khóa học: thuật ngữ, hoạt động thư viện giả, câu hỏi ôn tập", () => {
    const b1 = LESSONS[0];
    const text = JSON.stringify(b1);
    for (const kw of ["See", "Say", "Run", "Copy-paste", "Mục tiêu", "Ngữ cảnh", "Ràng buộc", "Mức 1", "Mức 2", "Mức 3", "host", "neu-fit-autograde", "người commit"]) {
      expect(text, `buổi 1 thiếu "${kw}"`).toContain(kw);
    }
    expect(b1.steps[b1.steps.length - 1].title).toBe("Câu hỏi ôn tập");
    expect(b1.steps[b1.steps.length - 1].body).toContain("<details><summary>Gợi ý</summary>");
    expect(b1.steps.length).toBeGreaterThanOrEqual(8);
    expect(b1.steps.length).toBeLessThanOrEqual(10);
    const all = JSON.stringify(LESSONS);
    for (const kw of ["E-P-C-C", "PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "SKILL.md", "MCP", "AGENTS.md", ".neuagent/agents", ".neuagent/commands", "Hỏi trước", "Tự sửa file", "Tự động", "Lập kế hoạch", "Toàn quyền"]) {
      expect(all, `giáo trình thiếu "${kw}"`).toContain(kw);
    }
  });

  it("các bài học có đủ nội dung", () => {
    for (const l of LESSONS) {
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(4);
      expect(l.steps.length, l.id).toBeLessThanOrEqual(10);
      expect(l.goals.length, l.id).toBeGreaterThanOrEqual(2);
      expect(l.goals.length, l.id).toBeLessThanOrEqual(4);
      expect(l.takeaways.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.takeaways.length, l.id).toBeLessThanOrEqual(5);
      expect(l.intro.length, l.id).toBeGreaterThan(30);
      expect(l.minutes, l.id).toBeGreaterThan(0);
      for (const s of l.steps) {
        expect(s.body.length, `${l.id}/${s.title}`).toBeGreaterThan(40);
        expect(s.try?.length ?? 0, `${l.id}/${s.title} thiếu try`).toBeGreaterThanOrEqual(1);
        expect(s.try!.length, `${l.id}/${s.title}`).toBeLessThanOrEqual(3);
        expect(s.check, `${l.id}/${s.title} thiếu check`).toBeTruthy();
      }
    }
  });

  it("mọi bài tập trong bài học tồn tại; mọi bài tập được dùng ít nhất một lần", () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    const used = new Set<string>();
    for (const l of LESSONS) for (const id of l.exercises ?? []) {
      expect(ids.has(id), `${l.id} -> ${id}`).toBe(true);
      used.add(id);
    }
    for (const id of ids) expect(used.has(id), `${id} chưa thuộc bài học nào`).toBe(true);
  });

  it("bài tập: tệp chấm nằm trong files, hints >= 3, trải đều level", () => {
    for (const e of EXERCISES) {
      expect(e.files[e.check], `${e.id} thiếu tệp chấm`).toBeTruthy();
      expect(e.check, e.id).toBe(e.lang === "py" ? "check.py" : "check.js");
      expect(e.hints.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.hints.length, e.id).toBeLessThanOrEqual(4);
      expect(e.instructions.length, e.id).toBeGreaterThan(200);
      expect(Object.keys(e.files), e.id).not.toContain("DE-BAI.md");
      expect(Object.keys(e.solution).length, e.id).toBeGreaterThan(0);
      expect(e.concepts.length, e.id).toBeGreaterThan(0);
    }
    for (const lv of [1, 2, 3] as const) expect(EXERCISES.filter((e) => e.level === lv).length).toBeGreaterThanOrEqual(3);
  });

  it("dự án mẫu có README.md và AGENTS.md", () => {
    for (const p of PROJECT_TEMPLATES) {
      expect(Object.keys(p.files), p.id).toContain("README.md");
      expect(Object.keys(p.files), p.id).toContain("AGENTS.md");
      expect(p.startPrompts.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.startPrompts.length, p.id).toBeLessThanOrEqual(3);
    }
  });

  it("không chứa tên trường/đơn vị thật; không dùng tên ứng dụng cũ", () => {
    const all = allStrings([LESSONS, EXERCISES, PROJECT_TEMPLATES]);
    for (const s of all) {
      expect(s).not.toContain("Kinh tế Quốc dân");
      expect(s).not.toContain("Cộng Sự");
    }
  });
});

describe("giáo trình: chấm tự động từng bài tập", () => {
  for (const ex of EXERCISES) {
    it(`${ex.id}: bản khởi đầu chưa đạt, lời giải đạt`, () => {
      const dir = mkdtempSync(join(tmpdir(), `neu-${ex.id}-`));
      try {
        writeFiles(dir, ex.files);

        // (a) Bản khởi đầu: phải thoát mã 1, có FAIL, mọi dòng đúng giao thức.
        const a = runCheck(dir, ex.check);
        expect(a.timedOut, `${ex.id} (khởi đầu) quá giờ/lỗi chạy: ${a.stderr}`).toBe(false);
        expect(a.status, `${ex.id} (khởi đầu) phải thoát mã 1\n${a.lines.join("\n")}\n${a.stderr}`).toBe(1);
        expect(a.lines.some((l) => l.startsWith("FAIL ")), `${ex.id} (khởi đầu) cần có dòng FAIL`).toBe(true);
        for (const l of a.lines) expect(l, `${ex.id} (khởi đầu) dòng sai giao thức`).toMatch(LINE_RE);

        // (b) Lời giải: thoát mã 0, không FAIL, >= 3 PASS.
        writeFiles(dir, ex.solution);
        const b = runCheck(dir, ex.check);
        expect(b.timedOut, `${ex.id} (lời giải) quá giờ/lỗi chạy: ${b.stderr}`).toBe(false);
        expect(b.lines.filter((l) => l.startsWith("FAIL ")), `${ex.id} (lời giải) còn FAIL\n${b.stderr}`).toEqual([]);
        expect(b.status, `${ex.id} (lời giải) phải thoát mã 0\n${b.lines.join("\n")}\n${b.stderr}`).toBe(0);
        expect(b.lines.filter((l) => l.startsWith("PASS ")).length, `${ex.id} (lời giải) cần >= 3 PASS`).toBeGreaterThanOrEqual(3);
        for (const l of b.lines) expect(l, `${ex.id} (lời giải) dòng sai giao thức`).toMatch(LINE_RE);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("giáo trình: dự án mẫu", () => {
  for (const p of PROJECT_TEMPLATES) {
    it(`${p.id}: mã nguồn đúng cú pháp`, () => {
      const dir = mkdtempSync(join(tmpdir(), `neu-${p.id}-`));
      try {
        writeFiles(dir, p.files);
        let checked = 0;
        for (const name of Object.keys(p.files)) {
          let r;
          if (name.endsWith(".js")) r = spawnSync("node", ["--check", name], { cwd: dir, encoding: "utf8", timeout: 10000 });
          else if (name.endsWith(".py")) r = spawnSync("python3", ["-m", "py_compile", name], { cwd: dir, encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
          else continue;
          checked++;
          expect(r.status, `${p.id}/${name}: ${r.stderr}`).toBe(0);
        }
        if (p.lang === "js" || p.lang === "py") expect(checked, p.id).toBeGreaterThan(0);
        if (p.lang === "html" || p.lang === "mixed") expect(Object.keys(p.files).some((n) => n.endsWith(".html")), p.id).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
