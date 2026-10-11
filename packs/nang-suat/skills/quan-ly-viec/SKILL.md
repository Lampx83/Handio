---
name: quan-ly-viec
description: Quản lý việc cần làm bằng tệp VIEC-CAN-LAM.md trong dự án: thêm, đánh dấu xong, lùi hạn, đối chiếu hạn, nhóm theo dự án, xem lướt hôm nay.
---
# Quản lý việc cần làm

Việc của người dùng sống trong **một tệp văn bản** `VIEC-CAN-LAM.md` ở gốc dự án: người dùng tự mở sửa được, agent đọc và cập nhật được. Đây là việc lâu dài, khác với `todo_write` (checklist các bước trong một lượt làm việc, mất khi đóng phiên): không trộn hai thứ.

## Định dạng

Mỗi việc một dòng: tên in đậm, rồi các trường cách nhau bằng dấu " · ". Ngày luôn `dd/mm/yyyy`. Trường tuỳ chọn: `dự án`, `hạn`, `cho` (làm cho ai/ai giao), `chờ` + `từ` (chờ ai, từ ngày nào), `ưu tiên`. Dòng phụ thụt hai dấu cách là ghi chú.

```markdown
# Việc cần làm

## Đang làm
- [ ] **Soạn kế hoạch hội thảo** · dự án: Hội thảo AI · hạn: 20/10/2026 · cho: TS An
  - cần chốt địa điểm trước

## Chờ người khác
- [ ] **Dự toán kinh phí** · dự án: Hội thảo AI · chờ: Phòng KH-TC · từ: 05/10/2026

## Để sau

## Đã xong
- [x] ~~Gửi giấy mời~~ · xong: 08/10/2026
```

## Làm việc với tệp

- Chưa có tệp: tạo bằng `write_file` theo mẫu trên (không cần hỏi). Nếu thư mục đã có tệp việc khác đang dùng (TASKS.md, TODO.md, "Việc cần làm.md"), hỏi một lần bằng `ask_user`: dùng tệp đó hay tạo `VIEC-CAN-LAM.md`.
- Luôn `read_file` trước, rồi sửa bằng `edit_file` đúng dòng cần đổi; không viết lại cả tệp và không đụng các dòng khác.
- Không ghi mật khẩu, số căn cước, số tài khoản, thông tin cá nhân của người khác vào tệp.
- Không tự thêm việc từ tài liệu hay cuộc họp: liệt kê các việc tìm thấy và hỏi người dùng muốn thêm việc nào.

## Thao tác

- **Thêm**: ghi vào "Đang làm" (hoặc "Chờ người khác" nếu đang chờ ai). Hạn nói tương đối ("thứ Sáu tuần sau", "cuối tháng") thì đổi ra ngày thật bằng `date_calc` và nói lại ngày đã hiểu. Không có hạn thì để trống, không bịa hạn. Một câu có nhiều việc thì tách thành nhiều dòng.
- **Xong**: tìm việc khớp tên (nhiều việc khớp thì hỏi việc nào), đổi `[ ]` thành `[x]`, gạch ngang tên bằng `~~…~~`, thêm `· xong: <hôm nay>`, chuyển xuống "Đã xong".
- **Lùi hạn**: đổi `hạn`, thêm ghi chú `lùi từ dd/mm`. Việc đã lùi từ ba lần trở lên: nói với người dùng và hỏi nên bỏ, giao người khác hay chia nhỏ.
- **Đối chiếu hạn**: lấy ngày hôm nay từ phần Environment (không tự đoán). So từng hạn bằng `date_calc` (action diff, date = hôm nay, to = hạn; kết quả ghi "đã đảo lại" nghĩa là hạn đã qua). "Trong 3 ngày làm việc tới" tính bằng action workdays_add của chính công cụ đó, có xét cuối tuần và ngày lễ.
- **Nhóm theo dự án**: chỉ là cách trình bày trong câu trả lời (gom theo trường `dự án`, việc không có dự án xếp vào "Khác"); không đổi cấu trúc tệp trừ khi người dùng yêu cầu.
- **Dọn**: mục "Đã xong" quá 14 ngày thì đề nghị chuyển xuống mục "Lưu trữ" ở cuối tệp (chỉ làm khi người dùng đồng ý; không xoá hẳn).

## Nhìn lướt "hôm nay"

Trả lời gọn, đúng thứ tự, mục nào trống thì bỏ:

1. **Quá hạn**: tên việc, hạn, đã trễ bao nhiêu ngày.
2. **Đến hạn hôm nay**.
3. **Trong 3 ngày làm việc tới**.
4. **Chờ người khác** quá 7 ngày: chờ ai, từ ngày nào (gợi ý nhắc nhưng không tự gửi gì).
5. Một câu: nên bắt đầu từ việc nào và vì sao.

Không có việc nào gấp thì nói một câu như vậy, không độn thêm. Chỉ nêu điều có trong tệp; không suy ra việc mới.

## Rà soát việc tồn

Khi người dùng yêu cầu rà soát: liệt kê việc quá hạn, việc ở "Đang làm" quá 30 ngày (so với ngày trong dòng ghi chú hoặc `từ`), việc không có dự án hay người liên quan. Với mỗi việc đề nghị một hướng (xong rồi / lùi sang ngày / chuyển "Để sau" / bỏ) và chỉ sửa sau khi người dùng chọn.

## Xuất ra

Muốn bản in hoặc gửi đi: lập Word bằng `create_docx` hoặc bảng Excel bằng `create_xlsx` từ danh sách (tệp mới, không ghi đè `VIEC-CAN-LAM.md`).
