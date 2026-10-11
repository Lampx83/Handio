import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { lunarToSolar, solarToLunar } from "../src/office/lunar";
import { compareVi, normalizePhone, sortNames } from "../src/office/vn-text";
import { calculate } from "../src/office/vn-calc";
import { numberToWords, parseLocaleNumber } from "../src/office/vn-number";
import { fromDays, toDays } from "../src/office/vn-calendar";

const mk = (seed: Record<string, string> = {}) => {
  const env = new MemoryEnv("/ws", seed);
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  return {
    env,
    ctx,
    tools,
    run: (n: string, a: unknown) => tools.get(n)!.run(ctx, a),
    fail: async (n: string, a: unknown): Promise<string> => {
      try {
        await tools.get(n)!.run(ctx, a);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error(`${n} lẽ ra phải báo lỗi`);
    },
  };
};

const words = async (value: unknown, extra: Record<string, unknown> = {}): Promise<string> => (await mk().run("vn_number_words", { value, ...extra })).split("\n")[0];

describe("công cụ tiện ích: đăng ký", () => {
  it("đủ 10 công cụ, đúng tên, đúng loại (chỉ đọc / tạo tệp)", () => {
    const { tools } = mk();
    const readonly = ["vn_number_words", "date_calc", "lunar_convert", "vn_text", "calc", "text_diff", "doc_stats"];
    const writers = ["create_eml", "create_ics", "csv_convert"];
    for (const n of readonly) {
      expect(tools.get(n), n).toBeTruthy();
      expect(tools.get(n)!.readonly).toBe(true);
      expect(tools.get(n)!.kind).toBe("read");
    }
    for (const n of writers) {
      expect(tools.get(n), n).toBeTruthy();
      expect(tools.get(n)!.readonly).toBe(false);
      expect(tools.get(n)!.kind).toBe("edit");
      expect(tools.get(n)!.targetPath).toBeTypeOf("function");
    }
    for (const t of tools.values()) if (readonly.concat(writers).includes(t.name)) expect((t.parameters as { type: string }).type).toBe("object");
  });
});

describe("vn_number_words", () => {
  const cases: [number | string, string][] = [
    [0, "Không"],
    [1, "Một"],
    [4, "Bốn"],
    [5, "Năm"],
    [10, "Mười"],
    [11, "Mười một"],
    [14, "Mười bốn"],
    [15, "Mười lăm"],
    [20, "Hai mươi"],
    [21, "Hai mươi mốt"],
    [24, "Hai mươi tư"],
    [25, "Hai mươi lăm"],
    [99, "Chín mươi chín"],
    [100, "Một trăm"],
    [101, "Một trăm linh một"],
    [104, "Một trăm linh bốn"],
    [105, "Một trăm linh năm"],
    [110, "Một trăm mười"],
    [115, "Một trăm mười lăm"],
    [1000, "Một nghìn"],
    [1001, "Một nghìn không trăm linh một"],
    [1010, "Một nghìn không trăm mười"],
    [1100, "Một nghìn một trăm"],
    [2015, "Hai nghìn không trăm mười lăm"],
    [21000, "Hai mươi mốt nghìn"],
    [100000, "Một trăm nghìn"],
    [1100000, "Một triệu một trăm nghìn"],
    [1000001, "Một triệu không trăm linh một"],
    [1234567890, "Một tỷ hai trăm ba mươi tư triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi"],
    [5000000001, "Năm tỷ không trăm linh một"],
    [1000000000000, "Một nghìn tỷ"],
    [1234000000000, "Một nghìn hai trăm ba mươi tư tỷ"],
    [1000000000000000, "Một triệu tỷ"],
    [-45, "Âm bốn mươi lăm"],
    ["1.234.567", "Một triệu hai trăm ba mươi tư nghìn năm trăm sáu mươi bảy"],
    ["1.234.567,89", "Một triệu hai trăm ba mươi tư nghìn năm trăm sáu mươi bảy phẩy tám chín"],
    [0.05, "Không phẩy không năm"],
    [2.5, "Hai phẩy năm"],
  ];
  for (const [v, expected] of cases) it(`${v} → ${expected}`, async () => expect(await words(v)).toBe(expected));

  it("tiền Việt: có 'đồng chẵn', viết hoa chữ đầu", async () => {
    expect(await words(1234000, { currency: "vnd" })).toBe("Một triệu hai trăm ba mươi tư nghìn đồng chẵn");
    expect(await words(0, { currency: "vnd" })).toBe("Không đồng chẵn");
    expect(await words(-500000, { currency: "vnd" })).toBe("Âm năm trăm nghìn đồng chẵn");
    expect(await words(15000000, { currency: "VND" })).toBe("Mười lăm triệu đồng chẵn");
  });

  it("style: plain (chữ thường) và south (lẻ, ngàn)", async () => {
    expect(await words(1234000, { currency: "vnd", style: "plain" })).toBe("một triệu hai trăm ba mươi tư nghìn đồng chẵn");
    expect(await words(2105, { style: "south" })).toBe("Hai ngàn một trăm lẻ năm");
  });

  it("USD: đô la Mỹ, xu, chẵn", async () => {
    expect(await words(1500, { currency: "usd" })).toBe("Một nghìn năm trăm đô la Mỹ chẵn");
    expect(await words("12,5", { currency: "usd" })).toBe("Mười hai đô la Mỹ và năm mươi xu");
  });

  it("kèm số viết lại kiểu Việt; số mơ hồ có lưu ý", async () => {
    const out = await mk().run("vn_number_words", { value: 1234567.5, currency: "vnd" });
    expect(out).toContain("Số: 1.234.567,5 đồng");
    expect(out).toContain("phẩy năm đồng");
    expect(await mk().run("vn_number_words", { value: "1,234" })).toContain("Lưu ý");
  });

  it("lỗi tiếng Việt kèm ví dụ", async () => {
    const m = mk();
    expect(await m.fail("vn_number_words", { value: "abc" })).toMatch(/Không đọc được số.*Ví dụ/);
    expect(await m.fail("vn_number_words", { value: 1e16 })).toMatch(/quá lớn/);
    expect(await m.fail("vn_number_words", { value: 5, currency: "eur" })).toMatch(/currency/);
    expect(await m.fail("vn_number_words", { value: "1,2345", currency: "usd" })).toMatch(/2 chữ số thập phân/);
  });

  it("hàm thuần: số âm không có số 0, phân tích kiểu Việt/quốc tế", () => {
    expect(parseLocaleNumber("1.234.567,89")).toMatchObject({ int: "1234567", frac: "89" });
    expect(parseLocaleNumber("1,234,567.89", "en")).toMatchObject({ int: "1234567", frac: "89" });
    expect(parseLocaleNumber("1,234,567.89")).toMatchObject({ int: "1234567", frac: "89" });
    expect(parseLocaleNumber("1.2.3")).toBeNull();
    expect(numberToWords({ neg: true, int: "0", frac: "" }).words).toBe("Không");
  });
});

describe("date_calc", () => {
  it("cộng ngày/tuần/tháng/năm; cuối tháng được lùi về ngày cuối", async () => {
    const { run } = mk();
    expect(await run("date_calc", { action: "add", date: "15/03/2025", amount: 10, unit: "day" })).toContain("= 25/03/2025");
    expect(await run("date_calc", { action: "add", date: "15/03/2025", amount: 2, unit: "week" })).toContain("= 29/03/2025");
    expect(await run("date_calc", { action: "add", date: "31/01/2025", amount: 1, unit: "month" })).toContain("= 28/02/2025");
    expect(await run("date_calc", { action: "add", date: "31/01/2024", months: 1 })).toContain("= 29/02/2024");
    expect(await run("date_calc", { action: "add", date: "29/02/2024", amount: 1, unit: "year" })).toContain("= 28/02/2025");
    expect(await run("date_calc", { action: "add", date: "2025-03-15", amount: -15, unit: "day" })).toContain("= 28/02/2025");
    expect(await run("date_calc", { action: "add", date: "15/03/2025", years: 1, months: 2, days: 3 })).toContain("= 18/05/2026");
  });

  it("thứ trong tuần: các mốc lịch sử đã biết", async () => {
    const { run } = mk();
    expect(await run("date_calc", { action: "weekday", date: "02/09/1945" })).toContain("là Chủ nhật");
    expect(await run("date_calc", { action: "weekday", date: "30/04/1975" })).toContain("là Thứ Tư");
    expect(await run("date_calc", { action: "weekday", date: "01/01/2000" })).toContain("là Thứ Bảy");
    expect(await run("date_calc", { action: "weekday", date: "29/02/2024" })).toContain("là Thứ Năm");
    const w = await run("date_calc", { action: "weekday", date: "10/02/2024" });
    expect(w).toContain("Thứ Bảy");
    expect(w).toContain("Tết Nguyên đán (mùng 1)");
    expect(w).toContain("1/1/2024 âm lịch");
  });

  it("khoảng cách: ngày, tuần, lịch, ngày làm việc (bỏ cuối tuần và lễ)", async () => {
    const { run } = mk();
    // thứ Hai 03/03/2025 → thứ Sáu 14/03/2025, tính cả hai đầu: 12 ngày, 10 ngày làm việc
    const a = await run("date_calc", { action: "diff", date: "03/03/2025", to: "14/03/2025", inclusive: true });
    expect(a).toContain("Số ngày: 12");
    expect(a).toContain("Ngày làm việc: 10");
    // không tính ngày đầu: 11 ngày, 9 ngày làm việc
    const b = await run("date_calc", { action: "diff", date: "03/03/2025", to: "14/03/2025" });
    expect(b).toContain("Số ngày: 11");
    expect(b).toContain("Ngày làm việc: 9");
    // tháng 1/2025: 23 ngày thứ Hai–thứ Sáu, trừ Tết Dương lịch và 4 ngày Tết (28–31/01) = 18
    const jan = await run("date_calc", { action: "diff", date: "01/01/2025", to: "31/01/2025", inclusive: true });
    expect(jan).toContain("Ngày làm việc: 18");
    expect(jan).toContain("5 ngày nghỉ lễ");
    // đảo thứ tự vẫn ra kết quả giống
    expect(await run("date_calc", { action: "diff", date: "14/03/2025", to: "03/03/2025", inclusive: true })).toContain("Ngày làm việc: 10");
    // theo lịch: 15/01/2024 → 20/03/2025 = 1 năm 2 tháng 5 ngày
    expect(await run("date_calc", { action: "diff", date: "15/01/2024", to: "20/03/2025" })).toContain("1 năm 2 tháng 5 ngày");
  });

  it("cộng ngày làm việc: nhảy qua cuối tuần, Tết và nghỉ bù", async () => {
    const { run } = mk();
    expect(await run("date_calc", { action: "workdays_add", date: "07/03/2025", days: 1 })).toContain("= 10/03/2025 (Thứ Hai)");
    expect(await run("date_calc", { action: "workdays_add", date: "24/01/2025", days: 5 })).toContain("= 07/02/2025 (Thứ Sáu)");
    expect(await run("date_calc", { action: "workdays_add", date: "04/02/2025", days: -1 })).toContain("= 27/01/2025 (Thứ Hai)");
    // 30/04 và 01/05/2025 là lễ
    expect(await run("date_calc", { action: "workdays_add", date: "29/04/2025", days: 1 })).toContain("= 02/05/2025 (Thứ Sáu)");
  });

  it("ngày nghỉ lễ chính thức: dương lịch, Tết, Giỗ Tổ, 30/4, 1/5, 2/9, nghỉ bù và lời nhắc đối chiếu", async () => {
    const { run } = mk();
    const y25 = await run("date_calc", { action: "holidays", year: 2025 });
    for (const s of ["01/01/2025", "28/01/2025", "29/01/2025", "31/01/2025", "03/02/2025 (Thứ Hai): Nghỉ bù", "07/04/2025", "30/04/2025", "01/05/2025", "02/09/2025"]) expect(y25).toContain(s);
    expect(y25).toContain("Chính phủ công bố hằng năm");
    const y24 = await run("date_calc", { action: "holidays", year: 2024 });
    for (const s of ["09/02/2024", "10/02/2024", "13/02/2024", "18/04/2024", "02/09/2024"]) expect(y24).toContain(s);
    expect(await run("date_calc", { action: "holidays", year: 2023 })).toContain("29/04/2023 (Thứ Bảy): Giỗ Tổ");
    const y26 = await run("date_calc", { action: "holidays", year: 2026 });
    expect(y26).toContain("17/02/2026 (Thứ Ba): Tết Nguyên đán (mùng 1)");
    expect(y26).toContain("26/04/2026 (Chủ nhật): Giỗ Tổ");
    expect(y26).toContain("27/04/2026 (Thứ Hai): Nghỉ bù");
  });

  it("ngoài khoảng 1900–2199 chỉ tính lễ dương lịch và nói rõ", async () => {
    const { run, fail } = mk();
    const out = await run("date_calc", { action: "diff", date: "01/01/1850", to: "10/01/1850", inclusive: true });
    expect(out).toContain("Ngày làm việc: 7"); // 01–10/01/1850: 8 ngày thứ Hai–thứ Sáu, trừ lễ 1/1
    expect(out).toContain("chỉ tính lễ dương lịch");
    expect(await fail("date_calc", { action: "holidays", year: 1850 })).toMatch(/1900/);
  });

  it("ngày không hợp lệ → lỗi tiếng Việt kèm ví dụ", async () => {
    const { fail } = mk();
    expect(await fail("date_calc", { action: "weekday", date: "31/02/2025" })).toMatch(/không hợp lệ.*dd\/mm\/yyyy/);
    expect(await fail("date_calc", { action: "weekday", date: "hôm qua" })).toMatch(/không hợp lệ/);
    expect(await fail("date_calc", { action: "add", date: "15/03/2025" })).toMatch(/Thiếu lượng/);
    expect(await fail("date_calc", { action: "bay" })).toMatch(/action phải là/);
    expect(await fail("date_calc", { action: "diff", date: "15/03/2025" })).toMatch(/Thiếu ngày/);
  });
});

describe("lunar_convert", () => {
  const solarOf = async (d: number, m: number, y: number, leap = false): Promise<string> => {
    const out = await mk().run("lunar_convert", { date: `${d}/${m}/${y}`, direction: "lunar_to_solar", leap });
    return /Dương lịch: (\d\d\/\d\d\/\d{4})/.exec(out)![1];
  };

  it("mùng 1 Tết Nguyên đán các năm đã biết", async () => {
    const tet: Record<number, string> = {
      1990: "27/01/1990", 1994: "10/02/1994", 2000: "05/02/2000", 2004: "22/01/2004", 2008: "07/02/2008", 2012: "23/01/2012", 2015: "19/02/2015", 2017: "28/01/2017",
      2018: "16/02/2018", 2019: "05/02/2019", 2020: "25/01/2020", 2021: "12/02/2021", 2022: "01/02/2022", 2023: "22/01/2023", 2024: "10/02/2024", 2025: "29/01/2025", 2026: "17/02/2026",
      2027: "06/02/2027", 2028: "26/01/2028", 2029: "13/02/2029", 2030: "02/02/2030",
    };
    for (const [y, expected] of Object.entries(tet)) expect(await solarOf(1, 1, +y), `Tết ${y}`).toBe(expected);
  });

  it("các ngày lễ âm lịch đã biết", async () => {
    expect(await solarOf(10, 3, 2024)).toBe("18/04/2024"); // Giỗ Tổ
    expect(await solarOf(10, 3, 2023)).toBe("29/04/2023");
    expect(await solarOf(10, 3, 2025)).toBe("07/04/2025");
    expect(await solarOf(15, 8, 2024)).toBe("17/09/2024"); // Trung thu
    expect(await solarOf(15, 8, 2023)).toBe("29/09/2023");
    expect(await solarOf(5, 5, 2024)).toBe("10/06/2024"); // Đoan Ngọ
    expect(await solarOf(23, 12, 2024)).toBe("22/01/2025"); // ông Táo
  });

  it("dương → âm: Can Chi, con giáp, tháng đủ/thiếu", async () => {
    const out = await mk().run("lunar_convert", { date: "10/02/2024", direction: "solar_to_lunar" });
    expect(out).toContain("ngày 1 tháng 1 năm 2024");
    expect(out).toContain("Can Chi: ngày Giáp Thìn, tháng Bính Dần, năm Giáp Thìn");
    expect(out).toContain("Rồng");
    expect(out).toContain("không có tháng nhuận");
    const y2000 = await mk().run("lunar_convert", { date: "05/02/2000", direction: "solar_to_lunar" });
    expect(y2000).toContain("ngày 1 tháng 1 năm 2000");
    expect(y2000).toContain("năm Canh Thìn");
    // 01/01/2000 là ngày Mậu Ngọ, 24 tháng 11 năm 1999 âm lịch
    const d = await mk().run("lunar_convert", { date: "01/01/2000", direction: "solar_to_lunar" });
    expect(d).toContain("ngày Mậu Ngọ");
    expect(d).toContain("ngày 25 tháng 11 năm 1999");
    expect(await mk().run("lunar_convert", { date: "28/01/2025", direction: "solar_to_lunar" })).toContain("ngày 29 tháng 12 năm 2024");
  });

  it("tháng nhuận", async () => {
    // năm 2025 nhuận tháng 6; 2023 nhuận tháng 2; 2020 nhuận tháng 4
    expect(await solarOf(1, 6, 2025, true)).toBe("25/07/2025");
    expect(await mk().run("lunar_convert", { date: "25/07/2025", direction: "solar_to_lunar" })).toContain("tháng 6 nhuận");
    for (const [y, m] of [[2025, 6], [2023, 2], [2020, 4], [2017, 6], [2014, 9], [2012, 4], [2009, 5]] as const) {
      expect(lunarToSolar(1, m, y, true), `${y} nhuận tháng ${m}`).not.toBeNull();
      for (let k = 1; k <= 12; k++) if (k !== m) expect(lunarToSolar(1, k, y, true)).toBeNull();
    }
  });

  it("ngày âm không tồn tại → lỗi rõ ràng", async () => {
    const { fail } = mk();
    expect(await fail("lunar_convert", { date: "30/2/2025", direction: "lunar_to_solar" })).toMatch(/không tồn tại.*29 ngày/);
    expect(await fail("lunar_convert", { date: "01/2/2025", direction: "lunar_to_solar", leap: true })).toMatch(/chỉ nhuận tháng 6/);
    expect(await fail("lunar_convert", { date: "01/01/1800", direction: "solar_to_lunar" })).toMatch(/1900/);
    expect(await fail("lunar_convert", { date: "x", direction: "solar_to_lunar" })).toMatch(/không hợp lệ/);
    expect(await fail("lunar_convert", { date: "01/01/2025", direction: "sai" })).toMatch(/direction/);
  });

  it("khứ hồi dương → âm → dương cho 200 ngày ngẫu nhiên (cố định) từ 1920 đến 2150", () => {
    let seed = 20240210;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
    const lo = toDays({ y: 1920, m: 1, d: 1 });
    const hi = toDays({ y: 2150, m: 12, d: 31 });
    for (let i = 0; i < 200; i++) {
      const n = lo + Math.floor(rnd() * (hi - lo));
      const s = fromDays(n);
      const l = solarToLunar(s.d, s.m, s.y);
      expect(l.day).toBeGreaterThanOrEqual(1);
      expect(l.day).toBeLessThanOrEqual(30);
      expect(l.month).toBeGreaterThanOrEqual(1);
      expect(l.month).toBeLessThanOrEqual(12);
      expect(lunarToSolar(l.day, l.month, l.year, l.leap), `${s.d}/${s.m}/${s.y}`).toEqual(s);
    }
  });

  it("ngày liên tiếp: ngày âm tăng dần, sang tháng mới đúng lúc (2023–2026)", () => {
    let prev = solarToLunar(1, 1, 2023);
    for (let n = toDays({ y: 2023, m: 1, d: 2 }); n <= toDays({ y: 2026, m: 12, d: 31 }); n++) {
      const s = fromDays(n);
      const cur = solarToLunar(s.d, s.m, s.y);
      if (cur.day === 1) expect(prev.day).toBeGreaterThanOrEqual(29);
      else expect(cur.day).toBe(prev.day + 1);
      prev = cur;
    }
  });
});

describe("vn_text", () => {
  const t = (action: string, text: string) => mk().run("vn_text", { action, text });

  it("bỏ dấu (kể cả đ/Đ), slug, hoa/thường", async () => {
    expect(await t("remove_diacritics", "Đặng Thị Hương, Trường ĐH Kinh tế Quốc dân")).toBe("Dang Thi Huong, Truong DH Kinh te Quoc dan");
    expect(await t("remove_diacritics", "đ Đ ơ ư")).toBe("d D o u");
    expect(await t("slug", "Đại học Kinh tế Quốc dân - Khoa CNTT!")).toBe("dai-hoc-kinh-te-quoc-dan-khoa-cntt");
    expect(await t("upper", "nguyễn văn đức")).toBe("NGUYỄN VĂN ĐỨC");
    expect(await t("lower", "NGUYỄN VĂN ĐỨC")).toBe("nguyễn văn đức");
  });

  it("chuẩn hoá họ tên và khoảng trắng; hiểu cả chữ dạng tổ hợp (NFD)", async () => {
    expect(await t("title_case_name", "NGUYỄN  văn AN\ntrần thị bích ngọc")).toBe("Nguyễn Văn An\nTrần Thị Bích Ngọc");
    expect(await t("title_case_name", "nguyễn văn an")).toBe("Nguyễn Văn An");
    expect(await t("normalize_spaces", "Xin   chào ,  các bạn . Hết  ")).toBe("Xin chào, các bạn. Hết");
  });

  it("tách họ / đệm / tên, có họ ghép", async () => {
    const out = await t("split_name", "Nguyễn Văn An\nTrần Thị Thu Hà\nTôn Thất Bách\nÂu Dương Lân");
    expect(out).toContain("Nguyễn Văn An → họ: Nguyễn | đệm: Văn | tên: An");
    expect(out).toContain("họ: Trần | đệm: Thị Thu | tên: Hà");
    expect(out).toContain("họ: Tôn Thất | đệm: (không) | tên: Bách (họ ghép)");
    expect(out).toContain("họ: Âu Dương | đệm: (không) | tên: Lân");
  });

  it("sắp xếp theo bảng chữ cái tiếng Việt: tên → họ → đệm; a ă â, thanh điệu, đ sau d", async () => {
    const list = ["Nguyễn Văn Bình", "Trần Thị Ân", "Lê Văn Anh", "Phạm Hoàng Ánh", "Đỗ Văn Dũng", "Dương Minh Đức", "Hoàng Văn An", "Nguyễn Thị Ba", "Vũ Quang Ăn", "Bùi Văn Bảo", "Lý Thị Bé"];
    const out = (await t("sort_names", list.join("\n"))).split("\n").slice(1).map((l) => l.replace(/^\d+\. /, ""));
    // An < Anh < Ánh (ngang < sắc) < Ăn (a < ă) < Ân (ă < â) < Ba < Bảo < Bé (a < e) < Bình (e < i) < Dũng (d) < Đức (d < đ)
    expect(out).toEqual(["Hoàng Văn An", "Lê Văn Anh", "Phạm Hoàng Ánh", "Vũ Quang Ăn", "Trần Thị Ân", "Nguyễn Thị Ba", "Bùi Văn Bảo", "Lý Thị Bé", "Nguyễn Văn Bình", "Đỗ Văn Dũng", "Dương Minh Đức"]);
  });

  it("cùng tên thì xếp theo họ rồi tên đệm", () => {
    expect(sortNames(["Trần Văn An", "Nguyễn Văn An", "Nguyễn Thị An", "Lê Hữu An"])).toEqual(["Lê Hữu An", "Nguyễn Thị An", "Nguyễn Văn An", "Trần Văn An"]);
    expect(compareVi("đ", "d")).toBeGreaterThan(0);
    expect(compareVi("e", "đ")).toBeGreaterThan(0);
    expect(compareVi("ư", "u")).toBeGreaterThan(0);
    expect(compareVi("ơ", "o")).toBeGreaterThan(0);
    expect(compareVi("ô", "ơ")).toBeLessThan(0);
    expect(compareVi("ả", "ã")).toBeLessThan(0); // hỏi < ngã
    expect(compareVi("ạ", "á")).toBeGreaterThan(0); // nặng > sắc
  });

  it("số điện thoại: +84, 0084, đầu số cũ, nhà mạng, cố định, sai", async () => {
    expect(normalizePhone("+84 912 345 678")).toMatchObject({ valid: true, national: "0912 345 678", international: "+84 912 345 678", carrier: "VinaPhone" });
    expect(normalizePhone("0084987654321")).toMatchObject({ valid: true, national: "0987 654 321", carrier: "Viettel" });
    expect(normalizePhone("0903.123.456")).toMatchObject({ valid: true, carrier: "MobiFone" });
    expect(normalizePhone("01626543210")).toMatchObject({ valid: true, national: "0326 543 210", carrier: "Viettel" });
    expect(normalizePhone("(024) 3825 1234")).toMatchObject({ valid: true, type: "cố định", national: "024 3825 1234" });
    expect(normalizePhone("12345").valid).toBe(false);
    const out = await t("phone", "0912345678; 091234");
    expect(out).toContain("0912 345 678");
    expect(out).toContain("KHÔNG HỢP LỆ");
    expect(out).toContain("1/2 số hợp lệ");
  });

  it("lỗi: action lạ, text trống", async () => {
    const { fail } = mk();
    expect(await fail("vn_text", { action: "nope", text: "a" })).toMatch(/action phải là/);
    expect(await fail("vn_text", { action: "slug", text: "  " })).toMatch(/Thiếu text/);
  });
});

describe("calc", () => {
  const c = async (expression: string, extra: Record<string, unknown> = {}) => mk().run("calc", { expression, ...extra });
  const val = (s: string) => Number(/Kết quả: (\S+)/.exec(s)![1]);

  it("số học cơ bản, ưu tiên toán tử, ngoặc, luỹ thừa, số âm", async () => {
    expect(val(await c("1 + 2 * 3"))).toBe(7);
    expect(val(await c("(1 + 2) * 3"))).toBe(9);
    expect(val(await c("2^10"))).toBe(1024);
    expect(val(await c("2^3^2"))).toBe(512);
    expect(val(await c("-2^2"))).toBe(-4);
    expect(val(await c("2^-1"))).toBe(0.5);
    expect(val(await c("10 / 4"))).toBe(2.5);
    expect(val(await c("10 % 3"))).toBe(1);
    expect(val(await c("10 mod 4"))).toBe(2);
    expect(val(await c("7 × 6"))).toBe(42);
    expect(val(await c("2 x 3"))).toBe(6);
  });

  it("số kiểu Việt và quốc tế; kết quả định dạng Việt Nam; không sai số nhị phân", async () => {
    expect(await c("1.234.567,89 + 0,11")).toContain("Dạng Việt Nam: 1.234.568");
    expect(val(await c("1,234,567.89 + 0.11", { locale: "en" }))).toBe(1234568);
    expect(val(await c("0,1 + 0,2"))).toBe(0.3);
    expect(await c("3.14 * 2")).toContain("Kết quả: 6.28");
    expect(await c("1.234.567 * 3")).toContain("Dạng Việt Nam: 3.703.701");
    expect(await c("1234567.891", { locale: "en" })).toContain("Dạng Việt Nam: 1.234.567,891");
  });

  it("phần trăm kiểu văn phòng", async () => {
    expect(val(await c("15% của 2.500.000"))).toBe(375000);
    expect(val(await c("15% of 2500000"))).toBe(375000);
    expect(await c("15% của 2.500.000")).toContain("Dạng Việt Nam: 375.000");
    expect(val(await c("2.500.000 + 10%"))).toBe(2750000);
    expect(val(await c("2.500.000 - 10%"))).toBe(2250000);
    expect(val(await c("50%"))).toBe(0.5);
    expect(val(await c("200 * 5%"))).toBe(10);
  });

  it("hàm: sqrt abs round floor ceil min max sum avg; decimals", async () => {
    expect(val(await c("sqrt(144) + abs(-3)"))).toBe(15);
    expect(val(await c("round(2,567; 2)"))).toBe(2.57);
    expect(val(await c("round(3.14159, 2)"))).toBe(3.14);
    expect(val(await c("round(1,005; 2)"))).toBe(1.01);
    expect(val(await c("floor(2,9) + ceil(2,1)"))).toBe(5);
    expect(val(await c("min(4; 2; 9)"))).toBe(2);
    expect(val(await c("max(4; 2; 9)"))).toBe(9);
    expect(val(await c("sum(1; 2; 3; 4)"))).toBe(10);
    expect(val(await c("avg(1; 2; 3; 4)"))).toBe(2.5);
    expect(await c("pi * 2", { decimals: 3 })).toContain("Kết quả: 6.283");
    expect(await c("10 / 3", { decimals: 2 })).toContain("Dạng Việt Nam: 3,33");
    expect(await c("2 / 3", { decimals: 0 })).toContain("Kết quả: 1");
  });

  it("KHÔNG thực thi mã: chuỗi lạ bị từ chối bằng lỗi tiếng Việt", async () => {
    const { fail } = mk();
    for (const bad of ["process.exit()", "1;alert(1)", "require('fs')", "globalThis", "constructor.constructor('return 1')()", "`1`", "1 + eval('2')", "Math.max(1,2)", "[1,2][0]", "{a:1}", "x = 5", "1 && 2", "fetch('http://x')", "__proto__", "this"]) {
      const msg = await fail("calc", { expression: bad });
      expect(msg, bad).toMatch(/không|Không|Thiếu|chỉ|Chỉ|phải/);
    }
    // và không có tác dụng phụ trên môi trường chạy
    expect((globalThis as { alert?: unknown }).alert).toBeUndefined();
  });

  it("lỗi toán học và cú pháp", async () => {
    const { fail } = mk();
    expect(await fail("calc", { expression: "5/0" })).toMatch(/chia cho 0/);
    expect(await fail("calc", { expression: "sqrt(-1)" })).toMatch(/căn bậc hai/);
    expect(await fail("calc", { expression: "(1+2" })).toMatch(/ngoặc/);
    expect(await fail("calc", { expression: "1 +" })).toMatch(/chưa đầy đủ/);
    expect(await fail("calc", { expression: "" })).toMatch(/Thiếu biểu thức/);
    expect(await fail("calc", { expression: "9^9^9" })).toMatch(/lớn/);
    expect(await fail("calc", { expression: "1".repeat(500) })).toMatch(/quá dài/);
    expect(await fail("calc", { expression: "(".repeat(100) + "1" + ")".repeat(100) })).toMatch(/lồng quá sâu/);
    expect(await fail("calc", { expression: "1", locale: "fr" })).toMatch(/locale/);
  });

  it("số có dấu cách ngăn nghìn và dấu = đầu kiểu Excel", async () => {
    expect(val(await c("1 000 000 + 500 000"))).toBe(1500000);
    expect(val(await c("=2+3"))).toBe(5);
    expect(await c("2 500 000 * 15%")).toContain("Dạng Việt Nam: 375.000");
  });

  it("hàm thuần calculate: ghi chú khi số mơ hồ", () => {
    expect(calculate("1,234 + 1").notes.join(" ")).toMatch(/thập phân/);
    expect(calculate("1.234 + 1").value).toBe(1235);
    expect(calculate("max(1, 2)").value).toBe(2);
    expect(calculate("max(3.5,2)").value).toBe(3.5);
  });
});

const decodeB64 = (s: string): string => new TextDecoder().decode(Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "base64")));

describe("create_eml", () => {
  it("thư nháp có X-Unsent, tiêu đề mã hoá RFC 2047, thân UTF-8", async () => {
    const { run, env } = mk();
    const r = await run("create_eml", { to: ["Nguyễn Văn A <a@neu.edu.vn>", "b@neu.edu.vn"], cc: "c@neu.edu.vn; d@neu.edu.vn", subject: "Thông báo họp Khoa CNTT ngày 15/03/2025 — đề nghị các đồng chí tham dự đầy đủ", body: "Kính gửi các thầy cô,\nXin mời họp lúc 8h30.\nTrân trọng!", output: "thu/moi-hop.eml" });
    expect(r).toContain("chưa gửi");
    const raw = new TextDecoder().decode(await env.readBytes("/ws/thu/moi-hop.eml"));
    expect(raw).toContain("\r\nX-Unsent: 1\r\n".slice(2) === "X-Unsent: 1\r\n" ? "X-Unsent: 1\r\n" : "");
    expect(raw.startsWith("X-Unsent: 1\r\n")).toBe(true);
    expect(raw).toContain("MIME-Version: 1.0\r\n");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8\r\n");
    expect(raw).toMatch(/^To: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@neu\.edu\.vn>,\r\n b@neu\.edu\.vn\r\n/m);
    expect(raw).toMatch(/^Cc: c@neu\.edu\.vn,\r\n d@neu\.edu\.vn\r\n/m);
    // tiêu đề: nhiều từ mã hoá, mỗi dòng ≤ 76 ký tự, giải mã ghép lại đúng
    const head = raw.split("\r\n\r\n")[0];
    const subj = /Subject: ((?:=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=(?:\r\n )?)+)/.exec(head)![1];
    const decoded = subj.split(/\r\n /).map((w) => decodeB64(/=\?UTF-8\?B\?(.+)\?=/.exec(w)![1])).join("");
    expect(decoded).toBe("Thông báo họp Khoa CNTT ngày 15/03/2025 — đề nghị các đồng chí tham dự đầy đủ");
    for (const l of head.split("\r\n")) expect(l.length).toBeLessThanOrEqual(76);
    const body = raw.split("\r\n\r\n")[1];
    expect(decodeB64(body)).toBe("Kính gửi các thầy cô,\r\nXin mời họp lúc 8h30.\r\nTrân trọng!");
  });

  it("đính kèm tệp trong dự án → multipart/mixed, tên tệp tiếng Việt có filename*", async () => {
    const m = mk();
    await m.env.writeBytes("/ws/Báo cáo quý 1.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 250, 251]));
    await m.env.writeBytes("/ws/so-lieu.csv", new TextEncoder().encode("a,b\n1,2\n"));
    await m.run("create_eml", { to: ["a@neu.edu.vn"], subject: "Gửi báo cáo", body: "Đính kèm.", attachments: ["Báo cáo quý 1.pdf", "so-lieu.csv"], output: "gui.eml" });
    const raw = new TextDecoder().decode(await m.env.readBytes("/ws/gui.eml"));
    const bnd = /boundary="([^"]+)"/.exec(raw)![1];
    expect(raw).toContain("Content-Type: multipart/mixed;");
    expect(raw.split(`--${bnd}\r\n`).length - 1).toBe(3);
    expect(raw.trimEnd().endsWith(`--${bnd}--`)).toBe(true);
    expect(raw).toContain("Content-Type: application/pdf; name=");
    expect(raw).toContain("filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20qu%C3%BD%201.pdf");
    expect(raw).toContain("Content-Type: text/csv;");
    const pdfPart = raw.split(`--${bnd}\r\n`)[2];
    expect(decodeB64(pdfPart.split("\r\n\r\n")[1].split("\r\n--")[0]).startsWith("%PDF")).toBe(true);
  });

  it("không có đính kèm → không multipart; tên mặc định từ chủ đề; không ghi đè", async () => {
    const m = mk();
    const r = await m.run("create_eml", { to: "a@neu.edu.vn", subject: "Nhắc việc", body: "x" });
    expect(r).toContain("nhac-viec.eml");
    expect(new TextDecoder().decode(await m.env.readBytes("/ws/nhac-viec.eml"))).not.toContain("multipart");
    const r2 = await m.run("create_eml", { to: "a@neu.edu.vn", subject: "Nhắc việc", body: "y" });
    expect(r2).toContain("nhac-viec-2.eml");
    // tệp có sẵn của người dùng (chưa đọc) không bị ghi đè
    await m.env.writeBytes("/ws/co-san.eml", new TextEncoder().encode("của người dùng"));
    expect(await m.fail("create_eml", { to: "a@neu.edu.vn", subject: "Nhắc việc", body: "z", output: "co-san.eml" })).toMatch(/đã tồn tại/);
    expect(new TextDecoder().decode(await m.env.readBytes("/ws/co-san.eml"))).toBe("của người dùng");
  });

  it("tên hiển thị có dấu phẩy trong ngoặc kép; nhiều người nhận trong một chuỗi", async () => {
    const m = mk();
    await m.run("create_eml", { to: '"Nguyễn, Văn A" <a@neu.edu.vn>; b@neu.edu.vn, c@neu.edu.vn', subject: "x", body: "y", output: "q.eml" });
    const raw = new TextDecoder().decode(await m.env.readBytes("/ws/q.eml"));
    expect(raw).toContain("b@neu.edu.vn");
    expect(raw).toContain("c@neu.edu.vn");
    expect(raw.split("\r\n\r\n")[0].match(/@/g)!.length).toBe(3);
  });

  it("kiểm tra đầu vào: email sai, đuôi sai, ngoài dự án, tệp nhạy cảm, chèn header", async () => {
    const m = mk({ ".env": "SECRET=1", "ok.txt": "ok" });
    expect(await m.fail("create_eml", { to: ["khong-phai-email"], subject: "x", body: "y" })).toMatch(/Địa chỉ email không hợp lệ.*Ví dụ/);
    expect(await m.fail("create_eml", { to: [], subject: "x", body: "y" })).toMatch(/ít nhất một người nhận/);
    expect(await m.fail("create_eml", { to: ["a@b.vn"], subject: "", body: "y" })).toMatch(/Thiếu subject/);
    expect(await m.fail("create_eml", { to: ["a@b.vn"], subject: "x", body: "y", output: "t.txt" })).toMatch(/\.eml/);
    expect(await m.fail("create_eml", { to: ["a@b.vn"], subject: "x", body: "y", output: "/etc/t.eml" })).toMatch(/ngoài thư mục dự án/);
    expect(await m.fail("create_eml", { to: ["a@b.vn"], subject: "x", body: "y", attachments: [".env"] })).toMatch(/khoá\/mật khẩu/);
    expect(await m.fail("create_eml", { to: ["a@b.vn"], subject: "x", body: "y", attachments: ["khong-co.pdf"] })).toMatch(/Không có file/);
    // xuống dòng trong tiêu đề không chèn được header lạ
    await m.run("create_eml", { to: ["a@b.vn"], subject: "Chào\r\nBcc: ke-xau@x.vn", body: "y", output: "inj.eml" });
    const raw = new TextDecoder().decode(await m.env.readBytes("/ws/inj.eml"));
    expect(raw.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });
});

describe("create_ics", () => {
  const read = async (m: ReturnType<typeof mk>, p: string): Promise<string> => new TextDecoder().decode(await m.env.readBytes("/ws/" + p));

  it("sự kiện có giờ: TZID Asia/Ho_Chi_Minh, VTIMEZONE, CRLF, UID ổn định", async () => {
    const m = mk();
    await m.run("create_ics", { title: "Họp giao ban Khoa", start: "15/03/2025 08:30", end: "15/03/2025 10:00", location: "Phòng 301, nhà A1", description: "Nội dung: báo cáo; kế hoạch, đề xuất", output: "hop.ics" });
    const ics = await read(m, "hop.ics");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Asia/Ho_Chi_Minh\r\n");
    expect(ics).toContain("DTSTART;TZID=Asia/Ho_Chi_Minh:20250315T083000\r\n");
    expect(ics).toContain("DTEND;TZID=Asia/Ho_Chi_Minh:20250315T100000\r\n");
    expect(ics).toContain("SUMMARY:Họp giao ban Khoa\r\n");
    expect(ics).toContain("LOCATION:Phòng 301\\, nhà A1\r\n");
    expect(ics).toContain("DESCRIPTION:Nội dung: báo cáo\\; kế hoạch\\, đề xuất\r\n");
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const uid = /UID:(\S+)\r\n/.exec(ics)![1];
    await m.run("create_ics", { title: "Họp giao ban Khoa", start: "15/03/2025 08:30", end: "15/03/2025 10:00", location: "Phòng 301, nhà A1", description: "Nội dung: báo cáo; kế hoạch, đề xuất", output: "hop2.ics" });
    expect(/UID:(\S+)\r\n/.exec(await read(m, "hop2.ics"))![1]).toBe(uid);
    await m.run("create_ics", { title: "Họp khác", start: "15/03/2025 08:30", output: "hop3.ics" });
    expect(/UID:(\S+)\r\n/.exec(await read(m, "hop3.ics"))![1]).not.toBe(uid);
  });

  it("mặc định 1 giờ; hiểu 8h30 / 14:00; qua nửa đêm", async () => {
    const m = mk();
    await m.run("create_ics", { title: "A", start: "2025-03-15T23:30", output: "a.ics" });
    expect(await read(m, "a.ics")).toContain("DTEND;TZID=Asia/Ho_Chi_Minh:20250316T003000");
    await m.run("create_ics", { title: "B", start: "15/03/2025 8h30", end: "15/03/2025 14:00", output: "b.ics" });
    const b = await read(m, "b.ics");
    expect(b).toContain("DTSTART;TZID=Asia/Ho_Chi_Minh:20250315T083000");
    expect(b).toContain("DTEND;TZID=Asia/Ho_Chi_Minh:20250315T140000");
    await m.run("create_ics", { title: "C", start: "15/03/2025 2h30 chiều", output: "c.ics" });
    expect(await read(m, "c.ics")).toContain("DTSTART;TZID=Asia/Ho_Chi_Minh:20250315T143000");
  });

  it("cả ngày: DTEND là ngày kế tiếp (không bao gồm); nhiều ngày", async () => {
    const m = mk();
    await m.run("create_ics", { title: "Nghỉ lễ", start: "30/04/2025", all_day: true, output: "n.ics" });
    const n = await read(m, "n.ics");
    expect(n).toContain("DTSTART;VALUE=DATE:20250430\r\n");
    expect(n).toContain("DTEND;VALUE=DATE:20250501\r\n");
    expect(n).not.toContain("VTIMEZONE");
    await m.run("create_ics", { title: "Hội nghị", start: "2025-12-30", end: "2026-01-02", output: "h.ics" });
    const h = await read(m, "h.ics");
    expect(h).toContain("DTSTART;VALUE=DATE:20251230");
    expect(h).toContain("DTEND;VALUE=DATE:20260103");
  });

  it("nhắc việc, lặp lại, người tham dự", async () => {
    const m = mk();
    await m.run("create_ics", { title: "Sinh hoạt chi bộ", start: "05/04/2025 14:00", reminder_minutes: 30, recurrence: "weekly", recurrence_count: 10, attendees: ["Trần Thị B <b@neu.edu.vn>", "c@neu.edu.vn"], output: "r.ics" });
    const r = await read(m, "r.ics");
    expect(r).toContain("RRULE:FREQ=WEEKLY;COUNT=10\r\n");
    expect(r).toContain("BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Sinh hoạt chi bộ\r\nTRIGGER:-PT30M\r\nEND:VALARM\r\n");
    expect(r.replace(/\r\n /g, "")).toMatch(/ATTENDEE;CN="Trần Thị B";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:b@neu\.edu\.vn\r\n/);
    expect(r).toContain("mailto:c@neu.edu.vn");
    await m.run("create_ics", { title: "Hằng tháng", start: "05/04/2025 14:00", recurrence: "monthly", recurrence_until: "05/12/2025", output: "r2.ics" });
    expect(await read(m, "r2.ics")).toContain("RRULE:FREQ=MONTHLY;UNTIL=20251205T165959Z");
  });

  it("gấp dòng 75 octet, không cắt giữa ký tự UTF-8, ghép lại đúng nội dung", async () => {
    const m = mk();
    const long = "Kính mời các thầy cô tham dự buổi hội thảo khoa học về chuyển đổi số trong giáo dục đại học tại Trường Đại học Kinh tế Quốc dân, Hà Nội. ".repeat(3).trim();
    await m.run("create_ics", { title: "Hội thảo", start: "20/05/2025 08:00", description: long, output: "long.ics" });
    const ics = await read(m, "long.ics");
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) expect(enc.encode(line).length, line).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:" + long.replace(/,/g, "\\,"));
    expect(ics).not.toContain("�");
  });

  it("lỗi: ngày sai, end trước start, tên tệp, ghi đè", async () => {
    const m = mk();
    expect(await m.fail("create_ics", { title: "x", start: "32/13/2025" })).toMatch(/start không hợp lệ.*vd/);
    expect(await m.fail("create_ics", { title: "x", start: "15/03/2025 10:00", end: "15/03/2025 09:00" })).toMatch(/end phải sau start/);
    expect(await m.fail("create_ics", { title: "", start: "15/03/2025" })).toMatch(/Thiếu title/);
    expect(await m.fail("create_ics", { title: "x", start: "15/03/2025", recurrence: "yearly" })).toMatch(/recurrence/);
    expect(await m.fail("create_ics", { title: "x", start: "15/03/2025", output: "a.txt" })).toMatch(/\.ics/);
    await m.env.writeBytes("/ws/ok.ics", new TextEncoder().encode("của người dùng"));
    expect(await m.fail("create_ics", { title: "y", start: "16/03/2025", output: "ok.ics" })).toMatch(/đã tồn tại/);
  });
});

describe("csv_convert", () => {
  it("xlsx → csv: UTF-8 có BOM, tiếng Việt, ngày, ô có dấu phẩy/ngoặc kép/xuống dòng; chọn sheet", async () => {
    const m = mk();
    await m.run("create_xlsx", {
      path: "ds.xlsx",
      sheets: [
        { name: "Danh sách", rows: [["Họ tên", "Điểm", "Ngày sinh", "Ghi chú"], ["Nguyễn Văn An", 8.5, "2003-05-20", 'Khá, "giỏi" môn Toán'], ["Trần Thị Bích", 9, "2002-12-01", "Dòng 1\nDòng 2"]] },
        { name: "Phụ", rows: [["x"], [1]] },
      ],
    });
    await m.run("csv_convert", { path: "ds.xlsx", to: "csv" });
    const bytes = await m.env.readBytes("/ws/ds.csv");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.subarray(3));
    expect(text).toBe('Họ tên,Điểm,Ngày sinh,Ghi chú\r\nNguyễn Văn An,8.5,20/05/2003,"Khá, ""giỏi"" môn Toán"\r\nTrần Thị Bích,9,01/12/2002,"Dòng 1\nDòng 2"\r\n');
    await m.run("csv_convert", { path: "ds.xlsx", to: "csv", sheet: "Phụ", output: "phu.csv", delimiter: ";" });
    expect(new TextDecoder().decode((await m.env.readBytes("/ws/phu.csv")).subarray(3))).toBe("x\r\n1\r\n");
    await m.run("csv_convert", { path: "ds.xlsx", to: "csv", output: "ds-semi.csv", delimiter: "tab" });
    expect(new TextDecoder().decode((await m.env.readBytes("/ws/ds-semi.csv")).subarray(3))).toContain("Họ tên\tĐiểm\tNgày sinh");
  });

  it("csv → xlsx: đoán dấu ;, số Việt thành số thật, số 0 đầu giữ chữ, ngày thành ngày, '=' không thành công thức", async () => {
    const m = mk();
    const csv = '﻿Mã;Họ tên;Lương;SĐT;Ngày;Ghi chú\r\n001;Nguyễn Văn An;"1.234.567,5";0912345678;20/05/2003;"=SUM(1;2)"\r\n002;"Trần, Thị ""Bích""";2000000;+84912345678;31/02/2003;\'abc\r\n';
    await m.env.writeBytes("/ws/nv.csv", new TextEncoder().encode(csv));
    const r = await m.run("csv_convert", { path: "nv.csv", to: "xlsx" });
    expect(r).toContain("dấu phân cách “;” (tự nhận)");
    const grids = await office.readXlsxGrid(await m.env.readBytes("/ws/nv.xlsx"), {});
    const g = grids[0];
    expect(g.name).toBe("nv");
    expect(g.rows[0].cells).toEqual(["Mã", "Họ tên", "Lương", "SĐT", "Ngày", "Ghi chú"]);
    expect(g.rows[1].cells).toEqual(["001", "Nguyễn Văn An", "1234567.5", "0912345678", "20/05/2003", "=SUM(1;2)"]);
    expect(g.rows[2].cells).toEqual(["002", 'Trần, Thị "Bích"', "2000000", "+84912345678", "31/02/2003", "'abc"]);
    // kiểu ô thật: lương là số, mã/SĐT là chữ
    const ExcelJS: any = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await m.env.readBytes("/ws/nv.xlsx"));
    const ws = wb.worksheets[0];
    expect(typeof ws.getCell("C2").value).toBe("number");
    expect(ws.getCell("C2").value).toBe(1234567.5);
    expect(typeof ws.getCell("A2").value).toBe("string");
    expect(typeof ws.getCell("D2").value).toBe("string");
    expect(ws.getCell("E2").value instanceof Date).toBe(true);
    expect(typeof ws.getCell("F2").value).toBe("string"); // không phải công thức
    expect(typeof ws.getCell("E3").value).toBe("string"); // 31/02 không phải ngày
  });

  it("khứ hồi csv → xlsx → csv giữ nguyên nội dung (dấu phẩy, tiếng Việt, ô trống)", async () => {
    const m = mk();
    const csv = 'Tên,Số lượng,Đơn giá,Mô tả\r\nBút bi,10,3500,"Loại ""Thiên Long"", xanh"\r\nSổ tay,5,12000.5,\r\nGiấy A4,,45000,"2 dòng\nthứ hai"\r\n';
    await m.env.writeBytes("/ws/vp.csv", new TextEncoder().encode("﻿" + csv));
    await m.run("csv_convert", { path: "vp.csv", to: "xlsx", output: "vp.xlsx" });
    await m.run("csv_convert", { path: "vp.xlsx", to: "csv", output: "vp2.csv" });
    const back = new TextDecoder().decode((await m.env.readBytes("/ws/vp2.csv")).subarray(3));
    expect(back).toBe(csv);
  });

  it("tệp UTF-16 và Windows-1258 được nhận; lỗi định dạng; giới hạn", async () => {
    const m = mk();
    const u16 = new Uint8Array([0xff, 0xfe, ...[..."Tên\tTuổi\r\nAn\t20\r\n"].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    await m.env.writeBytes("/ws/u16.txt", u16);
    await m.run("csv_convert", { path: "u16.txt", to: "xlsx", output: "u16.xlsx" });
    const g = (await office.readXlsxGrid(await m.env.readBytes("/ws/u16.xlsx"), {}))[0];
    expect(g.rows[0].cells).toEqual(["Tên", "Tuổi"]);
    expect(g.rows[1].cells).toEqual(["An", "20"]);
    expect(await m.fail("csv_convert", { path: "u16.txt", to: "csv" })).toMatch(/\.xlsx/);
    expect(await m.fail("csv_convert", { path: "vp-khong-co.xlsx", to: "csv" })).toMatch(/Không có file/);
    expect(await m.fail("csv_convert", { path: "u16.txt", to: "pdf" })).toMatch(/to phải là/);
    expect(await m.fail("csv_convert", { path: "u16.txt", to: "xlsx", delimiter: "x" })).toMatch(/delimiter/);
    await m.env.writeBytes("/ws/rong.csv", new TextEncoder().encode(""));
    expect(await m.fail("csv_convert", { path: "rong.csv", to: "xlsx" })).toMatch(/không có dòng/);
    await m.env.writeBytes("/ws/x.xlsx", new Uint8Array([1, 2, 3]));
    expect(await m.fail("csv_convert", { path: "u16.txt", to: "xlsx", output: "x.xlsx" })).toMatch(/đã tồn tại/);
  });
});

describe("text_diff", () => {
  it("hai chuỗi: thêm/xoá/sửa, kèm vị trí dòng và thống kê", async () => {
    const { run } = mk();
    const a = "Điều 1. Phạm vi\nQuy chế này áp dụng cho sinh viên.\nĐiều 2. Đối tượng\nTất cả sinh viên chính quy.";
    const b = "Điều 1. Phạm vi\nQuy chế này áp dụng cho sinh viên và học viên.\nĐiều 2. Đối tượng\nTất cả sinh viên chính quy.\nĐiều 3. Hiệu lực";
    const out = await run("text_diff", { a, b });
    expect(out).toContain("1 sửa, 1 thêm, 0 xoá, 3 giữ nguyên");
    expect(out).toContain("SỬA A (dòng 2) → B (dòng 2)");
    expect(out).toContain("sinh {+viên và học+} viên.");
    expect(out).toContain("THÊM ở B (dòng 5): Điều 3. Hiệu lực");
  });

  it("giống hệt (bỏ qua khoảng trắng thừa); chế độ lines hiện cả dòng cũ/mới; max_changes", async () => {
    const { run } = mk();
    expect(await run("text_diff", { a: "một  hai\nba", b: "một hai \n\n ba" })).toContain("giống hệt nhau");
    const out = await run("text_diff", { a: "xin chào các bạn", b: "xin chào các em", mode: "lines" });
    expect(out).toContain("A: xin chào các bạn");
    expect(out).toContain("B: xin chào các em");
    const many = Array.from({ length: 30 }, (_, i) => `dòng ${i}`).join("\n");
    const out2 = await run("text_diff", { a: many, b: "", max_changes: 5 });
    expect(out2).toContain("30 xoá");
    expect(out2).toContain("còn 25 thay đổi nữa");
  });

  it("so sánh hai tệp Word: chỉ ra đoạn đã sửa/thêm", async () => {
    const m = mk();
    await m.run("create_docx", { path: "v1.docx", content: "# QUY CHẾ\n\nĐiều 1. Quy chế áp dụng cho sinh viên.\n\nĐiều 2. Mức phạt là 100.000 đồng." });
    await m.run("create_docx", { path: "v2.docx", content: "# QUY CHẾ\n\nĐiều 1. Quy chế áp dụng cho sinh viên.\n\nĐiều 2. Mức phạt là 200.000 đồng.\n\nĐiều 3. Hiệu lực từ 01/09." });
    const out = await m.run("text_diff", { a: "v1.docx", b: "v2.docx" });
    expect(out).toContain("A = v1.docx (Word");
    expect(out).toContain("[-100.000-] {+200.000+}");
    expect(out).toMatch(/THÊM ở B \(đoạn \d+\): Điều 3\. Hiệu lực/);
    expect(out).toMatch(/SỬA A \(đoạn \d+\) → B \(đoạn \d+\)/);
  });

  it("so sánh hai bảng Excel: vị trí là ô", async () => {
    const m = mk();
    await m.run("create_xlsx", { path: "a.xlsx", sheets: [{ name: "S", rows: [["Tên", "Điểm"], ["An", 7], ["Bình", 8]] }] });
    await m.run("create_xlsx", { path: "b.xlsx", sheets: [{ name: "S", rows: [["Tên", "Điểm"], ["An", 7], ["Bình", 9]] }] });
    const out = await m.run("text_diff", { a: "a.xlsx", b: "b.xlsx" });
    expect(out).toContain("1 sửa");
    expect(out).toContain("S!A3");
    expect(out).toContain("{+9+}");
  });

  it("lỗi: tệp không có, thư mục, tệp nhạy cảm, thiếu tham số", async () => {
    const m = mk({ ".env": "KEY=1", "d/x.txt": "x" });
    expect(await m.fail("text_diff", { a: "khong-co.docx", b: "x" })).toMatch(/Không có tệp khong-co\.docx/);
    expect(await m.fail("text_diff", { a: ".env", b: "x" })).toMatch(/khoá\/mật khẩu/);
    expect(await m.fail("text_diff", { a: "d", b: "x" })).toMatch(/thư mục/);
    expect(await m.fail("text_diff", { b: "x" })).toMatch(/Thiếu a/);
    expect(await m.fail("text_diff", { a: "x", b: "y", mode: "z" })).toMatch(/mode/);
  });
});

describe("doc_stats", () => {
  it("Word: số từ, đoạn, bảng, ước lượng trang, dàn ý", async () => {
    const m = mk();
    const para = "Một hai ba bốn năm sáu bảy tám chín mười.";
    await m.run("create_docx", { path: "bc.docx", content: `# Báo cáo\n\n## Mở đầu\n\n${para}\n\n## Nội dung\n\n${para}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\n- Ý một\n- Ý hai` });
    const out = await m.run("doc_stats", { path: "bc.docx" });
    expect(out).toContain("[Word]");
    expect(out).toContain("Số từ: ");
    expect(out).toContain("Bảng: 1 (2 dòng dữ liệu)");
    expect(out).toContain("Số trang A4 ước lượng: ~1");
    expect(out).toContain("Dàn ý");
    expect(out).toMatch(/Báo cáo\n\s+Mở đầu\n\s+Nội dung/);
    // đếm từ chính xác: 10 + 10 + (A B 1 2 3 4 = 6) + (Ý một Ý hai = 4) + tiêu đề (Báo cáo, Mở đầu, Nội dung = 2+2+2)
    const words = Number(/Số từ: (\d[\d.]*)/.exec(out)![1].replace(/\./g, ""));
    expect(words).toBe(10 + 10 + 6 + 4 + 6);
  });

  it("Word dài: ước lượng trang tăng theo số từ", async () => {
    const m = mk();
    const para = Array.from({ length: 100 }, (_, i) => `từ${i}`).join(" ");
    await m.run("create_docx", { path: "dai.docx", content: Array.from({ length: 20 }, () => para).join("\n\n") });
    const out = await m.run("doc_stats", { path: "dai.docx" });
    expect(out).toContain("Số từ: 2.000");
    expect(out).toContain("Số trang A4 ước lượng: ~5");
    expect(out).toContain("khoảng 10 phút");
  });

  it("PowerPoint: số slide và số chữ mỗi slide", async () => {
    const m = mk();
    await m.run("create_pptx", { path: "tt.pptx", content: "# Tiêu đề bìa\nPhụ đề\n\n---\n\n## Một\n- a b c\n- d e\n\n---\n\n## Hai\n- x y z w", auto: false });
    const out = await m.run("doc_stats", { path: "tt.pptx" });
    expect(out).toContain("[PowerPoint]");
    expect(out).toContain("Số slide: 3");
    expect(out).toMatch(/Slide 2: Một — 6 từ/);
    expect(out).toMatch(/Slide 3: Hai — 5 từ/);
  });

  it("Excel: từng sheet có số hàng, cột, công thức", async () => {
    const m = mk();
    await m.run("create_xlsx", { path: "t.xlsx", sheets: [{ name: "Điểm", rows: [["Tên", "A", "B", "TB"], ["An", 7, 9, "=AVERAGE(B2:C2)"], ["Bình", 5, 6, "=AVERAGE(B3:C3)"]] }, { name: "Ghi chú", rows: [["x"]] }] });
    const out = await m.run("doc_stats", { path: "t.xlsx" });
    expect(out).toContain("[Excel]");
    expect(out).toContain("Số sheet: 2");
    expect(out).toContain("Sheet “Điểm”: 3 hàng × 4 cột · 12 ô có dữ liệu (4 ô số) · 2 công thức");
    expect(out).toContain("Sheet “Ghi chú”: 1 hàng × 1 cột");
  });

  it("tệp văn bản; lỗi: không có, thư mục, định dạng cũ", async () => {
    const m = mk({ "a.txt": "một hai ba\nbốn năm\n", "d/x.txt": "x" });
    const out = await m.run("doc_stats", { path: "a.txt" });
    expect(out).toContain("Số từ: 5");
    expect(await m.fail("doc_stats", { path: "khong-co.docx" })).toMatch(/Không có file/);
    expect(await m.fail("doc_stats", { path: "d" })).toMatch(/thư mục/);
    await m.env.writeBytes("/ws/cu.doc", new Uint8Array([1, 2, 3]));
    expect(await m.fail("doc_stats", { path: "cu.doc" })).toMatch(/Định dạng cũ/);
  });
});
