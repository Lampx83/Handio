/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { MemoryEnv } from "../src";
import { officeTools } from "../src/office/tools";
import { WORK_TEMPLATES } from "../src/work-templates";

const RESERVED = ["help", "clear", "compact", "mode", "undo", "context", "init", "vibe", "review", "explain", "fix-tests", "tomtat", "soanthao", "bangtinh", "trinhchieu", "rasoat", "giay-moi"];
const FILE_TOOLS = ["create_docx", "create_xlsx", "create_pptx"];
const VALID_TOOLS = ["create_docx", "create_xlsx", "create_pptx", "read_document", "find_in_documents"];
const COMMANDS_PER_CATEGORY: Record<string, number> = { "van-ban-hanh-chinh": 14, "thu-tu": 4, "bang-tinh": 6, "trinh-chieu": 3, khac: 2 };

/** Mọi tên khóa (kể cả lồng nhau) trong schema của một công cụ. */
function flatKeys(schema: any, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return out;
  for (const [k, v] of Object.entries<any>(schema.properties ?? {})) {
    out.add(k);
    flatKeys(v, out);
  }
  if (schema.items) flatKeys(schema.items, out);
  return out;
}

const tools = officeTools(new MemoryEnv());
const byName = new Map(tools.map((t) => [t.name, t]));
const keysOf = (name: string) => flatKeys((byName.get(name) as any).parameters);

/** Tham số công cụ mà prompt hay nhắc, không gây nhầm với từ thường. */
const PARAM_TOKENS = ["letterhead", "agency_parent", "doc_number", "place_date", "signature", "on_behalf", "recipients", "number_formats", "freeze_header", "autofilter", "widths", "page_numbers", "orientation", "subtitle", "footer", "save_as", "add_sheet", "append_rows"];

describe("mẫu nghiệp vụ Work: dữ liệu", () => {
  it("có ít nhất 22 mẫu, đủ số lượng theo nhóm", () => {
    expect(WORK_TEMPLATES.length).toBeGreaterThanOrEqual(22);
    const count: Record<string, number> = {};
    for (const t of WORK_TEMPLATES) count[t.category] = (count[t.category] ?? 0) + 1;
    expect(count).toEqual(COMMANDS_PER_CATEGORY);
  });

  it("command duy nhất, đúng dạng, không trùng lệnh có sẵn", () => {
    const seen = new Set<string>();
    for (const t of WORK_TEMPLATES) {
      expect(t.command, t.command).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(RESERVED, t.command).not.toContain(t.command);
      expect(seen.has(t.command), `trùng ${t.command}`).toBe(false);
      seen.add(t.command);
    }
  });

  it("có đủ các lệnh theo yêu cầu", () => {
    const need = ["congvan", "thongbao", "quyetdinh", "totrinh", "baocao", "kehoach", "bienban", "giaymoi", "giaygioithieu", "giayuyquyen", "don", "hopdong", "bienbanbangiao", "nhanxet", "email", "thucamon", "phanhoi", "thongbaonoibo", "chamcong", "dutoan", "lichtuan", "tiendo", "thongke", "bangdiem", "tongket", "gioithieu", "dexuat", "chuanbihop", "tonghop"];
    const have = new Set(WORK_TEMPLATES.map((t) => t.command));
    for (const c of need) expect(have.has(c), c).toBe(true);
  });

  it("fields: ≥ 3, key duy nhất, có label; description ≤ 90 ký tự; có tên", () => {
    for (const t of WORK_TEMPLATES) {
      expect(t.name.trim(), t.command).not.toBe("");
      expect(t.description.length, t.command).toBeLessThanOrEqual(90);
      expect(t.description.length, t.command).toBeGreaterThan(10);
      expect(t.fields.length, t.command).toBeGreaterThanOrEqual(3);
      expect(t.fields.some((f) => f.required), t.command).toBe(true);
      const keys = t.fields.map((f) => f.key);
      expect(new Set(keys).size, `${t.command}: key trùng`).toBe(keys.length);
      for (const f of t.fields) {
        expect(f.key, t.command).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(f.label.trim(), t.command).not.toBe("");
        expect(f.example?.trim(), `${t.command}.${f.key}`).toBeTruthy();
      }
    }
  });
});

describe("mẫu nghiệp vụ Work: prompt", () => {
  it("dùng $ARGUMENTS, hỏi thông tin còn thiếu, đánh dấu [cần bổ sung], không bịa", () => {
    for (const t of WORK_TEMPLATES) {
      expect(t.prompt, t.command).toContain("$ARGUMENTS");
      expect(t.prompt, t.command).toContain("[cần bổ sung]");
      expect(t.prompt, t.command).toMatch(/numbered list/);
      expect(t.prompt, t.command).toMatch(/Never invent/);
      expect(t.prompt.length, t.command).toBeGreaterThan(800);
    }
  });

  it("không nhắc tên trường/đơn vị thật", () => {
    for (const t of WORK_TEMPLATES) {
      const all = JSON.stringify(t);
      expect(all, t.command).not.toContain("Kinh tế Quốc dân");
      expect(all, t.command).not.toContain("Kinh te Quoc dan");
    }
  });

  it("nêu công cụ hợp lệ; mẫu tạo tệp thì yêu cầu đọc lại bằng read_document và lưu tên mới", () => {
    for (const t of WORK_TEMPLATES) {
      const mentioned = VALID_TOOLS.filter((n) => t.prompt.includes(n));
      if (t.category !== "thu-tu") expect(mentioned.length, t.command).toBeGreaterThan(0);
      const creates = FILE_TOOLS.some((n) => t.prompt.includes(n));
      if (t.category === "thu-tu") {
        expect(t.prompt, t.command).toMatch(/IN THE CHAT/);
        expect(t.prompt, t.command).toMatch(/Do NOT create a file/);
      } else {
        expect(creates || t.command === "tonghop", t.command).toBe(true);
      }
      if (creates && t.category !== "thu-tu") {
        expect(t.prompt, t.command).toContain("read_document");
        expect(t.prompt, t.command).toMatch(/NEW .*file|NEW name/);
        expect(t.prompt, t.command).toMatch(/never overwrite/i);
      }
    }
  });

  it("chỉ nhắc tên công cụ có thật", () => {
    const known = new Set(tools.map((t) => t.name));
    for (const t of WORK_TEMPLATES) {
      const names = t.prompt.match(/\b(?:create|docx|xlsx|pptx|read|find|convert)_[a-z_]+\b/g) ?? [];
      for (const n of names) expect(known.has(n), `${t.command}: công cụ "${n}" không tồn tại`).toBe(true);
    }
  });

  it("văn bản hành chính: nêu quốc hiệu hoặc letterhead, create_docx, Nghị định 30/2020/NĐ-CP, đủ ký/nơi nhận", () => {
    const admin = WORK_TEMPLATES.filter((t) => t.category === "van-ban-hanh-chinh");
    expect(admin.length).toBe(14);
    for (const t of admin) {
      expect(t.prompt, t.command).toContain("create_docx");
      expect(t.prompt.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM") || t.prompt.includes("letterhead"), t.command).toBe(true);
      expect(t.prompt, t.command).toContain("Nghị định 30/2020/NĐ-CP");
      expect(t.prompt, t.command).toContain("\"formal\"");
      expect(t.prompt, t.command).toMatch(/place_date/);
    }
    // các mẫu có chữ ký một người: dùng signature; có Nơi nhận
    for (const c of ["congvan", "thongbao", "quyetdinh", "totrinh", "baocao", "kehoach", "giaymoi", "giaygioithieu"]) {
      const t = admin.find((x) => x.command === c)!;
      expect(t.prompt, c).toContain("signature");
      expect(t.prompt, c).toContain("recipients");
      expect(t.prompt, c).toContain("Nơi nhận");
      expect(t.prompt, c).toContain("on_behalf");
    }
  });

  it("thể thức cụ thể của từng loại văn bản", () => {
    const p = (c: string) => WORK_TEMPLATES.find((t) => t.command === c)!.prompt;
    expect(p("congvan")).toContain("Kính gửi");
    expect(p("congvan")).toContain("V/v");
    expect(p("thongbao")).toContain("THÔNG BÁO");
    expect(p("quyetdinh")).toContain("QUYẾT ĐỊNH:");
    expect(p("quyetdinh")).toContain("Căn cứ");
    expect(p("quyetdinh")).toContain("Điều 1");
    expect(p("totrinh")).toContain("TỜ TRÌNH");
    expect(p("baocao")).toContain("BÁO CÁO");
    expect(p("kehoach")).toContain("KẾ HOẠCH");
    expect(p("bienban")).toContain("BIÊN BẢN");
    expect(p("giaymoi")).toContain("GIẤY MỜI");
    expect(p("giaygioithieu")).toContain("GIẤY GIỚI THIỆU");
    expect(p("giayuyquyen")).toContain("GIẤY ỦY QUYỀN");
    expect(p("hopdong")).toContain("HỢP ĐỒNG");
    expect(p("bienbanbangiao")).toContain("BIÊN BẢN BÀN GIAO");
    for (const k of ["KT.", "TM.", "TL."]) expect(p("congvan")).toContain(k);
  });

  it("mẫu pháp lý nhắc đây là mẫu tham khảo cần rà soát", () => {
    for (const c of ["quyetdinh", "hopdong", "giayuyquyen"]) {
      const t = WORK_TEMPLATES.find((x) => x.command === c)!;
      expect(t.prompt, c).toMatch(/REFERENCE TEMPLATE/);
      expect(t.prompt, c).toMatch(/legal department/);
      expect(t.prompt, c).toMatch(/currently in force/);
    }
    expect(WORK_TEMPLATES.find((x) => x.command === "hopdong")!.prompt).toMatch(/MUST be reviewed/);
  });

  it("bảng tính: create_xlsx, công thức tiếng Anh, định dạng số, đọc lại", () => {
    const sheets = WORK_TEMPLATES.filter((t) => t.category === "bang-tinh");
    for (const t of sheets) {
      expect(t.prompt, t.command).toContain("create_xlsx");
      expect(t.prompt, t.command).toMatch(/formulas? /);
      expect(t.prompt, t.command).toMatch(/=[A-Z]+\(/);
    }
    const p = (c: string) => WORK_TEMPLATES.find((t) => t.command === c)!.prompt;
    expect(p("chamcong")).toContain("COUNTIF");
    expect(p("dutoan")).toContain("#,##0");
    expect(p("dutoan")).toContain("=SUM(");
    expect(p("tiendo")).toContain("TODAY()");
    expect(p("thongke")).toContain("SUMIF");
    expect(p("thongke")).toContain("COUNTIF");
    expect(p("lichtuan")).toContain("WEEKDAY");
    expect(p("bangdiem")).toContain("Xếp loại");
  });

  it("trình chiếu: create_pptx, ngăn slide bằng ---, Ghi chú:, 6-10 slide", () => {
    const decks = WORK_TEMPLATES.filter((t) => t.category === "trinh-chieu");
    for (const t of decks) {
      expect(t.prompt, t.command).toContain("create_pptx");
      expect(t.prompt, t.command).toContain("\"---\"");
      expect(t.prompt, t.command).toContain("Ghi chú: ");
      expect(t.prompt, t.command).toContain("6-10 slides");
    }
  });

  it("thư từ: soạn trong chat, có tiêu đề, lời chào, lời kết", () => {
    const mails = WORK_TEMPLATES.filter((t) => t.category === "thu-tu");
    expect(mails.map((t) => t.command).sort()).toEqual(["email", "phanhoi", "thongbaonoibo", "thucamon"]);
    for (const t of mails) {
      expect(t.prompt, t.command).toContain("Tiêu đề:");
      expect(t.prompt, t.command).toMatch(/Kính gửi|Greeting/);
      expect(t.prompt, t.command).toMatch(/Trân trọng/);
      expect(FILE_TOOLS.some((n) => t.prompt.includes(`Create it with ${n}`)), t.command).toBe(false);
    }
  });

  it("mọi tham số công cụ được nhắc đều tồn tại trong schema thật", () => {
    for (const t of WORK_TEMPLATES) {
      const used = VALID_TOOLS.concat(["xlsx_edit", "docx_replace"]).filter((n) => new RegExp(`\\b${n}\\b`).test(t.prompt) && byName.has(n));
      const allowed = new Set<string>();
      for (const n of used) for (const k of keysOf(n)) allowed.add(k);
      for (const tok of PARAM_TOKENS) {
        if (new RegExp(`\\b${tok}\\b`).test(t.prompt)) expect(allowed.has(tok), `${t.command}: tham số "${tok}" không có trong schema của ${used.join(", ")}`).toBe(true);
      }
      // dạng lồng nhau: letterhead.xxx, signature.xxx
      const docx = (byName.get("create_docx") as any).parameters.properties;
      for (const m of t.prompt.matchAll(/\b(letterhead|signature)\.([a-z_]+)/g)) {
        expect(Object.keys(docx[m[1]].properties), `${t.command}: ${m[0]}`).toContain(m[2]);
      }
      // các khóa trong schema trang tính được nhắc theo dạng {a, b, c}
      for (const m of t.prompt.matchAll(/letterhead \{([^}]*)\}/g)) {
        for (const k of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          expect(Object.keys(docx.letterhead.properties), `${t.command}: letterhead {${k}}`).toContain(k.split(":")[0].trim());
        }
      }
      for (const m of t.prompt.matchAll(/sheets\[\{([^}]*)\}/g)) {
        const sheetKeys = Object.keys((byName.get("create_xlsx") as any).parameters.properties.sheets.items.properties);
        for (const k of m[1].split(",").map((s) => s.trim())) expect(sheetKeys, `${t.command}: sheets[{${k}}]`).toContain(k);
      }
    }
  });

  it("công thức mẫu dùng tên hàm tiếng Anh", () => {
    const vi = /=(TỔNG|ĐẾM|NẾU|HÔM\.NAY|TONG|DEM)\(/i;
    for (const t of WORK_TEMPLATES) expect(vi.test(t.prompt), t.command).toBe(false);
  });
});
