/**
 * Âm lịch Việt Nam (múi giờ +7) theo thuật toán thiên văn của Hồ Ngọc Đức:
 * giờ sóc (trăng mới) và kinh độ Mặt Trời tính bằng công thức, nên dùng được cho mọi năm 1900–2199 mà không cần bảng tra.
 * Đã đối chiếu các mốc Tết Nguyên đán 1990–2030 và các tháng nhuận đã biết (xem test/utils-tools.test.ts).
 */

const PI = Math.PI;
const INT = Math.floor;

export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2199;
export const VN_TZ = 7;

/** Số ngày Julian (đơn vị ngày) của ngày dương lịch. */
export function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

export function jdToDate(jd: number): { d: number; m: number; y: number } {
  let a: number, b: number, c: number;
  if (jd > 2299160) {
    a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  return { d: e - INT((153 * m + 2) / 5) + 1, m: m + 3 - 12 * INT(m / 10), y: b * 100 + d - 4800 + INT(m / 10) };
}

/** Ngày (số Julian) của trăng mới thứ k kể từ 1/1/1900. */
function newMoonDay(k: number, tz: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 -= 0.4068 * Math.sin(Mpr * dr) - 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 += 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 -= 0.0074 * Math.sin(dr * (M - Mpr)) - 0.0004 * Math.sin(dr * (2 * F + M));
  C1 -= 0.0004 * Math.sin(dr * (2 * F - M)) + 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 += 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return INT(Jd1 + C1 - deltat + 0.5 + tz / 24);
}

/** Cung của Mặt Trời (0..11, mỗi cung 30°) lúc nửa đêm giờ địa phương của ngày jdn. */
function sunLongitude(jdn: number, tz: number): number {
  const T = (jdn - 2451545.5 - tz / 24) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= PI * 2 * INT(L / (PI * 2));
  return INT((L / PI) * 6);
}

/** Ngày bắt đầu tháng 11 âm lịch (chứa Đông chí) của năm dương `yy`. */
function lunarMonth11(yy: number, tz: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = newMoonDay(k, tz);
  if (sunLongitude(nm, tz) >= 9) nm = newMoonDay(k - 1, tz);
  return nm;
}

/** Vị trí tháng nhuận trong năm âm lịch bắt đầu từ tháng 11 là a11. */
function leapMonthOffset(a11: number, tz: number): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let i = 1;
  let arc = sunLongitude(newMoonDay(k + i, tz), tz);
  let last: number;
  do {
    last = arc;
    i++;
    arc = sunLongitude(newMoonDay(k + i, tz), tz);
  } while (arc !== last && i < 14);
  return i - 1;
}

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  leap: boolean;
}

export function solarToLunar(dd: number, mm: number, yy: number, tz = VN_TZ): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1, tz);
  if (monthStart > dayNumber) monthStart = newMoonDay(k, tz);
  let a11 = lunarMonth11(yy, tz);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = lunarMonth11(yy - 1, tz);
  } else {
    lunarYear = yy + 1;
    b11 = lunarMonth11(yy + 1, tz);
  }
  const day = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = false;
  let month = diff + 11;
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11, tz);
    if (diff >= leapDiff) {
      month = diff + 10;
      if (diff === leapDiff) leap = true;
    }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) lunarYear -= 1;
  return { day, month, year: lunarYear, leap };
}

/** Đổi âm → dương; trả null nếu ngày âm không tồn tại (tháng nhuận không có, ngày 30 của tháng thiếu...). */
export function lunarToSolar(day: number, month: number, year: number, leap: boolean, tz = VN_TZ): { d: number; m: number; y: number } | null {
  let a11: number, b11: number;
  if (month < 11) {
    a11 = lunarMonth11(year - 1, tz);
    b11 = lunarMonth11(year, tz);
  } else {
    a11 = lunarMonth11(year, tz);
    b11 = lunarMonth11(year + 1, tz);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = month - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11, tz);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && month !== leapMonth) return null;
    if (leap || off >= leapOff) off += 1;
  } else if (leap) return null;
  const s = jdToDate(newMoonDay(k + off, tz) + day - 1);
  // kiểm tra khứ hồi: bắt các ngày không tồn tại (vd 30 tháng thiếu)
  const back = solarToLunar(s.d, s.m, s.y, tz);
  if (back.day !== day || back.month !== month || back.year !== year || back.leap !== leap) return null;
  return s;
}

/** Số ngày của tháng âm (29 hoặc 30) chứa ngày âm đã cho. */
export function lunarMonthLength(month: number, year: number, leap: boolean, tz = VN_TZ): number | null {
  return lunarToSolar(30, month, year, leap, tz) ? 30 : lunarToSolar(29, month, year, leap, tz) ? 29 : null;
}

// ---------------------------------------------------------------- Can Chi

export const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
export const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];
export const CON_GIAP = ["Chuột", "Trâu", "Hổ", "Mèo", "Rồng", "Rắn", "Ngựa", "Dê", "Khỉ", "Gà", "Chó", "Lợn"];
export const LUNAR_MONTH_NAME = ["", "Giêng", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy", "Tám", "Chín", "Mười", "Một", "Chạp"];

export const canChiYear = (y: number): string => `${CAN[(((y + 6) % 10) + 10) % 10]} ${CHI[(((y + 8) % 12) + 12) % 12]}`;
export const zodiacOfYear = (y: number): string => CON_GIAP[(((y + 8) % 12) + 12) % 12];

/** Can Chi của ngày (theo số Julian của ngày dương lịch). */
export const canChiDay = (jd: number): string => `${CAN[(jd + 9) % 10]} ${CHI[(jd + 1) % 12]}`;

/** Can Chi của tháng âm: tháng Giêng luôn là Dần; Can tháng Giêng suy từ Can năm. */
export function canChiMonth(month: number, lunarYear: number): string {
  const yc = (((lunarYear + 6) % 10) + 10) % 10;
  const first = ((yc % 5) * 2 + 2) % 10;
  return `${CAN[(first + month - 1) % 10]} ${CHI[(month + 1) % 12]}`;
}

export interface LunarInfo extends LunarDate {
  length: number | null;
  canChiDay: string;
  canChiMonth: string;
  canChiYear: string;
  zodiac: string;
}

export function lunarInfo(dd: number, mm: number, yy: number): LunarInfo {
  const l = solarToLunar(dd, mm, yy);
  const jd = jdFromDate(dd, mm, yy);
  return {
    ...l,
    length: lunarMonthLength(l.month, l.year, l.leap),
    canChiDay: canChiDay(jd),
    canChiMonth: canChiMonth(l.month, l.year),
    canChiYear: canChiYear(l.year),
    zodiac: zodiacOfYear(l.year),
  };
}
