import { describe, expect, it } from "vitest";
import { dirname, isAbsolute, isInside, join, normalize, relative, resolve } from "../src/path";
import { resolveSafe, ToolError, type ToolContext } from "../src";

const ROOT = "E:\\Slide duoc ly  test"; // hai dấu cách liền nhau, như thư mục thật đã gây lỗi

/** Env giả kiểu Windows: realpath trả về dấu "\" và đúng hoa/thường của tệp thật; tệp không có thì lỗi. */
function winCtx(files: string[]): ToolContext {
  const real = new Map<string, string>();
  for (const f of [ROOT, ...files]) real.set(normalize(f).toLowerCase(), f.replace(/\//g, "\\"));
  const env = {
    async realpath(p: string) {
      const hit = real.get(normalize(p).toLowerCase());
      if (!hit) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return hit;
    },
  };
  return { root: ROOT, extraDirs: [], env } as unknown as ToolContext;
}

describe("đường dẫn Windows", () => {
  it("đổi về dấu / và giữ nguyên dấu cách; chuẩn hoá lặp lại không đổi", () => {
    expect(normalize(ROOT + "\\Slide_Duoc_Dong_Hoc.pptx")).toBe("E:/Slide duoc ly  test/Slide_Duoc_Dong_Hoc.pptx");
    expect(normalize("e:\\a\\..\\b\\.\\c")).toBe("E:/b/c");
    expect(normalize("E:\\")).toBe("E:/");
    const n = normalize("e:\\x\\y");
    expect(normalize(n)).toBe(n);
  });

  it("nhận ổ đĩa là đường dẫn tuyệt đối, đường dẫn thường vẫn như cũ", () => {
    expect(isAbsolute("E:\\a")).toBe(true);
    expect(isAbsolute("E:/a")).toBe(true);
    expect(isAbsolute("a:b")).toBe(false); // tên tệp có dấu hai chấm, không phải ổ đĩa
    expect(isAbsolute("src/a.js")).toBe(false);
    expect(normalize("/ws/../a")).toBe("/a");
    expect(resolve("E:\\w", "x.pptx")).toBe("E:/w/x.pptx");
    expect(resolve("E:\\w", "D:\\y\\z")).toBe("D:/y/z");
  });

  it("dirname/join/relative/isInside đúng với ổ đĩa, không phân biệt hoa thường", () => {
    expect(dirname("E:\\a\\b.txt")).toBe("E:/a");
    expect(dirname("E:/a")).toBe("E:/");
    expect(dirname("E:/")).toBe("E:/");
    expect(join("E:\\a", "b", "c.txt")).toBe("E:/a/b/c.txt");
    expect(relative("E:\\a", "e:\\A\\b\\c.txt")).toBe("b/c.txt");
    expect(isInside("E:\\a", "E:\\a\\b")).toBe(true);
    expect(isInside("E:\\a", "e:\\A")).toBe(true);
    expect(isInside("E:\\a", "E:\\ab")).toBe(false);
    expect(isInside("E:\\a", "D:\\a\\b")).toBe(false);
    expect(isInside("E:\\", "E:\\x")).toBe(true);
  });

  it("resolveSafe: tệp tương đối, tuyệt đối và tệp mới trong thư mục dự án đều hợp lệ (lỗi cũ: mọi tệp bị coi là ngoài thư mục)", async () => {
    const ctx = winCtx([ROOT + "\\Slide_Duoc_Dong_Hoc.pptx", ROOT + "\\out"]);
    const want = "E:/Slide duoc ly  test/Slide_Duoc_Dong_Hoc.pptx";
    await expect(resolveSafe(ctx, "Slide_Duoc_Dong_Hoc.pptx")).resolves.toBe(want);
    await expect(resolveSafe(ctx, "./Slide_Duoc_Dong_Hoc.pptx")).resolves.toBe(want);
    await expect(resolveSafe(ctx, ROOT + "\\Slide_Duoc_Dong_Hoc.pptx")).resolves.toBe(want); // mô hình hay gửi đường dẫn đầy đủ
    await expect(resolveSafe(ctx, "e:\\slide duoc ly  test\\Slide_Duoc_Dong_Hoc.pptx")).resolves.toBe(want);
    await expect(resolveSafe(ctx, "out/moi.docx")).resolves.toBe("E:/Slide duoc ly  test/out/moi.docx");
    await expect(resolveSafe(ctx, ".")).resolves.toBe("E:/Slide duoc ly  test");
  });

  it("resolveSafe: vẫn chặn đường dẫn ra ngoài dự án (.., ổ đĩa khác, thư mục cùng tiền tố)", async () => {
    const ctx = winCtx([]);
    for (const p of ["..\\x.docx", "E:\\Slide duoc ly  test\\..\\x.docx", "D:\\x.docx", "E:\\Slide duoc ly  test2\\x.docx", "C:\\Windows\\win.ini"]) {
      await expect(resolveSafe(ctx, p), p).rejects.toThrow(ToolError);
    }
  });
});
