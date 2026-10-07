# Kịch bản training — tab **Work** (khối văn phòng)

*Đối tượng:* chuyên viên, trợ lý khoa/phòng, giảng viên làm việc với văn bản và bảng tính, không cần biết lập trình. *Điều kiện:* đã đọc [README training](README.md).
*Nguyên tắc:* agent **làm nháp rất nhanh, người làm chịu trách nhiệm cuối cùng**. Mỗi bài có bước "kiểm tra trước khi dùng"; đó là kỹ năng cần rèn nhất.

**Thư mục thực hành:** mở tab **Work** lần đầu sẽ có sẵn 8 tệp mẫu (dữ liệu **giả lập**, ghi rõ trong `DOC-LAM-QUEN.md`):

| Tệp | Dùng cho bài |
|---|---|
| `ke-hoach-hoi-thao.docx` | W1, W5 |
| `ghi-chu-hop-khoa.txt` | W2, W9 |
| `diem-hoc-phan.xlsx` (sheet *Điểm*, *Quy chế*) | W3 |
| `du-toan-hoi-thao.xlsx` | W4 |
| `thong-bao-nhap.docx` | W7 |
| `danh-sach-moi.xlsx` | W6 |
| `NEUAGENT.md` | quy ước đơn vị (tên đơn vị, người ký, đầu số văn bản) mà agent tự đọc |

Thêm tệp của bạn: nút **＋ Thêm tệp** hoặc **kéo thả** vào cửa sổ (Word, Excel, PowerPoint, PDF, văn bản). Lấy kết quả: nút **⬇** cạnh tên tệp (web) hoặc **↗ Mở bằng ứng dụng** (Desktop, mở thẳng Word/Excel). Làm lại từ đầu: *Cài đặt → Khôi phục dữ liệu mẫu* (web) / *Tệp → Nạp dữ liệu mẫu* (Desktop).

| Bài | Tên | Thời lượng | Năng lực chính |
|---|---|---|---|
| W0 | Làm quen & an toàn dữ liệu | 15′ | Giao diện, duyệt, bản gốc không bị ghi đè |
| W1 | Tóm tắt tài liệu | 20′ | Đọc, tóm tắt, đối chiếu nguồn |
| W2 | Soạn biên bản từ ghi chú thô | 30′ | Hỏi lại thông tin thiếu, thể thức hành chính |
| W3 | Bảng điểm: tính, xếp loại, thống kê | 40′ | Công thức sống, kiểm tra số bằng tay |
| W4 | Rà soát dự toán | 30′ | Phát hiện sai sót, sửa có kiểm soát |
| W5 | Từ Word sang slide | 30′ | Cô đọng, một ý một slide |
| W6 | Giấy mời hàng loạt | 30′ | Trộn dữ liệu, kiểm tra tên từng người |
| W7 | Rà soát chính tả và thể thức | 25′ | Bảng lỗi, sửa trên bản sao |
| W8 | Tìm thông tin xuyên nhiều tài liệu | 15′ | Tìm không dấu, trích nguồn |
| W9 | Bài tổng hợp “Một ngày làm việc” | 45′ | Chuỗi việc liên hoàn |

---

## W0 — Làm quen & an toàn dữ liệu (15′)

**Các bước**
1. Giới thiệu vùng giao diện: tệp (trái), việc cần làm, chế độ (trên), ô nhập.
2. Gõ: `Trong thư mục này có những tài liệu gì? Mỗi tài liệu nói về việc gì? (đọc nhanh, đừng sửa gì)`.
3. Bấm một tệp `.docx` trong cây tệp để xem bản chữ trích xuất.
4. Gõ: `Hãy xoá file thong-bao-nhap.docx` → quan sát (agent không có công cụ xoá; không bao giờ làm được điều này).

**Kiểm tra:** học viên chỉ ra các thẻ "Đọc tài liệu" và hiểu rằng đọc không cần xin phép còn **ghi** thì có.
**Điểm nhấn:** (1) AI chỉ thấy tệp trong thư mục này; (2) mọi thay đổi đều hỏi, bản gốc không bị ghi đè; (3) **không** đưa dữ liệu cá nhân thật, key vào buổi tập; (4) kết quả của AI là bản nháp.

## W1 — Tóm tắt tài liệu (20′)

**Các bước**
1. `/tomtat ke-hoach-hoi-thao.docx`
2. Đối chiếu: mở bản gốc, kiểm 4 chi tiết agent nêu (thời gian, địa điểm, kinh phí, người báo cáo chính).
3. Hỏi tiếp: `Những mốc thời gian nào tôi phải chú ý trong tháng 10? Trích đúng câu trong tài liệu.`
4. Thử một tài liệu thật dài của bạn (đã được phép dùng) và so sánh tóm tắt với cảm nhận của bạn.

**Agent nên làm:** đọc bằng *Đọc tài liệu*; tóm tắt 3 câu + 5–7 ý + mốc thời gian + câu hỏi còn mở; không bịa ngoài tài liệu.
**Kiểm tra:** 4 chi tiết đối chiếu đúng; mốc `10/10`, `12/10`, `17/10` có đủ.
**Điểm nhấn:** tóm tắt *giấu* thông tin; luôn hỏi "còn gì tài liệu không nói?". PDF scan (ảnh) **không đọc được** (chưa hỗ trợ OCR); `.doc/.xls` cũ cần lưu lại thành `.docx/.xlsx`.

## W2 — Soạn biên bản từ ghi chú thô (30′)

**Các bước**
1. Mở `ghi-chu-hop-khoa.txt` để thấy ghi chú viết tắt, không dấu.
2. Gõ: `/soanthao biên bản họp giao ban Khoa ngày 30/9/2026 từ ghi-chu-hop-khoa.txt. Theo quy ước trong NEUAGENT.md. Có bảng phân công việc (công việc, người phụ trách, hạn).`
3. Nếu agent hỏi thêm: trả lời ngắn; nếu không hỏi, **tự hỏi lại**: `Có thông tin nào còn thiếu hoặc bạn đã phải đoán không?`
4. Duyệt hộp **"Tạo tài liệu này?"** (đọc phần mô tả), mở tệp Word kết quả.

**Agent nên làm:** đọc ghi chú + `NEUAGENT.md`; tạo `.docx` kiểu *formal* có quốc hiệu, tiêu đề, trích yếu, nội dung, bảng việc, nơi nhận, chữ ký; **đánh dấu `[cần bổ sung]` hoặc nêu rõ** những gì thiếu (số văn bản, họ tên đầy đủ của thư ký); đọc lại để kiểm tra.
**Kiểm tra:** (a) tên viết đúng như ghi chú; (b) 4 đầu việc + hạn khớp ghi chú (10/10, 15/10, 03/10, họp tiếp 28/10); (c) **không** có số văn bản/tên bịa; (d) thể thức: quốc hiệu, nơi nhận, chữ ký.
**Lỗi thường gặp:** agent tự điền "Số: 15/BB-CNTT"; ngày tháng sai định dạng → yêu cầu sửa; viết tên đầy đủ thay vì như ghi chú → kiểm tra với nguồn.
**Điểm nhấn:** AI giỏi *trình bày*, kém *biết sự thật của đơn vị bạn*; mọi con số, họ tên, ký hiệu phải do người xác nhận.

## W3 — Bảng điểm: tính, xếp loại, thống kê (40′)

**Các bước**
1. Mở `diem-hoc-phan.xlsx` (xem sheet *Điểm* và *Quy chế*: trọng số 10/30/60; Giỏi ≥ 8,5, Khá ≥ 7, Trung bình ≥ 5).
2. Gõ: `Từ diem-hoc-phan.xlsx, tính điểm tổng kết theo trọng số ở sheet Quy chế (làm tròn 1 chữ số), xếp loại, và thêm sheet Thống kê: sĩ số, điểm trung bình, cao nhất, thấp nhất, số sinh viên mỗi loại. Lưu thành diem-tong-ket.xlsx, KHÔNG sửa file gốc, dùng công thức. Cuối cùng cho tôi 3 dòng để tự đối chiếu bằng tay.`
3. Duyệt, mở `diem-tong-ket.xlsx` bằng Excel: bấm vào một ô tổng kết, xem **công thức** (không phải số gõ tay).
4. **Tự kiểm tra:** chọn 3 sinh viên, tính tay `CC×0,1 + GK×0,3 + CK×0,6`; thử sinh viên ở sát ranh giới 5,0 / 7,0 / 8,5.
5. Đổi một điểm trong sheet nguồn, xem tổng kết tự đổi.

**Agent nên làm:** đọc cả hai sheet; tạo file mới với công thức (`=ROUND(D2*0.1+E2*0.3+F2*0.6,1)`, `=IF(...)`, `=COUNTIF(...)`); sau khi tạo, hệ thống **tính sẵn kết quả công thức** và agent đối chiếu; báo kết quả + cách kiểm.
**Kiểm tra:** tổng 4 nhóm xếp loại = sĩ số; 3 sinh viên tính tay khớp; file gốc nguyên vẹn; mở bằng Excel không báo lỗi công thức.
**Lỗi thường gặp:** làm tròn khác quy chế; so sánh ranh giới sai (`>` thay `>=`); điểm là chữ chứ không phải số.
**Điểm nhấn:** yêu cầu *công thức sống* thay vì số gõ tay; luôn tự tính lại vài dòng; tách nguồn/kết quả. Công thức dùng tên hàm tiếng Anh dấu phẩy (Excel tiếng Việt tự hiển thị đúng).

## W4 — Rà soát dự toán (30′)

**Các bước**
1. Gõ: `Rà soát du-toan-hoi-thao.xlsx: tìm lỗi số liệu, công thức, dòng trùng, giá trị bất thường. Liệt kê vị trí ô và gợi ý sửa. CHƯA sửa file.`
2. Đối chiếu với 4 lỗi cài sẵn: (i) `E6` đơn giá là *chữ* "3.000.000"; (ii) dòng *Tea break* nhập hai lần (hàng 3 và 7); (iii) `D8` số lượng âm; (iv) `F9` tổng thiếu hàng 8.
3. Gõ: `Lưu bản đã sửa thành du-toan-hoi-thao-v2.xlsx: sửa các lỗi (i), (iii), bỏ dòng trùng, sửa công thức tổng. Liệt kê chính xác ô nào đã đổi.`
4. So sánh hai file; **tự kiểm tổng** (tính nhanh bằng máy tính).

**Kiểm tra:** agent tìm đủ ≥ 3/4 lỗi, nêu đúng ô; bản v2 có tổng đúng; bản gốc không đổi.
**Điểm nhấn:** hỏi trước khi sửa; ghi lại thay đổi; rủi ro khi "sửa thay" mà không báo; số tiền thật phải được người có thẩm quyền duyệt.

## W5 — Từ Word sang slide (30′)

**Các bước**
1. `/trinhchieu ke-hoach-hoi-thao.docx — báo cáo 5 phút cho lãnh đạo Khoa, tối đa 6 slide.`
2. Mở `.pptx` bằng PowerPoint: kiểm tra từng slide **không tràn chữ**, đọc ghi chú người trình bày.
3. Yêu cầu chỉnh: `Slide chương trình đang quá nhiều chữ: rút gọn còn 3 mục chính, các mục còn lại đưa vào ghi chú.`

**Agent nên làm:** đọc nguồn; bìa + 5 slide, mỗi slide một ý, 3–6 gạch đầu dòng ngắn, có bảng cho chương trình, có ghi chú; cảnh báo slide có thể tràn; đọc lại để kiểm.
**Kiểm tra:** số liệu (thời gian, địa điểm, kinh phí, 5 mục chương trình) khớp nguồn; không slide nào > ~6 dòng.
**Điểm nhấn:** AI dựng *bộ khung* và nội dung; thẩm mỹ cuối (logo, phông, hình) do người hoàn thiện trong PowerPoint.

## W6 — Giấy mời hàng loạt (30′)

**Các bước**
1. Xem lệnh sẵn có `/giay-moi` (trong `.neuagent/commands/giay-moi.md`; mở ra đọc để biết đơn vị tự tạo lệnh được).
2. `/giay-moi danh-sach-moi.xlsx`
3. Mở file Word: có **6 trang**, mỗi người một trang? Kiểm *từng* họ tên, chức vụ, đơn vị, vai trò đối chiếu với danh sách.
4. Gõ: `Thêm khách mời mới: TS. Hoàng Thị Lan, Phó trưởng phòng, Phòng Khoa học Công nghệ, vai trò Khách mời; tạo lại file giấy mời (lưu tên mới).`

**Kiểm tra:** đủ 6 giấy mời; không lẫn vai trò giữa người; thời gian/địa điểm khớp kế hoạch.
**Điểm nhấn:** tự động hoá việc lặp lại rất tiện, nhưng **lỗi nhân lên theo số lượng**; luôn kiểm *từng bản* hoặc ngẫu nhiên ≥ 20%, và đặc biệt tên người, chức danh.

## W7 — Rà soát chính tả và thể thức (25′)

**Các bước**
1. `/rasoat thong-bao-nhap.docx`
2. Đọc bảng lỗi (vị trí | lỗi | gợi ý). Đối chiếu với bản gốc: thiếu dấu ("gưi", "se to chuc"), ngày tháng không thống nhất (`5/10/2026`, `03-10-2026`), thiếu quốc hiệu/số/nơi nhận.
3. Gõ: `Sửa theo bảng trên: chỉ sửa chính tả và định dạng ngày thành dd/mm/yyyy, KHÔNG đổi nội dung. Lưu thành thong-bao-da-sua.docx.` (agent dùng *Sửa Word* với thay thế chữ, giữ nguyên định dạng.)
4. Dùng *So sánh tài liệu* của Word (Review → Compare) giữa hai bản để thấy đúng những gì đã đổi.

**Kiểm tra:** chỉ chữ cần sửa bị đổi (không "viết lại" nội dung); định dạng giữ; bản gốc nguyên vẹn.
**Điểm nhấn:** phân biệt *rà soát* (liệt kê) và *sửa* (thay đổi); luôn sửa trên bản sao; công cụ so sánh của Word là cách kiểm tra rẻ nhất.

## W8 — Tìm thông tin xuyên nhiều tài liệu (15′)

**Các bước**
1. `Ai được giao lo nội dung chương trình hội thảo? Tìm trong tất cả tài liệu và cho biết tìm thấy ở file nào.`
2. `Tìm tất cả chỗ nhắc "nguyen van an" (không dấu).`
3. Thử từ khoá không có trong tài liệu: agent phải nói "không thấy" chứ không bịa.

**Kiểm tra:** câu trả lời kèm tên tệp + vị trí; từ không tồn tại → "không tìm thấy".
**Điểm nhấn:** tìm được cả khi gõ không dấu; yêu cầu **trích nguồn**; PDF scan không tìm được.

## W9 — Bài tổng hợp “Một ngày làm việc” (45′)

*Tình huống:* sáng nay Khoa họp giao ban (ghi chú ở `ghi-chu-hop-khoa.txt`). Bạn là trợ lý Khoa, cần xong trước 11h:
1. **Biên bản** họp (Word, thể thức hành chính).
2. **Bảng theo dõi việc** (Excel): công việc, người phụ trách, hạn, trạng thái; thêm cột *Còn lại (ngày)* tính từ hạn đến `07/10/2026`.
3. **Giấy mời** hội thảo cho danh sách khách (`danh-sach-moi.xlsx`).
4. **3 slide** báo cáo nhanh cho Trưởng khoa (kế hoạch, mốc thời gian, việc cần quyết).
5. **Email tóm tắt** gửi toàn Khoa (soạn trong chat, không cần tệp).

**Cách làm:** chia nhỏ, dùng `todo` (agent tự lập danh sách việc), kiểm tra từng bước trước khi qua bước sau. Nên dùng chế độ *Lập kế hoạch* ở bước đầu.
**Kiểm tra (rubric):** đủ 5 sản phẩm; số liệu/tên/ngày nhất quán giữa các tệp (kiểm chéo); không có thông tin bịa; mỗi tệp mới có tên rõ ràng, bản gốc nguyên vẹn; học viên nêu được 3 chỗ đã phải sửa agent.

---

### Checklist trước khi gửi bất kỳ văn bản/bảng tính nào do AI soạn (phát cho học viên)

- [ ] Tôi đã **đọc toàn bộ** văn bản, không chỉ lướt.
- [ ] Tên người, chức danh, đơn vị, số điện thoại, email: **đối chiếu với nguồn**.
- [ ] Ngày, giờ, địa điểm, số tiền, tỷ lệ: **đối chiếu với nguồn**; số tổng tôi **tự tính lại**.
- [ ] Số/ký hiệu văn bản, căn cứ pháp lý, trích dẫn: do **tôi** điền/xác nhận, không để AI tự nghĩ ra.
- [ ] Công thức Excel: bấm vào vài ô xem công thức; thử đổi một số liệu xem kết quả đổi theo.
- [ ] Mở bằng **Word/Excel/PowerPoint thật** xem bố cục, tràn chữ, phông.
- [ ] Không có dữ liệu cá nhân ngoài phạm vi được phép trong tệp sẽ gửi.
- [ ] Tôi sẵn sàng **chịu trách nhiệm** về văn bản này như tự tay soạn.

### Phụ lục: giới hạn đã biết của tab Work (nói thẳng với học viên)

- Không đọc được **PDF scan/ảnh** (chưa có OCR) và hình ảnh trong tài liệu; `.doc/.xls/.ppt` cũ cần lưu lại bản mới.
- Sửa file Excel có sẵn bằng agent có thể làm mất **biểu đồ, bảng pivot, macro**: nên luôn *lưu thành bản mới* và kiểm tra; với tệp quan trọng, làm trên bản sao.
- Công thức Excel được tính kiểm bằng bộ tính riêng của hệ thống cho các hàm thông dụng (SUM, IF, COUNTIF(S), SUMIF(S), AVERAGE, MAX/MIN, VLOOKUP, INDEX/MATCH, ROUND, TEXT…). Hàm hiếm sẽ được báo "chưa kiểm được"; Excel sẽ tự tính khi mở.
- Định dạng Word/PowerPoint do agent tạo theo mẫu có sẵn (hành chính hoặc hiện đại); không sao chép mẫu riêng của đơn vị. Muốn dùng mẫu riêng: để agent soạn nội dung rồi dán vào mẫu, hoặc sửa tệp mẫu bằng "Sửa Word" (thay chữ).
- Agent **không** gửi email, không đăng tải, không tự mở tệp ngoài thư mục làm việc.
- Xuất PDF (Desktop) chỉ có khi máy cài LibreOffice.
