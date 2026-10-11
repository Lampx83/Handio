/* eslint-disable @typescript-eslint/no-explicit-any */
import type JSZipType from "jszip";
import type { Env, StatInfo } from "../env";
import { matchGlob } from "../glob";
import { basename, dirname, extname, isInside, join, normalize } from "../path";
import { PROTECTED } from "../permissions";
import { isSensitivePath } from "../sensitive";
import { IGNORE_DIRS, pushUndo, relPath, remember, resolveSafe, similarPaths, ToolError, type DiffPreview, type Tool, type ToolContext } from "../tools";
import { decodeXml, loadZip, type ZipLimits } from "./docx-read";
import { jsonArg, kb } from "./tools";

/**
 * Tệp: copy_file, move_file, delete_file, make_dir, zip_files, unzip_file, file_info. (Mỗi công cụ: mô tả tiếng Anh cho mô hình, thông báo lỗi tiếng Việt, kiểm thử riêng — xem AGENTS.md.)
 *
 * An toàn (không nới lỏng quyền hiện có):
 *  - mọi đường dẫn qua resolveSafe (không ra ngoài dự án, theo cả liên kết tượng trưng);
 *  - hệ thống quyền chỉ kiểm MỘT đường dẫn (đích ghi) nên mọi đường dẫn NGUỒN và các tệp bên trong thư mục được kiểm lại ở đây:
 *    tệp nhạy cảm (sensitive.ts) và tệp cấu hình/lịch sử dự án (PROTECTED) bị từ chối, trong thư mục thì bị bỏ qua (nén/sao chép) hoặc từ chối (di chuyển);
 *  - không bao giờ ghi đè đích có sẵn nếu chưa có overwrite=true và chưa xem nó; không ghi đè thư mục;
 *  - mọi thay đổi vào ctx.undoStack theo nhóm (một lần di chuyển/giải nén = một lần /undo).
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TREE_BYTES = 100 * 1024 * 1024;
const MAX_TREE_ENTRIES = 2000;
const ZIP_LIMITS: ZipLimits = { maxEntries: MAX_TREE_ENTRIES, maxEntryBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TREE_BYTES };
const OFFICE_FACTS_MAX = 25 * 1024 * 1024;
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

const extOf = (p: string): string => extname(p).toLowerCase();

const S = { type: "string" } as const;
const OVERWRITE = { type: "boolean", description: "allow replacing an existing destination file (only if you have looked at it first with file_info or read_document)" } as const;

let groupSeq = 0;
const newGroup = (): string => `f${Date.now().toString(36)}${groupSeq++}`;

// ---------------------------------------------------------------- kiểm tra đường dẫn

/** Tệp/thư mục cấu hình hoặc lịch sử của dự án (`.git/**`, AGENTS.md…): thư mục cũng tính (`.git` khớp `.git/**`). */
const isProtectedRel = (rel: string): boolean => PROTECTED.some((g) => matchGlob(g, rel) || matchGlob(g, rel + "/x")) || /(^|\/)\.(git|neuagent)(\/|$)/.test(rel); // .git lồng trong thư mục con cũng tính
const guarded = (rel: string): boolean => isSensitivePath(rel) || isProtectedRel(rel);

function refuseGuarded(rel: string, verb: string): never {
  throw new ToolError(`${rel}: tệp nhạy cảm hoặc cấu hình dự án (khoá, mật khẩu, .git, AGENTS.md…): công cụ này không ${verb} nó. Nếu thật sự cần, hãy tự làm ngoài trợ lý.`);
}

const isRootDir = (ctx: ToolContext, abs: string): boolean => [ctx.root, ...ctx.extraDirs].some((d) => normalize(d) === abs);

/** Nguồn phải có, nằm trong dự án, không phải thư mục gốc và không nhạy cảm/được bảo vệ. */
async function sourceOf(ctx: ToolContext, raw: unknown, verb: string): Promise<{ abs: string; rel: string; st: StatInfo }> {
  const abs = await resolveSafe(ctx, raw);
  const st = await ctx.env.stat(abs);
  if (!st) throw new ToolError(`Không có ${raw}.${await similarPaths(ctx, abs)}`, "not_found");
  if (isRootDir(ctx, abs)) throw new ToolError(`${raw} là thư mục gốc của dự án: không ${verb} được.`, "wrong_type");
  const rel = relPath(ctx, abs);
  if (guarded(rel)) refuseGuarded(rel, verb);
  return { abs, rel, st };
}

/** Thư mục tồn tại gần nhất phải là thư mục (không phải tệp), rồi tạo phần còn thiếu. */
async function ensureDir(ctx: ToolContext, dirAbs: string): Promise<void> {
  for (let d = dirAbs; ; ) {
    const st = await ctx.env.stat(d);
    if (st) {
      if (!st.isDir) throw new ToolError(`${relPath(ctx, d)} là tệp, không thể đặt gì vào bên trong nó.`, "wrong_type");
      if (d === dirAbs) return;
      break;
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  await ctx.env.mkdirp(dirAbs);
}

/** Thư mục cao nhất chưa tồn tại trên đường tới `dirAbs` (null nếu nó đã có): để hoàn tác bằng cách xoá đúng phần mới tạo. */
async function topMissing(ctx: ToolContext, dirAbs: string): Promise<string | null> {
  let top: string | null = null;
  let d = dirAbs;
  while (!(await ctx.env.stat(d))) {
    top = d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return top;
}

/** Tạo thư mục chứa; phần thư mục mới tạo được ghi vào nhật ký hoàn tác TRƯỚC (để khi hoàn tác nó bị gỡ sau cùng, sau các tệp bên trong). */
async function prepareParent(ctx: ToolContext, dirAbs: string, group?: string): Promise<void> {
  const top = await topMissing(ctx, dirAbs);
  await ensureDir(ctx, dirAbs);
  if (top) pushUndo(ctx, top, null, group);
}

/** Tệp đã "xem" bằng file_info (không phải đọc nội dung nên không được tính vào ctx.readFiles: write_file vẫn bắt đọc thật). Khoá theo phiên. */
const inspected = new WeakMap<Map<string, number>, Map<string, number>>();
const inspectedOf = (ctx: ToolContext): Map<string, number> => {
  let m = inspected.get(ctx.readFiles);
  if (!m) inspected.set(ctx.readFiles, (m = new Map()));
  return m;
};

/** Đích đã có tệp: chỉ ghi đè khi overwrite=true, đã xem nó và nó không đổi kể từ đó. */
function checkOverwrite(ctx: ToolContext, abs: string, rel: string, st: StatInfo, overwrite: boolean): void {
  if (st.isDir) throw new ToolError(`${rel} là thư mục đã có. Chọn tên khác.`, "wrong_type");
  if (!overwrite) throw new ToolError(`${rel} đã tồn tại. Chọn tên khác, hoặc đặt overwrite=true để ghi đè (hoàn tác được bằng undo).`);
  const seen = [ctx.readFiles.get(abs), inspectedOf(ctx).get(abs)];
  if (seen.every((v) => v === undefined)) throw new ToolError(`${rel} đã tồn tại và bạn chưa xem nó. Hãy dùng file_info (hoặc read_document) để xem trước rồi mới ghi đè.`, "read_first");
  if (!seen.includes(st.mtimeMs)) throw new ToolError(`${rel} đã thay đổi kể từ lần xem trước (do người dùng hoặc chương trình khác). Xem lại bằng file_info rồi thử lại.`, "stale");
}

/** Đích của sao chép/di chuyển: nếu `to` là thư mục có sẵn (hoặc kết thúc bằng /) thì đặt vào trong với tên cũ. */
async function targetOf(ctx: ToolContext, rawTo: unknown, srcAbs: string, srcIsDir: boolean): Promise<{ abs: string; rel: string; st: StatInfo | null }> {
  const toAbs = await resolveSafe(ctx, rawTo);
  const st0 = await ctx.env.stat(toAbs);
  const slash = typeof rawTo === "string" && /[\\/]\s*$/.test(rawTo);
  if (slash && st0 && !st0.isDir) throw new ToolError(`${rawTo} là tệp, không phải thư mục.`, "wrong_type");
  const abs = st0?.isDir || slash ? join(toAbs, basename(srcAbs)) : toAbs;
  const rel = relPath(ctx, abs);
  if (abs === srcAbs) throw new ToolError(`Nguồn và đích trùng nhau (${rel}). Nếu chỉ muốn đổi hoa/thường của tên, hãy đổi qua một tên tạm rồi đổi lại.`, "bad_args");
  if (srcIsDir && isInside(srcAbs, abs)) throw new ToolError(`Không thể đặt thư mục ${relPath(ctx, srcAbs)} vào bên trong chính nó (${rel}).`, "bad_args");
  if (abs !== toAbs && guarded(rel)) refuseGuarded(rel, "ghi vào");
  if (isRootDir(ctx, abs)) throw new ToolError(`${rel} là thư mục gốc của dự án.`, "bad_args");
  return { abs, rel, st: await ctx.env.stat(abs) };
}

// ---------------------------------------------------------------- duyệt cây thư mục

interface TreeEntry {
  abs: string;
  /** Đường dẫn tương đối so với gốc của cây, dùng "/". */
  rel: string;
  isDir: boolean;
  size: number;
}
interface Tree {
  entries: TreeEntry[];
  files: number;
  bytes: number;
  /** Tệp nhạy cảm/cấu hình bị bỏ qua (đường dẫn so với dự án). */
  guarded: string[];
  /** Liên kết tượng trưng trỏ ra ngoài dự án (bỏ qua). */
  links: string[];
  /** Tên thư mục bị bỏ qua theo yêu cầu (node_modules…). */
  ignored: Set<string>;
}

/** Liệt kê mọi thứ dưới `root` (thư mục), theo thứ tự thư mục trước nội dung; vượt giới hạn số mục/dung lượng thì báo lỗi. */
async function scanTree(ctx: ToolContext, root: string, o: { ignoreNames?: Set<string>; exclude?: string } = {}): Promise<Tree> {
  const t: Tree = { entries: [], files: 0, bytes: 0, guarded: [], links: [], ignored: new Set() };
  const tooMany = () => new ToolError(`Thư mục ${relPath(ctx, root)} quá lớn cho công cụ này (giới hạn ${MAX_TREE_ENTRIES} mục, ${kb(MAX_TREE_BYTES)}). Hãy làm từng thư mục con.`);
  const visit = async (dir: string, relDir: string): Promise<void> => {
    const items = (await ctx.env.readdir(dir)).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of items) {
      if (JUNK.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDir && o.ignoreNames?.has(e.name)) {
        t.ignored.add(e.name);
        continue;
      }
      if (o.exclude === abs) continue;
      const pr = relPath(ctx, abs);
      if (guarded(pr)) {
        t.guarded.push(pr);
        continue;
      }
      try {
        await resolveSafe(ctx, abs);
      } catch {
        t.links.push(pr);
        continue;
      }
      if (t.entries.length >= MAX_TREE_ENTRIES) throw tooMany();
      if (e.isDir) {
        t.entries.push({ abs, rel, isDir: true, size: 0 });
        await visit(abs, rel);
      } else {
        const st = await ctx.env.stat(abs);
        if (!st?.isFile) continue;
        if (st.size > MAX_FILE_BYTES || t.bytes + st.size > MAX_TREE_BYTES) throw tooMany();
        t.bytes += st.size;
        t.files++;
        t.entries.push({ abs, rel, isDir: false, size: st.size });
      }
    }
  };
  await visit(root, "");
  return t;
}

const noteSkipped = (t: Tree): string =>
  (t.guarded.length ? `\nBỏ qua ${t.guarded.length} mục nhạy cảm/cấu hình (khoá, .env, .git…).` : "") + (t.links.length ? `\nBỏ qua ${t.links.length} liên kết tượng trưng trỏ ra ngoài dự án.` : "");

// ---------------------------------------------------------------- xem trước

async function outline(ctx: ToolContext, rawPath: unknown, text: string): Promise<DiffPreview | null> {
  try {
    const abs = await resolveSafe(ctx, rawPath);
    return { path: relPath(ctx, abs), diff: [], isNew: !(await ctx.env.stat(abs)), outline: text };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- sao chép / di chuyển

async function transfer(ctx: ToolContext, a: any, mode: "copy" | "move"): Promise<string> {
  const verb = mode === "copy" ? "sao chép" : "di chuyển";
  if (typeof a.to !== "string" || !a.to.trim()) throw new ToolError("Thiếu đường dẫn đích (to).", "bad_args");
  const src = await sourceOf(ctx, a.from, verb);
  const dst = await targetOf(ctx, a.to, src.abs, src.st.isDir);
  const group = newGroup();

  if (src.st.isDir) {
    if (dst.st) throw new ToolError(`${dst.rel} đã có (tệp hoặc thư mục). Chọn tên khác: công cụ này không ghi đè hay trộn thư mục.`, "wrong_type");
    const tree = await scanTree(ctx, src.abs);
    if (mode === "move" && (tree.guarded.length || tree.links.length))
      throw new ToolError(`Thư mục ${src.rel} có chứa ${tree.guarded.length ? "tệp nhạy cảm/cấu hình (" + tree.guarded.slice(0, 3).join(", ") + ")" : "liên kết tượng trưng ra ngoài dự án"}: không di chuyển nguyên thư mục. Hãy di chuyển từng tệp cần thiết.`);
    const bad = tree.entries.find((e) => guarded(relPath(ctx, join(dst.abs, e.rel))));
    if (bad) throw new ToolError(`${relPath(ctx, join(dst.abs, bad.rel))}: đích nằm trong vùng nhạy cảm/cấu hình dự án. Chọn thư mục đích khác.`);
    await prepareParent(ctx, dst.abs, group); // gồm cả chính thư mục đích (mới)
    const copied: { src: string; dst: string; bytes: Uint8Array }[] = [];
    for (const e of tree.entries) {
      const to = join(dst.abs, e.rel);
      if (e.isDir) {
        await ctx.env.mkdirp(to);
        continue;
      }
      const bytes = await ctx.env.readBytes(e.abs);
      await ctx.env.writeBytes(to, bytes);
      pushUndo(ctx, to, null, group);
      if (mode === "move") copied.push({ src: e.abs, dst: to, bytes });
    }
    if (mode === "move") {
      for (const c of copied) pushUndo(ctx, c.src, c.bytes, group);
      await ctx.env.remove(src.abs);
      for (const k of [...ctx.readFiles.keys()]) if (isInside(src.abs, k)) ctx.readFiles.delete(k);
    }
    for (const e of tree.entries) if (!e.isDir) await remember(ctx, join(dst.abs, e.rel));
    return `Đã ${verb} thư mục ${src.rel} → ${dst.rel} (${tree.files} tệp, ${kb(tree.bytes)}).` + (mode === "copy" ? noteSkipped(tree) : "") + (mode === "move" ? "\nThư mục rỗng không khôi phục được khi hoàn tác." : "");
  }

  if (src.st.size > MAX_FILE_BYTES) throw new ToolError(`${src.rel} quá lớn (${kb(src.st.size)}, giới hạn ${kb(MAX_FILE_BYTES)}).`);
  if (dst.st) checkOverwrite(ctx, dst.abs, dst.rel, dst.st, a.overwrite === true);
  await prepareParent(ctx, dirname(dst.abs), group);
  const bytes = await ctx.env.readBytes(src.abs);
  const old = dst.st ? await ctx.env.readBytes(dst.abs) : null;
  await ctx.env.writeBytes(dst.abs, bytes);
  pushUndo(ctx, dst.abs, old, group);
  if (mode === "move") {
    pushUndo(ctx, src.abs, bytes, group);
    await ctx.env.remove(src.abs);
    ctx.readFiles.delete(src.abs);
  }
  await remember(ctx, dst.abs);
  return `Đã ${verb} ${src.rel} → ${dst.rel} (${kb(bytes.length)})${old ? ", ghi đè bản cũ (hoàn tác được bằng undo)" : ""}.`;
}

// ---------------------------------------------------------------- nén / giải nén

async function newZip(): Promise<JSZipType> {
  const mod = await import("jszip");
  const JSZip = (mod as unknown as { default: new () => JSZipType }).default ?? (mod as unknown as new () => JSZipType);
  return new JSZip();
}

const plausibleDate = (ms: number): Date | undefined => (ms > 1e11 ? new Date(ms) : undefined);

/** Đọc một thành phần của zip, dừng NGAY khi vượt `maxBytes` (tiêu đề zip có thể khai gian kích thước: không tin, đếm byte thật). */
function readEntry(entry: unknown, maxBytes: number, name: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let n = 0;
    const h = (entry as { internalStream(t: "uint8array"): any }).internalStream("uint8array");
    h.on("data", (c: Uint8Array) => {
      n += c.length;
      if (n > maxBytes) {
        h.pause();
        reject(new ToolError(`Tệp zip giải nén ra quá lớn (“${name.slice(0, 60)}” vượt giới hạn). Nghi ngờ tệp độc hại, đã từ chối giải nén.`));
        return;
      }
      chunks.push(c);
    })
      .on("error", (e: Error) => reject(new ToolError(`Không giải nén được “${name.slice(0, 60)}”: ${e.message}`)))
      .on("end", () => {
        const out = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        resolve(out);
      })
      .resume();
  });
}

/** Tên thành phần có thể ghi ra ngoài thư mục đích (zip-slip): tuyệt đối, ổ đĩa, có "..", hoặc ký tự rỗng. */
const unsafeEntryName = (raw: string): boolean => {
  const n = raw.replace(/\\/g, "/");
  return n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").includes("..") || n.includes("\0");
};

async function zipFiles(ctx: ToolContext, a: any): Promise<string> {
  const paths = jsonArg<unknown[]>(a.paths, "paths");
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== "string" || !p.trim())) throw new ToolError("paths phải là danh sách đường dẫn (tệp hoặc thư mục) cần nén.", "bad_args");
  if (paths.length > 200) throw new ToolError("Tối đa 200 đường dẫn mỗi lần nén; hãy gom vào thư mục rồi nén thư mục.", "bad_args");
  const out = await resolveSafe(ctx, a.output);
  if (extOf(out) !== ".zip") throw new ToolError(`output phải có đuôi .zip (nhận “${a.output}”).`, "bad_args");
  const outRel = relPath(ctx, out);
  const ost = await ctx.env.stat(out);
  if (ost) checkOverwrite(ctx, out, outRel, ost, a.overwrite === true);

  const zip = await newZip();
  const names = new Set<string>();
  const add = (name: string): string => {
    if (names.has(name)) throw new ToolError(`Hai mục trùng tên “${name}” trong tệp zip. Hãy nén riêng hoặc đổi tên một trong hai.`, "bad_args");
    names.add(name);
    return name;
  };
  let files = 0;
  let bytes = 0;
  const skipped: string[] = [];
  const links: string[] = [];
  for (const raw of paths as string[]) {
    const src = await sourceOf(ctx, raw, "nén");
    if (src.abs === out) throw new ToolError(`${src.rel} chính là tệp zip đầu ra.`, "bad_args");
    const top = basename(src.abs);
    if (!src.st.isDir) {
      if (src.st.size > MAX_FILE_BYTES || bytes + src.st.size > MAX_TREE_BYTES) throw new ToolError(`Dữ liệu cần nén quá lớn (giới hạn ${kb(MAX_TREE_BYTES)}, mỗi tệp ${kb(MAX_FILE_BYTES)}).`);
      bytes += src.st.size;
      files++;
      zip.file(add(top), await ctx.env.readBytes(src.abs), { binary: true, date: plausibleDate(src.st.mtimeMs) });
      continue;
    }
    const tree = await scanTree(ctx, src.abs, { exclude: out });
    skipped.push(...tree.guarded);
    links.push(...tree.links);
    zip.folder(add(top + "/"));
    for (const e of tree.entries) {
      if (e.isDir) {
        zip.folder(add(`${top}/${e.rel}/`));
        continue;
      }
      if (bytes + e.size > MAX_TREE_BYTES) throw new ToolError(`Dữ liệu cần nén quá lớn (giới hạn ${kb(MAX_TREE_BYTES)}).`);
      bytes += e.size;
      files++;
      const st = await ctx.env.stat(e.abs);
      zip.file(add(`${top}/${e.rel}`), await ctx.env.readBytes(e.abs), { binary: true, date: plausibleDate(st?.mtimeMs ?? 0) });
    }
  }
  if (!files) throw new ToolError("Không có tệp nào để nén (thư mục rỗng hoặc toàn tệp bị bỏ qua).", "bad_args");
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const old = ost ? await ctx.env.readBytes(out) : null;
  const group = newGroup();
  await prepareParent(ctx, dirname(out), group);
  await ctx.env.writeBytes(out, data);
  await remember(ctx, out);
  pushUndo(ctx, out, old, group);
  return `Đã nén ${files} tệp vào ${outRel} (${kb(bytes)} → ${kb(data.length)}).` + (skipped.length ? `\nBỏ qua ${skipped.length} tệp nhạy cảm/cấu hình (khoá, .env, .git…).` : "") + (links.length ? `\nBỏ qua ${links.length} liên kết tượng trưng trỏ ra ngoài dự án.` : "");
}

const defaultUnzipDir = (a: any): string => (typeof a.output_dir === "string" && a.output_dir.trim() ? a.output_dir : String(a.path ?? "").replace(/\.zip\s*$/i, ""));

async function unzipFile(ctx: ToolContext, a: any): Promise<string> {
  const src = await sourceOf(ctx, a.path, "giải nén");
  if (src.st.isDir) throw new ToolError(`${src.rel} là thư mục, không phải tệp .zip.`, "wrong_type");
  if (extOf(src.abs) !== ".zip") throw new ToolError(`${src.rel}: chỉ giải nén được tệp .zip (Word/Excel/PowerPoint hãy dùng read_document).`, "unsupported");
  if (src.st.size > MAX_TREE_BYTES) throw new ToolError(`${src.rel} quá lớn (${kb(src.st.size)}, giới hạn ${kb(MAX_TREE_BYTES)}).`);
  const rawDir = defaultUnzipDir(a);
  if (rawDir === String(a.path ?? "")) throw new ToolError("Hãy chỉ rõ output_dir (thư mục đích).", "bad_args");
  const outDir = await resolveSafe(ctx, rawDir);
  const outRel = relPath(ctx, outDir);
  if (isRootDir(ctx, outDir)) throw new ToolError("Hãy giải nén vào một thư mục con, không phải thư mục gốc của dự án.", "bad_args");
  const dst = await ctx.env.stat(outDir);
  if (dst && !dst.isDir) throw new ToolError(`${outRel} là tệp, không phải thư mục.`, "wrong_type");

  let zip: JSZipType;
  try {
    zip = await loadZip(await ctx.env.readBytes(src.abs), ZIP_LIMITS);
  } catch (e) {
    throw new ToolError(/quá lớn/.test((e as Error).message) ? `${src.rel} giải nén ra quá lớn hoặc có quá nhiều tệp (giới hạn ${MAX_TREE_ENTRIES} mục, ${kb(MAX_TREE_BYTES)}): nghi ngờ tệp độc hại, đã từ chối giải nén.` : `Không mở được ${src.rel} (tệp zip hỏng hoặc có mật khẩu).`);
  }

  // 1) lập kế hoạch: kiểm tra mọi tên TRƯỚC khi ghi bất cứ thứ gì
  interface Planned { entry: unknown; abs: string; rel: string; isDir: boolean }
  const plan: Planned[] = [];
  const seen = new Set<string>();
  let guardedN = 0;
  for (const entry of Object.values(zip.files)) {
    const raw = entry.unsafeOriginalName ?? entry.name;
    if (/^[./\\]*$/.test(raw)) continue; // "/" hoặc "./": không có tên
    if (unsafeEntryName(raw) || unsafeEntryName(entry.name))
      throw new ToolError(`Tệp zip có đường dẫn không an toàn (“${raw.slice(0, 80)}”): có thể ghi ra ngoài thư mục đích. Đã từ chối giải nén, không có tệp nào được ghi.`);
    const clean = normalize(raw.replace(/\\/g, "/"));
    if (!clean || clean === ".") continue;
    if (clean.split("/").some((s) => JUNK.has(s)) || clean.startsWith("__MACOSX/")) continue;
    const abs = join(outDir, clean);
    if (!isInside(outDir, abs) || abs === outDir) throw new ToolError(`Tệp zip có đường dẫn không an toàn (“${raw.slice(0, 80)}”). Đã từ chối giải nén.`);
    let real: string;
    try {
      real = await resolveSafe(ctx, abs); // theo cả liên kết tượng trưng có sẵn trong thư mục đích
    } catch {
      throw new ToolError(`“${raw.slice(0, 80)}” sẽ được ghi ra ngoài dự án qua một liên kết tượng trưng. Đã từ chối giải nén.`);
    }
    const rel = relPath(ctx, real);
    if (guarded(rel)) {
      if (!entry.dir) guardedN++;
      continue;
    }
    if (seen.has(real)) throw new ToolError(`Tệp zip có hai mục trùng tên “${clean.slice(0, 80)}”.`);
    seen.add(real);
    plan.push({ entry, abs: real, rel, isDir: entry.dir });
    if (plan.length > MAX_TREE_ENTRIES) throw new ToolError(`${src.rel} có quá nhiều mục (giới hạn ${MAX_TREE_ENTRIES}).`);
  }
  if (!plan.some((p) => !p.isDir)) throw new ToolError(guardedN ? `${src.rel} chỉ có tệp nhạy cảm/cấu hình nên không giải nén.` : `${src.rel} không có tệp nào.`, "bad_args");
  // một tên vừa là tệp vừa là thư mục
  const dirs = new Set<string>();
  for (const p of plan) for (let d = p.isDir ? p.abs : dirname(p.abs); isInside(outDir, d) && d !== outDir && !dirs.has(d); d = dirname(d)) dirs.add(d);
  for (const p of plan) if (!p.isDir && dirs.has(p.abs)) throw new ToolError(`Tệp zip có mục “${p.rel}” vừa là tệp vừa là thư mục.`);
  // đích có sẵn
  const conflicts: string[] = [];
  const olds = new Map<string, StatInfo>();
  for (const p of plan) {
    if (p.isDir) continue;
    const st = await ctx.env.stat(p.abs);
    if (!st) continue;
    if (st.isDir) throw new ToolError(`${p.rel} là thư mục đã có, không thể ghi tệp trùng tên lên nó.`, "wrong_type");
    olds.set(p.abs, st);
    conflicts.push(p.rel);
  }
  if (conflicts.length && a.overwrite !== true)
    throw new ToolError(`${conflicts.length} tệp đã tồn tại (vd ${conflicts.slice(0, 3).join(", ")}). Chọn output_dir khác, hoặc đặt overwrite=true để ghi đè (hoàn tác được bằng undo). Chưa có tệp nào được ghi.`);

  // 2) giải nén hết vào bộ nhớ (đếm byte thật), 3) rồi mới ghi
  const data = new Map<string, Uint8Array>();
  let total = 0;
  for (const p of plan) {
    if (p.isDir) continue;
    const bytes = await readEntry(p.entry, Math.min(MAX_FILE_BYTES, MAX_TREE_BYTES - total), p.rel);
    total += bytes.length;
    data.set(p.abs, bytes);
  }
  const group = newGroup();
  await prepareParent(ctx, outDir, group);
  for (const p of plan) {
    if (p.isDir) {
      await prepareParent(ctx, p.abs, group);
      continue;
    }
    const old = olds.has(p.abs) ? await ctx.env.readBytes(p.abs) : null;
    await prepareParent(ctx, dirname(p.abs), group);
    await ctx.env.writeBytes(p.abs, data.get(p.abs)!);
    pushUndo(ctx, p.abs, old, group);
    await remember(ctx, p.abs);
  }
  const written = [...data.keys()].map((k) => relPath(ctx, k));
  return `Đã giải nén ${written.length} tệp từ ${src.rel} vào ${outRel}/ (${kb(total)}).` +
    (conflicts.length ? `\nĐã ghi đè ${conflicts.length} tệp có sẵn (hoàn tác được bằng undo).` : "") +
    (guardedN ? `\nBỏ qua ${guardedN} mục nhạy cảm/cấu hình (khoá, .env, .git, AGENTS.md…).` : "") +
    "\n" + written.slice(0, 15).join("\n") + (written.length > 15 ? `\n… (+${written.length - 15} tệp)` : "");
}

// ---------------------------------------------------------------- thông tin tệp

const TYPE_NAMES: Record<string, string> = {
  ".docx": "Word", ".doc": "Word (định dạng cũ)", ".xlsx": "Excel", ".xlsm": "Excel (có macro)", ".xls": "Excel (định dạng cũ)", ".pptx": "PowerPoint", ".ppt": "PowerPoint (định dạng cũ)", ".pdf": "PDF",
  ".txt": "Văn bản", ".md": "Markdown", ".csv": "Bảng CSV", ".tsv": "Bảng TSV", ".json": "JSON", ".xml": "XML", ".html": "HTML", ".htm": "HTML", ".rtf": "RTF",
  ".png": "Ảnh PNG", ".jpg": "Ảnh JPEG", ".jpeg": "Ảnh JPEG", ".gif": "Ảnh GIF", ".webp": "Ảnh WebP", ".svg": "Ảnh SVG", ".bmp": "Ảnh BMP",
  ".zip": "Tệp nén zip", ".rar": "Tệp nén rar", ".7z": "Tệp nén 7z", ".mp3": "Âm thanh", ".wav": "Âm thanh", ".mp4": "Video", ".mov": "Video",
};

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Số trang/slide/sheet nếu rẻ để lấy (đọc vài thành phần trong tệp; PDF chỉ đếm trang). Không lấy được thì để trống. */
async function officeFacts(bytes: Uint8Array, ext: string): Promise<string[]> {
  const out: string[] = [];
  try {
    if (ext === ".pdf") {
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, disableFontFace: true, stopAtErrors: false } as never);
      out.push(`Số trang: ${pdf.numPages}`);
    } else if (ext === ".docx") {
      const zip = await loadZip(bytes);
      const app = (await zip.file("docProps/app.xml")?.async("string")) ?? "";
      const pages = /<Pages>(\d+)<\/Pages>/.exec(app)?.[1];
      if (pages) out.push(`Số trang: ${pages}`);
      let words = /<Words>(\d+)<\/Words>/.exec(app)?.[1];
      if (!words) {
        const doc = (await zip.file("word/document.xml")?.async("string")) ?? "";
        const text = [...doc.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decodeXml(m[1])).join(" ");
        const n = text.split(/\s+/).filter(Boolean).length;
        if (n) words = "≈" + n;
      }
      if (words) out.push(`Số từ: ${words}`);
    } else if (ext === ".xlsx" || ext === ".xlsm") {
      const zip = await loadZip(bytes);
      const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
      const names = [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
      if (names.length) out.push(`Số sheet: ${names.length} (${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""})`);
    } else if (ext === ".pptx") {
      const zip = await loadZip(bytes);
      const n = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
      if (n) out.push(`Số slide: ${n}`);
    }
  } catch {
    out.push("(không đọc được số trang/slide/sheet: tệp có thể hỏng hoặc có mật khẩu)");
  }
  return out;
}

async function fileInfo(ctx: ToolContext, a: any): Promise<string> {
  const abs = await resolveSafe(ctx, a.path);
  const st = await ctx.env.stat(abs);
  if (!st) throw new ToolError(`Không có ${a.path}.${await similarPaths(ctx, abs)}`, "not_found");
  const rel = relPath(ctx, abs);
  const lines: string[] = [rel + (st.isDir ? "/" : "")];
  if (st.isFile) {
    const ext = extOf(abs);
    lines.push(`Loại: ${TYPE_NAMES[ext] ?? (ext ? `Tệp ${ext}` : "Tệp (không có đuôi)")}`);
    lines.push(`Kích thước: ${kb(st.size)} (${st.size.toLocaleString("en-US")} byte)`);
    if (st.mtimeMs > 1e11) lines.push(`Sửa lần cuối: ${fmtDate(st.mtimeMs)}`);
    if ([".docx", ".xlsx", ".xlsm", ".pptx", ".pdf"].includes(ext)) {
      if (st.size <= OFFICE_FACTS_MAX) lines.push(...(await officeFacts(await ctx.env.readBytes(abs), ext)));
      else lines.push("(tệp lớn: bỏ qua đếm trang/slide/sheet)");
    }
    inspectedOf(ctx).set(abs, st.mtimeMs);
    return lines.join("\n");
  }
  // thư mục: thống kê theo đuôi tệp (bỏ node_modules, .git…)
  const byExt = new Map<string, { n: number; bytes: number }>();
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  let newest = 0;
  let truncated = false;
  const ignored = new Set<string>();
  let scanned = 0;
  const visit = async (dir: string): Promise<void> => {
    for (const e of await ctx.env.readdir(dir)) {
      if (truncated) return;
      if (JUNK.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDir) {
        if (IGNORE_DIRS.has(e.name)) {
          ignored.add(e.name);
          continue;
        }
        try {
          await resolveSafe(ctx, p);
        } catch {
          continue;
        }
        dirs++;
        await visit(p);
      } else {
        if (++scanned > 5000) {
          truncated = true;
          return;
        }
        const s = await ctx.env.stat(p);
        if (!s?.isFile) continue;
        files++;
        bytes += s.size;
        newest = Math.max(newest, s.mtimeMs);
        const k = extname(e.name).toLowerCase() || "(không đuôi)";
        const c = byExt.get(k) ?? { n: 0, bytes: 0 };
        c.n++;
        c.bytes += s.size;
        byExt.set(k, c);
      }
    }
  };
  await visit(abs);
  lines.push(`Thư mục: ${files} tệp, ${dirs} thư mục con, ${kb(bytes)}${truncated ? " (đã dừng đếm ở 5000 tệp, số liệu chưa đủ)" : ""}`);
  if (newest > 1e11) lines.push(`Tệp sửa gần nhất: ${fmtDate(newest)}`);
  const rows = [...byExt].sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]));
  if (rows.length) {
    lines.push("Theo đuôi tệp:");
    for (const [k, v] of rows.slice(0, 12)) lines.push(`  ${k}: ${v.n} tệp, ${kb(v.bytes)}`);
    if (rows.length > 12) lines.push(`  … (+${rows.length - 12} loại khác)`);
  }
  if (ignored.size) lines.push(`(không tính: ${[...ignored].sort().join(", ")})`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- xoá / tạo thư mục

async function deleteFile(ctx: ToolContext, a: any): Promise<string> {
  const src = await sourceOf(ctx, a.path, "xoá");
  if (src.st.isDir) {
    const items = (await ctx.env.readdir(src.abs)).filter((e) => !JUNK.has(e.name));
    if (items.length)
      throw new ToolError(`${src.rel} là thư mục không rỗng (${items.length} mục). Công cụ này chỉ xoá tệp hoặc thư mục rỗng: hãy dùng list_dir xem bên trong, rồi xoá từng tệp (hỏi người dùng nếu nhiều).`, "wrong_type");
    await ctx.env.remove(src.abs);
    return `Đã xoá thư mục rỗng ${src.rel}. (Thư mục rỗng không có trong lịch sử hoàn tác; muốn lấy lại, tạo lại bằng make_dir.)`;
  }
  if (src.st.size > MAX_FILE_BYTES) throw new ToolError(`${src.rel} quá lớn (${kb(src.st.size)}) để xoá kèm khả năng hoàn tác (giới hạn ${kb(MAX_FILE_BYTES)}). Hãy để người dùng tự xoá.`);
  const bytes = await ctx.env.readBytes(src.abs);
  pushUndo(ctx, src.abs, bytes);
  await ctx.env.remove(src.abs);
  ctx.readFiles.delete(src.abs);
  inspectedOf(ctx).delete(src.abs);
  return `Đã xoá ${src.rel} (${kb(bytes.length)}). Hoàn tác được bằng undo.`;
}

async function makeDir(ctx: ToolContext, a: any): Promise<string> {
  const abs = await resolveSafe(ctx, a.path);
  const rel = relPath(ctx, abs);
  const st = await ctx.env.stat(abs);
  if (st?.isDir) return `Thư mục ${rel} đã có sẵn.`;
  if (st) throw new ToolError(`${rel} đã là một tệp.`, "wrong_type");
  if (isRootDir(ctx, abs)) throw new ToolError("Đó là thư mục gốc của dự án.", "bad_args");
  await prepareParent(ctx, abs);
  return `Đã tạo thư mục ${rel}.`;
}

// ---------------------------------------------------------------- công cụ

export function filesTools(_env: Env): Tool[] {
  return [
    {
      name: "copy_file", kind: "edit", readonly: false, pathArg: "from", targetPath: (a) => a.to,
      description: "Copy a file (any type, including binary such as images, PDF, zip) or a whole folder to a new path inside the project folder. If `to` is an existing folder (or ends with /) the copy is placed inside it under the same name. Never replaces an existing file unless overwrite=true AND you have already looked at that file (file_info / read_document). Secret files (.env, keys) and project config (.git, AGENTS.md) are refused. Undoable.",
      parameters: { type: "object", properties: { from: S, to: S, overwrite: OVERWRITE }, required: ["from", "to"] },
      summarize: (a) => `${a.from ?? ""} → ${a.to ?? ""}`,
      preview: (ctx, a) => outline(ctx, a.to, `Sao chép ${a.from} → ${a.to}${a.overwrite ? " (ghi đè nếu đã có)" : ""}`),
      run: (ctx, a) => transfer(ctx, a, "copy"),
    },
    {
      name: "move_file", kind: "edit", readonly: false, pathArg: "from", targetPath: (a) => a.to,
      description: "Move or rename a file or folder inside the project folder (the original disappears). Same rules as copy_file: `to` may be an existing folder; existing files are replaced only with overwrite=true after you have looked at them; folders are never merged or replaced; folders containing secret/config files are refused. One undo restores the whole move. To change only the letter case of a name, go through a temporary name.",
      parameters: { type: "object", properties: { from: S, to: S, overwrite: OVERWRITE }, required: ["from", "to"] },
      summarize: (a) => `${a.from ?? ""} → ${a.to ?? ""}`,
      preview: (ctx, a) => outline(ctx, a.to, `Di chuyển/đổi tên ${a.from} → ${a.to}${a.overwrite ? " (ghi đè nếu đã có)" : ""}`),
      run: (ctx, a) => transfer(ctx, a, "move"),
    },
    {
      name: "delete_file", kind: "edit", readonly: false, pathArg: "path",
      description: "Delete one file, or an EMPTY folder. Folders that still contain something are refused: look inside with list_dir and delete files one by one (ask the user first if there are many). A deleted file can be restored with undo. Secret files and project config are refused.",
      parameters: { type: "object", properties: { path: S }, required: ["path"] },
      summarize: (a) => String(a.path ?? ""),
      preview: (ctx, a) => outline(ctx, a.path, `Xoá ${a.path} (hoàn tác được bằng undo)`),
      run: deleteFile,
    },
    {
      name: "make_dir", kind: "edit", readonly: false, pathArg: "path",
      description: "Create a folder inside the project folder (missing parent folders are created too). Does nothing if it already exists. (write_file and the create_* tools already create the folders they need.)",
      parameters: { type: "object", properties: { path: S }, required: ["path"] },
      summarize: (a) => String(a.path ?? ""),
      preview: (ctx, a) => outline(ctx, a.path, `Tạo thư mục ${a.path}`),
      run: makeDir,
    },
    {
      name: "zip_files", kind: "edit", readonly: false, pathArg: "output",
      description: "Compress files and/or folders into one .zip archive. paths = list of files/folders (each is stored under its own name; folders recursively). output must end in .zip. Secret files and project config inside folders are left out, naming one directly is an error. Never replaces an existing archive unless overwrite=true and you have looked at it. Limits: 2000 entries, 100 MB.",
      parameters: { type: "object", properties: { paths: { type: "array", items: S, description: "files and/or folders to compress" }, output: { type: "string", description: "archive path ending in .zip" }, overwrite: OVERWRITE }, required: ["paths", "output"] },
      summarize: (a) => {
        let n = 0;
        try { n = (jsonArg<unknown[]>(a.paths, "paths") ?? []).length; } catch { /* bỏ qua */ }
        return `${n} mục → ${a.output ?? ""}`;
      },
      preview: (ctx, a) => outline(ctx, a.output, `Nén ${(() => { try { return (jsonArg<unknown[]>(a.paths, "paths") ?? []).join(", "); } catch { return "?"; } })()} → ${a.output}`),
      run: zipFiles,
    },
    {
      name: "unzip_file", kind: "edit", readonly: false, pathArg: "path", targetPath: defaultUnzipDir,
      description: "Extract a .zip archive into a folder (default: a folder with the archive's name next to it; output_dir to choose). Refuses archives whose entries would escape the folder, or that are too large (more than 2000 entries or 100 MB unpacked). Existing files are never replaced unless overwrite=true; secret/config entries are skipped. Undoable in one step. For reading a Word/Excel/PowerPoint file use read_document instead.",
      parameters: { type: "object", properties: { path: S, output_dir: { type: "string", description: "destination folder (default: archive name without .zip)" }, overwrite: OVERWRITE }, required: ["path"] },
      summarize: (a) => `${a.path ?? ""} → ${defaultUnzipDir(a)}`,
      preview: (ctx, a) => outline(ctx, defaultUnzipDir(a), `Giải nén ${a.path} → ${defaultUnzipDir(a)}${a.overwrite ? " (ghi đè tệp có sẵn)" : ""}`),
      run: unzipFile,
    },
    {
      name: "file_info", kind: "read", readonly: true, pathArg: "path",
      description: "Show size, last-modified date and type of a file; for Word/Excel/PowerPoint/PDF also page/slide/sheet count (when cheap). For a folder: number of files and total size broken down by extension. Use it to look at a file before copying over it, moving or deleting it.",
      parameters: { type: "object", properties: { path: S }, required: ["path"] },
      summarize: (a) => String(a.path ?? ""),
      run: fileInfo,
    },
  ];
}
