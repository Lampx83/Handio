"""Vòng lặp agent: gọi mô hình -> chạy công cụ -> đưa kết quả lại cho mô hình, cho tới khi xong.

Session giữ trạng thái dùng chung (cấu hình, quyền, hook, công cụ, MCP);
Agent giữ hội thoại riêng (agent chính hoặc subagent có ngữ cảnh độc lập).
"""
from __future__ import annotations

import datetime
import json
import os
import platform
import subprocess
import time
from pathlib import Path
from typing import List, Optional

from . import ui
from .config import home_dir
from .extensions import (AgentDef, load_agents, load_commands, load_memory, load_skills)
from .hooks import HookRunner
from .llm import Client, LLMError
from .mcp import McpManager
from .permissions import Permissions
from .tools import Tool, ToolContext, ToolError, builtin_tools

PRUNE_MARK = "[đã lược để tiết kiệm ngữ cảnh]"
MAX_TOOL_CHARS = 12000

SYSTEM_BASE = """You are FIT Code, an AI coding agent that runs in the user's terminal. You were built for students of the \
FIT-VIBE course (Faculty of IT, National Economics University, Vietnam) to practise agentic coding. You are powered by Qwen3.5.

How to work:
- Reply in the user's language (Vietnamese if they write Vietnamese). Be concise: short sentences, no filler, no repeated plans.
- Work in small, verifiable steps: explore (read_file / grep / glob) -> plan -> edit -> verify -> report.
- Use tools instead of guessing. NEVER invent file contents, paths or command output. If you do not know, look.
- Read a file before editing it. Prefer edit_file (small exact replacements) over rewriting whole files with write_file.
- For tasks with 3 or more steps, keep a checklist with todo_write and update it as you go (only one item in_progress).
- After changing code, VERIFY: run the tests or the program with bash. If it fails, read the error, find the root cause, fix, re-run.
  After 3 failed attempts on the same problem, stop and explain what you tried instead of looping.
- Shell commands already run in the working directory: do not prefix them with `cd <dir> &&`.
- Report honestly: if a tool call was denied, blocked or failed, say plainly what was NOT done. Never claim a change or a test result that a tool did not actually confirm.
- Do not run destructive commands (deleting many files, force-push, sudo). Do not touch secrets (.env, keys). Ask the user first if unsure.
- The context window is small (about 32k tokens). Do not dump large files or long outputs: use grep, offset/limit, and head/tail.
- When finished, give a short summary: what changed (files), how it was verified, and anything left for the user.
- Call tools through the tool-calling interface only; never write tool calls as plain text."""

SUMMARY_SYSTEM = """Bạn tóm tắt một phiên làm việc lập trình để người khác (hoặc chính bạn) tiếp tục mà không cần xem lại toàn bộ.
Viết bằng tiếng Việt, tối đa ~350 từ, theo mục: (1) Mục tiêu của người dùng; (2) Đã làm xong (file đã sửa/tạo, lệnh đã chạy, kết quả test); \
(3) Phát hiện quan trọng (cấu trúc dự án, quy ước, lỗi gặp phải); (4) Việc đang làm dở và bước tiếp theo. Giữ nguyên tên file, hàm, lệnh chính xác."""


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d")


def git_branch(root: Path) -> str:
    try:
        r = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(root), capture_output=True, text=True, timeout=3)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


class Session:
    def __init__(self, cfg: dict, root: Path, interactive: bool = True, extra_dirs: Optional[List[Path]] = None):
        self.cfg = cfg
        self.root = Path(os.path.realpath(root))
        self.interactive = interactive
        self.client = Client(cfg, notify=lambda m: ui.out(ui.yellow("  ⚠ " + m)))
        self.ctx = ToolContext(root=self.root, extra_dirs=[Path(os.path.realpath(d)) for d in (extra_dirs or [])],
                               on_todos=self.show_todos)
        self.perms = Permissions(cfg, interactive)
        self.hooks = HookRunner(cfg, self.root)
        self.thinking = bool(cfg.get("thinking"))
        self.reload_extensions()
        self.mcp = McpManager(cfg, self.root)
        self.tools = {}
        for t in builtin_tools() + self._meta_tools() + self.mcp.tools():
            self.tools[t.name] = t
        self.branch = git_branch(self.root)
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.calls = 0
        self.started = time.time()
        self.chars_per_token = 3.0
        self.main = Agent(self)

    # ---- phần mở rộng ----
    def reload_extensions(self) -> None:
        self.memory = load_memory(self.root)
        self.commands = load_commands(self.root)
        self.skills = load_skills(self.root)
        self.agent_defs = load_agents(self.root)

    def _meta_tools(self) -> List[Tool]:
        S = {"type": "string"}
        tools = [
            Tool("task", "Giao một việc con cho subagent có ngữ cảnh riêng (không làm đầy ngữ cảnh chính). "
                         "Dùng 'explore' để tìm hiểu mã nguồn (chỉ đọc), hoặc agent khác trong danh sách. Subagent trả về báo cáo tóm tắt.",
                 {"type": "object", "properties": {"agent": {"type": "string", "description": "tên subagent, mặc định explore"},
                                                   "description": {"type": "string", "description": "mô tả ngắn 3-6 từ"},
                                                   "prompt": {"type": "string", "description": "yêu cầu chi tiết, tự đủ ý (subagent không thấy hội thoại)"}},
                  "required": ["prompt"]},
                 lambda ctx, **a: self.run_subagent(**a), readonly=True, kind="meta"),   # subagent tự chịu kiểm soát quyền ở từng công cụ của nó
            Tool("skill", "Nạp hướng dẫn chi tiết của một skill (quy trình/kiến thức chuyên biệt) theo tên trong danh sách skills.",
                 {"type": "object", "properties": {"name": S}, "required": ["name"]},
                 lambda ctx, **a: self.load_skill(**a), readonly=True, kind="meta"),
            Tool("exit_plan_mode", "Chỉ dùng ở chế độ plan: trình bày kế hoạch cho người dùng duyệt trước khi bắt tay sửa mã.",
                 {"type": "object", "properties": {"plan": {"type": "string", "description": "kế hoạch chi tiết dạng markdown"}},
                  "required": ["plan"]},
                 lambda ctx, **a: self.exit_plan_mode(**a), kind="meta"),
        ]
        return tools

    def load_skill(self, name: str) -> str:
        sk = self.skills.get(name)
        if not sk:
            raise ToolError("Không có skill '%s'. Skills hiện có: %s" % (name, ", ".join(self.skills) or "(không có)"))
        extra = [p.name for p in sk.path.iterdir() if p.name != "SKILL.md"]
        return sk.body + ("\n\n[Các file kèm trong %s: %s]" % (sk.path, ", ".join(extra)) if extra else "")

    def exit_plan_mode(self, plan: str, show: bool = True) -> str:
        if self.perms.mode != "plan":
            return "Không ở chế độ plan; cứ tiếp tục làm theo kế hoạch."
        ui.out("\n" + ui.bold(ui.cyan("📋 Kế hoạch đề xuất")) + ("\n" + ui.indent(plan, 2) if show else "") + "\n")
        if not self.interactive:
            raise ToolError("Chạy không tương tác nên không thể duyệt kế hoạch.")
        ans = ui.read_line("  Duyệt kế hoạch? [1] duyệt, tự động sửa file  [2] duyệt, hỏi từng thay đổi  [3] chưa, tiếp tục lập kế hoạch (gõ góp ý): ").strip()
        if ans in ("1", "y", ""):
            self.perms.set_mode("acceptEdits")
            return "Kế hoạch được duyệt. Đã thoát chế độ plan (tự động duyệt sửa file). Hãy thực hiện theo kế hoạch rồi kiểm chứng."
        if ans == "2":
            self.perms.set_mode("default")
            return "Kế hoạch được duyệt. Đã thoát chế độ plan (mỗi thay đổi sẽ được hỏi). Hãy thực hiện theo kế hoạch."
        return "Người dùng chưa duyệt. Góp ý: %s. Hãy chỉnh kế hoạch rồi gọi lại exit_plan_mode." % (ans[2:] if ans.startswith("3") else ans)

    def run_subagent(self, prompt: str, agent: str = "explore", description: str = "") -> str:
        d = self.agent_defs.get(agent or "explore")
        if not d:
            raise ToolError("Không có subagent '%s'. Hiện có: %s" % (agent, ", ".join(self.agent_defs)))
        ui.out(ui.gray("    ┌ subagent %s%s" % (d.name, ": " + description if description else "")))
        sub = Agent(self, name=d.name, agent_def=d, depth=1)
        try:
            text = sub.run_turn(prompt)
        finally:
            ui.out(ui.gray("    └ subagent xong"))
        return text or "(subagent không trả về nội dung)"

    # ---- công cụ & prompt ----
    def tool(self, name: str) -> Optional[Tool]:
        return self.tools.get(name)

    def tools_for(self, agent_def: Optional[AgentDef], depth: int) -> List[Tool]:
        out = []
        for t in self.tools.values():
            if depth > 0 and t.name in ("task", "exit_plan_mode"):
                continue
            if t.name == "skill" and not self.skills:
                continue
            if t.name == "exit_plan_mode" and self.perms.mode != "plan":
                continue
            if agent_def and agent_def.tools is not None and t.name not in agent_def.tools:
                continue
            out.append(t)
        return out

    def system_prompt(self, agent_def: Optional[AgentDef], depth: int) -> str:
        parts = [SYSTEM_BASE]
        if agent_def:
            parts.append("\nYou are the subagent '%s'. %s\nYou cannot see the main conversation; work only from the task you are given and "
                         "finish with a compact report." % (agent_def.name, agent_def.prompt))
        branch = self.branch
        import shutil
        py = "python3" if shutil.which("python3") else ("python" if shutil.which("python") else "")
        parts.append("\nEnvironment:\n- Working directory: %s\n- OS: %s\n- Date: %s%s%s\n- Shell commands run via the system shell%s" % (
            self.root, platform.system(), now_str(), ("\n- Git branch: " + branch) if branch else "",
            ("\n- Python command: `%s` (use exactly this name)" % py) if py else "\n- Python is not installed on this machine",
            " (Windows cmd: use Windows syntax)" if os.name == "nt" else ""))
        if self.perms.mode == "plan" and depth == 0:
            parts.append("\nYou are in PLAN MODE: only read and explore (read_file, grep, glob, list_dir, task 'explore'). Do NOT modify anything. "
                         "When ready you MUST call the exit_plan_mode tool with a concrete step-by-step plan (files to change, how to verify). "
                         "Do not just print the plan and ask for confirmation in text: exit_plan_mode is how the user approves it.")
        for name, text in self.memory:
            parts.append("\nProject instructions from %s:\n%s" % (name, text))
        if self.skills and depth == 0:
            parts.append("\nSkills (load details with the `skill` tool when relevant):\n" + "\n".join(
                "- %s: %s" % (s.name, s.description) for s in self.skills.values()))
        if depth == 0:
            parts.append("\nSubagents (delegate with the `task` tool):\n" + "\n".join(
                "- %s: %s" % (d.name, d.description) for d in self.agent_defs.values()))
        return "\n".join(parts)

    # ---- hiển thị ----
    def show_todos(self, todos: list) -> None:
        icon = {"completed": ui.green("☑"), "in_progress": ui.yellow("◐"), "pending": ui.gray("☐")}
        for t in todos:
            txt = t["content"]
            ui.out("    %s %s" % (icon[t["status"]], ui.gray(txt) if t["status"] == "completed" else txt))

    def track(self, usage: dict, chars: int) -> None:
        self.calls += 1
        pt, ct = usage.get("prompt_tokens") or 0, usage.get("completion_tokens") or 0
        self.prompt_tokens += pt
        self.completion_tokens += ct
        if pt > 200 and chars > 0:
            self.chars_per_token = max(1.8, min(5.0, 0.5 * self.chars_per_token + 0.5 * chars / pt))
        self.last_prompt_tokens = pt

    def close(self) -> None:
        self.mcp.close()


def _short(v, n=90) -> str:
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n - 1] + "…"


def call_summary(name: str, args: dict, root: Path = None) -> str:
    if name == "bash":
        return _short(args.get("command", ""), 110)
    if "path" in args and name in ("read_file", "write_file", "edit_file", "list_dir"):
        p = str(args.get("path"))
        if root is not None and os.path.isabs(p):
            try:
                p = os.path.relpath(p, str(root))
            except ValueError:
                pass
        return p
    if name == "grep":
        gp = str(args.get("path") or ".")
        if root is not None and os.path.isabs(gp):
            gp = os.path.relpath(gp, str(root))
        return "%s%s" % (args.get("pattern", ""), (" in " + gp) if gp not in (".", "") else "")
    if name == "glob":
        return str(args.get("pattern", ""))
    if name == "task":
        return "%s: %s" % (args.get("agent") or "explore", _short(args.get("description") or args.get("prompt", ""), 70))
    if name == "todo_write":
        return "%d việc" % len(args.get("todos") or [])
    return _short(args, 100)


def result_summary(name: str, result: str, error: bool) -> str:
    lines = result.splitlines()
    if error:
        return ui.red("  ⎿ " + _short(result, 160))
    if name == "read_file":
        return ui.gray("  ⎿ đọc %d dòng" % len(lines))
    if name == "bash":
        shown = lines[-8:]
        head = "" if len(lines) <= 8 else ui.gray("    … (%d dòng trước đó)\n" % (len(lines) - 8))
        return head + ui.gray(ui.indent("\n".join("⎿ " + l if i == 0 else "  " + l for i, l in enumerate(shown)), 2))
    if name in ("grep", "glob", "list_dir"):
        return ui.gray("  ⎿ %d kết quả" % (0 if result.startswith("(") else len(lines)))
    return ui.gray("  ⎿ " + _short(lines[0] if lines else "", 140))


class Agent:
    def __init__(self, session: Session, name: str = "main", agent_def: Optional[AgentDef] = None, depth: int = 0):
        self.s = session
        self.name = name
        self.def_ = agent_def
        self.depth = depth
        self.messages: List[dict] = []
        self.pad = "  " * depth
        self.repeat_key = None
        self.repeat_n = 0

    # ---- ngữ cảnh ----
    def _chars(self) -> int:
        return len(self.s.system_prompt(self.def_, self.depth)) + len(json.dumps(self.messages, ensure_ascii=False))

    def estimate_tokens(self) -> int:
        return int(self._chars() / self.s.chars_per_token)

    def prune_tool_results(self, keep_last: int = 4) -> int:
        idx = [i for i, m in enumerate(self.messages) if m.get("role") == "tool"]
        n = 0
        for i in idx[:-keep_last] if keep_last else idx:
            c = self.messages[i].get("content") or ""
            if len(c) > 300 and not c.endswith(PRUNE_MARK):
                self.messages[i]["content"] = c[:200] + " … " + PRUNE_MARK
                n += 1
        return n

    def manage_context(self) -> None:
        limit = self.s.cfg.get("context_tokens", 32768)
        if self.estimate_tokens() > 0.55 * limit:
            if self.prune_tool_results():
                ui.out(ui.gray(self.pad + "  (đã lược bớt kết quả công cụ cũ để tiết kiệm ngữ cảnh)"))
        if self.estimate_tokens() > 0.75 * limit:
            self.compact(midturn=True)

    def _transcript(self, max_chars: int = 14000) -> str:
        lines = []
        for m in self.messages:
            role = m.get("role")
            if role == "tool":
                lines.append("[kết quả công cụ] " + (m.get("content") or "")[:400])
            elif role == "assistant":
                txt = (m.get("content") or "").strip()
                calls = "; ".join("%s(%s)" % (c["function"]["name"], _short(c["function"]["arguments"], 120))
                                  for c in m.get("tool_calls") or [])
                lines.append("[trợ lý] " + txt[:600] + ((" → gọi: " + calls) if calls else ""))
            else:
                lines.append("[người dùng] " + (m.get("content") or "")[:1200])
        text = "\n".join(lines)
        if len(text) > max_chars:
            text = text[:3000] + "\n… (lược bớt) …\n" + text[-(max_chars - 3000):]
        return text

    def compact(self, focus: str = "", midturn: bool = False) -> bool:
        if len(self.messages) < 3:
            return False
        ui.out(ui.gray(self.pad + "  ⟳ Đang tóm tắt hội thoại để giải phóng ngữ cảnh…"))
        user = "Hội thoại cần tóm tắt:\n\n" + self._transcript() + (("\n\nChú ý đặc biệt: " + focus) if focus else "")
        try:
            r = self.s.client.chat([{"role": "system", "content": SUMMARY_SYSTEM}, {"role": "user", "content": user}],
                                   max_tokens=900, temperature=0.1, thinking=False)
        except LLMError as e:
            ui.out(ui.red("  Không tóm tắt được: %s" % e))
            return False
        self.s.track(r["usage"], len(user))
        summary = r["content"].strip() or "(không có tóm tắt)"
        self.messages = [{"role": "user", "content": "[Tóm tắt phần hội thoại trước đó, để tiết kiệm ngữ cảnh]\n" + summary},
                         {"role": "assistant", "content": "Đã nắm bối cảnh, tôi sẽ tiếp tục từ đây."}]
        if midturn:
            self.messages.append({"role": "user", "content": "Hãy tiếp tục công việc đang làm dở theo bản tóm tắt ở trên."})
        return True

    def repair_history(self) -> None:
        """Sau khi bị ngắt giữa chừng: đảm bảo mỗi tool_call đều có kết quả."""
        for i in range(len(self.messages) - 1, -1, -1):
            m = self.messages[i]
            if m.get("role") == "assistant" and m.get("tool_calls"):
                answered = {x.get("tool_call_id") for x in self.messages[i + 1:] if x.get("role") == "tool"}
                for c in m["tool_calls"]:
                    if c["id"] not in answered:
                        self.messages.append({"role": "tool", "tool_call_id": c["id"], "content": "Bị người dùng ngắt."})
                return
            if m.get("role") == "user":
                return

    # ---- một lượt làm việc ----
    def run_turn(self, user_text: str) -> str:
        s = self.s
        if self.depth == 0:
            hr = s.hooks.run("UserPromptSubmit", prompt=user_text)
            for w in hr.warnings:
                ui.out(ui.yellow("  ⚠ " + w))
            if hr.blocked:
                ui.out(ui.red("  ✋ Prompt bị chặn bởi hook: " + hr.message))
                return ""
            if hr.context:
                user_text += "\n\n[Thông tin thêm từ hook]\n" + hr.context
        self.messages.append({"role": "user", "content": user_text})
        max_steps = s.cfg.get("max_steps", 40) if self.depth == 0 else 25
        stop_retries = 0
        self.repeat_key, self.repeat_n = None, 0
        final = ""
        t0 = time.time()
        for step in range(max_steps):
            self.manage_context()
            resp = self._call_model()
            if resp is None:
                return final
            msg = {"role": "assistant", "content": resp["content"] or None}
            if resp["tool_calls"]:
                msg["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
                                     for c in resp["tool_calls"]]
            self.messages.append(msg)
            if resp["content"].strip():
                final = resp["content"].strip()
            if not resp["tool_calls"]:
                if self.depth == 0 and s.perms.mode == "plan" and s.interactive and resp["content"].strip():
                    # mô hình in kế hoạch ra văn bản thay vì gọi exit_plan_mode: vẫn xin người dùng duyệt
                    try:
                        fb = s.exit_plan_mode(resp["content"].strip(), show=False)
                    except ToolError:
                        fb = ""
                    if fb:
                        self.messages.append({"role": "user", "content": fb})
                        continue
                if resp["finish"] == "length":
                    ui.out(ui.yellow(self.pad + "  ⚠ Câu trả lời bị cắt do hết độ dài tối đa."))
                if self.depth == 0:
                    hr = s.hooks.run("Stop", prompt=user_text)
                    if hr.blocked and stop_retries < 2:
                        stop_retries += 1
                        ui.out(ui.yellow("  ↺ Hook Stop yêu cầu làm tiếp: " + hr.message.splitlines()[0]))
                        self.messages.append({"role": "user", "content": "[Hook Stop phản hồi]\n" + hr.message})
                        continue
                    ui.out(ui.gray("  (%.1fs · %d vào / %d ra · ngữ cảnh ~%d%%)" % (
                        time.time() - t0, s.prompt_tokens, s.completion_tokens,
                        min(99, 100 * self.estimate_tokens() // s.cfg.get("context_tokens", 32768)))))
                return final
            for c in resp["tool_calls"]:
                key = (c["name"], c["arguments"])
                self.repeat_n = self.repeat_n + 1 if key == self.repeat_key else 1
                self.repeat_key = key
                result = self.execute(c)
                if self.repeat_n >= 3:
                    result += ("\n[Cảnh báo] Bạn đã gọi cùng công cụ với cùng tham số %d lần liên tiếp mà không tiến triển. "
                               "Hãy đổi cách tiếp cận, hoặc dừng lại và báo cáo người dùng." % self.repeat_n)
                self.messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
            if self.repeat_n >= 5:
                ui.out(ui.yellow(self.pad + "  ⚠ Agent lặp lại cùng một thao tác %d lần nên đã dừng. Hãy nêu hướng khác hoặc cấp quyền cần thiết." % self.repeat_n))
                return final or "(đã dừng vì lặp vô ích)"
        ui.out(ui.yellow(self.pad + "  ⚠ Đã đạt giới hạn %d bước. Gõ 'tiếp tục' nếu muốn làm tiếp." % max_steps))
        return final

    def _call_model(self) -> Optional[dict]:
        s = self.s
        tools = s.tools_for(self.def_, self.depth)
        system = s.system_prompt(self.def_, self.depth)
        payload = [{"role": "system", "content": system}] + self.messages
        spinner = ui.Spinner("Đang suy nghĩ" if self.depth == 0 else "Subagent đang làm việc")
        state = {"printed": False}
        stream = self.depth == 0

        def on_content(t):
            if stream:
                if not state["printed"]:
                    ui.out("", end="")
                state["printed"] = True
                ui.out(t, end="")

        def on_reasoning(t):
            if stream and s.thinking:
                state["printed"] = True
                ui.out(ui.gray(t), end="")

        spinner.start()
        try:
            for attempt in range(2):
                try:
                    resp = s.client.chat(payload, tools=[t.schema() for t in tools], on_content=on_content,
                                         on_reasoning=on_reasoning, on_first=spinner.stop, thinking=s.thinking)
                    break
                except LLMError as e:
                    spinner.stop()
                    if e.kind == "context" and attempt == 0:
                        ui.out(ui.yellow("  ⚠ Ngữ cảnh đầy, đang rút gọn rồi thử lại…"))
                        self.prune_tool_results(keep_last=1)
                        if not self.compact(midturn=bool(self.messages and self.messages[-1].get("role") == "tool")):
                            ui.out(ui.red("  ✗ " + str(e)))
                            return None
                        payload = [{"role": "system", "content": system}] + self.messages
                        spinner.start()
                        continue
                    ui.out(ui.red("  ✗ " + str(e)))
                    return None
        finally:
            spinner.stop()
        if state["printed"]:
            ui.out("")
        s.track(resp["usage"], len(system) + len(json.dumps(self.messages, ensure_ascii=False)))
        return resp

    # ---- chạy công cụ ----
    def _show_preview(self, tool: Tool, args: dict) -> None:
        if not tool.preview:
            return
        try:
            title, old, new, rel = tool.preview(self.s.ctx, args)
        except ToolError:
            return
        ui.out(ui.indent(ui.render_diff(old, new, rel), 4 + len(self.pad)))

    def ask_permission(self, tool: Tool, args: dict):
        s = self.s
        if not s.interactive:
            ui.out(ui.yellow("    ✋ Cần cấp quyền nhưng đang chạy không tương tác (dùng --mode acceptEdits hoặc --yolo)."))
            return False, "chạy không tương tác, chưa được cấp quyền"
        self._show_preview(tool, args)
        if tool.name == "bash":
            ui.out(ui.indent(ui.yellow("$ " + str(args.get("command", ""))), 4 + len(self.pad)))
        ans = ui.read_line(self.pad + "    " + ui.yellow("Cho phép?") +
                           " [Enter/y] có · [a] luôn cho phép · [n] không · hoặc gõ lý do để từ chối: ").strip()
        low = ans.lower()
        if low in ("", "y", "yes", "c", "có"):
            return True, ""
        if low in ("a", "always"):
            ui.out(ui.gray("    đã thêm quy tắc cho phiên này: " + s.perms.remember(tool, args)))
            return True, ""
        if low in ("n", "no", "k", "không"):
            return False, ""
        return False, ans

    def execute(self, tc: dict) -> str:
        s = self.s
        name, raw = tc["name"], tc["arguments"]
        tool = s.tool(name)
        allowed = {t.name for t in s.tools_for(self.def_, self.depth)}
        try:
            args = json.loads(raw) if raw.strip() else {}
            if not isinstance(args, dict):
                raise ValueError("tham số phải là object")
        except ValueError as e:
            ui.out(ui.red("%s● %s: tham số không hợp lệ" % (self.pad, name)))
            return "Lỗi: tham số không phải JSON hợp lệ (%s). Hãy gọi lại với JSON đúng." % e
        ui.out("%s%s %s(%s)" % (self.pad, ui.cyan("●"), ui.bold(name), ui.gray(call_summary(name, args, s.root))))
        if tool is None or name not in allowed:
            return "Lỗi: không có công cụ '%s'. Công cụ hiện có: %s" % (name, ", ".join(sorted(allowed)))
        # 1) hook trước khi chạy
        hr = s.hooks.run("PreToolUse", name, args)
        for w in hr.warnings:
            ui.out(ui.yellow("    ⚠ " + w))
        if hr.blocked:
            ui.out(ui.red("    ✋ Bị chặn bởi hook: " + hr.message.splitlines()[0]))
            return "Bị chặn bởi hook PreToolUse: " + hr.message
        # 2) quyền
        decision, reason = s.perms.decide(tool, args)
        if decision == "deny":
            ui.out(ui.red("    ✋ " + reason))
            return "Bị từ chối: " + reason
        if decision == "ask":
            ok, note = self.ask_permission(tool, args)
            if not ok:
                ui.out(ui.red("    ✗ Người dùng từ chối" + (": " + note if note else "")))
                return "Người dùng từ chối chạy công cụ này." + (" Lý do: " + note if note else " Hãy đề xuất cách khác hoặc hỏi lại người dùng.")
        else:
            self._show_preview(tool, args)
        # 3) chạy
        error = False
        try:
            result = tool.fn(s.ctx, **args)
        except ToolError as e:
            result, error = "Lỗi: %s" % e, True
        except TypeError as e:
            result, error = "Lỗi tham số khi gọi %s: %s" % (name, e), True
        except KeyboardInterrupt:
            raise
        except Exception as e:  # lỗi bất ngờ của công cụ không được làm sập phiên
            result, error = "Lỗi nội bộ khi chạy %s: %s: %s" % (name, type(e).__name__, e), True
        result = str(result)
        if len(result) > MAX_TOOL_CHARS:
            result = result[:MAX_TOOL_CHARS] + "\n… (đã cắt bớt %d ký tự)" % (len(result) - MAX_TOOL_CHARS)
        ui.out(result_summary(name, result, error))
        # 4) hook sau khi chạy
        hr = s.hooks.run("PostToolUse", name, args, tool_output=result)
        for w in hr.warnings:
            ui.out(ui.yellow("    ⚠ " + w))
        if hr.blocked:
            ui.out(ui.yellow("    ↩ Hook PostToolUse phản hồi: " + hr.message.splitlines()[0]))
            result += "\n[Hook PostToolUse phản hồi]\n" + hr.message
        elif hr.context:
            result += "\n[Hook PostToolUse]\n" + hr.context
        return result
