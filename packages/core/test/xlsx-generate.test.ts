import { describe, expect, it } from "vitest";
import { MemoryEnv, office } from "../src";
import { makeController } from "./helpers";

const SPEC = {
  count: 200,
  seed: 7,
  columns: [
    { name: "STT", type: "seq" },
    { name: "Mã SV", type: "seq", prefix: "SV", pad: 4, start: 1 },
    { name: "Họ tên", type: "name_vi" },
    { name: "Email", type: "email", from: "Họ tên", domain: "st.neu.edu.vn" },
    { name: "Ngày", type: "date", from: "2026-01-01", to: "2026-12-31" },
    { name: "Điểm", type: "float", min: 0, max: 10, decimals: 1 },
    { name: "Lớp", type: "pick", values: ["K66A", "K66B", "K66C"] },
    { name: "Tổng", type: "formula", template: "=F{row}*2" },
  ],
} as const;

describe("sinh dữ liệu hàng loạt", () => {
  it("sinh đúng số hàng, xác định theo seed, đúng kiểu và đúng phạm vi", () => {
    const a = office.generateRows(SPEC as never, 2);
    const b = office.generateRows(SPEC as never, 2);
    expect(a.length).toBe(200);
    expect(a).toEqual(b);
    expect(a[0].slice(0, 2)).toEqual([1, "SV0001"]);
    expect(a[199][1]).toBe("SV0200");
    expect(a.every((r) => typeof r[2] === "string" && String(r[3]).endsWith("@st.neu.edu.vn"))).toBe(true);
    expect(a.every((r) => /^2026-\d\d-\d\d$/.test(String(r[4])))).toBe(true);
    expect(a.every((r) => typeof r[5] === "number" && r[5] >= 0 && r[5] <= 10)).toBe(true);
    expect(new Set(a.map((r) => r[6])).size).toBeGreaterThan(1);
    expect(a[0][7]).toBe("=F2*2");
    expect(a[199][7]).toBe("=F201*2");
    expect(office.generateRows({ ...SPEC, seed: 8 } as never, 2)).not.toEqual(a);
  });

  it("tên Việt có dấu và email không dấu, không trùng chuỗi rỗng", () => {
    const r = office.generateRows({ count: 30, columns: [{ name: "Tên", type: "name_vi" }, { name: "Mail", type: "email" }] } as never);
    for (const [name, mail] of r) {
      expect(String(name).split(" ").length).toBe(3);
      expect(String(mail)).toMatch(/^[a-z0-9]+@example\.com$/);
    }
  });

  it("từ chối đặc tả sai bằng lời nhắn dễ hiểu", () => {
    expect(() => office.generateRows({ count: 0, columns: [] } as never)).toThrow(/count/);
    expect(() => office.generateRows({ count: 5, columns: [{ name: "x", type: "bogus" }] } as never)).toThrow(/type "bogus"/);
    expect(() => office.generateRows({ count: 99999, columns: [{ name: "x", type: "seq" }] } as never)).toThrow(/count/);
    expect(() => office.generateRows({ count: 5, columns: [{ name: "x", type: "pick" }] } as never)).toThrow(/values/);
  });
});

describe("create_xlsx / xlsx_edit với generate", () => {
  it("một lời gọi ngắn tạo 200 dòng thật và công thức tính đúng", async () => {
    const { c, env } = await makeController(
      [{ calls: [{ name: "create_xlsx", args: { path: "du-lieu.xlsx", sheets: [{ name: "SV", generate: SPEC }] } }] }, { text: "Xong." }],
      { profile: "work", settings: { mode: "bypass" } },
    );
    await c.send("tạo 200 bản ghi");
    const bytes = await (env as MemoryEnv).readBytes("/ws/du-lieu.xlsx");
    const grid = await office.readXlsxGrid(bytes, { maxRows: 300 });
    expect(grid[0].rows.length).toBeGreaterThanOrEqual(201);
    expect(office.sheetRowCount).toBeTypeOf("function");
    expect(await office.sheetRowCount(bytes)).toBe(201);
  });

  it("xlsx_edit append_generate nối thêm đúng sau hàng cuối và công thức trỏ đúng hàng", async () => {
    const seed = await office.createXlsx([{ name: "S", rows: [["A", "B"], [1, 2], [3, 4]] }]);
    const env = new MemoryEnv("/ws");
    await env.writeBytes("/ws/a.xlsx", seed.bytes);
    const { c } = await makeController(
      [
        { calls: [{ name: "read_document", args: { path: "a.xlsx" } }] },
        { calls: [{ name: "xlsx_edit", args: { path: "a.xlsx", save_as: "b.xlsx", append_generate: { count: 3, columns: [{ name: "A", type: "seq", start: 10 }, { name: "B", type: "formula", template: "=A{row}*2" }] } } }] },
        { text: "Xong." },
      ],
      { profile: "work", env, settings: { mode: "bypass" } },
    );
    await c.send("thêm 3 dòng");
    const out = await office.readXlsxGrid(await env.readBytes("/ws/b.xlsx"), { maxRows: 50 });
    const rows = out[0].rows.map((r: any) => r.cells ?? r);
    // công thức =A{row}*2 phải trỏ đúng hàng của chính nó (hàng 4, 5, 6): kết quả 20, 22, 24
    expect(JSON.stringify(rows)).toContain('["10","20"],["11","22"],["12","24"]');
    expect(await office.sheetRowCount(await env.readBytes("/ws/b.xlsx"))).toBe(6);
  });
});
