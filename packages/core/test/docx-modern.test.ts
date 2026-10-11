import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { SEED } from "./helpers";

const { createDocx, docxToMarkdown, loadZip } = office;

const parts = async (bytes: Uint8Array) => {
  const zip = await loadZip(bytes);
  const get = async (n: string) => (await zip.file(n)?.async("string")) ?? "";
  const names = Object.keys(zip.files);
  return {
    doc: await get("word/document.xml"),
    styles: await get("word/styles.xml"),
    numbering: await get("word/numbering.xml"),
    headers: await Promise.all(names.filter((n) => /^word\/header\d+\.xml$/.test(n)).map(get)),
    footers: await Promise.all(names.filter((n) => /^word\/footer\d+\.xml$/.test(n)).map(get)),
  };
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const MD = [
  "# Báo cáo quý III",
  "",
  "## 1. Tổng quan",
  "",
  "Đoạn mở đầu với **chữ đậm** và `mã`.",
  "",
  "> **Lưu ý:** Số liệu chưa kiểm toán.",
  "> **Mẹo:** Lọc theo cột đầu.",
  "> **Cảnh báo:** Không chia sẻ ngoài khoa.",
  "",
  "> Một trích dẫn thường.",
  "",
  "- Ý một",
  "  - Ý con",
  "- Ý hai",
  "",
  "## 2. Số liệu",
  "",
  "| Đơn vị | Số lượng | Ghi chú |",
  "|---|---:|---|",
  "| Khoa A | 1.200 | Tốt |",
  "| Khoa B | 800 | Khá |",
  "| Tổng | 2.000 | |",
  "",
  "```chart ngang",
  "title: Doanh thu theo tháng",
  "nguồn: Phòng Kế hoạch",
  "| Tháng | Bán lẻ | Bán buôn |",
  "|---|---|---|",
  "| T1 | 120 | 300 |",
  "| T2 | 240 | 150 |",
  "```",
  "",
  "```js",
  "console.log(1);",
  "```",
  "",
  "### 2.1 Chi tiết",
  "",
  "Hết.",
].join("\n");

describe("create_docx: kiểu modern", () => {
  it("khối tiêu đề, phụ đề + thông tin, bỏ tiêu đề trùng, đầu/chân trang", async () => {
    const p = await parts(await createDocx({ content: MD, title: "Báo cáo quý III", subtitle: "Khoa CNTT\nTác giả: A · 07/10/2026", style: "modern" }));
    expect(p.styles).toContain('w:styleId="Title"');
    expect(p.doc).toContain('<w:pStyle w:val="Title"/>');
    expect(p.doc).toContain('<w:pStyle w:val="Subtitle"/>');
    expect(p.doc).toContain("Tác giả: A · 07/10/2026");
    expect(count(p.doc, /Báo cáo quý III/g)).toBe(1); // "# Báo cáo quý III" trùng tiêu đề nên bị bỏ
    // vạch nhấn dưới tiêu đề
    expect(p.doc).toMatch(/<w:pBdr><w:bottom w:val="single" w:color="2F5597" w:sz="24"/);
    // đầu trang từ trang 2: có titlePage, tên tài liệu ở header mặc định, header trang đầu rỗng
    expect(p.doc).toContain("<w:titlePg/>");
    expect(p.headers.some((h) => h.includes("Báo cáo quý III"))).toBe(true);
    expect(p.headers.some((h) => !h.includes("<w:t"))).toBe(true);
    // chân trang "Trang X / Y"
    const foot = p.footers[0];
    expect(foot).toContain("Trang ");
    expect(foot).toContain(">PAGE<");
    expect(foot).toContain(">NUMPAGES<");
    expect(foot).toContain('w:val="right"');
  });

  it("tiêu đề cấp 1-3 có kiểu riêng; cấp 1 có đường kẻ dưới", async () => {
    const p = await parts(await createDocx({ content: "# A\n\n## B\n\n### C\n\nx", style: "modern" }));
    const h1 = /<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/.exec(p.styles)![0];
    expect(h1).toContain("<w:pBdr>");
    expect(h1).toContain('w:val="1F3864"'); // màu mặc định
    const h2 = /<w:style [^>]*w:styleId="Heading2"[\s\S]*?<\/w:style>/.exec(p.styles)![0];
    expect(h2).toContain('w:val="2F5597"');
    expect(h2).not.toContain("<w:pBdr>");
  });

  it("bảng: tiêu đề lặp + nền màu chủ đạo, hàng so le, chỉ kẻ ngang, số căn phải, không cắt hàng", async () => {
    const p = await parts(await createDocx({ content: MD, style: "modern" }));
    const tbl = /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(p.doc)![0];
    expect(tbl).toContain("<w:tblHeader");
    expect(count(tbl, /<w:cantSplit/g)).toBe(4); // tiêu đề + 3 hàng
    expect(tbl).toMatch(/<w:shd [^>]*w:fill="2F5597"/); // nền hàng tiêu đề
    expect(tbl).toContain('<w:color w:val="FFFFFF"/>'); // chữ trắng trên hàng tiêu đề
    const borders = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(tbl)![0];
    expect(borders).toMatch(/<w:insideH w:val="single"/);
    expect(borders).toMatch(/<w:insideV w:val="none"/);
    expect(borders).toMatch(/<w:left w:val="none"/);
    // cột "Số lượng" toàn số → căn phải (cả tiêu đề cột)
    expect(count(tbl, /<w:jc w:val="right"\/>/g)).toBe(4);
    // bảng nhỏ: ô đầu cột đầu đậm
    expect(tbl).toMatch(/<w:b\/>[\s\S]*Khoa A/);
    expect(tbl).toContain('w:type="fixed"');
  });

  it("hàng so le tô nền nhạt; hàng Tổng tô nền riêng", async () => {
    const p = await parts(await createDocx({ content: "| A | B |\n|---|---|\n| x | 1 |\n| y | 2 |\n| z | 3 |\n| Tổng | 6 |", style: "modern" }));
    // nền nhạt = màu nhấn trộn 93% trắng: chỉ hàng "y" (chỉ số lẻ) có; hàng "Tổng" dùng nền đậm hơn
    expect(count(p.doc, /<w:shd [^>]*w:fill="F0F3F8"/g)).toBe(2);
    expect(count(p.doc, /<w:shd [^>]*w:fill="C5CFE2"/g)).toBe(2);
    expect(count(p.doc, /<w:shd [^>]*w:fill="2F5597"/g)).toBe(2); // 2 ô của hàng tiêu đề
  });

  it("trích dẫn, hộp lưu ý/mẹo/cảnh báo, khối mã", async () => {
    const p = await parts(await createDocx({ content: MD, style: "modern" }));
    expect(p.doc).toContain('w:fill="EAF2FB"'); // lưu ý (xanh)
    expect(p.doc).toContain('w:fill="FFF7DB"'); // mẹo (vàng)
    expect(p.doc).toContain('w:fill="FDECEA"'); // cảnh báo (đỏ)
    expect(p.doc).toContain("Lưu ý:");
    expect(p.doc).toContain("Cảnh báo:");
    // trích dẫn thường: chữ nghiêng
    expect(p.doc).toMatch(/<w:i\/>[\s\S]*Một trích dẫn thường/);
    // khối mã: Consolas 9,5pt, nền xám nhạt
    expect(p.doc).toContain('w:ascii="Consolas"');
    expect(p.doc).toContain('<w:sz w:val="19"/>');
    expect(p.doc).toContain('w:fill="F4F5F7"');
  });

  it("biểu đồ chart → thanh bằng ô tô màu: số liệu, chú giải, nguồn; mỗi chuỗi một màu", async () => {
    const p = await parts(await createDocx({ content: MD, style: "modern" }));
    expect(p.doc).toContain("Doanh thu theo tháng");
    expect(p.doc).toContain("Nguồn: Phòng Kế hoạch");
    expect(p.doc).toContain("■ "); // chú giải
    expect(p.doc).toContain("Bán lẻ");
    expect(p.doc).toContain("Bán buôn");
    expect(p.doc).toContain('w:fill="ED7D31"'); // chuỗi thứ hai
    expect(p.doc).toContain("<w:gridSpan");
    expect(p.doc).toContain('<w:vMerge w:val="restart"/>'); // nhãn gộp dọc theo số chuỗi
    for (const v of ["120", "300", "240", "150"]) expect(p.doc).toContain(`>${v}<`);
    // khối chart không còn là khối mã thô
    expect(p.doc).not.toContain("| Tháng | Bán lẻ");
  });

  it("thanh dài theo giá trị: giá trị lớn nhất chiếm 30/40 đơn vị lưới, nửa giá trị chiếm 15", async () => {
    const p = await parts(await createDocx({ content: "```chart\n| N | V |\n|---|---|\n| a | 100 |\n| b | 50 |\n```", style: "modern" }));
    const spans = [...p.doc.matchAll(/<w:gridSpan w:val="(\d+)"\/>/g)].map((m) => +m[1]);
    expect(spans).toEqual([30, 10, 15, 25]);
  });

  it("mục lục toc: có trường TOC kèm mục theo tiêu đề; không có toc thì không có", async () => {
    const withToc = await parts(await createDocx({ content: MD, style: "modern", toc: true }));
    expect(withToc.doc).toMatch(/TOC \\[a-z]/);
    expect(withToc.doc).toContain("Mục lục");
    expect(withToc.doc).toContain("2. Số liệu");
    expect(withToc.styles).toContain('w:styleId="TOC1"');
    const without = await parts(await createDocx({ content: MD, style: "modern" }));
    expect(without.doc).not.toContain("TOC \\");
    expect(without.doc).not.toContain("Mục lục");
  });

  it("danh sách: ký hiệu • / – / ▪ theo cấp, thụt lề", async () => {
    const p = await parts(await createDocx({ content: "- a\n  - b\n    - c\n\n1. x\n2. y", style: "modern" }));
    for (const ch of ["•", "–", "▪"]) expect(p.numbering).toContain(`w:val="${ch}"`);
    expect(p.numbering).toContain('w:hanging="284"');
  });

  it("accent: tên màu và #RRGGBB đổi màu nhấn; màu sai báo lỗi tiếng Việt", async () => {
    const red = await parts(await createDocx({ content: "## A\n\n| a | b |\n|---|---|\n| 1 | 2 |", style: "modern", accent: "đỏ" }));
    expect(red.doc).toContain('w:fill="C00000"');
    expect(red.styles).toContain('w:val="C00000"'); // tiêu đề cấp 2
    const hex = await parts(await createDocx({ content: "| a | b |\n|---|---|\n| 1 | 2 |", style: "modern", accent: "#0F766E" }));
    expect(hex.doc).toContain('w:fill="0F766E"');
    await expect(createDocx({ content: "x", style: "modern", accent: "xanh lè lẹt" })).rejects.toThrow(/Màu chủ đạo .* không hợp lệ/);
    await expect(createDocx({ content: "x", style: "modern", accent: "#FFFFFF" })).rejects.toThrow(/quá nhạt/);
  });

  it("chart sai cú pháp báo lỗi tiếng Việt", async () => {
    await expect(createDocx({ content: "```chart\nkhông có bảng\n```", style: "modern" })).rejects.toThrow(/Khối biểu đồ/);
    await expect(createDocx({ content: "```chart\n| a | b |\n|---|---|\n| x | chữ |\n```", style: "modern" })).rejects.toThrow(/không phải số/);
  });

  it("không có tiêu đề: không có header; page_numbers=false bỏ chân trang", async () => {
    const p = await parts(await createDocx({ content: "Chỉ có một đoạn.", style: "modern", page_numbers: false }));
    expect(p.headers.length).toBe(0);
    expect(p.footers.length).toBe(0);
    expect(p.doc).not.toContain("<w:titlePg/>");
  });

  it("tài liệu đọc lại được và là zip OOXML hợp lệ", async () => {
    const bytes = await createDocx({ content: MD, title: "Báo cáo quý III", style: "modern", toc: true, orientation: "landscape" });
    const md = await docxToMarkdown(bytes);
    expect(md).toContain("## 1. Tổng quan");
    expect(md).toContain("| Khoa A | 1.200 | Tốt |");
    expect(md).toMatch(/2\. Số liệu\t/); // mục lục có tab (trước đây làm hỏng bộ đọc)
    expect((await parts(bytes)).doc).toContain('w:orient="landscape"');
  });
});

describe("create_docx: kiểu formal không đổi", () => {
  it("giữ Times New Roman 13, căn đều, lề 3/2/2/2 cm, số trang giữa, tiêu đề bảng D9E2F3, không đầu trang", async () => {
    const bytes = await createDocx({ content: "# Mục\n\nĐoạn văn.\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n> trích\n\n- a", title: "THÔNG BÁO", subtitle: "V/v họp", style: "formal" });
    const p = await parts(bytes);
    expect(p.styles).toContain('w:ascii="Times New Roman"');
    expect(p.styles).toMatch(/<w:docDefaults>[\s\S]*<w:sz w:val="26"\/>/);
    expect(p.doc).toContain('w:w="11906" w:h="16838"');
    expect(p.doc).toMatch(/<w:pgMar [^>]*w:top="1134"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1701"/);
    expect(p.doc).toContain('<w:jc w:val="both"/>');
    expect(p.doc).toContain('w:fill="D9E2F3"');
    expect(p.doc).not.toContain("<w:titlePg/>");
    expect(p.headers.length).toBe(0);
    expect(p.footers.length).toBe(1);
    expect(p.footers[0]).toContain('<w:jc w:val="center"/>');
    expect(p.footers[0]).not.toContain("NUMPAGES");
    expect(p.doc).not.toContain('<w:pStyle w:val="Title"/>');
    expect(p.styles).not.toContain('w:styleId="TOC1"');
    expect(p.styles).not.toContain('w:styleId="Subtitle"');
    expect(p.doc).toContain("THÔNG BÁO");
  });

  it("accent bị bỏ qua ở formal (không đổi màu tiêu đề) nhưng vẫn kiểm tra giá trị", async () => {
    const p = await parts(await createDocx({ content: "# A", style: "formal", accent: "đỏ" }));
    expect(p.styles).not.toContain("C00000");
    await expect(createDocx({ content: "# A", style: "formal", accent: "???" })).rejects.toThrow(/Màu chủ đạo/);
  });
});

describe("công cụ create_docx với accent và toc", () => {
  it("nhận accent/toc (toc dạng chuỗi 'true' cũng được) và giữ khi nối thêm append", async () => {
    const env = new MemoryEnv("/ws", { ...SEED });
    const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
    const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
    const run = (n: string, a: any) => tools.get(n)!.run(ctx, a);
    const props = (tools.get("create_docx")!.parameters as any).properties;
    expect(props.accent).toBeTruthy();
    expect(props.toc).toBeTruthy();
    await run("create_docx", { path: "bc.docx", style: "modern", title: "BÁO CÁO", accent: "#7030A0", toc: "true", content: "## Một\n\nNội dung một." });
    await run("create_docx", { path: "bc.docx", content: "## Hai\n\nNội dung hai.", append: true });
    const p = await parts(await env.readBytes("/ws/bc.docx"));
    expect(p.doc).toContain("TOC \\");
    expect(p.styles).toContain('w:val="7030A0"');
    expect(p.doc).toContain("Hai");
    await expect(run("create_docx", { path: "x.docx", style: "modern", accent: "không-phải-màu", content: "a" })).rejects.toThrow(/Màu chủ đạo/);
  });
});
