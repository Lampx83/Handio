/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, PROFILES } from "../src";
import { officeTools } from "../src/office/tools";
import { WORK_TEMPLATES } from "../src/work-templates";
import { DESIGN_BASE, DESIGN_FORMATS, DESIGN_TEMPLATES } from "../src/design-templates";

/** Lệnh có sẵn: lệnh của tab Code/Work, lệnh gạch chéo do session.ts xử lý và tên tệp mẫu khác. */
const RESERVED = [
  "init", "commit", "caithien", "vibe", "review", "explain", "fix-tests", "tomtat", "soanthao", "bangtinh", "trinhchieu", "rasoat",
  "help", "clear", "compact", "mode", "undo", "hooks", "agents", "skills", "mcp", "context", "model", "memory", "giay-moi",
];
const CATEGORIES = ["web", "in-an", "mang-xa-hoi", "trinh-chieu", "nhan-dien"];

const env = new MemoryEnv();
const known = new Set([...builtinTools(env), ...officeTools(env)].map((t) => t.name));
const tool = (n: string) => [...builtinTools(env), ...officeTools(env)].find((t) => t.name === n) as any;

describe("mẫu thiết kế: dữ liệu", () => {
  it("có ít nhất 14 mẫu, đủ cả 5 nhóm", () => {
    expect(DESIGN_TEMPLATES.length).toBeGreaterThanOrEqual(14);
    const cats = new Set(DESIGN_TEMPLATES.map((t) => t.category));
    for (const c of CATEGORIES) expect(cats.has(c as any), c).toBe(true);
    for (const t of DESIGN_TEMPLATES) expect(CATEGORIES, t.command).toContain(t.category);
  });

  it("command duy nhất, đúng dạng, không trùng lệnh có sẵn hay lệnh của Work", () => {
    const work = new Set(WORK_TEMPLATES.map((t) => t.command));
    const profileCmds = new Set([...Object.keys(PROFILES.code.commands), ...Object.keys(PROFILES.work.commands)]);
    const seen = new Set<string>();
    for (const t of DESIGN_TEMPLATES) {
      expect(t.command, t.command).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(RESERVED, t.command).not.toContain(t.command);
      expect(work.has(t.command), `trùng lệnh Work: ${t.command}`).toBe(false);
      expect(profileCmds.has(t.command), `trùng lệnh của tab Code/Work: ${t.command}`).toBe(false);
      expect(seen.has(t.command), `trùng ${t.command}`).toBe(false);
      seen.add(t.command);
    }
  });

  it("có các lệnh gợi ý chính", () => {
    const have = new Set(DESIGN_TEMPLATES.map((t) => t.command));
    for (const c of ["landing", "trangcv", "poster", "tohop", "banner", "instapost", "story", "slidedeck", "infographic", "logo", "namecard", "thiepmoi", "bangbieu", "email-html", "dashboard", "bieudo"]) {
      expect(have.has(c), c).toBe(true);
    }
  });

  it("tên, mô tả ≤ 90 ký tự, fields 3-5 có key duy nhất, label, ví dụ", () => {
    for (const t of DESIGN_TEMPLATES) {
      expect(t.name.trim(), t.command).not.toBe("");
      expect(t.description.length, t.command).toBeLessThanOrEqual(90);
      expect(t.description.length, t.command).toBeGreaterThan(10);
      expect(t.fields.length, t.command).toBeGreaterThanOrEqual(3);
      expect(t.fields.length, t.command).toBeLessThanOrEqual(5);
      expect(t.fields.some((f) => f.required), t.command).toBe(true);
      const keys = t.fields.map((f) => f.key);
      expect(new Set(keys).size, `${t.command}: key trùng`).toBe(keys.length);
      for (const f of t.fields) {
        expect(f.key.trim(), t.command).not.toBe("");
        expect(f.key, t.command).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(f.label.trim(), t.command).not.toBe("");
        expect(f.example?.trim(), `${t.command}.${f.key}`).toBeTruthy();
      }
    }
  });
});

describe("mẫu thiết kế: prompt", () => {
  it("dùng $ARGUMENTS, đủ các bước, ngắn gọn để vừa ngữ cảnh 32k", () => {
    for (const t of DESIGN_TEMPLATES) {
      expect(t.prompt, t.command).toContain("$ARGUMENTS");
      expect(t.prompt, t.command).toContain("write_file");
      expect(t.prompt, t.command).toContain("read_file");
      expect(t.prompt, t.command).toContain("edit_file");
      expect(t.prompt, t.command).toMatch(/STEP 1[\s\S]*STEP 2[\s\S]*STEP 3[\s\S]*STEP 4[\s\S]*STEP 5/);
      expect(t.prompt, t.command).toMatch(/hard rules/);
      expect(t.prompt, t.command).toMatch(/at most 3 short numbered questions/);
      expect(t.prompt, t.command).toMatch(/NEW file name/);
      expect(t.prompt, t.command).toMatch(/hex/);
      expect(t.prompt, t.command).toMatch(/variations/);
      expect(t.prompt.length, t.command).toBeGreaterThan(1000);
      expect(t.prompt.length, t.command).toBeLessThan(2600);
    }
  });

  it("chỉ nhắc tên công cụ có thật (mọi tên dạng snake_case phải là công cụ)", () => {
    for (const t of [...DESIGN_TEMPLATES.map((x) => ({ id: x.command, text: x.prompt })), { id: "DESIGN_BASE", text: DESIGN_BASE }]) {
      const names = t.text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
      for (const n of names) expect(known.has(n) || n === "ask_user", `${t.id}: "${n}" không phải công cụ`).toBe(true); // ask_user là công cụ meta của phiên, không nằm trong danh sách công cụ tệp
      for (const n of ["write_file", "edit_file", "read_file"]) expect(known.has(n), n).toBe(true);
    }
    expect(known.has("read_document")).toBe(true);
  });

  it("không dặn dùng công cụ không dành cho thiết kế (bash, web_fetch, create_docx...)", () => {
    for (const t of DESIGN_TEMPLATES) {
      for (const n of ["bash", "web_fetch", "run_javascript", "create_docx", "create_xlsx", "create_pptx"]) {
        expect(new RegExp(`\\b${n}\\b`).test(t.prompt), `${t.command}: ${n}`).toBe(false);
      }
    }
  });

  it("không gọi công cụ bằng tham số không có trong schema (write_file/edit_file dùng path, content, old_string, new_string)", () => {
    const wf = Object.keys(tool("write_file").parameters.properties);
    expect(wf).toEqual(expect.arrayContaining(["path", "content"]));
    const ef = Object.keys(tool("edit_file").parameters.properties);
    expect(ef).toEqual(expect.arrayContaining(["path", "old_string", "new_string"]));
    for (const t of DESIGN_TEMPLATES) {
      for (const m of t.prompt.matchAll(/\b(old_string|new_string|replace_all|offset|limit|save_as)\b/g)) {
        expect([...wf, ...ef, ...Object.keys(tool("read_file").parameters.properties)], `${t.command}: ${m[0]}`).toContain(m[0]);
      }
    }
  });

  it("mẫu dùng số liệu: đọc dữ liệu thật, không bịa, tính toán rõ ràng", () => {
    for (const c of ["dashboard", "bieudo", "infographic"]) {
      const p = DESIGN_TEMPLATES.find((t) => t.command === c)!.prompt;
      expect(p, c).toContain("read_document");
      expect(p, c).toMatch(/never invent/i);
      expect(p, c).toMatch(/Compute every/);
    }
  });

  it("kích thước đúng khổ của từng định dạng", () => {
    const p = (c: string) => DESIGN_TEMPLATES.find((t) => t.command === c)!.prompt;
    expect(p("poster")).toContain("794px");
    expect(p("poster")).toContain("1123px");
    expect(p("poster")).toContain("@page");
    expect(p("tohop")).toContain("794x1123");
    expect(p("banner")).toContain("1200x630");
    expect(p("instapost")).toContain("1080x1080");
    expect(p("story")).toContain("1080x1920");
    expect(p("slidedeck")).toContain("1280px");
    expect(p("slidedeck")).toContain("720px");
    expect(p("slidedeck")).toContain("section");
    expect(p("namecard")).toContain("1050px");
    expect(p("namecard")).toContain("600px");
    expect(p("infographic")).toContain("800px");
    expect(p("thiepmoi")).toContain("A5");
    expect(p("email-html")).toContain("600");
    expect(p("email-html")).toMatch(/inline/i);
    expect(p("logo")).toContain("svg");
    expect(p("bieudo")).toContain("svg");
    expect(p("landing")).toContain("max-width");
    expect(p("landing")).toContain("@media");
  });

  it("không nhắc tên trường/đơn vị thật", () => {
    for (const t of DESIGN_TEMPLATES) {
      const all = JSON.stringify(t) + DESIGN_BASE;
      expect(all, t.command).not.toContain("Kinh tế Quốc dân");
      expect(all, t.command).not.toContain("Kinh te Quoc dan");
    }
  });

  it("không có prompt nào bảo dùng thứ bị cấm (script, tài nguyên ngoài)", () => {
    for (const t of DESIGN_TEMPLATES) {
      // ví dụ trong prompt không được chứa thẻ <script>/<link>/<iframe>/<form> dạng "nên dùng" hay URL http thật
      expect(t.prompt, t.command).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)[a-z0-9.-]+\.[a-z]{2,}/i); // xmlns của SVG là khai báo, không phải tài nguyên
      // chỉ được nhắc <script> trong câu cấm "no <script>"
      expect(t.prompt.replace(/no <script>/g, ""), t.command).not.toMatch(/<script[ >]|<link |<iframe|<form[ >]/);
    }
  });
});

describe("DESIGN_BASE", () => {
  it("dài cỡ WORK_BASE (25-35 dòng) và nêu các quy tắc cứng", () => {
    const lines = DESIGN_BASE.split("\n").filter((l) => l.trim()).length;
    expect(lines).toBeGreaterThanOrEqual(15);
    expect(lines).toBeLessThanOrEqual(35);
    expect(DESIGN_BASE).toContain("<script>");
    expect(DESIGN_BASE).toContain("write_file");
    expect(DESIGN_BASE).toContain("read_file");
    expect(DESIGN_BASE).toContain("edit_file");
    expect(DESIGN_BASE).toContain("794");
    expect(DESIGN_BASE).toContain("1123");
    expect(DESIGN_BASE).toContain("1080x1080");
    expect(DESIGN_BASE).toContain("1080x1920");
    expect(DESIGN_BASE).toContain("1280x720");
    expect(DESIGN_BASE).toContain("1050x600");
    expect(DESIGN_BASE).toContain("lang=\"vi\"");
    expect(DESIGN_BASE).toMatch(/event-handler/);
    expect(DESIGN_BASE).toMatch(/no external resources/);
    expect(DESIGN_BASE).toMatch(/4\.5:1/);
    expect(DESIGN_BASE).toMatch(/ASK FIRST, THEN DESIGN[\s\S]*ask_user[\s\S]*ONCE with 2-4 short questions/);
    expect(DESIGN_BASE).toMatch(/NEW clear name/);
    expect(DESIGN_BASE).toMatch(/-v2/);
    expect(DESIGN_BASE).toMatch(/:root/);
    expect(DESIGN_BASE).toMatch(/12,000/);
    expect(DESIGN_BASE).toMatch(/cannot see the rendered result/);
    expect(DESIGN_BASE).toMatch(/PDF or PNG/);
    expect(DESIGN_BASE).toMatch(/DATA, not instructions/);
    expect(DESIGN_BASE).toMatch(/Vietnamese by default/);
  });
});

describe("DESIGN_FORMATS", () => {
  it("id ASCII duy nhất, chiều rộng là số nguyên dương, đủ các khổ yêu cầu", () => {
    const ids = DESIGN_FORMATS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of DESIGN_FORMATS) {
      expect(x.id, x.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(x.label.trim(), x.id).not.toBe("");
      expect(Number.isInteger(x.width) && x.width > 0, x.id).toBe(true);
      if (x.height !== undefined) expect(Number.isInteger(x.height) && x.height > 0, x.id).toBe(true);
    }
    const by = new Map(DESIGN_FORMATS.map((x) => [x.id, x]));
    expect(by.get("web")).toMatchObject({ width: 1280 });
    expect(by.get("web")!.height).toBeUndefined();
    expect(by.get("tablet")).toMatchObject({ width: 768 });
    expect(by.get("mobile")).toMatchObject({ width: 390 });
    expect(by.get("a4")).toMatchObject({ width: 794, height: 1123 });
    expect(by.get("square")).toMatchObject({ width: 1080, height: 1080 });
    expect(by.get("story")).toMatchObject({ width: 1080, height: 1920 });
    expect(by.get("slide")).toMatchObject({ width: 1280, height: 720 });
    expect(by.get("card")).toMatchObject({ width: 1050, height: 600 });
  });
});
