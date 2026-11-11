import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../../code-bench/harness";
import { runAttempt, type RunAgentFn } from "../runner";
import { TASKS } from "../tasks";

// Chạy thật cả vòng agent qua HTTP với một máy chủ mô hình GIẢ phát lại kịch bản: kiểm tra đường ống, không đo chất lượng mô hình.
type Reply = { text?: string; calls?: { name: string; args: unknown }[]; delayMs?: number };
let script: ((body: { messages: { role: string; content: unknown }[] }, n: number) => Reply) = () => ({ text: "" });
let n = 0;
let server: http.Server;
let baseUrl = "";
const root = path.resolve(__dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-eval-e2e-"));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const r = script(JSON.parse(raw || "{}"), n++);
      if (r.delayMs) await new Promise((d) => setTimeout(d, r.delayMs));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (r.text) chunk({ content: r.text });
      (r.calls ?? []).forEach((c, i) => chunk({ tool_calls: [{ index: i, id: `c${n}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] }));
      chunk({}, r.calls?.length ? "tool_calls" : "stop");
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const go = (timeoutMs = 25_000): RunAgentFn => (o) => runAgent({ ...o, baseUrl, model: "gia", timeoutMs });
const find = (prefix: string) => TASKS.find((t) => t.id.startsWith(prefix))!;

describe("đường ống eval với mô hình giả", () => {
  it("agent làm đúng thì đạt; số đo về đủ", async () => {
    n = 0;
    script = (_b, i) => (i === 0 ? { calls: [{ name: "write_file", args: { path: "ket-qua.txt", content: "Báo cáo doanh thu năm học\nTổng doanh thu: 1250 triệu đồng\n" } }] } : { text: "Xong." });
    const { attempt } = await runAttempt(find("03"), 1, path.join(tmp, "dung"), { runAgent: go(), root, tmpDir: tmp });
    expect(attempt.checks.filter((c) => !c.ok)).toEqual([]);
    expect(attempt.pass).toBe(true);
    expect(attempt.metrics).toMatchObject({ endedBy: "done", steps: 1, toolErrors: 0 });
    expect(attempt.metrics.promptTokens).toBeGreaterThan(0);
    expect(attempt.metrics.cachedTokens / attempt.metrics.promptTokens).toBeCloseTo(0.4); // máy chủ giả báo 40/100
  });

  it("agent nói xong mà không làm thì KHÔNG đạt", async () => {
    n = 0;
    script = () => ({ text: "Mình đã làm xong rồi!" });
    const { attempt } = await runAttempt(find("03"), 1, path.join(tmp, "noi-suong"), { runAgent: go(), root, tmpDir: tmp });
    expect(attempt.pass).toBe(false);
  });

  it("lỗi công cụ được đếm theo loại", async () => {
    n = 0;
    script = (_b, i) => (i === 0 ? { calls: [{ name: "read_document", args: { path: "../ngoai-du-an/luong.docx" } }] } : { text: "Tệp này nằm ngoài thư mục dự án nên mình không đọc được." });
    const { attempt } = await runAttempt(find("09"), 1, path.join(tmp, "ngoai"), { runAgent: go(), root, tmpDir: tmp });
    expect(attempt.metrics.errKinds["read_document:outside_project"]).toBe(1);
    expect(attempt.pass).toBe(true);
  });

  it("máy chủ agent bật vẫn sống lúc chấm, và tắt hẳn sau khi chấm xong", async () => {
    n = 0;
    let be = 0;
    script = (b, i) => {
      be = Number(/backend ở thư mục be\/ \(cổng (\d+)\)/.exec(JSON.stringify(b.messages.filter((m) => m.role === "user")))?.[1]);
      if (i === 0) return { calls: [{ name: "bash", args: { command: "cd be && npm run dev", background: true } }] };
      return { text: "Backend đang chạy." };
    };
    const { attempt } = await runAttempt(find("01"), 1, path.join(tmp, "song"), { runAgent: go(), root, tmpDir: tmp });
    expect(attempt.checks.find((c) => c.name === "backend vẫn đang chạy")?.ok).toBe(true);
    expect(attempt.pass).toBe(false); // frontend chưa bật
    await new Promise((r) => setTimeout(r, 500));
    await expect(fetch(`http://127.0.0.1:${be}/`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  });

  it("hết giờ thì tính không đạt, dù tệp đã đúng", async () => {
    n = 0;
    script = (_b, i) => (i === 0 ? { calls: [{ name: "write_file", args: { path: "ket-qua.txt", content: "Báo cáo doanh thu năm học\nTổng doanh thu: 1250 triệu đồng\n" } }] } : { text: "Xong.", delayMs: 4000 });
    const { attempt } = await runAttempt(find("03"), 1, path.join(tmp, "het-gio"), { runAgent: go(1000), root, tmpDir: tmp });
    expect(attempt.pass).toBe(false);
    expect(attempt.checks[0].name).toBe("agent kết thúc bình thường");
  });
});
