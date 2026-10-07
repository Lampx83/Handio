# Cài đặt NEU Agent (Windows và macOS)

NEU Agent là ứng dụng máy tính giúp **học lập trình (tab Code)** và **xử lý công việc văn phòng (tab Work)**. Ứng dụng làm việc trên thư mục thật của bạn và luôn hỏi trước khi sửa tệp hay chạy lệnh.

## Chọn đúng tệp

| Hệ điều hành | Tệp | Ghi chú |
|---|---|---|
| macOS, chip Apple (M1/M2/M3/M4…) | `NEU-Agent-<phiên bản>-mac-arm64.dmg` | Kiểm tra: menu Apple → *Giới thiệu về máy Mac* |
| macOS, chip Intel | `NEU-Agent-<phiên bản>-mac-x64.dmg` | |
| Windows 10/11 (64-bit) | `NEU-Agent-<phiên bản>-win-x64.exe` | Trình cài đặt, không cần quyền quản trị |
| Windows, không cài đặt | `NEU-Agent-<phiên bản>-win-x64.zip` | Giải nén rồi chạy `NEU Agent.exe` |

**Kiểm tra tệp trước khi mở** (nên làm, nhất là khi nhận qua chat/email): so mã băm với tệp `SHA256SUMS.txt` do người gửi cung cấp qua một kênh khác.

```bash
# macOS
shasum -a 256 NEU-Agent-*.dmg
# Windows (PowerShell)
Get-FileHash .\NEU-Agent-*-win-x64.exe -Algorithm SHA256
```

## macOS

1. Mở tệp `.dmg`, kéo **NEU Agent** vào thư mục **Applications**.
2. Lần đầu mở, macOS sẽ báo *“không thể xác minh nhà phát triển”*. Đây là bình thường vì bản này **chưa được Apple ký/notarize** (cần tài khoản Apple Developer). Cách mở an toàn:
   - **macOS 15 (Sequoia) trở lên:** mở ứng dụng một lần (bị chặn) → *Cài đặt hệ thống* → *Quyền riêng tư & Bảo mật* → kéo xuống phần *Bảo mật* → bấm **Vẫn mở** cho NEU Agent.
   - **macOS 14 trở xuống:** trong Finder, bấm chuột phải vào NEU Agent → **Mở** → **Mở**.
   - Cách dòng lệnh (chỉ làm với tệp bạn đã kiểm tra mã băm): `xattr -dr com.apple.quarantine "/Applications/NEU Agent.app"`.
3. Thư mục làm việc mặc định: `~/Documents/NEU Code` và `~/Documents/NEU Work` (tạo tự động kèm dữ liệu mẫu). Đổi bằng menu **Tệp → Mở thư mục…**.

## Windows

1. Chạy `NEU-Agent-…-win-x64.exe`. Windows SmartScreen có thể báo *“Windows đã bảo vệ PC của bạn / Nhà phát hành không xác định”* vì bản này **chưa có chứng chỉ ký số**. Bấm **Thông tin thêm → Vẫn chạy**, **chỉ khi** mã băm tệp khớp `SHA256SUMS.txt`.
2. Chọn thư mục cài đặt (mặc định trong hồ sơ người dùng, không cần quyền quản trị) → *Install*.
3. Thư mục làm việc mặc định: `Documents\NEU Code` và `Documents\NEU Work`.
4. Tab Code chạy lệnh thật. Muốn chạy Python/Node/Git cần cài sẵn các công cụ đó (và có trong `PATH`). Nên cài **Git for Windows**.

## Lần đầu sử dụng

1. Mở ứng dụng → **Đăng nhập Microsoft** bằng tài khoản `@neu.edu.vn` (giảng viên) hoặc `@st.neu.edu.vn` (sinh viên); trình duyệt hệ thống sẽ mở để đăng nhập. Rồi mở tab **Work**, **Code** hoặc **Design**, thử một gợi ý trên màn hình chào.
2. Ứng dụng kết nối tới máy chủ mô hình theo địa chỉ cấu hình sẵn (HTTPS) bằng phiên đăng nhập của bạn, không cần nhập key. Đăng xuất ở **⚙ Cài đặt → Tài khoản**. Key được lưu **mã hoá bằng kho khoá của hệ điều hành** (Keychain / Windows DPAPI).
3. Mọi thay đổi tệp/chạy lệnh đều hiện hộp xác nhận kèm phần thay đổi; đọc rồi mới bấm *Cho phép*.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| “Địa chỉ API không trả về dữ liệu của mô hình” / không kết nối được | Máy chủ chưa sẵn sàng hoặc sai địa chỉ: hỏi người quản trị; kiểm tra mạng |
| “Địa chỉ API dùng HTTP không mã hoá” | Ứng dụng từ chối gửi key qua HTTP. Dùng địa chỉ `https://…`; chỉ khi ở mạng nội bộ tin cậy mới bật “Cho phép HTTP” trong Cài đặt (có thể bị người quản trị khoá) |
| Tab Code báo không tìm thấy `node`/`python`/`git` | Cài công cụ đó; trên macOS mở lại ứng dụng sau khi cài (ứng dụng đọc `PATH` từ shell đăng nhập) |
| Windows: tệp `.exe` bị diệt virus chặn | Bản chưa ký số có thể bị đánh dấu nhầm; so mã băm, nhờ người quản trị thêm ngoại lệ |
| Muốn xoá hoàn toàn | macOS: kéo ứng dụng vào Thùng rác + xoá `~/Library/Application Support/NEU Agent`. Windows: *Settings → Apps → NEU Agent → Uninstall*; dữ liệu ở `%APPDATA%\NEU Agent` |

## Dành cho người quản trị: khoá cấu hình

Tạo tệp `policy.json` (người dùng thường không sửa được) để khoá địa chỉ máy chủ, cấm HTTP, cấm chế độ “Tự động hết”, tắt công cụ chạy lệnh, tắt gửi chẩn đoán không chứa nội dung (`diagnostics:false`, xem `docs/DIAGNOSTICS.md`):

- macOS: `/Library/Application Support/NEU Agent/policy.json`
- Windows: `%ProgramData%\NEU Agent\policy.json`

```json
{
  "baseUrl": "https://ai.neu.edu.vn/agent/vllm/v1",
  "allowInsecureHttp": false,
  "allowBypass": false,
  "bashNetwork": true,
  "disableBash": false,
  "diagnostics": true,
  "notice": "Hỗ trợ: <liên hệ của đơn vị>"
}
```

Xem thêm `docs/SECURITY.md`.
