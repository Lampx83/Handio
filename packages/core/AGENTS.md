# packages/core — lõi agent (không phụ thuộc môi trường)

- **Không import Node/Electron/DOM.** Mọi thao tác tệp, lệnh, mạng đi qua `Env` (`env.ts`); mã ở đây phải chạy được cả trong trình duyệt (web) lẫn Node (Desktop).
- `session.ts`: vòng lặp agent (`Agent.runTurn`), tin nhắn người dùng gửi giữa chừng được xếp hàng (`Session.queue`) và đưa vào bước kế tiếp. `controller.ts`: `LocalController` (API mà giao diện gọi). `tools.ts` + `office/`: công cụ; `profiles.ts`: tab Work/Code/Design (công cụ, lệnh, chế độ quyền).
- **Quyền (`permissions.ts`, `shell.ts`, `sensitive.ts`):** chế độ `default` (hỏi) → `acceptEdits` → `auto` (tự lo việc thường ngày trong dự án, vẫn hỏi xoá/mạng/tệp bí mật/lệnh lạ) → `plan` → `bypass`. `dangerousReason` chặn lệnh phá hoại ở MỌI chế độ. Thêm lệnh vào danh sách "thường ngày" (`isRoutineSegment`) phải kèm bài thử cả hai hướng (được phép / vẫn hỏi). Nội dung đọc từ web làm `tainted`: sau đó mọi thao tác có tác dụng phụ phải hỏi.
- **Lời nhắc hệ thống** (`profiles.ts`, `session.ts`) ảnh hưởng chất lượng mọi người dùng: đổi thì thử lại bằng bài kiểm thử và ghi CHANGELOG.
- **Kiểm thử:** `packages/core/test/`, dùng `FakeLlm` và `makeController`. Mặc định của `DEFAULT_SETTINGS.mode` trong lõi là `default` (để bài thử xác định); mặc định sản phẩm (`auto`) đặt ở `apps/web` và `apps/desktop` qua `defaults`.
- Dữ liệu người dùng (dự án, lịch sử) có giới hạn kích thước (`projects-kv.ts`, `trimForSave`): đừng để lịch sử phình vô hạn.
- Số liệu chẩn đoán (`diagnostics.ts` + `deploy/220/diag/schema.json`) là danh sách trắng; thêm trường phải sửa cả hai nơi và giữ nguyên tắc **không nội dung**.
