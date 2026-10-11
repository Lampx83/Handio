# Tài liệu training Handio

Handio có ba tab, cho ba nhóm người dùng:

| Tab | Dành cho | Làm gì | Tài liệu |
|---|---|---|---|
| **Design** | Truyền thông, giảng viên, sinh viên | Mô tả poster/landing page/slide/logo… bằng tiếng Việt, agent viết HTML/SVG, xem trước ngay, xuất PDF/PNG | [KICH-BAN-DESIGN.md](KICH-BAN-DESIGN.md) |
| **Code** | Sinh viên (môn FIT-VIBE, "vibe coding"), giảng viên CNTT | Mô tả điều muốn làm bằng tiếng Việt, agent đọc mã, lập kế hoạch, viết/sửa mã, chạy thử và sửa đến khi chạy được | [KICH-BAN-CODE.md](KICH-BAN-CODE.md) |
| **Work** | Khối văn phòng, trợ lý khoa, giảng viên | Tóm tắt, soạn thảo, tính toán, rà soát và làm slide từ Word / Excel / PowerPoint / PDF, giống Claude Desktop | [KICH-BAN-WORK.md](KICH-BAN-WORK.md) |

Ba tab là ba phiên **độc lập** (hội thoại, thư mục, công cụ khác nhau; mỗi tab có nhiều **dự án**); chuyển tab bằng `Ctrl/⌘ + 1`, `2`, `3` (thứ tự Work, Code, Design), tab kia vẫn chạy nền (chấm xanh = đã xong, chấm vàng = đang chờ bạn duyệt).

## 1. Chuẩn bị của người tổ chức (làm trước buổi học)

**Chọn nơi chạy**

| Cách | Khi nào dùng | Ghi chú |
|---|---|---|
| **Web** (trình duyệt) | Phòng máy, sinh viên không cài được phần mềm | Thư mục là *thư mục ảo* trong trình duyệt (lưu lại sau khi tải lại trang); tab Code không có terminal, chạy JavaScript trong hộp cát; tải tệp/zip về máy |
| **Desktop** (Electron) | Máy cá nhân, buổi học nghiêm túc | Làm việc trên **thư mục thật**; tab Code chạy lệnh thật (python, node, git…); tab Work mở thẳng tệp bằng Word/Excel; xuất PDF nếu máy có LibreOffice |

**Kiểm tra trước giờ học** (15 phút, bắt buộc)

1. Máy chủ mô hình ở 232 đang chạy. Bản **web** (`ai.neu.edu.vn/agent`) và bản **Desktop** có **key tích hợp sẵn**, người học không cần nhập; nếu cần theo dõi riêng từng người thì cấp **key riêng** cho mỗi người (nhập ở Cài đặt, ưu tiên hơn key tích hợp) (xem `legacy/fitcode-python/HUONG-DAN-GIANG-VIEN.md` và `server/gateway-232/`). Giới hạn lệnh/phút đủ cho cả lớp (mô hình trả lời được ~16 yêu cầu song song).
2. Tự **chạy thử từng kịch bản bằng mô hình thật** một lần. Kết quả của mô hình thay đổi giữa các lần chạy; kịch bản trong tài liệu mô tả *điều nên xảy ra* và *cách chấm*, không phải văn bản cố định.
3. Dự phòng khi mạng/máy chủ lỗi: chạy **"Demo giả lập"** (Cài đặt → chọn mẫu *Demo giả lập*; chỉ có ở bản dev `npm run dev:web` hoặc `NEU_MOCK=1 npm run desktop`). Nó chạy kịch bản có sẵn, không cần key, dùng để trình diễn quy trình, không phải để chấm khả năng của mô hình.
4. Dữ liệu mẫu: mở tab Work lần đầu sẽ có sẵn 8 tệp mẫu (dữ liệu giả); tab Code có dự án mẫu `src/grades.js` với một lỗi cố ý. Nút **Cài đặt → Khôi phục dữ liệu mẫu** (bản web) hoặc menu **Tệp → Nạp dữ liệu mẫu** (Desktop) để làm lại từ đầu.

## 2. Ba điều phải nói trong 10 phút đầu (mọi nhóm)

1. **AI có thể sai một cách rất tự tin.** Việc của bạn là *kiểm tra*, không phải tin. Mọi kịch bản đều có bước "kiểm chứng" và đó là phần được chấm điểm.
2. **Bạn là người duyệt.** Mỗi lần agent muốn sửa file hoặc chạy lệnh, một hộp vàng hiện ra kèm phần thay đổi. Đọc rồi mới bấm *Cho phép*. Phím tắt: `Enter` = cho phép, `Esc` = từ chối.
3. **Dữ liệu và key là của bạn.** Không dán key vào hội thoại hay tệp; không đưa dữ liệu cá nhân thật (CCCD, điểm thật chưa được phép, lương) vào buổi tập; chỉ dùng dữ liệu mẫu hoặc dữ liệu đã được phép.

### Bốn chế độ quyền (thanh trên cùng, `Shift+Tab` để đổi)

| Chế độ | Ý nghĩa | Khi nào dùng |
|---|---|---|
| **Tự động** (mặc định) | Tự lo việc thường ngày (sửa file, build, test, git cục bộ); hỏi khi xoá, mạng, tệp bí mật, lệnh lạ | Làm việc hằng ngày |
| **Hỏi trước** | Đọc tự do; sửa file và chạy lệnh phải được duyệt | Mã lạ, việc cần soi kỹ |
| **Tự sửa file** | Tự duyệt sửa file trong dự án; lệnh vẫn hỏi | Khi đã tin kế hoạch và muốn đỡ bấm |
| **Lập kế hoạch** | Chỉ đọc; agent đề xuất kế hoạch để bạn duyệt rồi mới làm | Việc lớn, yêu cầu còn mơ hồ |
| **Toàn quyền** | Không hỏi gì, vẫn chặn lệnh phá hoại nặng | **Chỉ** trong thư mục thử nghiệm bỏ đi được |

Chế độ "Toàn quyền" có ở cả ba tab; người dùng văn phòng nên dùng "Tự động".

### Cái hệ thống tự bảo vệ bạn, và cái nó *không* bảo vệ

- Agent chỉ đọc/ghi trong thư mục làm việc; đường dẫn ra ngoài (`../`, thư mục nhà, liên kết tượng trưng trỏ ra ngoài) bị từ chối.
- Lệnh phá hoại rõ ràng (`sudo`, `rm -rf .`, `git push --force`, tải về rồi chạy thẳng…) bị chặn ở mọi chế độ. Đây là *lưới an toàn*, không phải bức tường: lệnh mới/lạ vẫn có thể gây hại, nên **đừng** bật chế độ tự động ở thư mục có dữ liệu quý.
- "Luôn cho phép trong phiên" chỉ áp dụng cho đúng loại lệnh đơn giản đó (ví dụ `npm test`), không áp dụng cho lệnh ghép dài.
- Nội dung đọc từ tệp/web là **dữ liệu**, agent được dặn không làm theo chỉ dẫn nằm trong đó (kịch bản C6 thử điều này). Không có biện pháp nào tuyệt đối: nếu agent đề nghị việc bạn không yêu cầu, hãy từ chối.
- Tab Work không có terminal. File gốc không bị ghi đè nếu bạn chưa cho phép; kết quả lưu thành tệp mới.

## 3. Cách chấm và nhận xét

Mỗi kịch bản có mục **"Kiểm tra"** (kết quả đúng chưa) và **"Điểm cần nhấn mạnh"** (kỹ năng cần rút ra). Gợi ý thang 4 tiêu chí, mỗi tiêu chí 0–2 điểm:

| Tiêu chí | 0 | 1 | 2 |
|---|---|---|---|
| **Yêu cầu rõ** | Một câu mơ hồ | Có mục tiêu, thiếu ràng buộc | Nêu mục tiêu, đầu vào/ra, ràng buộc, ví dụ |
| **Kiểm chứng** | Tin ngay | Chạy/mở xem qua | Tự kiểm tra số liệu/chạy thử/đọc diff và nêu bằng chứng |
| **Duyệt có ý thức** | Bấm Enter liên tục | Đọc phần thay đổi | Từ chối/chỉnh khi cần, ghi lý do |
| **An toàn dữ liệu** | Dán dữ liệu thật/key | — | Chỉ dùng dữ liệu cho phép, hiểu giới hạn |

## 4. Mẹo viết yêu cầu tốt (phát cho học viên)

> **Mục tiêu + bối cảnh + ràng buộc + dạng kết quả + cách kiểm tra.**
>
> *Chưa tốt:* "Làm báo cáo điểm."
> *Tốt:* "Từ `diem-hoc-phan.xlsx`, tính điểm tổng kết theo trọng số ở sheet Quy chế, xếp loại, thống kê số sinh viên mỗi loại. Lưu sang file mới `diem-tong-ket.xlsx`, giữ nguyên file gốc, dùng công thức. Cuối cùng cho tôi 3 dòng đối chiếu tay để kiểm tra."

- Một yêu cầu = một việc. Việc lớn: chia nhỏ hoặc dùng chế độ *Lập kế hoạch*.
- Cho ví dụ đầu vào/đầu ra mong muốn khi có thể.
- Nói rõ *không được làm gì* ("không sửa file gốc", "không thêm thư viện").
- Khi kết quả sai: nói **sai ở đâu và mong đợi gì**, đừng chỉ nói "sai rồi, làm lại".
- Việc dài làm ngữ cảnh đầy (thanh "ngữ cảnh %" trên cùng): gõ `/compact` hoặc `/clear`.

## 5. Lệnh gạch chéo `/`

Chung: `/help` `/clear` `/compact` `/mode` `/undo` (hoàn tác thay đổi file gần nhất) `/context`.
Tab Code: `/init` `/vibe` `/review` `/explain` `/fix-tests`.
Tab Work: `/tomtat` `/soanthao` `/bangtinh` `/trinhchieu` `/rasoat`; thư mục mẫu có thêm `/giay-moi`.
Đơn vị có thể tự thêm lệnh: tạo `.neuagent/commands/ten-lenh.md` trong thư mục làm việc (xem `giay-moi.md` trong dữ liệu mẫu), và ghi quy ước riêng (tên đơn vị, người ký, đầu số văn bản) vào `NEUAGENT.md` để agent tự đọc.
