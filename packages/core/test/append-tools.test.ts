import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const mk = () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  return { env, ctx, run: (n: string, a: unknown) => tools.get(n)!.run(ctx, a) };
};

describe("dựng tệp dài từng phần (append)", () => {
  it("create_docx: phần đầu rồi nối thêm; giữ tiêu đề, thứ tự đúng", async () => {
    const { env, run } = mk();
    await run("create_docx", { path: "tl.docx", title: "TÀI LIỆU PHÁT TAY", content: "# Phần 1\n\nNội dung một." });
    const r = await run("create_docx", { path: "tl.docx", content: "# Phần 2\n\nNội dung hai.", append: true });
    expect(r).toContain("nối thêm");
    await run("create_docx", { path: "tl.docx", content: "# Phần 3\n\nNội dung ba.", append: true });
    const md = await office.docxToMarkdown(await env.readBytes("/ws/tl.docx"));
    expect(md).toContain("TÀI LIỆU PHÁT TAY");
    const text = typeof md === "string" ? md : JSON.stringify(md);
    expect(text.indexOf("Nội dung một")).toBeLessThan(text.indexOf("Nội dung hai"));
    expect(text.indexOf("Nội dung hai")).toBeLessThan(text.indexOf("Nội dung ba"));
  });

  it("create_pptx: nối thêm slide, giữ chân trang và chủ đề; tổng số slide đúng", async () => {
    const { env, run } = mk();
    await run("create_pptx", { path: "bc.pptx", content: "# Bìa\nPhụ đề\n\n---\n\n## Một\n- a", footer: "Khoa Dược", theme: "cam", auto: false });
    const r = await run("create_pptx", { path: "bc.pptx", content: "---\n## Hai\n- b\n\n---\n\n## Ba\n- c", append: true });
    expect(r).toContain("4 slide");
    const back = await office.readPptx(await env.readBytes("/ws/bc.pptx"));
    expect(back.map((b) => b.label)).toEqual(["Slide 1: Bìa", "Slide 2: Một", "Slide 3: Hai", "Slide 4: Ba"]);
    const zip = await office.loadZip(await env.readBytes("/ws/bc.pptx"));
    const layouts = await Promise.all(Object.keys(zip.files).filter((n) => /slideLayouts\/slideLayout\d+\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
    expect(layouts.join("")).toContain("Khoa Dược");
    expect(layouts.join("")).toContain("D9480F"); // màu chủ đề "cam" được giữ
  });

  it("append không có bản đang dựng, hoặc tệp đã bị sửa ngoài công cụ: báo lỗi rõ", async () => {
    const { env, run } = mk();
    await expect(run("create_pptx", { path: "chua-co.pptx", content: "## x", append: true })).rejects.toThrow(/Không có bản đang dựng/);
    await run("create_docx", { path: "a.docx", content: "Một" });
    await env.writeBytes("/ws/a.docx", new Uint8Array([1, 2, 3]));
    await expect(run("create_docx", { path: "a.docx", content: "Hai", append: true })).rejects.toThrow(/đã bị sửa/);
  });
});
