/**
 * Ngày tháng kiểu Việt: phân tích dd/mm/yyyy hoặc ISO, cộng/trừ, khoảng cách, ngày làm việc và ngày nghỉ lễ chính thức.
 * Ngày được biểu diễn bằng số ngày kể từ 1970-01-01 (UTC) nên không dính múi giờ hay giờ mùa hè.
 */
import { LUNAR_MAX_YEAR, LUNAR_MIN_YEAR, lunarToSolar } from "./lunar";

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export const WEEKDAY_VN = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
export const MIN_YEAR = 1000;
export const MAX_YEAR = 2999;

const DAY_MS = 86_400_000;

export const toDays = (t: Ymd): number => Math.round(Date.UTC(t.y, t.m - 1, t.d) / DAY_MS);
export function fromDays(n: number): Ymd {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const p2 = (n: number): string => String(n).padStart(2, "0");
export const fmtVn = (t: Ymd): string => `${p2(t.d)}/${p2(t.m)}/${String(t.y).padStart(4, "0")}`;
export const fmtIso = (t: Ymd): string => `${String(t.y).padStart(4, "0")}-${p2(t.m)}-${p2(t.d)}`;
/** Thứ trong tuần: 0 = Chủ nhật … 6 = Thứ Bảy. */
export const weekdayOf = (n: number): number => (((n + 4) % 7) + 7) % 7;
export const weekdayName = (n: number): string => WEEKDAY_VN[weekdayOf(n)];
export const isWeekend = (n: number): boolean => {
  const w = weekdayOf(n);
  return w === 0 || w === 6;
};

export function validYmd(y: number, m: number, d: number): boolean {
  if (![y, m, d].every(Number.isInteger) || y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** dd/mm/yyyy, d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy hoặc yyyy-mm-dd (phần giờ, nếu có, bị bỏ qua). Trả null nếu không hợp lệ. */
export function parseDate(raw: unknown): Ymd | null {
  if (raw instanceof Date) return validYmd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()) ? { y: raw.getUTCFullYear(), m: raw.getUTCMonth() + 1, d: raw.getUTCDate() } : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(+m[3], +m[2], +m[1]) ? { y: +m[3], m: +m[2], d: +m[1] } : null;
  return null;
}

/** Cộng n tháng, giữ ngày trong tháng; nếu tháng đích ngắn hơn thì lùi về ngày cuối tháng (`clamped`). */
export function addMonths(t: Ymd, n: number): { date: Ymd; clamped: boolean } {
  const idx = t.y * 12 + (t.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (((idx % 12) + 12) % 12) + 1;
  const dim = daysInMonth(y, m);
  return { date: { y, m, d: Math.min(t.d, dim) }, clamped: t.d > dim };
}

/** Khoảng cách theo lịch (năm, tháng, ngày) từ a đến b với a ≤ b. */
export function calendarDiff(a: Ymd, b: Ymd): { years: number; months: number; days: number } {
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months--;
  const anchor = addMonths(a, months).date;
  const days = toDays(b) - toDays(anchor);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

// ---------------------------------------------------------------- ngày nghỉ lễ

export interface HolidayDay {
  /** Số ngày (toDays). */
  n: number;
  name: string;
  /** "holiday" nghỉ lễ chính thức; "extra" ngày nghỉ thêm theo thông lệ (chưa chắc); "bu" ngày nghỉ bù. */
  kind: "holiday" | "extra" | "bu";
}

export const HOLIDAY_DISCLAIMER =
  "Theo quy định thông thường (Bộ luật Lao động 2019, Điều 112); lịch nghỉ thực tế do Chính phủ công bố hằng năm (có thể hoán đổi ngày làm việc/nghỉ bù khác), hãy đối chiếu thông báo chính thức.";

const cache = new Map<number, HolidayDay[]>();

/** Danh sách ngày nghỉ (đã sắp xếp theo ngày) của một năm dương lịch, gồm cả ngày nghỉ bù khi lễ rơi vào cuối tuần. */
export function holidaysOf(year: number): HolidayDay[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const list: HolidayDay[] = [];
  const add = (y: number, m: number, d: number, name: string, kind: HolidayDay["kind"] = "holiday") => list.push({ n: toDays({ y, m, d }), name, kind });
  add(year, 1, 1, "Tết Dương lịch");
  // Tết Nguyên đán: ngày cuối năm âm + mùng 1–4
  const inLunarRange = year >= LUNAR_MIN_YEAR && year <= LUNAR_MAX_YEAR;
  const tet = inLunarRange ? lunarToSolar(1, 1, year, false) : null;
  if (tet) {
    const first = toDays(tet);
    add(...ymdArgs(fromDays(first - 1)), "Tết Nguyên đán (ngày cuối năm âm lịch)");
    for (let i = 0; i < 4; i++) add(...ymdArgs(fromDays(first + i)), `Tết Nguyên đán (mùng ${i + 1})`);
  }
  // Giỗ Tổ Hùng Vương 10/3 âm lịch (nghỉ chính thức từ 2007)
  const gt = inLunarRange && year >= 2007 ? lunarToSolar(10, 3, year, false) : null;
  if (gt) add(gt.y, gt.m, gt.d, "Giỗ Tổ Hùng Vương (10/3 âm lịch)");
  add(year, 4, 30, "Ngày Giải phóng miền Nam (30/4)");
  add(year, 5, 1, "Quốc tế Lao động (1/5)");
  add(year, 9, 2, "Quốc khánh (2/9)");
  if (year >= 2021) {
    // Từ 2021 nghỉ 2 ngày: 2/9 và một ngày liền kề (1/9 hoặc 3/9) do Chính phủ chọn hằng năm
    const wd = weekdayOf(toDays({ y: year, m: 9, d: 2 }));
    const after = wd === 1 || wd === 4 || wd === 0;
    add(year, 9, after ? 3 : 1, `Quốc khánh (ngày nghỉ thêm ${after ? "3/9" : "1/9"}, theo thông lệ gần đây; có thể là ${after ? "1/9" : "3/9"})`, "extra");
  }
  list.sort((a, b) => a.n - b.n);
  // nghỉ bù: lễ rơi vào thứ Bảy/Chủ nhật → nghỉ bù vào ngày làm việc kế tiếp
  const taken = new Set(list.map((h) => h.n));
  const bu: HolidayDay[] = [];
  for (const h of list) {
    if (!isWeekend(h.n)) continue;
    let n = h.n + 1;
    while (isWeekend(n) || taken.has(n)) n++;
    taken.add(n);
    bu.push({ n, name: `Nghỉ bù (${h.name} rơi vào ${weekdayName(h.n)})`, kind: "bu" });
  }
  const all = [...list, ...bu].sort((a, b) => a.n - b.n);
  cache.set(year, all);
  return all;
}

const ymdArgs = (t: Ymd): [number, number, number] => [t.y, t.m, t.d];

/** Khoảng năm có đủ dữ liệu ngày lễ âm lịch (Tết, Giỗ Tổ); ngoài khoảng này chỉ có lễ dương lịch. */
export const lunarHolidayRange = (fromYear: number, toYear: number): boolean => fromYear >= LUNAR_MIN_YEAR && toYear <= LUNAR_MAX_YEAR;

/** Ngày nghỉ (lễ/bù) trùng với ngày n, nếu có. */
export function holidayOn(n: number): HolidayDay | undefined {
  const y = fromDays(n).y;
  return holidaysOf(y).find((h) => h.n === n);
}

export const isWorkday = (n: number): boolean => !isWeekend(n) && !holidayOn(n);

/** Cộng k ngày làm việc (k âm = lùi). k = 0 trả về chính ngày đó. */
export function addWorkdays(n: number, k: number): number {
  let cur = n;
  let left = Math.abs(k);
  const step = k < 0 ? -1 : 1;
  while (left > 0) {
    cur += step;
    if (isWorkday(cur)) left--;
  }
  return cur;
}

/** Đếm ngày trong đoạn [from, to]; trả về cả số ngày làm việc và các ngày lễ rơi vào ngày thường. */
export function countRange(from: number, to: number): { days: number; workdays: number; weekendDays: number; holidays: { n: number; name: string }[] } {
  let workdays = 0;
  let weekendDays = 0;
  const holidays: { n: number; name: string }[] = [];
  for (let n = from; n <= to; n++) {
    if (isWeekend(n)) {
      weekendDays++;
      continue;
    }
    const h = holidayOn(n);
    if (h) holidays.push({ n, name: h.name });
    else workdays++;
  }
  return { days: to - from + 1, workdays, weekendDays, holidays };
}
