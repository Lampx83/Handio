# Qwen3.5 Playground

Trang `/docs/` của gateway mô hình (file `playground.html`, một file duy nhất, không cần build). Gọi mô hình qua `/vllm/v1`, embedding qua `/ollama/api/embed`.

Triển khai: chép vào máy chủ 232 tại `/data/data/models/docs/qwen35/playground.html` (ghi đè nội dung file tại chỗ bằng `cat new > file`, không dùng `sed -i`, vì container nginx bind-mount theo inode).
Tab "Đọc tài liệu" nhận PDF nhờ pdf.js tự host tại `docs/qwen35/pdfjs/` (pdfjs-dist 4.10.38: `pdf.min.mjs`, `pdf.worker.min.mjs`; không đưa vào repo). Cần CSP `script-src 'self'` và MIME JavaScript cho `.mjs` (xem `server/gateway-232/docs/nginx.conf`).

Thử cục bộ: `devproxy.py` (chuyển tiếp tới gateway thật, khóa đặt qua biến môi trường `LLM_KEY`) hoặc `mock.py` (máy chủ giả lập, không cần mạng).
