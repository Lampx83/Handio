import { describe, expect, it } from "vitest";
import { MemoryEnv, builtinTools, office, type ToolContext } from "../src";

const { createPptx, readPptx } = office;

const mk = () => {
  const env = new MemoryEnv("/ws", {});
  const ctx: ToolContext = { env, root: "/ws", extraDirs: [], readFiles: new Map(), undoStack: [], todos: [] };
  const tools = new Map([...builtinTools(env), ...office.officeTools(env)].map((t) => [t.name, t]));
  const run = (n: string, a: unknown) => tools.get(n)!.run(ctx, a) as Promise<string>;
  const read = async (p: string) => (await readPptx(await env.readBytes("/ws/" + p))).map((s) => s.label + "\n" + s.text);
  const labels = async (p: string) => (await readPptx(await env.readBytes("/ws/" + p))).map((s) => s.label);
  return { env, ctx, run, read, labels, tools };
};

const titlesOf = async (bytes: Uint8Array) => (await readPptx(bytes)).map((s) => s.label.replace(/^Slide \d+:?\s*/, ""));

// ---- nội dung rút gọn từ hội thoại thật (công nghệ lượng tử, NSAIDs) ----
const COVER_H2 = "# Công nghệ lượng tử\n## Những nguyên lý cơ bản\n\n---\n\n## 1. Công nghệ lượng tử là gì?\n- Khoa học về lượng tử\n- Khai thác hiện tượng mới\n\n---\n\n## 2. Qubit\n- Đơn vị cơ bản\n- Có thể là 0 và 1\n\n---\n\n## 3. Kết luận\n- Còn ở giai đoạn đầu\n- Cần đầu tư\n";
const SECTIONS = "# Công Nghệ Lượng Tử\nNhững nguyên lý cơ bản\nNgày 11/10/2026\n\n## Công Nghệ Lượng Tử Là Gì?\nLĩnh vực khoa học nghiên cứu nguyên lý lượng tử\nKhai thác hiện tượng lượng tử để tạo công nghệ mới\nKhác biệt hoàn toàn so với công nghệ cổ điển\n\n## Nguyên Lý Cơ Bản\n**Chồng chập**\n- Qubit có thể là 0 và 1\n\n**Vướng víu**\n- Hai hạt liên kết với nhau\n\n## Thách Thức\n- **Nhiệt độ**: cần làm lạnh sâu\n- **Chi phí**: hạ tầng đắt\n- **Nhân lực**: thiếu chuyên gia\n\n## Cảm ơn\nQ&A\n";
const manySections = (n: number) => "# Chủ đề\nPhụ đề\n\n" + Array.from({ length: n }, (_, i) => `## Mục ${i + 1}\n- ý a${i}\n- ý b${i}\n- ý c${i}`).join("\n\n");

describe("lỗi 2: slide trống từ `# Tiêu đề` + `## Phụ đề` + `---`", () => {
  it("dòng `##` ngay sau `#` là phụ đề của bìa, không sinh slide trống/“Tổng quan”", async () => {
    const r = await createPptx({ content: COVER_H2, title: "Công nghệ lượng tử", subtitle: "Những nguyên lý cơ bản" });
    const back = await readPptx(r.bytes);
    for (const s of back) expect(s.text.trim(), s.label).not.toBe("");
    expect(back.map((b) => b.label).join("|")).not.toContain("Tổng quan");
    expect(back[0].text).toContain("Những nguyên lý cơ bản");
    expect(back.length).toBe(5); // bìa + 3 nội dung + cảm ơn
  });
  it("bìa có `##` và `###` liền nhau: cả hai là dòng phụ", () => {
    const s = office.parseSlides("# Tên bài\n## Bài giảng cho sinh viên\n### Ngày 11/10/2026\n\n---\n\n## Một\n- a");
    expect(s[0].cover).toBe(true);
    expect(s[0].blocks.map((b) => (b.t === "para" ? b.runs.map((r) => r.text).join("") : b.t))).toEqual(["Bài giảng cho sinh viên", "Ngày 11/10/2026"]);
  });
});

describe("lỗi 3: nhiều `##` không có `---`", () => {
  it("mỗi `##` sau khối `#` là một slide mới; dòng liền nhau thành ý riêng", async () => {
    const r = await createPptx({ content: SECTIONS, title: "Công Nghệ Lượng Tử" });
    const back = await readPptx(r.bytes);
    expect(await titlesOf(r.bytes)).toEqual(["Công Nghệ Lượng Tử", "Công Nghệ Lượng Tử Là Gì?", "Nguyên Lý Cơ Bản", "Thách Thức", "Cảm ơn"]);
    const lines = back[1].text.split("\n");
    expect(lines).toContain("Lĩnh vực khoa học nghiên cứu nguyên lý lượng tử");
    expect(lines).toContain("Khác biệt hoàn toàn so với công nghệ cổ điển");
    expect(back[0].text).toContain("Những nguyên lý cơ bản");
    expect(back[0].text).toContain("Ngày 11/10/2026");
  });
  it("tiêu đề chép từ read_document (“Slide 5: …”) được bỏ nhãn", async () => {
    const r = await createPptx({ content: "# Bìa\nPhụ đề\n\n## Slide 2: Mở đầu\n- a\n- b\n\n## Slide 3: Kết quả\n- c\n- d", auto: false });
    expect(await titlesOf(r.bytes)).toEqual(["Bìa", "Mở đầu", "Kết quả"]);
  });
});

describe("lỗi 1: slide_count", () => {
  it("đạt đúng số slide (gồm bìa và cảm ơn), không mục lục, một cảnh báo ngắn", async () => {
    const r = await createPptx({ content: manySections(10), slideCount: 10 });
    expect(r.slides).toBe(10);
    const t = await titlesOf(r.bytes);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe("Chủ đề");
    expect(t[9]).toMatch(/Cảm ơn/);
    expect(t.join("|")).not.toMatch(/Nội dung chính/);
    expect(r.warnings.length).toBeLessThanOrEqual(1);
    expect(r.warnings.join("").length).toBeLessThan(160);
  });
  it("không tách slide danh sách dài khi có slide_count", async () => {
    const long = "# Bài\nPhụ đề\n\n## Dài\n" + Array.from({ length: 9 }, (_, i) => `- ý số ${i + 1}`).join("\n") + "\n\n## Ngắn\n- a\n- b";
    const r = await createPptx({ content: long, slideCount: 4 });
    expect(r.slides).toBe(4);
    expect((await titlesOf(r.bytes)).join("|")).not.toMatch(/\(1\/\d\)/);
  });
  it("có chỗ và từ 8 slide: thêm mục lục để đủ số; dưới 8 thì không", async () => {
    const eight = await createPptx({ content: manySections(5), slideCount: 8 });
    expect(eight.slides).toBe(8);
    expect(await titlesOf(eight.bytes)).toContain("Nội dung chính");
    const seven = await createPptx({ content: manySections(5), slideCount: 7 });
    expect(seven.slides).toBe(7);
    expect(await titlesOf(seven.bytes)).not.toContain("Nội dung chính");
  });
  it("nội dung ít hơn chỗ: không bịa slide, báo thiếu bằng một dòng", async () => {
    const r = await createPptx({ content: manySections(2), slideCount: 9 });
    expect(r.slides).toBeLessThan(9);
    expect(r.warnings.join(" ")).toMatch(/thiếu|chỉ có/i);
  });
  it("gộp slide: tiêu đề gộp không lặp số thứ tự", async () => {
    const r = await createPptx({ content: "# Bài\nPhụ đề\n\n## 1. Một\n- a\n\n## 2. Hai\n- b\n\n## 3. Ba\n- c", slideCount: 4 });
    const t = await titlesOf(r.bytes);
    expect(t).toHaveLength(4);
    expect(t.join("|")).toMatch(/\d\. [^|&]+ & [^\d|]/);
  });
  it("công cụ create_pptx nhận slide_count", async () => {
    const { run, labels } = mk();
    const out = await run("create_pptx", { path: "a.pptx", content: manySections(10), slide_count: 10 });
    expect(out).toContain("10 slide");
    expect(await labels("a.pptx")).toHaveLength(10);
  });
});

describe("lỗi 4: pptx_edit set_body / add_slides / replacements dễ tính", () => {
  const DECK = "# Báo cáo năm học\nKhoa Dược\n\n---\n\n## Mở đầu\n- **Hạ** tầng đã nâng cấp\n- Dữ liệu dùng chung\n\nGhi chú: nhắc Hạ tầng\n\n---\n\n## Kết quả\n- Đạt 92%\n- Vượt kế hoạch\n\n---\n\n# Cảm ơn\nHỏi đáp";
  const LONG = "# Bài\nPhụ đề\n\n---\n\n## Danh sách dài\n" + ["Mục một của danh sách khá dài để không thành thẻ", "Mục hai của danh sách khá dài để không thành thẻ", "Mục ba của danh sách khá dài để không thành thẻ", "Mục bốn của danh sách khá dài để không thành thẻ", "Mục năm của danh sách khá dài để không thành thẻ", "Mục sáu của danh sách khá dài để không thành thẻ", "Mục bảy có \"trích dẫn\" ở đây", "Hai dòng cùng đoạn"].map((x) => `- ${x}`).join("\n") + "\n";
  const deck = async (content = DECK, theme = "cam", auto?: boolean) => {
    const m = mk();
    await m.run("create_pptx", { path: "bc.pptx", content, theme, auto });
    await m.run("read_document", { path: "bc.pptx" });
    return m;
  };

  it("set_body thay cả phần thân, giữ tiêu đề, bố cục, chủ đề và ghi chú", async () => {
    const { run, read, env } = await deck();
    const r = await run("pptx_edit", { path: "bc.pptx", set_body: [{ slide: 2, text: "Ý mới một\n- Ý mới hai\n- Ý mới ba\n  - Ý con" }] });
    expect(r).toContain("Mở đầu");
    const back = await read("bc.pptx");
    expect(back).toHaveLength(4);
    expect(back[1]).toContain("Slide 2: Mở đầu");
    expect(back[1]).toContain("Ý mới một");
    expect(back[1]).toContain("Ý mới hai");
    expect(back[1]).toContain("Ý con");
    expect(back[1]).not.toContain("Dữ liệu dùng chung");
    expect(back[1]).toContain("[Ghi chú người trình bày] nhắc Hạ tầng");
    const zip = await office.loadZip(await env.readBytes("/ws/bc.pptx"));
    const s2 = await zip.file((await office.slideOrder(zip))[1])!.async("string");
    expect(s2).toContain("7A2A08"); // màu tiêu đề của chủ đề cam vẫn còn
  });

  it("set_body trên tệp không do bộ dựng tạo: sửa tại chỗ khung chữ thân, giữ gạch đầu dòng của đoạn", async () => {
    const { run, read, env } = await deck(LONG, "cam", false);
    // giả làm tệp từ PowerPoint: bỏ dấu nhận biết bảng màu của bộ dựng
    const zip = await office.loadZip(await env.readBytes("/ws/bc.pptx"));
    const th = Object.keys(zip.files).find((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))!;
    zip.file(th, (await zip.file(th)!.async("string")).replace(/clrScheme name="[^"]*"/, 'clrScheme name="Office"'));
    await env.writeBytes("/ws/ngoai.pptx", await zip.generateAsync({ type: "uint8array" }));
    await run("read_document", { path: "ngoai.pptx" });
    await run("pptx_edit", { path: "ngoai.pptx", set_body: [{ slide: 2, text: "Ý một\nÝ hai\n  Ý con\nÝ ba" }] });
    const back = await read("ngoai.pptx");
    expect(back[1]).toContain("Danh sách dài");
    expect(back[1]).toContain("Ý hai");
    expect(back[1]).toContain("  - Ý con");
    expect(back[1]).not.toContain("Mục bảy");
    // vẫn là tệp hợp lệ để sửa tiếp
    await run("read_document", { path: "ngoai.pptx" });
    await run("pptx_edit", { path: "ngoai.pptx", set_title: [{ slide: 2, text: "Tiêu đề mới" }] });
    expect((await read("ngoai.pptx"))[1]).toContain("Tiêu đề mới");
  });

  it("set_body trên slide danh sách dài do bộ dựng tạo: dựng lại đúng bố cục theo nội dung mới", async () => {
    const { run, read } = await deck(LONG, "cam", false);
    await run("pptx_edit", { path: "bc.pptx", set_body: [{ slide: 2, text: "Ý một\nÝ hai\nÝ ba" }] });
    const back = await read("bc.pptx");
    expect(back[1]).toContain("Danh sách dài");
    expect(back[1]).toContain("Ý ba");
    expect(back[1]).not.toContain("Mục bảy");
  });

  it("add_slides chèn slide đúng chủ đề sau slide N; ghi chú đi theo", async () => {
    const { run, read, env } = await deck();
    const r = await run("pptx_edit", { path: "bc.pptx", add_slides: { after: 2, content: "## Tiến độ\n- Quý 1: xong\n- Quý 2: đang làm\n\nGhi chú: nhắc mốc" } });
    expect(r).toContain("5 slide");
    const back = await read("bc.pptx");
    expect(back.map((b) => b.split("\n")[0])).toEqual(["Slide 1: Báo cáo năm học", "Slide 2: Mở đầu", "Slide 3: Tiến độ", "Slide 4: Kết quả", "Slide 5: Cảm ơn"]);
    expect(back[2]).toContain("Quý 1: xong");
    expect(back[2]).toContain("[Ghi chú người trình bày] nhắc mốc");
    const zip = await office.loadZip(await env.readBytes("/ws/bc.pptx"));
    const s3 = await zip.file((await office.slideOrder(zip))[2])!.async("string");
    expect(s3).toContain("7A2A08");
  });

  it("add_slides ở cuối: nội dung thường nằm trước slide cảm ơn; có kết luận/cảm ơn riêng thì đúng cuối", async () => {
    const { run, labels } = await deck();
    await run("pptx_edit", { path: "bc.pptx", add_slides: { after: "end", content: "## Phụ lục\n- p1\n- p2" } });
    expect((await labels("bc.pptx")).slice(-2)).toEqual(["Slide 4: Phụ lục", "Slide 5: Cảm ơn"]);
    await run("read_document", { path: "bc.pptx" });
    await run("pptx_edit", { path: "bc.pptx", add_slides: [{ after: "end", content: "## Kết luận\n- k1\n- k2\n\n---\n\n# Cảm ơn lần nữa\nHỏi đáp" }] });
    const l = await labels("bc.pptx");
    expect(l[l.length - 1]).toContain("Cảm ơn lần nữa");
    expect(l[l.length - 2]).toContain("Kết luận");
  });

  it("add_slides vào tệp không do bộ dựng tạo: dùng bố cục có sẵn, nền slide đặt rõ, tệp vẫn hợp lệ", async () => {
    const { run, read, env } = await deck();
    const zip = await office.loadZip(await env.readBytes("/ws/bc.pptx"));
    // bỏ tên bố cục của bộ dựng và tên bảng màu: giống tệp tạo ở nơi khác
    for (const n of Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f))) zip.file(n, (await zip.file(n)!.async("string")).replace(/<p:cSld name="[^"]*"/, '<p:cSld name="Khác"'));
    const th = Object.keys(zip.files).find((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))!;
    zip.file(th, (await zip.file(th)!.async("string")).replace(/clrScheme name="[^"]*"/, 'clrScheme name="Office"'));
    await env.writeBytes("/ws/la.pptx", await zip.generateAsync({ type: "uint8array" }));
    await run("read_document", { path: "la.pptx" });
    await run("pptx_edit", { path: "la.pptx", add_slides: { after: 1, content: "## Mới\n- ý một\n- ý hai\n\nGhi chú: nhắc" } });
    const back = await read("la.pptx");
    expect(back).toHaveLength(5);
    expect(back[1]).toContain("Slide 2: Mới");
    expect(back[1]).toContain("ý hai");
    const z2 = await office.loadZip(await env.readBytes("/ws/la.pptx"));
    const s2 = await z2.file((await office.slideOrder(z2))[1])!.async("string");
    expect(s2).toContain("<p:bg>");
  });

  it("add_slides có biểu đồ: tệp vẫn đọc lại được", async () => {
    const { run, read } = await deck();
    await run("pptx_edit", { path: "bc.pptx", add_slides: { after: 3, content: "## Số liệu\n\n```chart cột\n| x | y |\n|---|---|\n| a | 1 |\n| b | 2 |\n```\n\n- ghi chú nhỏ" } });
    const back = await read("bc.pptx");
    expect(back.join("\n")).toContain("Biểu đồ cột");
    expect(back).toHaveLength(5);
  });

  it("replacements: bỏ qua gạch đầu dòng/số thứ tự, xuống dòng trải nhiều đoạn, ngoặc kép cong", async () => {
    const { run, read } = await deck(LONG, "cam", false);
    // trải 2 đoạn, kèm dấu gạch đầu dòng và xuống dòng
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "- Mục hai của danh sách khá dài để không thành thẻ\n- Mục ba của danh sách khá dài để không thành thẻ", replace: "Hai và ba đã gộp" }] });
    let t = (await read("bc.pptx"))[1];
    expect(t).toContain("Hai và ba đã gộp");
    expect(t).not.toContain("Mục hai của");
    expect(t).toContain("Mục một của");
    expect(t).toContain("Mục bốn của");
    await run("read_document", { path: "bc.pptx" });
    // ngoặc kép cong ↔ thẳng, số thứ tự đầu dòng
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "1. Mục bảy có “trích dẫn” ở đây", replace: "Mục bảy đã đổi" }] });
    t = (await read("bc.pptx"))[1];
    expect(t).toContain("Mục bảy đã đổi");
    await run("read_document", { path: "bc.pptx" });
    // xuống dòng nằm trong cùng một đoạn
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Hai dòng\ncùng đoạn", replace: "Một dòng" }] });
    expect((await read("bc.pptx"))[1]).toContain("Một dòng");
  });

  it("replacements: thay bằng nhiều dòng tách thành nhiều đoạn", async () => {
    const { run, read } = await deck(LONG, "cam", false);
    await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Mục bốn của danh sách khá dài để không thành thẻ", replace: "- Dòng X\n- Dòng Y" }] });
    const lines = (await read("bc.pptx"))[1].split("\n");
    expect(lines).toContain("- Dòng X");
    expect(lines).toContain("- Dòng Y");
  });

  it("không tìm thấy: lỗi ngắn (≤ 3 dòng) và gợi ý set_body", async () => {
    const { run } = await deck();
    let msg = "";
    try {
      await run("pptx_edit", { path: "bc.pptx", replacements: [{ find: "Giải quyết bài toán phức tạp không thể xử lý hiện nay\nY học cá nhân hóa", replace: "x", slide: 3 }] });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("set_body");
    expect(msg.split("\n").length).toBeLessThanOrEqual(3);
    expect(msg).toContain("3");
    expect(msg.length).toBeLessThan(400);
  });
});

describe("lỗi 5: create_pptx append sau khi tệp đã bị sửa", () => {
  it("chèn slide vào tệp hiện có, không bắt đọc lại/dựng lại", async () => {
    const { run, labels } = mk();
    await run("create_pptx", { path: "bc.pptx", content: "# Bìa\nPhụ đề\n\n---\n\n## Một\n- a\n- b\n\n---\n\n## Hai\n- c\n- d" });
    await run("pptx_edit", { path: "bc.pptx", set_title: [{ slide: 2, text: "Một (sửa)" }] }).catch(async () => {
      await run("read_document", { path: "bc.pptx" });
      await run("pptx_edit", { path: "bc.pptx", set_title: [{ slide: 2, text: "Một (sửa)" }] });
    });
    const out = await run("create_pptx", { path: "bc.pptx", content: "## Kết luận\n- k1\n- k2\n\n## Cảm ơn\nQ&A", append: true });
    expect(out).not.toMatch(/bị sửa ngoài/);
    const l = await labels("bc.pptx");
    expect(l.join("|")).toContain("Một (sửa)"); // bản sửa còn nguyên
    expect(l.slice(-2)).toEqual([`Slide ${l.length - 1}: Kết luận`, `Slide ${l.length}: Cảm ơn`]);
  });

  it("sau create_pptx (không sửa) append vẫn dựng lại như cũ", async () => {
    const { run, labels } = mk();
    await run("create_pptx", { path: "bc.pptx", content: "# Bìa\nPhụ đề\n\n---\n\n## Một\n- a", auto: false });
    await run("create_pptx", { path: "bc.pptx", content: "---\n## Hai\n- b", append: true });
    expect(await labels("bc.pptx")).toEqual(["Slide 1: Bìa", "Slide 2: Một", "Slide 3: Hai"]);
  });
});

describe("lỗi 6: kết quả ngắn", () => {
  it("một dòng tổng + danh sách tiêu đề đánh số; không còn lời khuyên dài", async () => {
    const { run } = mk();
    const out = await run("create_pptx", { path: "a.pptx", content: manySections(3) });
    expect(out).toMatch(/^Đã tạo a\.pptx: \d+ slide/);
    expect(out).toMatch(/\n1\. Chủ đề/);
    expect(out).toContain("Mục 3");
    expect(out).not.toContain("Nếu còn slide nữa");
    expect(out.split("\n").length).toBeLessThanOrEqual(12);
  });
  it("cảnh báo tràn: chỉ khi thật sự tràn, tối đa 2, và không lặp lại khi append", async () => {
    const { run } = mk();
    const fits = await run("create_pptx", { path: "f.pptx", content: "## Vừa\n" + Array.from({ length: 6 }, (_, i) => `- Ý ngắn số ${i}`).join("\n"), auto: false });
    expect(fits).not.toContain("tràn");
    const big = (n: string) => `## ${n}\n` + Array.from({ length: 28 }, (_, i) => `- Ý số ${i} khá dài để chiếm nhiều chỗ trên slide này nhằm thử cảnh báo tràn nội dung`).join("\n");
    const first = await run("create_pptx", { path: "t.pptx", content: [big("A"), big("B"), big("C"), big("D")].join("\n\n---\n\n"), auto: false });
    expect((first.match(/⚠/g) ?? []).length).toBeLessThanOrEqual(2);
    expect(first).toContain("tràn");
    const next = await run("create_pptx", { path: "t.pptx", content: "---\n## Ngắn\n- a\n- b", append: true });
    expect(next).not.toContain("tràn");
    expect(next).toContain("5 slide");
  });
});

describe("lỗi 7: tệp đang mở (EBUSY/EPERM) → lưu sang tên khác", () => {
  const lock = (env: MemoryEnv, paths: string[], code = "EBUSY") => {
    const orig = env.writeBytes.bind(env);
    env.writeBytes = async (p: string, d: Uint8Array) => {
      if (paths.includes(p)) throw Object.assign(new Error(`${code}: resource busy or locked, open '${p}'`), { code });
      return orig(p, d);
    };
  };
  it("create_pptx: ghi lỗi EBUSY → «… (đã sửa).pptx», nói rõ một câu", async () => {
    const { env, run, ctx } = mk();
    lock(env, ["/ws/bc.pptx"]);
    const out = await run("create_pptx", { path: "bc.pptx", content: "# Bìa\nPhụ đề\n\n---\n\n## Một\n- a", auto: false });
    expect(out).toContain("«bc (đã sửa).pptx»");
    expect(out).toContain("PowerPoint");
    expect(out).toContain("Đóng tệp gốc");
    expect(await env.stat("/ws/bc (đã sửa).pptx")).not.toBeNull();
    expect(await env.stat("/ws/bc.pptx")).toBeNull();
    expect(ctx.undoStack.length).toBe(1);
  });
  it("pptx_edit/docx_edit/xlsx_edit/create_docx/create_xlsx: EPERM/EACCES cũng được; thêm số nếu trùng", async () => {
    const { env, run } = mk();
    await run("create_pptx", { path: "bc.pptx", content: "# Bìa\n\n---\n\n## Một\n- a", auto: false });
    await run("create_docx", { path: "v.docx", content: "Đoạn một.\n\nĐoạn hai." });
    await run("create_xlsx", { path: "s.xlsx", sheets: [{ name: "S", rows: [["a", "b"], [1, 2]] }] });
    for (const f of ["bc.pptx", "v.docx", "s.xlsx"]) await run("read_document", { path: f });
    lock(env, ["/ws/bc.pptx", "/ws/v.docx", "/ws/s.xlsx"], "EPERM");
    expect(await run("pptx_edit", { path: "bc.pptx", set_title: [{ slide: 2, text: "Mới" }] })).toContain("«bc (đã sửa).pptx»");
    expect(await run("pptx_edit", { path: "bc.pptx", set_title: [{ slide: 2, text: "Mới 2" }] })).toContain("«bc (đã sửa 2).pptx»");
    expect(await run("docx_edit", { path: "v.docx", replace_paragraph: [{ para: 1, text: "Đã sửa" }] })).toContain("«v (đã sửa).docx»");
    expect(await run("xlsx_edit", { path: "s.xlsx", set: { B2: 5 } })).toContain("«s (đã sửa).xlsx»");
    expect(await run("create_docx", { path: "v.docx", content: "Khác" })).toContain("(đã sửa");
    expect(await run("create_xlsx", { path: "s.xlsx", sheets: [{ name: "S", rows: [["x"]] }] })).toContain("(đã sửa");
    // bản gốc không đổi
    expect((await readPptx(await env.readBytes("/ws/bc.pptx")))[1].label).toContain("Một");
  });
  it("lỗi khác (không phải khoá tệp) vẫn báo lỗi", async () => {
    const { env, run } = mk();
    const orig = env.writeBytes.bind(env);
    env.writeBytes = async (p: string, d: Uint8Array) => {
      if (p === "/ws/x.pptx") throw Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" });
      return orig(p, d);
    };
    await expect(run("create_pptx", { path: "x.pptx", content: "## a\n- b", auto: false })).rejects.toThrow(/ENOSPC/);
  });
});

describe("mô tả công cụ ngắn", () => {
  it("create_pptx và pptx_edit dưới 900 ký tự", () => {
    const { tools } = mk();
    for (const n of ["create_pptx", "pptx_edit"]) expect(tools.get(n)!.description.length, n).toBeLessThan(900);
    expect(tools.get("create_pptx")!.description).toContain("slide_count");
  });
});
