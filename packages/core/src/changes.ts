import { diffLines, diffStats, type DiffLine } from "./diff";
import { dirname, isInside } from "./path";
import { isSensitivePath } from "./sensitive";
import { relPath, resolveSafe, walk, type ToolContext, type UndoEntry } from "./tools";

// "Thay đổi" = so sánh nội dung hiện tại với nội dung gốc (trước lần sửa đầu tiên của agent trong cuộc trò chuyện).
// Nguồn dữ liệu là nhật ký ctx.undoStack (đã dùng cho /undo): mỗi lần ghi file của agent đẩy vào đó nội dung cũ.

export interface ChangeFile {
  /** Đường dẫn tương đối so với thư mục dự án. */
  path: string;
  status: "new" | "modified" | "deleted";
  added: number;
  removed: number;
  /** Lượt hỏi đầu tiên đụng tới tệp này. */
  turn: number;
  binary?: boolean;
  /** Tệp có thể chứa bí mật: không hiện nội dung và không hoàn tác từ bảng này. */
  sensitive?: boolean;
  large?: boolean;
}

export interface ChangeDiff {
  path: string;
  status: ChangeFile["status"];
  diff: DiffLine[];
  binary?: boolean;
  sensitive?: boolean;
  large?: boolean;
}

export interface RevertResult {
  reverted: string[];
  skipped: string[];
}

const MAX_DIFF_BYTES = 400_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (v: string | Uint8Array): Uint8Array => (typeof v === "string" ? enc.encode(v) : v);
const isBin = (b: Uint8Array): boolean => b.subarray(0, 8000).includes(0);
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function currentBytes(ctx: ToolContext, abs: string): Promise<Uint8Array | null> {
  const st = await ctx.env.stat(abs);
  if (!st?.isFile) return null;
  try {
    return await ctx.env.readBytes(abs);
  } catch {
    return null;
  }
}

/** Mục nhật ký ĐẦU TIÊN của mỗi tệp (nội dung gốc), theo thứ tự đụng tới; chỉ trong thư mục dự án. `fromTurn`: chỉ tính các thay đổi từ lượt đó trở đi. */
function firstEntries(ctx: ToolContext, fromTurn = 0): Map<string, UndoEntry> {
  const m = new Map<string, UndoEntry>();
  for (const e of ctx.undoStack) if ((e.turn ?? 0) >= fromTurn && !m.has(e.path) && isInside(ctx.root, e.path)) m.set(e.path, e);
  return m;
}

async function classify(ctx: ToolContext, abs: string, e: UndoEntry): Promise<{ status: ChangeFile["status"]; cur: Uint8Array | null } | null> {
  const cur = await currentBytes(ctx, abs);
  if (e.old === null) return cur === null ? null : { status: "new", cur };
  if (cur === null) return { status: "deleted", cur };
  return same(toBytes(e.old), cur) ? null : { status: "modified", cur };
}

export async function listChanges(ctx: ToolContext, fromTurn = 0): Promise<ChangeFile[]> {
  const out: ChangeFile[] = [];
  for (const [abs, e] of firstEntries(ctx, fromTurn)) {
    const c = await classify(ctx, abs, e);
    if (!c) continue;
    const rel = relPath(ctx, abs);
    const f: ChangeFile = { path: rel, status: c.status, added: 0, removed: 0, turn: e.turn ?? 0 };
    if (isSensitivePath(rel)) f.sensitive = true;
    else {
      const old = e.old === null ? null : toBytes(e.old);
      if ((old && isBin(old)) || (c.cur && isBin(c.cur))) f.binary = true;
      else if ((old?.length ?? 0) > MAX_DIFF_BYTES || (c.cur?.length ?? 0) > MAX_DIFF_BYTES) f.large = true;
      else {
        const st = diffStats(diffLines(old ? dec.decode(old) : "", c.cur ? dec.decode(c.cur) : ""));
        f.added = st.added;
        f.removed = st.removed;
      }
    }
    out.push(f);
  }
  return out;
}

/** Diff của một tệp (so với nội dung gốc). `rel` chỉ dùng để TRA trong nhật ký, không bao giờ dùng làm đường dẫn thật. */
export async function changeDiff(ctx: ToolContext, rel: string): Promise<ChangeDiff | null> {
  for (const [abs, e] of firstEntries(ctx)) {
    if (relPath(ctx, abs) !== rel) continue;
    const c = await classify(ctx, abs, e);
    if (!c) return null;
    const r: ChangeDiff = { path: rel, status: c.status, diff: [] };
    if (isSensitivePath(rel)) return { ...r, sensitive: true };
    const old = e.old === null ? null : toBytes(e.old);
    if ((old && isBin(old)) || (c.cur && isBin(c.cur))) return { ...r, binary: true };
    if ((old?.length ?? 0) > MAX_DIFF_BYTES || (c.cur?.length ?? 0) > MAX_DIFF_BYTES) return { ...r, large: true };
    return { ...r, diff: diffLines(old ? dec.decode(old) : "", c.cur ? dec.decode(c.cur) : "") };
  }
  return null;
}

/**
 * Đưa tệp về nội dung gốc: tệp mới bị xoá, tệp sửa được khôi phục, tệp bị xoá được tạo lại.
 * `rel`: chỉ một tệp; `fromTurn`: mọi tệp bị đụng từ lượt đó trở đi (dùng cho /rewind); không có gì: tất cả.
 * Mọi đường dẫn đều được kiểm tra lại bằng resolveSafe (phải nằm trong dự án, theo cả liên kết tượng trưng); tệp nhạy cảm không bị đụng tới.
 */
export async function revertChanges(ctx: ToolContext, opts: { rel?: string; fromTurn?: number } = {}): Promise<RevertResult> {
  const res: RevertResult = { reverted: [], skipped: [] };
  const done = new Set<string>();
  for (const [abs, e] of firstEntries(ctx, opts.fromTurn ?? 0)) {
    const rel = relPath(ctx, abs);
    if (opts.rel !== undefined && rel !== opts.rel) continue;
    if (isSensitivePath(rel)) {
      res.skipped.push(rel);
      continue;
    }
    let real: string;
    try {
      real = await resolveSafe(ctx, abs);
    } catch {
      res.skipped.push(rel);
      continue;
    }
    try {
      const st = await ctx.env.stat(real);
      if (e.old === null) {
        if (st?.isDir) {
          res.skipped.push(rel);
          continue;
        }
        if (st) await ctx.env.remove(real);
        ctx.readFiles.delete(abs);
        ctx.readFiles.delete(real);
      } else {
        if (st?.isDir) {
          res.skipped.push(rel);
          continue;
        }
        await ctx.env.mkdirp(dirname(real));
        if (typeof e.old === "string") await ctx.env.writeText(real, e.old);
        else await ctx.env.writeBytes(real, e.old);
        const s2 = await ctx.env.stat(real);
        if (s2) ctx.readFiles.set(real, s2.mtimeMs);
      }
      done.add(abs);
      res.reverted.push(rel);
    } catch {
      res.skipped.push(rel);
    }
  }
  // bỏ khỏi nhật ký những mục đã hoàn tác (đúng phạm vi đã chọn)
  const from = opts.fromTurn ?? 0;
  for (let i = ctx.undoStack.length - 1; i >= 0; i--) if (done.has(ctx.undoStack[i].path) && (ctx.undoStack[i].turn ?? 0) >= from) ctx.undoStack.splice(i, 1);
  return res;
}

// ---------------------------------------------------------------- thay đổi do lệnh bash gây ra

const SNAP_MAX_FILES = 1500;
const SNAP_MAX_FILE = 200_000;
const SNAP_MAX_TOTAL = 24_000_000;

interface SnapFile {
  size: number;
  mtimeMs: number;
  data?: Uint8Array;
}
interface Snap {
  files: Map<string, SnapFile>;
  truncated: boolean;
}

/** Chụp nhanh các tệp nhỏ của dự án (bỏ node_modules, .git…, tệp nhạy cảm, tệp trỏ ra ngoài dự án). */
async function snapshotTree(ctx: ToolContext, withData: boolean): Promise<Snap> {
  const files = new Map<string, SnapFile>();
  let total = 0;
  let truncated = false;
  for await (const f of walk(ctx, ctx.root)) {
    if (files.size >= SNAP_MAX_FILES) {
      truncated = true;
      break;
    }
    try {
      const st = await ctx.env.stat(f);
      if (!st?.isFile) continue;
      if (!isInside(ctx.root, await ctx.env.realpath(f))) continue; // liên kết tượng trưng trỏ ra ngoài
      const rec: SnapFile = { size: st.size, mtimeMs: st.mtimeMs };
      if (withData && st.size <= SNAP_MAX_FILE && total + st.size <= SNAP_MAX_TOTAL) {
        rec.data = await ctx.env.readBytes(f);
        total += st.size;
      }
      files.set(f, rec);
    } catch {
      /* tệp biến mất giữa chừng: bỏ qua */
    }
  }
  return { files, truncated };
}

let groupSeq = 0;

/**
 * Chạy `fn` (một lệnh có thể ghi file) và ghi vào nhật ký những tệp nó đã tạo/sửa/xoá, để hiện trong "Thay đổi" và hoàn tác được.
 * Giới hạn: chỉ tệp nhỏ (≤200KB), tối đa 1500 tệp; tệp ngoài giới hạn không được theo dõi (không bao giờ xoá nhầm tệp đã có từ trước).
 */
export async function trackExec<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T> {
  let before: Snap | null = null;
  try {
    before = await snapshotTree(ctx, true);
  } catch {
    before = null;
  }
  try {
    return await fn();
  } finally {
    if (before) await recordDiff(ctx, before).catch(() => undefined);
  }
}

async function recordDiff(ctx: ToolContext, before: Snap): Promise<void> {
  const after = await snapshotTree(ctx, false);
  const group = `g${Date.now().toString(36)}${groupSeq++}`;
  const seen = new Set<string>();
  for (const [f, a] of after.files) {
    seen.add(f);
    const b = before.files.get(f);
    if (!b) {
      if (!before.truncated) pushEntry(ctx, f, null, group); // tệp mới (nếu bản chụp trước bị cắt thì không chắc là mới → bỏ qua)
      continue;
    }
    if (b.mtimeMs === a.mtimeMs && b.size === a.size) continue;
    if (!b.data) continue; // quá lớn để lưu bản gốc
    const cur = await currentBytes(ctx, f);
    if (cur && !same(cur, b.data)) pushEntry(ctx, f, b.data, group);
  }
  if (!after.truncated)
    for (const [f, b] of before.files) {
      if (seen.has(f) || !b.data) continue;
      if (!(await ctx.env.stat(f))) pushEntry(ctx, f, b.data, group); // bị xoá
    }
}

function pushEntry(ctx: ToolContext, abs: string, old: Uint8Array | null, group: string): void {
  ctx.undoStack.push({ path: abs, old, turn: ctx.turn ?? 0, group, at: Date.now() });
}
