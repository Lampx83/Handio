import type { Env } from "./env";
import type { Tool } from "./tools";
import { ToolError } from "./tools";

export interface McpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Làm sạch cấu hình máy chủ MCP đọc từ tệp. */
export function sanitizeMcpServers(raw: unknown): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>).slice(0, 10)) {
    const s = v as Partial<McpServerSpec>;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/.test(name) || !s || typeof s.command !== "string" || !s.command || s.command.length > 500) continue;
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string" && a.length < 1000).slice(0, 30) : [];
    const env: Record<string, string> = {};
    if (s.env && typeof s.env === "object") for (const [k, val] of Object.entries(s.env).slice(0, 20)) if (/^[A-Z_][A-Z0-9_]*$/i.test(k) && typeof val === "string" && val.length < 2000) env[k] = val;
    out[name] = { command: s.command, args, env };
  }
  return out;
}

const PROTOCOL_VERSION = "2024-11-05";
const MAX_RESULT = 100_000;

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Máy khách MCP tối giản (JSON-RPC từng dòng qua stdio). */
export class McpClient {
  private id = 0;
  private pending = new Map<number, (m: any) => void>();
  private proc?: { write(line: string): void; stop(): void };
  private stderr: string[] = [];
  tools: McpTool[] = [];

  constructor(readonly name: string, private spec: McpServerSpec, private env: Env, private cwd: string) {}

  async start(timeoutMs = 20000): Promise<void> {
    if (!this.env.spawnStdio) throw new Error("nơi chạy này không hỗ trợ MCP");
    this.proc = this.env.spawnStdio(this.spec.command, this.spec.args ?? [], {
      cwd: this.cwd,
      env: this.spec.env,
      onLine: (line) => {
        try {
          const m = JSON.parse(line);
          if (m && typeof m === "object" && "id" in m && ("result" in m || "error" in m)) this.pending.get(m.id)?.(m);
        } catch {
          /* dòng không phải JSON (log): bỏ qua */
        }
      },
      onStderr: (t) => void (this.stderr = [...this.stderr, t.trim()].slice(-10)),
      onExit: () => {
        for (const cb of this.pending.values()) cb({ error: { message: "máy chủ MCP đã thoát" } });
      },
    });
    await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "neu-agent", version: "0.1" } }, timeoutMs);
    this.proc.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
    const res = await this.request("tools/list", {}, timeoutMs);
    this.tools = (Array.isArray(res.tools) ? res.tools : []).filter((t: McpTool) => t && typeof t.name === "string").slice(0, 64);
  }

  private request(method: string, params: unknown, timeoutMs = 60000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`máy chủ MCP “${this.name}” không phản hồi (${method})${this.stderr.length ? ": " + this.stderr.slice(-2).join(" | ").slice(0, 300) : ""}`));
      }, timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        this.pending.delete(id);
        m.error ? reject(new Error(String(m.error.message ?? m.error))) : resolve(m.result ?? {});
      });
      this.proc!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  async call(tool: string, args: unknown): Promise<string> {
    const res = await this.request("tools/call", { name: tool, arguments: args ?? {} }, 120000);
    const text = (Array.isArray(res.content) ? res.content : []).map((c: any) => (c?.type === "text" ? String(c.text ?? "") : `[${c?.type ?? "dữ liệu"}]`)).join("\n") || "(không có nội dung)";
    const clipped = text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + "\n… (đã cắt bớt)" : text;
    if (res.isError) throw new ToolError(clipped);
    return clipped;
  }

  close(): void {
    this.proc?.stop();
  }
}

/** Các máy chủ MCP của một phiên. Công cụ xuất hiện với tên mcp__<máy chủ>__<công cụ>; mọi lệnh gọi đều xin phép và coi kết quả là dữ liệu không tin cậy. */
export class McpManager {
  private clients: McpClient[] = [];
  errors: string[] = [];
  constructor(private servers: Record<string, McpServerSpec>, private env: Env, private cwd: string) {}

  async startAll(): Promise<void> {
    await Promise.all(
      Object.entries(this.servers).map(async ([name, spec]) => {
        const c = new McpClient(name, spec, this.env, this.cwd);
        try {
          await c.start();
          this.clients.push(c);
        } catch (e) {
          this.errors.push(`MCP “${name}”: ${(e as Error).message}`);
          c.close();
        }
      }),
    );
  }

  tools(): Tool[] {
    const out: Tool[] = [];
    for (const c of this.clients)
      for (const t of c.tools) {
        const safe = t.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
        out.push({
          name: `mcp__${c.name}__${safe}`, kind: "mcp", readonly: false,
          description: `[MCP ${c.name}] ${String(t.description ?? "").slice(0, 600)}`,
          parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
          summarize: (a) => JSON.stringify(a ?? {}).slice(0, 100),
          run: (_ctx, a) => c.call(t.name, a),
        });
      }
    return out;
  }

  close(): void {
    for (const c of this.clients) c.close();
    this.clients = [];
  }
}
