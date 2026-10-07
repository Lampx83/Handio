# Kịch bản training — tab Design (thiết kế bằng AI)

Tab **Design** dành cho giảng viên, cán bộ truyền thông và sinh viên cần làm nhanh **poster, tờ rơi, landing page, slide, logo, infographic, danh thiếp, thiệp mời, banner mạng xã hội**. Agent viết thiết kế thành **một tệp HTML (hoặc SVG) tự đủ** trong thư mục dự án; ứng dụng hiện bản xem trước ở bên phải ngay khi tệp được tạo hoặc sửa.

**Giới hạn cần nói thẳng với người học**
- Agent **không nhìn thấy** kết quả đã vẽ: bạn là người xem và góp ý ("đổi tiêu đề to hơn", "màu nhạt quá").
- Không tạo ảnh chụp/ảnh minh hoạ raster, không dùng phông chữ thương hiệu riêng; hình minh hoạ làm bằng SVG/CSS, biểu tượng dùng emoji hoặc SVG.
- Bản xem trước **không chạy JavaScript và không tải gì từ Internet** (để an toàn), nên thiết kế là tĩnh. Logo, tên, số điện thoại thật phải do bạn cung cấp; nếu thiếu, agent để chỗ trống dạng `[Tên đơn vị]`.
- Xuất **PDF/PNG** (nút trên khung xem trước) chỉ có ở bản **Desktop**; ở bản web dùng **⬇ Tải tệp** để lấy HTML rồi mở bằng trình duyệt.

## Kịch bản 1 — Poster hội thảo (15 phút)
1. Tạo dự án mới (bấm tên dự án ở thanh bên → *＋ Dự án mới…*), tên "Hội thảo AI 2026". Ở ô hướng dẫn ghi: *Màu chủ đạo xanh navy và vàng; font không chân; giọng văn trang trọng; không dùng ảnh.*
2. Gõ `/poster` kèm thông tin: tên hội thảo, thời gian, địa điểm, 3 phiên chính, nơi đăng ký.
3. Xem bản xem trước (khổ A4). Góp ý 2–3 vòng: "tăng cỡ chữ tiêu đề", "thêm khối diễn giả", "đổi nền sang trắng, giữ màu nhấn vàng".
4. `/bienthe đổi sang tông xanh lá` để so sánh hai phương án (tệp `-v2`, bản gốc không bị ghi đè).
5. Bấm **PDF** để xuất bản in. *Điểm chấm:* tiêu đề đọc được từ 2 m; có đủ ngày–giờ–địa điểm–cách đăng ký; không có thông tin bịa (số điện thoại/URL phải là `[…]` nếu chưa cung cấp).

## Kịch bản 2 — Landing page giới thiệu khoá học (20 phút)
`/landing` với: tên khoá, đối tượng, 3 lợi ích, lịch học, nút đăng ký (chỉ là nút tĩnh). Kiểm tra bản xem trước ở khổ **Điện thoại (390)** và **Web máy tính (1280)** bằng ô chọn khổ. Yêu cầu agent "thu gọn bố cục trên điện thoại" nếu bị tràn.

## Kịch bản 3 — Bộ slide bằng HTML/CSS (20 phút)
`/slidedeck` với đề cương 6 slide. Mỗi slide là một khối 1280×720 xếp dọc; chọn khổ **Slide** để xem. Xuất PDF để chiếu hoặc in. (Cần file .pptx chỉnh sửa được thì dùng tab **Work** với `/trinhchieu`.)

## Kịch bản 4 — Số liệu thành biểu đồ / dashboard (20 phút)
Thêm tệp Excel/CSV vào dự án (nút *＋ Thêm tệp*), gõ `/dashboard` hoặc `/bieudo` và tên tệp. Agent đọc số liệu thật rồi vẽ cột/đường bằng SVG. *Điểm chấm:* đối chiếu 3 con số trên biểu đồ với tệp gốc; số nào không có trong dữ liệu là lỗi.

## Kịch bản 5 — Bộ nhận diện nhỏ cho CLB (30 phút)
`/logo` (3 phương án trong một tệp SVG) → chọn một → `/namecard` danh thiếp → `/instapost` bài đăng vuông. Nhắc agent dùng **cùng bảng màu và phông** nhờ hướng dẫn dự án (nút 📝 ở thanh bên).

## Mẹo cho người hướng dẫn
- **Hướng dẫn dự án** (📝) là chỗ ghi bảng màu, giọng văn, quy tắc thương hiệu: agent đọc ở mọi cuộc trò chuyện của dự án.
- **Lịch sử**: mỗi dự án lưu các cuộc trò chuyện; bấm vào để làm tiếp từ đúng chỗ dở.
- Nếu thiết kế bị lỗi hiển thị, nói rõ **vùng nào, trông thế nào** ("chữ tràn khỏi khung ở khối thứ hai") thay vì "sửa lại cho đẹp".
