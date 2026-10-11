// Chạy MỘT lượt agent tab Code trên thư mục thật bằng mô hình thật (cấu hình qua biến môi trường). Dùng bởi run.mjs.
import { LocalController, type SessionEvent, type Settings } from "@neu/agent-core";
import { NodeEnv } from "@neu/agent-env-node";

export interface AgentRun {
  seconds: number;
  endedBy: "done" | "timeout" | "error";
  steps: number;
  toolErrors: number;
  tools: Record<string, number>;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  notices: string[];
  errors: string[];
  final: string;
  trace: string[];
}

export async function runAgent(o: { dir: string; prompt: string; baseUrl: string; model: string; key?: string; keyHeader?: string; maxSteps?: number; timeoutMs: number }): Promise<AgentRun> {
  const env = new NodeEnv(o.dir, { allowExec: true, sandbox: process.platform === "darwin" ? { network: true } : false });
  let saved: Partial<Settings> = {
    baseUrl: o.baseUrl, model: o.model, key: o.key, mode: "auto", allowInsecureHttp: o.baseUrl.startsWith("http://"),
    ...(o.keyHeader ? { keyHeader: o.keyHeader } : {}), ...(o.maxSteps ? { maxSteps: o.maxSteps } : {}),
  };
  const c = await LocalController.create({
    env, profile: "code", realFs: true,
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async () => true, setTrusted: async () => {} },
  });
  const run: AgentRun = { seconds: 0, endedBy: "done", steps: 0, toolErrors: 0, tools: {}, calls: 0, promptTokens: 0, completionTokens: 0, notices: [], errors: [], final: "", trace: [] };
  const t0 = Date.now();
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  c.onEvent((e: SessionEvent) => {
    if (e.type === "permission") {
      // người dùng bấm "Để agent tự quyết"/đồng ý mọi thứ: bài thử đo khả năng code, không đo hội thoại
      c.respondPermission(e.request.id, { allow: true });
    } else if (e.type === "tool_start" && e.depth === 0) {
      run.steps++;
      run.tools[e.name] = (run.tools[e.name] ?? 0) + 1;
      run.trace.push(`→ ${e.name}: ${e.summary.slice(0, 140)}`);
    } else if (e.type === "tool_result" && e.depth === 0) {
      if (!e.ok) {
        run.toolErrors++;
        run.errors.push(`${e.name}${e.errKind ? " [" + e.errKind + "]" : ""}: ${e.output.replace(/\s+/g, " ").slice(0, 200)}`);
        run.trace.push(`  ✗ ${e.output.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    } else if (e.type === "usage") {
      run.calls = e.calls;
      run.promptTokens = e.promptTokens;
      run.completionTokens = e.completionTokens;
    } else if (e.type === "notice") {
      run.notices.push(`${e.level}: ${e.text.slice(0, 200)}`);
    } else if (e.type === "turn_end") {
      run.final = e.final;
      finish();
    }
  });
  const timer = setTimeout(() => {
    run.endedBy = "timeout";
    c.interrupt();
    setTimeout(finish, 3000);
  }, o.timeoutMs);
  try {
    await c.send(o.prompt);
    await done;
  } catch (e) {
    run.endedBy = "error";
    run.errors.push((e as Error).message);
  } finally {
    clearTimeout(timer);
    run.seconds = Math.round((Date.now() - t0) / 1000);
    try {
      c.dispose();
    } catch {
      /* đã đóng */
    }
  }
  return run;
}
