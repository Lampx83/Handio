/**
 * Phần của bộ điều khiển dành riêng cho tab Work, tách ra để controller.ts gọn:
 * xem tài liệu (khi bấm chip trích dẫn), kiểm tra trích dẫn của agent, và "Quy trình của tôi" (lệnh / lưu trong dự án).
 */
import type { Env } from "./env";
import { loadCommands } from "./memory";
import { join } from "./path";
import { buildDocView, checkCitation, parseCitations, type DocView } from "./office/locate";
import { extOf, fold, isReadableDocument } from "./office/readdoc";
import { isSensitivePath } from "./sensitive";
import { relPath, resolveSafe, type ToolContext } from "./tools";

const MAX_DOC = 25 * 1024 * 1024;

/** Nội dung xem trước (chỉ đọc, chữ thuần) của một tài liệu trong dự án; đánh dấu vị trí trích dẫn `loc`. */
export async function docViewOf(ctx: ToolContext, path: string, loc?: string): Promise<DocView | { error: string }> {
  try {
    const abs = await resolveSafe(ctx, path);
    const rel = relPath(ctx, abs);
    if (isSensitivePath(rel)) return { error: "Tệp nhạy cảm, không xem ở đây." };
    if (!isReadableDocument(abs)) return { error: "Chưa xem được loại tệp này." };
    const st = await ctx.env.stat(abs);
    if (!st?.isFile) return { error: "Không có tệp này." };
    if (st.size > MAX_DOC) return { error: "Tệp quá lớn để xem." };
    return await buildDocView(await ctx.env.readBytes(abs), rel, loc);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Các trích dẫn [[tệp|vị trí]] trong câu trả lời mà không có thật trong tài liệu (không đánh giá nội dung có đúng ý hay không). */
export async function badCitations(ctx: ToolContext, text: string): Promise<{ checked: number; bad: string[] }> {
  const cites = parseCitations(text).slice(0, 12);
  const bad: string[] = [];
  for (const c of cites) {
    try {
      const abs = await resolveSafe(ctx, c.file);
      const st = await ctx.env.stat(abs);
      if (!st?.isFile) {
        bad.push(`${c.file} (không có tệp)`);
        continue;
      }
      if (st.size > MAX_DOC || isSensitivePath(relPath(ctx, abs))) continue;
      const r = await checkCitation(await ctx.env.readBytes(abs), extOf(abs), c.loc);
      if (!r.ok) bad.push(`${c.file} ${c.loc} (${r.reason ?? "không có"})`);
    } catch {
      bad.push(`${c.file} ${c.loc}`);
    }
  }
  return { checked: cites.length, bad };
}

// ---------------------------------------------------------------- Quy trình của tôi

export interface Procedure {
  name: string;
  description: string;
}

/** Tên lệnh: chữ thường không dấu, số, gạch nối; 2–30 ký tự. */
export function procedureSlug(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

export async function listProcedures(env: Env, root: string): Promise<Procedure[]> {
  return (await loadCommands(env, root)).filter((c) => !c.name.includes(":")).map((c) => ({ name: c.name, description: c.description }));
}

const ATTACH_MARK = "\n\n[Nội dung các tệp được đính kèm bằng @";

/** Dựng nội dung lệnh từ yêu cầu vừa làm xong: tham số hoá bằng $ARGUMENTS, kèm các bước công cụ đã dùng. */
export function procedureBody(request: string, tools: string[]): string {
  const req = request.split(ATTACH_MARK)[0].trim().slice(0, 4000);
  return [
    "Repeat the procedure below for: $ARGUMENTS",
    "Use the files/data the user names above instead of the ones in the sample request. If something is not named, ask a short question instead of guessing. Follow the same checks as before (read sources first, save under a new name, verify after saving).",
    "",
    "Sample request that worked:",
    req,
    tools.length ? `\nTools used last time, in order: ${tools.join(" → ")}.` : "",
  ].join("\n").trim() + "\n";
}

export async function saveProcedure(env: Env, root: string, spec: { name: string; description?: string; request: string; tools: string[] }, reserved: Iterable<string>): Promise<{ name: string } | { error: string }> {
  const name = procedureSlug(spec.name);
  if (name.length < 2) return { error: "Tên chưa hợp lệ." };
  const p = join(root, ".neuagent", "commands", name + ".md");
  if (await env.stat(p)) return { error: "Tên này đã có." };
  if ([...reserved].includes(name)) return { error: "Tên này đã là lệnh có sẵn." };
  const desc = (spec.description ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 100) || spec.request.replace(/\s+/g, " ").trim().slice(0, 80);
  await env.mkdirp(join(root, ".neuagent", "commands"));
  await env.writeText(p, `---\ndescription: ${desc.replace(/^['"]|['"]$/g, "")}\n---\n${procedureBody(spec.request, spec.tools)}`);
  return { name };
}

export async function removeProcedure(env: Env, root: string, name: string): Promise<boolean> {
  const slug = procedureSlug(name);
  if (!slug || slug !== name) return false;
  const p = join(root, ".neuagent", "commands", slug + ".md");
  if (!(await env.stat(p))) return false;
  await env.remove(p);
  return true;
}
