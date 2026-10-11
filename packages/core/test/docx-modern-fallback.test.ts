import { describe, expect, it, vi } from "vitest";
import { office } from "../src";

// bộ ước lượng số trang của thư viện lỗi → vẫn tạo được tài liệu, mục lục để Word tự điền số trang
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("docx/layout", () => ({ estimatePageNumbersWith: () => () => { calls.n++; throw new Error("layout lỗi"); } }));

describe("create_docx: mục lục khi bộ dàn trang lỗi", () => {
  it("vẫn ra tệp hợp lệ có mục lục và đủ mục", async () => {
    const bytes = await office.createDocx({ content: "## Một\n\nA.\n\n## Hai\n\nB.", style: "modern", title: "T", toc: true });
    const zip = await office.loadZip(bytes);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toMatch(/TOC \\[a-z]/);
    expect(doc).toContain("Một");
    expect(doc).toContain("Hai");
    expect(calls.n).toBeGreaterThan(0); // bộ ước lượng đã được gọi và đã lỗi
    expect(await office.docxToMarkdown(bytes)).toContain("## Hai");
  });
});
