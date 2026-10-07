"""Client gọi mô hình qua giao diện kiểu OpenAI (/chat/completions, streaming)."""
from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.request
import uuid


class LLMError(Exception):
    def __init__(self, message: str, status: int = 0, kind: str = ""):
        super().__init__(message)
        self.status = status
        self.kind = kind  # "context" | "auth" | "rate" | "server" | "network" | ""


def _friendly(status: int, text: str) -> LLMError:
    low = (text or "").lower()
    if status == 400 and ("context length" in low or "maximum context" in low or "too long" in low or "max_tokens" in low and "context" in low):
        return LLMError("Ngữ cảnh vượt giới hạn của mô hình.", status, "context")
    if status == 401:
        return LLMError("Key sai hoặc chưa gửi kèm. Chạy `fitcode login` để nhập lại.", status, "auth")
    if status == 403:
        return LLMError("Key này không được dùng mô hình chat (có thể là key chỉ dành cho embedding).", status, "auth")
    if status == 429:
        return LLMError("Vượt giới hạn số lệnh/phút của key.", status, "rate")
    if status in (502, 503, 504):
        return LLMError("Mô hình đang khởi động hoặc quá tải.", status, "server")
    return LLMError("Lỗi %d: %s" % (status, (text or "")[:300]), status)


_TOOLCALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)
_FUNC_RE = re.compile(r"<function=([\w.\-]+)>(.*?)</function>", re.S)
_PARAM_RE = re.compile(r"<parameter=([\w.\-]+)>\s*(.*?)\s*</parameter>", re.S)


def parse_text_tool_calls(content: str):
    """Một số lần mô hình viết lời gọi công cụ thành văn bản (<tool_call>{json}</tool_call> hoặc <function=...>).
    Chuyển chúng về dạng tool_calls chuẩn. Trả về (nội dung đã bỏ phần gọi, danh sách gọi)."""
    calls = []

    def add(name, args):
        if name:
            calls.append({"id": "call_" + uuid.uuid4().hex[:12], "name": name,
                          "arguments": args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)})

    def from_function(name, body):
        params = {k: v for k, v in _PARAM_RE.findall(body)}
        add(name, params)

    def repl_block(m):
        inner = m.group(1)
        try:
            obj = json.loads(inner)
            if isinstance(obj, dict) and obj.get("name"):
                add(obj["name"], obj.get("arguments", {}))
                return ""
        except ValueError:
            pass
        fm = _FUNC_RE.search(inner)
        if fm:
            from_function(fm.group(1), fm.group(2))
            return ""
        return m.group(0)

    clean = _TOOLCALL_RE.sub(repl_block, content)
    if not calls:
        clean = _FUNC_RE.sub(lambda m: (from_function(m.group(1), m.group(2)), "")[1], clean)
    return clean.strip(), calls


class Client:
    def __init__(self, cfg: dict, notify=None):
        self.cfg = cfg
        self.notify = notify or (lambda msg: None)

    # ---- tiện ích ----
    def _headers(self) -> dict:
        h = {"Content-Type": "application/json", "Accept": "text/event-stream", "User-Agent": "fitcode/0.1"}
        key = self.cfg.get("key")
        if key:
            h[self.cfg.get("key_header", "x-ollama-seckey")] = key
        return h

    def models(self) -> list:
        req = urllib.request.Request(self.cfg["base_url"] + "/models", headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return [m.get("id") for m in json.load(r).get("data", [])]
        except urllib.error.HTTPError as e:
            raise _friendly(e.code, e.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, socket.timeout, OSError) as e:
            raise LLMError("Không kết nối được máy chủ: %s" % e, 0, "network")

    # ---- gọi chat ----
    def chat(self, messages, tools=None, on_content=None, on_reasoning=None, on_first=None,
             max_tokens=None, temperature=None, thinking=None, retries=6):
        body = {
            "model": self.cfg["model"],
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": self.cfg.get("temperature", 0.3) if temperature is None else temperature,
            "max_tokens": max_tokens or self.cfg.get("max_output_tokens", 4096),
            "chat_template_kwargs": {"enable_thinking": bool(self.cfg.get("thinking") if thinking is None else thinking)},
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        data = json.dumps(body).encode("utf-8")
        attempt = 0
        while True:
            attempt += 1
            req = urllib.request.Request(self.cfg["base_url"] + "/chat/completions", data=data,
                                         headers=self._headers(), method="POST")
            try:
                resp = urllib.request.urlopen(req, timeout=300)
            except urllib.error.HTTPError as e:
                err = _friendly(e.code, e.read().decode("utf-8", "replace"))
                e.close()
                if err.kind == "rate" and attempt <= retries:
                    wait = min(int(e.headers.get("Retry-After") or 5), 60)
                    self.notify("Chạm giới hạn lệnh/phút, thử lại sau %ds…" % wait)
                    time.sleep(wait)
                    continue
                if err.kind == "server" and attempt <= retries + 4:
                    wait = min(5 * attempt, 30)
                    self.notify("%s Thử lại sau %ds (lần %d)…" % (err.args[0], wait, attempt))
                    time.sleep(wait)
                    continue
                raise err
            except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
                if attempt <= 3:
                    self.notify("Mất kết nối (%s). Thử lại sau 3s…" % e)
                    time.sleep(3)
                    continue
                raise LLMError("Không kết nối được máy chủ: %s" % e, 0, "network")
            try:
                return self._read_stream(resp, on_content, on_reasoning, on_first)
            finally:
                resp.close()

    def _read_stream(self, resp, on_content, on_reasoning, on_first):
        content, reasoning = [], []
        calls = {}
        usage, finish = None, None
        first = True
        try:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    j = json.loads(payload)
                except ValueError:
                    continue
                if j.get("error"):
                    raise LLMError(str(j["error"].get("message", j["error"]))[:300])
                if j.get("usage"):
                    usage = j["usage"]
                choices = j.get("choices") or []
                if not choices:
                    continue
                ch = choices[0]
                if ch.get("finish_reason"):
                    finish = ch["finish_reason"]
                d = ch.get("delta") or {}
                r = d.get("reasoning") or d.get("reasoning_content")
                if r:
                    if first and on_first:
                        on_first()
                    first = False
                    reasoning.append(r)
                    if on_reasoning:
                        on_reasoning(r)
                if d.get("content"):
                    if first and on_first:
                        on_first()
                    first = False
                    content.append(d["content"])
                    if on_content:
                        on_content(d["content"])
                for tc in d.get("tool_calls") or []:
                    if first and on_first:
                        on_first()
                    first = False
                    idx = tc.get("index", 0)
                    e = calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                    if tc.get("id"):
                        e["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name") and not e["name"]:
                        e["name"] = fn["name"]
                    if fn.get("arguments"):
                        e["arguments"] += fn["arguments"]
        except (socket.timeout, ConnectionError, OSError) as e:
            raise LLMError("Kết nối bị ngắt giữa chừng: %s" % e, 0, "network")
        tool_calls = []
        for idx in sorted(calls):
            c = calls[idx]
            if not c["name"]:
                continue
            tool_calls.append({"id": c["id"] or "call_" + uuid.uuid4().hex[:12], "name": c["name"],
                               "arguments": c["arguments"] or "{}"})
        text = "".join(content)
        if not tool_calls and ("<tool_call>" in text or "<function=" in text):
            text, tool_calls = parse_text_tool_calls(text)
        return {"content": text, "reasoning": "".join(reasoning), "tool_calls": tool_calls,
                "usage": usage or {}, "finish": finish}
