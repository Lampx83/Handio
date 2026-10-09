import { describe, expect, it } from "vitest";
import { MemoryEnv, mergePackParts, parsePack, parsePacks, readProjectPacks, type RawPack } from "../src";
import { SEED, makeController } from "./helpers";

const pack = (dir: string, files: Record<string, string>, origin: RawPack["origin"] = "org"): RawPack => ({ dir, origin, files });
const MANIFEST = (id: string, extra: object = {}) => JSON.stringify({ id, name: "Gói " + id, version: "1.0.0", description: "mô tả", ...extra });

const SAMPLE = pack("khoa", {
  "pack.json": MANIFEST("khoa", { profiles: ["work", "code"] }),
  "prompt.md": "Luôn xưng hô 'quý thầy cô'.",
  "commands/cong-van.md": "---\ndescription: Soạn công văn\n---\nSoạn công văn về: $ARGUMENTS",
  "commands/bao-cao/tuan.md": "Báo cáo tuần",
  "agents/kiem-tra.md": "---\nname: kiem-tra\ndescription: Soát lỗi\ntools: [read_file, grep]\n---\nBạn soát lỗi chính tả.",
  "skills/tra-cuu/SKILL.md": "---\nname: tra-cuu\ndescription: Cách tra cứu quy chế\n---\nMở quy chế rồi trích điều khoản.",
  "skills/tra-cuu/mau.txt": "MẪU TRÍCH DẪN",
  "mcp.json": JSON.stringify({ tim: { command: "node", args: ["server.js"] } }),
  "hooks.json": JSON.stringify({ SessionStart: [{ hooks: [{ command: "echo hi" }] }] }),
});

describe("gói mở rộng: đọc và kiểm tra", () => {
  it("đọc đủ thành phần từ thư mục gói", () => {
    const { pack: p, error } = parsePack(SAMPLE);
    expect(error).toBeUndefined();
    expect(p!.manifest).toMatchObject({ id: "khoa", name: "Gói khoa", profiles: ["work", "code"] });
    expect(p!.commands.map((c) => c.name).sort()).toEqual(["bao-cao:tuan", "cong-van"]);
    expect(p!.commands.find((c) => c.name === "cong-van")!.description).toBe("Soạn công văn");
    expect(p!.agents[0]).toMatchObject({ name: "kiem-tra", tools: ["read_file", "grep"] });
    expect(p!.skills[0]).toMatchObject({ name: "tra-cuu", files: ["mau.txt"], texts: { "mau.txt": "MẪU TRÍCH DẪN" } });
    expect(Object.keys(p!.mcpServers)).toEqual(["tim"]);
    expect(p!.hooks.SessionStart).toHaveLength(1);
    expect(p!.prompt).toContain("quý thầy cô");
  });

  it("gói hỏng không làm hỏng cả hệ thống: báo lỗi và bỏ qua", () => {
    const r = parsePacks([pack("x", { "commands/a.md": "a" }), pack("Bad Name", { "pack.json": "{" }), SAMPLE]);
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["khoa"]);
    expect(r.notices.join("\n")).toMatch(/pack\.json/);
  });

  it("gói trong dự án (không tin cậy) KHÔNG được chạy chương trình: bỏ mcp.json và hooks.json", () => {
    const { pack: p, warnings } = parsePack({ ...SAMPLE, origin: "project" });
    expect(p!.mcpServers).toEqual({});
    expect(p!.hooks).toEqual({});
    expect(p!.commands.length).toBe(2);
    expect(warnings.join()).toMatch(/mcp\.json/);
  });

  it("trùng id: gói gần người dùng hơn thắng (project > user > org)", () => {
    const org = pack("a", { "pack.json": MANIFEST("a"), "commands/x.md": "org" }, "org");
    const prj = pack("a", { "pack.json": MANIFEST("a"), "commands/x.md": "project" }, "project");
    expect(parsePacks([prj, org]).packs[0].commands[0].body).toBe("project");
  });

  it("chống đường dẫn lạ và tệp quá lớn", () => {
    const { pack: p, warnings } = parsePack(pack("z", { "pack.json": MANIFEST("z"), "../evil.md": "x", "commands/big.md": "a".repeat(200_000) }));
    expect(p!.commands).toHaveLength(0);
    expect(warnings.join()).toMatch(/quá lớn/);
  });

  it("gộp: gói đứng trước thắng khi trùng tên lệnh", () => {
    const a = parsePack(pack("a", { "pack.json": MANIFEST("a"), "commands/x.md": "A" })).pack!;
    const b = parsePack(pack("b", { "pack.json": MANIFEST("b"), "commands/x.md": "B", "commands/y.md": "Y" })).pack!;
    const m = mergePackParts([a, b]);
    expect(m.commands.find((c) => c.name === "x")!.body).toBe("A");
    expect(m.commands).toHaveLength(2);
  });

  it("đọc gói nằm trong dự án qua Env (thư mục ảo của bản web)", async () => {
    const env = new MemoryEnv("/ws", { ".neuagent/packs/lop/pack.json": MANIFEST("lop"), ".neuagent/packs/lop/commands/hello.md": "Xin chào", ".neuagent/packs/lop/anh.png": "bin" });
    const raws = await readProjectPacks(env, "/ws");
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({ dir: "lop", origin: "project" });
    expect(Object.keys(raws[0].files).sort()).toEqual(["commands/hello.md", "pack.json"]);
  });
});

describe("gói mở rộng: tác động lên phiên làm việc", () => {
  it("lệnh, subagent, skill và lời dặn của gói xuất hiện; tab không được chọn thì không dùng", async () => {
    const { c } = await makeController([{ text: "ok" }], { profile: "work", packs: [SAMPLE] });
    const s = c.currentSession;
    expect(s.slashCommands().some((x) => x.name === "cong-van")).toBe(true);
    expect(s.agentDefs["kiem-tra"]).toBeTruthy();
    expect(s.skills.map((k) => k.name)).toContain("tra-cuu");
    expect(s.systemPrompt(null, 0)).toContain("quý thầy cô");
    const d = await makeController([{ text: "ok" }], { profile: "design", packs: [SAMPLE] });
    expect(d.c.currentSession.slashCommands().some((x) => x.name === "cong-van")).toBe(false);
    expect(d.c.currentSession.systemPrompt(null, 0)).not.toContain("quý thầy cô");
  });

  it("lệnh của gói chạy như prompt; skill đọc được tệp kèm; dự án ghi đè lệnh cùng tên", async () => {
    const { c, llm } = await makeController([{ calls: [{ name: "skill", args: { name: "tra-cuu" } }] }, { text: "xong" }], { profile: "work", packs: [SAMPLE], seed: { ".neuagent/commands/cong-van.md": "Của dự án: $ARGUMENTS" } });
    expect((await c.currentSession.handleInput("/cong-van họp khoa")).run).toBe("Của dự án: họp khoa");
    await c.send("tra cứu quy chế");
    expect(JSON.stringify(llm.calls[1].messages.at(-1))).toContain("MẪU TRÍCH DẪN");
  });

  it("/packs liệt kê gói đang bật", async () => {
    const { c, events } = await makeController([{ text: "ok" }], { profile: "work", packs: [SAMPLE] });
    await c.currentSession.handleInput("/packs");
    expect(events.some((e: any) => e.type === "notice" && /Gói khoa/.test(e.text))).toBe(true);
  });

  it("gói hỏng được báo ở thông báo khởi động chứ không làm chết ứng dụng", async () => {
    const { c } = await makeController([{ text: "ok" }], { packs: [pack("loi", { "pack.json": "không phải json" })] });
    expect(c.currentSession.startupNotices.join()).toMatch(/pack\.json/);
  });
});
