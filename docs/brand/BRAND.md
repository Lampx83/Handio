# Bộ nhận diện thương hiệu Hando

**Hando** (đọc: *han-đô*) là trợ lý AI của Trường Đại học Kinh tế Quốc dân giúp làm việc văn phòng, viết mã và thiết kế.
Tên gồm *hand* (bàn tay) + *do* (làm): **bàn tay làm việc giúp bạn**, đúng nghĩa "giúp bạn một tay".

## 1. Cốt lõi
| | |
|---|---|
| Tên | **Hando** (viết hoa chữ H, còn lại thường; không viết HANDO, hando). Khi cần phiên âm: *han-đô* |
| Khẩu hiệu | **Giúp bạn một tay.** Biến thể: "Giao việc, Hando làm." |
| Mô tả ngắn | Trợ lý AI làm việc văn phòng, viết mã và thiết kế — nói ít, ra sản phẩm hoàn chỉnh. |
| Chủ sở hữu | Khoa Công nghệ thông tin, Trường Đại học Kinh tế Quốc dân |
| Giọng điệu | Thân thiện, rõ ràng, ngắn gọn; "bạn" và "tôi"; không hứa quá; nói thật khi làm chưa được |

## 2. Biểu tượng: bàn tay
Một bàn tay mở giơ lên (giúp, chào) với **dấu tích xanh trong lòng bàn tay** (xong việc) và **còng tay màu cam** (màu của "do", hành động).
Cánh tay chảy ra khỏi khung: tay luôn sẵn sàng giúp.

Hai phong cách, cùng hình học, chọn một cho từng bối cảnh:

| | **2D** | **3D** (đất sét) |
|---|---|---|
| Nhìn | phẳng, nét sạch, viền sáng, bóng phẳng | khối, có ánh sáng và bóng đổ, còng vàng |
| Hợp với | cỡ rất nhỏ (16–32 px), in một màu, thanh công cụ | biểu tượng ứng dụng, trang giới thiệu, slide, ảnh bìa |
| Tệp | `hand-2d-*.svg`, `hand-free-2d-*.svg` | `hand-3d-*.svg`, `hand-free-3d-*.svg` |

Cả hai là **vector (SVG)**; 3D tạo khối bằng bộ lọc ánh sáng của SVG nên vẫn co giãn không vỡ. Xem toàn bộ ở `hand-gallery.html`
(mở bằng trình duyệt: có đủ chuyển động).

## 3. Chuyển động (7 kiểu, mỗi phong cách đều có)
| Tệp `…-<tên>.svg` | Khi nào dùng |
|---|---|
| `static` | biểu tượng ứng dụng, favicon, in ấn |
| `wave` — vẫy tay chào | màn hình chào, lần mở đầu, email/ảnh chào mừng |
| `offer` — đưa tay giúp | giới thiệu tính năng, trang giới thiệu |
| `wiggle` — gõ phím | agent đang soạn/đang viết mã |
| `count` — đếm ngón | đang tải, đang xử lý nhiều bước |
| `working` — mã · bút · tài liệu quay quanh | đang làm việc (3 chế độ Code, Design, Work) |
| `done` — dấu tích bật ra, lấp lánh | hoàn thành việc |
| `breathe` — nhịp thở | chờ, nghỉ |

Quy tắc: chuyển động **êm, ngắn** (≤ 3,6 s mỗi vòng), không nhấp nháy; tôn trọng `prefers-reduced-motion` (đã nhúng sẵn: chuyển động tự tắt).
Không dùng quá một bàn tay chuyển động trong cùng một màn hình.

## 4. Màu
| Tên | Hex | Dùng cho |
|---|---|---|
| **Xanh Hando** | `#0B4A9E` | màu chính, nút chính, chữ "Han", liên kết |
| Xanh sáng | `#1B7FD0` | nền chuyển sắc, nhấn nhẹ |
| Xanh sâu | `#083A7D` | nền tối, tiêu đề trên nền sáng |
| **Cam "do"** | `#F59E0B` | còng tay, chữ "do", điểm nhấn hành động (ít, không quá 10% diện tích) |
| Xanh nhạt | `#E4EDFA` | nền thẻ, vùng nhấn |
| Mực | `#1F2328` | chữ chính |
| Xám | `#6B7078` | chữ phụ |
| Giấy | `#F6F6F3` | nền sáng |
| Xanh lá | `#1A7F4B` | thành công |
| Đỏ | `#C0302B` | lỗi, nguy hiểm |

Chế độ tối: nền `#17181A`, xanh `#5B9BFF`, chữ `#E8E6E1` (đã dùng trong ứng dụng).

## 4b. Chữ
- **Wordmark "Hando"**: vẽ riêng, nét đều đầu tròn; **"Han" xanh, "do" cam** (`wordmark.svg`, bản trắng `wordmark-white.svg`). Không dùng phông thay thế cho wordmark.
- **Giao diện**: chữ hệ thống (`system-ui`, Segoe UI, Roboto…) có đủ tiếng Việt.
- **In ấn/slide**: *Be Vietnam Pro* hoặc *Inter* (đủ dấu tiếng Việt). Tiêu đề đậm, nội dung thường, cỡ ≥ 16 px/12 pt.

## 5. Dùng logo
- **Vùng an toàn**: chừa quanh logo một khoảng ≥ bề rộng một ngón tay (≈ 1/8 chiều rộng biểu tượng).
- **Cỡ tối thiểu**: biểu tượng ≥ 16 px (dùng 2D), logo ngang ≥ 96 px chiều cao chữ.
- **Nền**: biểu tượng có nền xanh dùng trên nền sáng hoặc tối; bàn tay không nền (`hand-free-*`) chỉ đặt trên nền đủ tương phản với màu trắng (xanh, tối, ảnh tối).
- **Không**: kéo méo, xoay ngược, đổi màu cam sang màu khác, thêm viền/bóng khác, đặt chữ chồng lên bàn tay, dùng cả 2D và 3D cạnh nhau.
- **Cùng thương hiệu NEU**: ghi "Hando · Khoa Công nghệ thông tin, Trường Đại học Kinh tế Quốc dân" ở chân trang/slide cuối; không đặt logo trường lên logo Hando.

## 6. Tệp
| Tệp | Là gì |
|---|---|
| `hand-{2d,3d}-<chuyển động>.svg` | bàn tay trên ô vuông xanh bo góc (biểu tượng ứng dụng) |
| `hand-free-{2d,3d}-<chuyển động>.svg` | bàn tay không nền |
| `app-icon-{2d,3d}-{1024…16}.png` | PNG của biểu tượng (góc bo trong suốt) |
| `wordmark.svg`, `wordmark-white.svg` | chữ Hando |
| `logo-horizontal.svg` | biểu tượng + chữ ngang |
| `banner-1200x630.png` | ảnh bìa/chia sẻ mạng xã hội |
| `hand-gallery.html` | xem tất cả và chuyển động |

Được dùng trong: biểu tượng Desktop (`apps/desktop/build/icon.png`), web (`apps/web/icon*.png|svg`), trang giới thiệu/đăng nhập, thanh trên và màn hình chào của ứng dụng.

## 7. Dựng lại
```bash
python3 docs/brand/build_hand.py              # bàn tay SVG (2D/3D, chuyển động) + thư viện + biểu tượng nhúng giao diện
python3 docs/brand/serve-render.py &          # rồi mở http://127.0.0.1:5181/render.html#auto để dựng PNG từ SVG bằng trình duyệt
python3 docs/brand/build_assets.py --style 3d  # wordmark, logo ngang, banner; chép biểu tượng vào ứng dụng (2d hoặc 3d)
```
Đổi sang phong cách 2D: chạy lại `build_assets.py --style 2d` rồi dựng lại ứng dụng.

## 8. Đổi tên về sau / triển khai cho tổ chức khác
Tên hiển thị nằm trong chuỗi giao diện, lời nhắc của agent, tài liệu và trang giới thiệu; tệp cài vẫn có tiền tố `NEU-Agent-` và thư mục cấu hình cũ
(`.neuagent`, `@neu/agent-desktop`) để **không làm mất dữ liệu người dùng và giữ cập nhật Desktop hoạt động**. Tổ chức khác thay bộ nhận diện bằng cách
thay các tệp trong `docs/brand/` rồi chạy lại `build_assets.py`.
