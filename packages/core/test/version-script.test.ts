import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

// scripts/version.mjs là công cụ phát hành (Node thuần, không có kiểu): nạp động để không ảnh hưởng typecheck
let V: any;
beforeAll(async () => {
  V = await import(pathToFileURL(path.resolve(__dirname, "../../../scripts/version.mjs")).href);
});

const CL = `# Nhật ký\n\nMô tả.\n\n## [Chưa phát hành]\n\n### Thêm\n- Tính năng **mới** có \`mã\`.\n\n## [0.1.0] - 2026-10-08\n\n### Thêm\n- Bản đầu.\n`;

describe("version.mjs", () => {
  it("bumpVersion", () => {
    expect(V.bumpVersion("0.1.9", "patch")).toBe("0.1.10");
    expect(V.bumpVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(V.bumpVersion("0.1.9", "major")).toBe("1.0.0");
    expect(V.bumpVersion("0.1.9", "0.3.0-beta.1")).toBe("0.3.0-beta.1");
    expect(() => V.bumpVersion("0.1.9", "lớn")).toThrow();
    expect(() => V.bumpVersion("xx", "patch")).toThrow();
  });
  it("promoteChangelog chuyển mục Chưa phát hành sang phiên bản mới và để lại mục rỗng", () => {
    const out = V.promoteChangelog(CL, "0.2.0", "2026-11-01");
    const c = V.parseChangelog(out);
    expect(c.unreleased).toBe("");
    expect(c.releases.map((r: { version: string }) => r.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(c.releases[0]).toMatchObject({ date: "2026-11-01" });
    expect(c.releases[0].body).toContain("Tính năng **mới**");
    expect(out.startsWith("# Nhật ký")).toBe(true);
  });
  it("từ chối khi mục trống hoặc phiên bản đã có", () => {
    const empty = V.promoteChangelog(CL, "0.2.0", "2026-11-01");
    expect(() => V.promoteChangelog(empty, "0.3.0", "2026-11-02")).toThrow(/trống/);
    expect(V.parseChangelog(V.promoteChangelog(empty, "0.3.0", "2026-11-02", { allowEmpty: true })).releases[0].body).toContain("bảo trì");
    expect(() => V.promoteChangelog(CL, "0.1.0", "2026-11-01")).toThrow(/đã có/);
  });
  it("notesFor trả văn bản thường", () => {
    const out = V.notesFor(V.promoteChangelog(CL, "0.2.0", "2026-11-01"), "0.2.0");
    expect(out).toBe("Thêm\n• Tính năng mới có mã.");
    expect(V.notesFor(CL, "9.9.9")).toBe("");
  });
  it("applyBump + checkAll trên một repo giả", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ver-"));
    const w = (f: string, o: unknown) => {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), typeof o === "string" ? o : JSON.stringify(o, null, 2));
    };
    w("package.json", { name: "r", version: "0.1.0", workspaces: ["packages/a", "apps/b"] });
    w("packages/a/package.json", { name: "a", version: "0.1.0" });
    w("apps/b/package.json", { name: "b", version: "0.1.0" });
    w("package-lock.json", { name: "r", version: "0.1.0", packages: { "": { version: "0.1.0" }, "packages/a": { version: "0.1.0" }, "apps/b": { version: "0.1.0" } } });
    w("CHANGELOG.md", V.promoteChangelog(CL.replace("## [0.1.0] - 2026-10-08\n\n### Thêm\n- Bản đầu.\n", ""), "0.1.0", "2026-10-08"));
    expect(V.checkAll(dir)).toEqual({ version: "0.1.0", problems: [] });
    V.applyBump(dir, "0.2.0");
    expect(Object.values(V.readVersions(dir))).toEqual(["0.2.0", "0.2.0", "0.2.0", "0.2.0"]);
    const r = V.checkAll(dir);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/CHANGELOG\.md chưa có mục cho 0\.2\.0/);
    w("apps/b/package.json", { name: "b", version: "0.1.5" });
    expect(V.checkAll(dir).problems.some((p: string) => p.includes("apps/b/package.json ở 0.1.5"))).toBe(true);
  });
  it("kho thật đang nhất quán", () => {
    expect(V.checkAll(path.resolve(__dirname, "../../..")).problems).toEqual([]);
  });
});
