import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dropPristineSamples } from "../src/samples";

let dir = "";
beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), "neu-sample-"))));
afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

const SAMPLE = { "README.md": "# Mẫu\n", "src/util.py": "def add(a, b):\n    return a + b\n", "du-lieu/diem.xlsx": new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) } as Record<string, string | Uint8Array>;
const put = async (rel: string, c: string | Uint8Array) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), c);
};
const exists = (rel: string) => fs.stat(path.join(dir, rel)).then(() => true, () => false);

describe("dọn dữ liệu mẫu của bản cài cũ", () => {
  it("xoá tệp còn nguyên như mẫu, kể cả thư mục con rỗng; chừa lại tệp của người dùng", async () => {
    for (const [k, v] of Object.entries(SAMPLE)) await put(k, v);
    await put("ghi-chu-cua-toi.md", "việc của tôi");
    expect(await dropPristineSamples(SAMPLE, dir)).toBe(3);
    expect(await exists("README.md")).toBe(false);
    expect(await exists("src")).toBe(false);
    expect(await exists("du-lieu")).toBe(false);
    expect(await exists("ghi-chu-cua-toi.md")).toBe(true);
  });

  it("tệp mẫu mà người dùng đã sửa thì giữ nguyên (cùng thư mục chứa nó)", async () => {
    await put("README.md", "# Mẫu của tôi, đã sửa\n");
    await put("src/util.py", SAMPLE["src/util.py"]);
    await put("du-lieu/diem.xlsx", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    expect(await dropPristineSamples(SAMPLE, dir)).toBe(1);
    expect(await exists("README.md")).toBe(true);
    expect(await exists("src/util.py")).toBe(false);
    expect(await exists("du-lieu/diem.xlsx")).toBe(true);
  });

  it("tệp Office chỉ lệch vài byte (dấu thời gian) vẫn tính là nguyên bản; thư mục có tệp khác không bị xoá", async () => {
    await put("du-lieu/diem.xlsx", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    await put("du-lieu/cua-toi.txt", "x");
    expect(await dropPristineSamples(SAMPLE, dir)).toBe(1);
    expect(await exists("du-lieu/diem.xlsx")).toBe(false);
    expect(await exists("du-lieu/cua-toi.txt")).toBe(true);
  });

  it("không đụng tới thư mục chưa có, không đi ra ngoài thư mục dự án", async () => {
    expect(await dropPristineSamples(SAMPLE, path.join(dir, "khong-co"))).toBe(0);
    const outside = path.join(path.dirname(dir), "neu-outside-" + path.basename(dir));
    await fs.writeFile(outside, "x");
    try {
      expect(await dropPristineSamples({ ["../" + path.basename(outside)]: "x" }, dir)).toBe(0);
      expect(await fs.readFile(outside, "utf8")).toBe("x");
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});
