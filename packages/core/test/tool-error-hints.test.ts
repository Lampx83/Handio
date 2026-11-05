import { describe, expect, it } from "vitest";
import { MemoryEnv, office } from "../src";
import { makeController } from "./helpers";

// Các lỗi hay gặp trong số liệu 30 ngày: pptx_edit no_match, run_javascript sandbox, read_document outside_project.
const results = (ev: any[]) => ev.filter((e) => e.type === "tool_result");

const DECK = `# Báo cáo năm\nKhoa Thử nghiệm\n\n---\n\n## Kết quả đào tạo\n- Tỉ lệ tốt nghiệp đạt 92% năm 2025\n- Doanh thu quý 3 tăng 12% so với cùng kỳ, nhờ mở rộng thị trường miền Nam\n\n---\n\n## Bảng số\n\n| Khu vực | Doanh thu |\n|---|---|\n| Hà Nội | 40 tỉ |\n| Huế | 40 tỉ |\n\nGhi chú: Nói chậm phần này`;
const deck = async () => (await office.createPptx({ auto: false, content: DECK })).bytes;
const edit = async (find: string, replace: string) => {
  const r = await office.editPptx(await deck(), { replacements: [{ find, replace }] });
  return { count: r.counts[0], slides: await office.readPptx(r.bytes), changes: r.changes };
};
const all = (s: { label: string; text: string }[]) => s.map((x) => `${x.label}\n${x.text}`).join("\n");

describe("pptx_edit: find chép nguyên từ read_document", () => {
  it("nhãn của read_document không làm hỏng so khớp", async () => {
    expect((await edit("## Slide 2: Kết quả đào tạo", "Kết quả mới")).count).toBe(1);
    const n = await edit("[Ghi chú người trình bày] Nói chậm phần này", "Nói nhanh");
    expect(n.count).toBe(1);
    expect(all(n.slides)).toContain("Nói nhanh");
  });

  it("tiêu đề + gạch đầu dòng (hai khung chữ) cùng số dòng: thay từng dòng", async () => {
    const r = await edit("Kết quả đào tạo\n- Tỉ lệ tốt nghiệp đạt 92% năm 2025", "Thành tích\n- Tỉ lệ tốt nghiệp đạt 95% năm 2025");
    expect(r.count).toBeGreaterThan(0);
    const t = all(r.slides);
    expect(t).toContain("Slide 2: Thành tích");
    expect(t).toContain("95% năm 2025");
    expect(t).not.toContain("92%");
    expect(t).toContain("Doanh thu quý 3"); // dòng khác giữ nguyên
  });

  it("dòng bảng: chỉ sửa đúng dòng đó, dòng khác cùng giá trị giữ nguyên", async () => {
    const r = await edit("| Hà Nội | 40 tỉ |", "| Hà Nội | 50 tỉ |");
    expect(r.count).toBeGreaterThan(0);
    const t = all(r.slides);
    expect(t).toContain("| Hà Nội | 50 tỉ |");
    expect(t).toContain("| Huế | 40 tỉ |");
  });

  it("dòng bảng có hai ô giống nhau: sửa đúng ô được đổi", async () => {
    const bytes = (await office.createPptx({ auto: false, content: "## Bảng\n\n| A | B | C |\n|---|---|---|\n| Huế | 40 | 40 |\n| Vinh | 40 | 40 |" })).bytes;
    const r = await office.editPptx(bytes, { replacements: [{ find: "| Huế | 40 | 40 |", replace: "| Huế | 40 | 55 |" }] });
    const t = all(await office.readPptx(r.bytes));
    expect(t).toContain("| Huế | 40 | 55 |");
    expect(t).toContain("| Vinh | 40 | 40 |");
  });

  it("dòng bảng khác số ô thì không đoán", async () => {
    expect((await edit("| Hà Nội | 40 tỉ |", "| Hà Nội | 50 tỉ | thêm |")).count).toBe(0);
  });

  it("một dòng của find không thấy thì không sửa gì cả", async () => {
    const r = await edit("Kết quả đào tạo\n- Dòng không có", "Thành tích\n- Dòng mới");
    expect(r.count).toBe(0);
    expect(all(r.slides)).toContain("Slide 2: Kết quả đào tạo");
  });

  it("dòng của find khớp nhiều chỗ thì không đoán", async () => {
    const r = await edit("40 tỉ\nHuế", "50 tỉ\nHuế mới");
    expect(r.count).toBe(0);
  });

  it("find rút gọn bằng … thay cả câu, không để lại nửa câu cũ", async () => {
    for (const dots of ["...", "…"]) {
      const r = await edit(`Doanh thu quý 3 tăng 12% so với cùng kỳ, nhờ mở rộ${dots}`, "Doanh thu tăng");
      expect(r.count).toBe(1);
      const t = all(r.slides);
      expect(t).toMatch(/^(- )?Doanh thu tăng$/m);
      expect(t).not.toContain("thị trường miền Nam");
      expect(t).toContain("Tỉ lệ tốt nghiệp"); // dòng trước giữ nguyên
    }
  });

  it("không khớp vì trải nhiều khung: lỗi nói rõ phải làm gì", async () => {
    const env = new MemoryEnv("/ws", {});
    await env.writeBytes("/ws/a.pptx", await deck());
    const { c, events } = await makeController([{ calls: [{ name: "read_document", args: { path: "a.pptx" } }] }, { calls: [{ name: "pptx_edit", args: { path: "a.pptx", replacements: [{ find: "Kết quả đào tạo\n- Tỉ lệ tốt nghiệp đạt 92% năm 2025", replace: "Một dòng mới" }] } }] }, { text: "ok" }], { env, profile: "work", settings: { mode: "auto" } as any });
    await c.send("sửa");
    const r = results(events)[1];
    expect(r).toMatchObject({ ok: false, errKind: "no_match" });
    expect(r.output).toContain("một khung chữ");
    expect(r.output).toContain("set_title");
    expect(r.output).toContain("set_body");
  });

  it("mô tả công cụ có ví dụ gọi và nói mỗi find trong một khung", async () => {
    const env = new MemoryEnv("/ws", {});
    const { c, llm } = await makeController([{ text: "ok" }], { env, profile: "work", settings: { mode: "auto" } as any });
    await c.send("x");
    const tool = (llm.calls[0].opts.tools as any[]).find((t) => t.function.name === "pptx_edit" || t.name === "pptx_edit");
    const d = tool.function?.description ?? tool.description;
    expect(d).toContain("Examples");
    expect(d).toContain("ONE box");
  });
});

describe("run_javascript: lỗi chỉ đúng cách làm ở nơi đang chạy", () => {
  const run = async (error: string, withBash: boolean) => {
    const env = new MemoryEnv("/ws", { "a.js": "1" });
    (env as any).runJs = async () => ({ ok: false, logs: [], error });
    if (withBash) (env as any).exec = async () => ({ code: 0, output: "", timedOut: false });
    const { c, events } = await makeController([{ calls: [{ name: "run_javascript", args: { code: "x" } }] }, { text: "ok" }], { env });
    c.onEvent((e) => e.type === "permission" && c.respondPermission(e.request.id, { allow: true }));
    await c.send("x");
    return results(events)[0];
  };

  it("bản web không có bash thì không được khuyên dùng bash", async () => {
    const r = await run("Error: Cannot find module 'child_process'", false);
    expect(r.errKind).toBe("sandbox");
    expect(r.output).not.toContain("dùng bash");
    expect(r.output).toContain("không có bash");
  });

  it("có bash thì chỉ sang bash", async () => {
    expect((await run("Error: Cannot find module 'child_process'", true)).output).toContain("dùng bash");
  });

  it.each([
    ["Error: Cannot find module 'express' (hộp cát chỉ nạp được tệp của dự án, không có thư viện ngoài)", "thư viện ngoài"],
    ["SyntaxError: Cannot use import statement outside a module", "require"],
    ["SyntaxError: Unexpected token 'export'", "require"],
    ["TypeError: fs.writeFileSync is not a function", "write_file"],
    ["TypeError: require(...).writeFileSync is not a function", "write_file"], // đúng thông báo của Chromium khi gọi thẳng trên require
    ["TypeError: Cannot read properties of undefined (reading 'readFile')", "write_file"], // fs.promises
    ["ReferenceError: document is not defined", "DOM"],
    ["ReferenceError: alert is not defined", "DOM"],
    ["ReferenceError: Buffer is not defined", "Buffer"],
  ])("%s là do hộp cát, không phải lỗi chương trình", async (error, hint) => {
    const r = await run(error, false);
    expect(r.errKind).toBe("sandbox");
    expect(r.output).toContain(hint);
  });

  it("tệp của dự án thiếu và lỗi thật của chương trình vẫn là 'program'", async () => {
    expect((await run("Error: Cannot find module './khong-co' (các tệp có sẵn: a.js)", false)).errKind).toBe("program");
    expect((await run("TypeError: x.foo is not a function", false)).errKind).toBe("program");
    expect((await run("ReferenceError: tinhTong is not defined", false)).errKind).toBe("program");
  });

  it("mô tả công cụ khớp nơi chạy", async () => {
    const desc = async (withBash: boolean) => {
      const env = new MemoryEnv("/ws", {});
      (env as any).runJs = async () => ({ ok: true, logs: [] });
      if (withBash) (env as any).exec = async () => ({ code: 0, output: "", timedOut: false });
      const { c, llm } = await makeController([{ text: "ok" }], { env });
      await c.send("x");
      const t = (llm.calls[0].opts.tools as any[]).find((x) => (x.function?.name ?? x.name) === "run_javascript");
      return String(t.function?.description ?? t.description);
    };
    expect(await desc(true)).toContain("use bash");
    const web = await desc(false);
    expect(web).not.toContain("use bash");
    expect(web).toContain("read-only");
  });
});

describe("đường dẫn ngoài dự án: lỗi chỉ cách làm, KHÔNG nới lỏng", () => {
  const read = async (path: string, seed: Record<string, string> = { "tai-lieu/quy-che.txt": "bí mật dự án" }) => {
    const env = new MemoryEnv("/ws", seed);
    const { c, events } = await makeController([{ calls: [{ name: "read_document", args: { path } }] }, { text: "ok" }], { env, profile: "work", settings: { mode: "auto" } as any });
    await c.send("đọc");
    return results(events)[0];
  };

  it("trong dự án có tệp cùng tên thì chỉ ra, nhưng vẫn báo lỗi chứ không tự đọc", async () => {
    const r = await read("/mnt/data/quy-che.txt");
    expect(r).toMatchObject({ ok: false, errKind: "outside_project" });
    expect(r.output).toContain("tai-lieu/quy-che.txt");
    expect(r.output).not.toContain("bí mật dự án");
  });

  it("không có tệp cùng tên thì bảo dừng thử và nhờ người dùng chép tệp vào", async () => {
    const r = await read("../khac/luong.docx");
    expect(r).toMatchObject({ ok: false, errKind: "outside_project" });
    expect(r.output).toContain("Đừng thử đường dẫn khác");
    expect(r.output).toContain("chép tệp vào");
    expect(r.output).toContain("đường dẫn tương đối");
  });

  it("đường dẫn Windows ngoài dự án cũng được gợi ý theo tên tệp", async () => {
    expect((await read("C:\\Users\\An\\Downloads\\quy-che.txt")).output).toContain("tai-lieu/quy-che.txt");
  });
});
