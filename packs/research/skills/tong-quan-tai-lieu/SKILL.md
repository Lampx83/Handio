---
name: tong-quan-tai-lieu
description: Tổng quan tài liệu nghiên cứu theo chủ đề: tìm nguồn thật, lập ma trận nghiên cứu, tổng hợp theo luận điểm, chỉ ra khoảng trống; không bịa trích dẫn.
---
# Tổng quan tài liệu (literature review)

Mục tiêu: cho thấy lĩnh vực đã biết gì, mâu thuẫn ở đâu, khoảng trống nào còn lại, bằng các nghiên cứu CÓ THẬT.

## 1. Xác định phạm vi
Câu hỏi tổng quan (một câu), khái niệm chính và từ đồng nghĩa, khoảng năm, ngôn ngữ, loại nghiên cứu (thực nghiệm, tổng quan hệ thống, lý thuyết). Mơ hồ thì chọn cách hiểu hợp lý nhất và ghi giả định. Có thư mục tài liệu của người dùng thì đọc trước (`find_in_documents`, `read_document`, `read_image` cho ảnh/scan).

## 2. Tìm và kiểm nguồn
- Tìm bằng `web_search` với từ khoá ngắn (thử tiếng Anh và tiếng Việt, thuật ngữ đồng nghĩa); mở từng bài bằng `fetch_page` (hoặc `web_fetch`) để đọc tóm tắt/đoạn liên quan, không chỉ đọc đoạn trích.
- Một nguồn chỉ vào danh sách khi đã thấy đủ tác giả, năm, tên bài, nơi đăng (và DOI nếu có) trên trang thật. Thiếu một thành phần thì ghi "[cần bổ sung: …]"; không "nhớ" ra tên bài, tác giả hay số liệu.
- Ưu tiên bài gốc đã bình duyệt, bài tổng quan có hệ thống, công trình được trích nhiều, rồi tới công trình gần đây. Bài tiền công bố (preprint) ghi rõ là chưa bình duyệt.
- Không tìm được công cụ web thì chỉ dùng tài liệu người dùng đưa và nói rõ phạm vi bị giới hạn; đừng tự bổ sung từ trí nhớ.

## 3. Ma trận nghiên cứu
Với mỗi nguồn ghi: tác giả-năm, bối cảnh/đối tượng, thiết kế và cỡ mẫu, khái niệm/độ đo, phát hiện chính, hạn chế. Tab Work: làm thành bảng Excel (`create_xlsx`) để lọc theo chủ đề (tab khác: bảng Markdown); chỉ ghi điều đã đọc thấy, ô chưa biết để "chưa rõ".

## 4. Tổng hợp theo chủ đề, không liệt kê
- Nhóm theo ý/khái niệm (không theo thời gian hay tên tác giả): mỗi nhóm nói điều đã ổn, điều còn tranh luận (nêu cả hai phía, mỗi phía một nguồn), và rìa chưa giải quyết.
- Mỗi nhận định đi kèm nguồn đặt ngay cạnh nó; nhận định rộng có thể gộp vài nguồn, điểm cụ thể chỉ nguồn thật sự cho thấy điều đó.
- Mức chắc chắn cho từng kết luận: Cao (nhiều nghiên cứu độc lập khớp), Vừa (một nghiên cứu tốt), Thấp (suy luận hoặc nguồn yếu).
- Cuối cùng: **khoảng trống** (kết luận rút từ những gì các nguồn không làm được) và câu hỏi nghiên cứu gợi ý.

## 5. Sản phẩm
Tab Work: Word mới bằng `create_docx` (mục lục nếu dài): Phạm vi và cách tìm → Tổng hợp theo chủ đề → Khoảng trống → Danh mục tài liệu (APA-7) → phụ lục ma trận. Tab khác: tệp Markdown. Nêu rõ số nguồn đã mở đọc, số chưa kiểm được, và những gì chưa tìm thấy. Viết bài báo khoa học hoàn chỉnh: nếu có gói nghien-cuu-khoa-hoc thì nạp skill `quy-trinh-bai-bao`.
