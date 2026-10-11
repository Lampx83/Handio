import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const { createDocx, docxToMarkdown, createXlsx, readXlsx, createPptx, readPptx, loadZip, parseCitations, parseLoc, checkCitation, buildDocView, documentUnits, findPii, scanDocumentPii, redactDocument, parseCsv, MERGE_MAX } = office;

const mk = () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env), ...office.workTools(env)].map((t) => [t.name, t]));
  return { env, ctx, run: (n: string, a: any) => tools.get(n)!.run(ctx, a), tools };
};
const text = async (env: MemoryEnv, p: string) => new TextDecoder().decode(await env.readBytes(p));

/** Kiểm tra XML cân bằng thẻ (đủ để bắt lỗi chèn chữ làm hỏng cấu trúc). */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0;
}

describe("trích dẫn nguồn có vị trí", () => {
  it("find_in_documents trả ký hiệu [[tệp|vị trí]] cho Word/Excel/PowerPoint/văn bản và vị trí đều kiểm tra được", async () => {
    const { run, env } = mk();
    await run("create_docx", { path: "thu-moi.docx", content: "# Thư mời\n\nKính mời thầy Nguyễn Văn Hùng dự họp.\n\n- Ý một\n- Ý hai\n\nĐoạn cuối nói về kinh phí 28.000.000 đồng." });
    await run("create_xlsx", { path: "ds.xlsx", sheets: [{ name: "DS", rows: [["Họ tên", "Lớp"], ["Nguyễn Văn Hùng", "K65A"], ["Lê Thị Mai", "K65B"]] }] });
    await run("create_pptx", { path: "gt.pptx", content: "## Mở đầu\n- ý\n\n---\n\n## Giới thiệu\n- Diễn giả: Nguyễn Văn Hùng" });
    await env.writeText("/ws/ghi-chu.txt", "dòng một\n\nông Nguyễn Văn Hùng phụ trách phần nội dung\n");
    const r = await run("find_in_documents", { query: "nguyen van hung" });
    expect(r).toContain("[[thu-moi.docx|đoạn 2]]");
    expect(r).toContain("[[ds.xlsx|DS!A2]]");
    expect(r).toContain("[[gt.pptx|slide 2]]");
    expect(r).toContain("[[ghi-chu.txt|đoạn 2]]");
    const cites = parseCitations(r);
    expect(cites).toHaveLength(4);
    for (const c of cites) {
      const bytes = await env.readBytes("/ws/" + c.file);
      const chk = await checkCitation(bytes, office.extOf(c.file), c.loc);
      expect(chk.ok, c.raw).toBe(true);
      expect(chk.snippet?.toLowerCase()).toContain("hùng");
    }
  });
  it("Excel: tìm thấy cả hàng sau 100 và chỉ ra đúng ô khớp", async () => {
    const { run } = mk();
    const rows: (string | number)[][] = [["Mã", "Tên"], ...Array.from({ length: 300 }, (_, i) => [i + 1, i === 250 ? "Đỗ Quốc Việt" : "Người " + i])];
    await run("create_xlsx", { path: "lon.xlsx", sheets: [{ name: "Dữ liệu", rows }] });
    expect(await run("find_in_documents", { query: "quoc viet" })).toContain("[[lon.xlsx|Dữ liệu!B252]]");
  });
  it("read_document đánh số đoạn ¶N trùng với 'đoạn N' khi trích dẫn", async () => {
    const { run, env } = mk();
    await run("create_docx", { path: "a.docx", content: "# Tiêu đề\n\nĐoạn A.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nĐoạn B." });
    const out = await run("read_document", { path: "a.docx" });
    expect(out).toMatch(/¶1 # Tiêu đề/);
    expect(out).toMatch(/¶2 Đoạn A\./);
    expect(out).toMatch(/¶3\n\| x \| y \|/);
    expect(out).toMatch(/¶4 Đoạn B\./);
    const u = (await documentUnits(await env.readBytes("/ws/a.docx"), ".docx")).units;
    expect(u[3]).toMatchObject({ loc: "đoạn 4", text: "Đoạn B." });
  });
  it("vị trí không có thật bị từ chối (không bịa nguồn)", async () => {
    const { run, env } = mk();
    await run("create_docx", { path: "a.docx", content: "Một đoạn." });
    await run("create_xlsx", { path: "b.xlsx", sheets: [{ name: "S", rows: [["a"], [1]] }] });
    const d = await env.readBytes("/ws/a.docx");
    const x = await env.readBytes("/ws/b.xlsx");
    expect((await checkCitation(d, ".docx", "đoạn 9")).ok).toBe(false);
    expect((await checkCitation(d, ".docx", "slide 1")).ok).toBe(false);
    expect((await checkCitation(d, ".docx", "bậy bạ")).ok).toBe(false);
    expect((await checkCitation(x, ".xlsx", "S!A2")).ok).toBe(true);
    expect((await checkCitation(x, ".xlsx", "S!A99")).ok).toBe(false);
    expect((await checkCitation(x, ".xlsx", "Khác!A1")).ok).toBe(false);
    expect(parseLoc("Dự toán!E6")).toEqual({ kind: "cell", sheet: "Dự toán", col: 5, row: 6 });
    expect(parseCitations("Có [[a.docx|đoạn 2]] và [[a.docx|đoạn 2]] và [[b b.xlsx|S!A1]] và [[hỏng]]").map((c) => c.raw)).toEqual(["[[a.docx|đoạn 2]]", "[[b b.xlsx|S!A1]]"]);
  });
  it("khung xem: đánh dấu đúng khối/ô và chỉ chứa chữ thuần", async () => {
    const { run, env } = mk();
    await run("create_docx", { path: "a.docx", content: "# T\n\nĐoạn <b>x</b> & y.\n\n- m\n- n\n\n| a | b |\n|---|---|\n| 1 | 2 |" });
    const v = await buildDocView(await env.readBytes("/ws/a.docx"), "a.docx", "đoạn 2");
    expect(v.found).toBe(true);
    expect(v.sections[0].blocks.map((b) => b.t)).toEqual(["h", "p", "list", "list", "table"]);
    const hit = v.sections[0].blocks.find((b) => b.t === "p" && b.hit);
    expect(hit && "text" in hit && hit.text).toBe("Đoạn <b>x</b> & y."); // giữ nguyên ký tự, giao diện dùng textContent
    await run("create_xlsx", { path: "b.xlsx", sheets: [{ name: "Điểm", rows: [["Tên", "Điểm"], ["An", 8], ["Bình", 6]] }] });
    const g = await buildDocView(await env.readBytes("/ws/b.xlsx"), "b.xlsx", "Điểm!B3");
    expect(g.found).toBe(true);
    const grid = g.sections[0].blocks[0];
    expect(grid.t === "grid" && grid.hitRow === 3 && grid.hitCol === 2).toBe(true);
    expect((await buildDocView(await env.readBytes("/ws/b.xlsx"), "b.xlsx", "Điểm!B99")).found).toBe(false);
    await run("create_pptx", { path: "c.pptx", content: "## A\n- một\n\n---\n\n## B\n- hai" });
    const sv = await buildDocView(await env.readBytes("/ws/c.pptx"), "c.pptx", "slide 2");
    expect(sv.found && sv.sections.map((s) => !!s.hit)).toEqual([false, true]);
  });
});

describe("trộn thư hàng loạt", () => {
  const people = [["Họ tên", "Chức vụ", "Điểm"], ["PGS.TS. Lê Minh Hoàng", "Phó Viện trưởng", 8.5], ["Công ty A & B <Việt Nam>", "Giám đốc", 7], ["Trần {{Chức vụ}}", "Chuyên viên", 9]];
  const setup = async () => {
    const m = mk();
    // chỗ trống bị tách qua nhiều run (in đậm giữa chừng) như khi người dùng gõ trong Word
    await m.env.writeBytes("/ws/mau.docx", await createDocx({ content: "Kính mời: **{{Họ tên}}**, {{Chức vụ}}.\n\nĐiểm của bạn: {{Điểm}}. Ký tên: {{Họ **tên**}}." }));
    await m.env.writeBytes("/ws/ds.xlsx", (await createXlsx([{ name: "DS", rows: people as any }])).bytes);
    return m;
  };
  it("merge_check xem trước bản đầu, báo cột thiếu và ô trống mà không ghi gì", async () => {
    const { run, env } = await setup();
    const out = await run("merge_check", { template: "mau.docx", data: "ds.xlsx" });
    expect(out).toContain("{{Họ tên}}");
    expect(out).toContain("Kính mời: PGS.TS. Lê Minh Hoàng, Phó Viện trưởng.");
    expect(out).toContain("Điểm của bạn: 8,5.");
    expect((await env.readdir("/ws")).map((e) => e.name).sort()).toEqual(["ds.xlsx", "mau.docx"]);
    await env.writeBytes("/ws/mau2.docx", await createDocx({ content: "{{Họ tên}} - {{Số quyết định}}" }));
    expect(await run("merge_check", { template: "mau2.docx", data: "ds.xlsx" })).toContain("Thiếu cột cho: {{Số quyết định}}");
  });
  it("tạo mỗi dòng một tệp: đúng nội dung, XML an toàn, không thay lại giá trị chứa {{...}}", async () => {
    const { run, env, ctx } = await setup();
    const out = await run("merge_documents", { template: "mau.docx", data: "ds.xlsx", name_pattern: "moi-{{Họ tên}}" });
    expect(out).toContain("Đã tạo 3 tệp");
    const files = (await env.readdir("/ws/mau-hang-loat")).map((e) => e.name).sort();
    expect(files).toHaveLength(3);
    expect(files.every((f) => f.endsWith(".docx") && !/[<>*?|]/.test(f))).toBe(true);
    const all = await Promise.all(files.map(async (f) => docxToMarkdown(await env.readBytes("/ws/mau-hang-loat/" + f))));
    expect(all.some((t) => t.includes("PGS.TS. Lê Minh Hoàng, Phó Viện trưởng") && t.includes("Điểm của bạn: 8,5") && t.includes("Ký tên: PGS.TS. Lê Minh Hoàng"))).toBe(true);
    const evil = all.find((t) => t.includes("Công ty A & B <Việt Nam>"))!;
    expect(evil).toContain("Kính mời: Công ty A & B <Việt Nam>, Giám đốc.");
    expect(all.find((t) => t.includes("Trần {{Chức vụ}}"))).toContain("Kính mời: Trần {{Chức vụ}}, Chuyên viên."); // giá trị không bị thay lần hai
    for (const f of files) expect(balanced(await (await loadZip(await env.readBytes("/ws/mau-hang-loat/" + f))).file("word/document.xml")!.async("string"))).toBe(true);
    expect(ctx.undoStack).toHaveLength(3);
    expect(new Set(ctx.undoStack.map((u) => u.group)).size).toBe(1); // /undo hoàn tác cả lô
    // mẫu gốc không đổi
    expect(await docxToMarkdown(await env.readBytes("/ws/mau.docx"))).toContain("{{Họ tên}}");
  });
  it("không bao giờ ghi đè: chạy lại thì tên có hậu tố -2", async () => {
    const { run, env } = await setup();
    await run("merge_documents", { template: "mau.docx", data: "ds.xlsx", name_pattern: "moi-{{Chức vụ}}" });
    const first = (await env.readdir("/ws/mau-hang-loat")).map((e) => e.name).sort();
    const before = await env.readBytes("/ws/mau-hang-loat/" + first[0]);
    await run("merge_documents", { template: "mau.docx", data: "ds.xlsx", name_pattern: "moi-{{Chức vụ}}" });
    const second = (await env.readdir("/ws/mau-hang-loat")).map((e) => e.name).sort();
    expect(second).toHaveLength(6);
    expect(second.filter((n) => /-2\.docx$/.test(n))).toHaveLength(3);
    expect(await env.readBytes("/ws/mau-hang-loat/" + first[0])).toEqual(before);
  });
  it("tên thư mục/tên tệp đầu ra không thoát khỏi dự án; giới hạn 200 bản; thiếu cột thì từ chối", async () => {
    const { run, env } = await setup();
    await expect(run("merge_documents", { template: "mau.docx", data: "ds.xlsx", output_dir: "../ngoai" })).rejects.toThrow(/ngoài thư mục dự án/);
    const many = [["Họ tên", "Chức vụ", "Điểm"], ...Array.from({ length: MERGE_MAX + 1 }, (_, i) => ["Người " + i, "x", i])];
    await env.writeBytes("/ws/lon.xlsx", (await createXlsx([{ name: "L", rows: many as any }])).bytes);
    await expect(run("merge_documents", { template: "mau.docx", data: "lon.xlsx" })).rejects.toThrow(/vượt giới hạn 200/);
    expect(await env.stat("/ws/mau-hang-loat")).toBeNull();
    const out = await run("merge_documents", { template: "mau.docx", data: "lon.xlsx", offset: 1 });
    expect(out).toContain("Đã tạo 200 tệp");
    await env.writeBytes("/ws/thieu.docx", await createDocx({ content: "{{Không có cột này}}" }));
    await expect(run("merge_documents", { template: "thieu.docx", data: "ds.xlsx" })).rejects.toThrow(/không có cột/);
    await env.writeBytes("/ws/tn.docx", await createDocx({ content: "../../etc/{{Họ tên}}" }));
    await run("merge_documents", { template: "tn.docx", data: "ds.xlsx", name_pattern: "../../{{Họ tên}}" });
    expect((await env.readdir("/ws/tn-hang-loat")).length).toBe(3);
  });
  it("chế độ gộp: một tệp, mỗi bản một trang, nội dung từng người đúng", async () => {
    const { run, env } = await setup();
    const out = await run("merge_documents", { template: "mau.docx", data: "ds.xlsx", mode: "combined" });
    expect(out).toContain("3 bản, mỗi bản một trang");
    const bytes = await env.readBytes("/ws/mau-hang-loat/mau-gop.docx");
    const xml = await (await loadZip(bytes)).file("word/document.xml")!.async("string");
    expect(xml.match(/w:br w:type="page"/g)).toHaveLength(2);
    expect(balanced(xml)).toBe(true);
    expect(xml.match(/<w:sectPr/g)).toHaveLength(1);
    const md = await docxToMarkdown(bytes);
    for (const s of ["PGS.TS. Lê Minh Hoàng", "Công ty A & B <Việt Nam>", "Trần {{Chức vụ}}"]) expect(md).toContain(s);
  });
  it("mẫu PowerPoint và dữ liệu CSV (nháy kép, dấu chấm phẩy)", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/mau.pptx", (await createPptx({ content: "# Giấy khen\n{{Họ tên}} — {{Lớp}}" })).bytes);
    await env.writeText("/ws/ds.csv", 'Họ tên;Lớp\n"Nguyễn, Văn ""An""";K65A\nLê Mai;K65B\n');
    expect(parseCsv('a;b\n"x;1";"y""z"\n')).toEqual([["a", "b"], ["x;1", 'y"z']]);
    expect(await run("merge_documents", { template: "mau.pptx", data: "ds.csv" })).toContain("Đã tạo 2 tệp");
    const names = (await env.readdir("/ws/mau-hang-loat")).map((e) => e.name);
    expect(names).toHaveLength(2);
    const t = (await readPptx(await env.readBytes("/ws/mau-hang-loat/" + names[0]))).map((s) => s.text).join("\n");
    expect(t).toMatch(/Nguyễn, Văn "An" — K65A|Lê Mai — K65B/);
    await expect(run("merge_documents", { template: "mau.pptx", data: "ds.csv", mode: "combined" })).rejects.toThrow(/chỉ dùng cho mẫu Word/);
  });
});

describe("dữ liệu cá nhân", () => {
  const FULL = ["079203001234", "0901234567", "nguyen.van.a@neu.edu.vn", "0123456789-001", "1903123456789"];
  it("nhận đúng CCCD, SĐT (nhiều kiểu viết), email, MST, STK, MSSV, CMND khi có từ khoá", () => {
    const t = (s: string) => findPii(s).map((h) => h.type);
    expect(t("CCCD: 079203001234")).toEqual(["cccd"]);
    expect(t("Số 001094012345 do Cục CSQLHC cấp")).toEqual(["cccd"]); // đầu 001 (Hà Nội) không bị nuốt như tiền tố
    expect(t("Liên hệ 0901 234 567 hoặc +84 912 345 678, 0243.868.1234")).toEqual(["phone", "phone", "phone"]);
    expect(t("Mail: a.b@neu.edu.vn.")).toEqual(["email"]);
    expect(t("MST: 0123456789")).toEqual(["mst"]);
    expect(t("MST 0123456789-001")).toEqual(["mst"]);
    expect(t("STK: 1903123456789 tại Techcombank")).toEqual(["stk"]);
    expect(t("Số tài khoản 0901234567")).toEqual(["stk"]);
    expect(t("MSSV 11230001")).toEqual(["mssv"]);
    expect(t("CMND số 012345678")).toEqual(["cmnd"]);
  });
  it("không báo nhầm: số hồ sơ, năm, ngày, số tiền, mã 9–10 chữ số trơn, số điện thoại sai đầu số", () => {
    for (const s of ["Hồ sơ số 112300012 đã nhận", "Ngày 03-10-2026 và 2026-10-07 14:30", "Kinh phí 28.000.000 đồng, đơn giá 1.234.567.890", "Mã học phần 1234567890", "Quyết định 1519/QĐ-ĐHKTQD năm 2025", "Có 120 người, 87 hồ sơ", "Điện thoại 1234567890", "Phiên bản 10.2.3.4567", "Số lượng: 000000000000"]) expect(findPii(s), s).toEqual([]);
  });
  it("Excel: cột có tiêu đề SĐT/CCCD/MSSV/STK được tính cả khi ô là số trơn", async () => {
    const x = (await createXlsx([{ name: "SV", rows: [["MSSV", "Họ tên", "SĐT", "CCCD", "Ghi chú"], [11230001, "Nguyễn An", 912345678, "079203001234", "ổn"], [11230002, "Lê Mai", "0987654321", "", "số hồ sơ 112300012"]] }])).bytes;
    const r = await scanDocumentPii(x, ".xlsx");
    expect(r.counts).toMatchObject({ mssv: 2, phone: 2, cccd: 1, cmnd: 0, email: 0 });
    expect(r.findings.find((f) => f.type === "cccd")!.loc).toBe("SV!D2");
  });
  it("scan_pii không bao giờ trả giá trị đầy đủ, chỉ số lượng/vị trí/giá trị che", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/ho-so.docx", await createDocx({ content: `Họ tên: Nguyễn Văn A\n\nCCCD: ${FULL[0]}\n\nĐiện thoại: ${FULL[1]}; email ${FULL[2]}\n\nMST: ${FULL[3]}\n\nSTK: ${FULL[4]}` }));
    await env.writeText("/ws/sach.txt", "Không có gì ở đây. Họp ngày 03-10-2026.");
    const out = await run("scan_pii", {});
    expect(out).toContain("ho-so.docx");
    expect(out).toMatch(/CCCD ×1.*SĐT ×1.*Email ×1.*Mã số thuế ×1.*Số tài khoản ×1/s);
    expect(out).toMatch(/SĐT ×1: đoạn 3 /);
    for (const v of FULL) expect(out).not.toContain(v);
    expect(out).not.toContain("0901234"); // cả phần giữa của giá trị
    expect(out).toContain("tệp sạch");
  });
  it("read_document cảnh báo ngắn khi có dữ liệu nhạy cảm, không nêu giá trị", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/a.docx", await createDocx({ content: `Danh sách.\n\nCCCD ${FULL[0]}` }));
    await env.writeBytes("/ws/b.docx", await createDocx({ content: "Họp ngày 03/10, liên hệ 0901234567." }));
    const a = await run("read_document", { path: "a.docx" });
    expect(a).toMatch(/⚠ Có dữ liệu cá nhân \(CCCD ×1\)/);
    expect(a).toContain("redact_pii");
    expect(await run("read_document", { path: "b.docx" })).not.toContain("⚠ Có dữ liệu cá nhân"); // 1 số điện thoại: chưa đáng cảnh báo
  });
  it("redact_pii tạo bản sao đã che (Word, Excel, văn bản), không đụng bản gốc và quét lại thấy sạch", async () => {
    const { run, env } = mk();
    const src = await createDocx({ content: `CCCD: **${FULL[0]}**, điện thoại ${FULL[1]}.\n\nEmail: ${FULL[2]}` });
    await env.writeBytes("/ws/hs.docx", src);
    const out = await run("redact_pii", { path: "hs.docx" });
    expect(out).toContain("hs-da-an.docx");
    expect(out).toContain("không còn dữ liệu cá nhân");
    const red = await docxToMarkdown(await env.readBytes("/ws/hs-da-an.docx"));
    expect(red).toContain("[CCCD đã ẩn]");
    expect(red).toContain("[SĐT đã ẩn]");
    expect(red).toContain("[Email đã ẩn]");
    for (const v of [FULL[0], FULL[1], FULL[2]]) expect(red).not.toContain(v);
    expect(red).toContain("CCCD: ");
    expect(await env.readBytes("/ws/hs.docx")).toEqual(src);
    expect(balanced(await (await loadZip(await env.readBytes("/ws/hs-da-an.docx"))).file("word/document.xml")!.async("string"))).toBe(true);
    // Excel
    await env.writeBytes("/ws/sv.xlsx", (await createXlsx([{ name: "SV", rows: [["Họ tên", "SĐT", "Tổng"], ["An", 912345678, "=1+1"], ["Mai", "0987654321", 5]] }])).bytes);
    await run("redact_pii", { path: "sv.xlsx" });
    const x = (await readXlsx(await env.readBytes("/ws/sv-da-an.xlsx")))[0].text;
    expect(x).toContain("[SĐT đã ẩn]");
    expect(x).not.toMatch(/912345678|0987654321/);
    expect(x).toContain("[=1+1]"); // công thức giữ nguyên
    // văn bản, và từ chối PDF
    await env.writeText("/ws/g.txt", `STK: ${FULL[4]}\nHọp lúc 8h`);
    await run("redact_pii", { path: "g.txt" });
    expect(await text(env, "/ws/g-da-an.txt")).toBe("STK: [Số tài khoản đã ẩn]\nHọp lúc 8h");
    await env.writeBytes("/ws/x.pdf", new Uint8Array([1, 2]));
    await expect(run("redact_pii", { path: "x.pdf" })).rejects.toThrow(/Chưa che được/);
    await env.writeText("/ws/sach.txt", "không có gì");
    await expect(run("redact_pii", { path: "sach.txt" })).rejects.toThrow(/Không thấy dữ liệu cá nhân/);
    const r = await redactDocument(await env.readBytes("/ws/hs.docx"), ".docx");
    expect(r.total).toBe(3);
  });
});

describe("bảng tổng hợp bằng công thức sống", () => {
  const rows: (string | number)[][] = [["MSSV", "Lớp", "Giới tính", "Điểm"], [1, "K65A", "Nam", 8], [2, "K65A", "Nữ", 6], [3, "K65B", "Nam", 9], [4, "K65B", "Nữ", 7], [5, "K65A", "Nam", 10], [6, "K65C", "Nữ", 4]];
  it("tổng hợp theo lớp: số lượng, trung bình, tổng, lớn nhất — đúng với tính tay; công thức thật; có tô màu điều kiện", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/diem.xlsx", (await createXlsx([{ name: "Điểm", rows }])).bytes);
    const out = await run("xlsx_pivot", { path: "diem.xlsx", group_by: ["Lớp"], values: [{ agg: "count", label: "Sĩ số" }, { column: "Điểm", agg: "avg", label: "ĐTB" }, { column: "Điểm", agg: "sum" }, { column: "Điểm", agg: "max" }], highlight: "bars" });
    expect(out).toContain("diem-tonghop.xlsx");
    expect(out).not.toContain("Công thức bị lỗi");
    const sheets = await readXlsx(await env.readBytes("/ws/diem-tonghop.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["Điểm", "Tổng hợp"]);
    const t = sheets[1].text;
    expect(t).toContain("Sĩ số");
    expect(t).toMatch(/K65A \| 3 \[=COUNTIFS\(.*\)\] \| 8 \[=IFERROR\(AVERAGEIFS/);
    // đối chiếu số: K65A = 8,6,10 → TB 8, tổng 24, max 10; K65B = 9,7 → TB 8; K65C = 4
    const v = (cell: string) => out.split("\n").find((l) => l.includes(`${cell}  `))?.split("→")[1]?.trim();
    expect(v("Tổng hợp!B2")).toBe("3");
    expect(v("Tổng hợp!C2")).toBe("8");
    expect(v("Tổng hợp!D2")).toBe("24");
    expect(v("Tổng hợp!E2")).toBe("10");
    expect(v("Tổng hợp!C4")).toBe("4");
    expect(v("Tổng hợp!B5")).toBe("6"); // tổng sĩ số
    expect(v("Tổng hợp!C5")).toBe("7.333333333"); // ĐTB toàn bộ = 44/6
    const zip = await loadZip(await env.readBytes("/ws/diem-tonghop.xlsx"));
    const sheet2 = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
    expect(sheet2).toContain("conditionalFormatting");
    expect(sheet2).toContain("dataBar");
    // đổi dữ liệu gốc thì công thức tính lại (qua xlsx_edit)
    await run("read_document", { path: "diem-tonghop.xlsx" });
    const ed = await run("xlsx_edit", { path: "diem-tonghop.xlsx", set: { "Điểm!D2": 2 }, save_as: "diem-v3.xlsx" });
    const after = (await readXlsx(await env.readBytes("/ws/diem-v3.xlsx"), { sheet: "Tổng hợp" }))[0].text;
    expect(ed).not.toContain("Công thức bị lỗi");
    expect(after).toMatch(/K65A \| 3 .* \| 6 \[=IFERROR/); // 2,6,10 → TB 6
    expect(await env.readBytes("/ws/diem.xlsx")).toBeTruthy();
  });
  it("nhóm theo 2 cột, lỗi rõ ràng khi sai tên cột / quá nhiều nhóm; không ghi đè bản gốc", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/diem.xlsx", (await createXlsx([{ name: "Điểm", rows }])).bytes);
    const out = await run("xlsx_pivot", { path: "diem.xlsx", group_by: ["Lớp", "Giới tính"], values: [{ agg: "count" }], save_as: "pv.xlsx" });
    expect(out).toContain("5 nhóm");
    await expect(run("xlsx_pivot", { path: "diem.xlsx", group_by: ["Khoa"], values: [{ agg: "count" }] })).rejects.toThrow(/Không có cột “Khoa”/);
    await expect(run("xlsx_pivot", { path: "diem.xlsx", group_by: ["Lớp"], values: [{ agg: "sum" }] })).rejects.toThrow(/chỉ rõ cột/);
    await expect(run("xlsx_pivot", { path: "diem.xlsx", group_by: ["Lớp"], values: [{ agg: "count" }], save_as: "diem.xlsx" })).rejects.toThrow(/đã tồn tại/);
    const big = [["Id", "V"], ...Array.from({ length: 600 }, (_, i) => [i, 1])];
    await env.writeBytes("/ws/big.xlsx", (await createXlsx([{ name: "B", rows: big as any }])).bytes);
    await expect(run("xlsx_pivot", { path: "big.xlsx", group_by: ["Id"], values: [{ agg: "count" }] })).rejects.toThrow(/quá nhiều/);
  });
  it("create_xlsx hỗ trợ tô màu điều kiện: ngưỡng, thang màu; vùng sai bị bỏ qua", async () => {
    const { run, env } = mk();
    await run("create_xlsx", { path: "t.xlsx", sheets: [{ name: "S", rows: [["Điểm"], [3], [8]], conditional: [{ range: "A2:A3", rule: { op: "lt", value: 5, color: "red" } }, { range: "A2:A3", rule: "scale" }, { range: "sai", rule: "bars" }] }] });
    const xml = await (await loadZip(await env.readBytes("/ws/t.xlsx"))).file("xl/worksheets/sheet1.xml")!.async("string");
    expect(xml).toContain('operator="lessThan"');
    expect(xml).toContain("colorScale");
    expect(xml).not.toContain("dataBar");
    expect((await readXlsx(await env.readBytes("/ws/t.xlsx")))[0].text).toContain("8");
  });
});

describe("Word: đề xuất sửa (Track Changes)", () => {
  it("ghi <w:del>/<w:ins> thật, bản gốc nguyên vẹn, đọc lại thấy chữ mới, XML hợp lệ, kể cả chữ bị tách qua nhiều run", async () => {
    const { run, env } = mk();
    const orig = await createDocx({ content: "Họp ngày **05/10/2026** tại phòng A.\n\nKính gưi các thầy cô, Khoa se to chuc hop.\n\nHạn nộp: 03-10-2026." });
    await env.writeBytes("/ws/tb.docx", orig);
    await run("read_document", { path: "tb.docx" });
    const out = await run("docx_replace", { path: "tb.docx", suggest: true, replacements: [{ find: "05/10/2026", replace: "07/10/2026" }, { find: "gưi", replace: "gửi" }, { find: "se to chuc", replace: "sẽ tổ chức" }, { find: "không có", replace: "x" }] });
    expect(out).toContain("tb-dexuat.docx");
    expect(out).toContain("3 đề xuất");
    expect(out).toContain("“05/10/2026” → “07/10/2026”");
    expect(out).toContain("Không tìm thấy: “không có”");
    expect(await env.readBytes("/ws/tb.docx")).toEqual(orig);
    const bytes = await env.readBytes("/ws/tb-dexuat.docx");
    const xml = await (await loadZip(bytes)).file("word/document.xml")!.async("string");
    expect(balanced(xml)).toBe(true);
    expect((xml.match(/<w:del /g) ?? []).length).toBe(3);
    expect((xml.match(/<w:ins /g) ?? []).length).toBe(3);
    expect(xml).toContain("<w:delText");
    expect(xml).toMatch(/w:author="Handio" w:date="\d{4}-\d\d-\d\dT/);
    const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const md = await docxToMarkdown(bytes);
    expect(md).toContain("Họp ngày 07/10/2026 tại phòng A.");
    expect(md).toContain("Kính gửi các thầy cô, Khoa sẽ tổ chức hop.");
    expect(md).not.toContain("gưi");
    expect(xml).toMatch(/<w:b\/>[\s\S]*?<w:delText[^>]*>05\/10\/2026/); // chữ bị xoá giữ định dạng đậm
    expect(xml).toMatch(/<w:b\/>[\s\S]*?<w:t[^>]*>07\/10\/2026/); // chữ mới cũng vậy
  });
  it("ký tự đặc biệt được mã hoá; không có chỗ khớp thì báo lỗi rõ và không tạo tệp; không ghi đè", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/a.docx", await createDocx({ content: "Công ty A & B ký." }));
    await run("read_document", { path: "a.docx" });
    await run("docx_replace", { path: "a.docx", suggest: true, save_as: "a-v2.docx", replacements: [{ find: "A & B", replace: "C <D> & E" }] });
    const bytes = await env.readBytes("/ws/a-v2.docx");
    expect(balanced(await (await loadZip(bytes)).file("word/document.xml")!.async("string"))).toBe(true);
    expect(await docxToMarkdown(bytes)).toContain("Công ty C <D> & E ký.");
    await expect(run("docx_replace", { path: "a.docx", suggest: true, replacements: [{ find: "zzz", replace: "x" }] })).rejects.toThrow(/Không đánh dấu được/);
    expect(await env.stat("/ws/a-dexuat.docx")).toBeNull();
    await env.writeBytes("/ws/co-san.docx", await createDocx({ content: "bản của người dùng" })); // chưa được đọc trong phiên
    await expect(run("docx_replace", { path: "a.docx", suggest: true, save_as: "co-san.docx", replacements: [{ find: "ký", replace: "chấp thuận" }] })).rejects.toThrow(/đã tồn tại/);
  });
  it("chế độ thường (không suggest) vẫn hoạt động như trước", async () => {
    const { run, env } = mk();
    await env.writeBytes("/ws/a.docx", await createDocx({ content: "Họp 01/10." }));
    await run("read_document", { path: "a.docx" });
    await run("docx_replace", { path: "a.docx", save_as: "b.docx", replacements: [{ find: "01/10", replace: "02/10" }] });
    const xml = await (await loadZip(await env.readBytes("/ws/b.docx"))).file("word/document.xml")!.async("string");
    expect(xml).not.toContain("<w:del ");
    expect(await docxToMarkdown(await env.readBytes("/ws/b.docx"))).toContain("Họp 02/10.");
  });
});

describe("PowerPoint: biểu đồ thật", () => {
  const md = "# Báo cáo\n\n---\n\n## Điểm theo lớp\n\n```chart cột\ntitle: Điểm trung bình\n| Lớp | Giữa kỳ | Cuối kỳ |\n|---|---|---|\n| K65A | 7,2 | 6.8 |\n| K65B | 8 | 7,5 |\n```\n\n---\n\n## Cơ cấu\n\n```chart tròn\n| Loại | SL |\n|---|---|\n| Giỏi | 10 |\n| Khá | 1.200 |\n```";
  it("tạo biểu đồ cột/tròn bằng pptxgenjs và đọc lại đúng nhãn + số liệu (kể cả số kiểu Việt Nam)", async () => {
    const r = await createPptx({ content: md });
    expect(r.warnings).toEqual([]);
    const zip = await loadZip(r.bytes);
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts).toHaveLength(2);
    const t = (await readPptx(r.bytes)).map((s) => s.text).join("\n");
    expect(t).toContain("[Biểu đồ cột “Điểm trung bình”] Nhãn: K65A, K65B.");
    expect(t).toContain("Giữa kỳ: 7.2, 8 | Cuối kỳ: 6.8, 7.5");
    expect(t).toContain("[Biểu đồ tròn]");
    expect(t).toContain("SL: 10, 1200");
  });
  it("bảng chart sai thì cảnh báo, không làm hỏng cả bài", async () => {
    const r = await createPptx({ content: "## A\n\n```chart cột\n| x | y |\n|---|---|\n| a | abc |\n```\n\n- ý khác" });
    expect(r.warnings.join()).toContain("biểu đồ lỗi");
    expect((await readPptx(r.bytes))[0].text).toContain("ý khác");
  });
});
