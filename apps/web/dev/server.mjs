// Máy chủ dev: phục vụ bản build, proxy cùng nguồn tới gateway (tránh CORS), và LLM giả ở /mock/v1.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockHandler } from "./mock-llm.mjs";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const UPSTREAM = new URL(process.env.UPSTREAM || "http://192.0.2.11:8037");
const PORT = Number(process.env.PORT || 5173);
// NEU_DEV_KEY: gắn key vào yêu cầu tới gateway, giả lập việc nginx trên máy chủ thật làm (key không nằm trong JS của trang)
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      // thử giao diện tài khoản ở máy phát triển: NEU_DEV_USER=ten@neu.edu.vn npm run dev
      if (url.pathname === "/oauth2/userinfo" && process.env.NEU_DEV_USER) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ email: process.env.NEU_DEV_USER }));
      }
      if (url.pathname.startsWith("/mock/")) return await mockHandler(req, res, url.pathname);
      if (url.pathname.startsWith("/vllm/") || url.pathname.startsWith("/ollama/")) {
        const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: req.url, headers: { ...req.headers, host: UPSTREAM.host, ...(process.env.NEU_DEV_KEY && !req.headers["x-ollama-seckey"] ? { "x-ollama-seckey": process.env.NEU_DEV_KEY } : {}) } }, (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        });
        up.on("error", (e) => {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Không tới được gateway: " + e.message }));
        });
        res.on("close", () => up.destroy()); // client ngắt kết nối (không dùng req "close": nó phát ngay khi nhận xong yêu cầu)
        return req.pipe(up);
      }
      if (url.pathname.startsWith("/download/")) {
        // Thử nghiệm cục bộ: phục vụ các bản cài từ DOWNLOAD_DIR (mặc định apps/desktop/release), chỉ đúng danh sách tên cho phép
        const name = decodeURIComponent(url.pathname.slice("/download/".length));
        const dir = path.resolve(process.env.DOWNLOAD_DIR || path.join(dist, "../../desktop/release"));
        const ok = /^(NEU-Agent-[\w.-]+\.(dmg|exe)|SHA256SUMS\.txt|HUONG-DAN-CAI-DAT\.md|BAO-MAT\.md)$/.test(name);
        const f = path.join(dir, name);
        if (!ok || !fs.existsSync(f)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("404");
        }
        res.writeHead(200, { "Content-Type": /\.(txt|md)$/.test(name) ? "text/plain; charset=utf-8" : "application/octet-stream", "Content-Length": fs.statSync(f).size, "X-Content-Type-Options": "nosniff" });
        return req.method === "HEAD" ? res.end() : fs.createReadStream(f).pipe(res);
      }
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(dist, rel);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("404");
      }
      const headers = { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" };
      // worker chạy mã do mô hình viết: CSP riêng, không cho ra mạng
      if (file.endsWith("sandbox-worker.js")) headers["Content-Security-Policy"] = "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'";
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`NEU Agent (web): http://127.0.0.1:${PORT}   (mock LLM: /mock/v1, gateway: ${UPSTREAM.origin})`));
