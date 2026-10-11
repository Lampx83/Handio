/**
 * Sinh dữ liệu mẫu hàng loạt (vd "200 bản ghi") ngay trong công cụ, để mô hình chỉ cần mô tả CỘT (vài trăm ký tự) thay vì tự gõ từng ô.
 * Gõ 200 hàng trong một lời gọi công cụ vượt giới hạn đầu ra của mô hình → lời gọi bị cắt, mô hình lặp đi lặp lại và đẻ ra hàng loạt tệp.
 * Kết quả xác định (cùng `seed` cho cùng dữ liệu), không dùng đồng hồ/ngẫu nhiên thật.
 */
import type { CellInput } from "./xlsx";

export const GEN_MAX_ROWS = 5000;
export const GEN_MAX_COLS = 30;

export type GenColumn =
  | { name: string; type: "seq"; start?: number; step?: number; prefix?: string; pad?: number }
  | { name: string; type: "pick"; values: (string | number)[]; weights?: number[] }
  | { name: string; type: "int"; min?: number; max?: number }
  | { name: string; type: "float"; min?: number; max?: number; decimals?: number }
  | { name: string; type: "date"; from?: string; to?: string }
  | { name: string; type: "name_vi"; gender?: "nam" | "nu" }
  | { name: string; type: "email"; from?: string; domain?: string }
  | { name: string; type: "phone_vi" }
  | { name: string; type: "bool"; true_label?: string; false_label?: string; p?: number }
  | { name: string; type: "text"; template: string }
  | { name: string; type: "formula"; template: string };

export interface GenSpec {
  count: number;
  seed?: number;
  columns: GenColumn[];
}

const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh", "Trịnh", "Đào", "Lâm"];
const DEM_NAM = ["Văn", "Đức", "Minh", "Quang", "Hữu", "Anh", "Gia", "Hoàng", "Tuấn", "Thành", "Quốc", "Xuân"];
const DEM_NU = ["Thị", "Ngọc", "Thu", "Mai", "Khánh", "Phương", "Thanh", "Diệu", "Bảo", "Hồng", "Kim", "Thuỳ"];
const TEN_NAM = ["Anh", "Bình", "Cường", "Dũng", "Dương", "Hải", "Hiếu", "Hùng", "Huy", "Khoa", "Long", "Minh", "Nam", "Phong", "Quân", "Sơn", "Thắng", "Trung", "Tú", "Việt"];
const TEN_NU = ["Anh", "Chi", "Dung", "Giang", "Hà", "Hằng", "Hoa", "Hương", "Lan", "Linh", "Mai", "Ngân", "Nhung", "Phương", "Quỳnh", "Thảo", "Trang", "Vy", "Yến", "Hạnh"];

/** Bộ sinh số giả ngẫu nhiên xác định (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pad2 = (n: number) => String(n).padStart(2, "0");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Kiểm tra đặc tả; ném Error có lời nhắn tiếng Việt chỉ cách sửa. */
export function validateGen(spec: unknown): GenSpec {
  if (!spec || typeof spec !== "object") throw new Error("generate phải là đối tượng {count, columns: [...]}.");
  const s = spec as GenSpec;
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > GEN_MAX_ROWS) throw new Error(`generate.count phải là số nguyên từ 1 đến ${GEN_MAX_ROWS}.`);
  if (!Array.isArray(s.columns) || !s.columns.length || s.columns.length > GEN_MAX_COLS) throw new Error(`generate.columns phải có 1–${GEN_MAX_COLS} cột, mỗi cột {name, type}.`);
  const TYPES = ["seq", "pick", "int", "float", "date", "name_vi", "email", "phone_vi", "bool", "text", "formula"];
  s.columns.forEach((c, i) => {
    if (!c || typeof c.name !== "string" || !c.name.trim()) throw new Error(`Cột ${i + 1}: thiếu name.`);
    if (!TYPES.includes(c.type)) throw new Error(`Cột "${c.name}": type "${(c as { type: string }).type}" không có. Dùng: ${TYPES.join(", ")}.`);
    if (c.type === "pick" && (!Array.isArray(c.values) || !c.values.length || c.values.length > 200)) throw new Error(`Cột "${c.name}": pick cần values là danh sách 1–200 giá trị.`);
    if ((c.type === "text" || c.type === "formula") && typeof c.template !== "string") throw new Error(`Cột "${c.name}": ${c.type} cần template (chuỗi).`);
  });
  return s;
}

/**
 * Sinh các hàng DỮ LIỆU (không gồm hàng tiêu đề). `firstRow` là số hàng Excel của hàng đầu tiên (để công thức {row}, {prev} đúng).
 * Trong template: {seq} = số thứ tự 1..count, {row} = số hàng, {col:Tên cột} = giá trị đã sinh của cột đó trong cùng hàng.
 */
export function generateRows(spec: GenSpec, firstRow = 2): CellInput[][] {
  const s = validateGen(spec);
  const rand = rng(num(s.seed, 20261011));
  const pickIdx = (n: number) => Math.min(n - 1, Math.floor(rand() * n));
  const colName = (i: number): string => {
    let n = i + 1;
    let out = "";
    while (n > 0) {
      out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const rows: CellInput[][] = [];
  for (let r = 0; r < s.count; r++) {
    const row: CellInput[] = [];
    const byName = new Map<string, CellInput>();
    let lastName = "";
    for (const c of s.columns) {
      let v: CellInput;
      switch (c.type) {
        case "seq": {
          const n = num(c.start, 1) + r * num(c.step, 1);
          v = c.prefix || c.pad ? `${c.prefix ?? ""}${String(n).padStart(c.pad ?? 0, "0")}` : n;
          break;
        }
        case "pick": {
          if (Array.isArray(c.weights) && c.weights.length === c.values.length) {
            const tot = c.weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
            let x = rand() * tot;
            let k = 0;
            for (; k < c.values.length - 1; k++) {
              x -= Math.max(0, c.weights[k]);
              if (x < 0) break;
            }
            v = c.values[k];
          } else v = c.values[pickIdx(c.values.length)];
          break;
        }
        case "int": {
          const lo = Math.ceil(num(c.min, 0));
          const hi = Math.floor(num(c.max, 100));
          v = lo + Math.floor(rand() * (Math.max(hi, lo) - lo + 1));
          break;
        }
        case "float": {
          const lo = num(c.min, 0);
          const hi = num(c.max, 10);
          const d = Math.max(0, Math.min(6, Math.floor(num(c.decimals, 1))));
          v = Number((lo + rand() * (hi - lo)).toFixed(d));
          break;
        }
        case "date": {
          const a = Date.parse((c.from ?? "2026-01-01") + "T00:00:00Z");
          const b = Date.parse((c.to ?? "2026-12-31") + "T00:00:00Z");
          const lo = Number.isFinite(a) ? a : Date.UTC(2026, 0, 1);
          const hi = Number.isFinite(b) && b >= lo ? b : lo;
          v = iso(new Date(lo + Math.floor(rand() * ((hi - lo) / 86400000 + 1)) * 86400000));
          break;
        }
        case "name_vi": {
          const nu = c.gender ? c.gender === "nu" : rand() < 0.5;
          const ho = HO[pickIdx(HO.length)];
          const dem = (nu ? DEM_NU : DEM_NAM)[pickIdx(12)];
          const ten = (nu ? TEN_NU : TEN_NAM)[pickIdx(20)];
          v = `${ho} ${dem} ${ten}`;
          lastName = v;
          break;
        }
        case "email": {
          const src = c.from ? String(byName.get(c.from) ?? "") : lastName;
          const base = strip(src) || "nguoidung";
          v = `${base}${r + 1}@${c.domain ?? "example.com"}`;
          break;
        }
        case "phone_vi":
          v = "09" + String(Math.floor(rand() * 1e8)).padStart(8, "0");
          break;
        case "bool":
          v = rand() < num(c.p, 0.5) ? (c.true_label ?? "Có") : (c.false_label ?? "Không");
          break;
        case "text":
        case "formula": {
          const rowNo = firstRow + r;
          v = c.template
            .replace(/\{seq\}/g, String(r + 1))
            .replace(/\{row\}/g, String(rowNo))
            .replace(/\{col:([^}]+)\}/g, (_m, n: string) => String(byName.get(n.trim()) ?? ""))
            .replace(/\{letter:(\d+)\}/g, (_m, i: string) => colName(Number(i) - 1));
          break;
        }
      }
      byName.set(c.name, v);
      row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

export const genHeader = (spec: GenSpec): string[] => spec.columns.map((c) => c.name);
