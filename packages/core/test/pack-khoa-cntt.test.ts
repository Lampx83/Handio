import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePack, packsFor, PACK_LIMITS, type RawPack } from "../src";
import { makeController } from "./helpers";

// Gói khoa-cntt (packs/khoa-cntt): tải được cho tab Work, đủ lệnh, mỗi skill nạp được cùng tệp kèm,
// và KHÔNG chứa dữ liệu nhạy cảm (số tài khoản, email thật, đường dẫn máy cá nhân, mật khẩu).
const dir = path.join(__dirname, "..", "..", "..", "packs", "khoa-cntt");
const TEXT = /\.(md|json|txt|csv|html|css|js|mjs)$/i;

function readPack(): RawPack {
  const files: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (TEXT.test(e.name)) files[r] = fs.readFileSync(path.join(abs, e.name), "utf8");
    }
  };
  walk(dir, "");
  return { dir: "khoa-cntt", origin: "org", files };
}

const raw = readPack();
const SKILLS = ["ke-hoach-du-toan-cntt", "phan-bo-tien-du-toan", "viet-bai-website-khoa-cntt", "viet-giao-trinh-cntt"];
const COMMANDS = ["ke-hoach-du-toan", "phan-bo-du-toan", "bai-website", "giao-trinh"];

describe("gói khoa-cntt", () => {
  const { pack, error, warnings } = parsePack(raw);

  it("tải được, không cảnh báo, dành cho tab Work, prompt ngắn", () => {
    expect(error).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(pack!.manifest).toMatchObject({ id: "khoa-cntt", profiles: ["work"] });
    expect(packsFor([pack!], "work")).toHaveLength(1);
    expect(packsFor([pack!], "code")).toHaveLength(0);
    expect(pack!.prompt.length).toBeGreaterThan(200);
    expect(pack!.prompt.length).toBeLessThan(2500);
    expect(Object.keys(raw.files).length).toBeLessThan(PACK_LIMITS.files);
  });

  it("có đủ 4 lệnh, mô tả ≤ 90 ký tự, mỗi lệnh nạp đúng skill của nó", () => {
    expect(pack!.commands.map((c) => c.name).sort()).toEqual([...COMMANDS].sort());
    for (const c of pack!.commands) {
      expect(c.description.length, c.name).toBeGreaterThan(10);
      expect(c.description.length, c.name).toBeLessThanOrEqual(90);
      expect(c.body).toContain("$ARGUMENTS");
      expect(SKILLS.some((s) => c.body.includes("`" + s + "`")), `/${c.name} không nhắc skill`).toBe(true);
    }
  });

  it("có đủ 4 skill; mọi tệp kèm đều được nạp (không vượt ngân sách) và gọn", () => {
    expect(pack!.skills.map((s) => s.name).sort()).toEqual([...SKILLS].sort());
    for (const s of pack!.skills) {
      expect(s.body.length, s.name).toBeGreaterThan(1500);
      expect(s.files.length, s.name).toBeGreaterThan(0);
      expect(Object.keys(s.texts ?? {}).sort(), `${s.name}: tệp kèm bị bỏ do vượt ngân sách`).toEqual([...s.files].sort());
      const total = s.body.length + Object.values(s.texts ?? {}).reduce((a, t) => a + t.length, 0);
      expect(total, `${s.name} quá dài cho cửa sổ ngữ cảnh nhỏ`).toBeLessThan(24_000);
    }
  });

  it("không chứa dữ liệu nhạy cảm", () => {
    for (const [file, text] of Object.entries(raw.files)) {
      // số tài khoản: 8 chữ số liền trở lên (trừ chuỗi toàn số 0 của tệp mẫu)
      const digits = [...text.matchAll(/\d{8,}/g)].map((m) => m[0]).filter((d) => !/^0+$/.test(d));
      expect(digits, `${file}: có dãy số giống số tài khoản`).toEqual([]);
      expect(text, `${file}: email thật`).not.toMatch(/@neu\.edu\.vn|@st\.neu\.edu\.vn/i);
      expect(text, `${file}: đường dẫn máy cá nhân`).not.toMatch(/\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\/);
      expect(text, `${file}: mật khẩu hoặc khoá`).not.toMatch(/mật khẩu\s*[:=]|password\s*[:=]|Bearer\s+[A-Za-z0-9]|api[_-]?key\s*[:=]/i);
    }
  });

  it("dữ liệu mẫu chỉ dùng tên giả rõ ràng", () => {
    const sample = Object.entries(raw.files).filter(([f]) => /\/mau-/.test(f));
    expect(sample.length).toBeGreaterThanOrEqual(3);
    for (const [f, t] of sample) expect(t, f).toMatch(/Nguyễn Văn A/);
    expect(raw.files["skills/phan-bo-tien-du-toan/mau-nguoi-nhan.csv"]).toMatch(/0000000000/);
  });
});

describe("gói khoa-cntt trong phiên làm việc", () => {
  it("lệnh hiện trong tab Work, lời dặn nằm trong system prompt", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "work", packs: [raw] });
    const s = c.currentSession;
    const names = s.slashCommands().map((x) => x.name);
    for (const n of COMMANDS) expect(names, n).toContain(n);
    expect(s.systemPrompt(null, 0)).toContain("du-lieu/nguoi-ky.md");
    expect(s.startupNotices).toEqual([]);
  });

  it.each(SKILLS)("skill %s nạp được kèm tệp mẫu", async (name) => {
    const { pack } = parsePack(raw);
    const sk = pack!.skills.find((s) => s.name === name)!;
    const marker = Object.values(sk.texts ?? {}).find((t) => t.length > 50)!.slice(0, 40);
    const { c, llm } = await makeController([{ calls: [{ name: "skill", args: { name } }] }, { text: "xong" }], { profile: "work", packs: [raw] });
    await c.send("làm việc theo skill");
    const result = JSON.stringify(llm.calls[1].messages.at(-1));
    expect(result).toContain(JSON.stringify(sk.body.slice(0, 30)).slice(1, -1));
    expect(result).toContain(JSON.stringify(marker).slice(1, -1));
  });
});
