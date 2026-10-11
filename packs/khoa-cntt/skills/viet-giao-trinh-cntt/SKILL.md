---
name: viet-giao-trinh-cntt
description: Viết giáo trình môn CNTT thành tệp Word theo chuẩn đại học Việt Nam: chương, bài, mục, ví dụ, bài tập, lab, câu hỏi ôn tập.
---
# Viết giáo trình CNTT (Word)

Giáo trình cho sinh viên năm 2–3 ngành CNTT (đã biết lập trình cơ bản, chưa chuyên sâu chủ đề). Triết lý: dẫn sinh viên từ khái niệm → hiểu → làm được → ứng dụng được. Mỗi phần viết ra tự hỏi: "Đọc xong, sinh viên làm được gì?"

Tệp kèm: `bang-dac-biet.md` (các bảng đặc biệt mà hệ thống học liệu nhận dạng, cách viết bằng Markdown và giới hạn).

## Bước 1. Thu thập thông tin

Cần biết: tên môn (và số tín chỉ nếu có); phạm vi (cả giáo trình hay một chương/bài/mục); danh mục chương/bài nếu người dùng có; yêu cầu riêng (ngôn ngữ lập trình ưu tiên, độ sâu, ví dụ theo ngành). Thiếu thì hỏi bằng ask_user MỘT lần (tối đa 3 câu, mặc định đề xuất ở lựa chọn đầu). Cả giáo trình hoặc một chương: trình outline đề xuất (chương → bài) trong tin nhắn, rồi gộp câu xác nhận outline vào đúng lần ask_user đó; chờ trả lời mới viết.

## Bước 2. Cấu trúc và đánh số

```
Giáo trình: [Tên môn]
  Trang bìa · Mục lục · Lời mở đầu
  Chương: Giới thiệu chương
    1.1 Bài  → 1.1.1 Mục … → Bài tập cuối bài
    1.2 …
    Câu hỏi ôn tập chương (+ đáp án, giải thích ngắn)
  … 
  Tài liệu tham khảo
```

- Tiêu đề cấp 1 (Chương): chỉ ghi TÊN chương, KHÔNG ghi chữ "Chương" hay số. Đúng: "Giới thiệu về Dữ liệu Phi Cấu trúc". Sai: "Chương 1: …".
- Cấp 2 (Bài): số + tên, "1.1 Khái niệm cơ bản". Cấp 3 (Mục): ba cấp số, "1.1.1 Định nghĩa dữ liệu phi cấu trúc".
- Trong Markdown: "#", "##", "###" tương ứng; để Word dựng được mục lục tự động.

## Bước 3. Mỗi Bài có 4 thành phần, đúng thứ tự

**3.1 Lý thuyết + ví dụ minh hoạ.** Mở bằng câu hỏi động lực hoặc tình huống thực tế. Định nghĩa rõ, ngắn, không chép từ Wikipedia. Giải thích bằng ngôn ngữ tự nhiên trước, công thức/ký hiệu sau. Sơ đồ bằng mô tả hoặc ASCII nếu không có hình. Mỗi khái niệm mới có ít nhất 1 ví dụ gần gũi với sinh viên Việt Nam. Mẫu ví dụ:

```
📌 Ví dụ [số]: [Tiêu đề ngắn]
Bài toán: [tình huống thực tế]
Giải: [từng bước]
Nhận xét: [điều đáng chú ý, cạm bẫy thường gặp]
```

**3.2 Bài tập / case study.** Luôn đủ 3 cấp: ⭐ cơ bản (áp dụng trực tiếp), ⭐⭐ trung bình (kết hợp nhiều khái niệm, có gợi ý), ⭐⭐⭐ nâng cao (case study thực tế, mở). Mẫu: "BÀI TẬP [số] (⭐/⭐⭐/⭐⭐⭐)", đề bài rõ đủ dữ liệu, "Gợi ý:" cho bài từ ⭐⭐ trở lên. Mỗi chương nên có 1 case study từ ngành thực (thương mại điện tử, y tế, tài chính Việt Nam…): mô tả vấn đề thực → sinh viên phân tích → đề xuất giải pháp (không có đáp án duy nhất).

**3.3 Code / Lab.** Code phải CHẠY ĐƯỢC; chú thích tiếng Việt cho các bước quan trọng; đi từ đoạn đơn giản nhất, mở rộng dần; nêu lỗi thường gặp và cách sửa. Mẫu:

```
🔬 LAB [số]: [Tiêu đề]
Mục tiêu: …
Chuẩn bị: môi trường (Python 3.x/Java/…), thư viện, lệnh cài (pip install …)
Hướng dẫn từng bước: Bước 1 … Bước 2 …   (mã có chú thích)
Kết quả mong đợi: …
Mở rộng (tuỳ chọn): thử thách cho sinh viên khá
```

**3.4 Câu hỏi ôn tập (cuối mỗi chương, tối thiểu):** 5–8 trắc nghiệm A/B/C/D (chú trọng hiểu khái niệm, không chỉ nhớ); 3–5 tự luận ngắn (giải thích, so sánh, phân tích); 1–2 tự luận dài hoặc bài toán tổng hợp. Phương án nhiễu hợp lý (là lỗi sinh viên hay mắc), không dùng "tất cả đều đúng"/"không có đáp án nào"; vị trí đáp án đúng phân bố đều giữa A–D. Đáp án đặt cuối chương, có giải thích ngắn.

## Bước 4. Văn phong và định dạng

- Rõ ràng hơn hoa mỹ: câu ngắn, chủ ngữ vị ngữ rõ. Thuật ngữ tiếng Anh kèm giải thích tiếng Việt lần đầu: "Mô hình không gian vectơ (Vector Space Model — VSM)". Nhất quán: một khái niệm một tên xuyên suốt. Giả định sinh viên biết Python cơ bản và lập trình hướng đối tượng, chưa biết chủ đề môn.
- Đoạn văn liền mạch; bullet để liệt kê điểm quan trọng, mỗi danh sách tối đa 10 mục, khoảng 1 danh sách mỗi trang, không lạm dụng.
- Bảng thường dùng để so sánh, tóm tắt; hàng tiêu đề in đậm, căn đều.
- Thuật ngữ quan trọng, ghi chú, mã chạy được, bài tập tự luận, bài nộp tệp, trắc nghiệm: dùng ĐÚNG các bảng đặc biệt trong `bang-dac-biet.md` (hệ thống học liệu nhận dạng chúng theo chữ ở cột phải), áp dụng nhất quán toàn giáo trình.

## Bước 5. Tạo tệp Word

1. `todo_write` lập danh sách chương/bài; làm lần lượt, đánh dấu xong từng phần.
2. Gói gọn mỗi lần gọi công cụ khoảng 2.000–2.500 ký tự: `create_docx` (style formal, title là tên giáo trình, toc true) với phần đầu (trang bìa, Lời mở đầu), rồi gọi tiếp với CÙNG path và append=true cho từng thành phần. MỘT giáo trình = MỘT tệp; quá dài thì tách theo chương và nói rõ.
3. Trang bìa: tiêu đề và dòng phụ (môn học, đối tượng, năm); ngắt trang bằng <<<pagebreak>>>.
4. Xong, `read_document` đọc lại từng đoạn (offset) hoặc `doc_stats` để xem dàn ý: kiểm thứ tự tiêu đề, số bài, bảng đặc biệt. Báo cáo: tên tệp, số chương/bài, và những gì CHƯA làm được.

## Giới hạn cần nói thật

- Tab Work không chạy được mã: code trong lab chỉ được soát cú pháp bằng mắt; ghi rõ "chưa chạy thử" trong báo cáo, đừng khẳng định đã chạy.
- Mã nguồn đặt trong khối code (nền xám) chứ không trong ô bảng Courier New nhiều dòng như quy định gốc; bảng "oj" cho mã chạy được cần người dùng chuyển tay sang đúng bảng khi nhập học liệu (xem `bang-dac-biet.md`).

## Tự kiểm trước khi giao

Nội dung:
- [ ] Mỗi bài đủ 4 thành phần (lý thuyết, bài tập, code/lab, câu hỏi)?
- [ ] Code trong lab chạy được (đã soát cú pháp)?
- [ ] Trắc nghiệm đánh dấu đáp án đúng bằng ✓ ở cột 2?
- [ ] Thuật ngữ tiếng Anh có giải thích tiếng Việt lần đầu?
- [ ] Bài tập có đủ 3 cấp?

Định dạng:
- [ ] Cấp 1 là tên chương (không chữ "Chương"); cấp 2 kiểu "1.1"; cấp 3 kiểu "1.1.1"; mục lục tự động hoạt động?
- [ ] Bảng đặc biệt đúng loại: thuật ngữ (term), ghi chú (note), tự luận, nộp file (file), trắc nghiệm?
- [ ] Mã nguồn có khối riêng, chạy được có ghi ngôn ngữ oj?
- [ ] Bullet không quá 10 mục, khoảng 1 danh sách mỗi trang?
