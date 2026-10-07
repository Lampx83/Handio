import { isSensitivePath } from "./sensitive";

/**
 * Phân tích lệnh shell ở mức đủ để ra quyết định về quyền:
 *  - tách lệnh ghép (`&&`, `||`, `;`, `|`, xuống dòng) thành từng đoạn;
 *  - TỪ CHỐI hiểu (trả null → luôn hỏi người dùng) mọi thứ có thể chạy/đọc thứ không nhìn thấy:
 *    `$VAR`, `$(…)`, dấu backtick, `( )`, `<`, `&` nền, brace-expansion.
 */

export interface Segment {
  argv: string[];
  raw: string;
  /** Có ghi ra file bằng `>` / `>>` (trừ /dev/null và `2>&1`). */
  redirectsOut: boolean;
}

export function parseCommand(cmd: string): Segment[] | null {
  const n = cmd.length;
  const segs: Segment[] = [];
  let words: string[] = [];
  let cur = "";
  let inWord = false;
  let redirect = false;
  let rawStart = 0;
  let i = 0;

  const pushWord = () => {
    if (inWord) {
      words.push(cur);
      cur = "";
      inWord = false;
    }
  };
  const endSeg = (end: number) => {
    pushWord();
    if (words.length || redirect) segs.push({ argv: words, raw: cmd.slice(rawStart, end).trim(), redirectsOut: redirect });
    words = [];
    redirect = false;
  };

  while (i < n) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += cmd.slice(i + 1, j);
      inWord = true;
      i = j + 1;
    } else if (c === '"') {
      i++;
      while (i < n && cmd[i] !== '"') {
        const d = cmd[i];
        if (d === "$" || d === "`") return null;
        if (d === "\\" && i + 1 < n && '"\\$`\n'.includes(cmd[i + 1])) {
          cur += cmd[i + 1];
          i += 2;
          continue;
        }
        cur += d;
        i++;
      }
      if (i >= n) return null;
      i++;
      inWord = true;
    } else if (c === "\\") {
      if (i + 1 >= n) return null;
      if (cmd[i + 1] === "\n") {
        i += 2;
        continue;
      }
      cur += cmd[i + 1];
      inWord = true;
      i += 2;
    } else if (c === "$" || c === "`" || c === "(" || c === ")" || c === "<") {
      return null;
    } else if (c === "{") {
      const j = cmd.indexOf("}", i);
      if (j > 0 && /[,]|\.\./.test(cmd.slice(i, j))) return null; // brace expansion
      cur += c;
      inWord = true;
      i++;
    } else if (c === ";") {
      endSeg(i);
      i++;
      rawStart = i;
    } else if (c === "&") {
      if (cmd[i + 1] === "&") {
        endSeg(i);
        i += 2;
        rawStart = i;
      } else return null; // chạy nền hoặc `&>`
    } else if (c === "|") {
      endSeg(i);
      i += cmd[i + 1] === "|" || cmd[i + 1] === "&" ? 2 : 1;
      rawStart = i;
    } else if (c === "\n") {
      endSeg(i);
      i++;
      rawStart = i;
    } else if (c === ">") {
      if (inWord && /^\d$/.test(cur)) {
        cur = "";
        inWord = false;
      } else pushWord();
      i++;
      if (cmd[i] === "&" && /[\d-]/.test(cmd[i + 1] ?? "")) {
        i += 2; // 2>&1
        continue;
      }
      if (cmd[i] === ">") i++;
      const m = /^\s*\/dev\/null(?=[\s;&|]|$)/.exec(cmd.slice(i));
      if (m) i += m[0].length;
      else redirect = true;
    } else if (c === " " || c === "\t") {
      pushWord();
      i++;
    } else {
      cur += c;
      inWord = true;
      i++;
    }
  }
  endSeg(n);
  return segs;
}

// ---------------------------------------------------------------- nguy hiểm

const BROAD_TARGETS = new Set(["/", "~", ".", "..", "*", "./*", "/*", "~/", "./", "../"]);

function isBroadTarget(t: string, root: string): boolean {
  if (BROAD_TARGETS.has(t) || t === root || t === root + "/") return true;
  if (t.startsWith("~") || t.startsWith("..")) return true;
  if (t.startsWith("/") && !(t === root || t.startsWith(root + "/"))) return true;
  return false;
}

const WRAPPERS = new Set(["env", "command", "nohup", "time", "exec", "nice", "builtin"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** Có phải lệnh phá hoại nặng, chặn ở mọi chế độ kể cả bypass? (Không phải rào chắn tuyệt đối.) */
export function dangerousReason(command: string, root: string, depth = 0): string | null {
  if (/(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(command)) return "tải mã từ mạng rồi chạy thẳng";
  if (/:\(\)\s*\{/.test(command)) return "fork bomb";
  if (/\bsudo\b|\bdoas\b/.test(command)) return "dùng quyền root (sudo)";
  const segs = parseCommand(command);
  if (!segs) {
    if (/\brm\s+(-\S+\s+)*\S*[/~*]/.test(command) && /-[a-zA-Z]*[rR]/.test(command)) return "xoá đệ quy không xác định được đích";
    return null;
  }
  for (const s of segs) {
    let argv = s.argv.slice();
    while (argv.length && (WRAPPERS.has(argv[0]) || /^\w+=/.test(argv[0]))) argv = argv.slice(1);
    if (!argv.length) continue;
    const cmd = argv[0];
    const rest = argv.slice(1);
    if (SHELLS.has(cmd) && depth < 3) {
      const ci = rest.findIndex((a) => /^-[a-z]*c$/.test(a));
      if (ci >= 0 && rest[ci + 1]) {
        const r = dangerousReason(rest[ci + 1], root, depth + 1);
        if (r) return r;
      }
    }
    if (cmd === "rm") {
      const flags = rest.filter((a) => a.startsWith("-") && !a.startsWith("--")).join("") + (rest.includes("--recursive") ? "r" : "");
      const targets = rest.filter((a) => !a.startsWith("-"));
      if (/[rR]/.test(flags) && targets.some((t) => isBroadTarget(t, root))) return "xoá đệ quy thư mục gốc/thư mục nhà/toàn bộ dự án";
    }
    if (["mkfs", "shutdown", "reboot", "halt", "poweroff"].some((x) => cmd === x || cmd.startsWith(x + "."))) return "lệnh hệ thống nguy hiểm";
    if (cmd === "dd" && rest.some((a) => a.startsWith("if=") || a.startsWith("of=/dev"))) return "ghi thẳng lên thiết bị";
    if (cmd === "chmod" && rest.includes("-R") && rest.some((a) => /^0?777$/.test(a)) && rest.some((a) => a === "/" || a === "~")) return "chmod -R 777 trên thư mục gốc";
    if (cmd === "git" && rest[0] === "push" && rest.some((a) => a === "-f" || a.startsWith("--force") || /^\+\S/.test(a))) return "git push --force";
  }
  return null;
}

// ---------------------------------------------------------------- chỉ-đọc an toàn

const SIMPLE_READONLY = new Set(["ls", "pwd", "cat", "head", "tail", "wc", "echo", "which", "tree", "date", "whoami", "grep", "stat", "file", "du", "df", "diff", "basename", "dirname", "true", "false"]);
const GIT_READONLY = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame"]);
const VERSION_PHRASES = [/^(python3?|node|npm|pip3?|git|go|cargo|java|ruby) (--version|-v|-V|version)$/];

function pathEscapes(arg: string, root: string): boolean {
  if (arg.startsWith("-") && !arg.includes("/")) return false;
  if (arg.startsWith("~")) return true;
  if (arg.split("/").includes("..")) return true;
  if (arg.startsWith("/") && !(arg === root || arg.startsWith(root + "/"))) return true;
  return false;
}

/** Đoạn lệnh có chắc chắn chỉ đọc và không đụng ra ngoài thư mục dự án? */
export function isReadonlySegment(s: Segment, root: string): boolean {
  if (s.redirectsOut || !s.argv.length) return false;
  if (s.argv.slice(1).some((a) => !a.startsWith("-") && isSensitivePath(a))) return false; // cat .env, grep x id_rsa…
  const [cmd, ...args] = s.argv;
  const line = s.argv.join(" ");
  if (VERSION_PHRASES.some((r) => r.test(line))) return true;
  if (args.some((a) => pathEscapes(a, root))) return false;
  if (SIMPLE_READONLY.has(cmd)) {
    if (cmd === "tree" && args.some((a) => a === "-o" || a.startsWith("--output"))) return false;
    if (cmd === "diff" && args.some((a) => a.startsWith("--to-file") || a === "-")) return false;
    return true;
  }
  if (cmd === "rg") return !args.some((a) => /^--(pre|pre-glob|hostname-bin|search-zip)/.test(a) || a === "-z");
  if (cmd === "sort") return !args.some((a) => a === "-o" || a.startsWith("--output") || /^-[a-zA-Z]*o/.test(a) || a.startsWith("-T") || a.startsWith("--compress-program"));
  if (cmd === "uniq") return args.filter((a) => !a.startsWith("-")).length <= 1;
  if (cmd === "find") return !args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a));
  if (cmd === "git") {
    const sub = args[0];
    if (!sub || sub.startsWith("-")) return false; // git -c … / git -C … có thể đổi hành vi
    if (GIT_READONLY.has(sub)) return !args.some((a) => a.startsWith("--output") || a === "--ext-diff" || a.startsWith("--exec"));
    if (sub === "branch") return args.slice(1).every((a) => ["-a", "-r", "-v", "-vv", "--list", "--show-current", "--all", "--remotes"].includes(a));
    if (sub === "remote") return args.length === 1 || (args.length === 2 && args[1] === "-v");
    if (sub === "stash") return args[1] === "list";
    if (sub === "tag") return args.length === 1 || args.slice(1).every((a) => a === "-l" || a === "--list");
    return false;
  }
  return false;
}
