import type { Env, PageReport } from "./env";
import { resolveSafe, ToolError, type Tool } from "./tools";

/** Đường dẫn tuyệt đối → file:// (đã mã hoá ký tự đặc biệt; Windows "E:/a" → file:///E:/a). */
const toFileUrl = (abs: string): string => "file://" + (abs.startsWith("/") ? "" : "/") + encodeURI(abs).replace(/#/g, "%23").replace(/\?/g, "%3F");

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;

/** Biến báo cáo thành văn bản ngắn cho mô hình: kết luận ở dòng đầu, lỗi đánh số, gợi ý bước tiếp theo. */
export function formatPageReport(r: PageReport): string {
  const head = `Trang ${r.url}${r.title ? ` — “${r.title}”` : ""}`;
  if (!r.loaded) {
    return `${head}\nKHÔNG MỞ ĐƯỢC: ${r.error ?? "lỗi không rõ"}.\nKiểm tra máy chủ đã chạy chưa (bash_output) và đúng cổng; đừng đoán, hãy xem log của máy chủ.`;
  }
  const bad = r.blank || r.errors.length > 0 || !!r.overlay;
  const lines = [head, bad ? `KẾT QUẢ: CÓ VẤN ĐỀ${r.blank ? " — TRANG TRẮNG (không có gì hiển thị)" : ""}` : "KẾT QUẢ: ổn (không lỗi console, trang có nội dung)."];
  if (r.overlay) lines.push("Lớp phủ lỗi của công cụ dựng:", "  " + r.overlay.split("\n").slice(0, 8).join("\n  "));
  if (r.errors.length) lines.push("Lỗi console/ngoại lệ:", ...r.errors.slice(0, 10).map((e, i) => `  ${i + 1}. ${e}`));
  if (r.failedRequests.length) lines.push("Yêu cầu hỏng:", ...r.failedRequests.slice(0, 8).map((e) => "  - " + e));
  if (r.text) lines.push(`Chữ hiện trên trang (đầu): ${r.text.slice(0, 280)}`);
  if (bad) lines.push("Sửa lỗi ĐẦU TIÊN (thường là nguyên nhân gốc của các lỗi sau), rồi gọi check_page lại cho đến khi sạch. Đừng nhờ người dùng chép lỗi từ trình duyệt.");
  return lines.join("\n");
}

/** `check_page`: chỉ đăng ký khi môi trường có `env.checkPage` (Desktop). */
export function pageTools(env: Env): Tool[] {
  const check = env.checkPage?.bind(env);
  if (!check) return [];
  return [
    {
      name: "check_page", kind: "exec", readonly: false,
      description:
        "Open a web page in a hidden sandboxed browser and report console errors, uncaught exceptions, failed requests and whether the page is BLANK. Use it right after starting a dev server (bash background) or writing an HTML file, and again after each fix, until it reports clean. Accepts http://localhost:PORT/… or a project file path (index.html).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "http://localhost:5173/ or a project-relative .html path" },
          wait_ms: { type: "integer", description: "extra time to let the page run, default 1500, max 8000" },
        },
        required: ["url"],
      },
      summarize: (a) => String(a.url ?? ""),
      async run(ctx, a) {
        const raw = String(a.url ?? "").trim();
        if (!raw) throw new ToolError("Thiếu url.", "bad_args");
        let target = raw;
        if (!/^https?:\/\//i.test(raw)) {
          const abs = await resolveSafe(ctx, raw);
          const st = await ctx.env.stat(abs);
          if (!st?.isFile) throw new ToolError(`Không có tệp '${raw}' trong dự án.`, "not_found");
          target = toFileUrl(abs);
        } else if (!LOCAL.test(raw)) {
          throw new ToolError("check_page chỉ mở trang trên máy này (localhost / 127.0.0.1) hoặc tệp trong dự án.", "bad_args");
        }
        const waitMs = Math.max(0, Math.min(Math.floor(Number(a.wait_ms) || 1500), 8000));
        const r = await check(target, { waitMs, signal: ctx.signal });
        return formatPageReport(r);
      },
    },
  ];
}
