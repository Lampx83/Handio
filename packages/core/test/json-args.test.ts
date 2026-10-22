import { describe, expect, it } from "vitest";
import { parseToolArgs } from "../src/json-args";
import { makeController } from "./helpers";

describe("parseToolArgs: JSON đúng thì giữ nguyên, lỗi vặt của mô hình thì sửa", () => {
  it("JSON đúng: không coi là đã sửa", () => {
    expect(parseToolArgs('{"path":"a.txt","n":2}')).toEqual({ value: { path: "a.txt", n: 2 }, repaired: false });
    expect(parseToolArgs("")).toEqual({ value: {}, repaired: false });
    expect(parseToolArgs("  \n")).toEqual({ value: {}, repaired: false });
  });

  it("xuống dòng và tab thật nằm trong chuỗi (hay gặp khi viết nội dung dài) được thoát lại", () => {
    const r = parseToolArgs('{"path":"a.md","content":"# Tiêu đề\n\nDòng 1\n\tthụt vào"}');
    expect(r.repaired).toBe(true);
    expect(r.value).toEqual({ path: "a.md", content: "# Tiêu đề\n\nDòng 1\n\tthụt vào" });
  });

  it("dấu phẩy thừa trước } và ]", () => {
    const r = parseToolArgs('{"slides":["a","b",],"theme":"cam",}');
    expect(r.repaired).toBe(true);
    expect(r.value).toEqual({ slides: ["a", "b"], theme: "cam" });
  });

  it("bọc trong khối mã ``` hoặc có chữ dẫn trước/sau", () => {
    expect(parseToolArgs('```json\n{"path":"x"}\n```').value).toEqual({ path: "x" });
    expect(parseToolArgs('Đây là lời gọi: {"path":"y"} xong.').value).toEqual({ path: "y" });
  });

  it("thoát sai \\' (không phải escape hợp lệ của JSON)", () => {
    expect(parseToolArgs('{"t":"it\\\'s"}').value).toEqual({ t: "it's" });
  });

  it("dấu phẩy trong chuỗi KHÔNG bị đụng; chuỗi chứa ,} thật được giữ", () => {
    const r = parseToolArgs('{"t":"a,}","u":"b,]",}');
    expect(r.value).toEqual({ t: "a,}", u: "b,]" });
  });

  it("không sửa được thì báo lỗi (JSON bị cắt giữa chừng, không phải object)", () => {
    expect(() => parseToolArgs('{"path":"a","content":"đang viết dở')).toThrow();
    expect(() => parseToolArgs("[1,2]")).toThrow(/object/);
    expect(() => parseToolArgs("không có json")).toThrow();
  });
});

describe("vòng lặp agent với tham số JSON hỏng", () => {
  it("xuống dòng thật trong chuỗi: write_file vẫn chạy, tệp được ghi đúng nội dung (không phải gọi lại)", async () => {
    const { c, env, events } = await makeController(
      [{ calls: [{ name: "write_file", args: {}, raw: '{"path":"bao-cao.md","content":"# Báo cáo\n\nDòng một.\nDòng hai."}' }] }, { text: "Xong." }],
      { settings: { mode: "acceptEdits" } },
    );
    await c.send("viết báo cáo");
    expect(env.snapshot()["/ws/bao-cao.md"]).toBe("# Báo cáo\n\nDòng một.\nDòng hai.");
    expect(events.filter((e: any) => e.type === "tool_result" && e.name === "write_file").every((e: any) => e.ok)).toBe(true);
  });

  it("JSON bị cắt giữa chừng (finish=length): KHÔNG sửa, vẫn báo bad_json kèm hướng dẫn chia nhỏ", async () => {
    const { c, env, events } = await makeController(
      [{ calls: [{ name: "write_file", args: {}, raw: '{"path":"dai.md","content":"nội dung đang viết dở' }], finish: "length" }, { text: "Sẽ chia nhỏ." }],
      { settings: { mode: "acceptEdits" } },
    );
    await c.send("viết tài liệu dài");
    expect(env.snapshot()["/ws/dai.md"]).toBeUndefined();
    const r: any = events.find((e: any) => e.type === "tool_result" && e.name === "write_file");
    expect(r.ok).toBe(false);
    expect(r.errKind).toBe("bad_json");
    expect(r.output).toMatch(/CHIA NHỎ/);
  });
});
