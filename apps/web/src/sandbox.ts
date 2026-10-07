import type { RunJsResult } from "@neu/agent-core";

/**
 * Chạy mã JS do mô hình viết trong một Web Worker dùng một lần (không DOM, không mạng, bị huỷ khi hết giờ).
 * Script worker là file tĩnh nên được phục vụ kèm header CSP `connect-src 'none'` (xem dev/server.mjs, docs/DEPLOY.md).
 */
export function runJsSandbox(code: string, opts: { timeoutMs: number; files: Record<string, string>; cwd?: string }): Promise<RunJsResult> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    let worker: Worker;
    try {
      worker = new Worker("sandbox-worker.js");
    } catch (e) {
      return resolve({ ok: false, logs: [], error: "Không tạo được hộp cát: " + (e as Error).message });
    }
    let finished = false;
    const done = (r: RunJsResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, logs: [], error: `Hết thời gian ${opts.timeoutMs / 1000}s (có thể mã bị lặp vô hạn).` }), opts.timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      const { ok, logs, result, error } = e.data;
      done({ ok, logs, result, error });
    };
    worker.onerror = (e) => done({ ok: false, logs: [], error: "Lỗi hộp cát: " + (e.message || "không rõ") });
    worker.postMessage({ id, code, files: opts.files, cwd: opts.cwd ?? "" });
  });
}
