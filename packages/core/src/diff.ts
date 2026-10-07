export interface DiffLine {
  kind: "ctx" | "add" | "del" | "gap";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Diff theo dòng (LCS), gộp thành các đoạn có 3 dòng ngữ cảnh. Dùng để xem trước thay đổi. */
export function diffLines(oldText: string, newText: string, context = 3): DiffLine[] {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  type Op = { k: "ctx" | "add" | "del"; t: string };
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: "ctx", t: a[i] });
  if (am.length * bm.length > 4_000_000) {
    am.forEach((t) => ops.push({ k: "del", t }));
    bm.forEach((t) => ops.push({ k: "add", t }));
  } else {
    const n = am.length;
    const m = bm.length;
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        ops.push({ k: "ctx", t: am[i] });
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ k: "del", t: am[i++] });
      else ops.push({ k: "add", t: bm[j++] });
    }
    while (i < n) ops.push({ k: "del", t: am[i++] });
    while (j < m) ops.push({ k: "add", t: bm[j++] });
  }
  for (let i = a.length - suf; i < a.length; i++) ops.push({ k: "ctx", t: a[i] });

  // đánh số dòng rồi chỉ giữ các dòng gần thay đổi
  let oldNo = 1;
  let newNo = 1;
  const numbered: DiffLine[] = ops.map((o) => {
    if (o.k === "ctx") return { kind: "ctx", text: o.t, oldNo: oldNo++, newNo: newNo++ };
    if (o.k === "del") return { kind: "del", text: o.t, oldNo: oldNo++ };
    return { kind: "add", text: o.t, newNo: newNo++ };
  });
  const keep = new Array<boolean>(numbered.length).fill(false);
  numbered.forEach((l, idx) => {
    if (l.kind !== "ctx") for (let d = -context; d <= context; d++) if (idx + d >= 0 && idx + d < keep.length) keep[idx + d] = true;
  });
  const out: DiffLine[] = [];
  let skipped = false;
  numbered.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped && out.length) out.push({ kind: "gap", text: "…" });
      skipped = false;
      out.push(l);
    } else skipped = true;
  });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "del").length };
}
