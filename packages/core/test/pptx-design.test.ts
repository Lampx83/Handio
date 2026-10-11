import { describe, expect, it } from "vitest";
import { createPptx, loadZip, parseSlides, pickTheme, pptxImageRefs, readPptx } from "../src/office";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

describe("PowerPoint: bố cục và chủ đề", () => {
  it("chủ đề: tên không dấu/đồng nghĩa nhận được, tên lạ cảnh báo và dùng xanh", async () => {
    expect(pickTheme("Xanh ngọc").key).toBe("ngoc");
    expect(pickTheme("teal").key).toBe("ngoc");
    expect(pickTheme(undefined)).toMatchObject({ key: "xanh", known: true });
    const r = await createPptx({ content: "## A\n- b", theme: "cầu vồng" });
    expect(r.warnings.join()).toContain("cầu vồng");
  });

  it("tiêu đề là placeholder thật (đọc lại có nhãn 'Slide N: tiêu đề')", async () => {
    const r = await createPptx({ content: "# Bìa\nPhụ đề\n\n---\n\n## Nội dung chính\n- Ý một\n- Ý hai" });
    const back = await readPptx(r.bytes);
    expect(back.map((b) => b.label)).toEqual(["Slide 1: Bìa", "Slide 2: Nội dung chính"]);
  });

  it("các bố cục tự chọn vẫn giữ đủ chữ khi đọc lại", async () => {
    const md = [
      "# Bìa\nDòng phụ", "## 1. Mở đầu\nVì sao cần",
      "## Số liệu\n- 92%: sinh viên dùng hằng tuần\n- 1.200: bài giảng\n- 4,6/5: điểm hài lòng",
      "## Trụ cột\n- **Hạ tầng**: máy chủ và mạng\n- **Dữ liệu**: danh mục dùng chung\n- **Con người**: bồi dưỡng kỹ năng",
      "## Lộ trình\n1. Khảo sát: đánh giá hiện trạng\n2. Thiết kế: xây dựng kiến trúc\n3. Triển khai: chạy thử",
      "> Câu trích dẫn rất đáng nhớ\n\nNguồn: một giảng viên",
      "# Cảm ơn\nliên hệ: a@example.com",
    ].join("\n\n---\n\n");
    const r = await createPptx({ content: md });
    expect(r.slides).toBe(7);
    expect(r.warnings).toEqual([]);
    const text = (await readPptx(r.bytes)).map((b) => b.text).join("\n");
    for (const s of ["92%", "sinh viên dùng hằng tuần", "4,6/5", "Hạ tầng", "máy chủ và mạng", "Khảo sát", "đánh giá hiện trạng", "Câu trích dẫn rất đáng nhớ", "Nguồn: một giảng viên", "a@example.com"]) expect(text).toContain(s);
  });

  it("ảnh: có tệp thì nhúng, thiếu tệp thì khung chữ + cảnh báo; liệt kê được đường dẫn ảnh", async () => {
    const md = "## Ảnh\n![Logo trường](logo.png)\n\n---\n\n## Thiếu\n![Không có](khong-co.png)";
    expect(pptxImageRefs(md)).toEqual(["logo.png", "khong-co.png"]);
    expect(parseSlides(md)[0].blocks[0]).toMatchObject({ t: "image", alt: "Logo trường", src: "logo.png" });
    const r = await createPptx({ content: md, images: { "logo.png": PNG } });
    expect(r.warnings.join()).toContain("khong-co.png");
    expect(r.warnings.join()).not.toContain("logo.png");
    const zip = await loadZip(r.bytes);
    expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
  });

  it("cảnh báo tràn vẫn hoạt động ở bố cục mặc định", async () => {
    const r = await createPptx({ content: "## Dài\n\n" + Array.from({ length: 30 }, (_, i) => `- Ý số ${i} khá dài để chiếm nhiều chỗ trên slide này nhằm thử cảnh báo tràn`).join("\n") });
    expect(r.warnings.join()).toContain("tràn");
  });
});
