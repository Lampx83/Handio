import { deflateSync } from "node:zlib";
import { PDFDocument, PDFHexString, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";
import { jpegOrientation, parsePageRanges } from "../src/office/tools-pdf";

const mk = () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  return { env, ctx, run: (n: string, a: unknown) => tools.get(n)!.run(ctx, a), tool: (n: string) => tools.get(n)! };
};

/** PDF thử: mỗi trang có một dòng chữ riêng ("Noi dung trang 1 ..."). */
async function makePdf(pages: number, opts: { label?: string; title?: string; author?: string; size?: [number, number]; text?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(opts.size ?? [595.28, 841.89]);
    if (opts.text !== false) page.drawText(`${opts.label ?? "Noi dung"} trang ${i} cua tai lieu thu nghiem`, { x: 40, y: 700, size: 14, font });
  }
  if (opts.title) doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  return doc.save();
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** PNG RGB đơn sắc w×h tự dựng (không cần thư viện ảnh). */
function makePng(w: number, h: number, rgb: [number, number, number] = [30, 120, 200]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 2; // RGB
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

/** JPEG 16×8 màu đỏ (Pillow, chất lượng 50). */
const JPEG_16x8 = Uint8Array.from(Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=",
  "base64",
));
/** Chèn khối EXIF với Orientation = o ngay sau SOI. */
function withOrientation(jpeg: Uint8Array, o: number): Uint8Array {
  const exif = Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD0 ở offset 8
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, // 1 mục: Orientation (SHORT)
    0x00, 0x00, 0x00, 0x00, // hết IFD
  ]);
  const out = new Uint8Array(jpeg.length + exif.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(exif, 2);
  out.set(jpeg.subarray(2), 2 + exif.length);
  return out;
}

const countOf = async (env: MemoryEnv, p: string): Promise<number> => (await PDFDocument.load(await env.readBytes(p))).getPageCount();

describe("pdf: đọc thông tin và chữ", () => {
  it("pdf_info: số trang, khổ A4, tiêu đề/tác giả, không mật khẩu, có lớp chữ", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/bao-cao.pdf", await makePdf(5, { title: "Báo cáo quý", author: "Khoa CNTT" }));
    const r = await run("pdf_info", { path: "bao-cao.pdf" });
    expect(r).toContain("Số trang: 5");
    expect(r).toContain("A4 dọc");
    expect(r).toContain("Báo cáo quý");
    expect(r).toContain("Khoa CNTT");
    expect(r).toContain("Mật khẩu/mã hoá: không");
    expect(r).toContain("Lớp chữ: có");
  });

  it("pdf_info: PDF không có chữ → cảnh báo bản scan, nêu rõ chưa có OCR và dùng read_image", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/scan.pdf", await makePdf(2, { text: false, size: [612, 792] }));
    const r = await run("pdf_info", { path: "scan.pdf" });
    expect(r).toContain("KHÔNG có");
    expect(r).toContain("read_image");
    expect(r).toMatch(/Chưa có OCR/);
    expect(r).toContain("Letter dọc");
  });

  it("pdf_text: theo dải trang, kèm số trang; thứ tự tăng dần", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.pdf", await makePdf(6));
    const r = await run("pdf_text", { path: "a.pdf", pages: "5,2-3" });
    expect(r).toContain("## Trang 2");
    expect(r).toContain("Noi dung trang 3");
    expect(r).toContain("## Trang 5");
    expect(r).not.toContain("Noi dung trang 1 ");
    expect(r).not.toContain("Noi dung trang 4");
    expect(r.indexOf("## Trang 2")).toBeLessThan(r.indexOf("## Trang 5"));
    const all = await run("pdf_text", { path: "a.pdf" });
    expect(all).toContain("## Trang 6");
    expect(await run("pdf_text", { path: "a.pdf", pages: "4-" })).toContain("## Trang 6");
  });

  it("pdf_text: phân trang kết quả dài bằng offset/max_chars", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/dai.pdf", await makePdf(40));
    const first = await run("pdf_text", { path: "dai.pdf", max_chars: 1000 });
    const m = /đọc tiếp bằng offset=(\d+)/.exec(first);
    expect(m).toBeTruthy();
    const second = await run("pdf_text", { path: "dai.pdf", max_chars: 1000, offset: Number(m![1]) });
    expect(second).not.toBe(first);
    expect(second).toContain("## Trang");
  });

  it("pdf_text: trang vượt quá / dải sai báo lỗi tiếng Việt", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.pdf", await makePdf(3));
    await expect(run("pdf_text", { path: "a.pdf", pages: "2-9" })).rejects.toThrow(/nằm ngoài PDF này \(có 3 trang/);
    await expect(run("pdf_text", { path: "a.pdf", pages: "abc" })).rejects.toThrow(/không hợp lệ/);
    await expect(run("pdf_text", { path: "a.pdf", pages: "0" })).rejects.toThrow(/nằm ngoài/);
  });

  it("parsePageRanges: dải mở, giữ thứ tự, 'all'", () => {
    expect(parsePageRanges("1-3, 7", 10)).toEqual([1, 2, 3, 7]);
    expect(parsePageRanges("8-", 10)).toEqual([8, 9, 10]);
    expect(parsePageRanges("7,1", 10)).toEqual([7, 1]);
    expect(parsePageRanges(4, 10)).toEqual([4]);
    expect(parsePageRanges("all", 3)).toEqual([1, 2, 3]);
    expect(() => parsePageRanges("5-2", 10)).toThrow();
  });
});

describe("pdf_split", () => {
  it("tách '1-3,5' thành tệp mới đúng số trang và đúng nội dung; bản gốc không đổi", async () => {
    const { env, run } = mk();
    const orig = await makePdf(6);
    await env.writeBytes("/ws/tai-lieu.pdf", orig);
    const r = await run("pdf_split", { path: "tai-lieu.pdf", ranges: "1-3,5" });
    expect(r).toContain("tai-lieu-tach.pdf");
    expect(await countOf(env, "/ws/tai-lieu-tach.pdf")).toBe(4);
    const text = await run("pdf_text", { path: "tai-lieu-tach.pdf" });
    expect(text).toContain("Noi dung trang 5");
    expect(text).not.toContain("Noi dung trang 4");
    expect(Buffer.from(await env.readBytes("/ws/tai-lieu.pdf")).equals(Buffer.from(orig))).toBe(true);
  });

  it("split_every: mỗi N trang một tệp, tên đánh số", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/x.pdf", await makePdf(5));
    const r = await run("pdf_split", { path: "x.pdf", split_every: 2, output: "phan/p.pdf" });
    expect(r).toContain("3 tệp");
    expect(await countOf(env, "/ws/phan/p-1.pdf")).toBe(2);
    expect(await countOf(env, "/ws/phan/p-2.pdf")).toBe(2);
    expect(await countOf(env, "/ws/phan/p-3.pdf")).toBe(1);
  });

  it("danh sách ranges → mỗi phần một tệp", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/x.pdf", await makePdf(6));
    await run("pdf_split", { path: "x.pdf", ranges: ["1-2", "6"] });
    expect(await countOf(env, "/ws/x-tach-1.pdf")).toBe(2);
    expect(await countOf(env, "/ws/x-tach-2.pdf")).toBe(1);
  });

  it("chặn: quá 50 tệp, thiếu/đủ cả ranges và split_every, trang ngoài phạm vi", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/x.pdf", await makePdf(60));
    await expect(run("pdf_split", { path: "x.pdf", split_every: 1 })).rejects.toThrow(/vượt giới hạn 50/);
    await expect(run("pdf_split", { path: "x.pdf" })).rejects.toThrow(/ranges/);
    await expect(run("pdf_split", { path: "x.pdf", ranges: "1", split_every: 5 })).rejects.toThrow(/một trong hai/);
    await expect(run("pdf_split", { path: "x.pdf", ranges: "50-70" })).rejects.toThrow(/nằm ngoài/);
    expect(await env.stat("/ws/x-tach.pdf")).toBeNull();
  });
});

describe("pdf_merge", () => {
  it("gộp đúng thứ tự (đọc lại bằng pdf_text); ghép cả cùng một tệp hai lần", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.pdf", await makePdf(2, { label: "Alpha" }));
    await env.writeBytes("/ws/b.pdf", await makePdf(1, { label: "Beta" }));
    await env.writeBytes("/ws/c.pdf", await makePdf(2, { label: "Gamma" }));
    const r = await run("pdf_merge", { paths: ["c.pdf", "a.pdf", "b.pdf"], output: "gop.pdf" });
    expect(r).toContain("5 trang");
    const t = await run("pdf_text", { path: "gop.pdf" });
    const order = ["Gamma trang 1", "Gamma trang 2", "Alpha trang 1", "Alpha trang 2", "Beta trang 1"].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    await run("pdf_merge", { paths: JSON.stringify(["a.pdf", "a.pdf"]), output: "aa.pdf" });
    expect(await countOf(env, "/ws/aa.pdf")).toBe(4);
  });

  it("tên mặc định, cần ≥ 2 tệp, không ghi đè đầu vào", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.pdf", await makePdf(1));
    await env.writeBytes("/ws/b.pdf", await makePdf(1));
    await run("pdf_merge", { paths: ["a.pdf", "b.pdf"] });
    expect(await countOf(env, "/ws/a-gop.pdf")).toBe(2);
    await expect(run("pdf_merge", { paths: ["a.pdf"] })).rejects.toThrow(/ít nhất 2/);
    await run("pdf_text", { path: "a.pdf" }); // đã đọc: vẫn không được ghi đè chính đầu vào
    await expect(run("pdf_merge", { paths: ["a.pdf", "b.pdf"], output: "a.pdf" })).rejects.toThrow(/Không ghi đè tệp đầu vào/);
  });
});

describe("pdf_rotate", () => {
  it("xoay tất cả hoặc một số trang; cộng dồn với góc sẵn có; bản gốc giữ nguyên", async () => {
    const { env, run } = mk();
    const orig = await makePdf(3);
    await env.writeBytes("/ws/r.pdf", orig);
    await run("pdf_rotate", { path: "r.pdf", degrees: 90, pages: "2-3", save_as: "r90.pdf" });
    const d = await PDFDocument.load(await env.readBytes("/ws/r90.pdf"));
    expect(d.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 90]);
    await run("pdf_rotate", { path: "r90.pdf", degrees: 270 });
    const d2 = await PDFDocument.load(await env.readBytes("/ws/r90-xoay.pdf"));
    expect(d2.getPages().map((p) => p.getRotation().angle)).toEqual([270, 0, 0]);
    const d3 = await PDFDocument.load(orig);
    expect(d3.getPages().every((p) => p.getRotation().angle === 0)).toBe(true);
    expect(Buffer.from(await env.readBytes("/ws/r.pdf")).equals(Buffer.from(orig))).toBe(true);
  });

  it("degrees sai, và lưu đè lên bản gốc bị từ chối", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/r.pdf", await makePdf(1));
    await expect(run("pdf_rotate", { path: "r.pdf", degrees: 45 })).rejects.toThrow(/90, 180 hoặc 270/);
    await run("pdf_text", { path: "r.pdf" });
    await expect(run("pdf_rotate", { path: "r.pdf", degrees: 90, save_as: "r.pdf" })).rejects.toThrow(/Không ghi đè bản gốc/);
  });
});

describe("images_to_pdf", () => {
  it("ghép PNG + JPG: một ảnh một trang, A4 giữ tỉ lệ và căn giữa", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.png", makePng(40, 80));
    await env.writeBytes("/ws/b.jpg", JPEG_16x8);
    const r = await run("images_to_pdf", { paths: ["a.png", "b.jpg"], output: "anh.pdf" });
    expect(r).toContain("2 trang");
    const d = await PDFDocument.load(await env.readBytes("/ws/anh.pdf"));
    expect(d.getPageCount()).toBe(2);
    const [p1, p2] = d.getPages().map((p) => p.getSize());
    expect(p1.width).toBeCloseTo(595.28, 1); // ảnh đứng → A4 dọc
    expect(p1.height).toBeCloseTo(841.89, 1);
    expect(p2.width).toBeCloseTo(841.89, 1); // ảnh ngang → A4 ngang
    expect(p2.height).toBeCloseTo(595.28, 1);
  });

  it("page_size 'fit': trang đúng cỡ ảnh; mặc định đặt tên -ghep.pdf", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/hinh1.png", makePng(20, 10));
    await run("images_to_pdf", { paths: ["hinh1.png"], page_size: "fit" });
    const d = await PDFDocument.load(await env.readBytes("/ws/hinh1-ghep.pdf"));
    expect(d.getPage(0).getSize()).toEqual({ width: 20, height: 10 });
  });

  it("EXIF xoay (ảnh chụp từ điện thoại): hướng 6 đổi chiều trang, nội dung được xoay đúng", async () => {
    const { env, run } = mk();
    expect(jpegOrientation(withOrientation(JPEG_16x8, 6))).toBe(6);
    expect(jpegOrientation(JPEG_16x8)).toBe(1);
    await env.writeBytes("/ws/dt.jpg", withOrientation(JPEG_16x8, 6));
    await run("images_to_pdf", { paths: ["dt.jpg"], output: "dt.pdf", page_size: "fit" });
    const d = await PDFDocument.load(await env.readBytes("/ws/dt.pdf"));
    expect(d.getPage(0).getSize()).toEqual({ width: 8, height: 16 }); // 16×8 lưu, hiển thị 8×16
  });

  it("từ chối: GIF, tệp không phải ảnh, page_size lạ, ghi đè ảnh, tệp không có", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/g.gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]));
    await env.writeText("/ws/t.png", "không phải ảnh");
    await env.writeBytes("/ws/a.png", makePng(4, 4));
    await expect(run("images_to_pdf", { paths: ["g.gif"] })).rejects.toThrow(/GIF chưa ghép được/);
    await expect(run("images_to_pdf", { paths: ["t.png"] })).rejects.toThrow(/không phải ảnh PNG\/JPG/);
    await expect(run("images_to_pdf", { paths: ["a.png"], page_size: "a3" })).rejects.toThrow(/a4/);
    await expect(run("images_to_pdf", { paths: ["a.png"], output: "a.png" })).rejects.toThrow(/đuôi \.pdf/);
    await expect(run("images_to_pdf", { paths: ["khong-co.png"] })).rejects.toThrow(/Không có tệp/);
  });
});

describe("pdf: an toàn ghi tệp và lỗi đầu vào", () => {
  it("không ghi đè tệp có sẵn chưa đọc; ghi đè được khi đã đọc, có hoàn tác", async () => {
    const { env, ctx, run } = mk();
    await env.writeBytes("/ws/src.pdf", await makePdf(3));
    await env.writeBytes("/ws/cua-toi.pdf", await makePdf(1, { label: "Quan trong" }));
    await expect(run("pdf_split", { path: "src.pdf", ranges: "1", output: "cua-toi.pdf" })).rejects.toThrow(/đã tồn tại/);
    expect((await run("pdf_text", { path: "cua-toi.pdf" })).includes("Quan trong")).toBe(true); // vẫn nguyên
    await run("pdf_text", { path: "cua-toi.pdf" }); // đã đọc
    const before = ctx.undoStack.length;
    await run("pdf_split", { path: "src.pdf", ranges: "1-2", output: "cua-toi.pdf" });
    expect(await countOf(env, "/ws/cua-toi.pdf")).toBe(2);
    expect(ctx.undoStack.length).toBe(before + 1);
    expect(ctx.undoStack[before].old).not.toBeNull();
  });

  it("chính phiên này vừa tạo thì ghi đè lại được; bản gốc thì không bao giờ", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/src.pdf", await makePdf(4));
    await run("pdf_split", { path: "src.pdf", ranges: "1", output: "kq.pdf" });
    await run("pdf_split", { path: "src.pdf", ranges: "1-3", output: "kq.pdf" });
    expect(await countOf(env, "/ws/kq.pdf")).toBe(3);
    await run("pdf_text", { path: "src.pdf" });
    await expect(run("pdf_split", { path: "src.pdf", ranges: "1-2", output: "src.pdf" })).rejects.toThrow(/Không ghi đè bản gốc/);
    expect(await countOf(env, "/ws/src.pdf")).toBe(4);
  });

  it("đường dẫn ra ngoài dự án bị chặn ở mọi công cụ", async () => {
    const { env, run } = mk();
    await env.writeBytes("/ws/a.pdf", await makePdf(2));
    await env.writeBytes("/ws/a.png", makePng(4, 4));
    const out = /nằm ngoài thư mục dự án/;
    await expect(run("pdf_info", { path: "../etc/x.pdf" })).rejects.toThrow(out);
    await expect(run("pdf_text", { path: "/etc/x.pdf" })).rejects.toThrow(out);
    await expect(run("pdf_split", { path: "a.pdf", ranges: "1", output: "../ngoai.pdf" })).rejects.toThrow(out);
    await expect(run("pdf_merge", { paths: ["a.pdf", "../b.pdf"], output: "g.pdf" })).rejects.toThrow(out);
    await expect(run("pdf_merge", { paths: ["a.pdf", "a.pdf"], output: "../g.pdf" })).rejects.toThrow(out);
    await expect(run("pdf_rotate", { path: "a.pdf", degrees: 90, save_as: "/tmp/r.pdf" })).rejects.toThrow(out);
    await expect(run("images_to_pdf", { paths: ["../a.png"] })).rejects.toThrow(out);
    await expect(run("images_to_pdf", { paths: ["a.png"], output: "../a.pdf" })).rejects.toThrow(out);
  });

  it("PDF hỏng, sai định dạng, quá lớn: lỗi tiếng Việt rõ ràng", async () => {
    const { env, run } = mk();
    await env.writeText("/ws/text.pdf", "đây chỉ là văn bản, không phải PDF");
    await env.writeBytes("/ws/hong.pdf", new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n(cắt cụt"));
    await env.writeText("/ws/a.docx", "x");
    for (const n of ["pdf_info", "pdf_text"]) await expect(run(n, { path: "text.pdf" })).rejects.toThrow(/không phải tệp PDF hợp lệ/);
    for (const n of ["pdf_info", "pdf_text"]) await expect(run(n, { path: "hong.pdf" })).rejects.toThrow(/hỏng hoặc không đọc được/);
    await expect(run("pdf_split", { path: "hong.pdf", ranges: "1" })).rejects.toThrow(/hỏng hoặc không đọc được/);
    await expect(run("pdf_rotate", { path: "hong.pdf", degrees: 90 })).rejects.toThrow(/hỏng hoặc không đọc được/);
    await expect(run("pdf_merge", { paths: ["hong.pdf", "text.pdf"] })).rejects.toThrow(/PDF/);
    await expect(run("pdf_info", { path: "a.docx" })).rejects.toThrow(/chỉ dùng cho \.pdf/);
    await expect(run("pdf_info", { path: "khong-co.pdf" })).rejects.toThrow(/Không có tệp/);
    const big = mk();
    big.env.stat = async () => ({ isFile: true, isDir: false, size: 61 * 1048576, mtimeMs: 1 }) as never;
    await expect(big.run("pdf_text", { path: "to.pdf" })).rejects.toThrow(/quá lớn \(61 MB, giới hạn 60 MB\)/);
  });

  it("PDF có mật khẩu: lỗi rõ ràng, không cố bẻ khoá", async () => {
    const { env, run } = mk();
    // PDF thật + từ điển /Encrypt giả (O/U không khớp mật khẩu rỗng) → coi như có mật khẩu
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText("bi mat", { x: 10, y: 100, size: 12 });
    const enc = doc.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFHexString.of("00".repeat(32)), U: PDFHexString.of("11".repeat(32)), P: -44 });
    doc.context.trailerInfo.Encrypt = doc.context.register(enc);
    doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of("aa".repeat(16)), PDFHexString.of("aa".repeat(16))]);
    await env.writeBytes("/ws/kin.pdf", await doc.save({ useObjectStreams: false }));
    await expect(run("pdf_split", { path: "kin.pdf", ranges: "1" })).rejects.toThrow(/mật khẩu.*không gỡ được mật khẩu/s);
    await expect(run("pdf_rotate", { path: "kin.pdf", degrees: 90 })).rejects.toThrow(/mật khẩu/);
    await expect(run("pdf_merge", { paths: ["kin.pdf", "kin.pdf"] })).rejects.toThrow(/mật khẩu/);
    await expect(run("pdf_text", { path: "kin.pdf" })).rejects.toThrow(/mật khẩu/);
    await expect(run("pdf_info", { path: "kin.pdf" })).rejects.toThrow(/mật khẩu/);
  });

  it("khai báo công cụ: tên cố định, ghi = edit/không readonly, đọc = read/readonly, có đích ghi đúng", () => {
    const { tool } = mk();
    for (const n of ["pdf_info", "pdf_text"]) expect([tool(n).kind, tool(n).readonly]).toEqual(["read", true]);
    for (const n of ["pdf_split", "pdf_merge", "pdf_rotate", "images_to_pdf"]) expect([tool(n).kind, tool(n).readonly]).toEqual(["edit", false]);
    expect(tool("pdf_split").targetPath!({ path: "d/a.pdf" })).toBe("d/a-tach.pdf");
    expect(tool("pdf_merge").targetPath!({ paths: ["d/a.pdf", "b.pdf"] })).toBe("d/a-gop.pdf");
    expect(tool("pdf_rotate").targetPath!({ path: "a.pdf", save_as: "z.pdf" })).toBe("z.pdf");
    expect(tool("pdf_rotate").targetPath!({ path: "a.pdf" })).toBe("a-xoay.pdf");
    expect(tool("images_to_pdf").targetPath!({ paths: ["x/p.png"] })).toBe("x/p-ghep.pdf");
  });
});
