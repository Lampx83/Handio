import type { Env, PageReport, PageStep } from "./env";
import { resolveSafe, ToolError, type Tool } from "./tools";

/** Đường dẫn tuyệt đối → file:// (đã mã hoá ký tự đặc biệt; Windows "E:/a" → file:///E:/a). */
const toFileUrl = (abs: string): string => "file://" + (abs.startsWith("/") ? "" : "/") + encodeURI(abs).replace(/#/g, "%23").replace(/\?/g, "%3F");

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;

export const MAX_PAGE_STEPS = 8;
export const MAX_STEP_WAIT_MS = 3000;
const ACTIONS = ["click", "type", "wait", "expect_text"] as const;
/** "#id", ".lop", "[name=x]", "button.primary", "form > input"…: trông như bộ chọn CSS chứ không phải chữ trên nút. */
const looksLikeSelector = (s: string) => /^[#.[]/.test(s.trim()) || /^[a-z][a-z0-9-]*([#.][a-z_-][\w-]*|\[[^\]]+\]|:[\w-]+(\([^)]*\))?)+$/i.test(s.trim());

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : undefined);

/**
 * Đọc tham số `steps` của mô hình thành danh sách bước hợp lệ. Nhận cả dạng gọn mà mô hình hay viết ({click: "Bắt đầu"}, {wait: 500},
 * {type: "#ten", value: "An"}) và mảng bị mã hoá thành chuỗi JSON. Sai thì ném lỗi nói rõ cách viết đúng.
 */
export function parsePageSteps(raw: unknown): PageStep[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      throw new ToolError("steps phải là mảng, ví dụ [{\"action\":\"click\",\"text\":\"Bắt đầu\"}].", "bad_args");
    }
  }
  if (!Array.isArray(v)) throw new ToolError("steps phải là mảng, ví dụ [{\"action\":\"click\",\"text\":\"Bắt đầu\"}].", "bad_args");
  if (v.length > MAX_PAGE_STEPS) throw new ToolError(`Tối đa ${MAX_PAGE_STEPS} bước mỗi lần check_page; tách thành nhiều lần gọi.`, "bad_args");
  return v.map((x, i): PageStep => {
    const n = i + 1;
    if (!x || typeof x !== "object") throw new ToolError(`Bước ${n} phải là đối tượng {action, …}.`, "bad_args");
    const o = x as Record<string, unknown>;
    let action = typeof o.action === "string" ? o.action.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
    if (action === "expect" || action === "assert_text" || action === "expect_texts") action = "expect_text";
    if (action === "fill" || action === "input") action = "type";
    const step: PageStep = { action: action as PageStep["action"] };
    // dạng gọn: {click: "…"} / {type: "…", value} / {wait: 500} / {expect_text: "…"}
    if (!action) {
      const key = ACTIONS.find((a) => o[a] !== undefined) ?? (o.expect !== undefined ? "expect" : o.fill !== undefined ? "fill" : "");
      if (!key) throw new ToolError(`Bước ${n} thiếu action (click | type | wait | expect_text).`, "bad_args");
      step.action = key === "expect" ? "expect_text" : key === "fill" ? "type" : key;
      const val = o[key];
      if (step.action === "wait") step.ms = Number(val);
      else if (typeof val === "string") {
        if (step.action !== "expect_text" && looksLikeSelector(val)) step.selector = val;
        else step.text = val;
      }
    }
    if (!ACTIONS.includes(step.action)) throw new ToolError(`Bước ${n}: action '${String(o.action)}' không hỗ trợ (chỉ click | type | wait | expect_text).`, "bad_args");
    step.selector = str(o.selector, 200) ?? step.selector?.slice(0, 200);
    step.text = str(o.text ?? o.label ?? o.placeholder, 200) ?? step.text?.slice(0, 200);
    if (step.action === "type") step.value = str(o.value ?? o.content, 500) ?? "";
    if (step.action === "wait") step.ms = Math.max(0, Math.min(Math.floor(Number(o.ms ?? o.wait_ms ?? step.ms) || 500), MAX_STEP_WAIT_MS));
    if ((step.action === "click" || step.action === "type") && !step.selector && !step.text) throw new ToolError(`Bước ${n} (${step.action}) cần selector (CSS) hoặc text (chữ trên nút / placeholder ô nhập).`, "bad_args");
    if (step.action === "expect_text" && !step.text) throw new ToolError(`Bước ${n} (expect_text) cần text.`, "bad_args");
    for (const k of Object.keys(step) as (keyof PageStep)[]) if (step[k] === undefined || step[k] === "") if (k !== "value") delete step[k];
    return step;
  });
}

/** Mô tả ngắn một bước cho báo cáo ("bấm “Bắt đầu”"). */
export function pageStepLabel(s: PageStep): string {
  const q = (t: string) => `“${t.slice(0, 60)}”`;
  const target = s.text ? q(s.text) : s.selector ?? "";
  if (s.action === "click") return `bấm ${target}`;
  if (s.action === "type") return `gõ ${q(s.value ?? "")} vào ${target}`;
  if (s.action === "wait") return `chờ ${s.ms ?? 0} ms`;
  return `cần thấy ${target}`;
}

/** Biến báo cáo thành văn bản ngắn cho mô hình: kết luận ở dòng đầu, lỗi đánh số, gợi ý bước tiếp theo. */
export function formatPageReport(r: PageReport): string {
  const head = `Trang ${r.url}${r.title ? ` — “${r.title}”` : ""}`;
  if (!r.loaded) {
    return `${head}\nKHÔNG MỞ ĐƯỢC: ${r.error ?? "lỗi không rõ"}.\nKiểm tra máy chủ đã chạy chưa (bash_output) và đúng cổng; đừng đoán, hãy xem log của máy chủ.`;
  }
  const steps = r.steps ?? [];
  const stepBad = steps.some((s) => !s.ok || s.errors.length > 0);
  const bad = r.blank || r.errors.length > 0 || !!r.overlay || stepBad;
  const okLine = steps.length ? `KẾT QUẢ: ổn (không lỗi console, trang có nội dung, ${steps.length} bước tương tác chạy được).` : "KẾT QUẢ: ổn (không lỗi console, trang có nội dung).";
  const lines = [head, bad ? `KẾT QUẢ: CÓ VẤN ĐỀ${r.blank ? " — TRANG TRẮNG (không có gì hiển thị)" : ""}${stepBad && !r.blank ? " — LỖI KHI THAO TÁC" : ""}` : okLine];
  if (r.overlay) lines.push("Lớp phủ lỗi của công cụ dựng:", "  " + r.overlay.split("\n").slice(0, 8).join("\n  "));
  if (r.errors.length) lines.push(steps.length ? "Lỗi console/ngoại lệ lúc tải trang:" : "Lỗi console/ngoại lệ:", ...r.errors.slice(0, 10).map((e, i) => `  ${i + 1}. ${e}`));
  if (steps.length) {
    lines.push("Các bước:");
    steps.forEach((s, i) => {
      lines.push(`  Bước ${i + 1}: ${s.label} — ${s.ok ? (s.errors.length ? "làm được nhưng PHÁT SINH LỖI" : "ổn") : "KHÔNG LÀM ĐƯỢC" + (s.note ? ": " + s.note : "")}`);
      if (s.dialogs?.length) lines.push(`    hộp thoại: ${s.dialogs.slice(0, 3).map((d) => `“${d}”`).join(", ")}`);
      s.errors.slice(0, 6).forEach((e, j) => lines.push(`    ${j + 1}. lỗi sau bước ${i + 1}: ${e}`));
    });
  }
  if (r.failedRequests.length) lines.push("Yêu cầu hỏng:", ...r.failedRequests.slice(0, 8).map((e) => "  - " + e));
  if (r.text) lines.push(`${steps.length ? "Chữ trên trang sau bước cuối" : "Chữ hiện trên trang"} (đầu): ${r.text.slice(0, steps.length ? 400 : 280)}`);
  if (r.buttons?.length) lines.push(`Nút đang hiện: ${r.buttons.slice(0, 12).map((b) => `“${b}”`).join(", ")}`);
  if (bad) {
    lines.push(
      stepBad && !r.errors.length && !r.blank
        ? "Trang tải được nhưng HỎNG KHI BẤM/GÕ: đó chính là lỗi người dùng sẽ gặp. Sửa lỗi ở bước đầu tiên hỏng (thường là biến/hàm chưa khai báo trong hàm xử lý sự kiện), rồi gọi lại check_page với cùng steps cho đến khi sạch."
        : "Sửa lỗi ĐẦU TIÊN (thường là nguyên nhân gốc của các lỗi sau), rồi gọi check_page lại cho đến khi sạch. Đừng nhờ người dùng chép lỗi từ trình duyệt.",
    );
  } else if (!steps.length && r.buttons?.length) {
    lines.push("Trang tải được chưa có nghĩa là nút bấm chạy: gọi lại check_page với steps bấm nút chính và đi hết luồng chính (ví dụ [{\"action\":\"click\",\"text\":\"" + r.buttons[0].slice(0, 30).replace(/"/g, "") + "\"}]).");
  }
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
        "Open a web page in a hidden sandboxed browser and report console errors, uncaught exceptions, failed requests and whether the page is BLANK. Use it right after starting a dev server (bash background) or writing an HTML file, and again after each fix, until it reports clean. Accepts http://localhost:PORT/… or a project file path (index.html). " +
        `A page that loads cleanly can still crash when a button is pressed (e.g. "X is not defined" in an onClick handler): pass steps (max ${MAX_PAGE_STEPS}) to click the app's main buttons, type into inputs and check the result; errors are reported per step together with the page text after the last step.`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "http://localhost:5173/ or a project-relative .html path" },
          wait_ms: { type: "integer", description: "extra time to let the page run, default 1500, max 8000" },
          steps: {
            type: "array",
            maxItems: MAX_PAGE_STEPS,
            description:
              'Interactions run in order after the page loads, e.g. [{"action":"click","text":"Bắt đầu làm bài"},{"action":"click","text":"A"},{"action":"click","text":"Nộp bài"},{"action":"expect_text","text":"Điểm"}]. click: by visible button text or CSS selector; type: into an input found by selector or by its placeholder/label text; wait: ms (max 3000); expect_text: the page must show this text.',
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: [...ACTIONS] },
                text: { type: "string", description: "button text (click), placeholder/label (type) or text to find (expect_text)" },
                selector: { type: "string", description: "CSS selector (click/type), instead of text" },
                value: { type: "string", description: "text to type (type)" },
                ms: { type: "integer", description: "milliseconds (wait)" },
              },
              required: ["action"],
            },
          },
        },
        required: ["url"],
      },
      summarize: (a) => String(a.url ?? "") + (Array.isArray(a.steps) && a.steps.length ? ` (+${a.steps.length} bước)` : ""),
      async run(ctx, a) {
        const raw = String(a.url ?? "").trim();
        if (!raw) throw new ToolError("Thiếu url.", "bad_args");
        const steps = parsePageSteps(a.steps);
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
        const r = await check(target, steps.length ? { waitMs, steps, signal: ctx.signal } : { waitMs, signal: ctx.signal });
        return formatPageReport(r);
      },
    },
  ];
}
