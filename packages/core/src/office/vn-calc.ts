/**
 * Máy tính an toàn cho tab Work: tự viết bộ phân tích biểu thức (KHÔNG eval/Function), nhận số kiểu Việt và quốc tế,
 * phần trăm kiểu văn phòng ("15% của 2.500.000", "2.500.000 + 10%").
 */
import { formatVn, parseLocaleNumber, roundTo, type NumberLocale } from "./vn-number";

export class CalcError extends Error {}

type Tok =
  | { t: "num"; v: number; raw: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

export type Node =
  | { t: "num"; v: number }
  | { t: "pct"; v: Node }
  | { t: "pctof"; p: Node; of: Node }
  | { t: "neg"; v: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^" | "mod"; l: Node; r: Node }
  | { t: "call"; name: string; args: Node[] };

const MAX_LEN = 400;
const MAX_DEPTH = 40;
const FUNCS: Record<string, { min: number; max: number; fn: (a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, fn: ([x]) => (x < 0 ? NaN : Math.sqrt(x)) },
  abs: { min: 1, max: 1, fn: ([x]) => Math.abs(x) },
  round: { min: 1, max: 2, fn: ([x, d]) => roundTo(x, d === undefined ? 0 : Math.max(0, Math.min(15, Math.trunc(d)))) },
  floor: { min: 1, max: 1, fn: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, fn: ([x]) => Math.ceil(x) },
  min: { min: 1, max: 100, fn: (a) => Math.min(...a) },
  max: { min: 1, max: 100, fn: (a) => Math.max(...a) },
  sum: { min: 1, max: 100, fn: (a) => a.reduce((x, y) => x + y, 0) },
  avg: { min: 1, max: 100, fn: (a) => a.reduce((x, y) => x + y, 0) / a.length },
};
const ALIASES: Record<string, string> = { average: "avg", tong: "sum", tổng: "sum", trungbinh: "avg", can: "sqrt", căn: "sqrt" };
const OF_WORDS = new Set(["của", "cua", "of"]);

const NUM_VI = /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?![\d.])(?:,\d+)?|^\d+(?:[.,]\d+)*/;
const NUM_EN = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?|^\d+(?:\.\d+)?/;
const EXAMPLE = "ví dụ 15% của 2.500.000, (1.200.000 + 800.000) / 4, max(3; 5), round(2,567; 2)";

function tokenize(src: string, locale: NumberLocale, notes: string[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let depth = 0;
  const pushNumber = (raw: string): void => {
    const p = parseLocaleNumber(raw, locale);
    if (p) {
      const v = Number(`${p.neg ? "-" : ""}${p.int}.${p.frac || "0"}`);
      if (p.ambiguous) {
        const other = Number(`${p.neg ? "-" : ""}${p.int}${p.frac}`);
        notes.push(`“${raw}” hiểu là số thập phân ${formatVn(v)} (${locale === "vi" ? "kiểu Việt: dấu , là thập phân" : "kiểu quốc tế: dấu . là thập phân"}). Nếu ý bạn là ${formatVn(other)}, hãy viết ${other}.`);
      } else if (locale === "vi" && /,/.test(raw) && depth > 0 && !/[.]/.test(raw)) notes.push(`“${raw}” hiểu là một số thập phân; nếu ý bạn là hai số, hãy ngăn bằng “;” hoặc “, ” (có dấu cách).`);
      out.push({ t: "num", v, raw });
      return;
    }
    // trong ngoặc hàm: "3.14159,2" → hai đối số
    if (depth > 0 && raw.includes(",")) {
      const parts = raw.split(",");
      const nums = parts.map((x) => parseLocaleNumber(x, locale));
      if (nums.every((x) => x !== null)) {
        parts.forEach((x, k) => {
          if (k) out.push({ t: "op", v: ";" });
          const q = nums[k]!;
          out.push({ t: "num", v: Number(`${q.int}.${q.frac || "0"}`), raw: x });
        });
        return;
      }
    }
    throw new CalcError(`Số “${raw}” không hợp lệ. Viết số kiểu Việt (1.234.567,89) hoặc 1234567.89; nhiều đối số hàm ngăn bằng “;”.`);
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/\d/.test(c)) {
      const m = (locale === "vi" ? NUM_VI : NUM_EN).exec(src.slice(i))!;
      pushNumber(m[0]);
      i += m[0].length;
      if (/[A-Za-zÀ-ỹ]/.test(src[i] ?? "") && !/^\s/.test(src[i] ?? "") && !/^x/i.test(src[i] ?? "")) throw new CalcError(`Sau số “${m[0]}” có chữ “${src[i]}”. Hãy viết phép tính bằng số và + - * / ^ %.`);
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    const map: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "—": "-" };
    if (c === "*" && src[i + 1] === "*") {
      out.push({ t: "op", v: "^" });
      i += 2;
      continue;
    }
    if (c === "π") {
      out.push({ t: "id", v: "pi" });
      i++;
      continue;
    }
    if ("+-*/^%();,×·÷−–—".includes(c)) {
      const v = map[c] ?? c;
      if (c === "(") depth++;
      if (c === ")") depth = Math.max(0, depth - 1);
      out.push({ t: "op", v: v === "," ? ";" : v });
      i++;
      continue;
    }
    if (c === ":" || c === "=") throw new CalcError(`Ký tự “${c}” không dùng được trong biểu thức. Chỉ có số, + - * / ^ %, ngoặc ( ) và các hàm sqrt, abs, round, floor, ceil, min, max, sum, avg (${EXAMPLE}).`);
    throw new CalcError(`Ký tự “${c}” không hợp lệ trong biểu thức (${EXAMPLE}).`);
  }
  out.push({ t: "end" });
  return out;
}

class Parser {
  private p = 0;
  private depth = 0;
  constructor(private toks: Tok[]) {}
  private peek = (o = 0): Tok => this.toks[Math.min(this.p + o, this.toks.length - 1)];
  private next = (): Tok => this.toks[this.p++];
  private isOp = (v: string, o = 0): boolean => {
    const t = this.peek(o);
    return t.t === "op" && t.v === v;
  };

  parseAll(): Node {
    const n = this.addSub();
    const t = this.peek();
    if (t.t !== "end") {
      if (t.t === "op" && t.v === ")") throw new CalcError("Thừa dấu đóng ngoặc “)”.");
      if (t.t === "op" && t.v === ";") throw new CalcError("Dấu “;” chỉ dùng để ngăn các đối số trong hàm, vd max(3; 5).");
      throw new CalcError(`Biểu thức không hiểu được ở “${t.t === "num" ? t.raw : t.v}”. Thiếu phép tính giữa hai số? (${EXAMPLE})`);
    }
    return n;
  }
  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new CalcError("Biểu thức lồng quá sâu.");
  }
  private leave(): void {
    this.depth--;
  }
  private addSub(): Node {
    let l = this.mulDiv();
    for (;;) {
      if (this.isOp("+") || this.isOp("-")) {
        const op = (this.next() as { v: "+" | "-" }).v;
        const r = this.mulDiv();
        l = { t: "bin", op, l, r };
      } else return l;
    }
  }
  private mulDiv(): Node {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === "op" && (t.v === "*" || t.v === "/")) {
        this.next();
        l = { t: "bin", op: t.v, l, r: this.unary() };
      } else if (t.t === "id" && (t.v === "x" || t.v === "mod")) {
        this.next();
        l = { t: "bin", op: t.v === "x" ? "*" : "mod", l, r: this.unary() };
      } else if (t.t === "op" && t.v === "%" && this.startsOperand(1) && !this.isOp("+", 1) && !this.isOp("-", 1)) {
        // "10 % 3" = phép chia lấy dư (khi sau % là một toán hạng)
        this.next();
        l = { t: "bin", op: "mod", l, r: this.unary() };
      } else return l;
    }
  }
  private startsOperand(o: number): boolean {
    const t = this.peek(o);
    if (t.t === "num") return true;
    if (t.t === "id") return !OF_WORDS.has(t.v) && t.v !== "x" && t.v !== "mod";
    return t.t === "op" && t.v === "(";
  }
  private unary(): Node {
    if (this.isOp("-")) {
      this.next();
      this.enter();
      const v = this.unary();
      this.leave();
      return { t: "neg", v };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.power();
  }
  private power(): Node {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.next();
      this.enter();
      const exp = this.unary(); // 2^-1, 2^3^2 (kết hợp phải)
      this.leave();
      return { t: "bin", op: "^", l: base, r: exp };
    }
    return base;
  }
  private postfix(): Node {
    let n = this.primary();
    while (this.isOp("%")) {
      const after = this.peek(1);
      // "15% của X": phần trăm của X
      if (after.t === "id" && OF_WORDS.has(after.v)) {
        this.next();
        this.next();
        this.enter();
        const of = this.unary();
        this.leave();
        return { t: "pctof", p: n, of };
      }
      // "a % b": chia dư — để mulDiv xử lý
      if (this.startsOperand(1) && !this.isOp("+", 1) && !this.isOp("-", 1)) break;
      this.next();
      n = { t: "pct", v: n };
    }
    return n;
  }
  private primary(): Node {
    const t = this.next();
    if (t.t === "num") return { t: "num", v: t.v };
    if (t.t === "id") {
      if (t.v === "pi") return { t: "num", v: Math.PI };
      const name = ALIASES[t.v] ?? t.v;
      const f = FUNCS[name];
      if (!f) {
        if (OF_WORDS.has(t.v)) throw new CalcError(`Từ “${t.v}” phải đứng sau một phần trăm, vd 15% của 2.500.000.`);
        throw new CalcError(`Không hiểu “${t.v}”. Chỉ hỗ trợ số, hằng pi và các hàm ${Object.keys(FUNCS).join(", ")}.`);
      }
      if (!this.isOp("(")) throw new CalcError(`Hàm ${name} cần dấu ngoặc, vd ${name}(4).`);
      this.next();
      this.enter();
      const args: Node[] = [];
      if (!this.isOp(")")) {
        for (;;) {
          args.push(this.addSub());
          if (this.isOp(";")) {
            this.next();
            continue;
          }
          break;
        }
      }
      if (!this.isOp(")")) throw new CalcError(`Thiếu dấu đóng ngoặc “)” sau các đối số của ${name}.`);
      this.next();
      this.leave();
      if (args.length < f.min || args.length > f.max) throw new CalcError(`Hàm ${name} nhận ${f.min === f.max ? f.min : `${f.min}–${f.max}`} đối số (đang có ${args.length}); ngăn các đối số bằng “;”.`);
      return { t: "call", name, args };
    }
    if (t.t === "op" && t.v === "(") {
      this.enter();
      const n = this.addSub();
      if (!this.isOp(")")) throw new CalcError("Thiếu dấu đóng ngoặc “)”.");
      this.next();
      this.leave();
      return n;
    }
    if (t.t === "end") throw new CalcError("Biểu thức chưa đầy đủ (thiếu số ở cuối).");
    throw new CalcError(`Biểu thức không hiểu được ở “${t.t === "op" ? t.v : ""}”. Thiếu số ở trước/sau phép tính?`);
  }
}

interface EvalState {
  ops: number;
  pctAdj: boolean;
  pctOf: boolean;
}

function evalNode(n: Node, state: EvalState): number {
  if (++state.ops > 5000) throw new CalcError("Biểu thức quá phức tạp.");
  switch (n.t) {
    case "num":
      return n.v;
    case "pct":
      return evalNode(n.v, state) / 100;
    case "pctof":
      state.pctOf = true;
      return (evalNode(n.p, state) / 100) * evalNode(n.of, state);
    case "neg":
      return -evalNode(n.v, state);
    case "call": {
      const f = FUNCS[n.name];
      const r = f.fn(n.args.map((a) => evalNode(a, state)));
      if (Number.isNaN(r)) throw new CalcError(n.name === "sqrt" ? "Không lấy căn bậc hai của số âm." : `Hàm ${n.name} không tính được với các giá trị này.`);
      return r;
    }
    case "bin": {
      const l = evalNode(n.l, state);
      if ((n.op === "+" || n.op === "-") && n.r.t === "pct") {
        state.pctAdj = true;
        const pct = evalNode(n.r.v, state) / 100; // a ± b% = a ± a×b/100
        return n.op === "+" ? l + l * pct : l - l * pct;
      }
      const r = evalNode(n.r, state);
      switch (n.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new CalcError("Phép chia cho 0 không có kết quả.");
          return l / r;
        case "mod":
          if (r === 0) throw new CalcError("Phép chia dư cho 0 không có kết quả.");
          return l % r;
        case "^": {
          if (Math.abs(r) > 1e6) throw new CalcError("Số mũ quá lớn.");
          const v = Math.pow(l, r);
          if (Number.isNaN(v)) throw new CalcError("Không tính được luỹ thừa này (căn của số âm?).");
          return v;
        }
      }
    }
  }
}

const show = (v: number): string => formatVn(v);

/** Biểu thức đã hiểu, viết lại với số kiểu Việt (để người dùng kiểm tra cách máy hiểu). */
export function render(n: Node, parent = 0): string {
  const wrap = (s: string, own: number) => (own < parent ? `(${s})` : s);
  switch (n.t) {
    case "num":
      return show(n.v);
    case "pct":
      return render(n.v, 9) + "%";
    case "pctof":
      return `${render(n.p, 9)}% của ${render(n.of, 9)}`;
    case "neg":
      return wrap("-" + render(n.v, 3), 3);
    case "call":
      return `${n.name}(${n.args.map((a) => render(a)).join("; ")})`;
    case "bin": {
      const prec = n.op === "+" || n.op === "-" ? 1 : n.op === "^" ? 4 : 2;
      const sym = n.op === "mod" ? " mod " : n.op === "*" ? " × " : n.op === "/" ? " ÷ " : ` ${n.op} `;
      const pw = n.op === "^";
      return wrap(`${render(n.l, prec + (pw ? 1 : 0))}${sym}${render(n.r, prec + (pw ? 0 : 1))}`, prec);
    }
  }
}

export interface CalcResult {
  value: number;
  /** Biểu thức đã hiểu. */
  shown: string;
  notes: string[];
}

export function calculate(expression: string, opts: { locale?: NumberLocale } = {}): CalcResult {
  const src = String(expression ?? "").trim().replace(/^=\s*/, ""); // "=2+3" kiểu Excel
  if (!src) throw new CalcError(`Thiếu biểu thức (${EXAMPLE}).`);
  if (src.length > MAX_LEN) throw new CalcError(`Biểu thức quá dài (tối đa ${MAX_LEN} ký tự).`);
  const notes: string[] = [];
  const toks = tokenize(src, opts.locale ?? "vi", notes);
  if (toks.length > MAX_LEN) throw new CalcError("Biểu thức quá dài.");
  const ast = new Parser(toks).parseAll();
  const st: EvalState = { ops: 0, pctAdj: false, pctOf: false };
  const value = evalNode(ast, st);
  if (!Number.isFinite(value)) throw new CalcError("Kết quả quá lớn hoặc không xác định.");
  if (st.pctOf) notes.push("“A% của B” = A/100 × B.");
  if (st.pctAdj) notes.push("“a + b%” hiểu là a cộng b% của a (a − b% là trừ b% của a), như máy tính cầm tay.");
  return { value, shown: render(ast), notes };
}
