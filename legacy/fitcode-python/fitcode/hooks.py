"""Hooks: chạy lệnh của người dùng tại các thời điểm trong vòng đời agent.

Sự kiện: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop.
Cấu hình (settings.json):
  "hooks": {"PreToolUse": [{"matcher": "bash|write_file",
                            "hooks": [{"type": "command", "command": "python3 .fitcode/hooks/guard.py"}]}]}
Lệnh nhận JSON qua stdin: {"event", "tool_name", "tool_input", "tool_output", "prompt", "cwd"}.
Mã thoát: 0 = bình thường (stdout được thêm vào ngữ cảnh với SessionStart/UserPromptSubmit),
          2 = chặn/phản hồi (stderr gửi lại cho mô hình), khác = chỉ cảnh báo.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

EVENTS = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop")


@dataclass
class HookResult:
    blocked: bool = False
    message: str = ""     # lý do chặn / phản hồi gửi mô hình
    context: str = ""     # stdout, thêm vào ngữ cảnh
    warnings: list = None

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []


class HookRunner:
    def __init__(self, cfg: dict, root: Path):
        self.root = Path(root)
        self.hooks = cfg.get("hooks") or {}

    def count(self) -> int:
        n = 0
        for entries in self.hooks.values():
            for e in entries or []:
                n += len(e.get("hooks") or [])
        return n

    def run(self, event: str, tool_name: str = "", tool_input=None, tool_output: str = None, prompt: str = None) -> HookResult:
        res = HookResult()
        for entry in self.hooks.get(event) or []:
            matcher = entry.get("matcher") or ".*"
            if matcher == "*":
                matcher = ".*"
            if tool_name:
                try:
                    if not re.fullmatch(matcher, tool_name):
                        continue
                except re.error:
                    continue
            for h in entry.get("hooks") or []:
                if h.get("type", "command") != "command" or not h.get("command"):
                    continue
                payload = {"event": event, "tool_name": tool_name, "tool_input": tool_input,
                           "tool_output": tool_output, "prompt": prompt, "cwd": str(self.root)}
                try:
                    p = subprocess.run(h["command"], shell=True, cwd=str(self.root), input=json.dumps(payload),
                                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                                       timeout=int(h.get("timeout", 30)),
                                       env=dict(os.environ, FITCODE_PROJECT_DIR=str(self.root)))
                except subprocess.TimeoutExpired:
                    res.warnings.append("hook quá thời gian: %s" % h["command"])
                    continue
                except OSError as e:
                    res.warnings.append("hook lỗi (%s): %s" % (e, h["command"]))
                    continue
                if p.returncode == 2:
                    res.blocked = True
                    res.message += (p.stderr.strip() or "Bị chặn bởi hook.") + "\n"
                elif p.returncode == 0:
                    if p.stdout.strip():
                        res.context += p.stdout.strip() + "\n"
                else:
                    res.warnings.append("hook thoát mã %d: %s %s" % (p.returncode, h["command"], p.stderr.strip()[:200]))
        res.message = res.message.strip()
        res.context = res.context.strip()
        return res
