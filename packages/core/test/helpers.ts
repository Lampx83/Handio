import { LocalController, MemoryEnv, normalizeSettings, type ChatMessage, type ChatOptions, type ChatResult, type LlmClient, type PermissionRequest, type PermissionResponse, type SessionEvent, type Settings } from "../src";

export type Step = { text?: string; calls?: { name: string; args: unknown }[]; finish?: string; usage?: { prompt_tokens: number; completion_tokens: number } };

/** Mô hình giả: mỗi lần gọi chat() trả về bước tiếp theo trong kịch bản (hoặc tính từ hàm). */
export class FakeLlm {
  calls: { messages: ChatMessage[]; opts: ChatOptions }[] = [];
  private i = 0;
  constructor(private script: Step[] | ((messages: ChatMessage[], n: number) => Step)) {}
  async models() {
    return ["fake-model"];
  }
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    this.calls.push({ messages: JSON.parse(JSON.stringify(messages)), opts });
    if (opts.signal?.aborted) throw Object.assign(new Error("abort"), { kind: "abort" });
    const step = typeof this.script === "function" ? this.script(messages, this.i++) : this.script[Math.min(this.i++, this.script.length - 1)];
    if (step.text) opts.onContent?.(step.text);
    return {
      content: step.text ?? "",
      reasoning: "",
      toolCalls: (step.calls ?? []).map((c, k) => ({ id: `c${this.i}_${k}`, name: c.name, arguments: JSON.stringify(c.args) })),
      usage: step.usage ?? { prompt_tokens: 100, completion_tokens: 20 },
      finish: step.finish ?? "stop",
    };
  }
}

export const SEED = {
  "README.md": "# Demo\n",
  "hello.py": 'def greet(name):\n    print("Hello", name)\n\ngreet("world")\n',
  "src/util.py": "def add(a, b):\n    return a + b\n",
  ".env": "SECRET=1\n",
};

export async function makeController(script: ConstructorParameters<typeof FakeLlm>[0], opts: { packs?: import("../src").RawPack[]; toolsBase?: string; fetchImpl?: typeof fetch; diagnostics?: import("../src").ControllerOptions["diagnostics"]; seed?: Record<string, string>; settings?: Partial<Settings>; decide?: (r: PermissionRequest) => PermissionResponse | Promise<PermissionResponse>; env?: MemoryEnv; trusted?: boolean; profile?: "code" | "work" | "design" } = {}) {
  const env = opts.env ?? new MemoryEnv("/ws", opts.seed ?? SEED);
  let saved: Partial<Settings> = { ...opts.settings };
  const trustedMap = new Map<string, boolean>([[env.root, !!opts.trusted]]);
  const c = await LocalController.create({
    env,
    profile: opts.profile,
    realFs: false,
    packs: opts.packs ? async () => opts.packs! : undefined,
    toolsBase: opts.toolsBase,
    diagnostics: opts.diagnostics,
    fetchImpl: opts.fetchImpl,
    store: { load: async () => saved, save: async (s) => void (saved = s) },
    trust: { isTrusted: async (r) => !!trustedMap.get(r), setTrusted: async (r, t) => void trustedMap.set(r, t) },
  });
  const llm = new FakeLlm(script);
  // thay client thật bằng mô hình giả
  (c.currentSession.o as { llm: LlmClient }).llm = llm as unknown as LlmClient;
  const events: SessionEvent[] = [];
  const requests: PermissionRequest[] = [];
  c.onEvent((e) => {
    events.push(e);
    if (e.type === "permission") {
      requests.push(e.request);
      const d = opts.decide ?? (() => ({ allow: true }));
      Promise.resolve(d(e.request)).then((r) => c.respondPermission(e.request.id, r));
    }
  });
  return { c, env, llm, events, requests, settings: () => normalizeSettings(saved) };
}
