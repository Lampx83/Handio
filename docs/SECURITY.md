# Bảo mật của Handio

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

**Truy cập mạng:** mọi đường dẫn dưới `/agent/` bắt buộc đăng nhập (SSO/tài khoản). Ngoại lệ chủ ý và duy nhất: đường dẫn đúng `/agent/` khi **chưa** đăng nhập trả về trang giới thiệu tĩnh (cùng tệp với `/agent/guide/`, không script, CSP chặt, không nhận POST, không lộ giao diện hay dữ liệu); `e2e-sso.mjs` kiểm tra điều này và kiểm tra `/agent/index.html` vẫn chuyển tới đăng nhập.

**Quyền và kiểm soát của người dùng**
- Mọi thao tác ghi tệp/chạy lệnh/tải web đều **xin phép**, kèm phần thay đổi (diff) hoặc bản mô tả. Chế độ mặc định **Tự động** chỉ tự chạy việc thường ngày trong dự án (sửa tệp, build/test/cài gói, git cục bộ) và vẫn hỏi khi xoá, đụng mạng, tệp bí mật, lệnh lạ hoặc sau khi đọc nội dung web; chế độ “Toàn quyền” là tuỳ chọn có chủ đích, có ở cả ba tab (quản trị viên có thể tắt bằng policy.json).
- **Phân tích lệnh shell** trước khi cho tự động: tách lệnh ghép (`&&`, `;`, `|`), từ chối cú pháp che giấu (`$()`, backtick, `$VAR`, chạy nền, brace expansion); quy tắc `allow` khớp **từng đoạn** lệnh; quy tắc `deny` bắt được lệnh nằm giữa chuỗi. Có bộ test cho từng cách lách đã biết.
- **Lệnh phá hoại** (`sudo`, `rm -rf` thư mục gốc/dự án, `git push --force`, tải về rồi chạy thẳng, bọc trong `bash -c`/`env`…) bị chặn ở **mọi** chế độ.
- **Tệp nhạy cảm** (`.env`, `*.pem`, `id_rsa`, `.npmrc`, `.aws/`, `.ssh/`, `credentials`…): đọc/ghi luôn phải hỏi (kể cả chế độ tự động; riêng chế độ **Toàn quyền** do chính người dùng chọn thì không hỏi); tìm kiếm hàng loạt bỏ qua chúng.
- **Nội dung web không tin cậy (“taint”):** sau khi agent đọc một trang web, mọi thao tác ghi/chạy lệnh/tải web trong lượt đó bị hỏi lại, **kể cả khi đã bật tự động duyệt**, và có cảnh báo. Ngoại lệ có chủ đích: chế độ **Toàn quyền** (nút đỏ, quản trị có thể cấm bằng `allowBypass:false`) không hỏi gì nữa; lệnh phá hoại và quy tắc `deny` vẫn bị chặn.
- Cấu hình nằm trong thư mục dự án **không tin cậy**: không đổi được máy chủ/key; quy tắc `allow` của dự án chỉ có hiệu lực khi người dùng bấm “Tin cậy”; sửa `.neuagent/**`, `.git/**`, `AGENTS.md`/`CLAUDE.md` (mọi thư mục), `.agents/rules/**`, `.claude/rules/**`… luôn hỏi (vì nội dung các tệp này đi thẳng vào lời nhắc hệ thống).
- **Nạp hướng dẫn (`@import`):** chỉ nạp tệp nằm trong dự án (hướng dẫn toàn cục: trong `~/.neuagent/`), kiểm tra cả liên kết tượng trưng, không nạp tệp nhạy cảm, tối đa 4 cấp, có giới hạn ký tự.
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
- **Dự án nhiều thư mục:** chỉ chọn thư mục qua hộp thoại của hệ điều hành (giao diện không tự đặt được đường dẫn qua IPC; mã dự án/cuộc trò chuyện chỉ nhận dạng `[a-z0-9-]`); **từ chối** gốc ổ đĩa, thư mục cá nhân, thư mục hệ thống và nơi chứa khoá (`~/.ssh`, `~/.aws`, `~/Library`…). “Bỏ dự án” chỉ xoá khỏi danh sách, không xoá tệp.
- **Lịch sử trò chuyện** lưu ở thư mục dữ liệu ứng dụng (quyền 600), không ghi vào thư mục dự án (không lẫn vào kho git của người dùng); kết quả công cụ dài bị cắt khi lưu.
- **Tab Design:** bản xem trước là iframe `sandbox=""` (không script, không cùng nguồn) trong trang có CSP không cho ra mạng. Xuất PDF/PNG chạy trong **cửa sổ ẩn riêng**: JavaScript của trang tắt, phiên riêng trong bộ nhớ, mọi yêu cầu mạng bị huỷ, chỉ đọc kích thước nội dung; tệp xuất ra tự đổi tên nếu trùng, không ghi đè.
- **Tab Work (xem tài liệu, trộn thư, dữ liệu cá nhân):** khung xem tài liệu nhận chữ trích xuất và chỉ đưa vào bằng `textContent` (không HTML); IPC `docView`/`procedure*` chỉ nhận chuỗi có giới hạn (tên quy trình là slug), lõi tự `resolveSafe` và chặn tệp nhạy cảm. `merge_documents`, `redact_pii`, `xlsx_pivot`, `docx_replace` (suggest) đi qua cùng cơ chế xin phép có bản mô tả, luôn ghi tệp MỚI (không ghi đè; trộn thư tối đa 200 bản, tên tệp làm sạch, `/undo` cả lô). Quét dữ liệu cá nhân chạy cục bộ, chỉ trả số lượng, vị trí và giá trị đã che; nhận diện theo mẫu/từ khoá nên có thể sót.
- **Thay đổi / Quay lại / Chạy thử:** IPC `changeDiff`, `changesRevert`, `rewind` chỉ nhận chuỗi/số có giới hạn; đường dẫn từ giao diện chỉ để *tra cứu* trong nhật ký thay đổi của phiên, không bao giờ dùng làm đường dẫn thật. Hoàn tác tự kiểm tra lại từng đường dẫn bằng `resolveSafe` (trong thư mục dự án, theo cả liên kết tượng trưng), không đụng tới tệp nhạy cảm (`.env`, khoá…) và không xoá thư mục. Theo dõi thay đổi do lệnh bash chỉ chụp tệp nhỏ trong dự án (bỏ `node_modules`, `.git`, tệp nhạy cảm, liên kết ra ngoài). `runSuggestions` chỉ đọc; nút “Chạy” gửi lời nhắc cho agent nên lệnh vẫn đi qua hệ thống xin quyền (tên tệp/script lạ không được ghép vào lệnh).
- Chỉ mở liên kết `https://`; nút “Mở bằng ứng dụng” từ chối tệp thực thi/kịch bản (`.exe .app .sh .js .py .lnk .jar`…).
- Tệp Office được kiểm tra **chống zip bomb** trước khi giải nén; PDF mở với chế độ không chạy mã.

**Kết nối mạng**
- Địa chỉ API **bắt buộc HTTPS** (trừ máy cục bộ); từ chối địa chỉ chứa tài khoản/mật khẩu; **không theo chuyển hướng**; báo lỗi rõ khi máy chủ trả về trang web thay vì mô hình.
- Key tích hợp (nếu người đóng gói chọn nhúng) chỉ được gửi tới đúng máy chủ đã khai báo.
- **Chẩn đoán không chứa nội dung (mặc định BẬT, tắt được; chỉ gửi khi ứng dụng được cấu hình điểm nhận — chưa cấu hình thì không gửi gì).** Để quản trị viên tự phát hiện lỗi và cải tiến, ứng dụng gửi số liệu kỹ thuật: loại sự kiện/lỗi, mã HTTP, tên công cụ (danh sách cố định) + thành công/thất bại + nhóm thời gian, số lần chạm giới hạn bước/lặp/tràn ngữ cảnh, số lần quyền được/bị từ chối, thời lượng lượt + số token, phiên bản, nền tảng, tab, tên mô hình và một mã ngẫu nhiên theo máy cài. **Không bao giờ gửi:** câu hỏi, câu trả lời, tên/đường dẫn/nội dung tệp, dòng lệnh, URL, thông điệp lỗi của công cụ, key, email. Bộ lọc là danh sách cho phép theo từng trường (trường lạ bị bỏ), có test nhét bí mật/đường dẫn/email để chứng minh không lọt ra.
  - **Danh tính chỉ do máy chủ gắn:** mã người dùng giả danh = HMAC của email SSO với bí mật chỉ máy chủ giữ; ứng dụng không gửi email. Giả danh không phải ẩn danh tuyệt đối: người giữ bí mật và danh sách email vẫn đối chiếu được.
  - **Lưu ở đâu/bao lâu:** máy 220, `/var/lib/neu-agent/diag/*.jsonl` (quyền 600, tự xoá sau **90 ngày**); nhật ký truy cập nginx của `/agent/` ở dạng JSON không có query string/cookie/email/IP, giữ 14 ngày. Báo cáo tổng hợp chỉ quản trị viên (danh sách riêng) xem được.
  - **Cách tắt:** công tắc trong Cài đặt (khi giao diện đã nối), hoặc quản trị viên ép tắt bằng `diagnostics:false` trong `policy.json`.
  - **“Báo lỗi”:** người dùng có thể thêm một ghi chú ngắn và xem **đúng** gói sẽ gửi trước khi gửi. Ghi chú là văn bản tự do do chính người dùng gõ — đừng dán dữ liệu nhạy cảm vào đó.
  - Chi tiết, ngưỡng phát hiện, cách đọc báo cáo: `docs/DIAGNOSTICS.md`.
- **Cập nhật (Desktop):** ứng dụng hỏi tệp `latest.json` (phiên bản + mã băm), mặc định tự tải nền bản mới từ đúng thư mục tải về của máy chủ ứng dụng (https, kèm đăng nhập, không theo chuyển hướng), kiểm kích thước + SHA-256 và kiểm lại ngay trước khi cài; cài khi người dùng đóng ứng dụng hoặc bấm nút. **Rủi ro đã chấp nhận:** mã băm lấy từ cùng máy chủ nên không chống được trường hợp máy chủ bị chiếm quyền (cần ký số, xem RELEASE-SIGNING.md); tắt được ở menu Tệp → Tự động cập nhật. Bản web cập nhật khi máy chủ triển khai.
- Không có quảng cáo hay phân tích của bên thứ ba.

**Đăng nhập (SSO Microsoft 365)**
- Mọi đường dẫn của máy chủ (web, bản tải, API) yêu cầu đăng nhập `@neu.edu.vn` hoặc `@st.neu.edu.vn`; chưa đăng nhập: trang → chuyển tới Microsoft, API → 401. Do `oauth2-proxy` + nginx đảm nhiệm (phiên cookie `HttpOnly`, `Secure`, `SameSite=Lax`, hết hạn 8 giờ).
- Desktop: OpenID Connect + **PKCE** qua trình duyệt hệ thống (không bao giờ gõ mật khẩu trong ứng dụng); kiểm tra `state`, `nonce`, chữ ký (JWKS), issuer, audience, hạn dùng và miền email; phiên (kèm refresh token) chỉ lưu bằng **kho mã hoá của hệ điều hành** (không có thì chỉ giữ trong bộ nhớ). Token chỉ gửi tới máy chủ đã khai báo; máy chủ chuyển yêu cầu tới gateway **không kèm token**, key mô hình do máy chủ gắn và không có trong gói cài.
- Chưa đăng nhập thì ứng dụng Desktop từ chối **mọi** lệnh nghiệp vụ (không chỉ ẩn giao diện). Đăng nhập chỉ là cổng truy cập mô hình; tệp của người dùng vẫn nằm trên máy họ.
- Hạn chế: cổng gateway 232:8037 còn mở với ai biết key (xem docs/DEPLOY.md); mã bí mật của ứng dụng Entra nằm trên máy 220 (`/etc/neu-agent/oauth2-proxy.env`, quyền 600).

**Quản trị**: tệp `policy.json` ở vị trí chỉ quản trị viên ghi được có thể **khoá** địa chỉ máy chủ, cấm HTTP, cấm chế độ “Toàn quyền”, tắt công cụ chạy lệnh, tắt mạng cho lệnh, **tắt chẩn đoán** (`diagnostics:false`) (xem `docs/INSTALL.md`).

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

**Cấp thêm hạn mức từ trang quản trị** (`/agent/admin/api/quota`): chỉ email trong `admins.txt`; POST có tiêu đề `X-Neu-Admin`, kiểm tra Origin/Sec-Fetch-Site/Content-Type (chống CSRF) và giới hạn 30 thao tác/phút; chỉ nhận `{op:"grant", uid, amount}` — người cấp do máy chủ gắn, `uid` phải đang có số liệu hôm nay, mỗi lần ≤ 100 triệu, tổng/ngày/người ≤ 1 tỷ, chỉ có hiệu lực trong ngày. Không đổi được `quota.json`, không chạm tệp mật khẩu; ghi duy nhất vào `grants.json` (quyền ghi thêm cho dịch vụ `neu-agent-diag` ở thư mục quota). Nhật ký ai cấp cho ai nằm trong chính tệp đó (chỉ quản trị viên xem).

**Quản lý tài khoản mật khẩu từ trang quản trị**: việc ghi tệp mật khẩu chỉ do dịch vụ phụ `neu-agent-accounts` (root, sandbox systemd: chỉ ghi `/etc/neu-agent`, không mạng) thực hiện qua socket Unix chỉ nhóm `neu-diag` mở được; trang quản trị (không phải root) chỉ gửi 5 loại yêu cầu đã kiểm tra chặt. Chỉ danh tính có trong `admins.txt` dùng được: email Microsoft, hoặc **tên đăng nhập của tài khoản mật khẩu khi được liệt kê đúng tên** (chữ thường, không có `@`; mặc định mọi tài khoản mật khẩu KHÔNG phải quản trị viên). Quyền theo đúng chuỗi: email cùng tên (`test01@…`) hay tên viết hoa không thừa quyền, và email Microsoft luôn có `@` nên không trùng tên đăng nhập. Tài khoản mật khẩu không có xác thực nhiều bước, vì vậy chỉ cấp cho người cần, đặt mật khẩu mạnh và gỡ khỏi `admins.txt` khi hết cần; POST chống CSRF; mọi thao tác ghi nhật ký (người làm do máy chủ gắn, không do trình duyệt khai), không ghi mật khẩu.
