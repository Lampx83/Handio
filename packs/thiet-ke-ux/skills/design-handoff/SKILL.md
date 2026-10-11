---
name: design-handoff
description: Lập đặc tả bàn giao thiết kế cho lập trình viên từ tệp HTML/SVG: bố cục, token (màu, chữ, khoảng cách), thành phần và trạng thái, responsive, nội dung biên, tiếp cận, chuyển động. Dùng khi thiết kế xong cần giao cho dev, "viết spec", "bàn giao", "trích token".
---
# Đặc tả bàn giao thiết kế

Mục tiêu: lập trình viên đọc xong không phải đoán. Cái gì thiết kế không nói thì ghi "[cần bổ sung]" để người thiết kế quyết, không tự chế.

## Nguyên tắc
1. **Không giả định**: điều không được chỉ rõ thì dev sẽ tự đoán, nên phải ghi.
2. **Dùng token, không dùng giá trị trần**: viết `spacing-md` kèm giá trị, không chỉ "16px".
3. **Nêu mọi trạng thái**: mặc định, hover, focus, active, disabled, loading, lỗi, rỗng.
4. **Nói vì sao**: "cột xếp thành một cột trên điện thoại vì phần lớn người dùng cầm một tay" giúp dev quyết đúng khi gặp ca không có trong spec.

## Cách làm (trích từ mã, có số dòng)
1. Đọc tệp (nhiều tệp thì glob). Hỏi một lần nếu chưa biết công nghệ nhận bàn giao (HTML thuần, React, Tailwind…); đã rõ thì thôi.
2. **Token**: lấy biến có sẵn trong :root (grep `--`). Giá trị gõ cứng (hex, cỡ chữ, khoảng cách, bo góc, đổ bóng) xuất hiện ≥ 2 lần thì đề xuất tên token và đánh dấu "đề xuất"; dùng một lần thì ghi riêng là "giá trị đơn lẻ". Đếm số lần dùng bằng grep.
3. **Thành phần**: gom phần tử lặp theo class hoặc thẻ (nút, thẻ, ô nhập, thanh điều hướng, huy hiệu…). Mỗi thành phần: biến thể, thuộc tính (class bổ nghĩa), trạng thái đã có trong CSS (:hover, :focus-visible, :active, :disabled) và trạng thái còn thiếu.
4. **Responsive**: liệt kê các @media (điểm ngắt, thay đổi); không có thì ghi rõ. Thiết kế khổ cố định (A4, 1080×1080, slide 1280×720) thì ghi khổ và lề in.
5. **Nội dung**: giới hạn ký tự đề xuất (suy từ chữ mẫu), cách cắt chữ (text-overflow hay xuống dòng), trạng thái rỗng/đang tải/lỗi; chữ tiếng Việt dài hơn thì có vỡ bố cục không.
6. **Chuyển động**: transition/animation có trong CSS (thuộc tính, thời lượng, easing); prefers-reduced-motion có hay không. Thiết kế tĩnh không có script nên mọi hành vi bấm/vuốt khác ghi "[cần bổ sung]".
7. **Tiếp cận**: thứ tự focus, nhãn, vai trò, phím tương tác; điểm chưa đạt tham chiếu `accessibility-review`.

## Mẫu đầu ra (Word, create_docx style modern; dài thì thêm phần bằng append=true)
```
# Đặc tả bàn giao: [tên màn hình/tính năng]
## Tổng quan
[Màn hình làm gì, ngữ cảnh người dùng]
## Bố cục
[Lưới, vùng chính, hành vi theo màn hình]
## Token sử dụng
| Token | Giá trị | Dùng cho | Nguồn (có sẵn / đề xuất) |
| `color-primary` | #... | nút chính, liên kết | dòng N |
| `spacing-md` | ...px | giữa các phần | đề xuất |
| `font-heading-lg` | cỡ/đậm/họ chữ | tiêu đề trang | |
## Thành phần
| Thành phần | Biến thể | Thuộc tính | Ghi chú |
## Trạng thái và tương tác
| Phần tử | Trạng thái | Hành vi |
## Responsive
| Điểm ngắt | Thay đổi |
## Trường hợp biên
- Rỗng / Chữ dài / Đang tải / Lỗi / Thiếu dữ liệu
## Chuyển động
| Phần tử | Kích hoạt | Hiệu ứng | Thời lượng | Easing |
## Tiếp cận
- Thứ tự focus, nhãn cần có, phím tương tác
## Còn thiếu cần người thiết kế quyết
- [cần bổ sung] ...
```
Cuối tài liệu thêm khối CSS `:root` với các token (có sẵn và đề xuất) để dev dán dùng. Lưu thành tệp mới, đọc lại bằng read_document để kiểm tra, rồi báo tên tệp.
