import { describe, expect, it } from "vitest";
import { isTempFile, naturalCompare, sortEntries, splitName, visibleEntries } from "../src/file-list";

describe("tệp tạm/khoá bị ẩn khỏi danh sách", () => {
  it("nhận ra ~$…, .~lock.…#, Thumbs.db, .DS_Store", () => {
    for (const n of ["~$cong-nghe-giao-duc-v9.pptx", "~$bao-cao.docx", ".~lock.so-lieu.xlsx#", "Thumbs.db", "thumbs.db", ".DS_Store", "desktop.ini"]) expect(isTempFile(n), n).toBe(true);
  });
  it("tệp thường, kể cả tên gần giống, vẫn hiện", () => {
    for (const n of ["bao-cao.docx", "~ghi-chu.txt", "a~$b.docx", ".gitignore", ".~lock.txt", "Thumbs.db.txt", "AGENTS.md"]) expect(isTempFile(n), n).toBe(false);
  });
  it("visibleEntries giữ nguyên thứ tự và đối tượng", () => {
    const items = [{ name: "a.docx", isDir: false }, { name: "~$a.docx", isDir: false }, { name: "b", isDir: true }];
    expect(visibleEntries(items)).toEqual([items[0], items[2]]);
  });
});

describe("sắp xếp danh sách tệp", () => {
  const f = (name: string, mtimeMs?: number) => ({ name, isDir: false, mtimeMs });
  const d = (name: string) => ({ name, isDir: true });

  it("tên theo thứ tự tự nhiên: v2 trước v10", () => {
    expect(["v10", "v2", "v1"].sort(naturalCompare)).toEqual(["v1", "v2", "v10"]);
    expect(sortEntries([f("cong-nghe-giao-duc-v10.pptx"), f("cong-nghe-giao-duc-v9.pptx"), f("cong-nghe-giao-duc-v2.pptx")], "name").map((x) => x.name))
      .toEqual(["cong-nghe-giao-duc-v2.pptx", "cong-nghe-giao-duc-v9.pptx", "cong-nghe-giao-duc-v10.pptx"]);
  });
  it("mới sửa lên đầu theo mtimeMs; thư mục luôn đứng trước", () => {
    const out = sortEntries([f("cu.docx", 100), d("tai-lieu"), f("moi.docx", 900), f("giua.docx", 500)], "recent");
    expect(out.map((x) => x.name)).toEqual(["tai-lieu", "moi.docx", "giua.docx", "cu.docx"]);
  });
  it("chưa có mtime: dùng thời điểm agent vừa tạo/sửa; phần còn lại theo tên", () => {
    const touched = new Map([["b.pptx", 2000], ["z.docx", 3000]]);
    const out = sortEntries([f("a.docx"), f("b.pptx"), f("c.xlsx"), f("z.docx")], "recent", (n) => touched.get(n) ?? 0);
    expect(out.map((x) => x.name)).toEqual(["z.docx", "b.pptx", "a.docx", "c.xlsx"]);
  });
  it("theo tên thì bỏ qua độ mới; không làm thay đổi mảng gốc", () => {
    const src = [f("b.docx", 9), f("a.docx", 1)];
    expect(sortEntries(src, "name").map((x) => x.name)).toEqual(["a.docx", "b.docx"]);
    expect(src.map((x) => x.name)).toEqual(["b.docx", "a.docx"]);
  });
});

describe("cắt tên ở giữa", () => {
  it("tên ngắn giữ nguyên", () => {
    expect(splitName("bao-cao.docx")).toEqual({ head: "bao-cao.docx", tail: "" });
  });
  it("tên dài: đuôi gồm phần mở rộng và vài ký tự cuối, đầu và đuôi ghép lại đúng tên", () => {
    const name = "cong-nghe-giao-duc-va-dao-tao-v9.pptx";
    const s = splitName(name);
    expect(s.tail).toBe("o-v9.pptx"); // đuôi .pptx + 4 ký tự trước nó
    expect(s.head + s.tail).toBe(name);
  });
  it("không có phần mở rộng", () => {
    const s = splitName("ghi-chu-rat-dai-khong-co-duoi-mo-rong");
    expect(s.head + s.tail).toBe("ghi-chu-rat-dai-khong-co-duoi-mo-rong");
    expect(s.tail).toBe("rong");
  });
});
