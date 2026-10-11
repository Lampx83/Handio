---
name: ke-hoach-du-toan-cntt
description: Lập bộ hồ sơ một hoạt động của Khoa CNTT (Trường Công nghệ, ĐHKTQD): kế hoạch, dự toán, email, bài website, thư mục chứng từ.
---
# Hồ sơ hoạt động của Khoa CNTT

Từ một mô tả ngắn của lãnh đạo Khoa, lập ĐỦ 5 thứ trong MỘT thư mục, sẵn sàng để duyệt:

```
[Mã]. [Tên ngắn] [Năm]/
  [Mã]_K.CNTT_KH_[Tên_ngắn]_[Năm].docx         Kế hoạch
  [Mã]_K.CNTT_Du_toan_[Tên_ngắn]_[Năm].xlsx    Dự toán
  Email gửi giảng viên.docx
  Bai dang website.md
  Chứng từ/                                     rỗng
```

Tệp kèm: `the-thuc-ke-hoach.md` (thể thức Kế hoạch), `dinh-dang-du-toan.md` (cấu trúc Dự toán), `mau-nguoi-ky.md` và `mau-ban-to-chuc.csv` (mẫu dữ liệu GIẢ để người dùng chép vào thư mục `du-lieu/` của dự án rồi điền).

## Bước 1. Hiểu yêu cầu

Trích các trường dưới đây từ mô tả. Chỉ hỏi trường BẮT BUỘC còn thiếu, bằng ask_user MỘT lần, tối đa 3 câu, mỗi câu 2–4 lựa chọn (đề xuất mặc định ở lựa chọn đầu; người dùng gõ riêng ở ô Khác). Sau đó cái gì còn thiếu thì ghi "[cần bổ sung]", không đoán.

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| Tên hoạt động (đầy đủ) | có | |
| Tên ngắn (đặt tên thư mục, tệp) | không | tự rút gọn |
| Mã hoạt động | có | người dùng tự nhập (vd "A_III_3", "IV.1", "I.3"). KHÔNG tự đoán; chưa có mã thì chưa tạo thư mục/tệp |
| Cấp đơn vị | có | đúng một trong ba: Khoa CNTT / Trường CN / POHE (không có hoạt động lai) |
| Loại hoạt động | có | hội thảo, lớp bồi dưỡng, tư vấn tuyển sinh, hoạt động sinh viên, mở ngành, tọa đàm… |
| Thời gian (một buổi/nhiều buổi/chuỗi), địa điểm | có | |
| Đối tượng và số lượng | có | vd 50 SV, 30 GV, 100 khách |
| Mục đích chung (1–2 câu) | có | suy ra từ tên và loại hoạt động |
| Năm | không | mặc định năm hiện hành |
| Ngân sách dự kiến | không | thiếu thì tự đề xuất (xem Bước 5) |

## Bước 2. Người ký theo cấp đơn vị

Đọc `du-lieu/nguoi-ky.md` trong dự án (cấu trúc xem `mau-nguoi-ky.md`). Không có tệp: ghi vai trò kèm "[cần bổ sung: họ tên]", tạo sẵn `du-lieu/nguoi-ky.md` từ mẫu (để trống họ tên) và báo người dùng điền.

| Cấp | Xác nhận đơn vị (Dự toán) | Người lập dự toán |
|---|---|---|
| Khoa CNTT | Trưởng khoa CNTT | cán bộ theo tệp |
| Trường CN | Hiệu trưởng Trường Công nghệ | cán bộ theo tệp |
| POHE | Thủ trưởng Viện POHE | cán bộ theo tệp |

Bất biến, mọi cấp (theo VAI TRÒ, tên người thật lấy từ tệp):
- Trưởng ban tổ chức trong Kế hoạch luôn là Trưởng khoa CNTT.
- Chữ ký cuối Kế hoạch luôn là GIÁM ĐỐC Đại học.
- Kế toán trưởng ký Dự toán.

## Bước 3. Tạo thư mục

`make_dir` cho `[thư mục gốc theo cấp]/[Mã]. [Tên ngắn] [Năm]/Chứng từ`. Thư mục gốc theo cấp: thư mục cùng tên cấp đơn vị nếu có trong dự án, không thì ngay tại gốc dự án.
- Thư mục giữ dấu: "A_III_3. Tư vấn tuyển sinh 2026".
- Tên tệp: tiền tố là mã hoạt động + `_`; `[Tên_ngắn]` KHÔNG dấu, nối bằng `_` (bỏ dấu bằng `vn_text` action remove_diacritics). Ví dụ "I.3_K.CNTT_KH_To_chuc_toa_dam_2026.docx". Tiền tố "K.CNTT" giữ nguyên cho mọi cấp.

## Bước 4. Kế hoạch (.docx)

Làm theo `the-thuc-ke-hoach.md`. Trước khi viết, dùng `find_in_documents` tìm 1–2 kế hoạch cũ CÙNG LOẠI trong dự án (thư mục "Tham khảo" nếu có) để giữ phong cách; không có thì nói rõ là không có mẫu cũ.

## Bước 5. Dự toán (.xlsx)

Làm theo `dinh-dang-du-toan.md`. Công thức sống: Thành tiền = Số lượng × Đơn giá; tổng cộng; tiền bằng chữ gọi `vn_number_words`. Cột Ghi chú đánh mã nhóm: Nhóm 2 = chuyển khoản cho cá nhân nội bộ Khoa/Trường (cần số tài khoản cá nhân); Nhóm 3 = chuyển khoản cho nhà cung cấp ngoài đơn vị (cần thông tin nhà cung cấp).

## Bước 6. Email, bài website

**Email** (`create_docx`, style formal = Times New Roman 13, gọn 1 trang A4), lưu "Email gửi giảng viên.docx":
- Đầu tệp: dòng "To:" ghi hộp thư Khoa lấy từ `du-lieu/nguoi-ky.md` (để dán vào Outlook); thiếu thì "[cần bổ sung]".
- Tiêu đề: "[Tên hoạt động] tại [Đơn vị/Địa điểm]". KHÔNG "Thư mời", KHÔNG ngày tháng.
- Lời chào: "Kính gửi các Thầy/Cô,". KHÔNG "Quý Thầy/Cô".
- Bảng chương trình 3 cột: Thời gian | Nội dung | Địa điểm.
- Đề nghị xác nhận KHÔNG tham gia (mặc định là tham gia).
- Ký bằng `signature`: on_behalf "TM. BAN CHỦ NHIỆM KHOA", role "TRƯỞNG KHOA", name là học vị + họ tên Trưởng khoa từ tệp.
- Muốn thư nháp mở được trong Outlook: thêm `create_eml` (chỉ tạo bản nháp, không gửi).

**Bài website**: nạp skill `viet-bai-website-khoa-cntt`, loại tin tức sự kiện, nội dung lấy từ Kế hoạch vừa lập; lưu "Bai dang website.md" (# Title / # Description / # Body, Body không bọc code block).

**Ảnh chính**: tab Work không tạo được ảnh. Cuối "Bai dang website.md", sau dòng "---", ghi "Gợi ý ảnh chính (không đăng)": mô tả cảnh phù hợp hoạt động, 1280x720 px, phong cách hiện đại, sạch, tông xanh đậm/trắng, chất công nghệ, không chữ. Người dùng tự chuẩn bị "Anh chinh.png" (hoặc dùng tab Design).

## Bước 7. Thư mục Chứng từ và báo cáo

Thư mục "Chứng từ/" để RỖNG. Nói rõ: chứng từ thanh toán do phần mềm Thanh toán riêng của Khoa sinh từ tệp Dự toán; Handio không sinh được chứng từ.

Rồi `read_document` đọc lại Kế hoạch, Dự toán, Email và đối chiếu danh sách tự kiểm dưới đây. Báo cáo ngắn: các tệp đã tạo; Dự toán tổng bao nhiêu (Nhóm 2 + Nhóm 3); dòng nào đơn giá chỉ là đề xuất; mục "[cần bổ sung]"; việc người dùng còn phải làm (ảnh, chứng từ, số văn bản).

## Tự kiểm trước khi báo xong

- [ ] Thư mục đúng "[Mã]. [Tên ngắn] [Năm]"; tên Kế hoạch và Dự toán đúng quy ước, có tiền tố mã.
- [ ] Kế hoạch đủ 6 mục La Mã; Ban tổ chức đúng 10 người, Trưởng ban là Trưởng khoa; chữ ký cuối là GIÁM ĐỐC.
- [ ] Số văn bản và ngày tháng còn dấu chấm lửng "……" (Văn thư điền sau); mục Nơi nhận không có "(để thực hiện)".
- [ ] Dự toán có công thức Thành tiền = SL × Đơn giá; Nhóm 2 + Nhóm 3 = Tổng cộng; không lẻ dưới 1.000đ; "bằng chữ" khớp số; đúng cặp người ký theo cấp.
- [ ] Email không "Quý Thầy/Cô", không "Thư mời"; bài website: Title ≤ 15 từ, Description ≤ 200 ký tự, mỗi "##" một emoji.
- [ ] Không còn tên giả của tệp mẫu (Nguyễn Văn A…) hoặc số tài khoản 0000000000 trong bất kỳ sản phẩm nào.
- [ ] Thư mục "Chứng từ" có và rỗng.

## KHÔNG làm

- Không tạo Tờ trình kèm theo.
- Không ghi "Số căn cứ ngân sách" (mã chương, mã ngành, mã nguồn).
- Không bận tâm mốc thời gian nộp kế hoạch (trước hoạt động bao nhiêu ngày).
- Không tự đoán mã hoạt động; không có hoạt động "lai cấp đơn vị".
- Không để tiền lẻ dưới 1.000đ.
- Không dùng "Quý Thầy/Cô" trong email.
- Không sáo ngữ ("tự hào", "vinh dự", "trong thời đại số", "chúng ta") trong bài website.
- Không viết "(để thực hiện)" sau tên đơn vị ở mục Nơi nhận của Kế hoạch: chỉ tên đơn vị và dấu chấm phẩy.
- Không dùng màu nền cho hàng tiêu đề bảng Ban tổ chức (để trắng). `create_docx` tô nền xanh nhạt hàng tiêu đề nên khi cần đúng mẫu phải làm theo cách A trong `the-thuc-ke-hoach.md`, hoặc báo rõ giới hạn này.
- Không thay dấu chấm lửng "……" ở "Số: ……/KH-ĐHKTQD" và "Hà Nội, ngày …… tháng …… năm": Văn thư điền sau khi vào sổ.
- Không đưa tên người, số tài khoản của tệp mẫu vào sản phẩm.
