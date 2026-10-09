import { commandPatternToRegExp, matchGlob } from "./glob";
import { isSensitivePath } from "./sensitive";
import { dangerousReason, isReadonlySegment, isRoutineSegment, parseCommand } from "./shell";

/**
 * Chế độ:
 *  default      đọc tự do; sửa file và chạy lệnh phải được duyệt
 *  acceptEdits  tự duyệt sửa file trong dự án; lệnh bash vẫn hỏi
 *  auto         tự lo việc thường ngày (sửa file, build/test/cài gói, git cục bộ); chỉ hỏi việc quan trọng (xoá, mạng, tệp bí mật, lệnh lạ)
 *  plan         chỉ đọc; agent lập kế hoạch rồi xin duyệt (exit_plan_mode)
 *  bypass       tự duyệt mọi thứ, trừ lệnh phá hoại nặng
 */
export const MODES = ["default", "acceptEdits", "auto", "plan", "bypass"] as const;
export type Mode = (typeof MODES)[number];

export type ToolKind = "read" | "edit" | "exec" | "net" | "meta" | "mcp";

export interface ToolInfo {
  name: string;
  readonly: boolean;
  kind: ToolKind;
}

export interface PermissionRules {
  allow: string[];
  deny: string[];
}

export type Decision = { decision: "allow" | "deny" | "ask"; reason: string };

/** Đường dẫn có thể làm agent tự cấp quyền cho chính nó hoặc phá lịch sử git → luôn hỏi (trừ bypass). */
const PROTECTED = [".git/**", ".neuagent/**", ".agents/rules/**", ".claude/rules/**", "NEUAGENT.md", "NEUAGENT.local.md", "AGENTS.md", "CLAUDE.md", "**/NEUAGENT.md", "**/AGENTS.md", "**/CLAUDE.md"];

function parseRule(rule: string): { tool: string; arg?: string } | null {
  const m = /^([^()]+?)(?:\((.*)\))?$/s.exec(rule.trim());
  return m ? { tool: m[1].trim(), arg: m[2] } : null;
}

export interface TargetInfo {
  /** Đường dẫn tuyệt đối đã resolve (nếu công cụ có tham số path). */
  abs?: string;
  /** Đường dẫn tương đối so với thư mục dự án. */
  rel?: string;
}

export class Permissions {
  allow: string[];
  deny: string[];
  mode: Mode;
  sessionAllow: string[] = [];
  /** Đã đọc nội dung KHÔNG tin cậy (web) trong lượt này: mọi thao tác ghi/chạy/mạng phải hỏi lại, kể cả chế độ tự động. */
  tainted = false;

  constructor(rules: PermissionRules, mode: Mode, private root: string) {
    this.allow = rules.allow.slice();
    this.deny = rules.deny.slice();
    this.mode = mode;
  }

  setMode(m: Mode): void {
    if (!MODES.includes(m)) throw new Error("Chế độ phải là một trong: " + MODES.join(", "));
    this.mode = m;
  }

  private nameMatches(pattern: string, tool: string): boolean {
    return pattern === tool || pattern === "*" || matchGlob(pattern, tool);
  }

  private fileRuleMatches(rule: string, tool: ToolInfo, target: TargetInfo): boolean {
    const r = parseRule(rule);
    if (!r || !this.nameMatches(r.tool, tool.name)) return false;
    if (r.arg === undefined) return true;
    if (tool.name === "bash") return false;
    const cands = [target.rel, target.abs].filter((x): x is string => !!x);
    return cands.some((c) => matchGlob(r.arg!, c));
  }

  private bashRuleMatches(rule: string, segmentRaw: string): boolean {
    const r = parseRule(rule);
    if (!r || !this.nameMatches(r.tool, "bash")) return false;
    if (r.arg === undefined) return true;
    return commandPatternToRegExp(r.arg).test(segmentRaw);
  }

  private bashDenied(command: string): string | null {
    const rules = this.deny.filter((r) => parseRule(r)?.tool === "bash" || parseRule(r)?.tool === "*");
    if (!rules.length) return null;
    const parts = parseCommand(command)?.map((s) => s.raw) ?? command.split(/&&|\|\||;|\||\n|\$\(|`|\(|\)/).map((x) => x.trim()).filter(Boolean);
    for (const rule of rules) if ([command.trim(), ...parts].some((p) => this.bashRuleMatches(rule, p))) return rule;
    return null;
  }

  decide(tool: ToolInfo, args: Record<string, unknown>, target: TargetInfo = {}): Decision {
    const name = tool.name;
    const isBash = name === "bash";
    const command = isBash ? String(args.command ?? "") : "";
    const segs = isBash ? parseCommand(command) : null;

    if (isBash) {
      const danger = dangerousReason(command, this.root);
      if (danger) return { decision: "deny", reason: "Lệnh bị chặn vì nguy hiểm: " + danger + "." };
      const rule = this.bashDenied(command);
      if (rule) return { decision: "deny", reason: "Bị chặn bởi quy tắc deny: " + rule };
    } else {
      const rule = this.deny.find((r) => this.fileRuleMatches(r, tool, target));
      if (rule) return { decision: "deny", reason: "Bị chặn bởi quy tắc deny: " + rule };
    }

    const bashReadonly = isBash && !!segs && segs.length > 0 && segs.every((s) => isReadonlySegment(s, this.root));

    if (this.mode === "plan" && !tool.readonly && name !== "exit_plan_mode" && !bashReadonly)
      return { decision: "deny", reason: "Đang ở chế độ plan (chỉ đọc). Hãy hoàn tất kế hoạch rồi gọi exit_plan_mode." };

    if (tool.kind === "edit" && target.rel !== undefined && this.mode !== "bypass" && PROTECTED.some((p) => matchGlob(p, target.rel!)))
      return { decision: "ask", reason: "File cấu hình/lịch sử của dự án: luôn cần bạn duyệt." };

    // tệp có thể chứa bí mật: luôn hỏi (kể cả chế độ tự động), dù chỉ đọc
    if (target.rel !== undefined && isSensitivePath(target.rel) && name !== "exit_plan_mode")
      return { decision: "ask", reason: "Tệp này có thể chứa khoá/mật khẩu. Chỉ cho phép nếu bạn thật sự muốn agent đọc/ghi nó." };

    // đã đọc nội dung từ web: không tự động duyệt bất cứ thao tác có tác dụng phụ nào
    if (this.tainted && !tool.readonly && name !== "exit_plan_mode")
      return { decision: "ask", reason: "Vừa đọc nội dung từ web (không tin cậy). Hãy kiểm tra kỹ thao tác này." };

    if (this.mode === "bypass") return { decision: "allow", reason: "chế độ bypass" };
    if (tool.readonly || name === "exit_plan_mode") return { decision: "allow", reason: "công cụ chỉ đọc" };

    const rules = [...this.allow, ...this.sessionAllow];
    if (isBash) {
      if (segs && segs.length) {
        // mọi đoạn phải được cho phép riêng lẻ; đoạn ghi ra file bằng `>` thì không bao giờ tự khớp quy tắc
        const ok = segs.every((s) => isReadonlySegment(s, this.root) || (!s.redirectsOut && rules.some((r) => this.bashRuleMatches(r, s.raw))));
        if (ok) return { decision: "allow", reason: bashReadonly ? "lệnh chỉ-đọc an toàn" : "mọi đoạn lệnh khớp quy tắc allow" };
        if (this.mode === "auto" && segs.every((s) => isRoutineSegment(s, this.root) || (!s.redirectsOut && rules.some((r) => this.bashRuleMatches(r, s.raw)))))
          return { decision: "allow", reason: "lệnh thường ngày trong dự án (chế độ auto)" };
      }
      // lệnh phức tạp không phân tích được: chỉ quy tắc allow KHÔNG kèm đối số (vd "bash") mới áp dụng
      if (!segs && rules.some((r) => parseRule(r)?.tool === "bash" && parseRule(r)?.arg === undefined))
        return { decision: "allow", reason: "khớp quy tắc allow: bash" };
      return { decision: "ask", reason: "" };
    }
    if (rules.some((r) => this.fileRuleMatches(r, tool, target))) return { decision: "allow", reason: "khớp quy tắc allow" };
    if (tool.kind === "edit" && (this.mode === "acceptEdits" || this.mode === "auto")) return { decision: "allow", reason: "chế độ " + this.mode };
    if (this.mode === "auto" && name === "run_javascript") return { decision: "allow", reason: "chạy trong hộp cát, chế độ auto" };
    return { decision: "ask", reason: "" };
  }

  /** Người dùng chọn "luôn cho phép": thêm quy tắc cho phiên, trả về mô tả. */
  remember(tool: ToolInfo, args: Record<string, unknown>): string {
    let rule = tool.name;
    if (tool.name === "bash") {
      const segs = parseCommand(String(args.command ?? ""));
      const first = segs?.[0]?.argv ?? [];
      if (segs && segs.length === 1 && first.length) {
        const n = ["git", "npm", "pip", "pip3", "docker", "cargo", "yarn", "pnpm", "go", "make", "uv", "poetry", "npx"].includes(first[0]) && first.length > 1 ? 2 : 1;
        rule = `bash(${first.slice(0, n).join(" ")} *)`;
      } else return "(lệnh phức tạp: chỉ cho phép một lần)";
    }
    if (!this.sessionAllow.includes(rule)) this.sessionAllow.push(rule);
    return rule;
  }
}
