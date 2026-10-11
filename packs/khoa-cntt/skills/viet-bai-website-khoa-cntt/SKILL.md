---
name: viet-bai-website-khoa-cntt
description: Soạn bài đăng website Khoa CNTT gồm Title, Description, Body, văn phong học thuật ngôi thứ ba, tiêu đề có emoji, bảng khi cần; kèm gói dữ liệu đăng (slug, SEO).
---
# Bài đăng website Khoa CNTT

Biến thông tin thô (sự kiện, chương trình đào tạo, chủ đề công nghệ) thành bài đăng để dán vào trình soạn thảo của website Khoa (CKEditor). Handio KHÔNG đăng bài lên website: chỉ soạn sẵn nội dung và dữ liệu để người dùng dán.

Tệp kèm: `mau-bai-viet.md` (ba bài mẫu), `dong-goi-dang-bai.md` (HTML, slug, SEO, bản tiếng Anh khi cần).

## Quy trình

1. Nhận diện loại bài: tin tức sự kiện (hội thảo, trao giải, thông báo, workshop: trực diện, gọn); giới thiệu chương trình/tuyển sinh (rõ thông tin thực tế); bài chuyên môn/học thuật (phân tích, có luận điểm).
2. Thiếu thông tin thì hỏi bằng ask_user MỘT lần, tối đa 3 câu (thời gian, địa điểm, đối tượng, diễn giả, liên kết đăng ký, chỉ tiêu, học phí…). Không bịa thông tin; chỗ thiếu ghi "[cần bổ sung]". Có thể dành một câu (chọn nhiều) hỏi có cần thêm bản HTML hoặc bản tiếng Anh không; mặc định không.
3. Viết đúng 3 phần dưới đây. Đọc phần tương ứng loại bài trong `mau-bai-viet.md`.
4. Tự kiểm bằng danh sách cuối tệp; yêu cầu sửa thì viết lại toàn bộ bài.
5. Lưu thành tệp .md (tên gợi ý "bai-website-[tên-ngắn].md") VÀ trả lời trong khung trò chuyện đúng 3 phần để người dùng chọn, sao chép, dán. Cuối tệp thêm khối "Dữ liệu đăng" (slug, danh mục, thẻ, SEO) theo `dong-goi-dang-bai.md`. Khi được gọi từ lập hồ sơ hoạt động chỉ cần lưu tệp, không cần khối đó.

## Cấu trúc bắt buộc: 3 phần, mỗi phần một tiêu đề cấp 1 (#)

**# Title**: một dòng chữ thuần, 10–15 từ, không emoji; cụ thể, không giật tít; ưu tiên "Sự kiện + chủ thể + điểm nhấn".

**# Description**: chữ thuần, TỐI ĐA 200 ký tự (tính cả dấu cách); nói đủ sự kiện gì, đối tượng nào, điểm đáng chú ý; không emoji; không lặp nguyên văn câu mở bài.

**# Body**: markdown thường. KHÔNG bọc trong khối code (khối mở bằng ba dấu huyền, dù ghi markdown hay html): bọc vào thì khi người dùng sao chép sẽ ra mã thô và hỏng định dạng khi dán.
- Tiêu đề phần: "## 📅 Tiêu đề phần": ĐÚNG MỘT emoji, ngay sau "## " và trước chữ.
- Đoạn văn cách nhau dòng trống; in đậm "**…**", nghiêng "*…*"; liệt kê "- " hoặc "1. "; liên kết "[chữ](URL)"; bảng markdown chuẩn.
- Trong đoạn văn và gạch đầu dòng KHÔNG emoji; không emoji mặt cười, trái tim, cảm xúc.

## Cấu trúc Body theo loại bài

- **Tin tức sự kiện**: đoạn mở 2–3 câu (sự kiện gì, khi nào, ai tổ chức) → "## " Thông tin sự kiện (thời gian, địa điểm, hình thức, đối tượng; bullet hoặc bảng) → "## " Nội dung chính (hoạt động, diễn giả, chủ đề) → "## " Đăng ký/Liên hệ nếu có (liên kết, hạn, đầu mối).
- **Chương trình/tuyển sinh**: đoạn mở (chương trình gì, bậc nào) → Mục tiêu đào tạo → Thông tin tuyển sinh (bảng: chỉ tiêu, tổ hợp xét tuyển, học phí) → Cơ hội nghề nghiệp → Liên hệ tư vấn.
- **Chuyên môn/học thuật**: đoạn mở đặt vấn đề, bối cảnh → mỗi luận điểm một "## " → Kết luận hoặc Hướng phát triển.

## Văn phong

- Trang trọng, học thuật; NGÔI THỨ BA. Không "chúng ta", "bạn", "mình", "các bạn", "chúng tôi".
- Câu ngắn, trung bình 15–25 từ; tránh câu ghép lê thê.
- Thuật ngữ tiếng Việt chuẩn ngành CNTT; thuật ngữ tiếng Anh chưa phổ biến mở ngoặc giải thích lần đầu, ví dụ "học máy (machine learning)". Từ thông dụng dùng thẳng: CNTT, AI, IoT, ML; chữ viết tắt lạ phải viết đầy đủ lần đầu.
- Không viết hoa toàn bộ để nhấn mạnh; dùng in đậm.
- Nêu sự kiện và để thông tin tự nói lên giá trị, không tâng bốc.

## Sáo ngữ và lỗi cần tránh tuyệt đối

"trong thời đại số ngày nay"; "hãy cùng khám phá"; "không thể phủ nhận rằng"; "đóng vai trò quan trọng"; "ngày càng trở nên"; "chúng tôi tự hào"; "vô cùng vinh dự"; câu kết kiểu "hứa hẹn sẽ…", "mở ra tương lai…"; câu hỏi tu từ ("Bạn có biết rằng…?"); dấu ba chấm tạo kịch tính; hashtag; kêu gọi like/share.

## Emoji gợi ý cho tiêu đề phần

Thời gian 📅 · Địa điểm 📍 · Đối tượng tham dự 👥 · Mục tiêu 🎯 · Số liệu, bảng 📊 · Nghề nghiệp 💼 · Đăng ký 📝 · Liên hệ 📞 · Thành tích, giải thưởng 🏆 · Nghiên cứu 🔬 · Ý tưởng, công nghệ 💡 · Hợp tác 🤝 · Đào tạo 📚.

## Bảng

Dùng khi có: lịch trình (thời gian, hoạt động); chỉ tiêu tuyển sinh (ngành, chỉ tiêu, tổ hợp); so sánh chương trình; danh sách diễn giả (tên, đơn vị, chủ đề). Gọn, không quá 5 cột.

## Độ dài

Body mặc định 300–600 từ (hoặc theo yêu cầu); không độn chữ.

**Ngoại lệ, bài chuyên môn/kiến thức kỹ thuật** (chủ đề là công nghệ, thuật toán, framework, công cụ, ngôn ngữ lập trình, phương pháp kỹ thuật như RAG, LLM, Docker, Git, ML pipeline): 800–1500 từ và BẮT BUỘC có: hướng dẫn thực hành từng bước (không dừng ở lý thuyết); ví dụ mã cụ thể có chú thích; bài tập hoặc câu hỏi ôn tập gợi ý ở cuối (ít nhất 3 ý); giải thích từ cơ bản cho người mới. Dưới 800 từ thì viết lại.

## Tự kiểm trước khi gửi

1. Title không quá 15 từ.
2. Description không quá 200 ký tự (đếm cả dấu cách; viết ngắn để chừa biên). Cần chắc chắn thì lưu bài thành tệp rồi `doc_stats` để xem số từ và ký tự.
3. Không xưng "chúng ta/bạn/mình/chúng tôi".
4. Không sáo ngữ trong danh sách trên.
5. Mỗi "## " có đúng một emoji đầu dòng.
6. Body KHÔNG nằm trong khối code.
7. Bảng không quá 5 cột.
8. Body trong khoảng độ dài quy định (trừ khi người dùng yêu cầu khác).
9. Không có thông tin bịa; chỗ thiếu đã ghi "[cần bổ sung]".
