"""Máy chủ giả lập giao diện /chat/completions (SSE) trả lời theo kịch bản, dùng cho test."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeLLM:
    def __init__(self, script):
        """script: danh sách phản hồi; mỗi phần tử là dict {content?, tool_calls?: [(name, args_dict)], status?: int}
        hoặc hàm (request_body) -> dict."""
        self.script = list(script)
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                body = json.dumps({"data": [{"id": "fake-model"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(n))
                req["_headers"] = dict(self.headers)
                outer.requests.append(req)
                item = outer.script.pop(0) if outer.script else {"content": "(hết kịch bản)"}
                if callable(item):
                    item = item(req)
                if item.get("status"):
                    body = json.dumps({"error": {"message": item.get("message", "lỗi")}}).encode()
                    self.send_response(item["status"])
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    for k, v in (item.get("headers") or {}).items():
                        self.send_header(k, v)
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()

                def send(obj):
                    self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
                    self.wfile.flush()

                content = item.get("content") or ""
                for i in range(0, len(content), 7):
                    send({"choices": [{"delta": {"content": content[i:i + 7]}}]})
                for idx, (name, args) in enumerate(item.get("tool_calls") or []):
                    raw = args if isinstance(args, str) else json.dumps(args)
                    send({"choices": [{"delta": {"tool_calls": [{"index": idx, "id": "call_%d_%d" % (len(outer.requests), idx),
                                                                 "function": {"name": name, "arguments": ""}}]}}]})
                    for j in range(0, len(raw), 11):
                        send({"choices": [{"delta": {"tool_calls": [{"index": idx, "function": {"arguments": raw[j:j + 11]}}]}}]})
                send({"choices": [{"delta": {}, "finish_reason": "tool_calls" if item.get("tool_calls") else "stop"}]})
                send({"choices": [], "usage": {"prompt_tokens": item.get("prompt_tokens", 500), "completion_tokens": 20}})
                self.wfile.write(b"data: [DONE]\n\n")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
