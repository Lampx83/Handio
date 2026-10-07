/** Dự án thiết kế mẫu (tab Design): một poster HTML/CSS thuần để xem trước ngay và để agent chỉnh sửa. */
export const SAMPLE_DESIGN: Record<string, string> = {
  "README.md": `# Thiết kế mẫu

- \`poster-hoi-thao.html\`: poster A4 (794×1123 px) làm bằng HTML + CSS thuần, không script, không tài nguyên ngoài.
- Thử nói với agent: “Đổi bảng màu sang tông xanh lá”, “Thêm phần diễn giả”, hoặc \`/bienthe\` để tạo phiên bản khác.
- Gõ \`/\` để xem các mẫu: poster, landing page, slide, logo, infographic, danh thiếp…
`,
  "poster-hoi-thao.html": `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Poster hội thảo (mẫu)</title>
<style>
@page { size: A4; margin: 0 }
:root { --navy:#10265c; --blue:#1f5fd6; --sky:#e8f0ff; --gold:#f5b301; --ink:#142038; --muted:#51607d }
* { box-sizing: border-box; margin: 0 }
body { width: 794px; height: 1123px; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); background: #fff; overflow: hidden; position: relative }
.top { height: 470px; padding: 64px 64px 0; color: #fff; background: linear-gradient(135deg, var(--navy), var(--blue)); position: relative }
.top::after { content: ""; position: absolute; right: -90px; top: -90px; width: 360px; height: 360px; border-radius: 50%; background: rgba(255,255,255,.08) }
.tag { display: inline-block; padding: 6px 14px; border-radius: 999px; background: var(--gold); color: var(--navy); font-weight: 700; font-size: 15px; letter-spacing: .5px }
h1 { margin-top: 26px; font-size: 62px; line-height: 1.08; font-weight: 800; max-width: 600px }
.sub { margin-top: 20px; font-size: 21px; line-height: 1.45; max-width: 560px; opacity: .92 }
.card { position: absolute; left: 64px; right: 64px; top: 410px; background: #fff; border-radius: 18px; padding: 28px 32px; box-shadow: 0 14px 40px rgba(16,38,92,.18); display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px }
.card b { display: block; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: var(--blue) }
.card span { display: block; margin-top: 6px; font-size: 22px; font-weight: 700 }
.body { padding: 150px 64px 0 }
.body h2 { font-size: 26px; color: var(--navy) }
ul { margin-top: 16px; padding-left: 0; list-style: none; display: grid; gap: 12px }
li { font-size: 19px; line-height: 1.4; padding: 14px 18px; background: var(--sky); border-radius: 12px; border-left: 6px solid var(--blue) }
li small { display: block; color: var(--muted); font-size: 15px; margin-top: 2px }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: var(--navy); color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 64px; font-size: 17px }
.foot strong { color: var(--gold) }
</style>
</head>
<body>
<div class="top">
  <span class="tag">HỘI THẢO</span>
  <h1>Trí tuệ nhân tạo trong giáo dục đại học</h1>
  <p class="sub">Ứng dụng AI vào giảng dạy, nghiên cứu và quản lý: kinh nghiệm thực tế và các bước bắt đầu ngay.</p>
</div>
<div class="card">
  <div><b>Thời gian</b><span>08:30 · 15/11/2026</span></div>
  <div><b>Địa điểm</b><span>[Địa điểm tổ chức]</span></div>
  <div><b>Hình thức</b><span>Trực tiếp + trực tuyến</span></div>
</div>
<div class="body">
  <h2>Chương trình</h2>
  <ul>
    <li>Phiên 1 · AI cho giảng dạy<small>Thiết kế bài giảng, đánh giá và phản hồi với AI</small></li>
    <li>Phiên 2 · AI cho nghiên cứu<small>Tìm tài liệu, phân tích dữ liệu, viết bài khoa học có trách nhiệm</small></li>
    <li>Phiên 3 · Thực hành vibe coding<small>Làm một ứng dụng nhỏ cùng trợ lý AI trong 45 phút</small></li>
  </ul>
</div>
<div class="foot"><span>Đăng ký: <strong>[địa chỉ đăng ký]</strong></span><span>[Tên đơn vị tổ chức]</span></div>
</body>
</html>
`,
};
