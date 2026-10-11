---
name: accessibility-review
description: Kiểm tra tiếp cận WCAG 2.1 AA cho tệp HTML/SVG hoặc ảnh chụp: tương phản (tính từ mã màu), nhãn, alt, thứ tự tiêu đề, bàn phím, vùng chạm, ngôn ngữ. Dùng khi người dùng hỏi "có tiếp cận được không", kiểm tra a11y, WCAG, tương phản màu, hoặc trước khi bàn giao.
---
# Kiểm tra tiếp cận (WCAG 2.1 AA)

## Cần có
Tệp .html/.svg (hoặc nhiều tệp), hay ảnh chụp/mô tả. Mức chuẩn: WCAG 2.1 AA. Chỉ hỏi khi không rõ đối tượng. Công cụ tự động bắt được khoảng 30% vấn đề; phần còn lại cần người, nên báo cáo phải nói rõ cái gì đã kiểm bằng mã, cái gì phải kiểm tay.

## Cách làm
1. Đọc tệp (read_file; grep để lấy số dòng cho từng loại thẻ). Với ảnh chụp: read_image, và ghi rõ không đo được màu/kích thước chính xác.
2. Kiểm từng tiêu chí trong bảng dưới, ghi số dòng. Tính tương phản cho mọi cặp chữ/nền chính, kể cả liên kết, nút, trạng thái hover/focus, chữ nhỏ, placeholder.
3. Lập báo cáo theo mẫu, xếp theo mức. Mức: **Nghiêm trọng** = chặn một nhóm người hoàn thành việc (không đọc được chữ chính, không thao tác được bằng bàn phím); **Lớn** = khó đáng kể nhưng có đường vòng; **Nhẹ** = chưa chuẩn, ảnh hưởng nhỏ.

## Tính tương phản (bắt buộc dùng calc, locale "en")
Với mỗi cặp: màu chữ lấy từ CSS (kế thừa từ phần tử cha; biến `--x` thì tra giá trị trong :root), nền là nền của phần tử hoặc cha gần nhất.
1. Đổi #RRGGBB thành ba số 0–255 (cặp hex = 16 × chữ số đầu + chữ số sau; #abc là #aabbcc).
2. Mỗi kênh c: s = c/255. Nếu s ≤ 0.03928 thì lin = s/12.92, ngược lại lin = ((s+0.055)/1.055)^2.4. Ví dụ c = 153: calc `((153/255+0.055)/1.055)^2.4`.
3. L = 0.2126×R + 0.7152×G + 0.0722×B (R, G, B là lin).
4. Tỉ lệ = (L sáng + 0.05) / (L tối + 0.05). So với ngưỡng bằng giá trị chưa làm tròn (4.49 là không đạt); chỉ làm tròn khi trình bày.

Ngưỡng: chữ thường ≥ 4,5:1; chữ lớn (≥ 24px, hoặc ≥ 18,66px và đậm) ≥ 3:1; thành phần giao diện và đồ họa (viền ô nhập, biểu tượng) ≥ 3:1. Ví dụ: #999999 trên nền trắng ra khoảng 2,85:1, không đạt.
Không tính được bằng mã thì ghi "cần kiểm tay": chữ trên ảnh hoặc gradient, màu có độ trong suốt (rgba, opacity), màu đặt bằng script.

## Tiêu chí kiểm bằng mã
**Dễ nhận biết**
- 1.1.1 `img` thiếu alt (grep); ảnh trang trí alt=""; SVG có nghĩa cần `title` hoặc aria-label kèm role="img"; biểu tượng emoji/ký hiệu dùng thay chữ cần chữ thay thế.
- 1.3.1 đúng một h1, tiêu đề không nhảy cấp (grep h1–h6); có header/nav/main/footer; danh sách dùng ul/ol; bảng có th; ô nhập có label for.
- 1.4.1 màu không là cách duy nhất (liên kết trong đoạn chữ có gạch chân; lỗi/thành công có chữ hoặc biểu tượng).
- 1.4.3 và 1.4.11 tương phản, theo mục trên.
- 1.4.4 và 1.4.10 phóng 200% và 320px: cỡ chữ theo rem/em, không user-scalable=no hay maximum-scale=1, có @media, không phần tử rộng cố định > 320px, không overflow:hidden cắt chữ.
- 1.4.12 line-height ≥ 1.5 cho đoạn chữ; không đặt height cố định cho khối chứa chữ.

**Thao tác được**
- 2.1.1 phần tử bấm được là `a` có href hoặc `button`; không dùng div/span làm nút; không `a` thiếu href.
- 2.4.2 có `title` mô tả. 2.4.3 thứ tự DOM trùng thứ tự đọc; không tabindex > 0; CSS order/position không đảo vị trí so với DOM. 2.4.4 liên kết không là "bấm vào đây", "xem thêm" trơn.
- 2.4.7 có :focus-visible (hoặc :focus) rõ; gắn cờ `outline: none` hoặc `outline: 0` mà không có kiểu thay thế.
- 2.2.2 và 2.3.1 animation lặp vô hạn > 5 giây cần cách dừng; có prefers-reduced-motion; không nhấp nháy > 3 lần/giây.
- 2.5.5 vùng chạm ≥ 44×44 (tính từ width/height/padding/line-height). Lưu ý: đây là mức AAA của 2.1 và là khuyến nghị; mức AA của WCAG 2.2 là 24×24.

**Dễ hiểu**
- 3.1.1 lang="vi" trên html; đoạn tiếng khác có lang riêng (3.1.2).
- 3.3.1 và 3.3.2 ô nhập có nhãn hiển thị (placeholder không thay nhãn); trường bắt buộc nói bằng chữ; có chỗ cho thông báo lỗi nêu lỗi gì và sửa thế nào.

**Vững chắc**
- 4.1.2 nút/liên kết chỉ có biểu tượng cần aria-label hoặc chữ ẩn; không aria-hidden trên phần tử nhận focus; không role="button" thiếu tabindex.
- 4.1.1 thẻ đóng mở đúng, id không trùng (grep id=).

## Chỉ kiểm tay được
Trình đọc màn hình thật (VoiceOver, NVDA, Narrator); duyệt chỉ bằng bàn phím trên trang chạy thật; phóng 200% và 400%; chất lượng nội dung alt; hành vi động (menu, hộp thoại, bẫy bàn phím); chữ trên ảnh. Luôn liệt kê các mục này ở cuối báo cáo.

## Mẫu báo cáo
```
## Kiểm tra tiếp cận: [tên tệp]
**Chuẩn:** WCAG 2.1 AA | **Ngày:** [ngày]
### Tóm tắt
Phát hiện: [X] | Nghiêm trọng: [X] | Lớn: [X] | Nhẹ: [X]
### Phát hiện (nhóm Dễ nhận biết / Thao tác được / Dễ hiểu / Vững chắc)
| # | Vấn đề | Tiêu chí | Dòng | Mức | Cách sửa |
### Tương phản
| Phần tử | Chữ | Nền | Tỉ lệ | Cần | Đạt? |
### Thứ tự Tab (suy từ DOM)
| # | Phần tử | Tên đọc ra | Phím mặc định | Ghi chú |
### Trình đọc màn hình (suy từ mã)
| Phần tử | Đọc thành | Vấn đề |
### Ưu tiên sửa
1. [Nghiêm trọng] — ảnh hưởng ai, chặn việc gì
2. [Lớn] ... 3. [Nhẹ] ...
### Cần kiểm tay
```
Thứ tự Tab và "đọc thành" chỉ suy từ thẻ và thuộc tính (ví dụ `button` "Đăng ký" đọc là "Đăng ký, nút"); hành vi tùy biến ghi "cần kiểm tay". Chỉ sửa tệp khi được yêu cầu (edit_file, bản -v2).
