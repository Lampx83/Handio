# Khoảng trống công cụ Office

So sánh công cụ Office của Handio (Word, Excel, PowerPoint, PDF) với bộ kỹ năng `docx`, `xlsx`, `pptx`, `pdf` của Claude. Chỉ là báo cáo: chưa sửa mã lõi. Rà soát ngày 11/10/2026 trên `packages/core/src/office/`.

**Cách đọc:** *Ưu tiên* = giá trị với khối văn phòng (tab Work). *Độ khó*: Dễ ≤ 1 ngày, Vừa 2–4 ngày, Khó ≥ 1 tuần hoặc rủi ro cao. Cách làm chỉ dùng thư viện đã có (`jszip`, `exceljs`, `pdf-lib`, `pptxgenjs`, `docx`, `unpdf`, `fast-formula-parser`, `image-size`). Chỉ F1 cần thêm một gói nhỏ (`@pdf-lib/fontkit`); F7 (ưu tiên thấp) cần đổi sang bản fork của `pdf-lib`. Cả hai đã nêu rõ.

## 1. Tám việc nên làm trước

| # | Việc | Vì sao | Độ khó | Mục |
|---|---|---|---|---|
| 1 | Xuất trang ra ảnh (PDF, và Word/Excel/PowerPoint qua PDF) | Nền cho OCR PDF scan, xem trước, tự soát bằng mắt, lưới thumbnail. Hiện agent làm xong không "nhìn" được kết quả | Vừa | C1, F3 |
| 2 | Bình luận trong Word: thêm, trả lời, đọc | Góp ý vào bản thảo là việc thường ngày; hiện không có | Vừa | W1, W2 |
| 3 | Theo dõi thay đổi cho sửa cấp đoạn; duyệt (chấp nhận/từ chối) | `docx_edit` sửa im lặng; `suggest` chỉ cho thay chữ trong run đơn giản | Vừa–khó | W3, W4 |
| 4 | Đọc `.doc`, `.xls`, `.ppt` cũ (đổi sang bản mới) | Công văn, bảng biểu cũ của cơ quan còn rất nhiều; hiện báo "chưa đọc được" | Dễ | C2 |
| 5 | Điền biểu mẫu PDF (AcroForm) | Tờ khai, mẫu của cơ quan ngoài; chưa có gì | Vừa | F1 |
| 6 | Ảnh trong Word: chèn, thay (logo, ảnh minh hoạ, chữ ký) | `create_docx` không có cú pháp ảnh | Vừa | W5 |
| 7 | Bổ sung hàm Excel còn thiếu (SUBTOTAL, PMT, NPV, IRR…) | Ô công thức không có giá trị lưu sẵn, xem ở trình xem nhanh/điện thoại hiện trống | Dễ | X1 |
| 8 | Ghi chú ô và kiểm định dữ liệu (dropdown) trong Excel | Ghi nguồn/giả định cho số liệu; bảng cho người khác điền | Dễ | X2, X3 |

## 2. Word (.docx)

| # | Năng lực của skill Claude | Handio hiện nay | Ưu tiên | Khó | Cách làm đề xuất |
|---|---|---|---|---|---|
| W1 | Thêm bình luận, trả lời bình luận (`comment.py`: 4 tệp `comments*.xml` + quan hệ + content type + dấu `commentRangeStart/End`) | Không có | **Cao** | Vừa | Công cụ `docx_comment`: `jszip` tạo/ghép `word/comments.xml` (thêm `commentsExtended.xml` khi trả lời hoặc đánh dấu xong), thêm `Relationship` và `Override`, bọc đoạn/chữ bằng dấu mốc theo cách khớp chữ của `track.ts`. Tác giả lấy từ `brandName()` |
| W2 | Đọc lớp duyệt: ai sửa/bình luận gì, khi nào, ở đâu | `read_document` chỉ ra bản "đã chấp nhận" (chữ chèn có, chữ xoá mất), không nói ai sửa; bỏ qua bình luận | **Cao** | Dễ–vừa | Công cụ chỉ-đọc `docx_review`: phân tích `comments.xml`, `w:ins`, `w:del`, `w:moveFrom/To`; trả bảng ¶N, loại, tác giả, ngày, nội dung. Dùng chung số ¶ với `read_document` |
| W3 | Sửa có theo dõi ở mọi chỗ (`w:ins`/`w:del`, dấu đoạn bị xoá) | `docx_edit` sửa im lặng. `docx_replace suggest=true` chỉ làm được với run đơn giản (run có tab, ngắt dòng, trường bị bỏ qua và báo) | **Cao** | Vừa–khó | Thêm `track: true` cho `docx_edit`: `replace_paragraph` → bọc run cũ trong `w:del` (đổi `w:t` thành `w:delText`) + `w:ins`; `delete` → `w:del` + dấu đoạn bị xoá; `insert_after` → `w:ins` + dấu đoạn chèn. Chuẩn hoá run trước khi tách (như `docxReplace` đã làm) để bớt "bỏ qua" |
| W4 | Chấp nhận/từ chối thay đổi (`accept_changes.py`, cần LibreOffice) | Không có | Vừa | Vừa | Thêm hành động vào `docx_review`: chấp nhận = bỏ `w:del`+nội dung, mở `w:ins`; từ chối ngược lại; cho lọc theo tác giả. Chạy được cả ở web (không cần LibreOffice). Chú ý: dấu đoạn bị xoá phải nối đoạn với đoạn sau, đừng để lại đoạn rỗng |
| W5 | Ảnh trong tài liệu (`ImageRun`), chèn/thay ảnh | `create_docx` không có cú pháp ảnh; `docx_edit` không chèn ảnh | **Cao** | Vừa | `create_docx`: dòng `![mô tả](anh.png)` như `create_pptx` (đọc ảnh trong thư mục dự án ≤ 8 MB, `image-size` lấy kích thước, co theo lề, đặt alt text). `docx_edit insert_after` kiểu `image`: thêm `word/media/*`, quan hệ, `Default Extension` |
| W6 | Gộp run để tìm chữ (`merge_runs.py`) | Đã có trong `docx_replace` (khớp chữ qua nhiều run); chưa có cho `docxSuggest` | Thấp | Dễ | Dùng lại logic gộp ở `track.ts` (cùng chỗ với W3) |
| W7 | Kiểm tra gói trước khi giao (`validate.py`: XSD, quan hệ, content types, id trùng, dấu bình luận) | Không có kiểm tra lúc chạy (chỉ có kiểm thử) | Vừa | Vừa | Mô-đun `ooxml-lint` nhẹ (dùng chung W/X/P): mọi phần có trong `[Content_Types].xml`, mọi `Target` của quan hệ tồn tại, id `ins/del/comment` không trùng, thẻ cân bằng. Không cần XSD (hơn 100 tệp, nặng) |
| W8 | Đọc đủ: đầu/chân trang, chú thích cuối, hộp văn bản, alt text ảnh | `read_document` chỉ đọc thân bài (nhưng `docx_replace` sửa được đầu/chân trang) | Vừa | Dễ | `docxToMarkdown` đọc thêm `header*.xml`, `footer*.xml`, `footnotes.xml` (đã có biểu thức `TEXT_PARTS`) và in dạng chú thích cuối |
| W9 | Chú thích cuối trang, đầu/chân trang tuỳ biến, đổi hướng giấy theo mục, dòng dẫn chấm (`PositionalTab`) | Kiểu `modern` có đầu/chân trang tự động; còn lại không | Thấp–vừa | Vừa | `docx` đã có `FootnoteReferenceRun`, nhiều `sections`, `PositionalTab`; cần mở rộng cú pháp Markdown (`[^1]`, `<<<landscape>>>`, …) trong `mdblocks.ts` |
| W10 | So sánh hai bản và xuất bản đánh dấu thay đổi | `text_diff` chỉ liệt kê khác biệt; `/doi-chieu` xuất Word/Excel mới | Vừa | Vừa–khó | Diff mức đoạn (`text_diff` đã có) rồi dựng `w:ins`/`w:del` trên bản mới; đoạn bị xoá giữ lại dạng `w:del`. Nên làm sau W3 |

## 3. Excel (.xlsx)

| # | Năng lực của skill Claude | Handio hiện nay | Ưu tiên | Khó | Cách làm đề xuất |
|---|---|---|---|---|---|
| X1 | Không ship ô công thức lỗi/không có giá trị (`recalc.py` chạy LibreOffice) | Bộ tính nội bộ `fast-formula-parser` + `formulas.ts`; hàm chưa có thì ghi "chưa kiểm được" và ô không có giá trị lưu sẵn. Đã thử: thiếu SUBTOTAL, PMT, NPV, IRR, FV, PV, NPER, RATE, SWITCH, STDEV.S, VAR.S, PERCENTILE, QUARTILE, RANK.EQ, LOOKUP, AGGREGATE, OFFSET, INDIRECT, XLOOKUP | **Cao** | Dễ | Thêm vào `customFunctions()` theo mẫu có sẵn (ưu tiên SUBTOTAL và nhóm tài chính, dùng nhiều ở kế toán). Khi máy có LibreOffice: chạy lại bằng `soffice --convert-to xlsx` (dùng chung hàm tổng quát ở C2) để điền giá trị cho hàm vẫn thiếu |
| X2 | Ghi chú ô, ghi nguồn và giả định cạnh số liệu | Không có tham số; `read_document` không hiện ghi chú | **Cao** | Dễ | `exceljs` `cell.note` (đã thử: ghi rồi đọc lại còn nguyên). Thêm `notes: {"B5": "Nguồn: …"}` vào `create_xlsx`/`xlsx_edit`; `read_document` in `[ghi chú: …]` |
| X3 | Kiểm định dữ liệu cho bảng người khác điền (danh sách, số, ngày) | Không có | **Cao** | Dễ | `cell.dataValidation` (đã thử: giữ nguyên khi đọc-ghi). Tham số `validation: [{range, list \| number \| date}]`; kèm chú giải "ô cần nhập" và một hàng ví dụ (theo skill) |
| X4 | Quy ước mô hình tài chính: xanh = nhập tay, đen = công thức, xanh lá = liên kết sheet, nền vàng = giả định; số âm trong ngoặc; năm là chữ; tỷ lệ lưu dạng phân số; mỗi giả định một ô | Giao diện mặc định kiểu bảng báo cáo; `xlsx_edit format` có màu nhưng không có quy ước | Vừa | Dễ | Không cần sửa lõi: skill trong gói (ví dụ `phan-tich-du-lieu` hoặc gói tài chính mới) dùng `xlsx_edit format`; tuỳ chọn sau: `style: "model"` |
| X5 | Soát công thức cấp cao: công thức không nhất quán theo hàng/cột, hằng số cứng trong công thức, chia cho 0, `#REF!` sau khi xoá hàng, liên kết ngoài mất giá trị | Chỉ báo lỗi khi tính các ô vừa tạo/sửa | Vừa | Vừa | Công cụ chỉ-đọc `xlsx_audit`: duyệt lưới công thức (đã có `readXlsxGrid`), so mẫu theo hàng, đếm lỗi toàn sổ kể cả ô không sửa, phát hiện `xl/externalLinks/` |
| X6 | Đọc kiểu dáng để "bám quy ước tệp đang có": ô nhập (màu chữ/nền), vùng gộp, validation, tên vùng | `read_document` chỉ có giá trị và công thức | Vừa | Dễ–vừa | Tuỳ chọn `styles: true` cho `read_document` hoặc `xlsx_inspect`: gom ô liền nhau cùng font/nền/định dạng số |
| X7 | Liên kết, tên vùng, bảo vệ sheet, hình ảnh, Excel Table, ẩn sheet | Không có (trừ màu thẻ mặc định) | Thấp–vừa | Dễ | API `exceljs` đủ (đã thử: giữ hyperlink, tên, bảo vệ khi đọc-ghi); thêm vào `xlsx_edit ops` |
| X8 | Giữ macro `.xlsm` (`keep_vba`) | Đọc được `.xlsm`; ghi lại bằng `exceljs` (mất macro), xem R1 | Thấp | Vừa | Từ chối sửa tại chỗ `.xlsm`, lưu sang `.xlsx` và nói rõ mất macro; giữ macro cần thao tác zip riêng, không đáng |

## 4. PowerPoint (.pptx)

| # | Năng lực của skill Claude | Handio hiện nay | Ưu tiên | Khó | Cách làm đề xuất |
|---|---|---|---|---|---|
| P1 | Lưới ảnh thu nhỏ để chọn layout mẫu, xem lại từng slide (`thumbnail.py`, QA thị giác) | Không có | **Cao** | Vừa | Gộp vào C1 |
| P2 | Điền theo mẫu của đơn vị (.pptx/.potx): thêm slide từ layout, điền theo ô giữ chỗ, xoá phần thừa (`add_slide.py`) | `pptx_edit` chỉ nhân đôi/xoá/đổi chỗ slide và thay chữ theo nội dung; không thêm slide từ layout; không đọc `.potx` | Vừa | Vừa | Mở rộng `pptx-edit.ts` (đã có xử lý quan hệ, content type, `sldIdLst` khi nhân đôi) cho nguồn `slideLayoutN.xml`; thêm `set_text` theo hình (`read_document` in tên/ID hình); nhận `.potx` như `.pptx` (C3) |
| P3 | Thêm hình/ảnh/bảng vào slide có sẵn, thay ảnh, sửa dữ liệu biểu đồ có sẵn | Không (mô tả công cụ nêu rõ) | Vừa | Vừa–khó | `jszip`: thêm `ppt/media`, quan hệ, `<p:pic>`; biểu đồ: sửa `<c:v>` và bảng tính nhúng. Làm sau P2 |
| P4 | Dọn phần mồ côi sau khi xoá slide (`clean.py`: media, biểu đồ, theme) | Xoá slide, quan hệ và ghi chú; media/biểu đồ mồ côi còn lại, tệp phình | Thấp | Dễ | Quét `Target` còn được tham chiếu rồi bỏ phần thừa (dùng chung `ooxml-lint`, W7) |
| P5 | Kiểm tra gói: trục biểu đồ chưa khai báo, nhãn `outEnd` trên cột xếp chồng, theme master dùng chung | Không có | Vừa | Vừa | Hai luật biểu đồ thêm vào `ooxml-lint`; `pptx.ts` đã ghi `theme1.xml` như `apply_theme.js` |
| P6 | Section (nhóm slide theo phần) | Không | Thấp | Dễ | `pptxgenjs` `addSection` khi gặp tiêu đề phần |
| P7 | Đọc bình luận, slide ẩn, alt text | `readPptx` đọc chữ, bảng, biểu đồ, ghi chú | Thấp | Dễ | Mở rộng `readPptx` |
| P8 | Kích thước slide (4:3, A4) | Cố định 16:9 rộng, phông Calibri | Thấp | Dễ | `pptx.layout` theo tham số |

Đã ngang bằng hoặc hơn: bảng màu theo chủ đề (16 bộ, ghi vào `theme1.xml`), layout chính, ghi chú người trình bày, biểu đồ thật, alt text ảnh, hộp chữ đánh dấu đúng loại.

## 5. PDF

| # | Năng lực của skill Claude | Handio hiện nay | Ưu tiên | Khó | Cách làm đề xuất |
|---|---|---|---|---|---|
| F1 | Điền biểu mẫu có trường (`FORMS.md`: liệt kê trường, kiểm tra giá trị, điền) | Không có | **Cao** | Vừa | Công cụ `pdf_form` (liệt kê/điền/làm phẳng) bằng `pdf-lib` `getForm()`; kiểm giá trị hợp lệ trước khi ghi. **Lưu ý chữ Việt:** phông chuẩn không mã hoá được "ễ" (đã thử: `WinAnsi cannot encode`). Cần `@pdf-lib/fontkit` (nhỏ, thuần JS) và một phông Unicode đi kèm (vài trăm KB): phụ thuộc duy nhất đề xuất thêm. Không thêm thì chỉ điền được chữ không dấu và phải báo rõ |
| F2 | Biểu mẫu không có trường: tìm toạ độ ô, ghi chữ lên đúng chỗ, kiểm tra chồng lấn, ảnh kiểm tra khung | Không có | Vừa | Khó | `unpdf extractTextItems` (chữ + toạ độ) và nét vẽ từ `getOperatorList` để tìm ô; ghi bằng `pdf-lib drawText`; cần C1 để xem lại. Làm sau F1 |
| F3 | OCR PDF scan (`pytesseract`) | `pdf_info` nói thẳng: chưa có OCR và chưa xuất trang thành ảnh | **Cao** | Vừa | Không thêm Tesseract: trang → ảnh (C1) rồi `read_image` (mô hình thị giác, giữ dấu tiếng Việt, đã có). Bản nhẹ không cần C1: lấy ảnh JPEG nhúng (F5) rồi `read_image` |
| F4 | Trích bảng từ PDF (`pdfplumber extract_tables`) | `pdf_text` ra chữ phẳng, bảng rối | Vừa | Vừa | `extractTextItems` (có toạ độ x, y): gom hàng theo y, cột theo x, ghi bằng `create_xlsx`. PDF scan: C1 + `read_image` (lệnh `/anh-thanh-bang` đã có) |
| F5 | Trích ảnh nhúng (`pdfimages`) | Không có | Vừa | Dễ (JPEG) | `pdf-lib` duyệt XObject `/Image`, bộ lọc `/DCTDecode`: lấy nguyên byte thành `.jpg`. Ảnh Flate: `unpdf extractImages` + `@pdf-lib/upng` (đã đi kèm `pdf-lib`) mã hoá PNG |
| F6 | Watermark, đóng dấu, đánh số trang, đầu/chân trang lên PDF có sẵn | Không có | Vừa | Dễ–vừa | `pdf-lib` `drawText/drawImage/drawPage` (độ mờ, xoay). Chữ Việt không cần phông: dựng một trang dấu mờ bằng `create_pdf` (Chromium có sẵn ở Desktop) rồi `embedPage` chồng lên mọi trang |
| F7 | Đặt/gỡ mật khẩu, hạn chế in/sao chép | Từ chối PDF có mật khẩu; `pdf-lib` 1.17.1 không có hàm mã hoá (đã kiểm) | Thấp–vừa | Vừa | Đổi sang bản fork thay thế trực tiếp `@cantoo/pdf-lib` (có mã hoá/giải mã; cần kiểm chứng trước khi dùng) hoặc `qpdf` qua `env.exec` (chỉ Desktop). Luôn lưu bản mới, nhắc người dùng giữ mật khẩu |
| F8 | Siêu dữ liệu, cắt lề, tối ưu dung lượng | `pdf_info` chỉ đọc | Thấp | Dễ | `pdf-lib setTitle/setAuthor`, `setCropBox`; xoá siêu dữ liệu trước khi gửi |
| F9 | `pdftotext -layout` giữ bố cục cột | `pdf_text` ghép theo dấu xuống dòng của pdf.js | Thấp–vừa | Dễ | Dùng `extractTextItems` xếp theo y rồi x (chung với F4) |

## 6. Chung cho cả bốn định dạng

| # | Năng lực | Handio hiện nay | Ưu tiên | Khó | Cách làm đề xuất |
|---|---|---|---|---|---|
| C1 | Xuất trang ra ảnh để tự soát bằng mắt; lưới thumbnail (skill: `soffice` → PDF → `pdftoppm`) | `convert_to_pdf` có (Desktop có LibreOffice) nhưng không có bước trang → ảnh; agent không "nhìn" được PDF/slide | **Cao** | Vừa | Công cụ `render_pages` (path, pages, scale): Desktop dựng bằng `pdf.js` (`unpdf` đã có) vẽ lên canvas trong cửa sổ Chromium ẩn (cùng cơ chế `renderDesign`, đã hỗ trợ ra PNG), lưu PNG vào thư mục tạm của dự án; `read_image` xem. Word/Excel/PowerPoint đi qua `convert_to_pdf` nên cần LibreOffice. Web: `pdf.js` + canvas của trình duyệt, chỉ cho PDF |
| C2 | Chuyển định dạng cũ (`soffice --convert-to docx`) | Báo "Định dạng cũ … chưa đọc được, hãy mở bằng Word và lưu lại" | **Cao** | Dễ | `convertWithSoffice` (`node-env.ts`) đang cứng `--convert-to pdf`: tổng quát hoá thành tham số định dạng đích, thêm công cụ `convert_office` (`.doc/.xls/.ppt/.rtf/.odt` → `.docx/.xlsx/.pptx`, `.xlsm` → `.xlsx`). Chỉ Desktop có LibreOffice; web báo rõ |
| C3 | Mẫu `.dotx`, `.potx`, `.xltx` (đọc, điền, lưu) | Đuôi không được nhận | Vừa | Dễ | Cho phép các đuôi này trong `readdoc.ts`/`loadBinary`; khi lưu đổi content type phần chính (`…template.main+xml` → `…document.main+xml`) và đổi đuôi. `merge_documents` đã dùng `.docx` làm mẫu có `{{cột}}` |
| C4 | Soát "chữ giữ chỗ" còn sót trước khi giao (`lorem`, `TODO`, `XXX`, `[insert`) | Quy ước nội bộ dùng "[cần bổ sung]" có chủ đích; chưa có bước soát tự động | Thấp–vừa | Dễ | Không cần mã lõi: lệnh trong gói (`find_in_documents` + danh sách mẫu) chạy trước khi báo xong |

## 7. Rủi ro cần kiểm chứng

- **R1. `.xlsm` sau `xlsx_edit`:** `exceljs` ghi gói `.xlsx` (mất `vbaProject`) nhưng `prepareWrite` giữ đuôi gốc `.xlsm`, nên Excel có thể báo lỗi định dạng/đuôi. Chưa thử bằng Excel thật. Đề xuất: luôn lưu sang `.xlsx` như `redact_pii` đã làm.
- **R2. Ô công thức không có giá trị lưu sẵn** (hàm thiếu, xem X1): Excel tự tính khi mở (`fullCalcOnLoad`), nhưng trình xem nhanh, điện thoại, Zalo/email hiện trống hoặc 0.
- **R3. Mã `w:id` đánh dấu thay đổi** của `docxSuggest` bắt đầu cố định ở 90000: tệp đã có số rất lớn có thể trùng. Chưa kiểm chứng; nên lấy `max(id) + 1` khi làm W3.
- **R4. Đọc-ghi bằng `exceljs`** có thể làm mất bảng pivot, macro, liên kết ngoài (mô tả công cụ đã cảnh báo pivot/macro). Nên có `xlsx_audit` (X5) phát hiện trước khi lưu đè.

## 8. Thứ tự đề xuất

1. **Dễ, giá trị cao, làm ngay:** C2, X1, X2, X3, W2 (chỉ đọc), C4.
2. **Nền cho nhiều việc khác:** C1 (kéo theo F3, P1, F2), W7 (kiểm tra gói, dùng chung).
3. **Quy trình duyệt văn bản:** W1, W3, W4, W5, W10.
4. **Biểu mẫu và PDF:** F1 (quyết định có thêm `fontkit` hay không), F4, F5, F6.
5. **Để sau, khi có nhu cầu thật:** F7, X8, P3, W9.

Ràng buộc chung khi làm: tệp đầu ra luôn là tệp mới (không ghi đè bản gốc, như các công cụ hiện có); công cụ nào cần LibreOffice hoặc Chromium chỉ đăng ký khi `Env` có khả năng đó (như `convertToPdf`, `htmlToPdf`); mỗi công cụ mới cần mô tả tiếng Anh cho mô hình, thông báo lỗi tiếng Việt, kiểm thử riêng và tên trong `DIAG_TOOLS`.
