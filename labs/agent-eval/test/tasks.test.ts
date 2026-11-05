import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { prepare, selfCheck } from "../runner";
import { TASKS } from "../tasks";

// Kiểm chứng bộ chấm, không gọi mô hình. Bài cần trình duyệt ẩn chạy bằng `node labs/agent-eval/run.mjs --self-test`.
const root = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-eval-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("danh sách bài", () => {
  it("mã bài không trùng, đủ hai nhóm, đủ ba tab, từ 10 đến 15 bài", () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    expect(TASKS.length).toBeGreaterThanOrEqual(10);
    expect(TASKS.length).toBeLessThanOrEqual(15);
    expect(new Set(TASKS.map((t) => t.group))).toEqual(new Set(["regression", "capability"]));
    expect(new Set(TASKS.map((t) => t.profile))).toEqual(new Set(["code", "work", "design"]));
  });

  it("đề và tệp không còn sót chỗ cần thay", async () => {
    for (const t of TASKS) {
      const p = await prepare(t, path.join(tmp, "sot", t.id));
      expect(p.prompt, t.id).not.toMatch(/\{\{/);
      for (const [f, text] of Object.entries(p.seeded)) expect(text, `${t.id}/${f}`).not.toMatch(/\{\{/);
    }
  });

  it("hai lần chạy dùng cổng riêng, không đụng nhau", async () => {
    const t = TASKS.find((x) => x.id.startsWith("01"))!;
    const p = await prepare(t, path.join(tmp, "cong"));
    expect(p.ports.be).not.toBe(p.ports.fe);
    expect(p.prompt).toContain(String(p.ports.be));
    expect(p.seeded["be/server.js"]).toContain(String(p.ports.be));
  });

  it("bài 05 thật sự có chữ bị tách thành nhiều đoạn, nếu không thì mất ý nghĩa", async () => {
    const t = TASKS.find((x) => x.id.startsWith("05"))!;
    const p = await prepare(t, path.join(tmp, "tach"));
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(p.dir, "bao-cao.pptx")));
    let xml = "";
    for (const n of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) xml += await zip.file(n)!.async("string");
    expect(xml).toContain(">Doanh thu </a:t>");
    expect(xml).not.toContain("Doanh thu quý 3");
  });

  it("bài 10 thật sự là tệp CRLF", async () => {
    const t = TASKS.find((x) => x.id.startsWith("10"))!;
    const p = await prepare(t, path.join(tmp, "crlf"));
    expect(fs.readFileSync(path.join(p.dir, "lib/hoc-phi.js"), "utf8")).toContain("\r\n");
  });

  it("bài 09 đặt tệp NGOÀI thư mục dự án", async () => {
    const t = TASKS.find((x) => x.id.startsWith("09"))!;
    const p = await prepare(t, path.join(tmp, "ngoai"));
    expect(fs.existsSync(path.join(p.dir, "../ngoai-du-an/luong.docx"))).toBe(true);
    expect(fs.existsSync(path.join(p.dir, "ngoai-du-an"))).toBe(false);
  });
});

describe("bộ chấm: đề chưa làm thì đỏ, lời giải mẫu thì xanh", () => {
  for (const t of TASKS.filter((x) => !x.browser)) {
    it(t.id, async () => {
      const r = await selfCheck(t, path.join(tmp, "tu-chay", t.id), { root, tmpDir: tmp });
      expect(r.failed).toEqual([]);
      expect(r.solvedPasses).toBe(true);
      expect(r.unsolvedFails).toBe(true);
    });
  }
});
