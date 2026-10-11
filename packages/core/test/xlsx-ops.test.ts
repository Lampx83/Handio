import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { shiftFormula } from "../src/office/xlsx-ops";

const mk = async (rows: unknown[][], extra: { name: string; rows: unknown[][] }[] = []) => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  const run = (n: string, a: unknown) => tools.get(n)!.run(ctx, a);
  await run("create_xlsx", { path: "d.xlsx", sheets: [{ name: "Điểm", rows }, ...extra] });
  await run("read_document", { path: "d.xlsx" });
  const sheet = async (name = "Điểm", p = "d.xlsx") => {
    const wb = new (await import("exceljs")).Workbook();
    await wb.xlsx.load((await env.readBytes("/ws/" + p)) as never);
    return wb.getWorksheet(name)!;
  };
  return { run, sheet, env };
};
const DATA = [["Tên", "Điểm"], ["An", 8], ["Bình", 6], ["Chi", 9], ["Tổng", "=SUM(B2:B4)"]];

describe("viết lại công thức khi dịch hàng/cột", () => {
  const del = (f: string, at: number, count = 1, sheet = "S") => shiftFormula(f, "S", { axis: "row", at, count, kind: "delete", sheet });
  const ins = (f: string, at: number, count = 1, sheet = "S") => shiftFormula(f, "S", { axis: "row", at, count, kind: "insert", sheet });
  it("xoá hàng: tham chiếu sau hàng bị xoá lùi lên, vùng co lại, ô bị xoá thành #REF!", () => {
    expect(del("SUM(B2:B10)", 5)).toBe("SUM(B2:B9)");
    expect(del("A7+B3", 5)).toBe("A6+B3");
    expect(del("A5", 5)).toBe("#REF!");
    expect(del("SUM(B2:B4)", 3, 5)).toBe("SUM(B2:B2)"); // cuối vùng nằm trong phần xoá → hàng liền trước
    expect(del("SUM(B3:B4)", 3, 2)).toBe("SUM(#REF!)"); // cả vùng bị xoá, giống Excel
    expect(del("$B$9", 2)).toBe("$B$8");
  });
  it("chèn hàng: tham chiếu từ hàng chèn trở xuống dịch xuống; không đụng chuỗi chữ và hàm", () => {
    expect(ins("SUM(B2:B4)", 3)).toBe("SUM(B2:B5)");
    expect(ins('IF(A5>1,"A5",LOG10(A9))', 5, 2)).toBe('IF(A7>1,"A5",LOG10(A11))');
    expect(ins("Khác!A5", 1)).toBe("Khác!A5"); // sheet khác không bị dịch
  });
  it("chỉ sheet bị dịch mới đổi; tham chiếu sheet khác giữ nguyên", () => {
    expect(shiftFormula("Khác!A5+A5", "S", { axis: "row", at: 1, count: 1, kind: "insert", sheet: "S" })).toBe("Khác!A5+A6");
    expect(shiftFormula("S!A5+A5", "Khác", { axis: "row", at: 1, count: 1, kind: "insert", sheet: "S" })).toBe("S!A6+A5");
  });
  it("cột", () => {
    expect(shiftFormula("SUM(B2:D2)", "S", { axis: "col", at: 3, count: 1, kind: "delete", sheet: "S" })).toBe("SUM(B2:C2)");
    expect(shiftFormula("E2", "S", { axis: "col", at: 2, count: 2, kind: "insert", sheet: "S" })).toBe("G2");
  });
});

describe("xlsx_edit: thêm xoá sửa", () => {
  it("xoá một hàng: công thức Tổng co lại đúng, số liệu tính lại", async () => {
    const { run, sheet } = await mk(DATA);
    const r = await run("xlsx_edit", { path: "d.xlsx", delete_rows: [{ from: 3 }] });
    expect(r).toContain("đã xoá 1 hàng");
    const ws = await sheet();
    expect(ws.getCell("A3").value).toBe("Chi");
    const f = ws.getCell("B4").value as { formula: string; result: number };
    expect(f.formula).toBe("SUM(B2:B3)");
    expect(f.result).toBe(17);
  });

  it("chèn hàng rồi gán ô trong bố cục mới; chèn cột; đổi tên và xoá sheet", async () => {
    const { run, sheet } = await mk(DATA, [{ name: "Phụ", rows: [["x"], ["=Điểm!B2*2"]] }]);
    await run("xlsx_edit", { path: "d.xlsx", insert_rows: [{ at: 3 }], set: { A3: "Dũng", B3: 7 }, insert_columns: [{ at: "C" }], rename_sheet: [{ from: "Phụ", to: "Ghi chú" }] });
    const ws = await sheet();
    expect(ws.getCell("A3").value).toBe("Dũng");
    expect(ws.getCell("A4").value).toBe("Bình");
    expect((ws.getCell("B6").value as { formula: string }).formula).toBe("SUM(B2:B5)");
    const sh = await sheet("Ghi chú");
    expect((sh.getCell("A2").value as { formula: string }).formula).toBe("Điểm!B2*2");
    await run("read_document", { path: "d.xlsx" });
    await run("xlsx_edit", { path: "d.xlsx", delete_sheet: ["Ghi chú"] });
    await run("read_document", { path: "d.xlsx" });
    await expect(run("xlsx_edit", { path: "d.xlsx", delete_sheet: ["Điểm"] })).rejects.toThrow(/duy nhất/);
  });

  it("sắp xếp giảm dần theo cột điểm (tiếng Việt, số thật), từ chối vùng có công thức", async () => {
    const { run, sheet } = await mk([["Tên", "Điểm"], ["Bình", 6], ["Ân", 8], ["Chi", 9], ["Đức", 7.5]]);
    await run("xlsx_edit", { path: "d.xlsx", sort: [{ by: "B", order: "desc" }] });
    const ws = await sheet();
    expect([2, 3, 4, 5].map((r) => ws.getCell(r, 1).value)).toEqual(["Chi", "Ân", "Đức", "Bình"]);
    const { run: run2 } = await mk(DATA);
    await expect(run2("xlsx_edit", { path: "d.xlsx", sort: [{ by: "B" }] })).rejects.toThrow(/công thức/);
  });

  it("định dạng: đậm, màu chữ, màu nền, định dạng số, độ rộng, viền, gộp ô, cố định hàng", async () => {
    const { run, sheet } = await mk(DATA);
    await run("xlsx_edit", { path: "d.xlsx", format: [
      { range: "A1:B1", bold: true, color: "trắng", fill: "#1F4E79", align: "center" },
      { range: "B2:B5", number_format: "0.0", border: "all" },
      { range: "A:A", width: 24 },
      { range: "5:5", bold: true, fill: "vàng" },
    ], merge: [{ range: "D1:E1" }], freeze: { cell: "A2" } });
    const ws = await sheet();
    const a1 = ws.getCell("A1");
    expect(a1.font?.bold).toBe(true);
    expect(a1.font?.color?.argb).toBe("FFFFFFFF");
    expect((a1.fill as { fgColor?: { argb: string } }).fgColor?.argb).toBe("FF1F4E79");
    expect(ws.getCell("B3").numFmt).toBe("0.0");
    expect(ws.getCell("B3").border?.top?.style).toBe("thin");
    expect(ws.getColumn(1).width).toBe(24);
    expect((ws.getCell("A5").fill as { fgColor?: { argb: string } }).fgColor?.argb).toBe("FFFFC000");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    await expect(run("xlsx_edit", { path: "d.xlsx", format: [{ range: "A1", color: "màu lạ" }] })).rejects.toThrow(/không hiểu màu/);
    await expect(run("xlsx_edit", { path: "d.xlsx", format: [{ range: "ZZZZ", bold: true }] })).rejects.toThrow(/vùng không hợp lệ/);
  });
});
