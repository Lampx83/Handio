import type { Env } from "./env";
import { join } from "./path";

export const MEMORY_FILES = ["AGENTS.md", "CLAUDE.md", "NEUAGENT.md", ".neuagent/NEUAGENT.md", "NEUAGENT.local.md"];
const MAX_MEMORY_CHARS = 6000;

/** Hướng dẫn riêng của dự án (giống CLAUDE.md), nạp vào system prompt. */
export async function loadMemory(env: Env, root: string): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  const dec = new TextDecoder();
  for (const n of MEMORY_FILES) {
    try {
      const p = join(root, n);
      const st = await env.stat(p);
      if (!st?.isFile) continue;
      let text = dec.decode(await env.readBytes(p)).trim();
      if (!text) continue;
      if (text.length > MAX_MEMORY_CHARS) text = text.slice(0, MAX_MEMORY_CHARS) + "\n… (đã cắt bớt)";
      out.push({ name: n, text });
    } catch {
      /* bỏ qua */
    }
  }
  return out;
}

export interface CustomCommand {
  name: string;
  description: string;
  body: string;
}

export function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && !line.trimStart().startsWith("#")) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return { meta, body: m[2] };
}

/** Lệnh slash tuỳ biến: .neuagent/commands/<tên>.md (các thư mục con thành `a:b`). */
export async function loadCommands(env: Env, root: string): Promise<CustomCommand[]> {
  const out: CustomCommand[] = [];
  const dec = new TextDecoder();
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await env.readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDir && depth < 3) await walk(p, prefix + e.name + ":", depth + 1);
      else if (!e.isDir && e.name.endsWith(".md")) {
        try {
          const { meta, body } = frontmatter(dec.decode(await env.readBytes(p)));
          out.push({ name: prefix + e.name.slice(0, -3), description: meta.description || body.trim().split("\n")[0].slice(0, 80), body: body.trim() });
        } catch {
          /* bỏ qua */
        }
      }
    }
  };
  await walk(join(root, ".neuagent", "commands"), "", 0);
  return out;
}

export function expandCommand(body: string, args: string): string {
  const words = args.split(/\s+/).filter(Boolean);
  let out = body;
  const positional = /\$[1-9]/.test(body);
  words.slice(0, 9).forEach((w, i) => (out = out.split("$" + (i + 1)).join(w)));
  out = out.replace(/\$[1-9]/g, "");
  if (out.includes("$ARGUMENTS")) return out.split("$ARGUMENTS").join(args).trim();
  return (out + (args && !positional ? "\n\n" + args : "")).trim();
}

// ---------------------------------------------------------------- subagent và skill tuỳ biến

export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
export const splitList = (v: string | undefined): string[] | null => {
  if (!v) return null;
  const items = v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  return items.length ? items : null;
};

export interface CustomAgent {
  name: string;
  description: string;
  prompt: string;
  /** Danh sách công cụ được dùng; null = tất cả (trừ task). */
  tools: string[] | null;
  source: string;
}

/** Subagent do người dùng định nghĩa: `.neuagent/agents/<tên>.md` với frontmatter name/description/tools. */
export async function loadAgents(env: Env, root: string): Promise<CustomAgent[]> {
  const out: CustomAgent[] = [];
  const dec = new TextDecoder();
  let entries;
  try {
    entries = await env.readdir(join(root, ".neuagent", "agents"));
  } catch {
    return out;
  }
  for (const e of entries.slice(0, 50)) {
    if (e.isDir || !e.name.endsWith(".md")) continue;
    try {
      const p = join(root, ".neuagent", "agents", e.name);
      const { meta, body } = frontmatter(dec.decode(await env.readBytes(p)).slice(0, 20_000));
      const name = meta.name || e.name.slice(0, -3);
      if (!SAFE_NAME.test(name)) continue;
      out.push({ name, description: (meta.description || "").slice(0, 300), prompt: body.trim(), tools: splitList(meta.tools), source: `.neuagent/agents/${e.name}` });
    } catch {
      /* bỏ qua tệp hỏng */
    }
  }
  return out;
}

export interface CustomSkill {
  name: string;
  description: string;
  body: string;
  dir: string;
  files: string[];
  /** Nội dung chữ của các tệp kèm theo khi skill đến từ gói mở rộng (không nằm trong thư mục dự án để đọc bằng read_file). */
  texts?: Record<string, string>;
}

/** Skill: thư mục `.neuagent/skills/<tên>/SKILL.md` (frontmatter name/description) + các tệp kèm theo. */
export async function loadSkills(env: Env, root: string): Promise<CustomSkill[]> {
  const out: CustomSkill[] = [];
  const dec = new TextDecoder();
  const base = join(root, ".neuagent", "skills");
  let dirs;
  try {
    dirs = await env.readdir(base);
  } catch {
    return out;
  }
  for (const d of dirs.slice(0, 50)) {
    if (!d.isDir) continue;
    try {
      const dir = join(base, d.name);
      const { meta, body } = frontmatter(dec.decode(await env.readBytes(join(dir, "SKILL.md"))).slice(0, 30_000));
      const name = meta.name || d.name;
      if (!SAFE_NAME.test(name)) continue;
      const files = (await env.readdir(dir)).filter((f) => f.name !== "SKILL.md").map((f) => f.name + (f.isDir ? "/" : "")).slice(0, 30);
      out.push({ name, description: (meta.description || "").slice(0, 300), body: body.trim(), dir: `.neuagent/skills/${d.name}`, files });
    } catch {
      /* không có SKILL.md: bỏ qua */
    }
  }
  return out;
}
