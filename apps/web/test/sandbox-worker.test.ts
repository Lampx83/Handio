import { beforeAll, describe, expect, it } from "vitest";

// Chạy mã của Web Worker thật trên `self` giả: kiểm tra bộ nạp trong hộp cát, không cần trình duyệt.
type Out = { ok: boolean; logs: string[]; result?: string; error?: string };
let handler: (e: { data: unknown }) => Promise<void>;
const posted: Out[] = [];

beforeAll(async () => {
  const g = globalThis as any;
  g.self = g; // trong Worker, self chính là phạm vi toàn cục
  g.postMessage = (m: Out) => posted.push(m);
  await import("../src/sandbox-worker");
  handler = g.onmessage;
});

const run = async (code: string, files: Record<string, string> = {}): Promise<Out> => {
  posted.length = 0;
  await handler({ data: { id: "1", code, files, cwd: "" } });
  return JSON.parse(JSON.stringify(posted[0]));
};

describe("hộp cát run_javascript", () => {
  it("require tệp JSON của dự án", async () => {
    const r = await run('return require("./data.json").ten;', { "data.json": '{"ten":"An"}' });
    expect(r).toMatchObject({ ok: true, result: "An" });
  });

  it("có assert để chạy bài kiểm thử", async () => {
    expect(await run('const a = require("assert"); a.strictEqual(1 + 1, 2); a.deepStrictEqual({ x: [1] }, { x: [1] }); a.ok(true); a(true); a.throws(() => { throw new Error("x"); }); return "đạt";')).toMatchObject({ ok: true, result: "đạt" });
    expect(await run('require("node:assert").strictEqual(1, 2);')).toMatchObject({ ok: false, error: expect.stringContaining("1") });
    expect(await run('require("assert").deepStrictEqual({ x: 1 }, { x: 2 });')).toMatchObject({ ok: false });
    expect(await run('require("assert").throws(() => {});')).toMatchObject({ ok: false });
  });

  it("fs chỉ đọc: đọc, liệt kê; KHÔNG có hàm ghi", async () => {
    const files = { "a.txt": "chữ", "src/b.js": "1" };
    expect(await run('const fs = require("node:fs"); return fs.readFileSync("a.txt", "utf8") + fs.readdirSync("src").join() + fs.readdirSync(".").join() + fs.statSync("a.txt").isFile();', files)).toMatchObject({ ok: true, result: "chữb.jsa.txt,srctrue" });
    expect(await run('require("fs").writeFileSync("a.txt", "x");', files)).toMatchObject({ ok: false, error: expect.stringContaining("is not a function") });
  });

  it("mã kiểu CommonJS ở cấp ngoài cùng và process.stdout chạy được", async () => {
    const r = await run('process.stdout.write("chào"); module.exports = { x: 1 }; exports.y = 2; return typeof __dirname;');
    expect(r).toMatchObject({ ok: true, result: "string" });
    expect(r.logs.join()).toContain("chào");
  });

  it("KHÔNG có mạng, không có thư viện ngoài", async () => {
    expect(await run('require("express");')).toMatchObject({ ok: false, error: expect.stringContaining("Cannot find module 'express'") });
    expect(await run('require("child_process");')).toMatchObject({ ok: false });
    expect(await run("return typeof fetch;")).toMatchObject({ ok: true, result: "undefined" });
  });
});
