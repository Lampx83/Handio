import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePack, type RawPack } from "../src";
import { makeController } from "./helpers";

// Gói packs/nang-suat: việc cần làm (VIEC-CAN-LAM.md), bộ nhớ thuật ngữ (AGENTS.md/THUAT-NGU.md), bản tin đầu ngày.
const dir = path.join(__dirname, "..", "..", "..", "packs", "nang-suat");
const files: Record<string, string> = {};
const walk = (abs: string, rel: string) => {
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) walk(path.join(abs, e.name), r);
    else files[r] = fs.readFileSync(path.join(abs, e.name), "utf8");
  }
};
walk(dir, "");
const raw: RawPack = { dir: "nang-suat", origin: "org", files };

const toolReply = (llm: { calls: { messages: { role: string; content?: unknown }[] }[] }, n: number) => String(llm.calls[n].messages.filter((m) => m.role === "tool").at(-1)!.content);
const COMMANDS = ["viec-can-lam", "ghi-nho", "don-bo-nho", "ban-tin-ngay"];

describe("gói nang-suat: cấu trúc", () => {
  const { pack, error, warnings } = parsePack(raw);

  it("đọc được, không cảnh báo, chỉ dành cho tab Work", () => {
    expect(error).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(pack!.manifest).toMatchObject({ id: "nang-suat", profiles: ["work"] });
    expect(pack!.skills.map((s) => s.name).sort()).toEqual(["bo-nho-du-an", "quan-ly-viec"]);
    expect(pack!.commands.map((c) => c.name).sort()).toEqual([...COMMANDS].sort());
    expect(pack!.prompt.length).toBeLessThan(1000); // luôn nằm trong ngữ cảnh: phải rất ngắn
  });

  it("không dựa vào kết nối ngoài (Slack, lịch, email, Notion, lập lịch nền)", () => {
    const all = Object.values(files).join("\n");
    expect(all).not.toMatch(/slack|notion|asana|jira|google calendar|outlook|scheduled|create_scheduled_task|mcp__/i);
    expect(JSON.stringify(pack!.mcpServers)).toBe("{}");
    expect(Object.keys(pack!.httpTools)).toEqual([]);
  });

  it("lệnh nạp đúng skill của gói", () => {
    const body = (n: string) => pack!.commands.find((c) => c.name === n)!.body;
    expect(body("viec-can-lam")).toContain("`quan-ly-viec`");
    expect(body("ghi-nho")).toContain("`bo-nho-du-an`");
    expect(body("don-bo-nho")).toContain("`bo-nho-du-an`");
    expect(body("ban-tin-ngay")).toContain("VIEC-CAN-LAM.md");
    expect(body("ban-tin-ngay")).toContain("`file_info`"); // ngày sửa tệp: không cần lịch/email
  });

  it("mẫu VIEC-CAN-LAM.md trong skill đúng chính định dạng nó mô tả", () => {
    const skill = pack!.skills.find((s) => s.name === "quan-ly-viec")!.body;
    const tpl = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
    const sections = [...tpl.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual(["Đang làm", "Chờ người khác", "Để sau", "Đã xong"]);
    const items = tpl.split("\n").filter((l) => l.startsWith("- ["));
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const l of items) {
      expect(l, l).toMatch(/^- \[( |x)\] (\*\*[^*]+\*\*|~~[^~]+~~)( · [^:·]+: [^·]+)*$/);
      for (const d of l.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) {
        const [, dd, mm, yy] = d;
        const dt = new Date(Date.UTC(+yy, +mm - 1, +dd));
        expect(dt.getUTCDate() === +dd && dt.getUTCMonth() === +mm - 1, `ngày không có thật: ${d[0]}`).toBe(true);
      }
    }
    // việc đã xong: [x] + gạch ngang; việc chưa xong: [ ] + chữ đậm
    for (const l of items) expect(/^- \[x\]/.test(l)).toBe(/~~/.test(l));
  });

  it("mục nóng mẫu của bộ nhớ nằm trong giới hạn nó tự đặt ra", () => {
    const skill = pack!.skills.find((s) => s.name === "bo-nho-du-an")!.body;
    const tpl = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
    expect(tpl.length).toBeLessThan(2500);
    expect(tpl.split("\n").length).toBeLessThan(40);
  });

  it("không có tên/email thật: chỉ dữ liệu giả", () => {
    const all = Object.values(files).join("\n");
    expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(all).not.toMatch(/\b\d{9,12}\b/);
  });
});

describe("gói nang-suat: trong phiên làm việc", () => {
  const AGENTS = "# Hướng dẫn\nXưng hô thầy cô.\n\n## Thuật ngữ và người-việc\n| Từ | Nghĩa |\n|---|---|\n| KH | kế hoạch |\n| TS An | Trưởng bộ môn |\n";
  const SEED = {
    "AGENTS.md": AGENTS,
    "VIEC-CAN-LAM.md": "# Việc cần làm\n\n## Đang làm\n- [ ] **Soạn KH hội thảo** · dự án: Hội thảo AI · hạn: 05/10/2026 · cho: TS An\n",
  };

  it("lệnh hiện ở tab Work, lời dặn và AGENTS.md cùng được nạp; tab Code không có", async () => {
    const w = await makeController([{ text: "ok" }], { profile: "work", packs: [raw], seed: SEED });
    const s = w.c.currentSession;
    const names = s.slashCommands().map((x) => x.name);
    for (const n of COMMANDS) expect(names).toContain(n);
    expect(s.skills.map((k) => k.name)).toEqual(expect.arrayContaining(["quan-ly-viec", "bo-nho-du-an"]));
    const sys = s.systemPrompt(null, 0);
    expect(sys).toContain("VIEC-CAN-LAM.md");
    expect(sys).toContain("| TS An | Trưởng bộ môn |"); // bộ nhớ nóng đã nằm sẵn trong ngữ cảnh
    const k = await makeController([{ text: "ok" }], { profile: "code", packs: [raw], seed: SEED });
    expect(k.c.currentSession.slashCommands().some((x) => COMMANDS.includes(x.name))).toBe(false);
  });

  it("/viec-can-lam mở rộng thành lời nhắc có kèm yêu cầu của người dùng", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "work", packs: [raw], seed: SEED });
    const r = await c.currentSession.handleInput("/viec-can-lam xong soạn KH hội thảo");
    expect(r.run).toContain("quan-ly-viec");
    expect(r.run).toContain("xong soạn KH hội thảo");
    const empty = await c.currentSession.handleInput("/viec-can-lam");
    expect(empty.run).toContain("nhìn lướt");
  });

  it("agent nạp skill quan-ly-viec và nhận đúng hướng dẫn", async () => {
    const { c, llm } = await makeController([{ calls: [{ name: "skill", args: { name: "quan-ly-viec" } }] }, { text: "xong" }], { profile: "work", packs: [raw], seed: SEED });
    await c.send("hôm nay có việc gì?");
    const reply = toolReply(llm, 1);
    expect(reply).toContain("VIEC-CAN-LAM.md");
    expect(reply).toContain("Đối chiếu hạn");
  });

  it("đối chiếu hạn: date_calc báo hạn đã qua đúng như skill dặn tìm (\"đã đảo lại\")", async () => {
    const { c, llm } = await makeController(
      [{ calls: [{ name: "date_calc", args: { action: "diff", date: "11/10/2026", to: "05/10/2026" } }] }, { calls: [{ name: "date_calc", args: { action: "workdays_add", date: "09/10/2026", days: 3 } }] }, { text: "ok" }],
      { profile: "work", packs: [raw], seed: SEED },
    );
    await c.send("việc nào quá hạn?");
    expect(toolReply(llm, 1)).toContain("đã đảo lại");
    expect(toolReply(llm, 2)).toContain("14/10/2026"); // thứ Sáu 09/10 + 3 ngày làm việc = thứ Tư 14/10
    const skill = parsePack(raw).pack!.skills.find((s) => s.name === "quan-ly-viec")!.body;
    expect(skill).toContain("đã đảo lại");
    expect(skill).toContain("workdays_add");
  });
});
