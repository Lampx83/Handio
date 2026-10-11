import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryEnv, PROFILES, builtinTools, expandCommand, office, packsFor, parsePacks, visionTool, type LoadedPack, type Profile, type RawPack } from "../src";
import { calculate } from "../src/office/vn-calc";
import { makeController } from "./helpers";

// Ba gói chuyển từ bộ kỹ năng thiết kế/UX: thiet-ke-ux, nghien-cuu-nguoi-dung, tao-ky-nang.
const dir = path.join(__dirname, "..", "..", "..", "packs");
const IDS = ["thiet-ke-ux", "nghien-cuu-nguoi-dung", "tao-ky-nang"];
const TEXT = /\.(md|json|txt|csv|html|css|js|mjs)$/i;

function readRaw(id: string): RawPack {
  const files: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (TEXT.test(e.name)) files[r] = fs.readFileSync(path.join(abs, e.name), "utf8");
    }
  };
  walk(path.join(dir, id), "");
  return { dir: id, origin: "org", files };
}

const raws = IDS.map(readRaw);
const { packs, notices } = parsePacks(raws);
const pack = (id: string): LoadedPack => packs.find((p) => p.manifest.id === id)!;

describe("gói thiết kế/UX: cấu trúc", () => {
  it("cả ba gói tải được, không cảnh báo, đúng tab", () => {
    expect(notices).toEqual([]);
    expect(packs.map((p) => p.manifest.id).sort()).toEqual([...IDS].sort());
    expect(pack("thiet-ke-ux").manifest.profiles).toEqual(["design", "work"]);
    expect(pack("nghien-cuu-nguoi-dung").manifest.profiles).toEqual(["work"]);
    expect([...pack("tao-ky-nang").manifest.profiles].sort()).toEqual(["code", "design", "work"]);
  });

  it("đủ kỹ năng, lệnh, subagent theo yêu cầu", () => {
    expect(pack("thiet-ke-ux").skills.map((s) => s.name).sort()).toEqual(["accessibility-review", "design-critique", "design-handoff", "design-system", "ux-copy"]);
    expect(pack("thiet-ke-ux").commands.map((c) => c.name).sort()).toEqual(["ban-giao-thiet-ke", "kiem-tra-tiep-can", "phe-binh-thiet-ke", "ra-soat-he-thong-thiet-ke", "viet-loi-giao-dien"]);
    expect(pack("thiet-ke-ux").agents.map((a) => a.name)).toEqual(["reviewer-thiet-ke"]);
    expect(pack("nghien-cuu-nguoi-dung").skills.map((s) => s.name).sort()).toEqual(["research-synthesis", "user-research"]);
    expect(pack("nghien-cuu-nguoi-dung").commands.map((c) => c.name).sort()).toEqual(["ke-hoach-nghien-cuu", "tong-hop-nghien-cuu"]);
    expect(pack("tao-ky-nang").skills.map((s) => s.name)).toEqual(["tao-ky-nang"]);
    expect(pack("tao-ky-nang").commands.map((c) => c.name)).toEqual(["tao-ky-nang"]);
  });

  it("lời dặn ngắn (≤ 6000 ký tự, nên ~1200) và mô tả đủ rõ", () => {
    for (const p of packs) {
      expect(p.prompt.length, p.manifest.id).toBeLessThanOrEqual(1500);
      expect(p.manifest.description.length).toBeGreaterThan(10);
      for (const s of p.skills) {
        expect(s.description.length, s.name).toBeGreaterThan(40);
        expect(s.body.length, s.name).toBeGreaterThan(300);
        expect(s.body.length, `${s.name}: skill quá dài cho cửa sổ ngữ cảnh nhỏ`).toBeLessThan(7500);
      }
      for (const c of p.commands) {
        expect(c.description.length, c.name).toBeGreaterThan(10);
        expect(c.description.length, `${c.name}: mô tả bị cắt ở 120 ký tự`).toBeLessThan(120);
      }
    }
  });

  it("tiếng Việt có dấu, không phụ thuộc dịch vụ ngoài", () => {
    for (const r of raws)
      for (const [f, t] of Object.entries(r.files)) {
        if (f.endsWith(".json")) continue;
        expect(t, `${r.dir}/${f}`).toMatch(/[ạảãàáâấầẩẫậăắằẳẵặẹẻẽèéêếềểễệịỉĩìíọỏõòóôốồổỗộơớờởỡợụủũùúưứừửữựỳýỷỹỵđ]/i);
        expect(t, `${r.dir}/${f}: còn chỗ giữ ~~category`).not.toContain("~~");
        expect(t, `${r.dir}/${f}: nhắc dịch vụ ngoài`).not.toMatch(/figma|notion|slack|linear\b|mixpanel|amplitude|intercom|jira|asana|ffmpeg/i);
      }
    // không có công cụ chạy chương trình/gọi dịch vụ trong gói
    for (const r of raws) expect(Object.keys(r.files).filter((f) => /^(mcp|hooks|tools)\.json$/.test(f)), r.dir).toEqual([]);
  });

  it("không chứa chuỗi nhạy cảm (email thật, khoá, đường dẫn cá nhân, số điện thoại)", () => {
    const bad: [string, RegExp][] = [
      ["email", /[a-z0-9._-]+@(?!neu\.edu\.vn|st\.neu\.edu\.vn|example\.)[a-z0-9-]+\.[a-z]{2,}/i],
      ["khoá bí mật", /\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})/],
      ["khoá riêng", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["đường dẫn cá nhân", /(\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\)/],
      ["số điện thoại", /\b0\d{9,10}\b/],
      ["địa chỉ IP", /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
    ];
    for (const r of raws)
      for (const [f, t] of Object.entries(r.files))
        for (const [what, re] of bad) expect(re.test(t), `${r.dir}/${f}: có ${what}`).toBe(false);
  });
});

describe("gói thiết kế/UX: không trùng và chỉ nhắc cái có thật", () => {
  const env = new MemoryEnv("/ws");
  env.fetchUrl = async () => "";
  env.exec = async () => ({ code: 0, output: "", timedOut: false });
  env.spawn = () => ({ stop() {} });
  env.runJs = async () => ({ ok: true, logs: [] });
  const all = [...builtinTools(env), ...office.officeTools(env), ...office.workTools(env), visionTool(env, () => ({ vision: async () => "" }))];
  const byName = new Map(all.map((t) => [t.name, t]));
  const toolNames = new Set<string>([...byName.keys(), "task", "skill", "todo_write", "ask_user"]);

  it("lệnh không trùng lệnh dựng sẵn của tab (Design có landing, poster, slidedeck… Work có congvan, baocao…) và không trùng giữa các gói", () => {
    const shipped: RawPack[] = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !IDS.includes(e.name))) shipped.push(readRaw(d.name));
    const others = parsePacks(shipped).packs;
    const taken = new Map<string, string>();
    for (const p of others) for (const c of p.commands) taken.set(c.name, p.manifest.id);
    for (const p of packs)
      for (const c of p.commands) {
        expect(taken.has(c.name), `/${c.name} trùng gói ${taken.get(c.name)}`).toBe(false);
        taken.set(c.name, p.manifest.id);
        for (const prof of ["work", "code", "design"] as Profile[]) expect(c.name in PROFILES[prof].commands, `/${c.name} trùng lệnh dựng sẵn của tab ${prof}`).toBe(false);
      }
  });

  it("tên kỹ năng không trùng giữa các gói", () => {
    const seen = new Set<string>();
    for (const p of [...packs, ...parsePacks(fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !IDS.includes(e.name)).map((e) => readRaw(e.name))).packs])
      for (const s of p.skills) {
        expect(seen.has(s.name), `skill ${s.name} bị trùng`).toBe(false);
        seen.add(s.name);
      }
  });

  it("subagent chỉ dùng công cụ có thật và CHỈ ĐỌC", () => {
    const a = pack("thiet-ke-ux").agents[0];
    expect(a.tools).toEqual(expect.arrayContaining(["read_file", "glob", "grep", "read_image"]));
    for (const t of a.tools ?? []) {
      expect(byName.has(t), `công cụ lạ '${t}'`).toBe(true);
      expect(byName.get(t)!.readonly, `'${t}' không chỉ đọc`).toBe(true);
    }
  });

  it("lệnh và kỹ năng chỉ nhắc công cụ có thật trong dấu huyền; kỹ năng được gọi trong lệnh có tồn tại", () => {
    const skills = new Set(packs.flatMap((p) => p.skills.map((s) => s.name)));
    const agents = new Set(packs.flatMap((p) => p.agents.map((a) => a.name)));
    for (const p of packs) {
      for (const c of p.commands) {
        const called = [...c.body.matchAll(/skill `([a-z-]+)`/g)].map((m) => m[1]);
        expect(called.length, `/${c.name} phải nạp một kỹ năng`).toBeGreaterThan(0);
        for (const s of called) expect(skills.has(s), `/${c.name} gọi skill '${s}' không có`).toBe(true);
        for (const a of [...c.body.matchAll(/subagent `([a-z-]+)`/g)].map((m) => m[1])) expect(agents.has(a), `/${c.name} gọi subagent '${a}' không có`).toBe(true);
      }
      for (const text of [...p.commands.map((c) => c.body), ...p.skills.map((s) => s.body), ...p.agents.map((a) => a.prompt)])
        for (const m of text.matchAll(/`([a-z][a-z0-9_-]+)`/g)) {
          const n = m[1];
          if (!/_/.test(n) && !skills.has(n) && !agents.has(n)) continue;
          expect(toolNames.has(n) || skills.has(n) || agents.has(n) || n === "khao-sat-likert", `${p.manifest.id}: '${n}' không phải công cụ/skill/subagent`).toBe(true);
        }
    }
  });

  it("tên công cụ viết trần (không dấu huyền) trong lệnh cũng phải có thật", () => {
    const re = /\b(read_file|write_file|edit_file|read_document|read_image|find_in_documents|create_docx|create_pdf|create_xlsx|docx_edit|ask_user|list_dir|scan_pii|xlsx_pivot|todo_write)\b/g;
    for (const p of packs) for (const c of p.commands) for (const m of c.body.matchAll(re)) expect(toolNames.has(m[1]), m[1]).toBe(true);
  });
});

describe("gói thiết kế/UX: chạy trong phiên làm việc", () => {
  it("tab Design thấy 5 lệnh, subagent và kỹ năng; không thấy lệnh nghiên cứu người dùng", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "design", packs: raws });
    const s = c.currentSession;
    const cmds = s.slashCommands().map((x) => x.name);
    for (const n of ["phe-binh-thiet-ke", "kiem-tra-tiep-can", "ban-giao-thiet-ke", "ra-soat-he-thong-thiet-ke", "viet-loi-giao-dien", "tao-ky-nang"]) expect(cmds, n).toContain(n);
    expect(cmds).not.toContain("tong-hop-nghien-cuu");
    expect(cmds).toContain("landing"); // lệnh dựng sẵn vẫn còn
    expect(s.agentDefs["reviewer-thiet-ke"]).toBeTruthy();
    expect(s.skills.map((k) => k.name)).toEqual(expect.arrayContaining(["design-critique", "accessibility-review", "design-handoff", "design-system", "ux-copy", "tao-ky-nang"]));
  });

  it("tab Work có lệnh nghiên cứu người dùng; tab Code chỉ có tao-ky-nang", async () => {
    const w = (await makeController([{ text: "ok" }], { profile: "work", packs: raws })).c.currentSession;
    const wc = w.slashCommands().map((x) => x.name);
    expect(wc).toEqual(expect.arrayContaining(["ke-hoach-nghien-cuu", "tong-hop-nghien-cuu", "phe-binh-thiet-ke", "tao-ky-nang"]));
    const k = (await makeController([{ text: "ok" }], { profile: "code", packs: raws })).c.currentSession;
    const kc = k.slashCommands().map((x) => x.name);
    expect(kc).toContain("tao-ky-nang");
    expect(kc).not.toContain("phe-binh-thiet-ke");
    expect(k.skills.map((x) => x.name)).toEqual(["tao-ky-nang"]);
  });

  it("lệnh nhận tham số và chạy như prompt", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "design", packs: raws });
    const r = await c.currentSession.handleInput("/phe-binh-thiet-ke poster-ai.html giai đoạn hoàn thiện");
    expect(r.run).toContain("poster-ai.html giai đoạn hoàn thiện");
    expect(r.run).toContain("design-critique");
    expect(expandCommand(pack("nghien-cuu-nguoi-dung").commands.find((x) => x.name === "tong-hop-nghien-cuu")!.body, "p1.docx p2.docx")).toContain("p1.docx p2.docx");
  });

  it("subagent soát thiết kế nhận đúng bộ công cụ chỉ đọc; kỹ năng nạp được", async () => {
    const html = '<!doctype html><html lang="vi"><title>T</title><h1>Xin chào</h1><p style="color:#999;background:#fff">Chữ nhạt</p>';
    const { c, llm, events } = await makeController(
      (m, n) => {
        const sys = String(m[0].content);
        if (sys.includes("subagent 'reviewer-thiet-ke'")) return { text: "Phát hiện: poster.html:1 tương phản thấp." };
        if (n === 0) return { calls: [{ name: "task", args: { agent: "reviewer-thiet-ke", prompt: "soát poster.html", description: "soát" } }, { name: "skill", args: { name: "accessibility-review" } }] };
        return { text: "xong" };
      },
      { profile: "design", packs: raws, seed: { "poster.html": html } },
    );
    await c.send("kiểm tra tiếp cận poster.html");
    const sub = llm.calls.find((x) => String(x.messages[0].content).includes("subagent 'reviewer-thiet-ke'"))!;
    expect(sub.opts.tools!.map((t) => t.function.name).sort()).toEqual(["calc", "glob", "grep", "read_file", "read_image"]);
    const out = events.filter((e: any) => e.type === "tool_result").map((e: any) => e.output).join("\n");
    expect(out).toContain("tương phản thấp");
    expect(out).toContain("WCAG 2.1 AA");
    expect(out).toContain("0.2126");
  });
});

describe("gói thiết kế/UX: số liệu trong tài liệu đúng", () => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a: string, b: string) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);

  it("ví dụ #999999 trên nền trắng ≈ 2,85:1 và công cụ calc tính ra đúng kênh sáng", () => {
    expect(ratio("#999999", "#ffffff")).toBeCloseTo(2.85, 2);
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#767676", "#ffffff")).toBeGreaterThan(4.5); // #767676 là xám nhạt nhất còn đạt 4.5:1 trên trắng
    expect(ratio("#777777", "#ffffff")).toBeLessThan(4.5 + 0.01);
    // đúng công thức mà skill dặn đưa cho calc (locale "en")
    const v = calculate("((153/255+0.055)/1.055)^2.4", { locale: "en" }).value;
    expect(v).toBeCloseTo(lin(153), 10);
    expect((1 + 0.05) / (v + 0.05)).toBeCloseTo(2.85, 2);
  });

  it("skill nêu đúng hệ số và ngưỡng WCAG", () => {
    const a = pack("thiet-ke-ux").skills.find((s) => s.name === "accessibility-review")!.body;
    for (const must of ["0.2126", "0.7152", "0.0722", "0.03928", "12.92", "1.055", "2.4", "4,5:1", "3:1", "2,85:1"]) expect(a, must).toContain(must);
  });
});
