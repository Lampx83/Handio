/** Client gọi mô hình qua giao diện kiểu OpenAI (/chat/completions, streaming). Dùng fetch nên chạy ở Node, Electron và trình duyệt. */
import type { QuotaInfo } from "./types";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  key?: string;
  keyHeader?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinking?: boolean;
  /** Cho phép http:// tới máy không phải cục bộ (mặc định KHÔNG: key và nội dung sẽ đi dạng rõ trên mạng). */
  allowInsecure?: boolean;
  /** Tiêu đề đăng nhập (Authorization: Bearer… hoặc Cookie phiên) cho máy chủ yêu cầu đăng nhập; chỉ được gọi khi địa chỉ API nằm trong danh sách máy chủ tin cậy của ứng dụng. */
  authHeaders?: () => Promise<Record<string, string> | null>;
  /** Tab đang dùng (work|code|design), khai báo cho cổng của máy chủ NEU để kiểm tra phân quyền theo nhóm. Chỉ gửi tới địa chỉ dạng …/vllm/v1. */
  tab?: string;
}

/** Địa chỉ API của gateway NEU (…/vllm/v1): nơi có cổng hạn mức + phân quyền tab. */
const isNeuGateway = (baseUrl: string): boolean => /\/vllm\/v1\/?$/.test(baseUrl);
const TAB_NAMES = ["work", "code", "design"];

export interface ToolCallMsg {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallMsg[];
  tool_call_id?: string;
}
/** Tin nhắn có ảnh (chỉ dùng cho việc đọc ảnh: LlmClient.vision). */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface VisionMessage {
  role: "user";
  content: ContentPart[];
}
export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** vLLM/OpenAI: số token lời nhắc được dùng lại từ bộ nhớ đệm tiền tố (nếu máy chủ báo). */
  prompt_tokens_details?: { cached_tokens?: number };
}
export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ParsedToolCall[];
  usage: Usage;
  finish: string | null;
}
export interface ChatOptions {
  tools?: ToolSchema[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  onContent?: (t: string) => void;
  onReasoning?: (t: string) => void;
  onFirst?: () => void;
  notify?: (msg: string) => void;
  retries?: number;
}

export type LlmErrorKind = "context" | "auth" | "rate" | "server" | "network" | "abort" | "insecure" | "quota" | "";
export class LlmError extends Error {
  constructor(message: string, public status = 0, public kind: LlmErrorKind = "", /** "login_required": máy chủ yêu cầu đăng nhập (chưa đăng nhập hoặc phiên hết hạn): giao diện hiện nút Đăng nhập lại. */ public code = "") {
    super(message);
  }
}

const notModelServer = () => new LlmError("Địa chỉ API không trả về dữ liệu của mô hình (nhận được một trang web). Hãy kiểm tra lại địa chỉ ở Cài đặt, hoặc máy chủ chưa được cấu hình.", 0, "");

function friendly(status: number, text: string): LlmError {
  const low = (text || "").toLowerCase();
  if (status === 400 && (low.includes("context length") || low.includes("maximum context") || low.includes("too long")))
    return new LlmError("Ngữ cảnh vượt giới hạn của mô hình.", status, "context");
  if (status === 402 && !low.includes("quota_exceeded")) return new LlmError("Hạn mức sử dụng đã hết hoặc tài khoản cần nạp thêm (máy chủ trả 402).", status, "quota");
  if (status === 402) {
    // tab_quota_exceeded: hết hạn mức riêng của tab đang dùng (các tab khác vẫn dùng được)
    const code = low.includes("tab_quota_exceeded") ? "tab_quota_exceeded" : "quota_exceeded";
    try {
      const j = JSON.parse(text) as { message?: string };
      return new LlmError(typeof j.message === "string" && j.message ? j.message.slice(0, 300) : "Bạn đã dùng hết hạn mức token hôm nay. Hạn mức làm mới lúc 00:00 ngày mai.", status, "quota", code);
    } catch {
      return new LlmError("Bạn đã dùng hết hạn mức token hôm nay. Hạn mức làm mới lúc 00:00 ngày mai.", status, "quota", code);
    }
  }
  if (status === 403 && (low.includes("tab_not_allowed") || low.includes("tab_required") || low.includes("model_not_allowed"))) {
    const code = low.includes("model_not_allowed") ? "model_not_allowed" : low.includes("tab_not_allowed") ? "tab_not_allowed" : "tab_required";
    let msg = code === "model_not_allowed" ? "Nhóm của bạn không được dùng mô hình này. Hãy chọn lại mô hình ở Cài đặt." : code === "tab_not_allowed" ? "Nhóm của bạn không được dùng tab này." : "Phiên bản ứng dụng này chưa khai báo tab. Hãy cập nhật ứng dụng hoặc tải lại trang.";
    try {
      const j = JSON.parse(text) as { message?: string };
      if (typeof j.message === "string" && j.message) msg = j.message.slice(0, 300);
    } catch {
      /* giữ thông báo mặc định */
    }
    return new LlmError(msg, status, "auth", code);
  }
  if (status === 401 && low.includes("login_required")) return new LlmError("Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.", status, "auth", "login_required");
  if (status === 401) return new LlmError("Key sai hoặc chưa nhập. Vào Cài đặt để nhập lại.", status, "auth");
  if (status === 403) return new LlmError("Key này không được dùng mô hình chat (có thể là key chỉ dành cho embedding).", status, "auth");
  if (status === 429) return new LlmError("Vượt giới hạn số lệnh/phút của key.", status, "rate");
  if (status === 502 || status === 503 || status === 504) return new LlmError("Mô hình đang khởi động hoặc quá tải.", status, "server");
  if (/^\s*<(!doctype|html)/i.test(text || ""))
    return new LlmError(`Máy chủ trả về trang web (HTTP ${status}) thay vì mô hình: dịch vụ mô hình chưa được cấu hình ở địa chỉ này. Hãy báo quản trị viên, hoặc kiểm tra địa chỉ API ở Cài đặt.`, status);
  return new LlmError(`Lỗi ${status}: ${(text || "").slice(0, 300)}`, status);
}

const isLoopback = (h: string): boolean => /^(localhost|\[?::1\]?|127(\.\d{1,3}){3})$/i.test(h);

/** Địa chỉ API phải là https (trừ máy cục bộ) và không chứa tài khoản/mật khẩu; tránh gửi key dạng rõ. */
export function assertSecureEndpoint(baseUrl: string, allowInsecure = false): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new LlmError("Địa chỉ API không hợp lệ: " + baseUrl, 0, "");
  }
  if (u.username || u.password) throw new LlmError("Địa chỉ API không được chứa tên đăng nhập/mật khẩu.", 0, "insecure");
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (isLoopback(u.hostname) || allowInsecure)) return;
  throw new LlmError(
    u.protocol === "http:" ? `Địa chỉ API dùng HTTP không mã hoá (${u.host}): key và nội dung trao đổi có thể bị nghe lén. Hãy dùng địa chỉ https://… hoặc, nếu đây là mạng nội bộ tin cậy, bật “Cho phép HTTP không mã hoá” trong Cài đặt.` : "Địa chỉ API phải bắt đầu bằng https://",
    0, "insecure",
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError("Đã dừng.", 0, "abort"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new LlmError("Đã dừng.", 0, "abort"));
    }, { once: true });
  });

const rid = () => "call_" + Math.random().toString(16).slice(2, 14);

/** Mô hình đôi khi viết lời gọi công cụ thành văn bản (<tool_call>{json}</tool_call> hoặc <function=…>). Đưa về dạng chuẩn. */
export function parseTextToolCalls(content: string): { text: string; calls: ParsedToolCall[] } {
  const calls: ParsedToolCall[] = [];
  const add = (name: string, args: unknown) => {
    if (name) calls.push({ id: rid(), name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
  };
  const fromFunction = (name: string, body: string) => {
    const params: Record<string, string> = {};
    for (const m of body.matchAll(/<parameter=([\w.\-]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) params[m[1]] = m[2];
    add(name, params);
  };
  let clean = content.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (whole, inner: string) => {
    try {
      const obj = JSON.parse(inner);
      if (obj && typeof obj === "object" && obj.name) {
        add(obj.name, obj.arguments ?? {});
        return "";
      }
    } catch {
      /* không phải JSON */
    }
    const fm = /<function=([\w.\-]+)>([\s\S]*?)<\/function>/.exec(inner);
    if (fm) {
      fromFunction(fm[1], fm[2]);
      return "";
    }
    return whole;
  });
  if (!calls.length)
    clean = clean.replace(/<function=([\w.\-]+)>([\s\S]*?)<\/function>/g, (_w, n: string, b: string) => {
      fromFunction(n, b);
      return "";
    });
  return { text: clean.trim(), calls };
}

const QUOTA_STATES = ["ok", "warn", "grace", "exceeded", "unlimited"];
/** Đọc hạn mức từ tiêu đề X-Quota-* mà cổng hạn mức của máy chủ gắn vào phản hồi (không có = máy chủ không giới hạn/không hỗ trợ). */
export function quotaFromHeaders(h: Headers): QuotaInfo | null {
  const state = h.get("x-quota-state");
  if (!state || !QUOTA_STATES.includes(state)) return null;
  const n = (k: string): number => {
    const v = Number(h.get(k));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const limit = n("x-quota-limit");
  const used = n("x-quota-used");
  const rem = h.get("x-quota-remaining");
  return { limit, used, remaining: rem === null ? null : n("x-quota-remaining"), pct: limit ? Math.round((1000 * used) / limit) / 10 : null, state: state as QuotaInfo["state"], resetAt: n("x-quota-reset"), tier: h.get("x-quota-tier") ?? undefined };
}

export class LlmClient {
  /** Được gọi mỗi khi biết hạn mức mới (từ tiêu đề phản hồi hoặc GET /quota). */
  onQuota?: (q: QuotaInfo) => void;
  constructor(private getConfig: () => LlmConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async headers(accept = "text/event-stream"): Promise<Record<string, string>> {
    const c = this.getConfig();
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: accept };
    if (c.key) h[c.keyHeader || "x-ollama-seckey"] = c.key;
    const extra = await c.authHeaders?.().catch(() => null);
    // chỉ nhận đúng hai tiêu đề đăng nhập; không để phần chủ ghi đè Content-Type, Accept, …
    if (extra?.Authorization) h.Authorization = extra.Authorization;
    if (extra?.Cookie) h.Cookie = extra.Cookie;
    // khai tab cho cổng của máy chủ NEU (máy chủ tự kiểm tra); không gửi tiêu đề lạ tới máy chủ khác (tránh lỗi CORS và rò thông tin)
    if (c.tab && TAB_NAMES.includes(c.tab) && isNeuGateway(c.baseUrl)) h["X-Neu-Tab"] = c.tab;
    return h;
  }

  private noteQuota(h: Headers): void {
    const q = quotaFromHeaders(h);
    if (q) this.onQuota?.(q);
  }

  /** Hỏi máy chủ hạn mức hiện tại (không tốn token). null nếu máy chủ không có cổng hạn mức hoặc lỗi. Không bao giờ ném lỗi. */
  async quota(signal?: AbortSignal): Promise<QuotaInfo | null> {
    try {
      const c = this.getConfig();
      assertSecureEndpoint(c.baseUrl, c.allowInsecure);
      if (!/\/vllm\/v1\/?$/.test(c.baseUrl)) return null;
      const r = await this.fetchImpl(c.baseUrl.replace(/\/vllm\/v1\/?$/, "/quota"), { headers: await this.headers("application/json"), signal, redirect: "error" });
      if (!r.ok || /html/i.test(r.headers.get("content-type") ?? "")) return null;
      const j = (await r.json()) as Record<string, unknown>;
      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
      const state = typeof j.state === "string" && QUOTA_STATES.includes(j.state) ? (j.state as QuotaInfo["state"]) : null;
      if (!state) return null;
      const tabs = Array.isArray(j.tabs) ? TAB_NAMES.filter((t) => (j.tabs as unknown[]).includes(t)) : undefined;
      return { limit: num(j.limit), used: num(j.used), remaining: typeof j.remaining === "number" ? j.remaining : null, pct: typeof j.pct === "number" ? j.pct : null, state, resetAt: num(j.reset_at), tier: typeof j.tier === "string" ? j.tier : undefined, ...(tabs ? { tabs } : {}) };
    } catch {
      return null;
    }
  }

  async models(signal?: AbortSignal): Promise<string[]> {
    const c = this.getConfig();
    assertSecureEndpoint(c.baseUrl, c.allowInsecure);
    let r: Response;
    try {
      r = await this.fetchImpl(c.baseUrl.replace(/\/+$/, "") + "/models", { headers: await this.headers("application/json"), signal, redirect: "error" });
    } catch (e) {
      throw new LlmError("Không kết nối được máy chủ: " + (e as Error).message, 0, "network");
    }
    if (!r.ok) throw friendly(r.status, await r.text());
    if (/html/i.test(r.headers.get("content-type") ?? "")) throw notModelServer();
    const j = (await r.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id);
  }

  /** Nhờ mô hình đọc một ảnh (data URL) theo chỉ dẫn: chép chữ (OCR), mô tả biểu đồ, trích bảng… Trả về văn bản. Không dùng công cụ, không suy luận. */
  async vision(imageDataUrl: string, instruction: string, o: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<string> {
    const r = await this.chat([{ role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }], { signal: o.signal, maxTokens: o.maxTokens ?? 4096, temperature: 0, thinking: false, retries: 2 });
    return r.content.trim();
  }

  async chat(messages: ReadonlyArray<ChatMessage | VisionMessage>, o: ChatOptions = {}): Promise<ChatResult> {
    const c = this.getConfig();
    assertSecureEndpoint(c.baseUrl, c.allowInsecure);
    const body: Record<string, unknown> = {
      model: c.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: o.temperature ?? c.temperature ?? 0.3,
      max_tokens: o.maxTokens ?? c.maxOutputTokens ?? 4096,
      chat_template_kwargs: { enable_thinking: !!(o.thinking ?? c.thinking) },
    };
    if (o.tools?.length) {
      body.tools = o.tools;
      body.tool_choice = "auto";
    }
    const payload = JSON.stringify(body);
    const retries = o.retries ?? 6;
    const notify = o.notify ?? (() => undefined);
    for (let attempt = 1; ; attempt++) {
      if (o.signal?.aborted) throw new LlmError("Đã dừng.", 0, "abort");
      let resp: Response;
      try {
        resp = await this.fetchImpl(c.baseUrl.replace(/\/+$/, "") + "/chat/completions", { method: "POST", headers: await this.headers(), body: payload, signal: o.signal, redirect: "error" });
      } catch (e) {
        if (o.signal?.aborted) throw new LlmError("Đã dừng.", 0, "abort");
        if (attempt <= 3) {
          notify(`Mất kết nối (${(e as Error).message}). Thử lại sau 3s…`);
          await sleep(3000, o.signal);
          continue;
        }
        throw new LlmError("Không kết nối được máy chủ: " + (e as Error).message, 0, "network");
      }
      this.noteQuota(resp.headers);
      if (!resp.ok) {
        const err = friendly(resp.status, await resp.text().catch(() => ""));
        if (err.kind === "rate" && attempt <= retries) {
          const ra = parseInt(resp.headers.get("Retry-After") ?? "", 10);
          const wait = Math.min(Number.isFinite(ra) ? ra : 5, 60);
          notify(`Chạm giới hạn lệnh/phút, thử lại sau ${wait}s…`);
          await sleep(wait * 1000, o.signal);
          continue;
        }
        if (err.kind === "server" && attempt <= retries + 4) {
          const wait = Math.min(5 * attempt, 30);
          notify(`${err.message} Thử lại sau ${wait}s (lần ${attempt})…`);
          await sleep(wait * 1000, o.signal);
          continue;
        }
        throw err;
      }
      if (/html/i.test(resp.headers.get("content-type") ?? "")) throw notModelServer();
      return this.readStream(resp, o);
    }
  }

  private async readStream(resp: Response, o: ChatOptions): Promise<ChatResult> {
    const content: string[] = [];
    const reasoning: string[] = [];
    const calls = new Map<number, ParsedToolCall>();
    let usage: Usage = {};
    let finish: string | null = null;
    let first = true;
    const touch = () => {
      if (first) {
        first = false;
        o.onFirst?.();
      }
    };
    if (!resp.body) throw new LlmError("Máy chủ không trả luồng dữ liệu.", 0, "network");
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let j: any;
          try {
            j = JSON.parse(data);
          } catch {
            continue;
          }
          if (j.error) throw new LlmError(String(j.error.message ?? j.error).slice(0, 300));
          if (j.usage) usage = j.usage;
          const ch = j.choices?.[0];
          if (!ch) continue;
          if (ch.finish_reason) finish = ch.finish_reason;
          const d = ch.delta ?? {};
          const r = d.reasoning ?? d.reasoning_content;
          if (r) {
            touch();
            reasoning.push(r);
            o.onReasoning?.(r);
          }
          if (d.content) {
            touch();
            content.push(d.content);
            o.onContent?.(d.content);
          }
          for (const tc of d.tool_calls ?? []) {
            touch();
            const idx: number = tc.index ?? 0;
            const e = calls.get(idx) ?? { id: "", name: "", arguments: "" };
            if (tc.id) e.id = tc.id;
            if (tc.function?.name && !e.name) e.name = tc.function.name;
            if (tc.function?.arguments) e.arguments += tc.function.arguments;
            calls.set(idx, e);
          }
        }
      }
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (o.signal?.aborted) throw new LlmError("Đã dừng.", 0, "abort");
      throw new LlmError("Kết nối bị ngắt giữa chừng: " + (e as Error).message, 0, "network");
    }
    let toolCalls = [...calls.keys()].sort((a, b) => a - b).map((k) => calls.get(k)!).filter((c) => c.name).map((c) => ({ id: c.id || rid(), name: c.name, arguments: c.arguments || "{}" }));
    let text = content.join("");
    if (!toolCalls.length && (text.includes("<tool_call>") || text.includes("<function="))) {
      const p = parseTextToolCalls(text);
      text = p.text;
      toolCalls = p.calls;
    }
    return { content: text, reasoning: reasoning.join(""), toolCalls, usage, finish };
  }
}
