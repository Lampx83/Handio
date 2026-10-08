# Quản lý phiên bản, phát hành và cập nhật NEU Agent

Tài liệu này trả lời ba câu hỏi: **phiên bản được đánh số và theo dõi thế nào**, **phát hành một bản mới thế nào**, và **người dùng nhận bản mới thế nào**. Ký số xem [RELEASE-SIGNING.md](RELEASE-SIGNING.md); cài lên máy chủ xem [DEPLOY.md](DEPLOY.md); cải tiến liên tục xem [CAI-TIEN.md](CAI-TIEN.md).

## 1. Nguyên tắc

| Điều | Quy ước |
|---|---|
| Đánh số | [Semantic Versioning](https://semver.org/lang/vi/) `MAJOR.MINOR.PATCH`. **PATCH**: sửa lỗi. **MINOR**: thêm tính năng, vẫn tương thích. **MAJOR**: đổi không tương thích (ví dụ định dạng dự án/cài đặt). Bản thử: hậu tố `-beta.1` (thấp hơn bản chính cùng số). |
| Nguồn sự thật | `version` trong `package.json` ở gốc. Mọi gói (`packages/*`, `apps/*`) và `package-lock.json` luôn cùng số: dùng `npm run version:bump`, **không sửa tay**. |
| Nhật ký thay đổi | [CHANGELOG.md](../CHANGELOG.md), viết cho **người dùng**. Ghi dần vào mục “Chưa phát hành” khi làm xong từng việc; lúc phát hành nó thành mục của phiên bản và là nội dung “Có gì mới” trong ứng dụng. |
| Tag | `vX.Y.Z` trên đúng commit phát hành. CI từ chối tag không khớp phiên bản trong `package.json`. |
| Web và Desktop | **Bản web luôn là bản mới nhất** (người dùng mở trang là được bản đang chạy trên máy chủ). **Desktop** là bản cài trên máy người dùng nên cần cơ chế cập nhật (mục 4). |
| Không cập nhật ngầm | Ứng dụng chỉ **báo** có bản mới; chỉ tải khi người dùng bấm; kiểm tra SHA-256; không tự cài, không tự chạy. Lý do: xem [RELEASE-SIGNING.md](RELEASE-SIGNING.md) (giảm nghi ngờ phần mềm lạ) và [SECURITY.md](SECURITY.md). |

Công cụ: `scripts/version.mjs` (Node thuần).

```bash
npm run version:check                 # mọi gói cùng phiên bản + CHANGELOG có mục cho phiên bản đó (CI cũng chạy)
node scripts/version.mjs show         # xem phiên bản ở từng gói
node scripts/version.mjs notes        # in ghi chú phát hành sẽ vào latest.json
npm run version:bump -- minor         # patch | minor | major | X.Y.Z[-beta.1]; thêm --allow-empty nếu chưa ghi gì trong "Chưa phát hành"
```

## 2. Quy trình phát hành (checklist)

1. **Ghi CHANGELOG** cho mọi thay đổi người dùng thấy (mục “Chưa phát hành”: Thêm / Thay đổi / Sửa / Bảo mật).
2. **Kiểm tra**: `npm run typecheck && npm test && npm run smoke`. Xem trang quản trị (mục “Chất lượng”) xem bản hiện tại có đang gặp lỗi mà bản mới phải sửa không.
3. **Nâng phiên bản**: `npm run version:bump -- <patch|minor|major>`. Lệnh sửa mọi `package.json`, `package-lock.json` và chuyển “Chưa phát hành” thành mục phiên bản mới. Rồi:
   ```bash
   git add -A && git commit -m "Phát hành X.Y.Z" && git tag vX.Y.Z && git push --follow-tags
   ```
4. **Dựng, ký, tạo mã băm**: đẩy tag `vX.Y.Z` để GitHub Actions *Release* chạy (hoặc `npm run dist:signed -w @neu/agent-desktop` trên máy Mac). Kết quả ở `apps/desktop/release/`: `.dmg` (Apple silicon + Intel), `.exe`, `SHA256SUMS.txt`, `SBOM.cdx.json`, `latest.json` (đã có ghi chú lấy từ CHANGELOG).
5. **Đặt phiên bản tối thiểu (tuỳ chọn)**: nếu bản cũ có lỗi nghiêm trọng/bảo mật cần buộc cập nhật, đặt `NEU_MIN_VERSION=X.Y.Z` khi dựng (hoặc `-m X.Y.Z` ở bước 6). Người dùng đang dùng bản thấp hơn sẽ thấy hộp thoại **bắt buộc** cập nhật, không bấm bỏ qua được. Dùng rất hạn chế.
6. **Đưa lên máy 220** (theo [DEPLOY.md](DEPLOY.md)):
   ```bash
   deploy/220/prepare.sh                                   # dựng web, gom bản cài + mã băm + latest.json vào deploy/220/downloads
   # (hoặc chỉ tạo lại latest.json:  deploy/220/make-latest.sh -m X.Y.Z   # -n "ghi chú" nếu không muốn lấy từ CHANGELOG)
   scp -r deploy/220 220:~/neu-agent-220
   ssh -t 220 'cd ~/neu-agent-220 && sudo ./install.sh <key mô hình>'     # kiểm mã băm trước khi chép, tự khôi phục nếu lỗi
   ```
   Thứ tự quan trọng: **bản cài và `latest.json` lên cùng lúc** (ứng dụng chỉ tải tệp có trong `latest.json` và so mã băm). `install.sh` dừng nếu mã băm không khớp.
7. **Kiểm tra sau phát hành**: mở `https://ai.neu.edu.vn/agent/download/latest.json` (đúng phiên bản), tải thử một bản; xem trang quản trị mục *Phát hành & cập nhật* (tỷ lệ người dùng đã lên bản mới) và *Chất lượng* trong 24–48 giờ đầu.

### Nhịp phát hành gợi ý
- **PATCH** khi có lỗi người dùng gặp (nhanh, bất kỳ lúc nào).
- **MINOR** mỗi 2–4 tuần, gom các việc đã chọn ở buổi rà soát tuần (xem [CAI-TIEN.md](CAI-TIEN.md)).
- **MAJOR** hiếm; báo trước, có hướng dẫn chuyển đổi.

### Thu hồi một bản lỗi
Ứng dụng chỉ báo khi `latest.json` có bản **cao hơn** bản đang chạy, nên không “hạ cấp” được người đã cập nhật. Khi bản mới có lỗi: (1) nếu chưa nhiều người cập nhật, đưa `latest.json` về phiên bản trước (`make-latest.sh -v <cũ>` với bản cài cũ còn trong `downloads/`) để người chưa cập nhật không nhận bản lỗi; (2) sửa lỗi và phát hành PATCH cao hơn càng sớm càng tốt; (3) ghi vào CHANGELOG. Luôn **giữ bản cài của ít nhất hai phiên bản gần nhất** trong `downloads/`.

## 3. Cách người dùng thấy và nhận bản mới

**Bản web / PWA**: không cần làm gì; mỗi lần mở trang là bản đang chạy trên máy chủ.

**Desktop** ([apps/desktop/src/updater.ts](../apps/desktop/src/updater.ts), [packages/core/src/updates.ts](../packages/core/src/updates.ts)):

1. Sau khi đăng nhập, 15 giây sau khi mở và **mỗi 6 giờ**, ứng dụng đọc `https://ai.neu.edu.vn/agent/download/latest.json` (kèm tiêu đề đăng nhập; không theo chuyển hướng; phản hồi là trang HTML thì bỏ qua).
2. Nếu có bản cao hơn: hiện thanh ở góc dưới phải — *“Có bản mới NEU Agent X.Y.Z”*, nút **Có gì mới** (ghi chú từ CHANGELOG), **Tải về (kích thước)** và **Để sau** (ẩn đúng bản đó; bản mới hơn sẽ hiện lại).
3. Bấm **Tải về**: tải đúng tệp hợp máy (macOS đúng chip Apple/Intel; Windows `.exe`) vào thư mục *Tải xuống*, hiện tiến trình, **kiểm tra kích thước và SHA-256** với `latest.json`. Sai mã băm thì xoá tệp và báo lỗi. Đúng thì báo *“Đã tải … đã kiểm tra mã băm”* và mở thư mục chứa tệp.
4. Người dùng **đóng NEU Agent rồi mở tệp vừa tải** để cài đè (dữ liệu và cài đặt giữ nguyên vì nằm ngoài thư mục ứng dụng).
5. Có thể kiểm tra thủ công bất kỳ lúc nào: menu **Tệp → Kiểm tra bản cập nhật…** (báo cả khi đã là bản mới nhất, và hiện lại bản từng bấm “Để sau”).
6. Nếu `latest.json` có `minVersion` cao hơn bản đang chạy: hộp thoại **“Cần cập nhật”**, không có nút bỏ qua.

Không có cập nhật khi chạy từ mã nguồn (`npm run desktop`) hay trong kiểm thử (`npm run smoke`).

Khi chưa ký số, macOS/Windows vẫn cảnh báo “nhà phát hành không xác định” ở lần mở bản mới; xem [RELEASE-SIGNING.md](RELEASE-SIGNING.md) để loại bỏ cảnh báo đó. Trong lúc chờ ký, mã băm hiển thị trong ứng dụng/trang tải là cách xác minh.

### Định dạng `latest.json`
```json
{
  "version": "0.2.0",
  "released": "2026-10-20",
  "notes": "Thêm\n• …",
  "minVersion": "0.1.5",
  "files": { "NEU-Agent-0.2.0-mac-arm64.dmg": { "sha256": "<64 hex>", "size": 119106640 } },
  "signed": { "mac": false, "win": false }
}
```
`minVersion` không bắt buộc. Tên tệp chỉ gồm `A-Za-z0-9._-`; ứng dụng bỏ qua mục sai định dạng.

## 4. Theo dõi sau phát hành

Trang quản trị `https://ai.neu.edu.vn/agent/admin/` (mục *Cách sử dụng → Phát hành & cập nhật*) cho biết phiên bản đang phát hành, **tỷ lệ người dùng 30 ngày đã dùng bản đó**, số người còn dưới `minVersion`, phân bố phiên bản, và số lần Desktop kiểm tra cập nhật mỗi ngày. Tỷ lệ cập nhật thấp sau vài ngày nghĩa là người dùng chưa thấy thông báo (kiểm tra đăng nhập, `latest.json`) hoặc ngại cập nhật (xem ghi chú phát hành có đủ rõ không).
