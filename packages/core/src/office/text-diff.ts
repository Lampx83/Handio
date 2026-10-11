/** So sánh hai văn bản theo dòng/đoạn rồi theo từ (cho text_diff). Thuần tính toán. */

export interface Line {
  /** Nội dung gốc. */
  text: string;
  /** Vị trí để báo cáo: "dòng 12", "đoạn 5", "slide 3", "trang 2", "Sheet1!A5". */
  loc: string;
}

export type Change =
  | { kind: "add"; b: Line }
  | { kind: "del"; a: Line }
  | { kind: "mod"; a: Line; b: Line; sim: number };

export interface DiffResult {
  changes: Change[];
  equal: number;
  added: number;
  removed: number;
  modified: number;
  wordsAdded: number;
  wordsRemoved: number;
  similarity: number;
}

/** Số ô tối đa của bảng LCS theo dòng (Uint16 → ~32 MB). */
const MAX_CELLS = 16_000_000;

export class TooLargeError extends Error {}

const keyOf = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();
export const words = (s: string): string[] => s.normalize("NFC").split(/\s+/).filter(Boolean);

type Op = { k: "eq" | "del" | "add"; i: number; j: number };

/** LCS cổ điển trên hai dãy khoá (đã cắt phần đầu/cuối giống nhau). */
function lcsOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if (n * m > MAX_CELLS) throw new TooLargeError("too large");
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: "eq", i, j: i });
  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i++) ops.push({ k: "del", i: pre + i, j: -1 });
    for (let j = 0; j < m; j++) ops.push({ k: "add", i: -1, j: pre + j });
  } else {
    const W = m + 1;
    const L = new Uint16Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[pre + i] === b[pre + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[pre + i] === b[pre + j]) {
        ops.push({ k: "eq", i: pre + i, j: pre + j });
        i++;
        j++;
      } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) ops.push({ k: "del", i: pre + i++, j: -1 });
      else ops.push({ k: "add", i: -1, j: pre + j++ });
    }
    while (i < n) ops.push({ k: "del", i: pre + i++, j: -1 });
    while (j < m) ops.push({ k: "add", i: -1, j: pre + j++ });
  }
  for (let s = 0; s < suf; s++) ops.push({ k: "eq", i: a.length - suf + s, j: b.length - suf + s });
  return ops;
}

/** Độ giống nhau của hai đoạn theo tập từ (0..1). */
export function similarity(a: string, b: string): number {
  const wa = words(a.toLowerCase());
  const wb = words(b.toLowerCase());
  if (!wa.length && !wb.length) return 1;
  const bag = new Map<string, number>();
  for (const w of wb) bag.set(w, (bag.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wa) {
    const c = bag.get(w);
    if (c) {
      common++;
      bag.set(w, c - 1);
    }
  }
  return common / Math.max(wa.length, wb.length);
}

export function diffLinesDoc(a: Line[], b: Line[]): DiffResult {
  const ops = lcsOps(a.map((l) => keyOf(l.text)), b.map((l) => keyOf(l.text)));
  const changes: Change[] = [];
  let equal = 0;
  let wordsAdded = 0;
  let wordsRemoved = 0;
  let modified = 0;
  let added = 0;
  let removed = 0;
  let dels: Line[] = [];
  let adds: Line[] = [];
  const flush = () => {
    if (!dels.length && !adds.length) return;
    // ghép các dòng bị xoá với dòng được thêm có nội dung gần giống (theo thứ tự); phần còn lại là xoá/thêm thuần
    let pos = 0;
    for (const d of dels) {
      let found = -1;
      let best = 0;
      for (let k = pos; k < adds.length && k < pos + 8; k++) {
        const s = similarity(d.text, adds[k].text);
        if (s > best) {
          best = s;
          found = k;
        }
      }
      const thr = dels.length === adds.length ? 0.25 : 0.45;
      if (found >= 0 && best >= thr) {
        for (; pos < found; pos++) {
          changes.push({ kind: "add", b: adds[pos] });
          added++;
          wordsAdded += words(adds[pos].text).length;
        }
        changes.push({ kind: "mod", a: d, b: adds[found], sim: best });
        modified++;
        const wd = wordDiff(d.text, adds[found].text);
        wordsAdded += wd.added;
        wordsRemoved += wd.removed;
        pos = found + 1;
      } else {
        changes.push({ kind: "del", a: d });
        removed++;
        wordsRemoved += words(d.text).length;
      }
    }
    for (; pos < adds.length; pos++) {
      changes.push({ kind: "add", b: adds[pos] });
      added++;
      wordsAdded += words(adds[pos].text).length;
    }
    dels = [];
    adds = [];
  };
  for (const o of ops) {
    if (o.k === "eq") {
      flush();
      equal++;
    } else if (o.k === "del") dels.push(a[o.i]);
    else adds.push(b[o.j]);
  }
  flush();
  const total = Math.max(a.length, b.length);
  return { changes, equal, added, removed, modified, wordsAdded, wordsRemoved, similarity: total ? equal / total : 1 };
}

export interface WordDiff {
  /** Chuỗi có đánh dấu: [-từ bị xoá-] {+từ được thêm+}. */
  marked: string;
  added: number;
  removed: number;
}

/** So sánh theo từ giữa hai đoạn; phần giống nhau dài được rút gọn bằng "…". */
export function wordDiff(a: string, b: string, context = 6): WordDiff {
  const wa = words(a);
  const wb = words(b);
  if (wa.length * wb.length > 4_000_000) return { marked: `[-${a}-] {+${b}+}`, added: wb.length, removed: wa.length };
  const ops = lcsOps(wa, wb);
  const parts: { k: "eq" | "del" | "add"; t: string }[] = [];
  for (const o of ops) parts.push({ k: o.k, t: o.k === "add" ? wb[o.j] : wa[o.i] });
  // gộp các từ liền nhau cùng loại
  const runs: { k: "eq" | "del" | "add"; ws: string[] }[] = [];
  for (const p of parts) {
    const last = runs[runs.length - 1];
    if (last && last.k === p.k) last.ws.push(p.t);
    else runs.push({ k: p.k, ws: [p.t] });
  }
  const out: string[] = [];
  runs.forEach((r, idx) => {
    if (r.k === "del") out.push(`[-${r.ws.join(" ")}-]`);
    else if (r.k === "add") out.push(`{+${r.ws.join(" ")}+}`);
    else if (r.ws.length > context * 2 + 2) {
      const head = idx === 0 ? "" : r.ws.slice(0, context).join(" ");
      const tail = idx === runs.length - 1 ? "" : r.ws.slice(-context).join(" ");
      out.push([head, head || tail ? "…" : "", tail].filter(Boolean).join(" "));
    } else out.push(r.ws.join(" "));
  });
  return { marked: out.join(" "), added: runs.filter((r) => r.k === "add").reduce((n, r) => n + r.ws.length, 0), removed: runs.filter((r) => r.k === "del").reduce((n, r) => n + r.ws.length, 0) };
}
