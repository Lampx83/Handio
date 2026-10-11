// 10 bài thử cho tab Code: mỗi bài là một ứng dụng nhỏ với khung (framework) khác nhau, có "bẫy" thường gặp.
// `prompt` viết như sinh viên viết (tiếng Việt, không kỹ thuật). Nhãn giao diện được nêu rõ trong đề để bộ chấm bấm/nhập đúng chỗ.
// Kiểm tra (checks):
//   pkg   {has:[…]}              package.json có các gói này
//   files {paths:[…]}            các tệp phải có
//   cmd   {run, label}           lệnh phải thoát mã 0 (npm run build, npm test…)
//   page  {path, steps:[…]}      mở trang trong trình duyệt ẩn, chạy các bước, KHÔNG được có lỗi console/trang trắng
//        bước: {fill:{placeholder|label|selector}, value} · {click:{text|selector}} · {wait:ms} · {eval:"biểu thức → true", label}
//   http  {method, path, body, status, json:"biểu thức trên d → true"}   (cho API)
// serve: {kind:"static", dir} (phục vụ thư mục tĩnh) | {kind:"cmd", build, start} (cổng đặt qua biến PORT)


export const TASKS = [
  {
    id: "01-vanilla-counter",
    title: "Bộ đếm (HTML/CSS/JS thuần)",
    stack: "vanilla",
    trap: "Mốc so sánh: không framework, không bước cài đặt.",
    prompt: 'Làm giúp mình một trang web đếm số bằng HTML, CSS và JavaScript thuần (không dùng thư viện). Giữa trang hiển thị con số, bắt đầu từ 0. Có 3 nút: "Tăng", "Giảm", "Đặt lại". Giá trị được lưu vào localStorage để tải lại trang vẫn còn. Giao diện đẹp, canh giữa.',
    serve: { kind: "static", dir: "." },
    checks: [
      { kind: "files", paths: ["index.html"] },
      { kind: "page", path: "/index.html", steps: [{ click: { text: "Tăng" } }, { click: { text: "Tăng" } }, { eval: 'document.body.innerText.includes("2")', label: "Bấm Tăng 2 lần → hiện 2" }, { click: { text: "Giảm" } }, { eval: 'document.body.innerText.includes("1")', label: "Giảm → 1" }, { click: { text: "Đặt lại" } }, { eval: "/\\b0\\b/.test(document.body.innerText)", label: "Đặt lại → 0" }] },
    ],
  },
  {
    id: "02-react-todo",
    title: "Danh sách việc cần làm (React + Vite)",
    stack: "react+vite",
    trap: "Dựng dự án Vite đúng, state, lọc, localStorage.",
    prompt: 'Làm cho mình ứng dụng danh sách việc cần làm bằng React (dùng Vite). Có ô nhập với placeholder "Việc cần làm" và nút "Thêm". Mỗi việc có hộp tick hoàn thành và nút "Xoá". Có 3 bộ lọc: "Tất cả", "Đang làm", "Đã xong". Lưu vào localStorage. Chạy được bằng npm run dev và build được bằng npm run build.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["react", "vite"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ fill: { placeholder: "Việc cần làm" }, value: "Học React" }, { click: { text: "Thêm" } }, { fill: { placeholder: "Việc cần làm" }, value: "Nộp bài" }, { click: { text: "Thêm" } }, { eval: 'document.body.innerText.includes("Học React") && document.body.innerText.includes("Nộp bài")', label: "Thêm 2 việc" }, { click: { text: "Xoá" } }, { eval: '!document.body.innerText.includes("Học React") || !document.body.innerText.includes("Nộp bài")', label: "Xoá bớt 1 việc" }] },
    ],
  },
  {
    id: "03-react-chakra-login",
    title: "Form đăng nhập (React + Chakra UI)",
    stack: "react+vite+chakra",
    trap: "Chakra UI v3 vừa ra, API khác v2 (ChakraProvider, useToast, Tabs…): agent từng cài v3 nhưng viết mã v2 → trang trắng.",
    prompt: 'Làm trang đăng nhập bằng React + Vite và thư viện Chakra UI. Có ô Email (placeholder "Email"), ô mật khẩu (placeholder "Mật khẩu") và nút "Đăng nhập". Bấm khi email sai định dạng thì hiện chữ "Email không hợp lệ" dưới ô; mật khẩu dưới 6 ký tự thì hiện "Mật khẩu tối thiểu 6 ký tự". Nhập đúng thì hiện thông báo (toast) "Đăng nhập thành công". Giao diện đẹp, có chế độ sáng/tối.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["react", "@chakra-ui/react"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ click: { text: "Đăng nhập" } }, { eval: 'document.body.innerText.includes("Email không hợp lệ")', label: "Form trống → báo lỗi email" }, { fill: { placeholder: "Email" }, value: "a@neu.edu.vn" }, { fill: { placeholder: "Mật khẩu" }, value: "123" }, { click: { text: "Đăng nhập" } }, { eval: 'document.body.innerText.includes("tối thiểu 6")', label: "Mật khẩu ngắn → báo lỗi" }, { fill: { placeholder: "Mật khẩu" }, value: "matkhau123" }, { click: { text: "Đăng nhập" } }, { wait: 600 }, { eval: 'document.body.innerText.includes("Đăng nhập thành công")', label: "Đúng → toast thành công" }] },
    ],
  },
  {
    id: "04-react-tailwind-pricing",
    title: "Trang bảng giá (React + Tailwind CSS)",
    stack: "react+vite+tailwind",
    trap: "Tailwind v4 đổi cách cài (plugin Vite, @import) so với v3 (tailwind.config.js, postcss): lớp CSS không được áp dụng mà build vẫn xanh.",
    prompt: 'Làm trang bảng giá bằng React + Vite + Tailwind CSS. 3 gói: "Cơ bản" (0đ), "Pro" (99.000đ), "Doanh nghiệp" (liên hệ), mỗi gói là một thẻ bo góc lớn (rounded-xl), có danh sách tính năng và nút "Chọn gói". Có nút "Chế độ tối" bật/tắt dark mode (thêm class dark vào thẻ html). Responsive: màn hình hẹp xếp dọc.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["react", "tailwindcss"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ eval: 'document.body.innerText.includes("Cơ bản") && document.body.innerText.includes("Pro") && document.body.innerText.includes("Doanh nghiệp")', label: "Có 3 gói" }, { eval: '(() => { const e = document.querySelector("[class*=rounded-xl]"); return !!e && getComputedStyle(e).borderRadius !== "0px"; })()', label: "Tailwind thật sự được áp dụng (rounded-xl có bo góc)" }, { click: { text: "Chế độ tối" } }, { eval: 'document.documentElement.classList.contains("dark")', label: "Bật dark mode" }] },
    ],
  },
  {
    id: "05-vue-notes",
    title: "Ghi chú (Vue 3 + Vite)",
    stack: "vue3+vite",
    trap: "Composition API / <script setup>, ref không .value trong template.",
    prompt: 'Làm ứng dụng ghi chú bằng Vue 3 (dùng Vite). Có ô nhập nhiều dòng placeholder "Nội dung ghi chú" và nút "Lưu". Danh sách ghi chú hiện bên dưới, mỗi ghi chú có nút "Xoá". Phía trên hiện "Tổng: N ghi chú". Lưu vào localStorage.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["vue"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ eval: 'document.body.innerText.includes("Tổng: 0")', label: "Ban đầu Tổng: 0" }, { fill: { placeholder: "Nội dung ghi chú" }, value: "Ghi chú thử một" }, { click: { text: "Lưu" } }, { eval: 'document.body.innerText.includes("Ghi chú thử một") && document.body.innerText.includes("Tổng: 1")', label: "Lưu → Tổng: 1" }, { click: { text: "Xoá" } }, { eval: 'document.body.innerText.includes("Tổng: 0")', label: "Xoá → Tổng: 0" }] },
    ],
  },
  {
    id: "06-svelte-stopwatch",
    title: "Đồng hồ bấm giờ (Svelte + Vite)",
    stack: "svelte+vite",
    trap: "Svelte 5 (runes: $state, $derived) khác Svelte 4 ($:, export let) — mô hình hay viết cú pháp cũ.",
    prompt: 'Làm đồng hồ bấm giờ bằng Svelte (dùng Vite). Hiện thời gian dạng mm:ss lớn giữa trang, bắt đầu 00:00. Có 3 nút: "Bắt đầu", "Dừng", "Đặt lại". Chạy được bằng npm run dev và npm run build.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["svelte"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ eval: 'document.body.innerText.includes("00:00")', label: "Ban đầu 00:00" }, { click: { text: "Bắt đầu" } }, { wait: 2300 }, { eval: '/00:0[1-3]/.test(document.body.innerText)', label: "Sau ~2s hiện 00:01–00:03" }, { click: { text: "Dừng" } }, { click: { text: "Đặt lại" } }, { eval: 'document.body.innerText.includes("00:00")', label: "Đặt lại → 00:00" }] },
    ],
  },
  {
    id: "07-react-router-blog",
    title: "Blog nhỏ nhiều trang (React Router)",
    stack: "react+vite+react-router",
    trap: "React Router v7 (gộp vào `react-router`, data router) khác v6 (`react-router-dom`, <Routes>).",
    prompt: 'Làm blog nhỏ bằng React + Vite + React Router với 3 trang: "/" (danh sách 3 bài viết mẫu, mỗi bài có tiêu đề là liên kết), "/bai-viet/:id" (nội dung bài), "/gioi-thieu" (trang giới thiệu). Thanh menu trên cùng có liên kết "Trang chủ" và "Giới thiệu". Bài viết mẫu có tiêu đề "Bài số 1", "Bài số 2", "Bài số 3".',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["react"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ eval: 'document.body.innerText.includes("Bài số 3")', label: "Trang chủ liệt kê 3 bài" }, { click: { text: "Giới thiệu" } }, { eval: 'location.pathname.includes("gioi-thieu")', label: 'Bấm "Giới thiệu" → /gioi-thieu' }, { click: { text: "Trang chủ" } }, { click: { text: "Bài số 2" } }, { eval: 'location.pathname.includes("bai-viet")', label: "Bấm bài → /bai-viet/…" }] },
    ],
  },
  {
    id: "08-react-recharts-dashboard",
    title: "Bảng điều khiển doanh thu (React + Recharts)",
    stack: "react+vite+recharts",
    trap: "Đọc dữ liệu có sẵn trong dự án, thư viện biểu đồ, kích thước container (biểu đồ 0px).",
    seed: { "data/doanh-thu.json": JSON.stringify([{ thang: "T1", doanhThu: 120 }, { thang: "T2", doanhThu: 150 }, { thang: "T3", doanhThu: 90 }, { thang: "T4", doanhThu: 180 }, { thang: "T5", doanhThu: 210 }, { thang: "T6", doanhThu: 170 }], null, 2) },
    prompt: 'Trong dự án có sẵn data/doanh-thu.json (doanh thu theo tháng, đơn vị triệu đồng). Làm bảng điều khiển bằng React + Vite + Recharts: hiện "Tổng doanh thu" (cộng cả 6 tháng), một biểu đồ cột doanh thu theo tháng và một biểu đồ đường cùng dữ liệu. Có nút "Biểu đồ cột" / "Biểu đồ đường" để chuyển qua lại giữa 2 loại biểu đồ.',
    serve: { kind: "static", dir: "dist" },
    checks: [
      { kind: "pkg", has: ["react", "recharts"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "page", path: "/", steps: [{ wait: 800 }, { eval: 'document.body.innerText.includes("Tổng doanh thu") && document.body.innerText.includes("920")', label: "Tổng doanh thu = 920" }, { eval: '(() => { const s = document.querySelector("svg.recharts-surface"); if (!s) return false; const r = s.getBoundingClientRect(); return r.width > 50 && r.height > 50; })()', label: "Biểu đồ có kích thước thật (không 0px)" }, { click: { text: "Biểu đồ đường" } }, { wait: 500 }, { eval: '!!document.querySelector(".recharts-line")', label: "Chuyển sang biểu đồ đường" }] },
    ],
  },
  {
    id: "09-nextjs-blog",
    title: "Blog (Next.js App Router + API route)",
    stack: "nextjs",
    trap: "App Router: 'use client' cho state, params là Promise ở Next 15, route handler `route.ts`; build chậm, dễ treo.",
    prompt: 'Làm blog bằng Next.js (App Router, TypeScript). Trang chủ "/" liệt kê 3 bài viết mẫu có tiêu đề "Bài số 1", "Bài số 2", "Bài số 3", mỗi bài là liên kết tới "/posts/<slug>" hiển thị nội dung. Thêm API GET /api/posts trả về JSON mảng các bài viết (có id, title). Chạy được bằng npm run build và npm start.',
    serve: { kind: "cmd", build: "npm run build", start: "npm start" },
    checks: [
      { kind: "pkg", has: ["next", "react"] },
      { kind: "cmd", run: "npm run build", label: "npm run build" },
      { kind: "http", method: "GET", path: "/api/posts", status: 200, json: "Array.isArray(d) && d.length >= 3 && d.every((p) => p.title)" },
      { kind: "page", path: "/", steps: [{ eval: 'document.body.innerText.includes("Bài số 1") && document.body.innerText.includes("Bài số 3")', label: "Trang chủ liệt kê bài" }, { click: { text: "Bài số 2" } }, { wait: 800 }, { eval: 'location.pathname.startsWith("/posts/")', label: "Bấm bài → /posts/…" }] },
    ],
  },
  {
    id: "10-express-todo-api",
    title: "API việc cần làm (Express + kiểm thử)",
    stack: "node+express",
    trap: "Không có giao diện: cổng từ PORT, kiểm thử tự chạy được (node --test/vitest), xử lý lỗi 404/400.",
    prompt: 'Làm API REST quản lý việc cần làm bằng Node.js + Express (lưu trong bộ nhớ). Các đường dẫn: GET /todos, POST /todos (body {"title": "..."}; thiếu title trả 400), PATCH /todos/:id (đổi done), DELETE /todos/:id (không có thì 404). Cổng đọc từ biến môi trường PORT (mặc định 3000). Viết kiểm thử tự động chạy được bằng npm test (dùng node --test hoặc vitest) và có npm start.',
    serve: { kind: "cmd", build: "", start: "npm start" },
    checks: [
      { kind: "pkg", has: ["express"] },
      { kind: "cmd", run: "npm test", label: "npm test" },
      { kind: "http", method: "POST", path: "/todos", body: { title: "Thử API" }, status: [200, 201], json: "d && d.title === 'Thử API' && d.id !== undefined" },
      { kind: "http", method: "POST", path: "/todos", body: {}, status: 400 },
      { kind: "http", method: "GET", path: "/todos", status: 200, json: "Array.isArray(d) && d.length >= 1" },
      { kind: "http", method: "DELETE", path: "/todos/khong-co-id-nay", status: 404 },
    ],
  },
];
