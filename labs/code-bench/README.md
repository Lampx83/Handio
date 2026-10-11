# Bài thử tab Code: 10 ứng dụng

Đo khả năng code của Handio với **khung (framework) thật** — không chỉ HTML/CSS/JS thuần. Mỗi bài là một đề viết như sinh viên viết, kèm "bẫy" thường gặp và bộ chấm tự động (build, chạy, mở trang trong trình duyệt ẩn, bấm thử, kiểm lỗi console).

| # | Bài | Khung | Bẫy |
|---|---|---|---|
| 01 | Bộ đếm | HTML/CSS/JS thuần | mốc so sánh |
| 02 | Việc cần làm | React + Vite | dựng dự án, state, localStorage |
| 03 | Form đăng nhập | React + Chakra UI | Chakra v3 ≠ v2 (trang trắng) |
| 04 | Bảng giá + dark mode | React + Tailwind | Tailwind v4 ≠ v3 (CSS không áp dụng mà build vẫn xanh) |
| 05 | Ghi chú | Vue 3 + Vite | Composition API, `ref` |
| 06 | Đồng hồ bấm giờ | Svelte + Vite | Svelte 5 runes ≠ Svelte 4 |
| 07 | Blog nhiều trang | React Router | v7 ≠ v6 |
| 08 | Dashboard doanh thu | React + Recharts | đọc dữ liệu có sẵn, biểu đồ 0px |
| 09 | Blog + API | Next.js App Router | `use client`, route handler, build |
| 10 | API việc cần làm | Express + kiểm thử | PORT, `npm test`, mã 400/404 |

## Chạy tự động

Cách dễ nhất: `node labs/code-bench/run.mjs --only 03,04` rồi trả lời các câu hỏi (máy chủ mặc định là của Handio; chọn đăng nhập bằng tài khoản hoặc khoá API, gõ mật khẩu không hiện). Cách thủ công bằng biến môi trường:

Cần một mô hình thật (API kiểu OpenAI) và `npm ci` ở gốc kho. Thông tin kết nối đặt qua biến môi trường, **không** ghi vào kho:

```bash
export HANDIO_BENCH_BASE_URL="https://ĐỊA-CHỈ-API/v1"   # bắt buộc, địa chỉ thật
export HANDIO_BENCH_KEY="…"                    # nếu có khoá API
# hoặc đăng nhập bằng tài khoản (tên + mật khẩu do quản trị cấp), giống Handio Desktop:
export HANDIO_BENCH_USER="tên" HANDIO_BENCH_PASSWORD="mật-khẩu"
export HANDIO_BENCH_MODEL="…"                  # mặc định qwen3.5-35b-a3b-int4
export HANDIO_BENCH_KEY_HEADER="Authorization" # mặc định x-ollama-seckey

node labs/code-bench/run.mjs                   # cả 10 bài (≈ 10–25 phút mỗi bài)
node labs/code-bench/run.mjs --only 03,04      # vài bài
node labs/code-bench/run.mjs --regrade <thư-mục-kết-quả>   # chấm lại, không gọi mô hình
```

Mỗi bài chạy đúng như người dùng thật ở tab Code: chế độ Tự động, lệnh chạy trong sandbox (macOS), agent tự `npm install`. Kết quả nằm ở thư mục tạm `$TMPDIR/handio-code-bench/<lần-chạy>/` (in ra khi chạy; đổi bằng `--out <thư-mục>`). Để NGOÀI kho vì `npm install` của agent trong thư mục trống sẽ leo lên sửa `package.json` của kho:

- `report.md`, `summary.json`: bảng đạt/không, kèm lỗi công cụ của agent ở bài hỏng;
- `<bài>/app/`: ứng dụng agent làm ra (mở xem, chạy lại được);
- `<bài>/agent.log`: từng bước agent làm, lỗi, lời cuối; `agent.json`: số bước, token, lượt gọi.

Chú ý khi đọc kết quả: bài **build xanh nhưng kiểm tra trang đỏ** là loại lỗi nguy hiểm nhất (agent báo "xong" mà người dùng thấy trang trắng/sai).

## Chạy tay

```bash
node labs/code-bench/run.mjs --list    # in 10 đề để dán vào tab Code của Handio
```

Bài 08 cần sẵn `data/doanh-thu.json` (tệp được tạo tự động khi chạy tự động; chạy tay thì chép từ `tasks.mjs`).

## Thêm bài

Thêm một mục vào `tasks.mjs` (`id`, `prompt`, `serve`, `checks`). Nêu **nhãn giao diện chính xác** trong đề (chữ trên nút, placeholder) để bộ chấm bấm/nhập đúng chỗ; kiểm tra bằng `eval` trên nội dung trang. Bộ chấm (`probe.cjs`) chạy trong Electron ẩn, chỉ cho nạp localhost.
