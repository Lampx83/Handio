#!/usr/bin/env python3
"""Máy chủ tĩnh cục bộ + nhận PNG từ trang render.html (để dựng PNG từ SVG bằng trình duyệt, không cần công cụ ngoài).
Chạy: python3 docs/brand/serve-render.py   rồi mở http://127.0.0.1:5181/render.html và bấm "Dựng PNG"."""
import http.server
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = re.compile(r"^app-icon-(2d|3d)-(1024|512|256|192|128|64|32|16)\.png$")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        name = (q.get("name") or [""])[0]
        n = int(self.headers.get("Content-Length", "0"))
        if not NAME.match(name) or n <= 0 or n > 8_000_000:
            self.send_response(400)
            self.end_headers()
            return
        with open(os.path.join(HERE, name), "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", 5181), H).serve_forever()
