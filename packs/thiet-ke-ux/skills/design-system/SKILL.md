---
name: design-system
description: Rà soát, mô tả tài liệu hoặc mở rộng hệ thống thiết kế (token, thành phần, mẫu giao diện) từ các tệp CSS/HTML trong dự án. Dùng khi cần kiểm tra đặt tên không nhất quán, giá trị gõ cứng, viết tài liệu cho một thành phần, hoặc thiết kế thêm một thành phần phù hợp hệ thống hiện có.
---
# Hệ thống thiết kế

Ba chế độ: **audit** (rà soát), **document** (tài liệu hoá một thành phần), **extend** (thêm thành phần/mẫu mới). Người dùng không nói rõ thì suy từ yêu cầu; không suy được thì hỏi một lần.

## Một hệ thống gồm
- **Token**: màu (thương hiệu, ngữ nghĩa, trung tính), chữ (thang cỡ, độ đậm, dòng cách), khoảng cách, viền và bo góc, đổ bóng, chuyển động.
- **Thành phần**: có biến thể (chính, phụ, ghost), trạng thái (mặc định, hover, focus, active, disabled, loading, lỗi), kích cỡ, hành vi, tiếp cận.
- **Mẫu**: biểu mẫu, điều hướng, hiển thị dữ liệu (bảng, thẻ, danh sách), phản hồi (thông báo, hộp thoại).

Nguyên tắc: nhất quán hơn sáng tạo; linh hoạt trong ràng buộc; cái gì không được ghi thì coi như không có; đổi lớn phải có đường chuyển.

## Audit (kiểm bằng mã)
Đọc mọi tệp .css và .html (glob), rồi:
1. **Đặt tên**: kiểu class/biến trộn lẫn (kebab, BEM, camelCase); tiền tố biến thiếu thống nhất (`--color-*`, `--space-*`); tên đồng nghĩa (btn và button, card và box).
2. **Phủ token**: với từng nhóm (màu, khoảng cách, cỡ chữ, họ chữ, bo góc, đổ bóng) đếm số biến đã khai báo và số giá trị gõ cứng (grep), kèm dòng ví dụ.
3. **Đủ thành phần**: mỗi thành phần chấm /10: trạng thái hover, focus-visible, active, disabled (mỗi cái 1 điểm), có biến thể (2), dùng token không gõ cứng (2), có chú thích hoặc mô tả (2).
4. **Điểm hệ thống /100** = 40 × tỉ lệ giá trị dùng token + 20 × tỉ lệ tên theo một quy ước + 40 × (trung bình điểm thành phần / 10). Tính bằng calc và ghi công thức.

```
## Rà soát hệ thống thiết kế
**Thành phần xét:** [X] | **Vấn đề:** [X] | **Điểm:** [X/100]
### Nhất quán đặt tên
| Vấn đề | Thành phần/dòng | Đề xuất chuẩn |
### Phủ token
| Nhóm | Đã khai báo | Gõ cứng (số lần, ví dụ dòng) |
### Đủ thành phần
| Thành phần | Trạng thái | Biến thể | Token | Tài liệu | Điểm |
### Việc ưu tiên
1. ... 2. ... 3. ...
```

## Document (một thành phần)
Lấy mã thật của thành phần từ tệp (read_file) để làm ví dụ. Mẫu: mô tả và khi nào dùng; biến thể (bảng: biến thể | dùng khi); thuộc tính hoặc class bổ nghĩa (tên | kiểu | mặc định | mô tả); trạng thái (bảng: trạng thái | giao diện | hành vi); tiếp cận (vai trò, phím, đọc thành); nên và không nên (bảng); ví dụ mã HTML+CSS. Trạng thái không có trong mã ghi "[cần bổ sung]". Lưu thành Word mới (create_docx).

## Extend (thành phần/mẫu mới)
1. Vấn đề: nhu cầu người dùng nào chưa được đáp ứng.
2. Mẫu hiện có gần nhất: giống gì, thiếu gì (lý do không dùng lại được).
3. Thiết kế đề xuất: thuộc tính, biến thể, trạng thái, token dùng lại (chỉ thêm token mới khi buộc phải, nêu lý do), tiếp cận.
4. Câu hỏi mở cần người thiết kế quyết.
Ở tab Design, tạo thêm tệp HTML minh hoạ mới (mọi biến thể và trạng thái cạnh nhau, dùng đúng token hiện có; tuân thủ luật tệp tĩnh, không script, không tài nguyên ngoài).

Gợi ý: bắt đầu bằng audit để biết mình đang ở đâu; ghi tài liệu ngay khi dựng; phủ 80% thành phần ở mức vừa đủ tốt hơn 100% của vài thành phần. Chỉ sửa tệp khi được yêu cầu.
