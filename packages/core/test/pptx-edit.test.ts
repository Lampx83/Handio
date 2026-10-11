import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const DECK = [
  "# Báo cáo năm học\nKhoa Dược", "## Mở đầu\n- **Hạ** tầng đã nâng cấp\n- Dữ liệu dùng chung\n\nGhi chú: nhắc Hạ tầng", "## Kết quả\n- Đạt 92%\n- Vượt kế hoạch", "# Cảm ơn\nHỏi đáp",
].join("\n\n---\n\n");

const mk = async () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  const run = (n: string, a: unknown) => tools.get(n)!.run(ctx, a);
  await run("create_pptx", { path: "bc.pptx", content: DECK, theme: "cam" });
  await run("read_document", { path: "bc.pptx" }); // đã đọc: được phép sửa
  const read = async (p = "bc.pptx") => (await office.readPptx(await env.readBytes("/ws/" + p))).map((s) => s.label + "\n" + s.text).join("\n---\n");
  const xml = async (p = "bc.pptx") => {
    const zip = await office.loadZip(await env.readBytes("/ws/" + p));
    return Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort().map((n) => zip.file(n)!.async("string")));
  };
  return { env, run, read, xml, ctx };
};

describe("pptx_edit", () => {
  it("đổi tiêu đề thành chữ in hoa; lưu ra tên mới thì bản gốc còn nguyên", async () => {
    const { run, read } = await mk();
    const r = await run("pptx_edit", { path: "bc.pptx", save_as: "bc-hoa.pptx", transform: { case: "upper" } });
    expect(r).toContain("bc-hoa.pptx");
    const back = await read("bc-hoa.pptx");
    expect(back).toContain("Slide 2: MỞ ĐẦU");
    expect(back).toContain("Slide 3: KẾT QUẢ");
    expect(back).toContain("Dữ liệu dùng chung"); // nội dung không phải tiêu đề giữ nguyên
    expect(await read()).toContain("Slide 2: Mở đầu");
  });

  it("thay chữ bị chia thành nhiều đoạn định dạng; thấy cả trong ghi chú; báo chỗ không tìm thấy", async () => {
    const { run, read } = await mk();
    const r = await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Hạ tầng", replace: "Cơ sở vật chất" }, { find: "không có chữ này", replace: "x" }] });
    const back = await read();
    expect(back).toContain("Cơ sở vật chất đã nâng cấp");
    expect(back).toContain("nhắc Cơ sở vật chất");
    expect(r).toContain("Không tìm thấy");
    await expect(run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "không bao giờ có", replace: "x" }] })).rejects.toThrow(/Không tìm thấy/);
  });

  it("đổi màu chữ/cỡ/đậm của tiêu đề, màu nền slide và màu nền hình", async () => {
    const { run, xml } = await mk();
    await run("pptx_edit", {
      path: "bc.pptx",
      style: [{ target: "titles", slides: [2], color: "đỏ", size: 40, bold: true, font: "Arial" }, { target: "match", match: "Đạt 92%", fill: "#FFF2CC" }],
      background: { color: "xanh nhạt", slides: [3] },
    });
    const [, s2, s3] = await xml();
    expect(s2).toMatch(/sz="4000"/);
    expect(s2).toContain('<a:srgbClr val="C00000"/>');
    expect(s2).toContain('typeface="Arial"');
    expect(s3).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="9DC3E6"/>');
    expect(s3).toContain('<a:srgbClr val="FFF2CC"/>');
    await expect(run("pptx_edit", { path: "bc.pptx", style: [{ target: "all", color: "màu lạ hoắc" }] })).rejects.toThrow(/Không hiểu màu/);
  });

  it("xoá, nhân đôi, chuyển slide: bài vẫn đọc lại được và đúng thứ tự", async () => {
    const { run, read } = await mk();
    await run("pptx_edit", { path: "bc.pptx", save_as: "a.pptx", delete_slides: [3] });
    expect((await read("a.pptx")).split("\n---\n").map((s) => s.split("\n")[0])).toEqual(["Slide 1: Báo cáo năm học", "Slide 2: Mở đầu", "Slide 3: Cảm ơn"]);

    const r = await run("pptx_edit", { path: "bc.pptx", save_as: "b.pptx", duplicate_slides: [2], move_slide: { slide: 4, to: 1 } });
    expect(r).toContain("5 slide");
    const labels = (await read("b.pptx")).split("\n---\n").map((s) => s.split("\n")[0]);
    expect(labels).toEqual(["Slide 1: Cảm ơn", "Slide 2: Báo cáo năm học", "Slide 3: Mở đầu", "Slide 4: Mở đầu", "Slide 5: Kết quả"]);
    await expect(run("pptx_edit", { path: "bc.pptx", delete_slides: [9] })).rejects.toThrow(/Không có slide 9/);
    await expect(run("pptx_edit", { path: "bc.pptx", delete_slides: [1, 2, 3, 4] })).rejects.toThrow(/xoá hết/);
  });

  it("bắt buộc đọc tệp trước khi sửa; không có thao tác nào thì báo lỗi rõ", async () => {
    const { env, run } = await mk();
    await env.writeBytes("/ws/la.pptx", await env.readBytes("/ws/bc.pptx"));
    await expect(run("pptx_edit", { path: "la.pptx", transform: { case: "upper" } })).rejects.toThrow(/đọc .* bằng read_document/);
    await expect(run("pptx_edit", { path: "bc.pptx" })).rejects.toThrow(/Chưa nói cần sửa gì/);
  });

  it("chép nguyên nhãn 'Slide N: …' từ read_document vẫn tìm được; sai dấu/hoa thường vẫn thay được", async () => {
    const { run, read } = await mk();
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Slide 3: Kết quả", replace: "Slide 3: Kết luận" }] });
    expect(await read()).toContain("Slide 3: Kết luận");
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "ket qua nam hoc", replace: "x" }, { find: "MỞ ĐẦU", replace: "Giới thiệu" }] }).catch(() => undefined);
    expect(await read()).toContain("Slide 2: Giới thiệu");
  });

  it("set_title đặt lại tiêu đề theo số slide; không thấy chữ thì gợi ý đoạn gần giống", async () => {
    const { run, read } = await mk();
    await run("pptx_edit", { path: "bc.pptx", set_title: [{ slide: 2, text: "Tóm tắt" }, { slide: 3, text: "Slide 3: Kết luận" }] });
    const back = await read();
    expect(back).toContain("Slide 2: Tóm tắt");
    expect(back).toContain("Slide 3: Kết luận");
    await expect(run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Tóm tắt năm học dài dòng", replace: "x" }] })).rejects.toThrow(/Gần giống/);
  });
});

