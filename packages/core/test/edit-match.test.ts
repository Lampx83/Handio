import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools } from "../src";
import { makeController } from "./helpers";

type Res = { ok: boolean; output: string; kind?: string };

/** Kịch bản: (đọc tệp nếu read=true) rồi edit_file với args cho trước; trả kết quả các công cụ và nội dung tệp sau đó. */
async function edit(content: string, args: Record<string, unknown>, opts: { read?: boolean; path?: string } = {}) {
  const path = opts.path ?? "a.js";
  const env = new MemoryEnv("/ws", { [path]: content });
  const calls = [...(opts.read === false ? [] : [{ calls: [{ name: "read_file", args: { path } }] }]), { calls: [{ name: "edit_file", args: { path, ...args } }] }, { text: "ok" }];
  const { c, events } = await makeController(calls, { profile: "code", env });
  await c.send("sửa");
  const res = events.filter((e) => e.type === "tool_result") as unknown as Res[];
  return { res: res[res.length - 1], file: env.snapshot()[`/ws/${path}`] };
}

const JS = "function total(items) {\n  let sum = 0;\n\n  for (const x of items) sum += x.price;\n  return sum;\n}\n";

describe("edit_file khớp lỏng (chỉ khi duy nhất)", () => {
  it("bỏ số dòng chép nhầm từ read_file", async () => {
    const { res, file } = await edit(JS, { old_string: "     4\t  for (const x of items) sum += x.price;\n     5\t  return sum;", new_string: "     4\t  for (const x of items) sum += x.cost;\n     5\t  return sum;" });
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/số dòng/);
    expect(file).toBe(JS.replace("x.price", "x.cost"));
  });

  it("bỏ số dòng chép từ trích đoạn lỗi (N| ), kể cả dòng mới thêm không có số", async () => {
    const { res, file } = await edit(JS, { old_string: "2|   let sum = 0;\n3| \n4|   for (const x of items) sum += x.price;", new_string: "2|   let sum = 0;\n  const n = items.length;\n3| \n4|   for (const x of items) sum += x.price;" });
    expect(res.ok).toBe(true);
    expect(file).toBe(JS.replace("  let sum = 0;\n", "  let sum = 0;\n  const n = items.length;\n"));
  });

  it("bỏ qua dòng trống thiếu/thừa giữa các dòng", async () => {
    const { res, file } = await edit(JS, { old_string: "  let sum = 0;\n  for (const x of items) sum += x.price;", new_string: "  let sum = 0;\n  for (const x of items) sum += x.cost;" });
    expect(res.ok).toBe(true);
    expect(res.output).toMatch(/khớp gần đúng/);
    expect(file).toContain("sum += x.cost;");
    expect(file).not.toContain("x.price");
  });

  it("bỏ qua khác biệt số dấu cách giữa các từ", async () => {
    const { res, file } = await edit(JS, { old_string: "let sum  =  0;\nfor (const x of items)  sum += x.price;", new_string: "let sum = 1;\nfor (const x of items) sum += x.price;" });
    expect(res.ok).toBe(true);
    expect(file).toContain("  let sum = 1;\n");
  });

  it("tệp CRLF: giữ nguyên \\r\\n ở mọi dòng sau khi sửa", async () => {
    const crlf = JS.replace(/\n/g, "\r\n");
    const { res, file } = await edit(crlf, { old_string: "  let sum = 0;\n\n  for (const x of items) sum += x.price;", new_string: "  let sum = 0;\n  const n = 1;\n\n  for (const x of items) sum += x.price;" });
    expect(res.ok).toBe(true);
    expect(file).toContain("  const n = 1;\r\n");
    expect(file.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("tệp CRLF, thụt dòng lệch: dòng mới vẫn có \\r", async () => {
    const crlf = JS.replace(/\n/g, "\r\n");
    const { res, file } = await edit(crlf, { old_string: "let sum = 0;\n\nfor (const x of items) sum += x.price;", new_string: "let sum = 0;\nconst n = 1;\n\nfor (const x of items) sum += x.price;" });
    expect(res.ok).toBe(true);
    expect(file).toContain("  const n = 1;\r\n");
    expect(file.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("chữ Việt khác dạng Unicode (tổ hợp NFD trong tệp, dựng sẵn NFC trong old_string)", async () => {
    const doc = "# Tiêu đề\nXin chào các bạn\n".normalize("NFD");
    const { res, file } = await edit(doc, { old_string: "Xin chào các bạn".normalize("NFC"), new_string: "Chào mừng" }, { path: "a.md" });
    expect(res.ok).toBe(true);
    expect(file.normalize("NFC")).toBe("# Tiêu đề\nChào mừng\n");
  });

  it("khớp lỏng nhưng không duy nhất → không sửa, báo no_match", async () => {
    const twice = "if (a) {\n  go();\n}\nif (a) {\n    go();\n}\n";
    const { res, file } = await edit(twice, { old_string: "if (a) {\ngo();\n}", new_string: "if (b) {\ngo();\n}" });
    expect(res.ok).toBe(false);
    expect(file).toBe(twice);
  });

  it("vẫn bắt buộc đọc trước, kể cả khi old_string kèm số dòng", async () => {
    const { res, file } = await edit(JS, { old_string: "     2\t  let sum = 0;", new_string: "  let sum = 1;" }, { read: false });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/read_file trước/);
    expect(file).toBe(JS);
  });
});

describe("edit_file không khớp: chỉ ra dòng lệch", () => {
  it("nhớ sai một dòng trong khối → nêu dòng nào của old_string khác tệp", async () => {
    const { res } = await edit(JS, { old_string: "  let sum = 0;\n\n  for (const x of items) sum += x.cost;\n  return sum;", new_string: "x" });
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/dòng 3 của old_string/);
    expect(res.output).toMatch(/tệp dòng 4: "for \(const x of items\) sum \+= x\.price;"/);
    expect(res.output).toMatch(/không kèm số dòng/);
  });
});

describe("mô tả edit_file", () => {
  it("nhắc không chép số dòng và giữ old_string ngắn", () => {
    const d = builtinTools(new MemoryEnv("/ws", {})).find((t) => t.name === "edit_file")!.description;
    expect(d).toMatch(/line-number prefix/);
    expect(d).toMatch(/short/);
  });
});
