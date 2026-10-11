# Thể thức Kế hoạch (.docx)

## Hai cách làm

- **Cách A (khuyên dùng khi dự án đã có mẫu Kế hoạch .docx của Khoa):** `copy_file` mẫu sang tên mới, `read_document` để biết số đoạn ¶N, rồi `docx_edit` (replace_paragraph, insert_after, table set_cell/add_row) và `docx_replace` để điền. Cách này GIỮ NGUYÊN định dạng của mẫu (cột 40/60, cỡ chữ, đường gạch dưới, bảng trắng). Ghi rõ trong báo cáo đã dùng mẫu nào.
- **Cách B (không có mẫu):** dựng mới bằng `create_docx`:
  - style "formal" (Times New Roman 13, A4, căn đều, lề 3/2/2/2 cm);
  - letterhead: agency_parent "Bộ Giáo dục và Đào tạo", agency "Đại học Kinh tế Quốc dân", doc_number "Số: ……/KH-ĐHKTQD", place_date "Hà Nội, ngày …… tháng …… năm [Năm]";
  - title "KẾ HOẠCH", subtitle là tên hoạt động đầy đủ;
  - signature: role "GIÁM ĐỐC", name = học vị + họ tên Giám đốc từ `du-lieu/nguoi-ky.md`;
  - recipients: "- Các đơn vị liên quan;", "- Ban Giám đốc (để báo cáo);", "- Lưu: VT, CNTT." (công cụ tự thêm dòng "Nơi nhận:" in đậm nghiêng);
  - nội dung dài hơn ~2.000 ký tự: gửi phần đầu, rồi gọi tiếp với cùng path và append=true.

Giới hạn của cách B: công cụ tự dựng khối quốc hiệu nên không chỉnh được từng thông số của mẫu gốc (xem "Quy cách gốc" ở cuối); hàng tiêu đề của bảng bị tô nền xanh nhạt (mẫu gốc để trắng). Nói rõ điều này khi báo cáo; `read_document` chỉ kiểm được nội dung, không kiểm được cỡ chữ.

## Cấu trúc (giữ đúng thứ tự)

Tiêu đề: "KẾ HOẠCH" và dòng dưới là tên hoạt động đầy đủ.

**I. CĂN CỨ XÂY DỰNG KẾ HOẠCH**: giữ nguyên các căn cứ cố định của năm, lấy từ mục "Căn cứ cố định" trong `du-lieu/nguoi-ky.md` (thường 2 căn cứ: quyết định giao kế hoạch công việc năm và quyết định giao dự toán chi ngân sách năm). Năm khác thì đổi năm và để "[cần bổ sung: số, ngày quyết định]" cho Trưởng khoa xác nhận. Không có tệp thì để "[cần bổ sung]".

**II. MỤC ĐÍCH, YÊU CẦU**
1. Mục đích chung, 2–4 câu: (1) mục đích lớn; (2–3) cụ thể hoá kết quả mong muốn; (4) gắn với chiến lược chung của Khoa/Trường.
2. Yêu cầu, 3–5 gạch đầu dòng: tính khoa học/chuyên môn; tính khả thi về thời gian, nguồn lực; phối hợp đồng bộ giữa các đơn vị; tuân thủ quy định tài chính của Đại học; (tuỳ hoạt động) an toàn, chất lượng, sự tham gia của đối tác.

**III. THỜI GIAN, ĐỊA ĐIỂM**: hai dòng "Thời gian:" và "Địa điểm:" theo thông tin người dùng đưa.

**IV. NỘI DUNG HOẠT ĐỘNG**: chia thành Nội dung 1, 2, … (hội thảo 3–5 nội dung; lớp bồi dưỡng 2–4). Mỗi nội dung gồm: mục tiêu cụ thể; hình thức/phương pháp; sản phẩm đầu ra; đơn vị hoặc cá nhân chủ trì.

**V. TỔ CHỨC THỰC HIỆN**
1. Phân công: một đoạn ngắn về cơ chế phối hợp.
2. Ban tổ chức: bảng 4 cột STT | Họ và tên | Chức vụ | Nhiệm vụ, ĐÚNG 10 dòng.
   - Dòng 1: Trưởng khoa CNTT, "Trưởng ban, chỉ đạo chung".
   - 1–2 Phó trưởng ban: ưu tiên người có chuyên môn liên quan loại hoạt động.
   - 7–8 thành viên: cân bằng nhóm chuyên môn, giới tính, kinh nghiệm; nhiệm vụ cụ thể theo loại hoạt động.
   - Lấy họ tên, chức vụ từ `du-lieu/ban-to-chuc.csv` (cấu trúc xem `mau-ban-to-chuc.csv`); chỉ dùng người có trong tệp. Tệp không đủ 10 người: ghi "[cần bổ sung]" cho dòng còn thiếu, không bịa tên.

**VI. KẾT QUẢ DỰ KIẾN**: định lượng nếu có: số người tham dự; số sản phẩm đầu ra (bài báo, tài liệu, video…); mức lan toả (truyền thông, đối tác phối hợp); tác động dài hạn lên Khoa/Trường.

**Cuối văn bản:** "Nơi nhận:" (in đậm, nghiêng) rồi các đơn vị, mỗi dòng chỉ tên đơn vị và dấu chấm phẩy, KHÔNG "(để thực hiện)"; bên phải "GIÁM ĐỐC", chừa chỗ ký, rồi học vị và họ tên.

## Văn phong

- Ngôi thứ ba suốt văn bản; không "chúng ta", "chúng tôi", "các bạn".
- Hành chính trang trọng, câu có thể dài 20–35 từ nhiều mệnh đề nhưng mạch lạc; tránh sáo ngữ ("không thể phủ nhận", "trong thời đại số").
- Thuật ngữ tiếng Việt chuẩn ngành; tiếng Anh chỉ khi phổ biến (AI, IoT, ML, CNTT, GV, SV).

## Quy cách gốc (để kiểm khi dùng mẫu của người dùng ở cách A)

| Vị trí | Cỡ chữ | Ghi chú |
|---|---|---|
| Bộ Giáo dục và Đào tạo; Đại học Kinh tế Quốc dân; Cộng hoà xã hội chủ nghĩa Việt Nam | 12 pt | đậm |
| Độc lập – Tự do – Hạnh phúc | 14 pt | đậm, căn giữa |
| Số:, địa danh ngày tháng | 12 pt | |
| Thân văn bản | 13 pt | căn đều |
| "Nơi nhận:" | 12 pt | đậm + nghiêng |
| Các dòng dưới "Nơi nhận:" | 11 pt | thường |
| GIÁM ĐỐC | 14 pt | đậm, căn giữa |
| Họ tên người ký | 13 pt | đậm, chừa chỗ ký phía trên |

- Khối đầu văn bản là bảng 2 cột không viền, tỉ lệ 40/60 (cột phải rộng để "CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM" không xuống dòng).
- Đường gạch dưới ngắn bên dưới "Đại học Kinh tế Quốc dân", "Độc lập – Tự do – Hạnh phúc" và dưới tên kế hoạch: làm bằng đoạn rỗng có viền dưới và thụt lề hai bên (lần lượt khoảng 1080, 1260, 2880 DXA), nét mỏng, màu đen; KHÔNG thụt lề chính dòng chữ.
- Hàng tiêu đề bảng Ban tổ chức: KHÔNG màu nền (trắng).
- Số văn bản và ngày tháng giữ dấu chấm lửng "……" cho Văn thư điền.
