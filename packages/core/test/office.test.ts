import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { SEED } from "./helpers";

const { createDocx, docxToMarkdown, docxReplace, createXlsx, readXlsx, editXlsx, createPptx, readPptx, parseBlocks, parseSlides, loadZip } = office;

describe("Markdown → khối", () => {
  it("nhận diện tiêu đề, danh sách lồng, bảng có căn lề, ngắt trang, căn giữa", () => {
    const b = parseBlocks("# Tiêu đề\n\nĐoạn **đậm** và *nghiêng* và `mã`.\n\n- a\n  - a1\n- b\n\n1. một\n2. hai\n\n| A | B |\n|:-:|--:|\n| 1 | 2 |\n\n<<<pagebreak>>>\n\n<center>Giữa</center>");
    expect(b.map((x) => x.t)).toEqual(["heading", "para", "list", "list", "table", "pagebreak", "para"]);
    const para = b[1] as any;
    expect(para.runs.map((r: any) => [r.text, !!r.bold, !!r.italic, !!r.code])).toEqual([["Đoạn ", false, false, false], ["đậm", true, false, false], [" và ", false, false, false], ["nghiêng", false, true, false], [" và ", false, false, false], ["mã", false, false, true], [".", false, false, false]]);
    expect((b[2] as any).items.map((i: any) => i.level)).toEqual([0, 1, 0]);
    expect((b[4] as any).align).toEqual(["center", "right"]);
    expect((b[6] as any).align).toBe("center");
  });
});

describe("Word", () => {
  const md = "# Báo cáo quý III\n\nNội dung **quan trọng**.\n\n## Số liệu\n\n| Chỉ tiêu | Kết quả |\n|---|---:|\n| Doanh thu | 1.200 |\n| Chi phí | 800 |\n\n- Ý một\n- Ý hai\n\n1. Bước 1\n2. Bước 2";
  it("tạo → đọc lại giữ nguyên tiêu đề, bảng, danh sách; là file zip OOXML hợp lệ", async () => {
    const bytes = await createDocx({ content: md, title: "BÁO CÁO", style: "formal" });
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const back = await docxToMarkdown(bytes);
    expect(back).toContain("# Báo cáo quý III");
    expect(back).toContain("## Số liệu");
    expect(back).toContain("| Chỉ tiêu | Kết quả |");
    expect(back).toContain("| Doanh thu | 1.200 |");
    expect(back).toContain("- Ý một");
    expect(back).toContain("1. Bước 1");
    expect(back).toContain("Nội dung quan trọng.");
    const zip = await loadZip(bytes);
    expect(zip.file("word/document.xml")).toBeTruthy();
    expect(await zip.file("word/document.xml")!.async("string")).toContain('w:pgSz w:w="11906" w:h="16838"');
  });
  it("công văn có quốc hiệu, chữ ký, nơi nhận", async () => {
    const t = await docxToMarkdown(await createDocx({ content: "Nội dung.", title: "THÔNG BÁO", subtitle: "V/v họp", letterhead: { agency: "Khoa CNTT", place_date: "Hà Nội, ngày 1 tháng 1 năm 2026" }, signature: { role: "Trưởng khoa", name: "A" }, recipients: ["- Lưu VT"] }));
    for (const s of ["CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "Độc lập - Tự do - Hạnh phúc", "KHOA CNTT", "THÔNG BÁO", "V/v họp", "TRƯỞNG KHOA", "Nơi nhận:", "- Lưu VT"]) expect(t).toContain(s);
  });
  it("thay chữ giữ định dạng, kể cả khi chữ bị tách qua nhiều run", async () => {
    const bytes = await createDocx({ content: "Kính gửi: **Ông Nguyễn Văn A** — phòng Đào tạo.\n\nNgày 01/01/2026." });
    // tách thủ công "Nguyễn Văn A" qua hai run để mô phỏng Word
    const zip = await loadZip(bytes);
    let xml = await zip.file("word/document.xml")!.async("string");
    xml = xml.replace("Ông Nguyễn Văn A", "Ông Nguyễn</w:t></w:r><w:r><w:t>"+" Văn A");
    zip.file("word/document.xml", xml);
    const split = await zip.generateAsync({ type: "uint8array" });
    const r = await docxReplace(split, [{ find: "Nguyễn Văn A", replace: "Trần Thị B" }, { find: "01/01/2026", replace: "07/10/2026" }, { find: "không có", replace: "x" }]);
    expect(r.counts).toEqual([1, 1, 0]);
    const t = await docxToMarkdown(r.bytes);
    expect(t).toContain("Ông Trần Thị B");
    expect(t).toContain("Ngày 07/10/2026.");
    expect(t).not.toContain("Nguyễn");
    const x = await (await loadZip(r.bytes)).file("word/document.xml")!.async("string");
    expect(x).toMatch(/<w:b\/>[\s\S]*Trần Thị B/); // vẫn in đậm
  });
});

describe("Excel", () => {
  const rows = [["Sản phẩm", "SL", "Đơn giá", "Thành tiền", "Ngày"], ["Bút", 10, 5000, "=B2*C2", "2026-10-01"], ["Vở", 5, 12000, "=B3*C3", "2026-10-02"], ["Tổng", "=SUM(B2:B3)", "", "=SUM(D2:D3)", null]];
  it("tạo với công thức: kết quả được tính sẵn và đọc lại được", async () => {
    const r = await createXlsx([{ name: "Hoá đơn", rows, number_formats: { D: "#,##0" } }]);
    expect(r.report.errors).toEqual([]);
    expect(r.report.formulas.find((f) => f.cell === "D4")!.value).toBe("110000");
    const sheets = await readXlsx(r.bytes);
    expect(sheets[0].name).toBe("Hoá đơn");
    expect(sheets[0].summary).toContain("4 hàng × 5 cột");
    expect(sheets[0].text).toContain("50000 [=B2*C2]");
    expect(sheets[0].text).toContain("110000 [=SUM(D2:D3)]");
    expect(sheets[0].text).toContain("01/10/2026");
  });
  it("CHOOSE chọn đúng đối số (và báo #VALUE! khi chỉ số ngoài phạm vi)", async () => {
    const r = await createXlsx([{ name: "S", rows: [["i", "kq"], [2, '=CHOOSE(A2,"a","b","c")'], [9, '=CHOOSE(A3,"a","b")'], [1, "=CHOOSE(1,10,20)*2"]] }]);
    const v = (c: string) => r.report.formulas.find((f) => f.cell === c)?.value;
    expect(v("B2")).toBe("b");
    expect(v("B4")).toBe("20");
    expect(r.report.errors.join()).toContain("B3");
  });
  it("báo lỗi công thức và hàm chưa hỗ trợ thay vì đoán", async () => {
    const r = await createXlsx([{ name: "S", rows: [["a", "b"], [1, "=A2/0"], [2, "=XLOOKUP(1,A2:A3,A2:A3)"], [3, "=SUM(A2:A4)"]] }]);
    expect(r.report.errors.join()).toContain("#DIV/0!");
    expect(r.report.unverified.join()).toContain("XLOOKUP");
    expect(r.report.formulas.find((f) => f.cell === "B4")!.value).toBe("6");
  });
  it("sửa ô, thêm hàng, thêm sheet và tính lại phụ thuộc", async () => {
    const base = (await createXlsx([{ name: "Hoá đơn", rows }])).bytes;
    const e = await editXlsx(base, { set: { B2: 20, "Hoá đơn!C3": 15000 }, append_rows: [["Kẹp", 2, 3000, "=B5*C5"]], add_sheet: { name: "Ghi chú", rows: [["Ghi chú"], ["đã sửa"]] } });
    expect(e.changed).toEqual(expect.arrayContaining(["Hoá đơn!B2", "Hoá đơn!C3", "(sheet mới) Ghi chú"]));
    const after = await readXlsx(e.bytes, { sheet: "Hoá đơn" });
    expect(after[0].text).toContain("100000 [=B2*C2]"); // 20 × 5000
    expect(after[0].text).toContain("75000 [=B3*C3]"); // 5 × 15000
    expect(after[0].text).toContain("6000 [=B5*C5]");
    expect((await readXlsx(e.bytes)).map((s) => s.name)).toEqual(["Hoá đơn", "Ghi chú"]);
    await expect(editXlsx(base, { set: { "Không có!A1": 1 } })).rejects.toThrow(/Không có sheet/);
    await expect(editXlsx(base, { set: { "ZZZ": 1 } })).rejects.toThrow(/Địa chỉ ô/);
  });
  it("đọc theo range và phân trang cột/hàng", async () => {
    const big = Array.from({ length: 150 }, (_, i) => [i + 1, "x" + i]);
    const { bytes } = await createXlsx([{ name: "Big", rows: [["n", "s"], ...big], header: true }]);
    const first = (await readXlsx(bytes))[0];
    expect(first.text).toContain("còn 51 hàng nữa");
    const part = (await readXlsx(bytes, { range: "A140:B142" }))[0];
    expect(part.text).toContain("139");
    expect(part.text).not.toContain("còn");
  });
  it("tên sheet không hợp lệ/trùng được làm sạch", async () => {
    const r = await createXlsx([{ name: "A/B:C", rows: [["x"]] }, { name: "A/B:C", rows: [["y"]] }]);
    const names = (await readXlsx(r.bytes)).map((s) => s.name);
    expect(new Set(names).size).toBe(2);
    expect(names.join("")).not.toMatch(/[/:]/);
  });
});

describe("PowerPoint", () => {
  const md = "# Bìa\nPhụ đề\n\n---\n\n## Mục 1\n\n- Ý A\n  - Ý con\n- Ý B\n\nGhi chú: nói chậm\n\n---\n\n## Bảng\n\n| X | Y |\n|---|---|\n| 1 | 2 |";
  it("tách slide, bìa, ghi chú", () => {
    const s = parseSlides(md);
    expect(s.map((x) => x.title)).toEqual(["Bìa", "Mục 1", "Bảng"]);
    expect(s[0].cover).toBe(true);
    expect(s[1].notes).toBe("nói chậm");
  });
  it("tạo → đọc lại đủ tiêu đề, gạch đầu dòng, bảng, ghi chú", async () => {
    const r = await createPptx({ content: md, auto: false });
    expect(r.slides).toBe(3);
    const back = await readPptx(r.bytes);
    expect(back).toHaveLength(3);
    const text = back.map((b) => b.label + "\n" + b.text).join("\n");
    expect(text).toContain("Slide 2");
    expect(text).toContain("Ý A");
    expect(text).toContain("Ý con");
    expect(text).toContain("| X | Y |");
    expect(text).toContain("[Ghi chú người trình bày] nói chậm");
  });
  it("cảnh báo slide quá nhiều chữ", async () => {
    const r = await createPptx({ content: "## Dài\n\n" + Array.from({ length: 30 }, (_, i) => `- Ý số ${i} khá dài để chiếm nhiều chỗ trên slide này nhằm thử cảnh báo tràn`).join("\n"), auto: false });
    expect(r.warnings.join()).toContain("tràn");
  });
});

describe("công cụ cho agent (end-to-end trên thư mục ảo)", () => {
  const mk = () => {
    const env = new MemoryEnv("/ws", { ...SEED });
    const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
    const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
    return { env, ctx, run: (n: string, a: any) => tools.get(n)!.run(ctx, a), tools };
  };
  it("tạo xlsx → read_document → xlsx_edit(save_as) giữ nguyên bản gốc", async () => {
    const { run, env, ctx } = mk();
    const built = await createXlsx([{ name: "Điểm", rows: [["Tên", "Điểm"], ["An", 8], ["Bình", 6], ["TB", "=AVERAGE(B2:B3)"]] }]);
    await env.writeBytes("/ws/diem.xlsx", built.bytes); // file do người dùng đưa vào
    await expect(run("xlsx_edit", { path: "diem.xlsx", set: { B2: 9 } })).rejects.toThrow(/đọc/); // chưa đọc
    const msg = await run("create_xlsx", { path: "moi.xlsx", sheets: [{ name: "Điểm", rows: [["Tên", "Điểm"], ["An", 8], ["Bình", 6], ["TB", "=AVERAGE(B2:B3)"]] }] });
    expect(msg).toContain("B4"); // kết quả công thức được báo
    expect(msg).toContain("→  7");
    expect(await run("read_document", { path: "diem.xlsx" })).toContain("Điểm");
    await run("xlsx_edit", { path: "diem.xlsx", set: { B2: 10 }, save_as: "diem-v2.xlsx" });
    const orig = (await office.readXlsx(await env.readBytes("/ws/diem.xlsx")))[0].text;
    const v2 = (await office.readXlsx(await env.readBytes("/ws/diem-v2.xlsx")))[0].text;
    expect(orig).toMatch(/\| 8\n/);
    expect(v2).toMatch(/\| 10\n/);
    expect(v2).toContain("8 [=AVERAGE(B2:B3)]");
    expect(ctx.undoStack.length).toBe(2); // moi.xlsx + diem-v2.xlsx
  });
  it("không ghi đè file có sẵn khi chưa đọc; nhận tham số JSON dạng chuỗi", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/a.docx", await createDocx({ content: "# A" })); // file có sẵn của người dùng
    await expect(run("create_docx", { path: "a.docx", content: "# B" })).rejects.toThrow(/đã tồn tại/);
    expect(await run("create_docx", { path: "a2.docx", content: "# B" })).toContain("Đã tạo a2.docx");
    await run("read_document", { path: "a.docx" });
    expect(await run("create_docx", { path: "a.docx", content: "# C" })).toContain("Đã ghi đè a.docx"); // đọc rồi thì được ghi đè
    await expect(run("create_docx", { path: "a.txt", content: "# B" })).rejects.toThrow(/\.docx/);
    expect(await run("create_xlsx", { path: "s.xlsx", sheets: JSON.stringify([{ name: "S", rows: [["a"], [1]] }]) })).toContain("Đã tạo s.xlsx");
  });
  it("docx_replace cần đọc trước, báo chỗ không tìm thấy", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/tb.docx", await createDocx({ content: "Họp ngày 01/10 tại phòng A." }));
    await expect(run("docx_replace", { path: "tb.docx", replacements: [{ find: "01/10", replace: "02/10" }] })).rejects.toThrow(/đọc/);
    await run("read_document", { path: "tb.docx" });
    const out = await run("docx_replace", { path: "tb.docx", replacements: [{ find: "01/10", replace: "02/10" }, { find: "phòng Z", replace: "x" }], save_as: "tb2.docx" });
    expect(out).toContain("“01/10” ×1");
    expect(out).toContain("Không tìm thấy: “phòng Z”");
    expect(await office.docxToMarkdown(await env.readBytes("/ws/tb2.docx"))).toContain("02/10");
    expect(await office.docxToMarkdown(await env.readBytes("/ws/tb.docx"))).toContain("01/10");
    await expect(run("docx_replace", { path: "tb.docx", replacements: [{ find: "zzz", replace: "x" }] })).rejects.toThrow(/Không tìm thấy chữ nào/);
  });
  it("find_in_documents tìm không dấu trong nhiều loại file", async () => {
    const { run } = mk();
    await run("create_docx", { path: "thu-moi.docx", content: "Kính mời thầy Nguyễn Văn Hùng dự họp." });
    await run("create_xlsx", { path: "ds.xlsx", sheets: [{ name: "DS", rows: [["Họ tên", "Lớp"], ["Nguyễn Văn Hùng", "K65A"], ["Lê Thị Mai", "K65B"]] }] });
    await run("create_pptx", { path: "gt.pptx", content: "## Giới thiệu\n- Diễn giả: Nguyễn Văn Hùng", auto: false });
    const r = await run("find_in_documents", { query: "nguyen van hung" });
    expect(r).toContain("thu-moi.docx");
    expect(r).toContain("[[ds.xlsx|DS!A2]]");
    expect(r).toContain("[[gt.pptx|slide 1]]");
    expect(await run("find_in_documents", { query: "không-có-đâu" })).toContain("(không tìm thấy)");
  });
  it("đọc file hỏng/định dạng cũ cho thông báo rõ ràng", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/hong.docx", new Uint8Array([1, 2, 3]));
    await env.writeBytes("/ws/cu.doc", new Uint8Array([1, 2, 3]));
    await expect(run("read_document", { path: "hong.docx" })).rejects.toThrow(/không phải định dạng Office/);
    await expect(run("read_document", { path: "cu.doc" })).rejects.toThrow(/lưu lại thành \.docx/);
    expect(await run("read_document", { path: "README.md" })).toContain("# Demo");
  });
  it("read_document phân trang bằng offset", async () => {
    const { run } = mk();
    await run("create_docx", { path: "dai.docx", content: Array.from({ length: 400 }, (_, i) => `Đoạn số ${i} với nội dung đủ dài để vượt giới hạn trang.`).join("\n\n") });
    const p1 = await run("read_document", { path: "dai.docx", max_chars: 2000 });
    expect(p1).toMatch(/đọc tiếp bằng offset=\d+/);
    const off = +/offset=(\d+)/.exec(p1)![1];
    expect(await run("read_document", { path: "dai.docx", offset: off, max_chars: 2000 })).toContain("Đoạn số");
  });
});

describe("hàm Excel bổ sung", () => {
  it("MAX/MIN/COUNTA/MEDIAN/LARGE/RANK/COUNTIFS/SUMIFS/AVERAGEIFS/MATCH/UPPER/YEAR… cho kết quả đúng", async () => {
    const rows = [["Tên", "Lớp", "Điểm", "Ngày"], ["An", "A", 8, "2026-03-15"], ["Bình", "B", 6, "2025-12-01"], ["Chi", "A", 9, "2026-07-20"], ["Dũng", "B", "", "2026-01-02"]];
    const f = (e: string) => `=${e}`;
    const r = await createXlsx([{ name: "D", rows: [...rows, ["x", "x", "x", "x"], [f("MAX(C2:C5)"), f("MIN(C2:C5)"), f("COUNTA(A2:A5)"), f("COUNTBLANK(C2:C5)")], [f("MEDIAN(C2:C5)"), f("LARGE(C2:C5,2)"), f("RANK(C4,C2:C5)"), f('COUNTIFS(B2:B5,"A",C2:C5,">=8")')], [f('SUMIFS(C2:C5,B2:B5,"A")'), f('AVERAGEIFS(C2:C5,B2:B5,"B")'), f("MATCH(\"Chi\",A2:A5,0)"), f('UPPER(A2)&"-"&YEAR(D3)&"/"&MONTH(D2)&"/"&DAY(D4)')], [f('MAXIFS(C2:C5,B2:B5,"A")'), f('IFERROR(MATCH("Zed",A2:A5,0),"không có")'), f('STDEV(C2:C4)'), f('TEXTJOIN(", ",TRUE,A2:A3)')]] }]);
    expect(r.report.errors).toEqual([]);
    expect(r.report.unverified).toEqual([]);
    const v = Object.fromEntries(r.report.formulas.map((x) => [x.cell, x.value]));
    expect(v).toMatchObject({ A7: "9", B7: "6", C7: "4", D7: "1", A8: "8", B8: "8", C8: "1", D8: "2", A9: "17", B9: "6", C9: "3", D9: "AN-2025/3/20", A10: "9", B10: "không có", C10: "1.527525232", D10: "An, Bình" });
  });
});


describe("chặn tệp Office độc hại", () => {
  it("từ chối zip bomb (giải nén quá lớn) và quá nhiều thành phần, cho cả Word/Excel/PowerPoint", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("word/document.xml", "0".repeat(6 * 1024 * 1024)); // nén còn rất nhỏ
    const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(bomb.length).toBeLessThan(100_000);
    await expect(loadZip(bomb, { maxEntries: 100, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 })).rejects.toThrow(/quá lớn/);
    const many = new JSZip();
    for (let i = 0; i < 30; i++) many.file(`f${i}.txt`, "x");
    await expect(loadZip(await many.generateAsync({ type: "uint8array" }), { maxEntries: 10, maxEntryBytes: 1e6, maxTotalBytes: 1e7 })).rejects.toThrow(/quá nhiều/);
    // mặc định vẫn mở bình thường các tệp hợp lệ
    expect(Object.keys((await loadZip(await createDocx({ content: "# A" }))).files)).toContain("word/document.xml");
  });
  it("tệp Excel là zip bomb bị từ chối trước khi ExcelJS giải nén", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", "0".repeat(200 * 1024 * 1024));
    const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 1 } });
    await expect(readXlsx(bomb)).rejects.toThrow(/quá lớn/);
  }, 60000);
});
