import type { Env } from "./env";
import { join } from "./path";
import { frontmatter, SAFE_NAME, type CustomCommand, type CustomSkill, type CustomAgent } from "./memory";
import { sanitizeHooks, type HooksConfig } from "./hooks";
import { sanitizeMcpServers, type McpServerSpec } from "./mcp";
import { sanitizeHttpTools, type HttpToolSpec } from "./http-tools";
import type { Profile } from "./profiles";

/**
 * GÓI MỞ RỘNG (extension pack): cách thêm tính năng cho Hando mà KHÔNG sửa mã nguồn lõi.
 * Một gói là một thư mục chỉ gồm tệp chữ (xem docs/EXTENSIONS.md):
 *   pack.json            {id, name, version, description, profiles?}
 *   prompt.md            lời dặn thêm vào system prompt (quy ước của tổ chức, văn phong…)
 *   skills/<tên>/SKILL.md (+ tệp kèm)   quy trình/kiến thức nạp khi cần
 *   commands/<tên>.md    lệnh /tên (mẫu nghiệp vụ…)
 *   agents/<tên>.md      subagent chuyên biệt
 *   mcp.json             máy chủ MCP (công cụ mới: tìm web, email, lịch…)  — chỉ gói org/user
 *   hooks.json           hook                                               — chỉ gói org/user
 * Lõi chỉ biết ĐỊNH DẠNG này; nội dung riêng của một tổ chức (NEU hay nơi khác) nằm hoàn toàn trong gói.
 */

/** org = quản trị cài cùng ứng dụng (tin cậy) · user = người dùng tự cài ở máy mình (tin cậy) · project = nằm trong thư mục dự án (KHÔNG tin cậy: chỉ được có nội dung chữ). */
export type PackOrigin = "org" | "user" | "project";

export interface RawPack {
  /** Tên thư mục của gói. */
  dir: string;
  origin: PackOrigin;
  /** Đường dẫn tương đối (dùng "/") → nội dung chữ. */
  files: Record<string, string>;
}

export interface PackManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Tab nào dùng gói này; mặc định cả ba. */
  profiles: Profile[];
}

export interface LoadedPack {
  manifest: PackManifest;
  origin: PackOrigin;
  prompt: string;
  commands: CustomCommand[];
  skills: CustomSkill[];
  agents: CustomAgent[];
  mcpServers: Record<string, McpServerSpec>;
  hooks: HooksConfig;
  /** Công cụ gọi dịch vụ HTTP của tổ chức (tools.json). */
  httpTools: Record<string, HttpToolSpec>;
}

export const PACK_LIMITS = { files: 300, fileChars: 100_000, prompt: 6000, skills: 50, commands: 150, agents: 30, skillTexts: 40_000 };
const ALL_PROFILES: Profile[] = ["work", "code", "design"];
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Chọn tab dùng được gói trong một danh sách. */
export const packsFor = (packs: readonly LoadedPack[], profile: Profile): LoadedPack[] => packs.filter((p) => p.manifest.profiles.includes(profile));

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Đọc một gói đã nạp thô thành dạng dùng được. Gói hỏng trả về `error` (không ném lỗi, để một gói xấu không làm hỏng ứng dụng). */
export function parsePack(raw: RawPack): { pack?: LoadedPack; error?: string; warnings: string[] } {
  const warnings: string[] = [];
  const files = Object.entries(raw.files).filter(([k]) => !k.includes("..") && !k.startsWith("/"));
  if (files.length > PACK_LIMITS.files) return { error: `gói '${raw.dir}' có quá nhiều tệp (${files.length} > ${PACK_LIMITS.files})`, warnings };
  const f: Record<string, string> = {};
  for (const [k, v] of files) if (typeof v === "string" && v.length <= PACK_LIMITS.fileChars) f[k] = v;
    else warnings.push(`gói '${raw.dir}': bỏ qua tệp ${k} (quá lớn)`);

  const m = parseJson(f["pack.json"]) as Partial<PackManifest> | undefined;
  if (!m || typeof m !== "object") return { error: `gói '${raw.dir}' thiếu hoặc hỏng pack.json`, warnings };
  const id = typeof m.id === "string" && PACK_ID.test(m.id) ? m.id : PACK_ID.test(raw.dir) ? raw.dir : "";
  if (!id) return { error: `gói '${raw.dir}' có id không hợp lệ (chỉ a-z, 0-9, dấu gạch ngang)`, warnings };
  const profiles = Array.isArray(m.profiles) ? (m.profiles.filter((p): p is Profile => (ALL_PROFILES as string[]).includes(p as string)) as Profile[]) : ALL_PROFILES;
  const manifest: PackManifest = {
    id,
    name: typeof m.name === "string" && m.name ? m.name.slice(0, 80) : id,
    version: typeof m.version === "string" ? m.version.slice(0, 20) : "0.0.0",
    description: typeof m.description === "string" ? m.description.slice(0, 300) : "",
    profiles: profiles.length ? profiles : ALL_PROFILES,
  };

  const commands: CustomCommand[] = [];
  const agents: CustomAgent[] = [];
  const skills: CustomSkill[] = [];
  const skillFiles = new Map<string, string[]>();
  for (const [path, text] of Object.entries(f)) {
    let mm: RegExpExecArray | null;
    if ((mm = /^commands\/((?:[A-Za-z0-9_-]+\/){0,2}[A-Za-z0-9_-]+)\.md$/.exec(path))) {
      if (commands.length >= PACK_LIMITS.commands) continue;
      const { meta, body } = frontmatter(text);
      commands.push({ name: mm[1].split("/").join(":"), description: (meta.description || body.trim().split("\n")[0]).slice(0, 120), body: body.trim() });
    } else if ((mm = /^agents\/([A-Za-z0-9_-]+)\.md$/.exec(path))) {
      if (agents.length >= PACK_LIMITS.agents) continue;
      const { meta, body } = frontmatter(text);
      const name = meta.name || mm[1];
      if (!SAFE_NAME.test(name)) continue;
      const tools = meta.tools ? meta.tools.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : null;
      agents.push({ name, description: (meta.description || "").slice(0, 300), prompt: body.trim(), tools: tools && tools.length ? tools : null, source: `pack:${id}/${path}` });
    } else if ((mm = /^skills\/([A-Za-z0-9_-]+)\/(.+)$/.exec(path))) {
      const list = skillFiles.get(mm[1]) ?? [];
      list.push(mm[2]);
      skillFiles.set(mm[1], list);
    }
  }
  for (const [dirName, names] of skillFiles) {
    if (skills.length >= PACK_LIMITS.skills) break;
    const main = f[`skills/${dirName}/SKILL.md`];
    if (main === undefined) continue;
    const { meta, body } = frontmatter(main);
    const name = meta.name || dirName;
    if (!SAFE_NAME.test(name)) continue;
    const others = names.filter((n) => n !== "SKILL.md");
    const texts: Record<string, string> = {};
    let budget = PACK_LIMITS.skillTexts;
    for (const n of others) {
      const t = f[`skills/${dirName}/${n}`];
      if (t !== undefined && t.length <= budget) {
        texts[n] = t;
        budget -= t.length;
      }
    }
    skills.push({ name, description: (meta.description || "").slice(0, 300), body: body.trim(), dir: `pack:${id}/skills/${dirName}`, files: others.slice(0, 30), texts });
  }

  const trusted = raw.origin !== "project";
  let mcpServers: Record<string, McpServerSpec> = {};
  let hooks: HooksConfig = {};
  let httpTools: Record<string, HttpToolSpec> = {};
  if (trusted) {
    mcpServers = sanitizeMcpServers(parseJson(f["mcp.json"]));
    hooks = sanitizeHooks(parseJson(f["hooks.json"]));
    httpTools = sanitizeHttpTools(parseJson(f["tools.json"]));
  } else if (f["mcp.json"] || f["hooks.json"] || f["tools.json"]) {
    warnings.push(`gói '${id}' nằm trong dự án nên bị bỏ qua mcp.json/hooks.json/tools.json (chỉ gói do quản trị hoặc chính bạn cài mới được chạy chương trình hay gọi dịch vụ)`);
  }

  let prompt = (f["prompt.md"] ?? "").trim();
  if (prompt.length > PACK_LIMITS.prompt) {
    prompt = prompt.slice(0, PACK_LIMITS.prompt) + "\n… (đã cắt bớt)";
    warnings.push(`gói '${id}': prompt.md dài quá, đã cắt bớt`);
  }
  return { pack: { manifest, origin: raw.origin, prompt, commands, skills, agents, mcpServers, hooks, httpTools }, warnings };
}

const RANK: Record<PackOrigin, number> = { project: 3, user: 2, org: 1 };

/** Đọc nhiều gói; trùng id thì gói gần người dùng hơn thắng (project > user > org). */
export function parsePacks(raws: readonly RawPack[]): { packs: LoadedPack[]; notices: string[] } {
  const notices: string[] = [];
  const byId = new Map<string, LoadedPack>();
  for (const r of [...raws].sort((a, b) => RANK[a.origin] - RANK[b.origin])) {
    const { pack, error, warnings } = parsePack(r);
    notices.push(...warnings);
    if (error) notices.push(error);
    else if (pack) byId.set(pack.manifest.id, pack);
  }
  return { packs: [...byId.values()], notices };
}

/** Nạp gói nằm trong thư mục dự án (`.neuagent/packs/<tên>/…`) qua Env: dùng cho cả bản web (thư mục ảo). */
export async function readProjectPacks(env: Env, root: string): Promise<RawPack[]> {
  const base = join(root, ".neuagent", "packs");
  let dirs;
  try {
    dirs = await env.readdir(base);
  } catch {
    return [];
  }
  const dec = new TextDecoder();
  const out: RawPack[] = [];
  for (const d of dirs.filter((x) => x.isDir).slice(0, 20)) {
    const files: Record<string, string> = {};
    let count = 0;
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await env.readdir(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (count > PACK_LIMITS.files) return;
        const p = join(dir, e.name);
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDir) {
          if (depth < 4) await walk(p, r, depth + 1);
        } else if (/\.(md|json|txt|csv|html|css|js|mjs)$/i.test(e.name)) {
          try {
            const st = await env.stat(p);
            if (st && st.size <= PACK_LIMITS.fileChars) {
              files[r] = dec.decode(await env.readBytes(p));
              count++;
            }
          } catch {
            /* bỏ qua */
          }
        }
      }
    };
    await walk(join(base, d.name), "", 0);
    out.push({ dir: d.name, origin: "project", files });
  }
  return out;
}

/** Gộp thành phần của các gói (đã lọc theo tab). Phần của dự án/người dùng ghi đè gói cùng tên; giữa các gói, gói đứng trước thắng. */
export function mergePackParts(packs: readonly LoadedPack[]): {
  commands: CustomCommand[];
  skills: CustomSkill[];
  agents: CustomAgent[];
  prompts: { pack: string; text: string }[];
  mcpServers: Record<string, McpServerSpec>;
  hooks: HooksConfig;
  httpTools: Record<string, HttpToolSpec>;
} {
  const commands = new Map<string, CustomCommand>();
  const skills = new Map<string, CustomSkill>();
  const agents = new Map<string, CustomAgent>();
  const mcpServers: Record<string, McpServerSpec> = {};
  const hooks: HooksConfig = {};
  const httpTools: Record<string, HttpToolSpec> = {};
  const prompts: { pack: string; text: string }[] = [];
  for (const p of packs) {
    for (const c of p.commands) if (!commands.has(c.name)) commands.set(c.name, c);
    for (const s of p.skills) if (!skills.has(s.name)) skills.set(s.name, s);
    for (const a of p.agents) if (!agents.has(a.name)) agents.set(a.name, a);
    for (const [k, v] of Object.entries(p.mcpServers)) if (!(k in mcpServers)) mcpServers[k] = v;
    for (const [ev, entries] of Object.entries(p.hooks) as [keyof HooksConfig, NonNullable<HooksConfig[keyof HooksConfig]>][]) hooks[ev] = [...(hooks[ev] ?? []), ...entries];
    for (const [k, v] of Object.entries(p.httpTools)) if (!(k in httpTools)) httpTools[k] = v;
    if (p.prompt) prompts.push({ pack: p.manifest.name, text: p.prompt });
  }
  return { commands: [...commands.values()], skills: [...skills.values()], agents: [...agents.values()], prompts, mcpServers, hooks, httpTools };
}
