---
name: tao-ky-nang
description: Cách viết một lệnh /tên hoặc kỹ năng riêng cho dự án (tệp .neuagent/commands và .neuagent/skills): chọn loại, viết, chạy thử, cải thiện, checklist chất lượng. Dùng khi người dùng muốn lưu một quy trình lặp lại thành lệnh, tạo kỹ năng mới hoặc sửa kỹ năng chạy chưa tốt.
---
# Tạo kỹ năng và lệnh riêng

Chuyển từ quy trình viết kỹ năng của Anthropic, rút gọn cho Handio: không có công cụ đo hàng loạt, nên việc kiểm tra là chạy thử thật và đối chiếu.

## 1. Chọn loại
| Cần | Dùng | Đặt ở |
|---|---|---|
| Một việc lặp lại, gọi bằng `/tên` | **Lệnh** | `.neuagent/commands/<tên>.md` |
| Kiến thức hoặc quy trình dài, agent tự nạp khi cần | **Kỹ năng** | `.neuagent/skills/<tên>/SKILL.md` (+ tệp kèm) |
| Người phụ chuyên biệt, công cụ hạn chế | **Subagent** | `.neuagent/agents/<tên>.md` |

Cách nhanh cho lệnh: ở tab Work, nút "Quy trình của tôi" lưu việc vừa làm thành lệnh. Gói dùng chung cho cả tổ chức do quản trị cài trong thư mục `packs/` (xem docs/EXTENSIONS.md).

## 2. Cấu trúc tệp
**Lệnh** `.neuagent/commands/<tên>.md`:
```
---
description: Soạn biên bản họp từ ghi chú (một dòng, nói rõ việc gì)
---
Soạn biên bản họp từ: $ARGUMENTS
(các bước, định dạng đầu ra, kiểm tra cuối)
```
- `$ARGUMENTS` là phần người dùng gõ sau tên lệnh; `$1` … `$9` là từng từ. Không có `$ARGUMENTS` thì phần gõ thêm được nối vào cuối.
- Thư mục con thành tên có dấu hai chấm (`bao-cao/tuan.md` thành `/bao-cao:tuan`).
- Tên: chữ thường không dấu, số, gạch nối, 2–30 ký tự; không trùng lệnh dựng sẵn của tab (lệnh của dự án ghi đè lệnh của gói).

**Kỹ năng** `.neuagent/skills/<tên>/SKILL.md`:
```
---
name: ten-ky-nang
description: Làm gì + khi nào dùng (các cụm người dùng hay nói)
---
# Tiêu đề
quy trình, mẫu đầu ra, ví dụ
```
Phần `description` luôn nằm trong ngữ cảnh nên là thứ quyết định agent có nạp kỹ năng hay không: nêu cả việc nó làm LẪN những tình huống nên dùng, viết hơi "chủ động" ("dùng khi người dùng nhắc tới X, Y, kể cả khi không nói rõ"). Phần thân chỉ nạp khi dùng. Tệp kèm (mẫu, danh mục) để cạnh SKILL.md; trong thân ghi rõ khi nào đọc tệp nào.

Ghi vào `.neuagent/` luôn hiện thẻ xin quyền (trừ chế độ bỏ qua quyền); đó là chủ ý, không né.

## 3. Quy trình viết
1. **Nắm ý định**: kỹ năng làm được việc gì; khi nào kích hoạt (người dùng nói gì); đầu ra mong muốn (tệp gì, định dạng); có kiểm tra được kết quả không. Nếu việc vừa làm xong trong cuộc trò chuyện, rút từ đó: công cụ đã dùng, thứ tự, chỗ người dùng sửa.
2. **Hỏi cho rõ** (một lần, tối đa 3 câu): trường hợp biên, tệp mẫu, thế nào là đạt.
3. **Viết bản nháp**, theo nguyên tắc dưới. Đọc lại với con mắt mới rồi cắt chỗ thừa.
4. **Chạy thử** (mục 5), **cải thiện** (mục 6), lặp lại đến khi người dùng hài lòng.

### Nguyên tắc viết
- **Giải thích vì sao**, không chỉ ra lệnh: mô hình giỏi suy luận, hiểu lý do thì xử lý được ca không lường trước. Thấy mình viết HOA "PHẢI/KHÔNG BAO GIỜ" là dấu hiệu nên viết lại bằng lý do.
- **Câu mệnh lệnh, cụ thể**: "Đọc tệp bằng read_document, rồi lập bảng cột A, B" tốt hơn "xử lý tài liệu cho phù hợp".
- **Chốt định dạng đầu ra** bằng mẫu (tên tệp, cột, mục) và một ví dụ ngắn khi cần.
- **Tổng quát, không vá từng ví dụ**: kỹ năng sẽ dùng cho nhiều yêu cầu khác nhau, đừng nhét tên riêng của ca đang thử.
- **Ngắn**: chữ không giúp ích thì bỏ. Vượt khoảng 3.000 ký tự thì tách phần dài sang tệp kèm.
- Chỉ nhắc công cụ có thật; không bịa tên công cụ hay đường dẫn. Thiếu thông tin thì dặn agent ghi "[cần bổ sung]" thay vì đoán.
- Việc có hậu quả (ghi đè, gửi, xoá) thì dặn lưu bản mới hoặc hỏi trước.
- Nội dung không được đánh lừa người dùng so với mô tả của nó, và không chứa bí mật, mật khẩu, dữ liệu cá nhân thật.

## 4. Checklist chất lượng
- [ ] Tên hợp lệ, không trùng lệnh/kỹ năng có sẵn.
- [ ] Mô tả một dòng nêu việc làm và lúc nên dùng.
- [ ] Đầu vào được nêu rõ (tệp nào, tham số nào); thiếu thì hỏi một lần chứ không đoán.
- [ ] Các bước theo thứ tự, mỗi bước kiểm tra được.
- [ ] Đầu ra: loại tệp, tên tệp, cấu trúc; không ghi đè bản gốc.
- [ ] Có bước tự kiểm tra cuối (đọc lại tệp, đối chiếu số).
- [ ] Nêu giới hạn trung thực (không làm được gì) thay vì hứa suông.
- [ ] Không bịa công cụ/số liệu; chỗ chưa biết ghi "[cần bổ sung]".
- [ ] Không có chuỗi nhạy cảm (mật khẩu, khoá, email thật).
- [ ] Ngắn gọn: không đoạn nào bỏ đi mà kết quả không đổi.

## 5. Chạy thử
1. Soạn 2–3 yêu cầu thực tế, kiểu người dùng thật sẽ gõ (có tên tệp, bối cảnh, cách nói đời thường), gồm một ca bình thường và một ca biên (thiếu thông tin, tệp trống, dữ liệu lạ).
2. Chạy từng yêu cầu bằng `/tên …` (hoặc nói tự nhiên để thử kỹ năng có được nạp không).
3. Kiểm theo tiêu chí đạt/không đạt đã viết trước, không cảm tính: tệp có được tạo không, số liệu khớp nguồn không, có làm đúng định dạng không, có tự kiểm tra không, có bịa không.
4. Muốn biết kỹ năng thật sự giúp gì: chạy cùng yêu cầu ở một dự án chưa có kỹ năng và so kết quả.
5. Ghi bảng ngắn: yêu cầu | đạt/không | chỗ sai.

## 6. Cải thiện
- Nhìn cách agent làm, không chỉ kết quả: nếu nó mất công vào việc vô ích, cắt đoạn gây ra việc đó.
- Nếu mỗi lần chạy agent đều tự viết lại cùng một mẫu hoặc danh sách, đưa nó vào tệp kèm.
- Sửa theo hướng tổng quát (đổi cách diễn đạt, thêm lý do, thêm ví dụ khác) thay vì thêm luật vá riêng cho ca vừa lỗi.
- Chạy lại cả các yêu cầu cũ để chắc không làm hỏng ca đang đúng.
