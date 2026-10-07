/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bổ sung các hàm Excel thông dụng mà fast-formula-parser khai báo nhưng chưa cài đặt
 * (MAX, MIN, COUNTA, SUMIFS, COUNTIFS, MATCH, MEDIAN, RANK, UPPER, YEAR…).
 */

const val = (a: any): unknown => (a && typeof a === "object" && "value" in a ? a.value : a);
const isRange = (a: any): boolean => !!a && typeof a === "object" && Array.isArray(a.value);
const flat = (a: any): unknown[] => {
  const v = val(a);
  return Array.isArray(v) ? (v as unknown[][]).flat() : [v];
};
const grid = (a: any): unknown[][] => {
  const v = val(a);
  return Array.isArray(v) ? (v as unknown[][]) : [[v]];
};
const EPOCH = Date.UTC(1899, 11, 30);
const serialToDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "number" && isFinite(v)) return new Date(EPOCH + Math.floor(v) * 86400000);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v.slice(0, 10) + "T00:00:00Z");
  return null;
};

export function customFunctions(FP: any): Record<string, (...args: any[]) => unknown> {
  const E = FP.FormulaError;
  const isErr = (x: unknown) => x instanceof E;
  const firstErr = (xs: unknown[]) => xs.find(isErr);
  /** Chỉ lấy số trong các tham số (bỏ chữ/ô trống như Excel với tham chiếu vùng; số gõ trực tiếp được ép kiểu). */
  const nums = (args: any[]): number[] | InstanceType<typeof E> => {
    const out: number[] = [];
    for (const a of args) {
      const direct = !isRange(a);
      for (const v of flat(a)) {
        if (isErr(v)) return v as InstanceType<typeof E>;
        if (typeof v === "number") out.push(v);
        else if (direct && typeof v === "boolean") out.push(v ? 1 : 0);
        else if (direct && typeof v === "string" && v.trim() !== "" && !isNaN(+v)) out.push(+v);
      }
    }
    return out;
  };
  const crit = (c: unknown): ((v: unknown) => boolean) => {
    if (typeof c === "number") return (v) => v === c;
    if (typeof c === "boolean") return (v) => v === c;
    const s = String(c ?? "");
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s)!;
    const op = m[1] ?? "=";
    const rhs = m[2];
    const n = rhs.trim() !== "" && !isNaN(+rhs) ? +rhs : null;
    const wc = /[*?]/.test(rhs) ? new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i") : null;
    return (v) => {
      if (op === "=" || op === "<>") {
        let eq: boolean;
        if (n !== null && typeof v === "number") eq = v === n;
        else if (wc && typeof v === "string") eq = wc.test(v);
        else if (rhs === "") eq = v === null || v === undefined || v === "";
        else eq = String(v ?? "").toLowerCase() === rhs.toLowerCase();
        return op === "=" ? eq : !eq;
      }
      if (n !== null && typeof v === "number") return op === "<" ? v < n : op === "<=" ? v <= n : op === ">" ? v > n : v >= n;
      if (typeof v === "string" && n === null) {
        const a = v.toLowerCase();
        const b = rhs.toLowerCase();
        return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
      }
      return false;
    };
  };
  /** Các cặp (vùng, tiêu chí) → mặt nạ các ô thoả TẤT CẢ tiêu chí, theo thứ tự phẳng. */
  const mask = (pairs: any[]): boolean[] | InstanceType<typeof E> => {
    let m: boolean[] | null = null;
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const cells = flat(pairs[i]);
      const f = crit(val(pairs[i + 1]));
      if (m && m.length !== cells.length) return E.VALUE;
      const cur = cells.map((c) => f(c));
      m = m ? m.map((x, k) => x && cur[k]) : cur;
    }
    return m ?? E.VALUE;
  };
  const sortedNums = (a: any) => {
    const r = nums([a]);
    return isErr(r) ? r : (r as number[]).slice().sort((x, y) => x - y);
  };

  return {
    MAX: (...a) => { const n = nums(a); return isErr(n) ? n : (n as number[]).length ? Math.max(...(n as number[])) : 0; },
    MIN: (...a) => { const n = nums(a); return isErr(n) ? n : (n as number[]).length ? Math.min(...(n as number[])) : 0; },
    COUNTA: (...a) => a.flatMap(flat).filter((v) => v !== null && v !== undefined && v !== "").length,
    COUNTBLANK: (...a) => a.flatMap(flat).filter((v) => v === null || v === undefined || v === "").length,
    MEDIAN: (...a) => {
      const n = nums(a);
      if (isErr(n)) return n;
      const s = (n as number[]).slice().sort((x, y) => x - y);
      if (!s.length) return E.NUM;
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    },
    MODE: (...a) => {
      const n = nums(a);
      if (isErr(n)) return n;
      const cnt = new Map<number, number>();
      for (const x of n as number[]) cnt.set(x, (cnt.get(x) ?? 0) + 1);
      let best: number | null = null;
      let bc = 1;
      for (const [x, c] of cnt) if (c > bc) { best = x; bc = c; }
      return best ?? E.NA;
    },
    LARGE: (r, k) => { const s = sortedNums(r); const i = Number(val(k)); return isErr(s) ? s : i >= 1 && i <= (s as number[]).length ? (s as number[])[(s as number[]).length - i] : E.NUM; },
    SMALL: (r, k) => { const s = sortedNums(r); const i = Number(val(k)); return isErr(s) ? s : i >= 1 && i <= (s as number[]).length ? (s as number[])[i - 1] : E.NUM; },
    RANK: (x, r, order) => {
      const s = sortedNums(r);
      const v = Number(val(x));
      if (isErr(s)) return s;
      if (!(s as number[]).includes(v)) return E.NA;
      const asc = Number(val(order) ?? 0) !== 0;
      return (s as number[]).filter((y) => (asc ? y < v : y > v)).length + 1;
    },
    STDEV: (...a) => { const n = nums(a); if (isErr(n)) return n; const x = n as number[]; if (x.length < 2) return E.DIV0; const m = x.reduce((p, c) => p + c, 0) / x.length; return Math.sqrt(x.reduce((p, c) => p + (c - m) ** 2, 0) / (x.length - 1)); },
    VAR: (...a) => { const n = nums(a); if (isErr(n)) return n; const x = n as number[]; if (x.length < 2) return E.DIV0; const m = x.reduce((p, c) => p + c, 0) / x.length; return x.reduce((p, c) => p + (c - m) ** 2, 0) / (x.length - 1); },
    COUNTIFS: (...pairs) => { const m = mask(pairs); return isErr(m) ? m : (m as boolean[]).filter(Boolean).length; },
    SUMIFS: (sum, ...pairs) => {
      const m = mask(pairs);
      if (isErr(m)) return m;
      const cells = flat(sum);
      if (cells.length !== (m as boolean[]).length) return E.VALUE;
      return cells.reduce<number>((p, c, i) => p + ((m as boolean[])[i] && typeof c === "number" ? c : 0), 0);
    },
    AVERAGEIFS: (avg, ...pairs) => {
      const m = mask(pairs);
      if (isErr(m)) return m;
      const xs = flat(avg).filter((c, i) => (m as boolean[])[i] && typeof c === "number") as number[];
      return xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : E.DIV0;
    },
    MAXIFS: (v, ...pairs) => { const m = mask(pairs); if (isErr(m)) return m; const xs = flat(v).filter((c, i) => (m as boolean[])[i] && typeof c === "number") as number[]; return xs.length ? Math.max(...xs) : 0; },
    MINIFS: (v, ...pairs) => { const m = mask(pairs); if (isErr(m)) return m; const xs = flat(v).filter((c, i) => (m as boolean[])[i] && typeof c === "number") as number[]; return xs.length ? Math.min(...xs) : 0; },
    MATCH: (look, arr, type) => {
      const cells = flat(arr);
      const t = Number(val(type) ?? 1);
      const x = val(look);
      if (t === 0) {
        const f = typeof x === "string" ? crit(x) : (c: unknown) => c === x;
        const i = cells.findIndex((c) => f(c));
        return i < 0 ? E.NA : i + 1;
      }
      let pos = -1;
      cells.forEach((c, i) => {
        if (typeof c !== typeof x || c === null) return;
        if (t > 0 ? (c as number) <= (x as number) : (c as number) >= (x as number)) pos = i;
      });
      return pos < 0 ? E.NA : pos + 1;
    },
    CHOOSE: (_ctx, i, ...opts) => { const k = Number(val(i)); return k >= 1 && k <= opts.length ? val(opts[k - 1]) : E.VALUE; },
    UPPER: (t) => String(val(t) ?? "").toUpperCase(),
    LOWER: (t) => String(val(t) ?? "").toLowerCase(),
    TEXTJOIN: (sep, skip, ...rest) => {
      const items = rest.flatMap(flat);
      return items.filter((v) => !(val(skip) && (v === null || v === undefined || v === ""))).map((v) => (v === null || v === undefined ? "" : String(v))).join(String(val(sep) ?? ""));
    },
    VALUE: (t) => { const v = val(t); if (typeof v === "number") return v; const n = Number(String(v ?? "").replace(/,/g, "").trim()); return isNaN(n) ? E.VALUE : n; },
    SUBSTITUTE: (t, from, to, nth) => {
      const s = String(val(t) ?? "");
      const f = String(val(from) ?? "");
      const r = String(val(to) ?? "");
      if (!f) return s;
      const n = val(nth);
      if (n === undefined || n === null) return s.split(f).join(r);
      let c = 0;
      return s.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (m) => (++c === Number(n) ? r : m));
    },
    YEAR: (x) => { const d = serialToDate(val(x)); return d ? d.getUTCFullYear() : E.VALUE; },
    MONTH: (x) => { const d = serialToDate(val(x)); return d ? d.getUTCMonth() + 1 : E.VALUE; },
    DAY: (x) => { const d = serialToDate(val(x)); return d ? d.getUTCDate() : E.VALUE; },
    WEEKDAY: (x, type) => { const d = serialToDate(val(x)); if (!d) return E.VALUE; const w = d.getUTCDay(); const t = Number(val(type) ?? 1); return t === 2 ? ((w + 6) % 7) + 1 : t === 3 ? (w + 6) % 7 : w + 1; },
    ISODD: (x) => Math.abs(Math.trunc(Number(val(x)))) % 2 === 1,
  };
}

export const CUSTOM_FUNCTION_NAMES = ["MAX", "MIN", "COUNTA", "COUNTBLANK", "MEDIAN", "MODE", "LARGE", "SMALL", "RANK", "STDEV", "VAR", "COUNTIFS", "SUMIFS", "AVERAGEIFS", "MAXIFS", "MINIFS", "MATCH", "CHOOSE", "UPPER", "LOWER", "TEXTJOIN", "VALUE", "SUBSTITUTE", "YEAR", "MONTH", "DAY", "WEEKDAY", "ISODD"];
