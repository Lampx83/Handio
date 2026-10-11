import type { Env } from "./env";
import { globToRegExp } from "./glob";
import { basename, dirname, isInside, join, normalize } from "./path";
import { isSensitivePath } from "./sensitive";

export const MEMORY_FILES = ["AGENTS.md", "CLAUDE.md", "NEUAGENT.md", ".neuagent/NEUAGENT.md", "NEUAGENT.local.md"];
/** Tệp hướng dẫn đặt trong thư mục con: nạp khi agent làm việc trong thư mục đó. */
export const DIR_MEMORY_FILES = ["AGENTS.md", "CLAUDE.md", "NEUAGENT.md"];
/** Thư mục hướng dẫn riêng của người dùng (cấp toàn cục, áp dụng cho mọi dự án). */
export const GLOBAL_MEMORY_DIR = ".neuagent";
export const GLOBAL_MEMORY_FILES = ["AGENTS.md", "NEUAGENT.md"];
/** Thư mục quy tắc theo phạm vi (tên của Handio, Antigravity, Claude Code). */
export const RULE_DIRS = [".neuagent/rules", ".agents/rules", ".claude/rules"];

const MAX_MEMORY_CHARS = 6000;
/** Tổng ký tự tối đa của hướng dẫn nạp lúc mở phiên (cửa sổ ngữ cảnh mặc định chỉ ~32k token). */
const MAX_STARTUP_CHARS = 16000;
const MAX_DIR_MEMORY_CHARS = 4000;
const MAX_RULE_CHARS = 3000;
const MAX_IMPORT_DEPTH = 4;
const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build"]);

export interface MemoryEntry {
  name: string;
  text: string;
}

const dec = new TextDecoder();
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "\n… (đã cắt bớt)" : t);

/** Trạng thái dùng chung khi nạp: tệp đã nạp (tránh nạp hai lần, vòng import) và số ký tự còn lại. */
interface LoadState {
  seen: Set<string>;
  left: number;
}

async function realOrSame(env: Env, p: string): Promise<string> {
  try {
    return await env.realpath(p);
  } catch {
    return p;
  }
}

/**
 * Cú pháp `@đường/dẫn` trong tệp hướng dẫn (như CLAUDE.md): nội dung tệp được trỏ tới được nạp kèm, tối đa 4 cấp.
 * Chỉ nạp tệp nằm trong `allowRoot` (không theo `..`, đường dẫn tuyệt đối hay symlink ra ngoài), không nạp tệp bí mật,
 * bỏ qua đoạn mã (``` hoặc `…`) và email. Tệp đã được nạp ở nơi khác chỉ để lại một ghi chú.
 */
async function expandImports(env: Env, text: string, baseDir: string, allowRoot: string, st: LoadState, depth: number): Promise<string> {
  const rootReal = await realOrSame(env, allowRoot);
  const tokens: string[] = [];
  text.split(/(```[\s\S]*?```|`[^`\n]*`)/).forEach((seg, i) => {
    if (i % 2 === 1) return; // đoạn mã
    for (const m of seg.matchAll(/(^|[\s(])@([^\s()<>"'`,;]+)/g)) {
      const t = m[2].replace(/[.,;:!?]+$/, "");
      if ((t.includes("/") || t.includes(".")) && !tokens.includes(t)) tokens.push(t);
    }
  });
  let out = text;
  const blocks: string[] = [];
  for (const t of tokens) {
    if (t.startsWith("/") || t.startsWith("~")) continue;
    const abs = join(baseDir, t);
    if (!isInside(allowRoot, abs) || isSensitivePath(t)) continue;
    try {
      const real = await env.realpath(abs);
      if (!isInside(rootReal, real)) continue;
      const stt = await env.stat(real);
      if (!stt?.isFile || stt.size > 200_000) continue;
      if (st.seen.has(real)) {
        out = out.split("@" + t).join(`@${t} (đã nạp ở trên)`);
        continue;
      }
      if (depth >= MAX_IMPORT_DEPTH || st.left <= 0) continue;
      st.seen.add(real);
      let body = dec.decode(await env.readBytes(real)).trim();
      if (!body) continue;
      body = await expandImports(env, body, dirname(real), allowRoot, st, depth + 1);
      body = clip(body, Math.min(MAX_MEMORY_CHARS, st.left));
      st.left -= body.length;
      blocks.push(`[Nội dung @${t}]\n${body}`);
    } catch {
      /* tệp không có hoặc không đọc được: để nguyên dòng */
    }
  }
  return blocks.length ? out + "\n\n" + blocks.join("\n\n") : out;
}

async function readMemoryFile(env: Env, path: string, allowRoot: string, st: LoadState, cap: number): Promise<string | null> {
  const stt = await env.stat(path);
  if (!stt?.isFile) return null;
  const real = await realOrSame(env, path);
  if (st.seen.has(real)) return null;
  st.seen.add(real);
  const raw = dec.decode(await env.readBytes(path)).trim();
  if (!raw) return null;
  return clip(await expandImports(env, raw, dirname(path), allowRoot, st, 0), Math.min(cap, Math.max(st.left, 500)));
}

/**
 * Hướng dẫn nạp lúc mở phiên (giống CLAUDE.md): cấp toàn cục `~/.neuagent/`, rồi tệp ở gốc dự án,
 * rồi các quy tắc luôn áp dụng trong thư mục rules. Thứ tự: chung trước, riêng sau.
 */
export async function loadMemory(env: Env, root: string, rules: Rule[] = []): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  const st: LoadState = { seen: new Set(), left: MAX_STARTUP_CHARS };
  const add = async (label: string, path: string, allowRoot: string, cap = MAX_MEMORY_CHARS) => {
    try {
      const text = await readMemoryFile(env, path, allowRoot, st, cap);
      if (text) {
        out.push({ name: label, text });
        st.left -= text.length;
      }
    } catch {
      /* bỏ qua */
    }
  };
  if (env.home) {
    const gdir = join(env.home, GLOBAL_MEMORY_DIR);
    for (const n of GLOBAL_MEMORY_FILES) await add(`~/${GLOBAL_MEMORY_DIR}/${n}`, join(gdir, n), gdir);
  }
  for (const n of MEMORY_FILES) await add(n, join(root, n), root);
  for (const r of rules) if (r.trigger === "always") await add(r.name, join(root, r.name), root, MAX_RULE_CHARS);
  return out;
}

/** Hướng dẫn trong các thư mục từ gốc dự án (không kể gốc) xuống `dirRel`; mỗi thư mục chỉ xét một lần (`checked`). */
export async function loadDirMemory(env: Env, root: string, dirRel: string, checked: Set<string>, loaded: Set<string>): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  const parts = normalize(dirRel).split("/").filter((x) => x && x !== ".");
  if (!parts.length || parts.includes("..") || parts.some((x) => SKIP_DIRS.has(x))) return out;
  const st: LoadState = { seen: new Set(loaded), left: MAX_STARTUP_CHARS };
  for (let i = 1; i <= parts.length; i++) {
    const rel = parts.slice(0, i).join("/");
    if (checked.has(rel)) continue;
    checked.add(rel);
    for (const n of DIR_MEMORY_FILES) {
      try {
        const text = await readMemoryFile(env, join(root, rel, n), root, st, MAX_DIR_MEMORY_CHARS);
        if (text) out.push({ name: `${rel}/${n}`, text });
      } catch {
        /* bỏ qua */
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- quy tắc theo phạm vi

/**
 * Quy tắc theo phạm vi: `.neuagent/rules/*.md`, `.agents/rules/*.md` (Antigravity), `.claude/rules/*.md` (Claude Code).
 * Tiêu đề (frontmatter): `trigger` = always_on | glob | model_decision | manual; `globs` hoặc `paths` = mẫu tệp.
 *  - always: nạp luôn (không có trigger/globs, hoặc always_on)
 *  - glob: chỉ nạp khi agent đọc/sửa tệp khớp mẫu (`*.py` khớp mọi thư mục)
 *  - model: chỉ liệt kê tên và mô tả; agent tự đọc tệp khi thấy liên quan
 *  - manual: chỉ dùng khi người dùng nhắc `@tệp-quy-tắc`
 */
export interface Rule {
  /** Đường dẫn tương đối của tệp quy tắc. */
  name: string;
  description: string;
  trigger: "always" | "glob" | "model" | "manual";
  globs: string[];
  text: string;
}

/** Tách theo dấu phẩy, bỏ qua dấu phẩy trong `{a,b}`. */
function splitGlobs(v: string): string[] {
  const items: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of v.replace(/^\[|\]$/g, "")) {
    if (ch === "{") depth++;
    if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && !depth) {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  return items.map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

export function parseRule(name: string, raw: string): Rule | null {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  const head = m?.[1] ?? "";
  const text = (m ? m[2] : raw).trim();
  if (!text) return null;
  const meta: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let key = "";
  for (const line of head.split("\n")) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      (lists[key] ??= []).push(item[1].trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }
    const i = line.indexOf(":");
    if (i > 0 && !line.trimStart().startsWith("#")) {
      key = line.slice(0, i).trim().toLowerCase();
      meta[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  const globs: string[] = [];
  for (const k of ["globs", "glob", "paths"]) globs.push(...(meta[k] && !meta[k].startsWith("-") ? splitGlobs(meta[k]) : []), ...(lists[k] ?? []));
  const t = (meta.trigger ?? "").toLowerCase();
  const trigger: Rule["trigger"] = t === "always_on" ? "always" : t === "glob" ? "glob" : t === "model_decision" ? "model" : t === "manual" ? "manual" : globs.length ? "glob" : "always";
  if (trigger === "glob" && !globs.length) return null; // trigger glob mà không có mẫu: bỏ qua cho an toàn
  return { name, description: (meta.description ?? "").slice(0, 200), trigger, globs, text: clip(text, MAX_RULE_CHARS) };
}

export async function loadRules(env: Env, root: string): Promise<Rule[]> {
  const out: Rule[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await env.readdir(join(root, rel));
    } catch {
      return;
    }
    for (const e of entries.slice(0, 50)) {
      const r = join(rel, e.name);
      if (e.isDir) {
        if (depth < 2) await walk(r, depth + 1);
      } else if (e.name.endsWith(".md") && out.length < 40) {
        try {
          const rule = parseRule(r, dec.decode(await env.readBytes(join(root, r))).slice(0, 30_000));
          if (rule) out.push(rule);
        } catch {
          /* bỏ qua tệp hỏng */
        }
      }
    }
  };
  for (const d of RULE_DIRS) await walk(d, 0);
  return out;
}

/** Quy tắc `glob` có áp dụng cho tệp này không (đường dẫn tương đối so với gốc dự án). */
export function ruleMatches(rule: Rule, rel: string): boolean {
  return rule.trigger === "glob" && rule.globs.some((g) => globToRegExp(g).test(rel) || (!g.includes("/") && globToRegExp(g).test(basename(rel))));
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
