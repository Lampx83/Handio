import { basename } from "./path";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Glob kiểu shell/gitignore: `*` không vượt `/`, `**` vượt thư mục, `?`, `{a,b}`, `[abc]`. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 2;
        if (glob[i] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
        continue;
      }
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "{") {
      const j = glob.indexOf("}", i);
      if (j < 0) {
        re += "\\{";
        i++;
      } else {
        re += "(?:" + glob.slice(i + 1, j).split(",").map(escapeRe).join("|") + ")";
        i = j + 1;
      }
    } else if (c === "[") {
      const j = glob.indexOf("]", i + 1);
      if (j < 0) {
        re += "\\[";
        i++;
      } else {
        re += glob.slice(i, j + 1);
        i = j + 1;
      }
    } else {
      re += escapeRe(c);
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Khớp theo đường dẫn tương đối; mẫu không có `/` còn được thử với tên file. */
export function matchGlob(pattern: string, path: string): boolean {
  const rx = globToRegExp(pattern);
  return rx.test(path) || (!pattern.includes("/") && rx.test(basename(path)));
}

/** Mẫu lệnh shell: `*` khớp mọi ký tự; đuôi " *" cho phép khớp cả lệnh trơn (`ls *` khớp `ls`). */
export function commandPatternToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  let optionalTail = false;
  if (p.endsWith(" *")) {
    p = p.slice(0, -2);
    optionalTail = true;
  }
  const body = p.split("*").map(escapeRe).join(".*");
  return new RegExp("^" + body + (optionalTail ? "(?:\\s.*)?" : "") + "$", "s");
}
