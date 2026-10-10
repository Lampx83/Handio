# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của NEU Agent (ứng dụng Desktop và bản web) được ghi ở đây, theo [Keep a Changelog](https://keepachangelog.com/vi/) và đánh số phiên bản [Semantic Versioning](https://semver.org/lang/vi/): **MAJOR** khi đổi không tương thích, **MINOR** khi thêm tính năng, **PATCH** khi sửa lỗi.
Mục "Chưa phát hành" là nơi ghi dần khi làm; `node scripts/version.mjs bump ...` chuyển nó thành mục của phiên bản mới và ghi chú này được đưa vào `latest.json` cho người dùng đọc trong ứng dụng. Viết cho **người dùng**, không phải cho lập trình viên.

## [Chưa phát hành]

### Sửa
- Góp ý/báo lỗi (nút 💬) và trang quản trị *Góp ý* chạy được trên máy chủ: bản 0.6.0 triển khai lần đầu thiếu một tệp nên máy chủ tự quay về bản trước; nay đã bổ sung và có kiểm tra chống tái diễn.

## [0.6.0] - 2026-10-10

### Thêm
- **Góp ý / báo lỗi cho nhóm phát triển**: nút 💬 trên thanh trên mở hộp góp ý (Báo lỗi, Đề xuất, Khen, Khác). Bạn tự viết và tự bấm gửi; góp ý được lưu ở máy chủ của trường kèm tên đăng nhập để nhóm liên hệ lại, và có thể gửi kèm thông tin kỹ thuật (phiên bản, hệ điều hành, tab, mô hình — không có nội dung hội thoại hay tệp). Quản trị viên xem, lọc, ghi chú và đặt trạng thái ở trang quản trị mục *Góp ý*.
- **Trang “Hướng dẫn sử dụng”** công khai (`/agent/guide/help.html`, xem được cả khi chưa đăng nhập): bắt đầu, ba chế độ Work/Code/Design, cách viết yêu cầu, các chế độ chạy, lệnh `/` và phím tắt, cài bản máy tính, hạn mức và riêng tư, xử lý sự cố, hỏi đáp. Có liên kết từ trang giới thiệu.
- **Trang quản trị: xem ai đã hết hạn mức token và cấp thêm nhanh** (`/agent/admin/quota`, chỉ quản trị viên): danh sách người đã hết hoặc gần hết hạn mức hôm nay (kèm tên/email nếu có), nút **+1 / +5 / +10 triệu token** có hiệu lực ngay đến hết ngày, nút **Bỏ** để thu hồi, và nhật ký ai đã cấp cho ai. Cần chạy lại `install-quota.sh` rồi `install-diag.sh` trên máy 220.

### Thay đổi
- **Hạn mức token mặc định của sinh viên tăng từ 1 triệu lên 5 triệu mỗi ngày** (giảng viên vẫn 10 triệu). Hướng dẫn trong ứng dụng, trang công khai và trang quản trị đã cập nhật số mới.
- **`/init` soạn `AGENTS.md` gọn và đúng trọng tâm hơn**: chỉ giữ những dòng mà thiếu thì agent làm sai (lệnh cài/chạy/kiểm thử, môi trường, quy ước khác mặc định, lỗi dễ gặp, điều không được làm); tự tạo `CLAUDE.md` một dòng `@AGENTS.md` nếu chưa có và kiểm tra `.gitignore` (`.env`, `.venv`…).
- **`/commit`** bám quy ước thông điệp commit của dự án (ví dụ `feat:`/`fix:`), không `git add` bừa, cảnh báo nếu thư mục sinh ra (`.venv`, `node_modules`) lẫn vào, và hỏi bạn trước khi `git init` ở thư mục chưa có Git.
- **Kế hoạch ở chế độ plan** luôn nêu mục tiêu, tệp sẽ sửa và tệp **không** đụng tới, các bước theo thứ tự kiểm chứng được, cách kiểm tra từng bước và câu hỏi cần bạn xác nhận.
- `/context` liệt kê riêng từng tệp hướng dẫn đang nạp (AGENTS.md, CLAUDE.md, quy tắc…) để biết tệp nào đã vào ngữ cảnh.
- **Bản cài Desktop nhẹ hơn, tải nhanh hơn**: bỏ các gói ngôn ngữ thừa (chỉ giữ tiếng Việt và tiếng Anh, nhẹ hơn ~8 MB) và nén lại bản macOS bằng LZMA (nhẹ hơn ~17%, khoảng 120 → 98 MB). Chức năng không đổi.
- **Bỏ dự án mẫu**: người dùng mới bắt đầu với dự án trống tên “Dự án của tôi” (Design: “Thiết kế của tôi”), không còn tệp mẫu tự nạp sẵn. Bản Desktop đã cài trước đây tự đổi tên dự án đầu tiên và chỉ xoá các tệp mẫu còn nguyên bản (tệp bạn đã sửa hay tự tạo được giữ nguyên). Bài học và dự án mẫu trong nút 📚 Học vẫn dùng được khi bạn cần.

## [0.5.0] - 2026-10-09

### Thêm
- **Tệp hướng dẫn nạp đầy đủ như Claude Code / Antigravity** (tab Code):
  - `@đường/dẫn` trong `AGENTS.md`/`CLAUDE.md` nạp kèm nội dung tệp được trỏ tới (tối đa 4 cấp). `CLAUDE.md` chỉ ghi `@AGENTS.md` nay đúng nghĩa: nội dung chỉ nạp một lần. Không nạp tệp bí mật, tệp ngoài dự án, đoạn mã hay email.
  - **Hướng dẫn toàn cục** `~/.neuagent/AGENTS.md` (áp dụng cho mọi dự án), nạp trước hướng dẫn của dự án.
  - **Hướng dẫn theo thư mục con**: `AGENTS.md`/`CLAUDE.md` trong `src/`… chỉ nạp khi agent đọc hoặc sửa tệp trong thư mục đó (có thông báo “Đã nạp hướng dẫn: …”).
  - **Quy tắc theo phạm vi** trong `.neuagent/rules/`, `.agents/rules/` (Antigravity) hoặc `.claude/rules/` (Claude Code): `trigger: always_on | glob | model_decision | manual`, `globs:` hoặc `paths:`. Quy tắc `glob` (ví dụ `*.py`) chỉ nạp khi agent đụng tới tệp khớp.

- **Dán ảnh bằng Ctrl+V** vào ô nhập (ảnh chụp màn hình, ảnh lỗi giao diện…): ảnh được lưu vào thư mục làm việc và `@tên-ảnh` được chèn vào prompt để agent đọc bằng `read_image`. `@ảnh.png` gõ tay cũng dùng được.
- **Sửa kế hoạch trước khi duyệt**: ở hộp duyệt kế hoạch bấm *Sửa kế hoạch* (hoặc Ctrl+G) để tự chỉnh nội dung; agent làm theo đúng bản bạn sửa.
- Lệnh mới: **`/plan [việc cần làm]`** (vào chế độ lập kế hoạch, có thể kèm yêu cầu), **`/memory`** (các tệp hướng dẫn đang nạp và quy tắc chưa nạp), **`/usage`** (token đã dùng trong phiên và hạn mức hôm nay), **`/effort high|low`** (bật/tắt suy luận sâu). Thêm chữ **`ultrathink`** vào một prompt để chỉ bật suy luận sâu cho lượt đó.
- **`/branch`** (hoặc `/fork`): tách nhánh hội thoại — sao chép cuộc trò chuyện hiện tại sang một cuộc mới (tiêu đề có “(nhánh)”) để thử hướng khác, bản gốc vẫn ở Lịch sử. Tệp trong thư mục làm việc vẫn dùng chung. `/memory` còn mở luôn khung sửa `AGENTS.md` của dự án.

### Thay đổi
- `AGENTS.md`/`CLAUDE.md` ở thư mục con và các tệp quy tắc luôn cần bạn duyệt khi agent muốn sửa (như `AGENTS.md` ở gốc).
- `/context` gọi mục hướng dẫn là “Hướng dẫn dự án” và tính cả các tệp nạp thêm.

## [0.4.0] - 2026-10-09

### Thêm
- **Đọc ảnh và bản scan (OCR)**: agent đọc ảnh chụp, ảnh scan, ảnh chụp màn hình (png, jpg, webp, gif) bằng chính mô hình — chữ tiếng Việt có dấu, bảng và biểu đồ. Thả ảnh vào dự án rồi nhờ đọc, hoặc dùng lệnh `/doc-anh` (ảnh → Word) và `/anh-thanh-bang` (bảng trong ảnh → Excel có công thức). Ảnh lớn được tự thu nhỏ. Chữ nhỏ, số tiền, ngày và số hiệu cần đối chiếu lại.
- **Tìm kiếm web có nguồn** (gói *Tìm kiếm web*): agent tìm trên web, đọc trang công khai và trả lời kèm địa chỉ nguồn, cả ở bản web lẫn Desktop. Mỗi người có giới hạn lượt tìm; từ khoá và địa chỉ trang không được kèm dữ liệu cá nhân. Địa chỉ nội bộ của trường bị chặn.
- **Công cụ HTTP của gói mở rộng** (`tools.json`): tổ chức nối agent với dịch vụ riêng mà không sửa mã lõi (xem `docs/EXTENSIONS.md`).
- Hướng dẫn trong ứng dụng có mục mới “Đọc ảnh, tìm web & lệnh mở rộng”.
- **Gói mở rộng**: thêm tính năng cho NEU Agent mà không sửa mã nguồn lõi (kỹ năng, lệnh `/tên`, subagent, lời dặn, công cụ MCP), nên triển khai cho tổ chức khác chỉ cần thay bộ gói. Gõ `/packs` để xem gói đang bật. Gói nằm trong dự án (`.neuagent/packs`) chỉ được có nội dung chữ, không chạy chương trình. Xem `docs/EXTENSIONS.md`.
- **Sáu gói đi kèm** (thư mục `packs/`): *Nghiên cứu có nguồn* (`/nghien-cuu`, `/so-sanh`, `/phan-bien`), *Công cụ cho giảng viên* (`/de-cuong-mon-hoc`, `/de-thi`, `/rubric`, `/nhan-xet-bai-lam`, `/bai-giang`), *Phân tích dữ liệu* (`/phan-tich`, `/lam-sach`, kỹ năng khảo sát Likert), *Chất lượng giao diện web* (`/soat-giao-dien`), *Đồng hành sinh viên* (`/do-an`, `/giai-thich-loi`, `/on-tap`), *Văn phòng tự động* (`/tong-hop-thu-muc`, `/doi-chieu`, `/soat-loi`).
- **Trang giới thiệu và hướng dẫn công khai** `https://ai.neu.edu.vn/agent/guide/` cho người chưa đăng nhập: ảnh chụp thật, demo từng bước (Work/Code/Design, dự án mẫu, Chỉ vào để sửa, học vibe coding), điểm nổi bật, 3 bước bắt đầu và hỏi đáp; trang đăng nhập có liên kết tới đó. Kèm **nhật ký thay đổi công khai** `/agent/guide/changelog.html` (tạo tự động từ CHANGELOG mỗi lần phát hành).
- **Hướng dẫn trong ứng dụng** (nút 💡 trên thanh trên, hoặc "Xem hướng dẫn" ở màn hình chào): hơn 70 mẹo, thủ thuật và tình huống mẫu riêng cho từng tab Code, Work, Design; có ô tìm kiếm, nút "Dùng thử" chèn sẵn câu mẫu vào ô nhập, mục "Khi gặp vấn đề", "Hạn mức và riêng tư" và "Có gì mới". Màn hình chào có mẹo ngắn luân phiên.
- **Nhật ký thay đổi xem được ngay trong ứng dụng**: nút "vX.Y.Z · Nhật ký thay đổi" ở cuối thanh bên cho biết mỗi phiên bản sửa gì, thêm gì (xem được cả khi không có mạng).
- **Chỉ vào để sửa** (tab Design): bấm nút 🎯 rồi bấm thẳng vào một phần của bản xem trước (tiêu đề, nút, khối…), chọn một sửa nhanh (To hơn, Đổi màu, Căn giữa, Viết ngắn lại, Xoá…) hoặc gõ vài chữ. Agent nhận đủ thông tin về phần đã chọn để tìm đúng chỗ trong tệp và chỉ sửa đúng chỗ đó. Bản xem trước vẫn không chạy script nào.
- Sau mỗi câu trả lời có hàng **"Câu trả lời có ích không? 👍 👎"** (👎 hỏi thêm lý do chọn sẵn, không cần gõ chữ). Chỉ hiện và chỉ gửi khi bạn đang bật gửi số liệu chẩn đoán; không kèm nội dung hội thoại.

### Thay đổi
- **Nói ít, ra sản phẩm hoàn thiện hơn**: một yêu cầu ngắn được coi là một bản mô tả đầy đủ. **Code** tự quyết chi tiết còn thiếu và làm ứng dụng hoàn chỉnh, đẹp, chạy được ngay (giao diện thích ứng, trạng thái trống/đang tải/lỗi, dữ liệu mẫu tiếng Việt, README) rồi tự rà soát; **Work** bớt hỏi, suy luận loại văn bản và thể thức rồi soạn trọn bộ (Word, Excel, PowerPoint chỉn chu); **Design** tự chọn hướng thiết kế và viết nội dung thật.
- **Cổng tự kiểm tra**: vừa tạo/sửa mà chưa chạy thử (Code) hay chưa đọc lại (Work, Design) thì agent được nhắc kiểm tra một lần trước khi báo "xong".
- Agent tiết kiệm token hơn: khi đọc lại cả một tệp đã đọc, kết quả đọc cũ được thay bằng một dòng ngắn; kết quả công cụ cũ được lược bớt sớm hơn khi ngữ cảnh phình to. Thước ngữ cảnh cập nhật ngay sau mỗi lần gọi mô hình.
- Chẩn đoán (không chứa nội dung) ghi thêm số đo token chi tiết và những tính năng được dùng, để cải tiến đúng chỗ.

## [0.3.0] - 2026-10-08

### Sửa
- Đăng nhập Desktop không còn lỗi khi đồng hồ máy bị lệch giờ (ứng dụng tự bù độ lệch so với máy chủ).

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
