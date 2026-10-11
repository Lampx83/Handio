import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const DOC = "# Báo cáo\n\nĐoạn mở đầu.\n\n## Kết quả\n\n- Ý một\n- Ý hai\n\n| Tên | Điểm |\n|---|---|\n| An | 8 |\n| Bình | 6 |\n\nĐoạn cuối.";

const mk = async () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  const run = (n: string, a: unknown) => tools.get(n)!.run(ctx, a);
  await run("create_docx", { path: "bc.docx", content: DOC, style: "modern" });
  const read = (await run("read_document", { path: "bc.docx" })) as string;
  const md = async (p = "bc.docx") => office.docxToMarkdown(await env.readBytes("/ws/" + p));
  const xml = async (p = "bc.docx") => (await (await office.loadZip(await env.readBytes("/ws/" + p))).file("word/document.xml")!.async("string"));
  return { run, md, xml, read };
};

describe("docx_edit", () => {
  it("read_document đánh số ¶ khớp với số đoạn dùng để sửa", async () => {
    const { read } = await mk();
    expect(read).toMatch(/¶1 # Báo cáo/);
    expect(read).toMatch(/¶2 Đoạn mở đầu\./);
  });

  it("sửa nguyên đoạn, chèn tiêu đề/danh sách/bảng, xoá đoạn: đúng thứ tự và giữ phần còn lại", async () => {
    const { run, md } = await mk();
    const r = await run("docx_edit", { path: "bc.docx", save_as: "bc2.docx",
      replace_paragraph: [{ para: 2, text: "Đoạn mở đầu đã viết lại." }],
      insert_after: [{ para: 2, text: "Bối cảnh", style: "heading2" }, { para: 4, text: "Ý ba", style: "bullet" }, { para: 6, text: "| Mục | SL |\n|---|---|\n| Máy | 3 |" }],
      delete: [7],
    });
    expect(r).toContain("bc2.docx");
    const out = await md("bc2.docx");
    expect(out).toContain("Đoạn mở đầu đã viết lại.");
    expect(out).not.toContain("Đoạn mở đầu.");
    expect(out.indexOf("Bối cảnh")).toBeGreaterThan(out.indexOf("viết lại"));
    expect(out).toContain("## Bối cảnh");
    expect(out).toContain("Ý ba");
    expect(out).toContain("| Mục | SL |");
    expect(out).not.toContain("Đoạn cuối.");
    expect(out).toContain("| An | 8 |"); // bảng gốc còn nguyên
  });

  it("định dạng: đậm + màu + cỡ + căn giữa cho tiêu đề; tô nền chữ cho đoạn chứa từ khoá", async () => {
    const { run, xml } = await mk();
    await run("docx_edit", { path: "bc.docx", save_as: "f.docx", format: [{ para: "headings", bold: true, color: "đỏ", size: 20, align: "center" }, { match: "Đoạn cuối", shade: "vàng", italic: true }] });
    const x = await xml("f.docx");
    expect(x).toContain('<w:color w:val="C00000"/>');
    expect(x).toContain('<w:sz w:val="40"/>');
    expect(x).toContain('<w:jc w:val="center"/>');
    expect(x).toContain('w:fill="FFC000"');
    await expect(run("docx_edit", { path: "bc.docx", format: [{ para: 1, color: "màu lạ" }] })).rejects.toThrow(/không hiểu màu/);
  });

  it("sửa bảng: ô, thêm hàng, xoá hàng", async () => {
    const { run, md } = await mk();
    await run("docx_edit", { path: "bc.docx", save_as: "t.docx", table: [{ table: 1, op: "set_cell", row: 2, col: 2, text: "10" }, { table: 1, op: "add_row", row: 3, cells: ["Chi", "9"] }, { table: 1, op: "delete_row", row: 1 }] });
    const out = await md("t.docx");
    expect(out).toContain("| An | 10 |");
    expect(out).toContain("| Chi | 9 |");
    expect(out).not.toContain("| Tên | Điểm |");
  });

  it("báo lỗi rõ: chưa đọc, số đoạn sai, xoá hết, thiếu thao tác", async () => {
    const { run } = await mk();
    await expect(run("docx_edit", { path: "bc.docx", delete: [99] })).rejects.toThrow(/không có đoạn 99/);
    await expect(run("docx_edit", { path: "bc.docx" })).rejects.toThrow(/Chưa nói cần sửa gì/);
    await expect(run("docx_edit", { path: "bc.docx", table: [{ table: 3, op: "delete_row", row: 1 }] })).rejects.toThrow(/không có bảng 3/);
  });
});
