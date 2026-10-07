"""Client MCP (Model Context Protocol) tối giản qua stdio, JSON-RPC theo từng dòng.

Cấu hình:
  "mcpServers": {"grades": {"command": "python3", "args": ["tools/grades_server.py"], "env": {}}}
Công cụ của server xuất hiện với tên mcp__<server>__<tool>.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Dict, List

from .tools import Tool, ToolError

PROTOCOL_VERSION = "2024-11-05"


class McpError(Exception):
    pass


class McpServer:
    def __init__(self, name: str, spec: dict, cwd: Path):
        self.name = name
        self.spec = spec
        self.cwd = cwd
        self.proc = None
        self._id = 0
        self._lock = threading.Lock()
        self._pending: Dict[int, dict] = {}
        self.tools: List[dict] = []
        self.stderr_tail: List[str] = []

    def start(self, timeout: int = 20) -> None:
        cmd = self.spec.get("command")
        if not cmd:
            raise McpError("thiếu 'command'")
        exe = shutil.which(cmd) or cmd
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in (self.spec.get("env") or {}).items()})
        try:
            self.proc = subprocess.Popen([exe] + [str(a) for a in self.spec.get("args") or []], cwd=str(self.cwd), env=env,
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         text=True, encoding="utf-8", bufsize=1)
        except OSError as e:
            raise McpError("không chạy được '%s': %s" % (cmd, e))
        threading.Thread(target=self._read_loop, daemon=True).start()
        threading.Thread(target=self._err_loop, daemon=True).start()
        self.request("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                                    "clientInfo": {"name": "fitcode", "version": "0.1"}}, timeout)
        self.notify("notifications/initialized")
        res = self.request("tools/list", {}, timeout)
        self.tools = res.get("tools", [])

    def _err_loop(self):
        for line in self.proc.stderr:
            self.stderr_tail = (self.stderr_tail + [line.rstrip()])[-20:]

    def _read_loop(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if "id" in msg and ("result" in msg or "error" in msg):
                with self._lock:
                    slot = self._pending.get(msg["id"])
                if slot:
                    slot["msg"] = msg
                    slot["event"].set()
        with self._lock:                 # server thoát: đánh thức mọi yêu cầu đang chờ
            for slot in self._pending.values():
                slot["event"].set()

    def _send(self, obj: dict) -> None:
        try:
            self.proc.stdin.write(json.dumps(obj) + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError) as e:
            raise McpError("không gửi được tới server: %s" % e)

    def notify(self, method: str, params: dict = None) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def request(self, method: str, params: dict, timeout: int = 60) -> dict:
        with self._lock:
            self._id += 1
            rid = self._id
            slot = {"event": threading.Event(), "msg": None}
            self._pending[rid] = slot
        try:
            self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
            if not slot["event"].wait(timeout) or slot["msg"] is None:
                tail = " | ".join(self.stderr_tail[-3:])
                raise McpError("server '%s' không phản hồi (%s)%s" % (self.name, method, ": " + tail if tail else ""))
            msg = slot["msg"]
            if "error" in msg:
                raise McpError(str(msg["error"].get("message", msg["error"])))
            return msg.get("result") or {}
        finally:
            with self._lock:
                self._pending.pop(rid, None)

    def call(self, tool: str, arguments: dict) -> str:
        res = self.request("tools/call", {"name": tool, "arguments": arguments or {}}, 120)
        parts = []
        for c in res.get("content") or []:
            if c.get("type") == "text":
                parts.append(c.get("text", ""))
            else:
                parts.append("[%s]" % c.get("type", "dữ liệu"))
        text = "\n".join(parts) or "(không có nội dung)"
        if res.get("isError"):
            raise ToolError(text)
        return text

    def close(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()


class McpManager:
    def __init__(self, cfg: dict, root: Path):
        self.servers: Dict[str, McpServer] = {}
        self.errors: Dict[str, str] = {}
        for name, spec in (cfg.get("mcpServers") or {}).items():
            srv = McpServer(name, spec or {}, Path(root))
            try:
                srv.start()
                self.servers[name] = srv
            except McpError as e:
                self.errors[name] = str(e)
                srv.close()

    def tools(self) -> List[Tool]:
        out = []
        for sname, srv in self.servers.items():
            for t in srv.tools:
                tname = "mcp__%s__%s" % (sname, t.get("name"))
                schema = t.get("inputSchema") or {"type": "object", "properties": {}}
                out.append(Tool(tname, "[MCP %s] %s" % (sname, t.get("description", "")), schema,
                                (lambda s, n: (lambda ctx, **a: s.call(n, a)))(srv, t.get("name")), kind="mcp"))
        return out

    def close(self) -> None:
        for s in self.servers.values():
            s.close()
