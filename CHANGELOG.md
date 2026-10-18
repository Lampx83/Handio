# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của NEU Agent (ứng dụng Desktop và bản web) được ghi ở đây, theo [Keep a Changelog](https://keepachangelog.com/vi/) và đánh số phiên bản [Semantic Versioning](https://semver.org/lang/vi/): **MAJOR** khi đổi không tương thích, **MINOR** khi thêm tính năng, **PATCH** khi sửa lỗi.
Mục "Chưa phát hành" là nơi ghi dần khi làm; `node scripts/version.mjs bump ...` chuyển nó thành mục của phiên bản mới và ghi chú này được đưa vào `latest.json` cho người dùng đọc trong ứng dụng. Viết cho **người dùng**, không phải cho lập trình viên.

## [Chưa phát hành]

### Thêm
- **Nút DESIGN.md trên khung xem trước Design**: có tệp thì mở để xem, sửa; chưa có thì nhờ agent tạo (như gõ `/designmd`).
- **Chỉ vào để sửa nhiều chỗ một lần**: chọn một phần, gõ yêu cầu, bấm **+ Ghi chú**, chọn tiếp phần khác… rồi **Gửi** một lần. Mỗi ghi chú có số thứ tự trên bản xem trước, bỏ từng cái được; tối đa 8 ghi chú mỗi lần.
- **Tab Code: chạy lệnh trong container Docker** (Desktop, tuỳ chọn): bật ở Cài đặt → Quyền → "Chạy lệnh trong container Docker". Lệnh của agent chỉ thấy thư mục dự án, không thấy phần còn lại của máy, không chạy bằng quyền quản trị, mặc định không ra mạng. Bật "Cho ra mạng" để cài gói (npm/pip, có cache riêng cho từng dự án) và đặt "Cổng xem trước" (ví dụ 5173) để mở web đang chạy trong container. Cần Docker Desktop; Docker không chạy thì lệnh chạy như cũ và ứng dụng báo rõ. Quản trị viên có thể bắt buộc dùng container (`requireContainer` trong `policy.json`).
- **Tác vụ định kỳ làm được nhiều hơn** (nút ⏰): thêm lịch **một lần** vào ngày giờ định sẵn; bản Desktop chạy được cả dự án chưa mở; mỗi lần chạy được lưu thành cuộc trò chuyện "⏰ tên" để xem lại hoặc nhắn tiếp; thông báo của hệ thống khi xong/lỗi (tắt được); xem lần tới/lần trước, dừng giữa chừng và hoàn tác một lần chạy.
- **Nhóm người dùng tuỳ tạo** (quản trị viên): gán email hoặc tài khoản vào nhóm như một lớp học hay nhóm giảng viên, rồi đặt riêng cho nhóm hạn mức token/ngày, tab được dùng, mô hình được dùng và hạn mức token riêng cho từng tab. Sửa ngay trên trang quản trị *Hạn mức* (dán cả danh sách email) hoặc bằng `quota.sh group`, có hiệu lực từ yêu cầu kế tiếp. Trang này cũng hiện cấu hình theo bậc, và trang quản trị đếm số yêu cầu bị từ chối theo lý do. Chưa tạo nhóm nào thì mọi thứ như cũ.

### Thay đổi
- **Chỉ vào để sửa riêng tư hơn**: phần trích từ thiết kế gửi cho agent nay tự che giá trị ô nhập (kể cả mật khẩu), chữ trong ô nhập nhiều dòng, dữ liệu nhúng dài, chú thích ẩn và token/mật khẩu trong đường dẫn.
- **Thông báo rõ khi nhóm của bạn không được dùng mô hình đang chọn** hoặc đã hết hạn mức riêng của một tab (các tab khác vẫn dùng được), thay vì báo lỗi key chung chung.
- **Chỉ hiện mô hình bạn được dùng**: danh sách mô hình ở Cài đặt và nút chọn mô hình chỉ còn mô hình nhóm của bạn được phép. Không còn mô hình nào thì nút **Kiểm tra** báo rõ để liên hệ quản trị viên. Chưa giới hạn mô hình thì như cũ.

## [0.8.21] - 2026-10-18

### Thêm
- **Mục "Tải về" trên trang giới thiệu**: chọn bản macOS (chip Apple/Intel), Windows hoặc bản web, kèm cách mở khi hệ điều hành cảnh báo lần đầu và cách kiểm tra mã SHA-256. Hỏi đáp có link tới chính sách quyền riêng tư.
- **DESIGN.md cho từng dự án Design**: ghi màu, phông, khoảng cách và giọng điệu vào `DESIGN.md` ở thư mục dự án, agent đọc và làm theo ở mọi thiết kế. Sửa tệp lúc nào cũng được, có hiệu lực từ tin nhắn kế tiếp. Chưa có thì gõ `/designmd` để agent tạo bản mẫu (hoặc rút từ thiết kế đang có).
- **Phân quyền tab theo nhóm người dùng**: quản trị viên có thể chỉ cho một nhóm (theo miền email, ví dụ sinh viên `@st.neu.edu.vn` hoặc giảng viên/cán bộ `@neu.edu.vn`) dùng một số tab Work/Code/Design. Tab không được dùng sẽ ẩn, và máy chủ từ chối yêu cầu của tab đó kèm thông báo rõ. Mặc định chưa cấu hình thì mọi người vẫn dùng cả ba tab như trước.
- **Tác vụ định kỳ** (nút ⏰): hẹn giờ để agent tự làm lại một việc, mỗi N phút (từ 30 phút), hằng ngày hoặc hằng tuần; xem danh sách, bật/tắt, xoá, "Chạy ngay" và xem kết quả lần chạy gần nhất. Chỉ chạy khi ứng dụng (hoặc tab web) đang mở; lỡ giờ hẹn quá 6 giờ thì bỏ qua. Vì không có người ngồi trước, tác vụ chỉ được sửa tệp trong dự án: lệnh, mạng, tệp nhạy cảm bị từ chối. Tối đa 12 lần/ngày mỗi tác vụ và dừng khi hết hạn mức token.
- **Tải bản cài macOS và Windows ngay trên trang giới thiệu**: đầu trang có nút tải bản mới nhất cho macOS (chip Apple hoặc Intel) và Windows, kèm mã SHA-256, không cần đăng nhập trước. Mở ứng dụng vẫn cần đăng nhập tài khoản trường.
- **Trang chính sách quyền riêng tư** (`/agent/guide/privacy.html`, tiếng Việt và tiếng Anh): ứng dụng dùng dữ liệu nào, gửi đi đâu, giữ bao lâu, cách tắt hoặc yêu cầu xoá. Có link ở chân trang giới thiệu và trang hướng dẫn.
- **Chuẩn bị bản Windows trên Microsoft Store**: cài từ Store sẽ không còn cảnh báo "nhà phát hành không xác định", và Store tự cập nhật ứng dụng (bản cài từ Store ẩn mục "Kiểm tra bản cập nhật" trong menu Tệp).
- **Kiểm tra sức khoẻ máy chủ thử chat thật** (quản trị viên): mỗi 15 phút gửi một câu rất ngắn tới mô hình và đo thời gian ra chữ đầu, nên mô hình treo không còn bị báo "tốt". Trang quản trị và tin cảnh báo nhắc trước 30 ngày khi chứng chỉ HTTPS hoặc mã bí mật đăng nhập Microsoft sắp hết hạn (khai ngày ở `/etc/neu-agent/entra-secret-expires`, rồi chạy lại `install-diag.sh`).
- **Máy chủ tự sao lưu dữ liệu mỗi đêm**: góp ý, liên kết chia sẻ, hạn mức, tài khoản được sao lưu mã hoá (chỉ quản trị viên giữ khoá giải mã) và có thể gửi sang máy khác, để không mất khi hỏng ổ đĩa.
- **Quản trị viên được cảnh báo khi sao lưu có vấn đề**: lần sao lưu gần nhất lỗi, quá 36 giờ chưa có bản mới, hoặc chưa gửi được sang máy khác đều hiện ở trang quản trị và gửi tin cảnh báo.

### Thay đổi
- **Chia sẻ cuộc trò chuyện đầy đủ hơn để nhóm phát triển hiểu và sửa lỗi**: bản chia sẻ nay gồm cả các thao tác của agent (lệnh, tệp đã ghi/sửa) kèm phần đầu kết quả, chỗ nào bị lỗi, lời nhắc của hệ thống, cùng phiên bản, mô hình và chế độ đang dùng. Khoá/mật khẩu và dữ liệu cá nhân vẫn được tự che; tệp bạn đính kèm bằng @ không được gửi.
- **Tab Code tự bấm thử ứng dụng web trước khi báo xong** (Desktop): trước đây agent chỉ mở trang xem có lỗi lúc tải, nên có khi báo "xong" mà bạn vừa bấm "Bắt đầu làm bài" là ứng dụng hỏng. Nay agent bấm các nút chính, gõ vào ô nhập và kiểm tra kết quả hiện ra trong một cửa sổ ẩn; lỗi phát sinh ở bước nào thì tự sửa rồi chạy lại đúng luồng đó. Hộp thoại của trang (alert/confirm) không bật lên màn hình của bạn.
- **Số liệu quản trị đúng hơn**: bản web nay báo số phiên bản thật (trước đây luôn ghi 0.1.0 nên không phân biệt được các bản), tỷ lệ "đã cập nhật" và cảnh báo "máy chạy bản cũ" chỉ tính máy Desktop (web luôn mới nhất), và bảng «Công việc người dùng làm» phân loại thêm tin nối tiếp ("ok", "làm tiếp đi") và câu hỏi để ít bị xếp vào "khác".

### Sửa
- **Agent không còn sửa đi sửa lại một chỗ đã sửa xong**: khi đoạn cần thay không còn nhưng tệp đã có sẵn nội dung mới, agent được báo "không cần sửa" thay vì lỗi rồi thử lại.
- **Agent không còn "quên" sau khi tóm tắt ngữ cảnh** (cuộc trò chuyện dài): ngoài bản tóm tắt, agent luôn được nhắc lại nguyên văn yêu cầu gần nhất của bạn, các tệp đã tạo/sửa, danh sách việc và máy chủ đang chạy, nên không làm lại từ đầu hay bật lại máy chủ.
- **Agent không còn bật đi bật lại máy chủ web**: lệnh chạy máy chủ (`npm run dev`, `streamlit run`…) tự chạy nền; máy chủ đang chạy mà chưa có tệp nào đổi thì giữ nguyên thay vì tắt rồi bật lại (vòng lặp hay gặp nhất trong số liệu).
- **Agent nhận ra mình đang giậm chân tại chỗ sớm hơn**: làm lại đúng một thao tác mà ra đúng kết quả cũ (kể cả xen giữa các thao tác khác) thì được nhắc ở lần 3 và dừng ở lần 4; 6 thao tác lỗi liên tiếp thì dừng để hỏi bạn thay vì thử mãi. Sửa tệp giữa các lần chạy thì không tính.
- **Tiêu đề cuộc trò chuyện bắt đầu bằng ảnh dán** không còn hiện `@dan/anh-dan-….png` mà dùng chính câu bạn gõ (chỉ có ảnh thì ghi "Ảnh đính kèm").
- **Chia sẻ báo "Cuộc trò chuyện chưa có nội dung để chia sẻ" dù đã trò chuyện nhiều lượt**: xảy ra sau khi agent tự tóm tắt hội thoại để giải phóng ngữ cảnh. Nay phần trước khi tóm tắt được giữ lại, nên vẫn chia sẻ được toàn bộ và lịch sử đã lưu không mất phần đầu.
- **Chọn "Toàn quyền" rồi mà agent vẫn hỏi từng lệnh**: khi mở lại cuộc trò chuyện (kể cả sau khi ứng dụng tự cập nhật), tạo cuộc trò chuyện mới hay lưu hướng dẫn dự án, chế độ bị trả về mặc định nhưng nhãn dưới ô nhập vẫn ghi "Toàn quyền". Nay chế độ bạn chọn được giữ trong cùng dự án, và nhãn luôn đúng với chế độ thật.
- **Vá lỗ hổng bảo mật (mức thấp) của thư viện hiển thị công thức toán** (KaTeX), cập nhật lên bản 0.18.2. Công thức hiển thị như cũ.

## [0.8.20] - 2026-10-15

### Sửa
- **Agent không còn xoá mất nội dung tệp khi làm việc lâu** (tab Code): trước đây trong cuộc trò chuyện dài, agent đôi khi ghi một dòng kiểu `[16547 ký tự đã ghi vào tệp…]` đè lên tệp thật (ví dụ toàn bộ CSS biến mất) hoặc sửa mã mãi không khớp. Nay việc ghi như vậy bị chặn và agent được nhắc đọc lại tệp trước khi sửa.
- **Agent sửa tệp ít bị trượt "Không tìm thấy old_string" hơn**: khi đoạn agent chép lại lệch tệp thật chỉ vì thụt dòng, dấu cách thừa, dòng trống thiếu/thừa, lỡ kèm số dòng, kiểu xuống dòng Windows (CRLF) hay dạng gõ dấu tiếng Việt khác nhau, agent vẫn sửa được, nhưng chỉ khi đoạn đó là duy nhất trong tệp (và báo rõ là đã khớp gần đúng). Tệp CRLF giữ nguyên kiểu xuống dòng sau khi sửa. Khi vẫn không khớp, agent được chỉ ra đúng dòng nào khác với tệp, nên lần sửa sau trúng ngay.

## [0.8.19] - 2026-10-12

### Thêm
- **Câu trả lời hiển thị đầy đủ hơn**: danh sách lồng nhau và có dòng trống giữa các mục (số thứ tự không còn quay về 1), việc cần làm `- [ ]`/`- [x]` thành ô tích, chữ gạch ngang `~~…~~`, bảng canh lề trái/giữa/phải, ghi chú `> [!NOTE]`/`[!TIP]`/`[!WARNING]` có màu, trích dẫn nhiều dòng, địa chỉ web tự thành liên kết, `<br>`, `<kbd>`, `<sub>`, `<sup>`, ngắt trang `<<<pagebreak>>>`, và tô màu mã (JavaScript, Python, JSON, HTML, CSS, SQL, shell…).
- **Ảnh trong câu trả lời**: ảnh có trong dự án (`![mô tả](charts/bieu-do.png)`) hiện ngay tại chỗ, bấm để phóng to. Ảnh từ mạng chỉ hiện thành liên kết, không tự tải (tránh bị dò thông tin qua ảnh).

### Sửa
- **Nút "Sao chép" (liên kết chia sẻ, khối mã, mã băm) bấm không được trên ứng dụng Desktop** do bị chặn quyền clipboard: nay sao chép được, và nút chỉ còn biểu tượng (đổi thành dấu ✓ khi xong).

### Sửa
- **Thông báo "Có bản mới / Đã tải xong" không còn bị hộp Nhật ký thay đổi che**: khi bản cập nhật vừa xuất hiện hoặc vừa tải xong ở góc dưới bên phải, hộp Nhật ký đang mở tự đóng để bạn thấy nút "Cài đặt và khởi động lại".

## [0.8.18] - 2026-10-12

### Thay đổi
- **Dán ảnh vào ô chat giờ hiện ngay ảnh** (ảnh nhỏ phía trên ô nhập, có nút ✕ để bỏ), thay vì chèn chữ kiểu `@dan/anh-dan-….png`. Khi gửi, ảnh hiện trong tin nhắn của bạn (bấm để phóng to), kể cả khi mở lại cuộc trò chuyện cũ. Chỉ gửi ảnh không kèm chữ cũng được.

## [0.8.17] - 2026-10-12

### Sửa
- **Công thức toán hiện đẹp thay vì mã thô**: câu trả lời có `$k \ge 2$`, `$$\frac{a}{b}$$`, `\begin{cases}…\end{cases}`, `\sqrt`, tổng, tích phân… được vẽ thành công thức (phân số, căn, hệ phương trình có ngoặc nhọn…). Tiền như "$5" hay "10$" không bị nhận nhầm; công thức lỗi cú pháp hiện nguyên mã.

## [0.8.16] - 2026-10-12

### Thêm
- **Nhật ký chất lượng biết người dùng làm việc gì (không thu nội dung)**: mỗi lượt kèm thêm các mã do ứng dụng tự phân loại trên máy bạn: loại việc (tạo mới/sửa/sửa lỗi…), sản phẩm (web, Word, Excel…), bộ khung dự án, và kết quả kiểm chứng cuối. Trang quản trị và báo cáo hằng ngày thêm bảng «Công việc người dùng làm» và cảnh báo khi người dùng hay phải yêu cầu làm lại. Câu hỏi, tên tệp, đường dẫn, lệnh vẫn không bao giờ rời máy bạn; tắt được ở Cài đặt như trước.
- Bản cũ hơn **0.8.10** sẽ được yêu cầu cập nhật (hộp thoại "Cần cập nhật"), vì các bản đó thiếu nhiều sửa lỗi quan trọng.

### Sửa
- **Sửa file bằng `edit_file` ít hỏng hơn**: khi đoạn cần thay không khớp, kết quả trả luôn vài dòng thật quanh vị trí giống nhất (kèm số dòng) để agent chép đúng ngay, không phải đọc lại cả file.
- **Tệp đang mở trong Word/Excel/PowerPoint** (Windows): mọi công cụ ghi tệp đều báo bằng lời dễ hiểu (đóng tệp rồi thử lại hoặc ghi sang tên khác) thay vì "Lỗi nội bộ: EBUSY".
- **Hết hạn mức luôn hiện đúng là hết hạn mức**, kể cả khi máy chủ trả mã 402 không kèm nội dung chuẩn.
- **Lệnh `timeout` không có trên macOS**: khi agent gõ `timeout 10 npm run dev`, kết quả gợi ý dùng tham số timeout của công cụ bash.
- **Agent gõ tên công cụ vào bash** (ví dụ `kill_process p1`) không còn nhận "command not found" rồi thử lại: lệnh bị chặn kèm lời chỉ gọi thẳng công cụ.

## [0.8.15] - 2026-10-12

### Sửa
- **Agent không còn đọc đi đọc lại cùng một bộ tệp mãi** (phiên làm từ 5 tệp trở lên): cơ chế rút gọn ngữ cảnh chỉ giữ 4 kết quả gần nhất nên tệp đọc sớm nhất bị lược, agent đọc lại nó, lại lược tệp kế tiếp… thành vòng lặp tốn token. Nay kết quả đọc tệp gần đây được giữ (tới một phần tư cửa sổ ngữ cảnh), và vòng lặp chuỗi 3–6 thao tác giống hệt bị cảnh báo rồi dừng.
- **Cuộc trò chuyện mới ở tab Code không phải khám phá lại thư mục**: lời nhắc kèm sẵn cây thư mục dự án hai cấp (bỏ thư mục sinh ra và tệp ẩn), nên agent vào việc ngay thay vì gọi list_dir/đọc nhiều tệp để biết dự án có gì.
- **Agent không còn "quên việc chính" khi sa vào sửa lỗi phụ**: làm việc A, gặp lỗi X rồi sửa mãi mà quên A. Nay cứ khoảng 8 bước (hoặc sớm hơn khi các lệnh gần nhất liên tiếp lỗi) hệ thống nhắc lại đúng câu bạn giao kèm danh sách việc cần làm; agent được dặn chỉ sửa việc phụ ở mức tối thiểu rồi quay lại việc chính, và nếu kẹt thì nói rõ thay vì sửa mãi.

## [0.8.14] - 2026-10-12

### Sửa
- **Bỏ con số hạn mức cố định khỏi hướng dẫn và trang giới thiệu** ("sinh viên 5 triệu, giảng viên 10 triệu"): mức thực tế do quản trị đặt theo từng nơi nên có thể khác; mức của bạn luôn hiện ở thanh dưới ô nhập.
- **Windows: nhận cả Anaconda/Miniconda** (python.exe ở gốc thư mục cài, ví dụ `C:\Users\<tên>\Anaconda3`): thư mục này (kèm Scripts và Library\bin) cũng được thêm vào PATH của lệnh agent chạy, sau bản Python từ python.org.
- **Agent không còn "đi vòng" tốn token khi thiếu một công cụ**: thiếu Python/sqlite… sau hai lần tìm không ra thì dừng, nói rõ thiếu gì và một bước để sửa, thay vì thử hết cách khác (đã gặp: chuyển sang dựng trang HTML kiểm thử, đốt hết hạn mức ngày).

## [0.8.13] - 2026-10-12

### Sửa
- **Windows: cài Python xong ứng dụng vẫn báo "Python was not found"**: PATH của ứng dụng chỉ đọc một lần lúc khởi động nên Python vừa cài (hoặc cài mà không tick "Add to PATH") không được thấy, và bí danh Microsoft Store lại hiện lỗi. Nay ứng dụng đọc lại PATH trong registry và tự thêm thư mục cài Python (Python3xx và Scripts) lên đầu PATH của lệnh agent chạy; khi vẫn không thấy, kết quả lệnh kèm gợi ý cụ thể (py -3, đường dẫn đầy đủ, ghi vào AGENTS.md) để agent tự xử lý thay vì bắt bạn sửa.

## [0.8.12] - 2026-10-12

### Sửa
- **Trang "Nhật ký thay đổi" công khai tự cập nhật** (/agent/guide/changelog.html): trước đây dừng ở bản 0.6.0 vì chỉ được dựng lại khi triển khai tay; nay dựng lại từ CHANGELOG.md mỗi lần triển khai.
- **Tab Design: thiết kế cao không còn kéo cả trang lên**: trước đây thiết kế dài (landing page, slide cao) làm cuộn cả cửa sổ, đẩy chân thanh bên (tên người dùng, phiên bản) lên giữa màn hình. Nay chỉ khung xem trước cuộn.

### Thay đổi
- **Trang giới thiệu công khai gọn và cập nhật**: bỏ các thẻ chữ đè lên hình hai cánh tay và mục "Làm được nhiều hơn…" (trùng phần đầu trang), rút gọn câu thừa và lặp, thêm các tính năng mới (nhiều dự án cùng lúc, sửa tệp trong ứng dụng, tự mở thử trang web). Năm mục dưới tiêu đề bấm được, dẫn tới phần giải thích. Ảnh demo chụp lại từ bản hiện tại (giao diện tối, có chữ N). Biểu tượng trang là chữ N của NEU Agent.

## [0.8.11] - 2026-10-12

### Thêm
- **Bản triển khai tại NEU giữ tên "NEU Agent" và biểu tượng chữ N**: biểu tượng ứng dụng (Dock, thanh tác vụ), biểu tượng trình duyệt/PWA và dấu hiệu ở đầu cửa sổ là chữ N xanh như trước; bàn tay Handio chỉ hiện khi triển khai dưới tên "Handio".
- **Tab Design hỏi lưu bản xuất vào thư mục nào** (Desktop): bấm PDF/PNG hiện hộp "Lưu bản xuất" để chọn thư mục và tên; không chọn (đóng hộp) thì lưu vào thư mục mặc định, cạnh tệp thiết kế. Nhớ thư mục vừa chọn cho lần sau.
- **Xem ảnh (PNG/JPG/GIF/WebP) ngay trong ứng dụng**: bấm vào ảnh trong danh sách tệp (vd bản PNG vừa xuất) để xem, không cần mở bằng ứng dụng khác.
- **Tự bật ứng dụng để kiểm tra** (tab Code, chế độ Tự động): agent sửa mã web xong mà chưa bật máy chủ thì ứng dụng tự chạy máy chủ dev của dự án, mở thử trang và để máy chủ chạy sẵn (nút "Mở localhost"), không phải nhắn "bật ứng dụng đi".

### Sửa
- **Hết "lỗi giả" khi kiểm tra trang Vite**: lỗi `[vite] failed to connect to websocket` (do kết nối HMR bị chặn) từng khiến agent bị bắt "sửa lỗi" không có thật nhiều lần liên tiếp; nay được bỏ qua.

### Thay đổi
- **Nút ▶ chạy máy chủ nền chạy thẳng, không qua mô hình**: trước đây nút gửi một yêu cầu cho agent ("Chạy … ở chế độ nền…") nên tốn vài chục giây và một lượt gọi mô hình; nay máy chủ bật ngay, địa chỉ hiện ở thanh tiến trình.

## [0.8.10] - 2026-10-12

### Thay đổi
- **Chân thanh bên gọn hơn, một dòng**: tên người dùng bên trái, chỉ ghi số phiên bản (v0.9.0…) bên phải; bấm vào số phiên bản để xem nhật ký thay đổi.

## [0.8.9] - 2026-10-12

### Thêm
- **Máy chủ chạy nền không bị dừng khi đổi dự án hay mở cuộc trò chuyện khác**: bật máy chủ xem ứng dụng ở dự án A, sang dự án B rồi quay lại thì máy chủ vẫn chạy (nút "Mở localhost" vẫn còn); bấm "Cuộc trò chuyện mới" hay mở lại lịch sử cũng không dừng nó.
- **Chạy nhiều dự án cùng lúc**: chuyển sang dự án khác thì agent ở dự án cũ **vẫn tiếp tục làm việc nền** (tối đa 3 dự án cùng lúc). Quay lại là thấy phần đã làm; yêu cầu xin quyền/câu hỏi đang chờ hiện lại; máy chủ dev của dự án cũ vẫn chạy.
- **Biểu tượng trạng thái dự án và cuộc trò chuyện**: vòng xoay = đang làm việc, ✓ = đã xong khi bạn ở dự án khác (chưa xem), ⏸ = làm dở (bị dừng giữa chừng, mở ra rồi nhắn "tiếp tục"). Hiện trong danh sách dự án, danh sách trò chuyện và chấm nhỏ cạnh tên dự án khi dự án khác đang chạy.
- **Sửa tệp chữ ngay trong ứng dụng**: bấm vào một tệp (AGENTS.md, .md, .json, .css, .js, .py…) trong danh sách tệp, hộp xem có nút **Sửa**; sửa rồi **Lưu** (hoặc Ctrl/Cmd+S), không phải mở bằng ứng dụng khác. Giữ nguyên kiểu xuống dòng của tệp; tệp Word/Excel/PowerPoint, nhị phân hoặc quá lớn vẫn mở bằng ứng dụng của nó.

### Sửa
- **Kiểm tra trang (`check_page`) không còn báo lỗi giả với ứng dụng Vite**: WebSocket nội bộ (`ws://localhost`) của Vite bị chặn nhầm nên trang nào cũng "lỗi kết nối", khiến agent mất hàng chục bước sửa cấu hình vô ích.
- **Thông báo "Đã lược bớt kết quả công cụ cũ" chỉ hiện một lần mỗi lượt** (trước đây lặp lại ở mỗi bước khi làm việc lâu).
- **Đổi tên dự án hoạt động trên Desktop**: trước đây nút ✎ bấm không có gì xảy ra (Electron không hỗ trợ hộp nhập `prompt`). Nay đổi tên trong hộp **Sửa dự án** (nút 📝 cạnh tên dự án), cùng chỗ sửa hướng dẫn cho agent.
- **Tạo lại dự án trùng tên với dự án đã bỏ khỏi danh sách không còn thành "Bài 2 (2)"**: tên hiển thị là đúng tên bạn gõ (chỉ thêm "(2)" khi trùng với dự án đang có trong danh sách); thư mục cũ còn trống được dùng lại.

### Thay đổi
- **Chọn dự án thì mở luôn cuộc trò chuyện gần nhất** của dự án đó (hoặc phần đang chạy nếu nó đang làm việc), không còn khung trống như dự án mới.
- **"Luôn cho phép trong phiên" là lựa chọn mặc định** khi agent xin quyền (Enter); "Chỉ lần này" là lựa chọn phụ.
- **Bỏ nút "Mẫu prompt"** dưới ô nhập.
- **Chặn cài Chakra UI không ghi phiên bản** (tab Code): `npm install @chakra-ui/react` sẽ cài v3 có API khác hẳn v2 mà mô hình quen viết, dẫn tới hàng trăm bước loay hoay rồi trang hỏng. Agent phải chọn phiên bản có chủ ý (`@2`, hoặc `@3` kèm đọc tài liệu).
- **Hết lượt tự sửa mà trang web vẫn lỗi thì báo thẳng cho bạn** (cảnh báo kèm lỗi đầu tiên), không để lời "xong" của agent che mất.

## [0.8.8] - 2026-10-11

### Sửa
- **Dán ảnh (Ctrl+V) trên macOS đọc được thật sự**: bản trước vẫn báo "nằm ngoài thư mục dự án" vì thư mục tạm của macOS (`/var/…`) là liên kết tới `/private/var/…` nên ảnh vừa dán bị coi là tệp ngoài dự án. Nay `@dan/<tên>` đọc được bình thường.
- **Agent không còn gọi công cụ kiểm tra trình duyệt khi máy không có** (bản web): lời nhắc chỉ nhắc `check_page` khi công cụ thực sự có.

### Thay đổi
- **Tab Code tự kiểm tra trang web trước khi báo xong** (Desktop): nếu agent vừa sửa mã/giao diện web mà chưa tự kiểm tra, ứng dụng tự mở thử trang trong trình duyệt ẩn; thấy lỗi console hoặc trang trắng thì agent phải sửa tiếp rồi mới được báo xong. Trước đây agent hay quên kiểm tra và bạn phải chép lỗi từ trình duyệt dán vào chat.
- **Khởi động máy chủ dev không còn được tính là "đã kiểm tra"**: máy chủ dev không báo lỗi thiếu import hay CSS hỏng cho đến khi trang được tải, nên agent phải build/lint hoặc kiểm tra trang trước khi báo xong.
- **Công thức cho các bộ khung hay trục trặc** trong lời nhắc tab Code (Tailwind v4 dùng `@import "tailwindcss"` và plugin Vite thay vì `tailwind.config.js`/`@tailwind`, Chakra UI v2, React Router v6, Svelte 5, Next.js…), để ứng dụng dựng xong không bị mất CSS hay trang trắng.

## [0.8.7] - 2026-10-11

### Sửa
- **Dán ảnh (Ctrl+V) ở tab Code agent đọc được ngay**: trước đây agent ghép nhầm đường dẫn `dan/…` vào thư mục dự án nên báo "Không có tệp ảnh" rồi nhờ bạn tải ảnh lên. Nay `@dan/<tên>` luôn trỏ đúng ảnh vừa dán; thông báo cho biết ảnh được lưu tạm ở đâu (ngoài dự án, giữ 30 ảnh gần nhất). Bản web không có thư mục tạm thì lưu vào `.neuagent/pasted/` của dự án.
- **Chế độ mặc định là "Tự động"** cho cả người đã dùng bản cũ: trước đây cài đặt cũ trên máy lưu sẵn "Hỏi trước" và đè lên mặc định nên ứng dụng cứ mở ở chế độ Hỏi trước. Từ nay chế độ chọn ở thanh dưới ô nhập chỉ áp dụng cho phiên đang mở; mở lại ứng dụng là "Tự động".
- **Xoá/chép/di chuyển tệp xong không còn bị ép "đọc lại tài liệu"** (một bước thừa agent phải làm sau mỗi lần dọn thư mục).

### Thêm
- **Tab Code tự thấy lỗi của trang web đang làm** (công cụ `check_page`, bản Desktop): sau khi chạy máy chủ dev hoặc ghi tệp HTML, agent mở thử trang trong một trình duyệt ẩn, cách ly (chỉ localhost và tệp trong dự án; chặn mọi yêu cầu ra ngoài) rồi đọc lỗi console, yêu cầu hỏng, màn hình trắng. Không còn cảnh bạn phải chép lỗi từ trình duyệt dán vào chat.

### Thay đổi
- **Agent thận trọng hơn với phiên bản thư viện** (tab Code): đọc phiên bản đã cài trước khi viết mã; nếu bản chính mới hơn API mình biết thì ghim bản quen thuộc hoặc đọc tài liệu trước (tránh tình trạng cài Chakra UI v3 nhưng viết mã v2). Khi bạn đổi hướng (HTML sang React…) agent dọn tệp bỏ dở, không để lại `.bak` hay bản ứng dụng song song.
- **Một dự án chỉ một máy chủ dev chạy nền**: chạy lại lệnh cũ (hoặc máy chủ dev khác trong cùng thư mục) thì máy chủ cũ được dừng, không còn nhiều máy chủ chiếm các cổng 5173–5176 và trình duyệt mở nhầm bản cũ.
- **Ngữ cảnh gọn hơn khi làm việc lâu**: nội dung tệp lớn vừa ghi không còn nằm mãi trong lịch sử (trước đây một tệp CSS dài chiếm ~5.000 token), nên ít phải tóm tắt ngữ cảnh giữa chừng.

## [0.8.6] - 2026-10-11

### Thay đổi
- **Tab Work yên lặng hơn**: các bước của agent gập vào một dòng ("Đang tạo bài trình chiếu… · 4 bước", xong thì "✓ Hoàn tất · N bước · 12 giây"); lỗi agent tự xử lý không còn hiện đỏ giữa màn hình; cuối lượt có nút mở tệp vừa tạo. Muốn xem từng bước: Cài đặt › Giao diện › "Hiện từng bước chi tiết".
- **Danh sách tệp chuyển sang thanh bên phải** (có thể thu gọn); ẩn tệp tạm `~$…` của Office. Xem tài liệu mở ngay trong cột đó, có nút "← Tệp" để quay lại.
- **Agent làm cho xong, không bắt gõ "tiếp tục"**: được tự đi tiếp gấp ba số bước cài đặt trong một lượt trước khi dừng an toàn.
- **Ít bước và đỡ phải tóm tắt hơn**: các công cụ ít dùng (PDF, quản lý tệp, tiện ích, trộn thư) chỉ nạp khi cần, lời nhắc hệ thống gọn hơn (Work: chi phí cố định giảm gần một nửa; Design: giảm hơn 80%). Agent không còn bị cắt giữa chừng khi tạo tệp dài ở mức ngữ cảnh đã dùng nhiều.
- **PowerPoint**: bạn nêu số slide thì bài được dựng đúng số đó (gồm bìa và cảm ơn), không tự thêm mục lục hay tách slide. Kết quả tạo/sửa ngắn gọn, kèm danh sách tiêu đề các slide nên agent không phải đọc lại.
- **Kho mã chuẩn bị công khai** (Apache-2.0): cấu hình riêng của nơi triển khai tách khỏi mã; tài liệu `docs/PUBLIC.md`. Không đổi gì với người dùng.

### Thêm
- **Bấm vào vòng tròn ngữ cảnh** (cạnh nút Gửi/Dừng) để xem chi tiết: ngữ cảnh đang dùng vào việc gì (lời nhắc, công cụ, tin nhắn, kết quả công cụ) và hạn mức còn lại.
- **Sửa PowerPoint dễ hơn**: thay cả phần thân của một slide bằng một lệnh, thêm slide mới (kết luận, cảm ơn…) đúng thiết kế của tệp mà không cần chép đúng từng chữ; thay chữ không còn cần đúng hoa/thường, dấu, gạch đầu dòng, ngoặc kép, kể cả chữ trải nhiều dòng.

### Sửa
- **Giới hạn đầu ra không còn rơi về mức thấp nhất** khiến việc tạo Word/PowerPoint dài bị cắt giữa chừng nhiều lần liên tiếp (dữ liệu thật cho thấy ngân sách bị tính cộng đôi phần công cụ).
- **PowerPoint**: không còn slide trống khi bìa có dòng phụ; các mục `##` không có `---` tách đúng thành từng slide; nối thêm slide vào tệp đã chỉnh sửa không còn báo lỗi.
- **Tệp đang mở trong Word/Excel/PowerPoint** (Windows): tự lưu thành "tên (đã sửa)" thay vì báo lỗi rồi thử lại nhiều lần.
- **Không còn bước đọc lại thừa** sau khi tạo/sửa tài liệu bằng công cụ Office (kết quả đã liệt kê nội dung).

## [0.8.5] - 2026-10-11

### Thay đổi
- **Bài trình chiếu đẹp và đủ bộ khung hơn** (học theo bộ quy tắc thiết kế slide của Claude): tự thêm **trang bìa**, **mục lục** (từ 5 slide nội dung) và **trang cảm ơn** nếu bài thiếu; danh sách quá dài tự chia thành nhiều slide; ý ngắn hiện thành hàng có **biểu tượng trong vòng tròn màu** thay vì chỉ có chữ; bỏ các sọc/vạch trang trí; danh sách gạch đầu dòng là danh sách thật (dễ sửa trong PowerPoint); tiêu đề 36pt; thêm 9 bảng màu và **tự chọn màu theo chủ đề** bài (y tế, tài chính, công nghệ, môi trường…); bảng màu được ghi vào chính tệp nên tab Design của PowerPoint dùng đúng màu.
- **Biểu đồ theo nguyên tắc trực quan hoá dữ liệu**: thứ tự màu cố định đã kiểm tra cho người khó phân biệt màu; hướng dẫn cho AI chọn đúng loại biểu đồ, không dùng hai trục, mỗi biểu đồ có tiêu đề nêu kết luận.
- **AI hỏi lại trước khi làm** (Work, Code, Design): khi yêu cầu tạo mới còn thiếu thông tin quan trọng (mục đích, người xem, độ dài, phong cách…), AI dùng thẻ chọn đáp án hỏi một lần rồi mới bắt tay làm; yêu cầu đã rõ thì làm ngay.
- **Sửa tệp thì sửa chính tệp đó** (không còn sinh ra hàng loạt tệp `-v2`, `-v3`…); có “Hoàn tác” nếu cần quay lại. Chỉ tạo bản mới khi bạn yêu cầu.
- **Nút “Kiểm tra cập nhật” chuyển vào hộp Nhật ký thay đổi** (bấm “vX · Nhật ký thay đổi” ở thanh bên), bỏ nút riêng ở thanh bên cho gọn. Menu Tệp → Kiểm tra bản cập nhật… vẫn còn.

### Sửa
- **Sửa slide không còn báo “không tìm thấy”** khi chép cả nhãn “Slide 9:” hoặc khác dấu/hoa thường; thêm đặt lại tiêu đề theo số slide, và khi không thấy chữ thì gợi ý các đoạn gần giống.

### Thêm
- **Bộ kỹ năng thiết kế và UX** (gói `thiet-ke-ux`, tab Design/Work): `/phe-binh-thiet-ke`, `/kiem-tra-tiep-can` (WCAG 2.1 AA, tính tương phản từ mã màu, dẫn số dòng), `/ban-giao-thiet-ke` (đặc tả bàn giao ra Word), `/ra-soat-he-thong-thiet-ke`, `/viet-loi-giao-dien` (lời giao diện tiếng Việt).
- **Nghiên cứu người dùng** (gói `nghien-cuu-nguoi-dung`): `/ke-hoach-nghien-cuu` và `/tong-hop-nghien-cuu` — biến ghi chú phỏng vấn/khảo sát thành Word có chủ đề, trích dẫn nguyên văn có nguồn và khuyến nghị xếp ưu tiên.
- **Tự tạo lệnh và kỹ năng riêng cho dự án** (gói `tao-ky-nang`): `/tao-ky-nang` hướng dẫn viết tệp lệnh/kỹ năng đúng cấu trúc, có checklist và cách chạy thử.
- **Năng suất cá nhân** (gói `nang-suat`, tab Work): `/viec-can-lam` (việc cần làm trong `VIEC-CAN-LAM.md`), `/ghi-nho` và `/don-bo-nho` (nhớ thuật ngữ, người, dự án của đơn vị), `/ban-tin-ngay` (tóm tắt đầu ngày từ chính thư mục dự án).
- **Nghiên cứu sâu**: gói `research` có thêm quy trình nghiên cứu nhiều khía cạnh bằng subagent và `/tong-quan-tai-lieu`.
- Tài liệu `docs/KHOANG-TRONG-OFFICE.md`: những việc Word/Excel/PowerPoint/PDF của Handio chưa làm được so với bộ kỹ năng Office của Claude và thứ tự nên làm tiếp.

## [0.8.4] - 2026-10-11

### Thêm
- **Tiện ích văn phòng chính xác (tab Work)**: đọc số thành chữ chuẩn văn bản hành chính, tính ngày/ngày làm việc/ngày nghỉ lễ, đổi dương lịch ↔ âm lịch kèm Can Chi, máy tính (hiểu số kiểu Việt Nam và “15% của 2.500.000”), xử lý họ tên/số điện thoại và sắp xếp tên theo bảng chữ cái tiếng Việt, tạo thư nháp `.eml` và lời mời lịch `.ics`, đổi Excel ↔ CSV (mở đúng tiếng Việt), so sánh hai văn bản, thống kê tài liệu. Ngày lễ và âm lịch luôn kèm lời nhắc đối chiếu với thông báo chính thức.
- **Sửa tệp có sẵn như người dùng Office thật (tab Work)**: PowerPoint (`pptx_edit`: sửa chữ, đổi hoa/thường tiêu đề, màu chữ/cỡ/phông/căn lề, màu nền hình và slide, xoá/nhân đôi/chuyển slide), Word (`docx_edit`: thay cả đoạn, chèn tiêu đề/danh sách/bảng, xoá, định dạng, sửa bảng), Excel (xoá/chèn hàng-cột và công thức tự điều chỉnh, đổi tên/xoá sheet, sắp xếp, định dạng ô, gộp ô, cố định hàng, bộ lọc). Trước đây PowerPoint chỉ tạo mới được, không sửa được.
- **Biểu đồ thật trong Excel** (cột, ngang, đường, tròn, vành, vùng): lấy số liệu từ ô nên sửa dữ liệu là biểu đồ đổi theo; bảng Excel tự định dạng đẹp (tiêu đề đậm, hàng so le, hàng Tổng nổi bật, số/ngày/% đúng kiểu, đóng băng tiêu đề, in ngang vừa khổ) và chọn được màu chủ đề.
- **Word đẹp hơn** (kiểu “hiện đại”): khối tiêu đề có vạch nhấn, màu chủ đạo chọn được, bảng hàng tiêu đề màu và hàng so le, hộp Lưu ý/Mẹo/Cảnh báo, khối mã, mục lục tự cập nhật, đầu trang và “Trang X / Y”, biểu đồ thanh màu. Kiểu hành chính (công văn) giữ nguyên thể thức.
- **Tạo PDF đẹp trực tiếp từ nội dung** (`create_pdf`, bản Desktop; không cần LibreOffice): khổ A4, tiêu đề, mục lục, bảng, hộp lưu ý, biểu đồ thật, số trang.
- **Công cụ PDF**: xem thông tin, lấy chữ theo trang, tách trang/cắt theo số trang, gộp nhiều PDF, xoay trang, ghép ảnh thành PDF; luôn lưu ra tệp mới.
- **Quản lý tệp ngay trong trò chuyện**: sao chép, di chuyển/đổi tên, xoá, tạo thư mục, nén .zip, giải nén .zip, xem thông tin tệp/thư mục; hoàn tác được bằng một lần “Hoàn tác”, không ghi đè khi bạn chưa đồng ý.
- **Agent hỏi lại bằng thẻ chọn đáp án** khi thật sự thiếu thông tin: chọn một hoặc nhiều lựa chọn, tự gõ ở ô “Khác…”, hoặc “Để agent tự quyết”.
- **Trang quản trị nâng cấp**: chất lượng theo **phiên bản/tab/mô hình/nền tảng** (thấy ngay bản mới có tệ hơn không), so sánh với kỳ trước ngay trên biểu đồ, vạch đánh dấu ngày ra phiên bản mới, cột bất thường, công cụ × lý do lỗi, công cụ chạy chậm, ngữ cảnh gần đầy, hỏi quyền, mức tập trung token. Bảng bấm tiêu đề để sắp xếp và có ô lọc; tải CSV theo khoảng đang xem; số trên trục dễ đọc (5.3 s, 15.7 triệu); cột *Hoạt động* ở trang Tài khoản dẫn tới trang của từng người.
- **Cảnh báo chủ động tuỳ chọn**: đặt URL webhook (Teams/Slack…) để nhận tin khi lỗi tăng, cổng mô hình 5xx, hết hạn mức hàng loạt hoặc hệ thống không khoẻ. Chỉ gửi số liệu tổng hợp.
- **Trang quản trị chọn được khoảng thời gian**: 1 ngày, 3 ngày (chia theo giờ), 7, 30 (mặc định) và 90 ngày. Nút chọn nằm ở thanh trên cùng; mỗi khoảng là một trang tạo sẵn (`index-1d.html`, `index-3d.html`, `index-7d.html`, `index-90d.html`) nên mở nhanh như trang cũ.

### Sửa
- Ô Excel có chữ bắt đầu bằng “=” nhưng được đánh dấu là chữ không còn bị biến thành công thức.
- **Đọc PowerPoint đã sắp xếp lại slide** nay đúng thứ tự trình chiếu (trước đây theo tên tệp). **Hoàn tác** khôi phục đúng tệp kể cả khi thư mục chứa đã bị xoá. Sửa lỗi đọc tệp Word có phím Tab/mục lục.
- **Tỷ lệ lỗi công cụ không còn bị thổi phồng** bởi các bản ứng dụng cũ chưa phân loại lỗi (trước đây hiện như "chưa rõ" chiếm gần hết biểu đồ); phần đó nay ghi riêng.

### Thay đổi
- **Ẩn nút chọn mô hình ở khung chat khi máy chủ chỉ có một mô hình** (hiện lại tự động khi có từ hai mô hình trở lên).

## [0.8.3] - 2026-10-11

### Thêm
- **Hộp “Tải ứng dụng” hiện phiên bản** (và ngày phát hành) của bản cài, cả ở nút tải chính lẫn danh sách “Bản cho máy khác”.
- **Nút “Kiểm tra cập nhật” ngay trong ứng dụng** (thanh bên, dưới “Nhật ký thay đổi”): bấm bất cứ lúc nào đang dùng để hỏi có bản mới không; kết quả hiện ngay trên nút (có bản mới thì ứng dụng tải nền như thường). Vẫn có ở menu Tệp.
- **Tự cập nhật ngay trong ứng dụng (Windows và macOS)**: ứng dụng tự tải nền bản mới, kiểm mã băm, rồi tự cài khi bạn đóng ứng dụng, hoặc bấm “Cài đặt và khởi động lại” để cài ngay. Không cần mở tệp tải về nữa. Tắt được ở menu **Tệp → Tự động cập nhật**. Lần đầu lên bản này vẫn cần cập nhật theo cách cũ một lần.
- **Cập nhật xong tự làm tiếp việc đang dở**: nếu agent đang làm việc lúc cập nhật, ứng dụng dừng gọn, lưu lại và sau khi mở lại tự mở đúng cuộc trò chuyện rồi nhắn agent làm tiếp.
- **PowerPoint đẹp hơn, có bố cục thật**: bài trình chiếu do AI tạo không còn là chữ trên nền trắng. Có bìa đậm có hình trang trí, slide mở đầu phần có số lớn, thẻ số liệu lớn (“92%: …”), thẻ đánh số (“**Nhãn**: mô tả”), lộ trình các bước (danh sách đánh số), trích dẫn, biểu đồ cạnh gạch đầu dòng, bảng có sọc, slide kết thúc. Bố cục tự chọn theo nội dung, tiêu đề là tiêu đề thật của slide (hiện trong dàn ý và trình đọc màn hình).
- **Chọn chủ đề màu cho bài trình chiếu**: xanh (mặc định), ngọc, xanh lá, cam, tím, đỏ, đen; chỉ cần nói “dùng tông cam”.
- **Chèn ảnh có sẵn trong thư mục dự án** (png, jpg, gif) vào slide; ảnh thiếu thì giữ khung chữ và báo rõ.

- **Tạo tài liệu Word và bài trình chiếu dài không còn bị cắt giữa chừng**: AI dựng từng phần rồi nối vào cùng một tệp (`append`), thay vì viết hết trong một lần (lần dài quá bị cắt và tạo ra nhiều tệp rời).

### Sửa
- **Tệp Word/PowerPoint trong thư mục dự án có dấu cách đôi** (ví dụ `Slide  test`) hoặc đường dẫn đầy đủ do AI gõ lại sai một dấu cách: nay vẫn nhận ra đúng thư mục dự án thay vì báo “ngoài thư mục dự án”.
- AI được nhắc dùng đường dẫn tương đối (ví dụ `bao-cao.docx`) thay vì gõ cả đường dẫn đầy đủ.

### Thay đổi
- **Làm trang web/thiết kế đẹp hơn mặc định**: hướng dẫn của AI ở tab Design và Code nay có công thức thiết kế cụ thể (bảng màu, cỡ chữ, khoảng cách, thẻ có bóng, nút, hình minh hoạ bằng SVG, bố cục landing page đầy đủ) để kết quả đầu tiên đã trông chuyên nghiệp.

## [0.8.2] - 2026-10-11

### Thêm
- **Quản trị: ghi nội dung hội thoại của tài khoản chỉ định** (mặc định tắt) vào CSDL riêng trên máy chủ để nghiên cứu, kèm lệnh bật/tắt/xuất/xoá (`quota.sh capture …`, xem docs/QUOTA.md). Chỉ ghi đúng các tài khoản được liệt kê (hoặc theo tiền tố như `test0*` cho tài khoản tên; không áp cho email); người khác không bị ảnh hưởng.
- **Cấp quyền quản trị cho tài khoản tên + mật khẩu**: ghi đúng tên đăng nhập (ví dụ `test01`) vào danh sách quản trị trên máy chủ là tài khoản đó vào được `/agent/admin/`. Mặc định không tài khoản mật khẩu nào là quản trị viên.

### Sửa
- **Bản Desktop trên Windows không đọc/sửa được tệp nào trong thư mục dự án** (báo “nằm ngoài thư mục dự án” dù tệp nằm ngay đó, nhất là khi thư mục ở ổ đĩa như `E:\…`). Đường dẫn Windows nay được hiểu đúng.

### Thay đổi
- **Trang chủ `/agent/` là trang giới thiệu khi chưa đăng nhập**: có nút “Đăng nhập”; đăng nhập xong vào thẳng trang làm việc. Chuột trong hình hero vẽ lại bằng vector (nút giữa thỉnh thoảng sáng), ảnh demo chụp lại ở độ phân giải cao (2560 × 1600, định dạng WebP) nên không còn mờ.

## [0.8.1] - 2026-10-11

### Thêm
- **Trang giới thiệu công khai thiết kế lại** theo bộ nhận diện mới: nền navy, hai tay rô-bốt gõ phím và cầm chuột có chuyển động (ảnh PNG tách nền; phím sáng nhấp nháy, vòng sáng ở ngón trỏ khi bấm chuột, bấm vào hình thì cả bàn phím sáng lên), các thẻ “Viết code nhanh hơn / Tạo slide chỉ với 1 câu lệnh / Thiết kế dễ dàng hơn / Xử lý dữ liệu tự động”, lưới sáu khả năng, demo, ba chế độ, hỏi đáp. Vẫn tĩnh, không script, dùng được trên điện thoại và tự tắt chuyển động khi hệ điều hành bật “giảm chuyển động”.
- **Tên hiển thị cấu hình được theo từng nơi triển khai**: bản của trường giữ tên **NEU Agent**; nơi khác (hoặc bản công khai dưới tên Handio sau này) chỉ cần đặt `brand.json` (`{"name":"…"}`) cạnh ứng dụng web, không phải sửa mã. Tên áp dụng cho giao diện, hướng dẫn, bài học, lời nhắc của agent, thông tin tệp Word/Excel/PowerPoint do agent tạo và các hộp thoại của bản Desktop.

### Thay đổi
- Bộ nhận diện mới: bàn tay rô-bốt, biểu tượng, hình minh hoạ “đang làm việc” (PNG/SVG tách nền trong `docs/brand/`). Tên sản phẩm là **Handio**; bản triển khai ở NEU vẫn hiển thị là NEU Agent.
- Thư mục dự án có sẵn ở Tài liệu/NEU Agent (hoặc Hando, Handio của các bản thử) vẫn được dùng tiếp; chính sách và gói mở rộng đặt ở thư mục tên cũ vẫn có hiệu lực. Dữ liệu, cài đặt, lịch sử và phiên đăng nhập không đổi.
- Mã nguồn chuyển sang kho GitHub mới `Lampx83/Handio` (địa chỉ cũ tự chuyển hướng).

## [0.8.0] - 2026-10-11

### Thêm
- **Đổi tên thành Hando** (đọc *han-đô*, “bàn tay làm việc giúp bạn”; khẩu hiệu *Giúp bạn một tay*) kèm bộ nhận diện mới: biểu tượng **bàn tay** vector 2D/3D có chuyển động (vẫy tay, đưa tay giúp, gõ phím, đếm ngón, cầm chuột, xong việc), màu xanh Hando và cam “do”, wordmark riêng. Hiện ở thanh trên (vẫy tay khi rê chuột), màn hình chào, trang đăng nhập, trang giới thiệu, biểu tượng ứng dụng và biểu tượng web. Hướng dẫn thương hiệu ở `docs/brand/BRAND.md`.

### Thay đổi
- Tên hiển thị trong giao diện, lời nhắc của agent, tài liệu và trang giới thiệu là **Hando**. Dữ liệu, cài đặt, lịch sử và phiên đăng nhập của bạn **giữ nguyên**; cập nhật Desktop vẫn dùng như cũ. Cài mới tạo thư mục dự án ở Tài liệu/Hando; ai đã có thư mục cũ thì giữ nguyên. Lần cài bản Desktop đầu tiên trên macOS tạo ứng dụng tên Hando: bạn có thể xoá bản “NEU Agent” cũ.

## [0.7.1] - 2026-10-11

### Sửa
- **Tạo dữ liệu mẫu hàng loạt không còn đẻ hàng loạt tệp và trả lời dài dòng**: tab Work nay sinh “200 bản ghi” ngay trong công cụ (chỉ cần mô tả các cột: số thứ tự, mã, tên người Việt, email, ngày, điểm, danh sách chọn, công thức…) thay vì bắt mô hình tự gõ từng ô; việc làm lại/mở rộng tệp do chính agent tạo thì ghi đè cùng một tệp (không tạo -v2, -moi, -final); giữa các bước agent chỉ nói một câu ngắn và không hỏi lại những điều tự quyết được.

### Thay đổi
- Excel: `create_xlsx` có tham số `generate` và `xlsx_edit` có `append_generate` để sinh hàng loạt dữ liệu mẫu tới 5.000 dòng trong một lời gọi ngắn.

## [0.7.0] - 2026-10-11

### Thêm
- **Chia sẻ cuộc trò chuyện bằng liên kết**: nút 🔗 trên thanh trên tạo một liên kết để đồng nghiệp, bạn học, giảng viên (đã đăng nhập NEU Agent) đọc lại cuộc trò chuyện; có xem trước, tự che khoá/mật khẩu/CCCD/số điện thoại/email/số tài khoản, và thu hồi bất cứ lúc nào. Các cuộc trò chuyện được chia sẻ cũng giúp nhóm phát triển hiểu người dùng gặp gì để cải thiện hệ thống (hộp chia sẻ nói rõ điều này). Quản trị viên xem ở trang *Chia sẻ* và tải JSONL (đã giả danh người chia sẻ) để phân tích. Nội dung tệp không được chia sẻ.

## [0.6.3] - 2026-10-10

### Thay đổi
- **Ảnh dán (Ctrl+V) không còn bị lưu vào thư mục dự án**: ảnh chụp màn hình dán vào ô nhập được lưu tạm ngoài dự án (không lẫn vào mã nguồn, `git status`, không lỡ commit) và vẫn đọc được bằng `@dan/…`. Chỉ giữ 30 ảnh dán gần nhất. Các tệp `anh-dan-…png` đã lỡ lưu trong dự án từ bản trước thì bạn xoá tay được.
- Khi agent bị cắt giữa chừng lúc tạo tệp dài hoặc rơi vào vòng lặp văn bản, ứng dụng ghi nhận **mã** của sự cố (không kèm nội dung) vào số liệu chẩn đoán để nhóm phát triển thấy và cải tiến; bạn có thể tắt chẩn đoán ở Cài đặt.

## [0.6.2] - 2026-10-10

### Sửa
- **Chế độ Toàn quyền không hỏi nữa**: trước đây sau khi agent tìm/đọc web, mọi thao tác ghi/chạy lệnh/tải trang vẫn hiện hộp xin phép dù đang ở Toàn quyền. Nay Toàn quyền là không hỏi (lệnh phá hoại và quy tắc chặn vẫn có hiệu lực).
- **Agent lặp đi lặp lại một đoạn văn** (có khi cả vài phút, tốn token mà không làm gì): nay tự phát hiện, dừng sinh chữ ngay và nhắc agent gọi công cụ hoặc chia nhỏ việc; lặp ba lần thì dừng hẳn và báo rõ.

## [0.6.1] - 2026-10-10

### Sửa
- **Sửa lỗi “tham số không phải JSON hợp lệ” khi tạo tệp dài** (tờ rơi/trang HTML ở tab Design, Excel nhiều dòng, tài liệu dài): agent trước đây bị cắt giữa chừng sau khoảng 10.000 ký tự. Nay giới hạn đầu ra theo phần còn lại của cửa sổ ngữ cảnh (tới 16 nghìn token); nếu vẫn bị cắt, agent được báo rõ và tự chia nhỏ (tệp khung rồi thêm từng phần, dữ liệu hàng loạt bằng công thức).
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
