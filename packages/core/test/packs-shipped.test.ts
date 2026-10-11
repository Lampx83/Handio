import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryEnv, PROFILES, builtinTools, office, parsePacks, visionTool, type RawPack } from "../src";

// Kiểm tra bộ gói đi kèm kho mã (packs/): mọi gói đọc được, không trùng lệnh, subagent chỉ nêu công cụ có thật.
const dir = path.join(__dirname, "..", "..", "..", "packs");
const raws: RawPack[] = [];
const TEXT = /\.(md|json|txt|csv|html|css|js|mjs)$/i;
for (const d of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()) : []) {
  const files: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (TEXT.test(e.name)) files[r] = fs.readFileSync(path.join(abs, e.name), "utf8");
    }
  };
  walk(path.join(dir, d.name), "");
  raws.push({ dir: d.name, origin: "org", files });
}

describe("bộ gói đi kèm (packs/)", () => {
  const { packs, notices } = parsePacks(raws);
  const env = new MemoryEnv("/ws");
  // đủ năng lực của bản Desktop để mọi công cụ có mặt trong danh sách
  env.fetchUrl = async () => "";
  env.exec = async () => ({ code: 0, output: "", timedOut: false });
  env.spawn = () => ({ stop() {} });
  env.runJs = async () => ({ ok: true, logs: [] });
  const toolNames = new Set<string>([visionTool(env, () => ({ vision: async () => "" })).name, ...packs.flatMap((p) => Object.keys(p.httpTools)), ...builtinTools(env).map((t) => t.name), ...office.officeTools(env).map((t) => t.name), ...office.workTools(env).map((t) => t.name), "task", "skill", "todo_write", "ask_user"]);

  it("có gói và không có cảnh báo nào", () => {
    expect(packs.length).toBeGreaterThan(0);
    expect(notices).toEqual([]);
    expect(packs.length).toBe(raws.length);
  });
  it("mỗi gói có mô tả; lệnh và skill có mô tả, nội dung không rỗng", () => {
    for (const p of packs) {
      expect(p.manifest.description.length, p.manifest.id).toBeGreaterThan(10);
      for (const c of p.commands) {
        expect(c.description.length, `${p.manifest.id}/${c.name}`).toBeGreaterThan(5);
        expect(c.body.length, `${p.manifest.id}/${c.name}`).toBeGreaterThan(40);
      }
      for (const s of p.skills) expect(s.description.length, `${p.manifest.id}/${s.name}`).toBeGreaterThan(10);
    }
  });
  it("tên lệnh không trùng nhau giữa các gói, không trùng lệnh dựng sẵn của tab", () => {
    const seen = new Map<string, string>();
    for (const p of packs)
      for (const c of p.commands) {
        expect(seen.has(c.name), `lệnh /${c.name} trùng giữa ${seen.get(c.name)} và ${p.manifest.id}`).toBe(false);
        seen.set(c.name, p.manifest.id);
        for (const prof of p.manifest.profiles) expect(c.name in PROFILES[prof].commands, `/${c.name} trùng lệnh dựng sẵn của tab ${prof}`).toBe(false);
      }
  });
  it("subagent chỉ được dùng công cụ có thật", () => {
    for (const p of packs) for (const a of p.agents) for (const t of a.tools ?? []) expect(toolNames.has(t), `${p.manifest.id}/${a.name} dùng công cụ lạ '${t}'`).toBe(true);
  });
  it("lệnh và skill chỉ nhắc tới công cụ/skill có thật (tên công cụ viết trong dấu huyền)", () => {
    const skillNames = new Set(packs.flatMap((p) => p.skills.map((s) => s.name)));
    const agentNames = new Set(packs.flatMap((p) => p.agents.map((a) => a.name)));
    for (const p of packs)
      for (const text of [...p.commands.map((c) => c.body), ...p.skills.map((s) => s.body)])
        for (const m of text.matchAll(/`([a-z][a-z0-9_-]+)`/g)) {
          const n = m[1];
          if (!/_|^(skill|task)$/.test(n) && !skillNames.has(n) && !agentNames.has(n)) continue; // chỉ kiểm tra tên giống công cụ/skill/subagent
          expect(toolNames.has(n) || skillNames.has(n) || agentNames.has(n), `${p.manifest.id}: '${n}' không phải công cụ/skill/subagent`).toBe(true);
        }
  });
  it("công cụ HTTP của gói: tham số khai báo khớp với giá trị điền vào truy vấn, đường dẫn dưới tools/", () => {
    for (const p of packs)
      for (const [name, t] of Object.entries(p.httpTools)) {
        const props = Object.keys(((t.parameters as { properties?: object }).properties ?? {}) as object);
        const required = ((t.parameters as { required?: string[] }).required ?? []) as string[];
        expect(required.every((r) => props.includes(r)), `${name}: required ngoài properties`).toBe(true);
        for (const tpl of Object.values(t.http.query ?? {})) {
          const m = /^\{(\w+)\}$/.exec(tpl);
          if (m) expect(props.includes(m[1]), `${name}: {${m[1]}} không phải tham số`).toBe(true);
        }
        expect(t.http.path.startsWith("tools/"), `${name}: ${t.http.path}`).toBe(true);
      }
  });
});
