/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Env } from "../env";
import { basename } from "../path";
import { isSensitivePath } from "../sensitive";
import { relPath, resolveSafe, ToolError, type Tool, type ToolContext } from "../tools";
import { brandName } from "../brand";
import { decodeText, detectDelimiter, inferCell, parseDelimited, toCsv } from "./csv";
import { documentStats } from "./doc-stats";
import { documentUnits } from "./locate";
import { buildEml, buildIcs, parseDateTime, parseMailbox, splitAddresses, type DateTime, type Mailbox } from "./mail-ics";
import { canChiYear, LUNAR_MAX_YEAR, LUNAR_MIN_YEAR, LUNAR_MONTH_NAME, lunarInfo, lunarToSolar, zodiacOfYear } from "./lunar";
import { extOf, readDocumentSections } from "./readdoc";
import { diffLinesDoc, TooLargeError, wordDiff, type Change, type Line } from "./text-diff";
import { calculate, CalcError } from "./vn-calc";
import {
  addMonths, addWorkdays, calendarDiff, countRange, fmtIso, fmtVn, fromDays, HOLIDAY_DISCLAIMER, holidayOn, holidaysOf, isWeekend, isWorkday, lunarHolidayRange, parseDate, toDays, weekdayName, type Ymd,
} from "./vn-calendar";
import { formatVn, numberToWords, plainNumber, roundTo, toParsed, type Currency } from "./vn-number";
import { normalizePhone, normalizeSpaces, phoneLine, removeDiacritics, slugify, sortNames, splitName, titleCaseName, nfc } from "./vn-text";
import { createXlsx, readXlsxGrid } from "./xlsx";
import { commit, kb, loadBinary, outlinePreview, prepareWrite } from "./tools";

const S = { type: "string" } as const;
const bad = (m: string): ToolError => new ToolError(m, "bad_args");

const DATE_HINT = "Dùng dd/mm/yyyy (vd 15/03/2025) hoặc yyyy-mm-dd (vd 2025-03-15).";

function needDate(v: unknown, what = "Ngày"): Ymd {
  if (v === undefined || v === null || v === "") throw bad(`Thiếu ${what.toLowerCase()}. ${DATE_HINT}`);
  const d = parseDate(v);
  if (!d) throw bad(`${what} không hợp lệ: “${String(v)}”. ${DATE_HINT}`);
  return d;
}

const wd = (t: Ymd): string => `${fmtVn(t)} (${weekdayName(toDays(t))})`;
const int = (v: unknown, what: string, opts: { min?: number; max?: number } = {}): number => {
  const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${what} phải là một số nguyên (vd 5 hoặc -3).`);
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) throw bad(`${what} phải trong khoảng ${opts.min ?? "-∞"}…${opts.max ?? "∞"}.`);
  return n;
};

/** Danh sách chuỗi: mảng, chuỗi JSON của mảng, hoặc chuỗi ngăn bằng `sep`. */
function listArg(v: unknown, sep: RegExp): string[] {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        /* coi như chuỗi thường */
      }
    }
    return t.split(sep).map((x) => x.trim()).filter(Boolean);
  }
  throw bad("Tham số phải là một danh sách.");
}

function mailboxes(v: unknown, what: string): Mailbox[] {
  return listArg(v, /$^/).flatMap((x) => splitAddresses(x)).map((raw) => {
    const m = parseMailbox(raw);
    if (!m) throw bad(`Địa chỉ email không hợp lệ trong ${what}: “${raw}”. Ví dụ đúng: a@neu.edu.vn hoặc Nguyễn Văn A <a@neu.edu.vn>.`);
    return m;
  });
}

/** Tên tệp mặc định (trong thư mục dự án) không trùng tệp có sẵn: ten.eml, ten-2.eml … */
async function freeName(ctx: ToolContext, stem: string, ext: string): Promise<string> {
  for (let i = 1; i < 200; i++) {
    const name = i === 1 ? `${stem}${ext}` : `${stem}-${i}${ext}`;
    if (!(await ctx.env.stat(await resolveSafe(ctx, name)))) return name;
  }
  return `${stem}-${Date.now().toString(36)}${ext}`;
}

const stemOf = (p: unknown): string => basename(String(p ?? "")).replace(/\.[^.]+$/, "");

async function guardRead(ctx: ToolContext, abs: string): Promise<void> {
  if (isSensitivePath(relPath(ctx, abs))) throw new ToolError(`${relPath(ctx, abs)} có thể chứa khoá/mật khẩu nên công cụ này không đọc. Hãy chọn tệp khác.`, "sandbox");
}

// ---------------------------------------------------------------- vn_number_words

const CURRENCY_ALIAS: Record<string, Currency> = { vnd: "vnd", vnđ: "vnd", dong: "vnd", đồng: "vnd", usd: "usd", $: "usd", "đô": "usd", none: "none", "": "none", null: "none", false: "none" };

function numberWordsTool(): Tool {
  return {
    name: "vn_number_words", kind: "read", readonly: true,
    description: "Convert a number to Vietnamese words exactly as written in administrative documents (do NOT do this yourself, models often get it wrong). Examples: 1234000 + vnd → 'Một triệu hai trăm ba mươi tư nghìn đồng chẵn'; 105 → 'Một trăm linh năm'; 1.001 → 'Một nghìn không trăm linh một'; 2.5 → 'Hai phẩy năm'. Handles negatives, decimals ('phẩy') and values up to 10^15; 'lăm/mốt/tư/linh' rules are applied. value: a JSON number, or a string in Vietnamese format ('1.234.567,5') or plain digits. currency: 'vnd' (adds 'đồng chẵn'), 'usd' ('đô la Mỹ', cents as 'xu') or 'none'. style: 'formal' (default: capitalised, 'linh', 'nghìn'), 'plain' (same words, lowercase), 'south' (southern usage: 'lẻ', 'ngàn').",
    parameters: { type: "object", properties: { value: { description: "number or numeric string, e.g. 1234567 or '1.234.567,5'" }, currency: { type: "string", enum: ["vnd", "usd", "none"] }, style: { type: "string", enum: ["formal", "plain", "south"] } }, required: ["value"] },
    summarize: (a) => `${a.value ?? ""}${a.currency && a.currency !== "none" ? " " + a.currency : ""}`,
    async run(_ctx, a) {
      const p = toParsed(a.value, "vi");
      if (!p) throw bad(`Không đọc được số “${String(a.value)}”. Ví dụ đúng: 1234567, 1.234.567 hoặc 1.234.567,5 (dấu chấm ngăn nghìn, dấu phẩy thập phân).`);
      const cur = CURRENCY_ALIAS[String(a.currency ?? "none").trim().toLowerCase()];
      if (cur === undefined) throw bad(`currency phải là "vnd", "usd" hoặc "none" (nhận “${String(a.currency)}”).`);
      const style = String(a.style ?? "formal").toLowerCase();
      if (!["formal", "plain", "south"].includes(style)) throw bad(`style phải là "formal", "plain" hoặc "south" (nhận “${String(a.style)}”).`);
      let r;
      try {
        r = numberToWords(p, { currency: cur, style: style as "formal" | "plain" | "south" });
      } catch (e) {
        if (e instanceof RangeError && /usd/.test(e.message)) throw bad("USD chỉ có tối đa 2 chữ số thập phân (xu). Ví dụ: 1234,50.");
        throw bad("Số quá lớn: công cụ đọc được đến 1.000.000.000.000.000 (một triệu tỷ).");
      }
      const note = p.ambiguous && typeof a.value === "string" ? `\nLưu ý: “${a.value}” được hiểu theo kiểu Việt là số thập phân (dấu , là thập phân, dấu . ngăn nghìn). Nếu ý bạn là ${a.value.replace(/,/g, "")}, hãy viết liền không dấu phân cách.` : "";
      return `${r.words}\nSố: ${r.figure}${note}`;
    },
  };
}

// ---------------------------------------------------------------- date_calc

function isoWeek(n: number): { year: number; week: number } {
  const w = ((n + 4) % 7 + 7) % 7;
  const iso = w === 0 ? 7 : w;
  const thu = n + 4 - iso;
  const y = fromDays(thu).y;
  return { year: y, week: Math.floor((thu - toDays({ y, m: 1, d: 1 })) / 7) + 1 };
}

function lunarText(t: Ymd): string | null {
  if (t.y < LUNAR_MIN_YEAR || t.y > LUNAR_MAX_YEAR) return null;
  const l = lunarInfo(t.d, t.m, t.y);
  return `${l.day}/${l.month}${l.leap ? " (nhuận)" : ""}/${l.year} âm lịch (năm ${l.canChiYear})`;
}

const UNIT_ALIASES: Record<string, "days" | "weeks" | "months" | "years"> = {
  day: "days", days: "days", d: "days", ngay: "days", "ngày": "days",
  week: "weeks", weeks: "weeks", w: "weeks", tuan: "weeks", "tuần": "weeks",
  month: "months", months: "months", m: "months", thang: "months", "tháng": "months",
  year: "years", years: "years", y: "years", nam: "years", "năm": "years",
};

function dateCalcTool(): Tool {
  return {
    name: "date_calc", kind: "read", readonly: true,
    description: "Exact date arithmetic for Vietnam (never compute dates or weekdays yourself). Dates are dd/mm/yyyy or yyyy-mm-dd. action 'add': date + amount of unit ('day'|'week'|'month'|'year'; negative = subtract; or give days/weeks/months/years separately); month-end is clamped (31/01 + 1 month = 28/02). 'diff': between date and to → calendar days, weeks, years/months/days and WORKING days (Mon–Fri excluding Vietnamese public holidays incl. Tết and compensatory days off); inclusive=true counts the first day too. 'weekday': weekday (Vietnamese), day of year, ISO week, holiday and lunar date. 'workdays_add': date + days working days (negative = back). 'holidays': official holidays of a year with compensatory days. Holiday data follows the standard rules (Labour Code 2019, Tết = 5 days); the government announces the real schedule yearly, so say that to the user when it matters.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "diff", "weekday", "workdays_add", "holidays"] },
        date: { type: "string", description: "base/start date" }, to: { type: "string", description: "end date (diff)" },
        amount: { type: "integer", description: "add: how many units (negative = subtract)" }, unit: { type: "string", enum: ["day", "week", "month", "year"] },
        days: { type: "integer", description: "add: days to add; workdays_add: working days to add" }, weeks: { type: "integer" }, months: { type: "integer" }, years: { type: "integer" },
        year: { type: "integer", description: "holidays: the year (default current year)" }, inclusive: { type: "boolean", description: "diff: count both first and last day (default false: first day excluded)" },
      },
      required: ["action"],
    },
    summarize: (a) => `${a.action ?? ""} ${a.date ?? a.year ?? ""}${a.to ? " → " + a.to : ""}`,
    async run(_ctx, a) {
      const action = String(a.action ?? "").trim().toLowerCase();
      if (action === "add") {
        const base = needDate(a.date);
        const off = { years: 0, months: 0, weeks: 0, days: 0 };
        if (a.amount !== undefined && a.amount !== null && a.amount !== "") {
          const u = UNIT_ALIASES[String(a.unit ?? "day").trim().toLowerCase()];
          if (!u) throw bad(`unit phải là "day", "week", "month" hoặc "year" (nhận “${String(a.unit)}”).`);
          off[u] += int(a.amount, "amount");
        }
        for (const k of ["years", "months", "weeks", "days"] as const) if (a[k] !== undefined && a[k] !== null && a[k] !== "") off[k] += int(a[k], k);
        if (!off.years && !off.months && !off.weeks && !off.days) throw bad('Thiếu lượng cần cộng. Ví dụ: {"action":"add","date":"15/03/2025","amount":3,"unit":"month"} hoặc {"days":45}.');
        const m = addMonths(base, off.years * 12 + off.months);
        const result = fromDays(toDays(m.date) + off.weeks * 7 + off.days);
        if (result.y < 1000 || result.y > 2999) throw bad("Kết quả nằm ngoài khoảng năm 1000–2999.");
        const parts = [off.years && `${off.years} năm`, off.months && `${off.months} tháng`, off.weeks && `${off.weeks} tuần`, off.days && `${off.days} ngày`].filter(Boolean).join(" ");
        const n = toDays(result);
        const h = holidayOn(n);
        return [
          `${wd(base)} + ${parts} = ${wd(result)}`,
          `ISO: ${fmtIso(result)}`,
          m.clamped ? `Lưu ý: tháng đích không có ngày ${base.d}, đã lùi về ngày cuối tháng (${fmtVn(m.date)}).` : "",
          isWeekend(n) ? "Lưu ý: rơi vào ngày nghỉ cuối tuần." : h ? `Lưu ý: rơi vào ngày nghỉ lễ (${h.name}).` : "",
        ].filter(Boolean).join("\n");
      }
      if (action === "diff") {
        const x = needDate(a.date, "Ngày bắt đầu (date)");
        const y = needDate(a.to, "Ngày kết thúc (to)");
        let from = toDays(x);
        let to = toDays(y);
        let swapped = false;
        if (to < from) {
          [from, to] = [to, from];
          swapped = true;
        }
        const inclusive = a.inclusive === true;
        const lo = inclusive ? from : from + 1;
        const r = to >= lo ? countRange(lo, to) : { days: 0, workdays: 0, weekendDays: 0, holidays: [] as { n: number; name: string }[] };
        const cd = calendarDiff(fromDays(from), fromDays(to));
        const total = to - from + (inclusive ? 1 : 0);
        const wk = Math.floor(total / 7);
        const lines = [
          `Từ ${wd(fromDays(from))} đến ${wd(fromDays(to))}${swapped ? " (ngày kết thúc đứng trước ngày bắt đầu, đã đảo lại)" : ""}; ${inclusive ? "tính cả ngày đầu và ngày cuối" : "không tính ngày đầu, tính ngày cuối"}.`,
          `Số ngày: ${total} (${wk ? `${wk} tuần ` : ""}${total % 7} ngày)`,
          `Theo lịch: ${cd.years} năm ${cd.months} tháng ${cd.days} ngày (tổng ${cd.years * 12 + cd.months} tháng ${cd.days} ngày)`,
          `Ngày làm việc: ${r.workdays} (loại ${r.weekendDays} ngày thứ Bảy/Chủ nhật${r.holidays.length ? ` và ${r.holidays.length} ngày nghỉ lễ` : ""})`,
        ];
        if (r.holidays.length) lines.push("Ngày nghỉ lễ trong khoảng: " + r.holidays.slice(0, 15).map((h) => `${fmtVn(fromDays(h.n))} ${h.name}`).join("; ") + (r.holidays.length > 15 ? "; …" : ""));
        lines.push("Ngày lễ theo quy định thông thường; lịch thực tế do Chính phủ công bố hằng năm.");
        if (!lunarHolidayRange(fromDays(from).y, fromDays(to).y)) lines.push(`Lưu ý: ngoài các năm ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR} chỉ tính lễ dương lịch (không có Tết, Giỗ Tổ).`);
        return lines.join("\n");
      }
      if (action === "weekday") {
        const d = needDate(a.date);
        const n = toDays(d);
        const h = holidayOn(n);
        const iw = isoWeek(n);
        const lunar = lunarText(d);
        return [
          `${fmtVn(d)} là ${weekdayName(n)}`,
          `Ngày thứ ${n - toDays({ y: d.y, m: 1, d: 1 }) + 1} trong năm ${d.y}; tuần ISO ${iw.week}/${iw.year}`,
          lunar ? `Âm lịch: ${lunar}` : "",
          h ? `Ngày nghỉ: ${h.name}` : isWeekend(n) ? "Ngày nghỉ cuối tuần" : "Ngày làm việc bình thường",
        ].filter(Boolean).join("\n");
      }
      if (action === "workdays_add") {
        const d = needDate(a.date);
        const k = int(a.days ?? a.amount, "days", { min: -5000, max: 5000 });
        const start = toDays(d);
        const end = addWorkdays(start, k);
        const lo = Math.min(start, end);
        const skipped = [];
        for (let n = lo; n <= Math.max(start, end); n++) if (!isWeekend(n)) {
          const h = holidayOn(n);
          if (h && n !== start) skipped.push(`${fmtVn(fromDays(n))} ${h.name}`);
        }
        return [
          `${wd(d)} ${k >= 0 ? "+" : "−"} ${Math.abs(k)} ngày làm việc = ${wd(fromDays(end))}`,
          `ISO: ${fmtIso(fromDays(end))}`,
          !isWorkday(start) && k === 0 ? "Lưu ý: ngày gốc không phải ngày làm việc." : "",
          skipped.length ? "Đã bỏ qua ngày nghỉ lễ: " + skipped.slice(0, 15).join("; ") : "",
          "Ngày lễ theo quy định thông thường; lịch thực tế do Chính phủ công bố hằng năm.",
          !lunarHolidayRange(Math.min(fromDays(start).y, fromDays(end).y), Math.max(fromDays(start).y, fromDays(end).y)) ? `Lưu ý: ngoài các năm ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR} chỉ tính lễ dương lịch (không có Tết, Giỗ Tổ).` : "",
        ].filter(Boolean).join("\n");
      }
      if (action === "holidays") {
        const year = a.year === undefined || a.year === null || a.year === "" ? new Date().getUTCFullYear() : int(a.year, "year", { min: 1900, max: 2199 });
        const list = holidaysOf(year);
        const lines = [`Ngày nghỉ lễ năm ${year} (theo quy định thông thường):`];
        for (const h of list) lines.push(`- ${fmtVn(fromDays(h.n))} (${weekdayName(h.n)}): ${h.name}`);
        const workdays = (() => {
          let c = 0;
          for (let n = toDays({ y: year, m: 1, d: 1 }); n <= toDays({ y: year, m: 12, d: 31 }); n++) if (isWorkday(n)) c++;
          return c;
        })();
        lines.push(`Số ngày làm việc trong năm ${year} (thứ Hai–thứ Sáu, trừ các ngày trên): ${workdays}.`);
        lines.push(HOLIDAY_DISCLAIMER);
        if (year < 2021) lines.push("Lưu ý: trước 2021 Quốc khánh chỉ nghỉ 1 ngày; trước 2007 chưa nghỉ Giỗ Tổ. Các năm cũ có thể khác thực tế.");
        return lines.join("\n");
      }
      throw bad('action phải là "add", "diff", "weekday", "workdays_add" hoặc "holidays".');
    },
  };
}

// ---------------------------------------------------------------- lunar_convert

function leapMonthOf(year: number): number | null {
  for (let m = 1; m <= 12; m++) if (lunarToSolar(1, m, year, true)) return m;
  return null;
}

const dayLabel = (d: number): string => (d <= 10 ? `mùng ${d}` : String(d));

function lunarConvertTool(): Tool {
  return {
    name: "lunar_convert", kind: "read", readonly: true,
    description: `Convert between solar (dương lịch) and Vietnamese lunar (âm lịch, UTC+7) dates with the astronomical algorithm, years ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR}. Never convert lunar dates yourself. direction 'solar_to_lunar': date = solar dd/mm/yyyy → lunar day/month/year, leap-month flag, Can Chi of day/month/year and zodiac animal. direction 'lunar_to_solar': date = LUNAR dd/mm/yyyy (year = lunar year), leap=true for a leap month (tháng nhuận) → solar date. Invalid lunar dates (e.g. day 30 of a 29-day month, leap month that does not exist) return an error.`,
    parameters: { type: "object", properties: { date: { type: "string", description: "dd/mm/yyyy (solar, or lunar for lunar_to_solar)" }, direction: { type: "string", enum: ["solar_to_lunar", "lunar_to_solar"] }, leap: { type: "boolean", description: "lunar_to_solar: the lunar month is a leap month" } }, required: ["date", "direction"] },
    summarize: (a) => `${a.date ?? ""} (${a.direction === "lunar_to_solar" ? "âm → dương" : "dương → âm"})`,
    async run(_ctx, a) {
      const dir = String(a.direction ?? "").trim().toLowerCase();
      if (dir === "solar_to_lunar") {
        const d = needDate(a.date, "Ngày dương lịch");
        if (d.y < LUNAR_MIN_YEAR || d.y > LUNAR_MAX_YEAR) throw bad(`Chỉ đổi được năm ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR} (nhận ${d.y}).`);
        const l = lunarInfo(d.d, d.m, d.y);
        const leap = leapMonthOf(l.year);
        const monthName = LUNAR_MONTH_NAME[l.month];
        return [
          `Dương lịch: ${wd(d)}`,
          `Âm lịch: ngày ${l.day} tháng ${l.month}${l.leap ? " nhuận" : ""} năm ${l.year} (${dayLabel(l.day)} tháng ${monthName}${l.leap ? " nhuận" : ""})${l.length === 30 ? ", tháng đủ (30 ngày)" : l.length === 29 ? ", tháng thiếu (29 ngày)" : ""}`,
          `Số: ${l.day}/${l.month}/${l.year}${l.leap ? " (tháng nhuận)" : ""}`,
          `Can Chi: ngày ${l.canChiDay}, tháng ${l.canChiMonth}, năm ${l.canChiYear}`,
          `Con giáp (năm âm lịch ${l.year}): ${l.zodiac}`,
          leap ? `Năm âm lịch ${l.year} có tháng ${leap} nhuận.` : `Năm âm lịch ${l.year} không có tháng nhuận.`,
        ].join("\n");
      }
      if (dir === "lunar_to_solar") {
        const raw = a.date;
        if (raw === undefined || raw === null || raw === "") throw bad(`Thiếu ngày âm lịch. ${DATE_HINT}`);
        const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(raw).trim()) ?? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(raw).trim());
        if (!m) throw bad(`Ngày âm lịch không hợp lệ: “${String(raw)}”. Viết dd/mm/yyyy theo lịch âm, vd 10/03/2025 (mùng 10 tháng 3 năm 2025 âm lịch).`);
        const iso = m[1].length === 4;
        const [day, month, year] = iso ? [+m[3], +m[2], +m[1]] : [+m[1], +m[2], +m[3]];
        if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) throw bad(`Chỉ đổi được năm ${LUNAR_MIN_YEAR}–${LUNAR_MAX_YEAR} (nhận ${year}).`);
        if (month < 1 || month > 12 || day < 1 || day > 30) throw bad(`Ngày âm lịch không hợp lệ: ngày 1–30, tháng 1–12 (nhận ${day}/${month}/${year}).`);
        const leap = a.leap === true || String(a.leap).toLowerCase() === "true";
        const s = lunarToSolar(day, month, year, leap);
        if (!s) {
          const lm = leapMonthOf(year);
          if (leap) throw bad(`Năm âm lịch ${year} ${lm ? `chỉ nhuận tháng ${lm}` : "không có tháng nhuận"}, nên không có tháng ${month} nhuận.`);
          throw bad(`Ngày ${day}/${month}/${year} âm lịch không tồn tại (tháng ${month} năm ${year} chỉ có 29 ngày). Hãy dùng ngày 1–29.`);
        }
        const sd: Ymd = { y: s.y, m: s.m, d: s.d };
        const info = lunarInfo(s.d, s.m, s.y);
        return [
          `Âm lịch: ngày ${day} tháng ${month}${leap ? " nhuận" : ""} năm ${year} (${canChiYear(year)}, năm ${zodiacOfYear(year)})`,
          `Dương lịch: ${wd(sd)}`,
          `ISO: ${fmtIso(sd)}`,
          `Can Chi: ngày ${info.canChiDay}, tháng ${info.canChiMonth}`,
        ].join("\n");
      }
      throw bad('direction phải là "solar_to_lunar" hoặc "lunar_to_solar".');
    },
  };
}

// ---------------------------------------------------------------- vn_text

const TEXT_ACTIONS = ["remove_diacritics", "slug", "title_case_name", "split_name", "normalize_spaces", "upper", "lower", "phone", "sort_names"] as const;

function vnTextTool(): Tool {
  return {
    name: "vn_text", kind: "read", readonly: true,
    description: "Vietnamese text utilities done by code (exact, no guessing). action: 'remove_diacritics' (also đ→d), 'slug' (lowercase-hyphen, for file names/URLs), 'title_case_name' (fix capitalisation of full names, one per line), 'split_name' (surname / middle name / given name per line, knows compound surnames like Tôn Thất, Âu Dương), 'normalize_spaces' (collapse spaces, fix punctuation spacing, Unicode NFC), 'upper' / 'lower' (correct for Vietnamese), 'phone' (normalise Vietnamese phone numbers to 0xxx / +84 and name the carrier; one number per line, or separated by ; ,), 'sort_names' (sort a list of names, one per line, by Vietnamese alphabet: given name first, then surname, then middle name; order a ă â b c d đ e ê … and tones). text: the input (several lines allowed).",
    parameters: { type: "object", properties: { action: { type: "string", enum: [...TEXT_ACTIONS] }, text: { type: "string", description: "input text; for names/phones one item per line" } }, required: ["action", "text"] },
    summarize: (a) => `${a.action ?? ""}: ${String(typeof a.text === "string" ? a.text : "").slice(0, 40).replace(/\n/g, " ")}`,
    async run(_ctx, a) {
      const action = String(a.action ?? "").trim().toLowerCase();
      if (!(TEXT_ACTIONS as readonly string[]).includes(action)) throw bad(`action phải là một trong: ${TEXT_ACTIONS.join(", ")}.`);
      const src: string = Array.isArray(a.text) ? a.text.map(String).join("\n") : typeof a.text === "string" ? a.text : "";
      if (!src.trim()) throw bad("Thiếu text (nội dung cần xử lý).");
      if (src.length > 200_000) throw bad("Văn bản quá dài (tối đa 200.000 ký tự).");
      const lines = src.replace(/\r\n?/g, "\n").split("\n");
      switch (action) {
        case "remove_diacritics":
          return removeDiacritics(src);
        case "slug":
          return lines.map((l) => slugify(l)).join("\n");
        case "title_case_name":
          return titleCaseName(src);
        case "normalize_spaces":
          return normalizeSpaces(src);
        case "upper":
          return nfc(src).toUpperCase();
        case "lower":
          return nfc(src).toLowerCase();
        case "split_name":
          return lines.filter((l) => l.trim()).map((l) => {
            const p = splitName(l);
            if (!p.ho && p.ten) return `${l.trim()} → (chỉ có một từ, coi là tên) tên: ${p.ten}`;
            return `${l.trim()} → họ: ${p.ho} | đệm: ${p.dem || "(không)"} | tên: ${p.ten}${p.compound ? " (họ ghép)" : ""}`;
          }).join("\n");
        case "phone": {
          const items = src.split(/[\n;,|]+/).map((s) => s.trim()).filter(Boolean);
          if (items.length > 500) throw bad("Tối đa 500 số mỗi lần.");
          const res = items.map(normalizePhone);
          const ok = res.filter((r) => r.valid).length;
          return res.map(phoneLine).join("\n") + (res.length > 1 ? `\n(${ok}/${res.length} số hợp lệ)` : "");
        }
        case "sort_names": {
          const names = lines.map((l) => l.trim()).filter(Boolean);
          if (names.length > 5000) throw bad("Tối đa 5.000 tên mỗi lần.");
          const sorted = sortNames(names.map((n) => titleCaseKeep(n)));
          return `Đã sắp ${sorted.length} tên (theo tên, rồi họ, rồi tên đệm):\n` + sorted.map((n, i) => `${i + 1}. ${n}`).join("\n");
        }
      }
      return src;
    },
  };
}

/** Giữ nguyên tên người dùng nhập (chỉ gộp khoảng trắng): không tự đổi hoa/thường khi chỉ sắp xếp. */
const titleCaseKeep = (n: string): string => nfc(n).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- calc

function calcTool(): Tool {
  return {
    name: "calc", kind: "read", readonly: true,
    description: "Safe calculator (no code execution). Use it for every arithmetic result you report. Operators + - * / ^ % (percent), parentheses, constant pi, functions sqrt abs round(x; digits) floor ceil min max sum avg (separate arguments with ';'). Percent: '15% của 2.500.000' or '15% of 2500000' = 375000; '2.500.000 + 10%' = 2.750.000 (10% of the left value is added, like a pocket calculator). Numbers may be Vietnamese (1.234.567,89) or plain/international (1234567.89); a lone '1.234' is read as 1234 and '1,234' as 1.234 in locale 'vi' (a note says so). Returns the numeric result and the Vietnamese-formatted result. decimals rounds to that many places (half away from zero).",
    parameters: { type: "object", properties: { expression: S, decimals: { type: "integer", description: "round the result to N decimal places (0-15)" }, locale: { type: "string", enum: ["vi", "en"], description: "vi (default): '.' thousands and ',' decimal; en: ',' thousands and '.' decimal" } }, required: ["expression"] },
    summarize: (a) => String(a.expression ?? "").slice(0, 80),
    async run(_ctx, a) {
      const locale = String(a.locale ?? "vi").toLowerCase();
      if (locale !== "vi" && locale !== "en") throw bad('locale phải là "vi" hoặc "en".');
      let decimals: number | undefined;
      if (a.decimals !== undefined && a.decimals !== null && a.decimals !== "") decimals = int(a.decimals, "decimals", { min: 0, max: 15 });
      let r;
      try {
        r = calculate(String(a.expression ?? ""), { locale });
      } catch (e) {
        if (e instanceof CalcError) throw bad(e.message);
        throw e;
      }
      const v = decimals === undefined ? r.value : roundTo(r.value, decimals);
      const plain = decimals === undefined ? plainNumber(v) : v.toFixed(decimals);
      return [
        `Kết quả: ${plain}`,
        `Dạng Việt Nam: ${formatVn(v, decimals)}`,
        `Biểu thức hiểu là: ${r.shown}`,
        ...r.notes.map((n) => `Lưu ý: ${n}`),
      ].join("\n");
    },
  };
}

// ---------------------------------------------------------------- create_eml

function emlTool(): Tool {
  const pathOf = (a: any): string => String(a.output || `${slugify(String(a.subject ?? "thu")).slice(0, 40) || "thu"}.eml`);
  return {
    name: "create_eml", kind: "edit", readonly: false, pathArg: "output", targetPath: (a) => pathOf(a),
    description: "Create an email DRAFT file (.eml, UTF-8, RFC 5322) that opens in Outlook / Apple Mail / Thunderbird as an unsent draft (X-Unsent: 1) so the user can review and press Send. It NEVER sends anything. to/cc/bcc: lists of addresses ('a@neu.edu.vn' or 'Nguyễn Văn A <a@neu.edu.vn>'). body: plain text. attachments: paths of files in the project folder (max 10 files, 20 MB total); they are embedded as MIME attachments. output: path ending in .eml (default: <subject>.eml). Existing files are never overwritten unless read first.",
    parameters: { type: "object", properties: { to: { type: "array", items: S }, cc: { type: "array", items: S }, bcc: { type: "array", items: S }, subject: S, body: S, attachments: { type: "array", items: S, description: "project file paths to attach" }, output: { type: "string", description: "path ending in .eml" } }, required: ["to", "subject", "body"] },
    summarize: (a) => `${pathOf(a)} → ${listArg(a.to, /[;,]/).slice(0, 3).join(", ")}`,
    async preview(ctx, a) {
      const att = listArg(a.attachments, /[;\n]/);
      return outlinePreview(ctx, pathOf(a), `Thư nháp (không gửi)\nĐến: ${listArg(a.to, /[;,]/).join(", ")}\n${a.cc ? `Cc: ${listArg(a.cc, /[;,]/).join(", ")}\n` : ""}Chủ đề: ${String(a.subject ?? "")}\n${att.length ? `Đính kèm: ${att.join(", ")}\n` : ""}\n${String(a.body ?? "").slice(0, 600)}`);
    },
    async run(ctx, a) {
      const to = mailboxes(a.to, "to");
      if (!to.length) throw bad('Cần ít nhất một người nhận trong to, vd ["a@neu.edu.vn"].');
      const cc = mailboxes(a.cc, "cc");
      const bcc = mailboxes(a.bcc, "bcc");
      const subject = String(a.subject ?? "").replace(/[\r\n]+/g, " ").trim();
      if (!subject) throw bad("Thiếu subject (chủ đề thư).");
      if (typeof a.body !== "string") throw bad("Thiếu body (nội dung thư dạng chữ).");
      const names = listArg(a.attachments, /[;\n]/);
      if (names.length > 10) throw bad("Tối đa 10 tệp đính kèm mỗi thư.");
      const attachments = [];
      let total = 0;
      for (const p of names) {
        const f = await loadBinary(ctx, p, []);
        await guardRead(ctx, f.abs);
        total += f.bytes.length;
        if (total > 20 * 1024 * 1024) throw bad("Tệp đính kèm quá lớn (tối đa 20 MB tổng cộng).");
        attachments.push({ name: basename(f.abs), bytes: f.bytes });
      }
      const rawOut = a.output ? String(a.output) : await freeName(ctx, slugify(subject).slice(0, 40) || "thu", ".eml");
      const { abs, existed } = await prepareWrite(ctx, rawOut, ".eml");
      const bytes = buildEml({ to, cc, bcc, subject, body: a.body, attachments });
      await commit(ctx, abs, bytes, existed);
      return `Đã tạo thư nháp ${relPath(ctx, abs)} (${kb(bytes.length)}) — chưa gửi.\nĐến: ${to.map((m) => m.addr).join(", ")}${cc.length ? `\nCc: ${cc.map((m) => m.addr).join(", ")}` : ""}${bcc.length ? `\nBcc: ${bcc.map((m) => m.addr).join(", ")}` : ""}\nChủ đề: ${subject}\nĐính kèm: ${attachments.length ? attachments.map((x) => x.name).join(", ") : "không"}\nNgười dùng mở tệp bằng Outlook/Mail/Thunderbird để xem lại và tự bấm Gửi.`;
    },
  };
}

// ---------------------------------------------------------------- create_ics

function icsTool(): Tool {
  const pathOf = (a: any): string => String(a.output || `${slugify(String(a.title ?? "su-kien")).slice(0, 40) || "su-kien"}.ics`);
  return {
    name: "create_ics", kind: "edit", readonly: false, pathArg: "output", targetPath: (a) => pathOf(a),
    description: "Create a calendar event file (.ics, iCalendar, time zone Asia/Ho_Chi_Minh) that Outlook / Google Calendar / Apple Calendar import with one click. start/end: 'dd/mm/yyyy HH:mm' (also '8h30', '14:00') or ISO 'yyyy-mm-ddTHH:mm'; date only (or all_day=true) = all-day event, where end is the LAST day. Default length 1 hour. attendees: email addresses (listed in the file; nothing is sent). reminder_minutes: alarm before start. recurrence: daily | weekly | monthly, optionally limited with recurrence_count or recurrence_until (a date). output: path ending in .ics (default: <title>.ics). Existing files are never overwritten unless read first.",
    parameters: {
      type: "object",
      properties: {
        title: S, start: S, end: S, all_day: { type: "boolean" }, location: S, description: S, attendees: { type: "array", items: S }, reminder_minutes: { type: "integer" },
        recurrence: { type: "string", enum: ["daily", "weekly", "monthly"] }, recurrence_count: { type: "integer", description: "number of occurrences" }, recurrence_until: { type: "string", description: "last date of the series" },
        output: { type: "string", description: "path ending in .ics" },
      },
      required: ["title", "start"],
    },
    summarize: (a) => `${a.title ?? ""} (${a.start ?? ""})`,
    async preview(ctx, a) {
      return outlinePreview(ctx, pathOf(a), `Sự kiện: ${String(a.title ?? "")}\nBắt đầu: ${String(a.start ?? "")}${a.end ? `\nKết thúc: ${String(a.end)}` : ""}${a.location ? `\nĐịa điểm: ${String(a.location)}` : ""}${a.recurrence ? `\nLặp: ${String(a.recurrence)}` : ""}`);
    },
    async run(ctx, a) {
      const title = String(a.title ?? "").replace(/[\r\n]+/g, " ").trim();
      if (!title) throw bad("Thiếu title (tên sự kiện).");
      const ex = "vd 15/03/2025 08:30 hoặc 2025-03-15T08:30";
      const start = parseDateTime(a.start);
      if (!start) throw bad(`start không hợp lệ: “${String(a.start ?? "")}”. Dùng ${ex}; chỉ có ngày thì là sự kiện cả ngày.`);
      let end: DateTime | undefined;
      if (a.end !== undefined && a.end !== null && a.end !== "") {
        end = parseDateTime(a.end) ?? undefined;
        if (!end) throw bad(`end không hợp lệ: “${String(a.end)}”. Dùng ${ex}.`);
      }
      const allDay = a.all_day === true || (a.all_day !== false && !start.time);
      if (!allDay && end && !end.time) end = { date: end.date, time: start.time ?? { h: 8, mi: 0 } };
      if (end) {
        const sN = toDays(start.date) * 1440 + (allDay ? 0 : (start.time?.h ?? 8) * 60 + (start.time?.mi ?? 0));
        const eN = toDays(end.date) * 1440 + (allDay ? 0 : (end.time?.h ?? 0) * 60 + (end.time?.mi ?? 0));
        if (eN < sN || (!allDay && eN === sN)) throw bad("end phải sau start (kiểm tra lại ngày giờ kết thúc).");
      }
      let reminder: number | undefined;
      if (a.reminder_minutes !== undefined && a.reminder_minutes !== null && a.reminder_minutes !== "") reminder = int(a.reminder_minutes, "reminder_minutes", { min: 0, max: 40320 });
      const rec = a.recurrence === undefined || a.recurrence === null || a.recurrence === "" ? undefined : String(a.recurrence).toLowerCase();
      if (rec && !["daily", "weekly", "monthly"].includes(rec)) throw bad('recurrence phải là "daily", "weekly" hoặc "monthly".');
      const count = a.recurrence_count !== undefined && a.recurrence_count !== null && a.recurrence_count !== "" ? int(a.recurrence_count, "recurrence_count", { min: 1, max: 1000 }) : undefined;
      const until = a.recurrence_until ? needDate(a.recurrence_until, "recurrence_until") : undefined;
      const attendees = mailboxes(a.attendees, "attendees");
      const built = buildIcs({
        title, start, end, allDay, location: a.location ? String(a.location) : undefined, description: a.description ? String(a.description) : undefined,
        attendees, reminderMinutes: reminder, recurrence: rec as any, recurrenceCount: count, recurrenceUntil: until, prodId: `-//${brandName()}//Work//VI`,
      });
      const rawOut = a.output ? String(a.output) : await freeName(ctx, slugify(title).slice(0, 40) || "su-kien", ".ics");
      const { abs, existed } = await prepareWrite(ctx, rawOut, ".ics");
      const bytes = new TextEncoder().encode(built.text);
      await commit(ctx, abs, bytes, existed);
      const when = allDay ? `cả ngày ${fmtVn(start.date)}${end && toDays(end.date) > toDays(start.date) ? ` đến ${fmtVn(end.date)}` : ""}` : `${fmtVn(start.date)} ${String(start.time?.h ?? 8).padStart(2, "0")}:${String(start.time?.mi ?? 0).padStart(2, "0")} → ${built.endShown}`;
      return `Đã tạo ${relPath(ctx, abs)} (${kb(bytes.length)}): ${title}\nThời gian: ${when} (giờ Việt Nam, UTC+7)${a.location ? `\nĐịa điểm: ${String(a.location)}` : ""}${rec ? `\nLặp: ${rec}${count ? `, ${count} lần` : until ? `, đến ${fmtVn(until)}` : ""}` : ""}${reminder !== undefined ? `\nNhắc trước ${reminder} phút` : ""}${attendees.length ? `\nNgười tham dự: ${attendees.map((m) => m.addr).join(", ")} (chỉ ghi trong tệp; không gửi lời mời)` : ""}\nMở tệp .ics để thêm vào lịch.${!a.all_day && !start.time ? "\n(start không có giờ nên đặt là sự kiện cả ngày.)" : ""}`;
    },
  };
}

// ---------------------------------------------------------------- csv_convert

const DELIM_NAMES: Record<string, string> = { ",": ",", comma: ",", phay: ",", ";": ";", semicolon: ";", "chấm phẩy": ";", tab: "\t", "\\t": "\t", "\t": "\t", "|": "|", pipe: "|" };

function csvTool(): Tool {
  const outOf = (a: any): string => {
    if (a.output) return String(a.output);
    const to = String(a.to ?? "").toLowerCase() === "xlsx" ? ".xlsx" : ".csv";
    const base = String(a.path ?? "tep").replace(/\.[^./\\]+$/, "");
    return to === ".csv" && a.sheet ? `${base}-${slugify(String(a.sheet))}.csv` : base + to;
  };
  return {
    name: "csv_convert", kind: "edit", readonly: false, pathArg: "path", targetPath: (a) => outOf(a),
    description: "Convert between Excel and CSV. to='csv': .xlsx → UTF-8 CSV WITH BOM (so Excel shows Vietnamese correctly); sheet picks the sheet (name or number, default first); delimiter ',' (default), ';' (Vietnamese-locale Excel), 'tab' or '|'; displayed values (dates as dd/mm/yyyy, formulas as results). to='xlsx': .csv/.tsv/.txt → .xlsx; delimiter is auto-detected (, ; tab |) unless given; quoted fields handled; real numbers become numbers, but values with leading zeros (phone numbers, IDs) stay text, dd/mm/yyyy become dates; the file encoding UTF-8/UTF-16/Windows-1258 is detected. output: new path (default: same name with the new extension). Existing files are never overwritten unless read first.",
    parameters: { type: "object", properties: { path: S, output: S, to: { type: "string", enum: ["csv", "xlsx"] }, sheet: { type: "string", description: "csv: sheet to export; xlsx: name of the new sheet" }, delimiter: { type: "string", description: "',' ';' 'tab' or '|'" } }, required: ["path", "to"] },
    summarize: (a) => `${a.path ?? ""} → ${outOf(a)}`,
    async preview(ctx, a) {
      return outlinePreview(ctx, outOf(a), `Chuyển ${String(a.path ?? "")} sang ${String(a.to ?? "").toUpperCase()}${a.delimiter ? ` (phân cách ${String(a.delimiter)})` : ""}.`);
    },
    async run(ctx, a) {
      const to = String(a.to ?? "").trim().toLowerCase();
      if (to !== "csv" && to !== "xlsx") throw bad('to phải là "csv" hoặc "xlsx".');
      let delim: string | undefined;
      if (a.delimiter !== undefined && a.delimiter !== null && a.delimiter !== "") {
        delim = DELIM_NAMES[String(a.delimiter).trim().toLowerCase()] ?? DELIM_NAMES[String(a.delimiter)];
        if (!delim) throw bad('delimiter phải là ",", ";", "tab" hoặc "|".');
      }
      if (to === "csv") {
        const f = await loadBinary(ctx, a.path, [".xlsx", ".xlsm"]);
        await guardRead(ctx, f.abs);
        let grids;
        try {
          grids = await readXlsxGrid(f.bytes, { sheet: a.sheet !== undefined && a.sheet !== "" ? String(a.sheet) : undefined, maxRows: 200_000, maxCols: 500, maxCells: 5_000_000 });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const g = grids[0];
        if (!g) throw new ToolError("File Excel không có sheet nào.");
        const rows: string[][] = [];
        let width = 0;
        for (const r of g.rows) {
          while (rows.length < r.r - 1) rows.push([]);
          let last = r.cells.length;
          while (last > 0 && r.cells[last - 1] === "") last--;
          width = Math.max(width, last);
          rows.push(r.cells.slice(0, last));
        }
        for (const r of rows) while (r.length < width) r.push(""); // mọi dòng cùng số cột
        const d = delim ?? ",";
        const text = toCsv(rows, d, true);
        const { abs, existed } = await prepareWrite(ctx, outOf(a), ".csv");
        const bytes = new TextEncoder().encode(text);
        await commit(ctx, abs, bytes, existed);
        return `Đã tạo ${relPath(ctx, abs)} (${kb(bytes.length)}): sheet “${g.name}”, ${rows.length} hàng, dấu phân cách ${d === "\t" ? "tab" : `“${d}”`}, UTF-8 có BOM.${g.truncated ? "\n⚠ Sheet quá lớn nên chỉ xuất phần đầu." : ""}${grids.length > 1 && !a.sheet ? `\nWorkbook có ${grids.length} sheet; đã xuất sheet đầu. Dùng sheet để chọn sheet khác.` : ""}${d === "," ? "\nGhi chú: nếu Excel (bản tiếng Việt) mở ra một cột, hãy dùng delimiter \";\"." : ""}`;
      }
      const f = await loadBinary(ctx, a.path, [".csv", ".tsv", ".txt"]);
      await guardRead(ctx, f.abs);
      const dec = decodeText(f.bytes);
      const d = delim ?? (extOf(f.abs) === ".tsv" ? "\t" : detectDelimiter(dec.text));
      const table = parseDelimited(dec.text, d);
      if (!table.length) throw new ToolError("Tệp CSV không có dòng dữ liệu nào.");
      if (table.length > 50_000) throw new ToolError(`Tệp có ${table.length} dòng; công cụ này chuyển tối đa 50.000 dòng mỗi lần. Hãy tách tệp.`);
      const cols = Math.max(...table.map((r) => r.length));
      if (cols > 500) throw new ToolError(`Tệp có ${cols} cột (tối đa 500).`);
      const locale = d === "," ? "en" : "vi";
      const rows = table.map((r) => r.map((c) => inferCell(c, locale)));
      const sheetName = String(a.sheet || stemOf(f.abs) || "Sheet1").slice(0, 31).replace(/[\\/?*[\]:]/g, "_");
      let built;
      try {
        built = await createXlsx([{ name: sheetName, rows, header: true, freeze_header: true, autofilter: rows.length > 1 }]);
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      const { abs, existed } = await prepareWrite(ctx, outOf(a), ".xlsx");
      await commit(ctx, abs, built.bytes, existed);
      const nums = rows.reduce((n, r) => n + r.filter((c) => typeof c === "number").length, 0);
      return `Đã tạo ${relPath(ctx, abs)} (${kb(built.bytes.length)}): sheet “${sheetName}”, ${rows.length} hàng × ${cols} cột; dấu phân cách ${d === "\t" ? "tab" : `“${d}”`}${delim ? "" : " (tự nhận)"}; ${nums} ô số.${dec.note ? `\n⚠ ${dec.note}` : ""}\nSố có số 0 đầu (mã, số điện thoại) giữ là chữ; dd/mm/yyyy thành ngày; số đọc theo kiểu ${locale === "vi" ? "Việt (1.234,5)" : "quốc tế (1,234.5)"}. Hãy dùng read_document để kiểm tra lại.`;
    },
  };
}

// ---------------------------------------------------------------- text_diff

const LOOKS_LIKE_FILE = /\.(docx|xlsx|xlsm|pptx|pdf|txt|md|csv|tsv|json|xml|html?|log|rtf)$/i;

interface DiffSource {
  label: string;
  kind: string;
  lines: Line[];
}

async function diffSource(ctx: ToolContext, v: unknown, side: string): Promise<DiffSource> {
  if (typeof v !== "string") throw bad(`Thiếu ${side}: đưa đường dẫn tệp hoặc chuỗi chữ cần so sánh.`);
  const literal = (text: string): DiffSource => ({ label: "văn bản", kind: "chữ", lines: text.replace(/\r\n?/g, "\n").split("\n").map((t, i) => ({ text: t, loc: `dòng ${i + 1}` })).filter((l) => l.text.trim()) });
  const t = v.trim();
  if (!t || t.includes("\n") || t.length > 300) return literal(v);
  let abs: string;
  try {
    abs = await resolveSafe(ctx, t);
  } catch (e) {
    if (LOOKS_LIKE_FILE.test(t)) throw e;
    return literal(v);
  }
  const st = await ctx.env.stat(abs);
  if (!st) {
    if (LOOKS_LIKE_FILE.test(t)) throw new ToolError(`Không có tệp ${t}. Kiểm tra lại đường dẫn của ${side} (tương đối so với thư mục dự án).`, "not_found");
    return literal(v);
  }
  if (st.isDir) throw bad(`${t} là thư mục, không phải tệp.`);
  if (st.size > 25 * 1024 * 1024) throw bad(`${t} quá lớn (giới hạn 25 MB).`);
  await guardRead(ctx, abs);
  const ext = extOf(abs);
  const bytes = await ctx.env.readBytes(abs);
  const rel = relPath(ctx, abs);
  let r;
  try {
    r = ext === ".xlsx" || ext === ".xlsm" || ext === ".docx" || ext === ".pptx" || ext === ".pdf" ? await documentUnits(bytes, ext) : null;
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
  if (!r) {
    let sec;
    try {
      sec = await readDocumentSections(bytes, ext, {});
    } catch (e) {
      throw new ToolError((e as Error).message);
    }
    return { label: rel, kind: sec.kind, lines: sec.sections.map((s) => s.text).join("\n").replace(/\r\n?/g, "\n").split("\n").map((tx, i) => ({ text: tx, loc: `dòng ${i + 1}` })).filter((l) => l.text.trim()) };
  }
  const lines: Line[] = [];
  for (const u of r.units) for (const tx of u.text.split("\n")) if (tx.trim()) lines.push({ text: tx, loc: u.loc });
  return { label: rel, kind: r.kind, lines };
}

const clip = (s: string, n = 220): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function renderChange(c: Change, i: number, mode: string): string {
  const n = `${i + 1}.`;
  if (c.kind === "add") return `${n} THÊM ở B (${c.b.loc}): ${clip(c.b.text)}`;
  if (c.kind === "del") return `${n} XOÁ khỏi A (${c.a.loc}): ${clip(c.a.text)}`;
  if (mode === "lines") return `${n} SỬA A (${c.a.loc}) → B (${c.b.loc})\n   A: ${clip(c.a.text)}\n   B: ${clip(c.b.text)}`;
  const wdiff = wordDiff(c.a.text, c.b.text);
  return `${n} SỬA A (${c.a.loc}) → B (${c.b.loc}): ${clip(wdiff.marked, 400)}`;
}

function textDiffTool(): Tool {
  return {
    name: "text_diff", kind: "read", readonly: true,
    description: "Compare two texts and list what changed (added / removed / edited), with the location (paragraph, line, slide, page or Excel cell) in each. a and b are each either a file path in the project (Word, Excel, PowerPoint, PDF, text/CSV — read the same way as read_document) or the text itself. Differences in spacing are ignored. mode 'words' (default) shows edited paragraphs with inline word changes ([-removed-] {+added+}); 'lines' shows the whole old and new line. max_changes limits the list (default 40, max 200); the totals always cover everything. Use it to check what someone changed between two versions of a document.",
    parameters: { type: "object", properties: { a: { type: "string", description: "original: file path or text" }, b: { type: "string", description: "new version: file path or text" }, mode: { type: "string", enum: ["words", "lines"] }, max_changes: { type: "integer" } }, required: ["a", "b"] },
    summarize: (a) => `${String(a.a ?? "").slice(0, 40)} ↔ ${String(a.b ?? "").slice(0, 40)}`.replace(/\n/g, " "),
    async run(ctx, a) {
      const mode = String(a.mode ?? "words").toLowerCase();
      if (mode !== "words" && mode !== "lines") throw bad('mode phải là "words" hoặc "lines".');
      const max = a.max_changes === undefined || a.max_changes === null || a.max_changes === "" ? 40 : int(a.max_changes, "max_changes", { min: 1, max: 200 });
      const A = await diffSource(ctx, a.a, "a");
      const B = await diffSource(ctx, a.b, "b");
      let r;
      try {
        r = diffLinesDoc(A.lines, B.lines);
      } catch (e) {
        if (e instanceof TooLargeError) throw new ToolError("Hai văn bản quá dài và khác nhau quá nhiều để so sánh một lần. Hãy so sánh từng phần (từng chương/sheet).");
        throw e;
      }
      const head = [
        `So sánh A = ${A.label} (${A.kind}, ${A.lines.length} dòng/đoạn) với B = ${B.label} (${B.kind}, ${B.lines.length} dòng/đoạn)`,
      ];
      if (!r.changes.length) return head.concat("Hai văn bản giống hệt nhau (không tính khoảng trắng thừa và dòng trống).").join("\n");
      const stats = `Thống kê: ${r.modified} sửa, ${r.added} thêm, ${r.removed} xoá, ${r.equal} giữ nguyên · ${r.wordsAdded} từ thêm, ${r.wordsRemoved} từ bớt · giống nhau ${Math.round(r.similarity * 100)}%`;
      const shown = r.changes.slice(0, max).map((c, i) => renderChange(c, i, mode));
      return [...head, stats, ...shown, r.changes.length > max ? `… (còn ${r.changes.length - max} thay đổi nữa; tăng max_changes hoặc so sánh từng phần)` : ""].filter(Boolean).join("\n");
    },
  };
}

// ---------------------------------------------------------------- doc_stats

function docStatsTool(): Tool {
  return {
    name: "doc_stats", kind: "read", readonly: true, pathArg: "path",
    description: "Statistics of a document: words (counted like Word), characters, paragraphs, tables, estimated A4 pages and reading time. Word → also the heading outline; PowerPoint → number of slides and words per slide; Excel → per sheet rows/columns/data cells/formulas; PDF → pages and words per page. Use it instead of guessing lengths (e.g. before promising 'a 2-page report' or checking a word limit).",
    parameters: { type: "object", properties: { path: S }, required: ["path"] },
    summarize: (a) => String(a.path ?? ""),
    async run(ctx, a) {
      const { abs, bytes } = await loadBinary(ctx, a.path, []);
      try {
        return `${relPath(ctx, abs)}\n` + (await documentStats(bytes, extOf(abs)));
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
    },
  };
}

/** Tiện ích văn phòng: vn_number_words, date_calc, lunar_convert, vn_text, calc, create_eml, create_ics, csv_convert, text_diff, doc_stats. (Mỗi công cụ: mô tả tiếng Anh cho mô hình, thông báo lỗi tiếng Việt, kiểm thử riêng — xem AGENTS.md.) */
export function utilTools(_env: Env): Tool[] {
  return [numberWordsTool(), dateCalcTool(), lunarConvertTool(), vnTextTool(), calcTool(), emlTool(), icsTool(), csvTool(), textDiffTool(), docStatsTool()];
}
