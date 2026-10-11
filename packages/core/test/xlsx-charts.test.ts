/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const { createXlsx, editXlsx, readXlsx, buildChartXml, chartKindFor, loadZip } = office;

const SALES = [
  ["Tháng", "Doanh thu", "Chi phí"],
  ["T1", 120, 80],
  ["T2", 150, 95],
  ["T3", 135, 90],
  ["T4", 180, 110],
  ["Tổng", "=SUM(B2:B5)", "=SUM(C2:C5)"],
];

async function unzip(bytes: Uint8Array) {
  const zip = await loadZip(bytes);
  const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const text = async (n: string) => (await zip.file(n)!.async("string")) as string;
  return { zip, files, text };
}

/** Mọi Override có phần thật; mọi quan hệ trỏ tới phần có thật; mọi sheet có <drawing> trỏ đúng drawing; mọi biểu đồ được drawing tham chiếu. */
async function assertConsistent(bytes: Uint8Array): Promise<{ charts: string[]; drawings: string[] }> {
  const { files, text } = await unzip(bytes);
  const set = new Set(files);
  const ct = await text("[Content_Types].xml");
  for (const m of ct.matchAll(/<Override\b[^>]*PartName="\/([^"]+)"/g)) expect(set.has(m[1]), `Override ${m[1]} phải có phần thật`).toBe(true);
  const resolve = (from: string, target: string) => {
    const out: string[] = [];
    for (const s of (target.startsWith("/") ? target.slice(1) : from.slice(0, from.lastIndexOf("/") + 1) + target).split("/")) {
      if (s === "..") out.pop();
      else if (s && s !== ".") out.push(s);
    }
    return out.join("/");
  };
  for (const rels of files.filter((f) => f.endsWith(".rels") && f !== "_rels/.rels")) {
    const owner = rels.replace("_rels/", "").replace(/\.rels$/, "");
    for (const m of (await text(rels)).matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = /Target="([^"]*)"/.exec(m[0])![1];
      expect(set.has(resolve(owner, target)), `${rels} → ${target}`).toBe(true);
    }
  }
  const charts = files.filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f));
  const drawings = files.filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
  for (const c of charts) {
    expect(ct).toContain(`/${c}"`);
    expect(await text(c)).toMatch(/^<\?xml[^>]*\?>\s*<c:chartSpace/);
  }
  // mỗi chart được đúng một drawing tham chiếu
  const referenced: string[] = [];
  for (const d of drawings) {
    const rels = await text(d.replace("drawings/", "drawings/_rels/") + ".rels");
    for (const m of rels.matchAll(/relationships\/chart"[^>]*Target="([^"]+)"/g)) referenced.push(resolve(d, m[1]));
    for (const m of (await text(d)).matchAll(/<c:chart\b[^>]*r:id="([^"]+)"/g)) expect(rels).toContain(`Id="${m[1]}"`);
  }
  expect(referenced.sort()).toEqual(charts.sort());
  return { charts, drawings };
}

const ALL_TYPES = ["col", "bar", "line", "pie", "doughnut", "area"] as const;

describe("buildChartXml", () => {
  it("có tham chiếu ô + bộ nhớ đệm; không có thì dùng giá trị trực tiếp", () => {
    const spec = { kind: "bar" as const, title: "Doanh thu & chi phí <T1>", labels: ["T1", "T2"], series: [{ name: "A", values: [1, 2.5] }, { name: "B", values: [3, NaN] }] };
    const withRefs = buildChartXml(spec, { categories: "'Sheet 1'!$A$2:$A$3", series: [{ name: "'Sheet 1'!$B$1", values: "'Sheet 1'!$B$2:$B$3" }, { name: "'Sheet 1'!$C$1", values: "'Sheet 1'!$C$2:$C$3" }] });
    expect(withRefs).toContain("<c:f>'Sheet 1'!$A$2:$A$3</c:f>");
    expect(withRefs).toContain("<c:strCache>");
    expect(withRefs).toContain("<c:numCache>");
    expect(withRefs).toContain("Doanh thu &amp; chi phí &lt;T1&gt;");
    expect(withRefs).toContain('<c:barDir val="col"/>');
    expect(withRefs).toContain('lang="vi-VN"');
    expect(withRefs).not.toContain("<c:v>NaN</c:v>");
    expect(withRefs.match(/<c:pt idx=/g)!.length).toBeGreaterThan(0);
    const plain = buildChartXml(spec);
    expect(plain).toContain("<c:strLit>");
    expect(plain).toContain("<c:numLit>");
    expect(plain).not.toContain("<c:f>");
  });
  it("mỗi loại có nhóm biểu đồ và trục đúng; tròn/vành chỉ lấy chuỗi đầu và không có trục", () => {
    const base = { labels: ["a", "b", "c"], series: [{ name: "S1", values: [1, 2, 3] }, { name: "S2", values: [3, 2, 1] }] };
    expect(buildChartXml({ ...base, kind: "barh" })).toContain('<c:barDir val="bar"/>');
    expect(buildChartXml({ ...base, kind: "line" })).toContain("<c:lineChart>");
    expect(buildChartXml({ ...base, kind: "area" })).toContain("<c:areaChart>");
    const pie = buildChartXml({ ...base, kind: "pie" });
    expect(pie).toContain("<c:pieChart>");
    expect(pie).not.toContain("<c:catAx>");
    expect(pie.match(/<c:ser>/g)!.length).toBe(1);
    expect(pie.match(/<c:dPt>/g)!.length).toBe(3);
    expect(buildChartXml({ ...base, kind: "doughnut" })).toContain("<c:holeSize");
    expect(buildChartXml({ ...base, kind: "bar" })).toContain("<c:catAx>");
  });
  it("chartKindFor: col là cột đứng, bar là thanh ngang; nhận tên tiếng Việt; lạ → null", () => {
    expect(chartKindFor("col")).toBe("bar");
    expect(chartKindFor("bar")).toBe("barh");
    expect(chartKindFor("Đường")).toBe("line");
    expect(chartKindFor("tròn")).toBe("pie");
    expect(chartKindFor("radar")).toBeNull();
  });
});

describe("create_xlsx với biểu đồ", () => {
  it("mỗi loại biểu đồ: các phần chart/drawing/rels/content-types nhất quán, ExcelJS và readXlsx đọc lại được", async () => {
    const r = await createXlsx([{ name: "Doanh thu", rows: SALES as any }], {
      charts: ALL_TYPES.map((type, i) => ({ type, title: `Biểu đồ ${type}`, data_range: "A1:C6", position: `F${2 + i * 18}` })),
    });
    expect(r.report.errors).toEqual([]);
    expect(r.notes.filter((n) => n.startsWith("Đã thêm biểu đồ")).length).toBe(6);
    expect(r.notes[0]).toContain("bỏ hàng “Tổng”");
    const { charts, drawings } = await assertConsistent(r.bytes);
    expect(charts.length).toBe(6);
    expect(drawings.length).toBe(1);
    const { text } = await unzip(r.bytes);
    const sheet = await text("xl/worksheets/sheet1.xml");
    expect(sheet).toMatch(/<drawing r:id="rId\d+"\/><\/worksheet>/);
    expect(sheet.indexOf("</sheetData>")).toBeLessThan(sheet.indexOf("<drawing"));
    const c1 = await text("xl/charts/chart1.xml");
    expect(c1).toContain("<c:f>'Doanh thu'!$A$2:$A$5</c:f>"); // bỏ hàng Tổng
    expect(c1).toContain("<c:f>'Doanh thu'!$B$2:$B$5</c:f>");
    expect(c1).toContain("<c:v>180</c:v>");
    expect((await text("xl/charts/chart4.xml"))).toContain("<c:pieChart>");
    // dữ liệu vẫn nguyên
    const back = await readXlsx(r.bytes);
    expect(back[0].text).toContain("T4");
    expect(back[0].text).toContain("[=SUM(B2:B5)]");
    const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.bytes);
    expect(wb.worksheets[0].getCell("B3").value).toBe(150);
  });

  it("nhiều sheet, tự đặt bên phải dữ liệu và xếp chồng, tham chiếu sheet có dấu cách/nháy", async () => {
    const r = await createXlsx(
      [
        { name: "Số liệu", rows: [["Lớp", "Điểm"], ["A", 8], ["B", 7]] },
        { name: "Nhóm 'lạ' A", rows: [["Nhóm", "SL", "Tỷ lệ"], ["x", 3, 0.5], ["y", 5, 0.25]] },
      ],
      { charts: [{ type: "pie", title: "P", data_range: "A1:B3" }, { type: "line", title: "L", data_range: "A1:B3" }, { type: "col", title: "Q", sheet: "nhóm 'lạ' a", data_range: "A1:C3" }] },
    );
    const { charts, drawings } = await assertConsistent(r.bytes);
    expect(charts.length).toBe(3);
    expect(drawings.length).toBe(2);
    expect(r.notes[0]).toContain("tại D2");
    expect(r.notes[1]).toContain("tại D20"); // xếp chồng
    expect(r.notes[2]).toContain("tại E2");
    const { text } = await unzip(r.bytes);
    expect(await text("xl/charts/chart3.xml")).toContain("<c:f>'Nhóm ''lạ'' A'!$A$2:$A$3</c:f>");
  });

  it("ô công thức lấy kết quả đã tính; ngày làm nhãn; ô trống bỏ qua", async () => {
    const r = await createXlsx([{ name: "S", rows: [["Ngày", "Giá trị", "Gấp đôi"], ["2026-01-01", 10, "=B2*2"], ["2026-01-02", null, "=B3*2"], ["2026-01-03", 30, "=B4*2"]] }], {
      charts: [{ type: "line", data_range: "A1:C4", labels: true }],
    });
    const { text } = await unzip(r.bytes);
    const xml = await text("xl/charts/chart1.xml");
    expect(xml).toContain("<c:v>01/01/2026</c:v>");
    expect(xml).toContain("<c:v>60</c:v>");
    expect(xml).toContain('<c:showVal val="1"/>');
    // ô trống không có <c:pt idx="1"> trong chuỗi B
    const serB = xml.split("<c:ser>")[1];
    expect(serB).not.toMatch(/<c:numCache>[\s\S]*<c:pt idx="1">[\s\S]*<\/c:numCache>/);
    await assertConsistent(r.bytes);
  });

  it("tham số sai → lỗi tiếng Việt rõ ràng", async () => {
    const mk = (c: any) => createXlsx([{ name: "S", rows: SALES as any }], { charts: [c] });
    await expect(mk({ type: "radar", data_range: "A1:C5" })).rejects.toThrow(/loại “radar” không hợp lệ/);
    await expect(mk({ type: "col", data_range: "A1-C5" })).rejects.toThrow(/data_range “A1-C5” không hợp lệ/);
    await expect(mk({ type: "col", data_range: "A1:A5" })).rejects.toThrow(/ít nhất 2 cột/);
    await expect(mk({ type: "col", data_range: "A1:C1" })).rejects.toThrow(/hàng tiêu đề và ít nhất 1 hàng dữ liệu/);
    await expect(mk({ type: "col", sheet: "Khác", data_range: "A1:C5" })).rejects.toThrow(/không có sheet “Khác”/);
    await expect(mk({ type: "col", data_range: "A1:C5", position: "ZZ" })).rejects.toThrow(/position “ZZ” không hợp lệ/);
    await expect(createXlsx([{ name: "S", rows: [["a", "b"], ["x", "chữ"], ["y", 2]] }], { charts: [{ type: "col", data_range: "A1:B3" }] })).rejects.toThrow(/ô B2 .* không phải số/);
    await expect(createXlsx([{ name: "S", rows: SALES as any }], { charts: Array.from({ length: 11 }, () => ({ type: "col", data_range: "A1:C5" })) })).rejects.toThrow(/Tối đa 10 biểu đồ/);
  });
});

describe("xlsx_edit với biểu đồ", () => {
  const mk = async () => {
    const env = new MemoryEnv("/ws", {});
    const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
    const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
    const run = (n: string, a: unknown) => tools.get(n)!.run(ctx, a);
    return { env, run };
  };

  it("công cụ create_xlsx / xlsx_edit: thêm biểu đồ, báo cáo có dòng “Đã thêm biểu đồ”, dữ liệu và định dạng còn nguyên", async () => {
    const { env, run } = await mk();
    const made = await run("create_xlsx", { path: "bc.xlsx", sheets: [{ name: "KQ", rows: SALES, number_formats: { B: "#,##0.0" } }], charts: [{ type: "col", title: "Doanh thu", data_range: "A1:B6" }], theme: "ngoc" });
    expect(made).toContain("Đã thêm biểu đồ cột “Doanh thu”");
    await run("read_document", { path: "bc.xlsx" });
    const edited = await run("xlsx_edit", { path: "bc.xlsx", save_as: "bc2.xlsx", set: { B2: 999 }, charts: [{ type: "line", title: "Chi phí", data_range: "A1:C6", position: "F2" }, { type: "pie", title: "Cơ cấu", data_range: "A1:B6" }] });
    expect(edited).toContain("Đã thêm biểu đồ đường “Chi phí”");
    expect(edited).toContain("Đã thêm biểu đồ tròn “Cơ cấu”");
    const bytes = await env.readBytes("/ws/bc2.xlsx");
    const { charts } = await assertConsistent(bytes);
    expect(charts.length).toBe(3); // 1 có sẵn (giữ lại) + 2 mới
    const { text } = await unzip(bytes);
    const all = (await Promise.all(charts.map((c) => text(c)))).join("\n");
    expect(all).toContain("<c:lineChart>");
    expect(all).toContain("<c:pieChart>");
    expect(all).toContain("<c:barChart>");
    expect(all).toContain("Doanh thu"); // tiêu đề biểu đồ gốc còn
    const sheets = await readXlsx(bytes);
    expect(sheets[0].text).toContain("999");
    expect(sheets[0].text).toContain("[=SUM(B2:B5)]");
    // định dạng gốc còn: nền hàng tiêu đề, định dạng số do người dùng đặt
    const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").fill.fgColor.argb).toBe("FF0B5F59");
    expect(ws.getCell("B3").numFmt).toBe("#,##0.0");
  });

  it("sửa tiếp (thêm hàng) không làm mất biểu đồ đã có; tệp gốc có ảnh vẫn giữ ảnh", async () => {
    const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("A");
    ws.addRows(SALES.slice(0, 5));
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const img = wb.addImage({ buffer: png, extension: "png" });
    ws.addImage(img, { tl: { col: 8, row: 20 }, ext: { width: 40, height: 40 } });
    const seed = new Uint8Array(await wb.xlsx.writeBuffer());
    const first = await editXlsx(seed, { charts: [{ type: "col", title: "Một", data_range: "A1:C5" }] });
    expect(first.notes[0]).toContain("Đã thêm biểu đồ cột");
    let z = await unzip(first.bytes);
    expect(z.files.some((f) => f.startsWith("xl/media/"))).toBe(true); // ảnh còn
    expect(await z.text("xl/drawings/drawing1.xml")).toContain("<xdr:pic>");
    expect(await z.text("xl/drawings/drawing1.xml")).toContain("<c:chart");
    // lần sửa 2: chỉ thêm hàng, không yêu cầu biểu đồ
    const second = await editXlsx(first.bytes, { append_rows: [["T5", 200, 120]] });
    z = await unzip(second.bytes);
    const { charts } = await assertConsistent(second.bytes);
    expect(charts.length).toBe(1);
    expect(z.files.some((f) => f.startsWith("xl/media/"))).toBe(true);
    const cell = new ExcelJS.Workbook();
    await cell.xlsx.load(second.bytes);
    expect(cell.worksheets[0].getCell("B6").value).toBe(200);
    // lần 3: thêm biểu đồ nữa → 2 biểu đồ, id hình không trùng
    const third = await editXlsx(second.bytes, { charts: [{ type: "area", data_range: "A1:C5" }] });
    const t = await assertConsistent(third.bytes);
    expect(t.charts.length).toBe(2);
    const ids = [...(await (await unzip(third.bytes)).text("xl/drawings/drawing1.xml")).matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tham số sai ở xlsx_edit → lỗi tiếng Việt, tệp không bị ghi", async () => {
    const { run, env } = await mk();
    await run("create_xlsx", { path: "a.xlsx", sheets: [{ name: "S", rows: SALES }] });
    await run("read_document", { path: "a.xlsx" });
    await expect(run("xlsx_edit", { path: "a.xlsx", save_as: "b.xlsx", charts: [{ type: "xyz", data_range: "A1:C5" }] })).rejects.toThrow(/loại “xyz” không hợp lệ/);
    expect(await env.stat("/ws/b.xlsx")).toBeNull();
  });
});

describe("định dạng mặc định", () => {
  const load = async (bytes: Uint8Array) => {
    const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    return wb;
  };
  const DATA = [
    ["STT", "Họ tên", "Ngày", "Doanh thu", "Tỷ lệ", "Hoàn thành"],
    [1, "An", "2026-01-05", 1500000, 0.25, "80%"],
    [2, "Bình", "2026-01-06", 2300000, 0.5, "95%"],
    [3, "Chi", "2026-01-07", 1800000, 0.1, "60,5%"],
    [4, "Dũng", "2026-01-08", 2100000, 0.15, "70%"],
    ["", "Tổng", "", "=SUM(D2:D5)", "", ""],
  ];
  it("tiêu đề nền đậm chữ trắng, hàng so le, hàng Tổng đậm có viền trên, số/ngày/% tự định dạng", async () => {
    const r = await createXlsx([{ name: "Báo cáo", rows: DATA as any }]);
    const ws = (await load(r.bytes)).worksheets[0];
    const h = ws.getCell("A1");
    expect(h.fill.fgColor.argb).toBe("FF1F4E79");
    expect(h.font.bold).toBe(true);
    expect(h.font.color.argb).toBe("FFFFFFFF");
    expect(h.alignment.horizontal).toBe("center");
    expect(ws.getCell("A2").fill?.fgColor?.argb).toBeUndefined(); // hàng lẻ không tô
    expect(ws.getCell("A3").fill.fgColor.argb).toBe("FFF3F5F9"); // hàng so le
    expect(ws.getCell("D2").numFmt).toBe("#,##0");
    expect(ws.getCell("D2").alignment.horizontal).toBe("right");
    expect(ws.getCell("B2").alignment.horizontal).toBe("left");
    expect(ws.getCell("C2").numFmt).toBe("dd/mm/yyyy");
    expect(ws.getCell("E2").numFmt).toBe("0.0%"); // cột "Tỷ lệ" toàn số 0..1
    expect(ws.getCell("A2").numFmt).toBeUndefined(); // STT: không có dấu phân cách nghìn
    // "80%" dạng chữ → số thật 0.8 với định dạng %
    expect(ws.getCell("F2").value).toBeCloseTo(0.8, 6);
    expect(ws.getCell("F4").value).toBeCloseTo(0.605, 6);
    expect(ws.getCell("F2").numFmt).toBe("0.0%");
    const t = ws.getCell("B6");
    expect(t.font.bold).toBe(true);
    expect(t.border.top.style).toBe("medium");
    expect(ws.getCell("D6").numFmt).toBe("#,##0");
    expect(ws.views[0].state).toBe("frozen");
    expect(ws.views[0].showGridLines).toBe(false);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.printTitlesRow).toBe("1:1");
  });
  it("nhận ra hàng Tổng bằng công thức SUM theo cột; bộ lọc không gồm hàng Tổng; theme/accent đổi màu", async () => {
    const rows = [["Món", "SL"], ["a", 1], ["b", 2], ["", "=SUM(B2:B3)"]];
    const r = await createXlsx([{ name: "S", rows: rows as any }], { theme: "cam" });
    const ws = (await load(r.bytes)).worksheets[0];
    expect(ws.getCell("B4").font.bold).toBe(true);
    expect(JSON.stringify(ws.autoFilter)).toContain("B3"); // lọc A1:B3, không gồm hàng Tổng (hàng 4)
    expect(ws.getCell("A1").fill.fgColor.argb).toBe("FF9A3412");
    const r2 = await createXlsx([{ name: "S", rows: rows as any }], { accent: "#7030A0" });
    expect((await load(r2.bytes)).worksheets[0].getCell("A1").fill.fgColor.argb).toBe("FF7030A0");
    const r3 = await createXlsx([{ name: "S", rows: rows as any }], { theme: "không có" });
    expect(r3.notes[0]).toContain("không có");
  });
  it("công thức theo từng hàng ở cột cuối không bị nhận nhầm là hàng Tổng", async () => {
    const rows = [["Tên", "Toán", "Lý", "TB"], ["An", 8, 9, "=AVERAGE(B2:C2)"], ["Bình", 7, 6, "=AVERAGE(B3:C3)"]];
    const ws = (await load((await createXlsx([{ name: "S", rows: rows as any }])).bytes)).worksheets[0];
    expect(ws.getCell("A3").font?.bold).toBeFalsy();
  });
  it("number_formats do người dùng đặt luôn thắng định dạng tự động", async () => {
    const r = await createXlsx([{ name: "S", rows: [["a", "b"], ["x", 1000], ["y", 2000]], number_formats: { B: "0.00" } }]);
    expect((await load(r.bytes)).worksheets[0].getCell("B2").numFmt).toBe("0.00");
  });
  it("nối thêm hàng vào bảng đã định dạng: hàng mới theo kiểu hàng trước (so le, định dạng số); không bắt chước hàng Tổng", async () => {
    const base = await createXlsx([{ name: "S", rows: [["Món", "SL"], ["a", 1000], ["b", 2000], ["c", 3000]] }]);
    const e = await editXlsx(base.bytes, { append_rows: [["d", 4000]] });
    const ws = (await load(e.bytes)).worksheets[0];
    expect(ws.getCell("A5").fill.fgColor.argb).toBe("FFF3F5F9"); // hàng 5 là hàng so le như hàng 3
    expect(ws.getCell("B5").numFmt).toBe("#,##0");
    const withTotal = await createXlsx([{ name: "S", rows: [["Món", "SL"], ["a", 1], ["b", 2], ["Tổng", "=SUM(B2:B3)"]] }]);
    const e2 = await editXlsx(withTotal.bytes, { append_rows: [["c", 5]] });
    const w2 = (await load(e2.bytes)).worksheets[0];
    expect(w2.getCell("A5").font?.bold).toBeFalsy();
  });
});
