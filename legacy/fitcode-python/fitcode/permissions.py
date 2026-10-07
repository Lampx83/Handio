"""Quyết định cho phép / từ chối / hỏi người dùng trước khi chạy công cụ.

Chế độ (mode):
  default      đọc tự do; sửa file và chạy lệnh phải được duyệt
  acceptEdits  tự duyệt sửa file trong dự án; lệnh bash vẫn hỏi
  plan         chỉ đọc, agent lập kế hoạch rồi xin duyệt (exit_plan_mode)
  bypass       tự duyệt mọi thứ (vẫn chặn lệnh nguy hiểm)

Quy tắc trong settings.json:
  "permissions": {"allow": ["bash(git status*)", "edit_file"], "deny": ["bash(rm *)", "write_file(.env)"]}
"""
from __future__ import annotations

import fnmatch
import re
import shlex
from typing import Optional, Tuple

MODES = ("default", "acceptEdits", "plan", "bypass")

# Lệnh chỉ-đọc coi là an toàn, không cần hỏi (và không chứa toán tử shell nguy hiểm)
SAFE_COMMANDS = {"ls", "pwd", "cat", "head", "tail", "wc", "echo", "which", "tree", "date", "whoami",
                 "grep", "rg", "sort", "uniq", "stat", "file", "du", "df", "diff", "basename", "dirname"}
SAFE_GIT = {"status", "diff", "log", "branch", "show", "remote", "rev-parse"}
SAFE_PHRASES = ("python --version", "python3 --version", "node --version", "pip --version", "pip3 --version")
SUBCOMMAND_TOOLS = {"git", "npm", "pip", "pip3", "docker", "cargo", "yarn", "pnpm", "go", "make", "uv", "poetry"}
SHELL_META = re.compile(r"[;&|<>`$()\n]")

# Luôn chặn, kể cả chế độ bypass
DANGEROUS = [
    r"\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(/|~|\$HOME|\*)(\s|$)",
    r"\bsudo\b", r"\bmkfs\b", r"\bdd\s+if=", r">\s*/dev/sd", r":\(\)\s*\{", r"\bchmod\s+-R\s+777\s+/",
    r"(curl|wget)[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b", r"\bshutdown\b", r"\breboot\b", r"\bgit\s+push\s+.*--force\b",
    r"\bformat\s+[a-zA-Z]:", r"\bdel\s+/[sS]\b", r"\brd\s+/[sS]\b",
]


def is_dangerous(command: str) -> bool:
    return any(re.search(p, command) for p in DANGEROUS)


def is_safe_readonly(command: str) -> bool:
    c = command.strip()
    if not c or SHELL_META.search(c):
        return False
    if any(c == p or c.startswith(p + " ") for p in SAFE_PHRASES):
        return True
    try:
        parts = shlex.split(c)
    except ValueError:
        return False
    if not parts:
        return False
    if parts[0] == "git":
        return len(parts) > 1 and parts[1] in SAFE_GIT
    if parts[0] == "find":
        return not any(x in parts for x in ("-exec", "-delete", "-ok", "-fprint"))
    return parts[0] in SAFE_COMMANDS


def _subject(tool_name: str, args: dict) -> str:
    if tool_name == "bash":
        return str(args.get("command", ""))
    if "path" in args:
        return str(args.get("path", ""))
    return ""


def _match(rule: str, tool_name: str, args: dict) -> bool:
    m = re.fullmatch(r"([^()]+)(?:\((.*)\))?", rule.strip())
    if not m:
        return False
    name_pat, arg_pat = m.group(1).strip(), m.group(2)
    if not fnmatch.fnmatchcase(tool_name, name_pat):
        return False
    if arg_pat is None:
        return True
    return fnmatch.fnmatchcase(_subject(tool_name, args), arg_pat)


class Permissions:
    def __init__(self, cfg: dict, interactive: bool = True):
        perms = cfg.get("permissions") or {}
        self.allow = list(perms.get("allow") or [])
        self.deny = list(perms.get("deny") or [])
        self.mode = cfg.get("mode", "default")
        if self.mode not in MODES:
            self.mode = "default"
        self.interactive = interactive
        self.session_allow = []     # quy tắc người dùng chọn "luôn cho phép" trong phiên

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError("Chế độ phải là một trong: " + ", ".join(MODES))
        self.mode = mode

    def decide(self, tool, args: dict) -> Tuple[str, str]:
        """Trả về ('allow'|'deny'|'ask', lý do)."""
        name = tool.name
        if name == "bash" and is_dangerous(str(args.get("command", ""))):
            return "deny", "Lệnh bị chặn vì nguy hiểm."
        for r in self.deny:
            if _match(r, name, args):
                return "deny", "Bị chặn bởi quy tắc deny: %s" % r
        if self.mode == "plan" and not tool.readonly and name != "exit_plan_mode":
            return "deny", "Đang ở chế độ plan (chỉ đọc). Hãy hoàn tất kế hoạch rồi gọi exit_plan_mode."
        if self.mode == "bypass":
            return "allow", "chế độ bypass"
        if tool.readonly or name == "exit_plan_mode":
            return "allow", "công cụ chỉ đọc"
        for r in self.allow + self.session_allow:
            if _match(r, name, args):
                return "allow", "khớp quy tắc allow: %s" % r
        if tool.kind == "edit" and self.mode == "acceptEdits":
            return "allow", "chế độ acceptEdits"
        if name == "bash" and is_safe_readonly(str(args.get("command", ""))):
            return "allow", "lệnh chỉ-đọc an toàn"
        return "ask", ""

    def remember(self, tool, args: dict) -> str:
        """Người dùng chọn 'luôn cho phép': thêm quy tắc cho phiên. Trả về mô tả quy tắc."""
        name = tool.name
        if name == "bash":
            words = str(args.get("command", "")).split()
            n = 2 if words and words[0] in SUBCOMMAND_TOOLS and len(words) > 1 else 1
            rule = "bash(%s*)" % " ".join(words[:n])
        elif tool.kind == "edit":
            rule = name
        else:
            rule = name
        self.session_allow.append(rule)
        return rule
