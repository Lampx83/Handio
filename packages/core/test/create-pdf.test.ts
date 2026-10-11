import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { buildPdfHtml, chartSvg } from "../src/office/pdf-html";

const MD = "# Tổng quan\n\nĐoạn **đậm** và *nghiêng* với <script>alert(1)</script>.\n\n> **Lưu ý:** kiểm tra lại số liệu.\n\n- Một\n  - Con\n- Hai\n\n| Tên | Điểm |\n|---|---|\n| An | 8,5 |\n| Bình | 9 |\n\n```chart cột\ntitle: Điểm\n| Tên | Điểm |\n|---|---|\n| An | 8,5 |\n| Bình | 9 |\n```\n";

describe("buildPdfHtml", () => {
  it("dựng đủ khối, escape chữ lạ, biểu đồ SVG, hộp lưu ý, số căn phải", () => {
    const { html, warnings } = buildPdfHtml({ content: MD, title: "Báo cáo <A>", subtitle: "Phụ đề", accent: "đỏ", toc: true });
    expect(warnings).toEqual([]);
    expect(html).toContain("Báo cáo &lt;A&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('<blockquote class="callout note">');
    expect(html).toContain("<svg");
    expect(html).toContain("#C00000");
    expect(html).toMatch(/<td style="text-align:right">8,5<\/td>/);
    expect(html).toContain("<ul><li>Một<ul><li>Con</li></ul></li><li>Hai</li></ul>");
  });
  it("màu lạ báo lỗi tiếng Việt; biểu đồ lỗi chỉ cảnh báo", () => {
    expect(() => buildPdfHtml({ content: "x", accent: "màu lạ" })).toThrow(/Không hiểu màu/);
    expect(buildPdfHtml({ content: "```chart cột\nkhông có bảng\n```" }).warnings.join()).toContain("Biểu đồ lỗi");
  });
  it("chartSvg: mọi loại biểu đồ ra SVG hợp lệ", () => {
    const base = { title: "T", labels: ["A", "B", "C"], series: [{ name: "S1", values: [1, 2, 3] }, { name: "S2", values: [3, 2, 1] }] };
    for (const kind of ["bar", "barh", "line", "area", "pie", "doughnut"] as const) {
      const svg = chartSvg({ ...base, kind }, "1F3864");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toContain("NaN");
    }
  });
});

describe("create_pdf", () => {
  const mk = (withRenderer: boolean) => {
    const env = new MemoryEnv("/ws", {});
    const calls: { html: string; footer?: string }[] = [];
    if (withRenderer) (env as unknown as { htmlToPdf: unknown }).htmlToPdf = async (html: string, o: { footer?: string }) => (calls.push({ html, footer: o.footer }), new TextEncoder().encode("%PDF-1.7 fake"));
    const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
    const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
    return { env, calls, tools, run: (n: string, a: unknown) => tools.get(n)!.run(ctx, a) };
  };
  it("chỉ có khi máy dựng được trang; tạo tệp .pdf qua bộ dựng, không ghi đè bản có sẵn", async () => {
    expect(mk(false).tools.has("create_pdf")).toBe(false);
    const { run, calls, env } = mk(true);
    const r = await run("create_pdf", { path: "bc.pdf", content: MD, title: "Báo cáo", footer: "Khoa CNTT", toc: true });
    expect(r).toContain("bc.pdf");
    expect(calls).toHaveLength(1);
    expect(calls[0].footer).toBe("Khoa CNTT");
    expect(new TextDecoder().decode(await env.readBytes("/ws/bc.pdf"))).toContain("%PDF");
    await env.writeBytes("/ws/cua-nguoi-dung.pdf", new Uint8Array([1, 2, 3])); // tệp có sẵn của người dùng
    await expect(run("create_pdf", { path: "cua-nguoi-dung.pdf", content: "x" })).rejects.toThrow(/đã tồn tại/);
    await expect(run("create_pdf", { path: "x.docx", content: "x" })).rejects.toThrow(/\.pdf/);
  });
});
