# Bảo mật của NEU Agent

Không có phần mềm nào “an toàn tuyệt đối”. Tài liệu này nói **đã làm gì, kiểm chứng thế nào, và điều gì CHƯA bảo vệ được**, để người dùng và người quản trị quyết định có cơ sở.

## 1. Tài sản cần bảo vệ và kẻ tấn công

| Tài sản | Mối đe doạ chính |
|---|---|
| Máy và tệp của người dùng | Agent bị **dụ** (prompt injection) bởi tài liệu/trang web/kho mã lạ để xoá, sửa, gửi dữ liệu đi |
| Khoá API, mật khẩu, khoá SSH, cookie | Bị đọc rồi gửi ra ngoài; bị ghi vào mã/nhật ký |
| Dữ liệu cá nhân trong tài liệu (điểm, lương, CCCD…) | Gửi tới máy chủ không tin cậy; nằm trong nhật ký/phiên làm việc |
| Máy chủ mô hình và key dùng chung | Bị lạm dụng (key lộ trong gói cài); nghe lén khi dùng HTTP |
| Chuỗi cung ứng | Thư viện độc hại, bản cài bị thay thế |

## 2. Các lớp bảo vệ đã có

**Quyền và kiểm soát của người dùng**
- Mọi thao tác ghi tệp/chạy lệnh/tải web đều **xin phép**, kèm phần thay đổi (diff) hoặc bản mô tả. Chế độ tự duyệt là tuỳ chọn có chủ đích; tab Work không có chế độ “Tự động hết”.
- **Phân tích lệnh shell** trước khi cho tự động: tách lệnh ghép (`&&`, `;`, `|`), từ chối cú pháp che giấu (`$()`, backtick, `$VAR`, chạy nền, brace expansion); quy tắc `allow` khớp **từng đoạn** lệnh; quy tắc `deny` bắt được lệnh nằm giữa chuỗi. Có bộ test cho từng cách lách đã biết.
- **Lệnh phá hoại** (`sudo`, `rm -rf` thư mục gốc/dự án, `git push --force`, tải về rồi chạy thẳng, bọc trong `bash -c`/`env`…) bị chặn ở **mọi** chế độ.
- **Tệp nhạy cảm** (`.env`, `*.pem`, `id_rsa`, `.npmrc`, `.aws/`, `.ssh/`, `credentials`…): đọc/ghi luôn phải hỏi (kể cả chế độ tự động); tìm kiếm hàng loạt bỏ qua chúng.
- **Nội dung web không tin cậy (“taint”):** sau khi agent đọc một trang web, mọi thao tác ghi/chạy lệnh/tải web trong lượt đó bị hỏi lại, **kể cả khi đã bật tự động duyệt**, và có cảnh báo.
- Cấu hình nằm trong thư mục dự án **không tin cậy**: không đổi được máy chủ/key; quy tắc `allow` của dự án chỉ có hiệu lực khi người dùng bấm “Tin cậy”; sửa `.neuagent/**`, `.git/**`, `AGENTS.md`… luôn hỏi.
- Đường dẫn bị giới hạn trong thư mục làm việc (resolve cả liên kết tượng trưng).

**Cách ly việc chạy lệnh**
- **macOS: sandbox cấp hệ điều hành (Seatbelt)** cho mọi lệnh của agent: chỉ **ghi** được trong thư mục dự án, thư mục tạm và vài thư mục cache; **không đọc** được `~/.ssh`, `~/.aws`, Keychain, cookie/dữ liệu trình duyệt, lịch sử shell…; không ghi được vào `/Applications`, `/Library`, LaunchAgents (chống cài chương trình nền). Chính sách có thể tắt mạng cho lệnh (`bashNetwork:false`).
- **Biến môi trường của tiến trình con được lọc theo danh sách cho phép**: token/khoá của ứng dụng hay của người dùng (`GITHUB_TOKEN`, `AWS_*`, `SSH_AUTH_SOCK`, `NODE_OPTIONS`…) không đến được lệnh do agent chạy.
- Lệnh có giới hạn thời gian và dung lượng đầu ra, dừng được bằng nút Dừng (huỷ cả nhóm tiến trình).
- Mã JavaScript chạy trong **trình duyệt** (bản web) nằm trong Web Worker dùng một lần, không DOM/mạng/IndexedDB, có CSP riêng, tự huỷ khi hết giờ.

**Ứng dụng Desktop (Electron)**
- Phiên bản Electron **mới nhất** tại thời điểm đóng gói (44.x); `npm audit` cho phần mã chạy thực tế: 0 lỗ hổng đã biết.
- Giao diện chạy trong cửa sổ cách ly: `sandbox`, `contextIsolation`, không Node, CSP `default-src 'none'; connect-src 'none'`; giao diện phục vụ qua giao thức riêng `app://` (không `file://`) với kiểm tra đường dẫn chống thoát thư mục; **mọi yêu cầu mạng của giao diện bị huỷ**; điều hướng/cửa sổ mới/webview bị chặn; DevTools tắt trong bản phát hành; mọi quyền (camera, mic, vị trí…) bị từ chối.
- **IPC** giữa giao diện và tiến trình chính: danh sách lệnh cố định, kiểm tra người gửi, kiểm tra kiểu/kích thước từng tham số, giới hạn tần suất, không lộ chi tiết lỗi nội bộ; giao diện **không thể** đặt quy tắc quyền hay chế độ qua IPC.
- **Electron Fuses** tắt `RunAsNode`, `NODE_OPTIONS`, `--inspect`; chỉ nạp ứng dụng từ **asar có kiểm tra toàn vẹn**; mã hoá cookie.
- Bản phát hành **không chứa mã kiểm thử/giả lập** và **không chứa khoá API**.
- Key người dùng nhập được lưu **mã hoá bằng kho khoá hệ điều hành** (`safeStorage`: Keychain/DPAPI); nếu không có kho khoá thì **không** lưu ra đĩa.
- Chỉ mở liên kết `https://`; nút “Mở bằng ứng dụng” từ chối tệp thực thi/kịch bản (`.exe .app .sh .js .py .lnk .jar`…).
- Tệp Office được kiểm tra **chống zip bomb** trước khi giải nén; PDF mở với chế độ không chạy mã.

**Kết nối mạng**
- Địa chỉ API **bắt buộc HTTPS** (trừ máy cục bộ); từ chối địa chỉ chứa tài khoản/mật khẩu; **không theo chuyển hướng**; báo lỗi rõ khi máy chủ trả về trang web thay vì mô hình.
- Key tích hợp (nếu người đóng gói chọn nhúng) chỉ được gửi tới đúng máy chủ đã khai báo.
- Không có telemetry, không báo cáo sự cố, không tự cập nhật.

**Quản trị**: tệp `policy.json` ở vị trí chỉ quản trị viên ghi được có thể **khoá** địa chỉ máy chủ, cấm HTTP, cấm chế độ “Tự động hết”, tắt công cụ chạy lệnh, tắt mạng cho lệnh (xem `docs/INSTALL.md`).

## 3. Điều CHƯA bảo vệ được (nói thẳng)

1. **Windows chưa có sandbox hệ điều hành** cho lệnh. Lệnh đã được người dùng duyệt chạy với toàn quyền của người dùng đó. Hãy đọc kỹ từng lệnh; quản trị viên có thể đặt `disableBash:true`. (Lộ trình: chạy trong AppContainer/WSL hoặc container.)
2. **Lệnh đã duyệt vẫn là lệnh thật.** Sandbox macOS giảm thiệt hại (ghi ngoài dự án, đọc khoá) nhưng một lệnh được duyệt vẫn có thể xoá **toàn bộ thư mục dự án** hay gửi dữ liệu trong dự án ra Internet (nếu mạng được phép). Đừng duyệt lệnh bạn không hiểu; làm việc với bản sao khi thử nghiệm.
3. **Máy chủ mô hình nhìn thấy mọi nội dung** bạn gửi (câu hỏi, đoạn tài liệu, mã). Không đưa dữ liệu mà bạn không được phép chia sẻ với máy chủ đó. Phiên làm việc và tệp nằm trên đĩa của bạn, không mã hoá riêng ngoài cơ chế của hệ điều hành.
4. **Prompt injection không thể loại bỏ hoàn toàn** với mô hình ngôn ngữ. Các lớp trên chỉ giảm tác hại; lớp quan trọng nhất là người dùng đọc trước khi duyệt.
5. **Gói cài chưa được ký số** bởi Apple/Microsoft: hệ điều hành sẽ cảnh báo “nhà phát hành không xác định”. Người nhận phải **so mã băm** (`SHA256SUMS.txt`) trước khi mở. Ký số cần chứng chỉ (Apple Developer ID + notarize; chứng chỉ code signing cho Windows).
6. **Máy chủ web `/agent/vllm/`** của bản web là cửa ngõ không cần đăng nhập nếu không đặt thêm giới hạn (xem `docs/DEPLOY.md`).
7. Key dùng chung nhúng trong gói (nếu chọn) **lấy ra được** từ ứng dụng; bản mặc định không nhúng key.

## 4. Cách kiểm chứng

```bash
npm run typecheck && npm test            # ~180 test, gồm: phân tích lệnh, quyền, tệp nhạy cảm, taint, zip bomb,
                                         # sandbox macOS, môi trường tiến trình con, giao thức app://, IPC, HTTPS
npm audit --omit=dev                     # lỗ hổng thư viện
npm run smoke                            # mở app Electron thật: nghiệp vụ + 5 bài thử tấn công từ giao diện
npm run pack:smoke                       # đóng gói thật rồi chạy lại cùng bộ kiểm thử trên GÓI (asar, fuses)
npx electron-fuses read --app "apps/desktop/release/mac-arm64/NEU Agent.app"   # xem fuses
codesign -dv --verbose=2 "apps/desktop/release/mac-arm64/NEU Agent.app"        # chữ ký (ad-hoc)
```

Bản đóng gói đi kèm `SHA256SUMS.txt` và `SBOM.cdx.json` (danh sách thư viện).

## 5. Báo lỗi bảo mật

Gửi mô tả và cách tái hiện **riêng** cho người quản trị dự án (không đăng công khai trước khi có bản vá). Ưu tiên: thoát khỏi thư mục làm việc, chạy lệnh không qua xin phép, lộ khoá, vượt sandbox, thực thi mã từ tệp/trang web.
