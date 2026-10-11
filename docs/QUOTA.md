# Hạn mức token theo người dùng

Mỗi người dùng đăng nhập có một **hạn mức token mỗi ngày** để không ai chiếm hết năng lực mô hình của cả trường. Hết hạn mức thì phải đợi sang ngày hôm sau (làm mới lúc **00:00 giờ Việt Nam**).

| Bậc | Ai | Hạn mức mặc định / ngày |
|---|---|---|
| Sinh viên | email `@st.neu.edu.vn` (và tài khoản tên + mật khẩu do quản trị cấp) | **5.000.000** token |
| Giảng viên/cán bộ | email `@neu.edu.vn` | **10.000.000** token |
| Quản trị viên | email trong `/etc/neu-agent/admins.txt` | không giới hạn |
| Tự dán key riêng ở Cài đặt | — | không tính (dùng hạn mức của chính key đó) |

Token = token vào (lời nhắc + ngữ cảnh gửi lên mỗi bước) + token ra (trả lời). Một lượt làm việc của agent gồm nhiều bước nên có thể tốn vài chục nghìn đến vài trăm nghìn token. Hạn mức mặc định chọn theo dữ liệu thực: trung vị khoảng 400 nghìn token/người/ngày, p90 khoảng 1,3 triệu.

## Người dùng thấy gì
- **Từ 80%:** dưới ô nhập hiện nhãn *“Token hôm nay 85%”* (rê chuột để xem số cụ thể).
- **Hết hạn mức:** hệ thống cho **vượt thêm 10%** để hoàn tất việc đang làm; nhãn đổi thành *“Hết hạn mức hôm nay · hoàn tất việc đang làm”*.
- **Quá 110%:** yêu cầu mới bị từ chối với thông báo rõ: *“Bạn đã dùng hết hạn mức token hôm nay (… token). Hạn mức sẽ làm mới lúc 00:00 ngày mai.”* Công việc và hội thoại đã có vẫn được giữ.
- Mỗi người chạy tối đa **6 yêu cầu đồng thời** (chống chương trình lặp); vượt thì được báo đợi ít giây.

## Cách hoạt động (máy 220)
```text
nginx (xác thực SSO, gắn X-User-Email) ─▶ cổng hạn mức 127.0.0.1:4191 ─▶ Kong (232) ─▶ vLLM
```
- Cổng tự bật `stream_options.include_usage` và đọc số token trong phản hồi của mô hình: **số do máy chủ đếm**, không dựa vào ứng dụng tự báo (ứng dụng chỉ dùng để hiển thị).
- Kiểm tra hạn mức **trước** khi chuyển tiếp; cộng token **sau** khi mô hình trả xong. Vài yêu cầu chạy song song có thể vượt hạn mức một chút (không đáng kể so với hạn mức vài triệu).
- Lưu theo **mã giả danh** (HMAC của email, cùng cách với chẩn đoán), kèm ngày, bậc, số token, số yêu cầu, số lần bị chặn. **Không lưu email, không lưu nội dung hội thoại.** Giữ 400 ngày.
- Cổng chết/lỗi: nginx **tự chuyển thẳng tới Kong** (người dùng vẫn dùng được, tạm không có hạn mức); `/agent/healthz` và trang quản trị báo lỗi `quota`.
- Phản hồi chat có tiêu đề `X-Quota-State/Used/Limit/Remaining/Reset`; `GET /agent/quota` trả hạn mức của chính người gọi. Mã lỗi khi hết: **HTTP 402** `{"error":"quota_exceeded",…}` (bản ứng dụng cũ hiện nguyên thông báo này).

## Quản trị (chạy trên máy 220)
```bash
sudo ~/neu-agent-220/quota/quota.sh show                        # cấu hình + 15 người dùng nhiều nhất hôm nay (mã giả danh)
sudo ~/neu-agent-220/quota/quota.sh mode observe                # chỉ ĐẾM, không chặn (dùng khi muốn xem số liệu trước)  |  enforce = chặn
sudo ~/neu-agent-220/quota/quota.sh tier student 2000000        # đổi hạn mức mặc định của một bậc
sudo ~/neu-agent-220/quota/quota.sh set gv.a@neu.edu.vn unlimited   # đặt riêng cho một người (số token hoặc unlimited)
sudo ~/neu-agent-220/quota/quota.sh unset gv.a@neu.edu.vn
sudo ~/neu-agent-220/quota/quota.sh usage sv.b@st.neu.edu.vn    # mức dùng hôm nay của một người
sudo ~/neu-agent-220/quota/quota.sh uid sv.b@st.neu.edu.vn      # mã giả danh để đối chiếu trang quản trị
```
Cấu hình ở `/etc/neu-agent/quota.json` (xem `deploy/220/quota/quota.default.json`: bậc, tên miền → bậc, `grace_pct`, `warn_pct`, `max_concurrent`, `overrides`). Mỗi lệnh đổi cấu hình tự kiểm tra rồi khởi động lại dịch vụ.

**Cấp thêm nhanh cho từng người:** trang `https://ai.neu.edu.vn/agent/admin/quota` (quản trị viên; có link ở mục *Hạn mức token* của trang quản trị) liệt kê **ai đã hết hoặc gần hết hạn mức hôm nay** (tên/email lấy từ sổ "ai đã dùng"; người chưa có trong sổ hiện bằng mã giả danh), kèm nút **+1 / +5 / +10 triệu token**. Phần cấp thêm:
- chỉ có hiệu lực **trong ngày hôm nay** (hết lúc 00:00 giờ VN), cộng dồn nếu bấm nhiều lần (tối đa 100 triệu mỗi lần, 1 tỷ mỗi người mỗi ngày), có nút **Bỏ** để thu hồi;
- áp dụng ngay cho yêu cầu kế tiếp (cổng đọc `/var/lib/neu-agent/quota/grants.json`, do trang quản trị ghi; không đụng `quota.json`);
- ghi vào nhật ký (ai cấp, cho ai, bao nhiêu) hiển thị ngay dưới bảng. Muốn đổi hạn mức mặc định hoặc đặt ngoại lệ **lâu dài** vẫn dùng `quota.sh`.
Cần cài lại: `sudo ./quota/install-quota.sh` (cổng đọc tệp cấp thêm, thêm cột `extra`) rồi `sudo ./diag/install-diag.sh` (trang quản trị + quyền ghi `grants.json`).

Trang quản trị `https://ai.neu.edu.vn/agent/admin/` có mục **Hạn mức token**: token mỗi ngày, số người gần/hết hạn mức, số yêu cầu bị chặn, bảng người dùng đang dùng nhiều hạn mức.

## Ghi nội dung hội thoại của tài khoản chỉ định (để nghiên cứu)

Mặc định cổng **không ghi nội dung** nào. Quản trị có thể bật ghi cho **đúng một số tài khoản** (thường là tài khoản thử nghiệm như `test01`) để nghiên cứu cách người dùng hỏi và mô hình trả lời:

```bash
sudo ~/neu-agent-220/quota/quota.sh capture add test01        # bật (khởi động lại cổng; áp dụng từ yêu cầu kế tiếp)
sudo ~/neu-agent-220/quota/quota.sh capture list              # ai đang được ghi + số dòng
sudo ~/neu-agent-220/quota/quota.sh capture export test01 7 > test01.jsonl   # xuất 7 ngày gần nhất (JSON Lines)
sudo ~/neu-agent-220/quota/quota.sh capture remove test01     # tắt (dữ liệu cũ vẫn còn)
sudo ~/neu-agent-220/quota/quota.sh capture purge test01      # xoá hết nội dung đã ghi của tài khoản đó
```

- **Chỗ lưu:** `/var/lib/neu-agent/quota/captures.db` (SQLite, quyền 600, chỉ root/dịch vụ đọc), bảng `captures`; tự xoá dòng cũ hơn `capture.keep_days` (mặc định 90 ngày).
- **Mỗi dòng** = một lần gọi mô hình: tên tài khoản, nhóm cuộc trò chuyện (`conv`), phần **mới** của yêu cầu (các tin sau lần trả lời trước của trợ lý), **lời trả lời** (chữ và lệnh công cụ), lý do kết thúc, số token, thời gian, mã trạng thái. Không ghi IP, không ghi key.
- **Phạm vi:** chỉ đúng các tài khoản trong `capture.users` (cấu hình `quota.json`); người khác không bao giờ bị ghi. Lỗi ghi không làm hỏng yêu cầu của người dùng.
- **Riêng tư:** đây là ngoại lệ có chủ đích so với nguyên tắc “không lưu nội dung” (số liệu chẩn đoán vẫn không chứa nội dung). Chỉ dùng cho tài khoản thử nghiệm của nhóm phát triển; **người dùng thật phải được thông báo trước**. Không đưa tệp xuất lên kho mã.
- Cần cập nhật cổng: `sudo ./quota/install-quota.sh` (không ghi đè `quota.json`).

## Cài đặt / cập nhật
```bash
scp -r deploy/220 220:~/neu-agent-220
ssh -t 220 'cd ~/neu-agent-220 && sudo ./quota/install-quota.sh'          # 1) cổng hạn mức (tự kiểm thử, sao lưu, tự khôi phục nếu lỗi)
ssh -t 220 'cd ~/neu-agent-220 && sudo ./diag/install-diag.sh'            # 2) trang quản trị + healthz biết về cổng hạn mức
ssh -t 220 'cd ~/neu-agent-220 && sudo ./install.sh <key mô hình>'        # 3) nginx chuyển yêu cầu chat qua cổng
```
**Thứ tự quan trọng:** cài (1) trước (3). Gỡ: `sudo ./quota/install-quota.sh --uninstall` rồi chạy lại `install.sh` bản cũ.

## Giới hạn cần biết
- Kong chỉ thấy một khoá chung `neuagent` (và nó chung hạn mức 600 yêu cầu/phút với các ứng dụng khác thuộc consumer `lampx`); hạn mức theo người chỉ có ở máy 220.
- Nếu mô hình không trả `usage` (hiếm), cổng ước lượng từ kích thước và đánh dấu “ước lượng” trong CSDL.
- Số token chỉ tính khi có yêu cầu đi qua máy 220; người dùng gọi thẳng Kong bằng key riêng không thuộc phạm vi này.
