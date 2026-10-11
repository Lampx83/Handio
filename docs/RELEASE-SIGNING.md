# Ký số bản Desktop (để tải về là chạy, không bị coi là phần mềm lạ)

Hiện tại các gói cài **chưa ký số**: macOS và Windows đều cảnh báo “nhà phát hành không xác định”. Muốn hết cảnh báo phải có **danh tính nhà phát hành được xác minh** do Apple và nhà cấp chứng chỉ Windows cấp. Việc này cần pháp nhân của trường (không làm thay được bằng mã). Phần kỹ thuật đã làm sẵn: chỉ cần điền chứng chỉ.

## Cần làm gì, ai làm

| Nền tảng | Việc | Ai | Kết quả khi xong |
|---|---|---|---|
| **macOS** | Đăng ký **Apple Developer Program** bằng tên tổ chức (cần số D-U-N-S; trường có thể đã có tài khoản, hỏi phòng CNTT/Tài chính) | Đại diện trường | Cấp được chứng chỉ **Developer ID Application** |
| macOS | Tạo chứng chỉ Developer ID Application (xuất `.p12`) và **khoá API App Store Connect** (`.p8`, Key ID, Issuer ID) để notarize | Người giữ tài khoản Apple | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY(_ID)`, `APPLE_API_ISSUER` |
| **Windows** | Mua chứng chỉ **code signing tổ chức (OV hoặc EV)** từ một nhà cấp (DigiCert, Sectigo, SSL.com…). Từ 2023 khoá phải nằm trên phần cứng/HSM: chọn gói **ký đám mây** (SSL.com eSigner, DigiCert KeyLocker…) hoặc USB token | Đại diện trường | Chứng chỉ có tên “Trường Đại học Kinh tế Quốc dân” |
| Windows | Dựng bản Windows **trên máy Windows** (GitHub Actions `windows-latest` đã có sẵn trong `.github/workflows/release.yml`) | Tự động | `.exe` mang chữ ký Authenticode |

Ghi chú về Windows (theo [Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) và [bài tổng hợp 2026](https://sslinsights.com/best-code-signing-certificate-for-windows-application/)): từ 2024 EV **không còn** được bỏ qua SmartScreen ngay; danh tiếng tích luỹ theo thời gian. Ký số vẫn quan trọng vì hiện tên nhà phát hành thay cho “không xác định” và giúp danh tiếng tích luỹ nhanh hơn. **Azure Artifact Signing** (rẻ, ~10 USD/tháng) hiện [chỉ cấp cho tổ chức ở Mỹ, Canada, EU, Anh](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/), nên chưa dùng được ở Việt Nam.

## Khi trường chưa có tài khoản/chứng chỉ nào: cách ngắn nhất

Ký số cần danh tính pháp lý và thanh toán của **người đứng tên** nên không ai làm thay được. Lộ trình rẻ và nhanh nhất:

| Nền tảng | Cách | Chi phí/thời gian | Ghi chú |
|---|---|---|---|
| **Cài từ trình duyệt (PWA)** | Mở trang web → Chrome/Edge → *Cài đặt Hando* (nút trong hộp “Tải ứng dụng” hoặc biểu tượng trên thanh địa chỉ) | Miễn phí, **dùng ngay** | Không tải tệp thực thi nên không có cảnh báo nào. Chạy bản web (thư mục ảo, không terminal) |
| **macOS** | Đăng ký [Apple Developer Program](https://developer.apple.com/programs/enroll/) **cá nhân** (không cần số D-U-N-S, xác minh bằng giấy tờ tuỳ thân), lấy chứng chỉ *Developer ID Application* + khoá API để notarize. Notarize nhận cả tài khoản cá nhân | 99 USD/năm, thường vài ngày | Hộp cảnh báo của macOS sẽ ghi tên cá nhân người đăng ký. Sau này đổi sang tổ chức khi trường có D-U-N-S |
| **Windows** | Phát hành qua **Microsoft Store** dạng MSIX: Microsoft ký, không có SmartScreen. Từ 2025 tài khoản nhà phát triển cá nhân [miễn phí](https://alternativeto.net/news/2025/9/microsoft-finally-drops-microsoft-store-publishing-fee-for-individual-developers-globally) (chưa xác nhận được Việt Nam có trong danh sách quốc gia hỗ trợ: hãy thử đăng ký ở Partner Center) | Miễn phí, qua kiểm duyệt của Microsoft | Cần thêm mục tiêu `appx` (tên/nhà phát hành lấy từ Partner Center). Tôi làm phần này khi bạn có tài khoản |
| Windows (ngoài Store) | Mua chứng chỉ code-signing OV loại ký đám mây (SSL.com eSigner, DigiCert KeyLocker…) | khoảng 200–400 USD/năm | Cá nhân cũng mua được ở một số nhà cấp; vẫn cần thời gian để SmartScreen tin tưởng |

Có thông tin đăng nhập cho các dịch vụ trên thì đặt vào **GitHub Secrets** (bảng bên dưới), không gửi qua chat; sau đó chạy workflow **Release**.

## Cách chắc chắn nhất cho máy của trường
- **Triển khai bằng Intune/GPO** (Company Portal) kèm chứng chỉ ký của trường được IT đưa vào kho tin cậy: máy do trường quản lý chạy ngay, không cảnh báo.
- Hoặc phát hành qua **Microsoft Store** (Partner Center; Store ký và không có SmartScreen) và **Homebrew/winget** cho người dùng kỹ thuật.

## Điền chứng chỉ rồi phát hành
Không bao giờ ghi bí mật vào mã nguồn hay chat. Đặt vào **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Nội dung |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | `.p12` Developer ID (base64) và mật khẩu |
| `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Khoá notarize |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | `.pfx` (base64) và mật khẩu — hoặc cấu hình dịch vụ ký đám mây của nhà cấp |
| Variables `NEU_AUTH_TENANT`, `NEU_AUTH_CLIENT_ID` | Cấu hình đăng nhập SSO (không bí mật) |

Rồi gắn tag `v0.2.0` (hoặc chạy tay workflow **Release**). Workflow dựng, **ký, notarize**, kiểm tra chữ ký (`scripts/verify-signature.mjs`), tạo `SHA256SUMS.txt` và **bằng chứng nguồn gốc** (GitHub build provenance: tệp do chính repo này dựng từ commit này), rồi tạo bản nháp trên GitHub Releases. Chạy tại máy Mac: `NEU_REQUIRE_SIGNED=1 npm run dist -w @neu/agent-desktop --` hoặc `npm run dist:signed`. Thiếu điều kiện ký mà đặt `NEU_REQUIRE_SIGNED=1` thì script **dừng**, không phát hành bản không ký.

Kiểm tra bản đã dựng: `npm run verify:signature -w @neu/agent-desktop` (macOS: `codesign`, `spctl` phải báo *Notarized Developer ID*, `stapler validate`; Windows: Authenticode hợp lệ). Kết quả ghi vào `release/signing.json` và `latest.json`; trang tải chỉ hiện “Đã ký bởi …” khi **thật sự** đã ký, ngược lại vẫn nhắc cách mở bản chưa ký.

## Giảm nghi ngờ virus (làm được ngay, không cần chứng chỉ)
- Không làm rối mã (không obfuscate), không tự cập nhật ngầm, không nhúng key; có SBOM (`SBOM.cdx.json`) và mã băm công khai.
- Tải qua HTTPS từ tên miền của trường, sau đăng nhập SSO; mã băm hiển thị trên trang và qua kênh khác.
- Nếu một trình diệt virus báo nhầm: gửi tệp tới [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) (đánh dấu *false positive*) và tới nhà sản xuất AV đó. Quét trước bằng VirusTotal và chỉ phát hành khi sạch.
- Chia nhỏ rủi ro: cho phép người dùng kiểm `SHA256SUMS.txt` (hộp tải có hướng dẫn một lệnh).

## Chứng chỉ cố định cho bản CHƯA có Developer ID (tránh hộp thoại Keychain lặp lại)

Bản ký "ad-hoc" có danh tính đổi theo từng bản build, nên Keychain của macOS hỏi lại *"Hando wants to use your confidential information…"* sau mỗi lần cập nhật (bấm "Always Allow" cũng không giữ được sang bản sau). Cách chữa tạm khi chưa có Developer ID: ký mọi bản bằng **một chứng chỉ tự cấp cố định** của máy dựng.

```bash
D=~/.neu-agent-signing; mkdir -p $D && chmod 700 $D && cd $D
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -subj "/CN=NEU Agent Local Signing/O=NEU FIT" \
  -addext "keyUsage=critical,digitalSignature" -addext "extendedKeyUsage=critical,codeSigning" -addext "basicConstraints=critical,CA:false"
openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -out id.p12 -passout pass:neu-local
security import id.p12 -k ~/Library/Keychains/login.keychain-db -P neu-local -T /usr/bin/codesign
```

`npm run dist -w @neu/agent-desktop` tự phát hiện chứng chỉ tên "NEU Agent Local Signing" (hoặc `NEU_LOCAL_SIGN_NAME`) và ký lại .app bằng nó (`scripts/after-sign.cjs`). Danh tính trở thành `identifier "vn.edu.neu.agent" and certificate root = H"…"`: không đổi giữa các bản, nên người dùng chỉ gặp hộp thoại Keychain **một lần** trên mỗi máy.

- **Giữ kỹ** `~/.neu-agent-signing/` (khoá riêng). Mất khoá hoặc đổi chứng chỉ thì danh tính đổi và mọi người gặp lại hộp thoại một lần.
- Đây **không** thay cho Developer ID + notarize: Gatekeeper vẫn cảnh báo lần đầu mở bản tải về.
- Khi có Developer ID thì danh tính đổi sang Developer ID một lần (người dùng gặp hộp thoại thêm một lần), sau đó ổn định.
