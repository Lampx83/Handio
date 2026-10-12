/**
 * Hồ sơ công việc của một lượt, để biết NGƯỜI DÙNG LÀM VIỆC GÌ và việc nào hay hỏng, mà KHÔNG gửi nội dung.
 * Mọi hàm ở đây chạy cục bộ trên máy người dùng và chỉ trả về MÃ trong danh sách cố định (enum): loại việc, loại sản phẩm, bộ khung
 * dự án, kết quả kiểm chứng. Câu hỏi/tên tệp/lệnh được đọc để phân loại rồi bỏ; không có chuỗi nào của người dùng đi ra khỏi hàm.
 */
import { fold } from "./tool-groups";

export const TASK_KINDS = ["build", "edit", "fix", "explain", "research", "convert", "other"] as const;
export const ARTIFACTS = ["web", "python", "word", "excel", "slides", "pdf", "text", "data", "image", "other"] as const;
export const STACKS = ["static", "react", "vue", "svelte", "next", "vite", "node", "express", "python", "flask", "fastapi", "django", "streamlit", "other"] as const;
export const UI_LIBS = ["tailwind", "chakra", "mui", "antd", "bootstrap", "shadcn", "none"] as const;
export const VERIFY_STATES = ["none", "pass", "fail"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export type Artifact = (typeof ARTIFACTS)[number];
export type Stack = (typeof STACKS)[number];
export type UiLib = (typeof UI_LIBS)[number];

// thứ tự quan trọng: "sửa lỗi" thắng "sửa", "chuyển" thắng "tạo"…
const KIND_RULES: [TaskKind, RegExp][] = [
  ["fix", /\b(loi|bug|fix|error|crash|hong|khong chay|khong hien|khong duoc|khong thay|trang trang|bi sai|sai roi|treo|dung lai|that bai|fail)/],
  ["convert", /\b(chuyen|xuat|dich)\b.{0,25}\b(sang|thanh|ra|pdf|docx|xlsx|pptx|word|excel|powerpoint)\b|\b(convert|export|translate)\b|doi (sang|dinh dang)/],
  ["edit", /\b(sua|chinh|doi|thay|them|bo sung|cap nhat|xoa|bo bot|dieu chinh|rut gon|viet lai|edit|update|change|add|remove|rename|refactor|improve|cai thien|nang cap)\b/],
  ["build", /\b(tao|lam|viet|xay dung|thiet ke|soan|lap|build|create|make|generate|develop|code|phat trien)\b/],
  ["research", /\b(tim|tra cuu|nghien cuu|tong hop|so sanh|thu thap|search|research|find|compare|tim hieu)\b/],
  ["explain", /\b(giai thich|la gi|tai sao|vi sao|nhu the nao|huong dan|giup toi hieu|explain|why|what is|how (do|does|to))/],
];
/** Người dùng nói kết quả trước chưa đạt (chỉ có nghĩa từ lượt thứ hai của cuộc trò chuyện). */
const REDO_RE = /\b(van (con |bi |lai )?(loi|sai|khong|nhu cu|vay|the)|chua (dung|duoc|xong|hien|chay|on|dep)|khong (dung|duoc|chay|hien|on|phai)|sai roi|lam lai|sua lai|lai loi|lai sai|van chua|khong thay (gi|doi)|khong co gi|y toi la|khong phai (y|nhu))/;

export function classifyPrompt(text: string): { kind: TaskKind; redoCue: boolean } {
  const f = fold(String(text ?? "")).slice(0, 2000);
  let kind: TaskKind = "other";
  for (const [k, re] of KIND_RULES) {
    if (re.test(f)) {
      kind = k;
      break;
    }
  }
  return { kind, redoCue: REDO_RE.test(f) };
}

const EXT_ART: Record<string, Artifact> = {
  html: "web", htm: "web", css: "web", js: "web", mjs: "web", jsx: "web", ts: "web", tsx: "web", vue: "web", svelte: "web",
  py: "python", docx: "word", doc: "word", xlsx: "excel", xlsm: "excel", xls: "excel", csv: "data", pptx: "slides", ppt: "slides", pdf: "pdf",
  md: "text", txt: "text", json: "data", yaml: "data", yml: "data", xml: "data", png: "image", jpg: "image", jpeg: "image", svg: "image", gif: "image", webp: "image",
};
/** Loại sản phẩm theo đuôi tệp (đường dẫn chỉ được đọc để lấy đuôi). */
export function artifactOf(path: unknown): Artifact | null {
  if (typeof path !== "string") return null;
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(path.trim());
  if (!m) return null;
  return EXT_ART[m[1].toLowerCase()] ?? "other";
}

/** Bộ khung/thư viện giao diện từ package.json và requirements.txt của dự án (chỉ khớp tên gói). */
export function stackOf(i: { pkg?: string; reqs?: string; hasHtml?: boolean }): { stack: Stack; ui: UiLib } {
  let deps: Record<string, unknown> = {};
  if (i.pkg) {
    try {
      const j = JSON.parse(i.pkg) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      deps = { ...(j.devDependencies ?? {}), ...(j.dependencies ?? {}) };
    } catch {
      /* package.json hỏng: coi như không có */
    }
  }
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  const reqs = (i.reqs ?? "").toLowerCase();
  const py = (n: string) => new RegExp(`^${n}\\b`, "m").test(reqs);
  let stack: Stack = "other";
  if (has("next")) stack = "next";
  else if (has("react")) stack = "react";
  else if (has("vue")) stack = "vue";
  else if (has("svelte")) stack = "svelte";
  else if (has("express")) stack = "express";
  else if (has("vite")) stack = "vite";
  else if (i.pkg) stack = "node";
  else if (py("streamlit")) stack = "streamlit";
  else if (py("fastapi")) stack = "fastapi";
  else if (py("flask")) stack = "flask";
  else if (py("django")) stack = "django";
  else if (i.reqs !== undefined) stack = "python";
  else if (i.hasHtml) stack = "static";
  let ui: UiLib = "none";
  if (has("@chakra-ui/react")) ui = "chakra";
  else if (has("@mui/material")) ui = "mui";
  else if (has("antd")) ui = "antd";
  else if (has("tailwindcss")) ui = has("class-variance-authority") || has("@radix-ui/react-slot") ? "shadcn" : "tailwind";
  else if (has("bootstrap") || has("react-bootstrap")) ui = "bootstrap";
  return { stack, ui };
}

/** Lệnh bash kiểm chứng (dựng/kiểm thử/kiểm tra kiểu)? Chỉ trả đúng/sai. */
export function isVerifyCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test|lint|typecheck|check)\b|\b(vitest|jest|pytest|tsc|eslint)\b|python3?\s+-m\s+(pytest|unittest)|\bgo\s+(test|build|vet)\b|\bcargo\s+(test|build|check)\b|\bmvn\s+(test|package)\b|\bdotnet\s+(test|build)\b/.test(cmd);
}

/** Kết quả của một lần kiểm chứng từ đầu ra công cụ: "pass" | "fail" | null (không kết luận được, ví dụ hết giờ). */
export function verifyOutcome(tool: string, output: string): "pass" | "fail" | null {
  if (tool === "check_page") {
    if (/KẾT QUẢ: ổn/.test(output)) return "pass";
    if (/CÓ VẤN ĐỀ|KHÔNG MỞ ĐƯỢC/.test(output)) return "fail";
    return null;
  }
  if (/\[Hết thời gian/.test(output)) return null;
  const m = /\[mã thoát (-?\d+)\]\s*$/.exec(output);
  if (!m) return null;
  return m[1] === "0" ? "pass" : "fail";
}
