import { describe, expect, it } from "vitest";
import { MemoryEnv, loadMemory, loadRules, parseRule, ruleMatches, Permissions } from "../src";
import { makeController, SEED } from "./helpers";

const sys = (llm: { calls: { messages: { role: string; content?: string | null }[] }[] }, n: number) => String(llm.calls[n].messages[0].content);

describe("tệp ngữ cảnh: @import, cấp toàn cục, thư mục con, quy tắc theo phạm vi", () => {
  it("CLAUDE.md chỉ có @AGENTS.md: nội dung chỉ nạp một lần", async () => {
    const env = new MemoryEnv("/ws", { "AGENTS.md": "Dùng tab.", "CLAUDE.md": "@AGENTS.md" });
    const m = await loadMemory(env, "/ws");
    expect(m.map((x) => x.name)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(m.map((x) => x.text).join("\n").match(/Dùng tab\./g)).toHaveLength(1);
    expect(m[1].text).toContain("đã nạp ở trên");
  });

  it("@import nạp nội dung tệp được trỏ tới (tối đa 4 cấp, không vòng lặp); bỏ qua code, email, tệp bí mật, đường dẫn ra ngoài", async () => {
    const env = new MemoryEnv("/ws", {
      "AGENTS.md": "Xem @docs/api.md\nEmail a@neu.edu.vn; mã `@docs/code.md`; @.env; @../x.md; @/etc/hosts",
      "docs/api.md": "API-A @b.md",
      "docs/b.md": "API-B @c.md",
      "docs/c.md": "API-C @d.md",
      "docs/d.md": "API-D @e.md",
      "docs/e.md": "API-E",
      "docs/code.md": "KHONG-NAP",
      ".env": "SECRET=1",
    });
    const t = (await loadMemory(env, "/ws"))[0].text;
    expect(t).toContain("API-A");
    expect(t).toContain("API-B");
    expect(t).toContain("API-C");
    expect(t).toContain("API-D"); // cấp 4
    expect(t).not.toContain("API-E"); // cấp 5
    expect(t).not.toContain("KHONG-NAP");
    expect(t).not.toContain("SECRET");
    const loop = new MemoryEnv("/ws", { "AGENTS.md": "@a.md", "a.md": "A @b.md", "b.md": "B @a.md" });
    expect((await loadMemory(loop, "/ws"))[0].text.match(/^A /gm)).toHaveLength(1);
  });

  it("@import không theo symlink/đường dẫn ra ngoài dự án", async () => {
    const env = new MemoryEnv("/ws", { "AGENTS.md": "@../secret.md" });
    await env.writeText("/secret.md", "NGOAI-DU-AN");
    expect((await loadMemory(env, "/ws"))[0].text).not.toContain("NGOAI-DU-AN");
  });

  it("cấp toàn cục ~/.neuagent/AGENTS.md được nạp trước tệp dự án", async () => {
    const env = new MemoryEnv("/ws", { "AGENTS.md": "Của dự án." });
    await env.writeText("/home/user/.neuagent/AGENTS.md", "Của tôi.");
    const m = await loadMemory(env, "/ws");
    expect(m.map((x) => x.name)).toEqual(["~/.neuagent/AGENTS.md", "AGENTS.md"]);
  });

  it("AGENTS.md ở thư mục con chỉ nạp khi agent làm việc trong thư mục đó, và nạp một lần", async () => {
    const { c, llm, events } = await makeController(
      [{ calls: [{ name: "read_file", args: { path: "src/util.py" } }] }, { calls: [{ name: "read_file", args: { path: "src/util.py" } }] }, { text: "xong" }],
      { seed: { ...SEED, "AGENTS.md": "Gốc.", "src/AGENTS.md": "Chỉ trong src: dùng type hint." } },
    );
    await c.send("đọc src/util.py");
    expect(sys(llm, 0)).not.toContain("type hint");
    expect(sys(llm, 1)).toContain("Chỉ trong src: dùng type hint.");
    expect(events.filter((e: any) => e.type === "notice" && /src\/AGENTS\.md/.test(e.text))).toHaveLength(1);
    expect((await c.getState()).memoryFiles).toContain("src/AGENTS.md");
  });

  it("quy tắc theo phạm vi: glob chỉ nạp khi đụng tệp khớp; always_on nạp luôn; model_decision chỉ liệt kê; manual không nạp", async () => {
    const seed = {
      ...SEED,
      ".agents/rules/streamlit.md": '---\ntrigger: glob\ndescription: "Quy ước Streamlit"\nglobs: "*.py"\n---\nDùng st.sidebar.',
      ".agents/rules/always.md": "---\ntrigger: always_on\n---\nLuôn trả lời tiếng Việt.",
      ".agents/rules/pick.md": "---\ntrigger: model_decision\ndescription: Khi viết test\n---\nNội dung pick.",
      ".agents/rules/hand.md": "---\ntrigger: manual\n---\nNội dung manual.",
      ".claude/rules/web.md": "---\npaths:\n  - \"web/**/*.{ts,tsx}\"\n---\nQuy tắc web.",
    };
    const { c, llm } = await makeController([{ calls: [{ name: "read_file", args: { path: "README.md" } }] }, { calls: [{ name: "read_file", args: { path: "src/util.py" } }] }, { text: "xong" }], { seed });
    await c.send("đọc");
    expect(sys(llm, 0)).toContain("Luôn trả lời tiếng Việt.");
    expect(sys(llm, 0)).not.toContain("Dùng st.sidebar");
    expect(sys(llm, 0)).toContain(".agents/rules/pick.md: Khi viết test");
    expect(sys(llm, 0)).not.toContain("Nội dung pick.");
    expect(sys(llm, 0)).not.toContain("Nội dung manual.");
    expect(sys(llm, 1)).not.toContain("Dùng st.sidebar"); // README.md không khớp *.py
    expect(sys(llm, 2)).toContain("Dùng st.sidebar."); // đã đọc src/util.py
    expect(sys(llm, 2)).not.toContain("Quy tắc web.");
  });

  it("parseRule: trigger, globs dạng chuỗi/danh sách, dấu phẩy trong {}", () => {
    expect(parseRule("a.md", "---\nglobs: *.py, src/**/*.{ts,tsx}\n---\nx")!.globs).toEqual(["*.py", "src/**/*.{ts,tsx}"]);
    expect(parseRule("a.md", "chỉ nội dung")!.trigger).toBe("always");
    expect(parseRule("a.md", "---\ntrigger: glob\n---\nx")).toBeNull(); // glob mà không có mẫu
    const r = parseRule("a.md", "---\npaths:\n  - 'src/**'\n---\nx")!;
    expect(ruleMatches(r, "src/a/b.py")).toBe(true);
    expect(ruleMatches(r, "lib/b.py")).toBe(false);
    expect(ruleMatches(parseRule("a.md", "---\nglobs: *.py\n---\nx")!, "src/deep/a.py")).toBe(true);
  });

  it("loadRules đọc cả ba thư mục rules", async () => {
    const env = new MemoryEnv("/ws", { ".neuagent/rules/a.md": "A", ".agents/rules/b.md": "B", ".claude/rules/sub/c.md": "C" });
    expect((await loadRules(env, "/ws")).map((r) => r.name).sort()).toEqual([".agents/rules/b.md", ".claude/rules/sub/c.md", ".neuagent/rules/a.md"]);
  });

  it("agent sửa AGENTS.md ở thư mục con hoặc tệp quy tắc phải được duyệt (kể cả chế độ auto)", () => {
    const p = new Permissions({ allow: [], deny: [] }, "auto", "/ws");
    const edit = { name: "edit_file", readonly: false, kind: "edit" as const };
    for (const rel of ["src/AGENTS.md", "a/b/CLAUDE.md", ".agents/rules/x.md", ".claude/rules/x.md"]) expect(p.decide(edit, {}, { rel, abs: "" }).decision).toBe("ask");
    expect(p.decide(edit, {}, { rel: "src/app.py", abs: "" }).decision).toBe("allow");
  });
});
