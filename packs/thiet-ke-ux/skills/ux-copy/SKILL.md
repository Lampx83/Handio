---
name: ux-copy
description: Viết hoặc rà soát lời giao diện tiếng Việt: nhãn nút, thông báo lỗi, trạng thái rỗng, hộp thoại xác nhận, chú thích, giới thiệu. Dùng khi cần đặt tên nút, "nút này nên ghi gì", viết thông báo lỗi, hoặc rà các chuỗi chữ trong một tệp HTML.
---
# Lời giao diện (UX copy) tiếng Việt

## Cần có
Bối cảnh (màn hình, luồng, tính năng), trạng thái người dùng (đang làm gì, đang cảm thấy gì), giọng điệu (trang trọng, thân thiện, vui), ràng buộc (giới hạn ký tự, nền tảng). Thiếu mà quan trọng thì hỏi một lần; có tệp HTML thì đọc để hiểu ngữ cảnh thay vì hỏi.

## Nguyên tắc
Rõ (nói đúng điều muốn nói, không biệt ngữ) · Gọn (ít chữ nhất mà đủ ý) · Nhất quán (một khái niệm một từ) · Hữu ích (mỗi chữ giúp người dùng làm được việc) · Như người (giống người giúp đỡ, không như máy).

## Quy ước tiếng Việt
- Xưng hô: gọi người dùng là "bạn" (hoặc bỏ xưng hô: "Lưu thay đổi"); "quý khách" chỉ khi tổ chức yêu cầu trang trọng. Hệ thống không xưng "tôi" trừ khi là trợ lý trò chuyện.
- Một khái niệm một từ trong cả giao diện ("Đăng nhập", không lúc "Login" lúc "Đăng nhập"); chọn một cách bỏ dấu (hòa/hoà) rồi giữ.
- "Vui lòng" chỉ dùng khi thật sự nhờ; lặp ở mọi câu nghe như máy. Tránh dịch sát tiếng Anh ("Bấm vào đây", "Có lỗi đã xảy ra"). Không viết hoa toàn bộ, không dấu chấm than liên tiếp.
- Dấu tiếng Việt gõ đúng; số và ngày theo kiểu Việt (1.234.567; 25/11/2026), đơn vị tiền ghi nhất quán.

## Mẫu theo loại
- **Nút (CTA)**: động từ + đối tượng, cụ thể, khớp kết quả: "Lưu thay đổi", "Tạo tài khoản", "Tải báo cáo". Tránh "OK", "Gửi", "Bấm vào đây". Gọn, khoảng ≤ 25 ký tự.
- **Lỗi**: chuyện gì xảy ra + vì sao + cách sửa, không đổ lỗi cho người dùng, không chỉ có mã lỗi. "Thanh toán không thành công. Ngân hàng đã từ chối thẻ này. Hãy thử thẻ khác hoặc liên hệ ngân hàng."
- **Trạng thái rỗng**: đây là gì + vì sao đang trống + bắt đầu thế nào. "Chưa có dự án nào. Tạo dự án đầu tiên để bắt đầu làm việc cùng nhóm."
- **Xác nhận**: nêu hành động và hậu quả; nút ghi theo hành động. "Xoá 3 tệp? Không thể hoàn tác." với nút "Xoá tệp" / "Giữ lại", không phải "Có" / "Không" hay "OK" / "Huỷ".
- **Chú thích (tooltip)**: ngắn, có ích, không nhắc điều hiển nhiên. **Đang tải**: đặt kỳ vọng, giảm lo lắng. **Giới thiệu**: mỗi lần một ý, chia nhỏ.
- **Giọng theo ngữ cảnh**: thành công thì vui vừa phải; lỗi thì thông cảm và chỉ cách làm; cảnh báo thì rõ và có việc cần làm; thông tin thì gọn.

## Chế độ rà soát
Khi có tệp HTML hoặc đoạn chữ: lấy mọi chuỗi hiển thị (grep nội dung giữa thẻ, placeholder=, aria-label=, alt=, title=), rồi kiểm và ghi số dòng:
- thuật ngữ không nhất quán; lẫn Anh–Việt; chữ giả (lorem ipsum);
- nút chung chung ("OK", "Gửi", "Submit", "Bấm vào đây"); nút dài > ~25 ký tự;
- lỗi thiếu cách sửa; placeholder thay nhãn; IN HOA; chấm than lặp; "vui lòng" dày đặc.

## Mẫu đầu ra
```
## Lời giao diện: [bối cảnh]
### Đề xuất
**[Phần tử]**: [chữ]
### Phương án khác
| Phương án | Chữ | Giọng | Dùng khi |
| A | ... | ... | ... |
| B | ... | ... | ... |
| C | ... | ... | ... |
### Lý do
[Vì sao hợp: bối cảnh người dùng, rõ ràng, thúc đẩy hành động]
### Ghi chú bản địa hoá
[Thành ngữ cần tránh khi dịch; chữ có thể dài hơn tiếng Anh nên chừa chỗ; không ghép chuỗi bằng cách nối câu vì trật tự từ khác nhau; giữ dòng cao ≥ 1,4 cho chữ có dấu]
```
Ở chế độ rà soát, thay "Đề xuất" bằng bảng: dòng | chữ hiện tại | vấn đề | chữ đề xuất. Chỉ sửa tệp khi được yêu cầu (edit_file, bản -v2).
