# Bảng đặc biệt của giáo trình (hệ thống học liệu nhận dạng theo chữ ở cột phải)

Mọi bảng là bảng 2 cột. Trong Markdown của `create_docx`, dòng ĐẦU của bảng chính là hàng 1 của bảng gốc; công cụ in đậm và tô nền dòng đầu mọi bảng (chấp nhận được: hệ thống chỉ đọc nội dung ô). Ô trống để trống thật (không gõ chữ).

| Loại | Dùng khi | Ô nhận dạng |
|---|---|---|
| Thuật ngữ | giới thiệu thuật ngữ kỹ thuật quan trọng | "term" ở hàng 1 cột 2; tên thuật ngữ ở hàng 2 cột 2 |
| Ghi chú | cảnh báo, lưu ý | "note" ở hàng 1 cột 2 |
| Tự luận | bài tập sinh viên gõ câu trả lời | cả 3 ô còn lại trống |
| Nộp file | sinh viên nộp tệp | "file" ở hàng 1 cột 2 |
| Trắc nghiệm | câu hỏi + 4 phương án | "✓" ở cột 2 của dòng phương án đúng |
| Mã chạy được | mã cần nộp/chạy | "oj" + tên ngôn ngữ ở cột phải (xem Giới hạn) |

## Cách viết từng loại (Markdown)

**Thuật ngữ**: giải thích bằng tiếng Việt chiếm ô lớn bên trái.
```
| Giải thích thuật ngữ bằng tiếng Việt… | term |
|---|---|
| | Vector Space Model |
```

**Ghi chú**:
```
| Nội dung ghi chú hoặc cảnh báo… | note |
|---|---|
| | |
```

**Bài tập tự luận**: yêu cầu in đậm ở ô trên trái, vùng còn lại để sinh viên viết.
```
| **Yêu cầu bài tập…** | |
|---|---|
| | |
```

**Bài tập nộp file**:
```
| **Yêu cầu nộp file…** | file |
|---|---|
| | |
```

**Trắc nghiệm**: hàng đầu là câu hỏi (in đậm), mỗi phương án một dòng, dấu ✓ chỉ ở dòng phương án đúng.
```
| **Câu 1. Nội dung câu hỏi?** | |
|---|---|
| A. Phương án A | |
| B. Phương án B | ✓ |
| C. Phương án C | |
| D. Phương án D | |
```

## Mã nguồn và giới hạn

Quy định gốc: mọi mã đặt trong bảng, phông Courier New, nền xám nhạt.
- Mã chỉ để đọc: bảng 1 hàng × 1 cột.
- Mã chạy được: bảng 1 hàng × 2 cột, mã bên trái; bên phải ghi "oj" rồi tên ngôn ngữ (java, python, cpp…). Có dữ liệu mẫu: thêm hàng 2, cột trái là input mẫu, cột phải là output mong đợi.
- Mã HTML/CSS/JS chạy trên trình duyệt: tách thành 3 bảng riêng, ngôn ngữ lần lượt html, css, js.

`create_docx` KHÔNG tạo được ô bảng chứa mã nhiều dòng. Cách làm thay thế, nói rõ với người dùng:
1. Đặt mã trong khối code (nền xám, phông đơn cách), mỗi khối một tệp/đoạn mã.
2. Mã chạy được: ngay dưới khối code ghi một dòng "Mã chạy được (oj): python" (hoặc java, cpp…); nếu có dữ liệu mẫu, thêm bảng 2 cột "Input mẫu | Output mong đợi".
3. Người dùng chuyển các đoạn đó sang đúng bảng oj/mã trong tệp khi nhập vào hệ thống học liệu.

## Ví dụ một bài thu nhỏ (Markdown)

```
## 1.2 Biểu diễn văn bản bằng vectơ

### 1.2.1 Mô hình không gian vectơ
Khi tìm kiếm tài liệu, làm sao máy so sánh được hai đoạn văn?
…

| Mô hình biểu diễn văn bản dưới dạng vectơ các từ, mỗi chiều là một từ… | term |
|---|---|
| | Vector Space Model |

📌 Ví dụ 1: So sánh hai câu
…

BÀI TẬP 1 (⭐)
| **Tính độ tương đồng cosine giữa hai vectơ cho sẵn.** | |
|---|---|
| | |
```
