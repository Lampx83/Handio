# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của NEU Agent (ứng dụng Desktop và bản web) được ghi ở đây, theo [Keep a Changelog](https://keepachangelog.com/vi/) và đánh số phiên bản [Semantic Versioning](https://semver.org/lang/vi/): **MAJOR** khi đổi không tương thích, **MINOR** khi thêm tính năng, **PATCH** khi sửa lỗi.
Mục "Chưa phát hành" là nơi ghi dần khi làm; `node scripts/version.mjs bump ...` chuyển nó thành mục của phiên bản mới và ghi chú này được đưa vào `latest.json` cho người dùng đọc trong ứng dụng. Viết cho **người dùng**, không phải cho lập trình viên.

## [Chưa phát hành]

### Thêm
- **Hạn mức token mỗi ngày** cho từng người dùng (sinh viên 1 triệu, giảng viên 10 triệu token; làm mới 00:00 giờ Việt Nam). Dưới ô nhập có nhãn nhắc khi đã dùng từ 80%; khi hết, được vượt thêm 10% để hoàn tất việc đang làm; sau đó thông báo rõ giờ được dùng lại. Xem `docs/QUOTA.md`.

## [0.2.0] - 2026-10-08

### Thay đổi
- Ô nhập prompt gọn hơn, giống Claude: dưới ô nhập có nút **+** đính kèm tệp, chế độ chạy (Hỏi trước, Tự động, …), mẫu prompt ở bên trái; bên phải là mô hình đang dùng (đổi được ở mọi tab), vòng tròn mức ngữ cảnh và nút gửi tròn. Gợi ý phím tắt nằm trong ô nhập.

### Sửa
- Khi chưa đăng nhập hoặc phiên đăng nhập hết hạn, ứng dụng nói rõ và có nút **Đăng nhập lại** (trước đây chỉ báo "hết phiên" mà không cho biết làm gì tiếp).
- Agent bớt "mò" khi sai đường dẫn: thông báo lỗi nay gợi ý đúng file/thư mục gần giống (hoặc liệt kê thư mục dự án), hướng dẫn rõ khi nhầm file với thư mục, hoặc cần đọc trước khi sửa, hoặc đường dẫn nằm ngoài dự án.
- `run_javascript`: nói rõ kết quả "chương trình/test của bạn chạy hỏng" khác với "dùng nhầm công cụ" (fs, mạng, DOM không có trong sandbox) và gợi ý cách khác.
- Agent ít bị lặp hơn: phát hiện thêm kiểu lặp qua lại giữa hai thao tác và một công cụ lỗi liên tiếp cùng lý do; khi bị dừng vì lặp, agent giải thích đang kẹt ở đâu và cần bạn cung cấp gì.
- Khi hết số bước cho phép, agent nhắc sớm khi còn ít bước và luôn kết thúc bằng một bản tóm tắt: đã làm gì, còn gì, bước tiếp theo.

### Thêm
- Ứng dụng Desktop đăng nhập được bằng **tài khoản tên + mật khẩu** do quản trị cấp (ngoài đăng nhập Microsoft); mật khẩu chỉ gửi một lần, ứng dụng chỉ giữ phiên.
- Chế độ chạy **Tự động**: agent tự lo việc thường ngày (sửa file, build, test, git) và chỉ hỏi khi việc quan trọng.
- Gửi thêm tin nhắn **khi agent đang làm việc**: agent nhận ở bước kế tiếp, không phải chờ hết lượt.
- Thông tin tài khoản ở thanh bên; gợi ý cách viết prompt.
- Chẩn đoán (không chứa nội dung) ghi thêm **mã lý do** khi công cụ lỗi, để biết lỗi do agent hay do chương trình của người dùng.
- Ứng dụng Desktop tự kiểm tra bản mới khi mở và mỗi 6 giờ; có thanh thông báo kèm "Có gì mới", nút **Tải về** (kiểm tra mã băm SHA-256 trước khi báo sẵn sàng) và **Để sau**. Không tự cài ngầm: bạn chủ động mở bản đã tải để cập nhật.
- Máy chủ có thể đặt phiên bản tối thiểu (`minVersion`): bản quá cũ sẽ được yêu cầu cập nhật.

## [0.1.0] - 2026-10-08

### Thêm
- Ba tab làm việc: **Code** (học và làm lập trình), **Work** (văn phòng: Word, Excel, PowerPoint, PDF) và **Design**.
- Dự án và lịch sử trò chuyện; kỹ năng, bộ nhớ, MCP; lộ trình học vibe coding.
- Đăng nhập một lần (SSO Microsoft 365) và tài khoản tên + mật khẩu do quản trị cấp.
- Bản cài Desktop cho macOS (Apple silicon và Intel) và Windows; bản web có thể cài như ứng dụng (PWA).
- Tự chẩn đoán không chứa nội dung để cải tiến chất lượng (có công tắc tắt trong Cài đặt).
