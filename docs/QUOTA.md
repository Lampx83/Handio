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
Cấu hình ở `/etc/neu-agent/quota.json` (xem `deploy/220/quota/quota.default.json`: bậc, tên miền → bậc, `grace_pct`, `warn_pct`, `max_concurrent`, `overrides`, `tabs`, `models`, `tab_limits`). Nhóm tuỳ tạo nằm ở tệp riêng (xem mục *Nhóm tuỳ tạo*). Mỗi lệnh đổi cấu hình tự kiểm tra rồi khởi động lại dịch vụ.

**Cấp thêm nhanh cho từng người:** trang `https://ai.neu.edu.vn/agent/admin/quota` (quản trị viên; có link ở mục *Hạn mức token* của trang quản trị) liệt kê **ai đã hết hoặc gần hết hạn mức hôm nay** (tên/email lấy từ sổ "ai đã dùng"; người chưa có trong sổ hiện bằng mã giả danh), kèm nút **+1 / +5 / +10 triệu token**. Phần cấp thêm:
- chỉ có hiệu lực **trong ngày hôm nay** (hết lúc 00:00 giờ VN), cộng dồn nếu bấm nhiều lần (tối đa 100 triệu mỗi lần, 1 tỷ mỗi người mỗi ngày), có nút **Bỏ** để thu hồi;
- áp dụng ngay cho yêu cầu kế tiếp (cổng đọc `/var/lib/neu-agent/quota/grants.json`, do trang quản trị ghi; không đụng `quota.json`);
- ghi vào nhật ký (ai cấp, cho ai, bao nhiêu) hiển thị ngay dưới bảng. Muốn đổi hạn mức mặc định hoặc đặt ngoại lệ **lâu dài** vẫn dùng `quota.sh`.
Cần cài lại: `sudo ./quota/install-quota.sh` (cổng đọc tệp cấp thêm, thêm cột `extra`) rồi `sudo ./diag/install-diag.sh` (trang quản trị + quyền ghi `grants.json`).

Trang quản trị `https://ai.neu.edu.vn/agent/admin/` có mục **Hạn mức token**: token mỗi ngày, số người gần/hết hạn mức, số yêu cầu bị chặn, bảng người dùng đang dùng nhiều hạn mức.

## Phân quyền tab theo nhóm (bậc)

Cùng cổng và cùng "bậc" với hạn mức (bậc xác định theo **miền email**, xem bảng trên): quản trị chọn mỗi bậc được dùng tab nào. **Mặc định không cấu hình = mọi người dùng cả Work, Code, Design** (hành vi cũ).

```bash
sudo ~/neu-agent-220/quota/quota.sh tabs student work,design   # sinh viên chỉ dùng Work và Design
sudo ~/neu-agent-220/quota/quota.sh tabs student all           # bỏ giới hạn
sudo ~/neu-agent-220/quota/quota.sh show                       # dòng "Tab được dùng theo bậc"
```
Cấu hình ở `/etc/neu-agent/quota.json`: `"tabs": {"student": ["work", "design"]}`. Bậc không có mặt = đủ ba tab; `[]` = không tab nào; tên tab gõ sai bị bỏ (gõ sai hết thành `[]`, tức chặn chứ không mở rộng quyền).

- **Chặn ở máy chủ:** ứng dụng khai tab đang dùng ở tiêu đề `X-Neu-Tab`; với bậc bị giới hạn, cổng trả **HTTP 403** (`tab_not_allowed`, hoặc `tab_required` nếu thiếu/sai tên tab — ví dụ ứng dụng bản cũ) **trước** khi tính hạn mức hay chuyển tới mô hình; không ghi gì về người dùng, chỉ tăng bộ đếm theo mã lỗi (xem dưới). Giao diện chỉ ẩn nút tab và báo sớm cho đỡ tốn một lượt gọi (`GET /agent/quota` có thêm `tabs`).
- **Không áp cho:** quản trị viên (`admins.txt`), người tự dán key riêng, và chế độ `observe` (chỉ đếm, không chặn).
- Bậc bị giới hạn mà dùng **ứng dụng bản cũ** (chưa gửi `X-Neu-Tab`) sẽ bị từ chối cho đến khi cập nhật: chỉ ảnh hưởng nhóm đã được cấu hình.
- **Giới hạn thật:** agent chạy ở phía máy khách, nên tab là do ứng dụng khai. Người am hiểu kỹ thuật có thể tự gửi tiêu đề khác để dùng tab ngoài danh sách. Đây là cơ chế **phân nhóm sử dụng** chứ không phải rào chắn chống kẻ tấn công; muốn chặn tuyệt đối cần cấp key mô hình riêng theo nhóm. Khi cổng hạn mức chết, nginx chuyển thẳng tới Kong nên phân quyền tab cũng tạm không áp dụng (giống hạn mức).

## Nhóm tuỳ tạo (lớp học, nhóm giảng viên…)

Ngoài bậc theo miền email, quản trị viên gán **email hoặc tài khoản tên + mật khẩu** vào nhóm đặt tên tuỳ ý (`lop-k66-cntt`, `giang-vien-fit`). Nhóm **ghi đè bậc** ở mục nào được đặt: hạn mức/ngày, tab, mô hình, hạn mức theo tab; mục không đặt thì theo bậc. **Không có nhóm nào = như cũ.**

```bash
sudo ~/neu-agent-220/quota/quota.sh group create lop-k66-cntt
sudo ~/neu-agent-220/quota/quota.sh group add lop-k66-cntt a@st.neu.edu.vn b@st.neu.edu.vn khach01
sudo ~/neu-agent-220/quota/quota.sh group limit lop-k66-cntt 2000000        # hoặc unlimited | default (= theo bậc)
sudo ~/neu-agent-220/quota/quota.sh group tabs lop-k66-cntt work,code      # none = không tab nào | default
sudo ~/neu-agent-220/quota/quota.sh group models lop-k66-cntt '*'          # * = mọi mô hình (nới bậc) | default
sudo ~/neu-agent-220/quota/quota.sh group tablimit lop-k66-cntt code 1000000   # hạn mức riêng tab Code | default
sudo ~/neu-agent-220/quota/quota.sh group list | show <nhóm> | of <email> | remove <nhóm> <email…> | delete <nhóm>
```
Hoặc trên trang `https://ai.neu.edu.vn/agent/admin/quota`, mục **Nhóm tuỳ tạo**: tạo/xoá nhóm, dán cả danh sách email (tối đa 500 mỗi lần), đặt hạn mức/tab/mô hình/hạn mức theo tab, bỏ từng người; có nhật ký ai sửa gì. Bảng người dùng hôm nay có cột nhóm.

- **Thứ tự ưu tiên hạn mức:** quản trị viên (không giới hạn) > đặt riêng từng người (`quota.sh set`) > nhóm > bậc. Phần cấp thêm trong ngày vẫn cộng thêm như cũ. Quản trị viên và người dùng key riêng không chịu giới hạn tab/mô hình của nhóm.
- **Mỗi người một nhóm:** thêm người đang ở nhóm khác bị từ chối (bỏ khỏi nhóm cũ trước).
- **Áp dụng ngay**, không cần khởi động lại: danh sách ở `/var/lib/neu-agent/quota/groups.json` (quyền 0600, người dùng dịch vụ `neu-diag`; có email nên **không chép ra ngoài, không đưa lên kho**). Cổng đọc lại khi tệp đổi. Trang quản trị và `quota.sh group` dùng chung một mã ghi (`diag/quota_admin.py`, có khoá tệp, ghi nguyên tử, không theo liên kết tượng trưng).
- **Cấu hình sai chỉ làm chặt thêm:** giá trị sai của một mục thành mức chặt nhất (hạn mức sai = 0, tab/mô hình sai = không được dùng). Tệp hỏng: cổng giữ bản đúng gần nhất, `/healthz` có `"groups_error": true`, trang quản trị báo đỏ và **không ghi đè** (để không mất danh sách). Riêng khi cổng **khởi động lại** lúc tệp đang hỏng thì chưa có bản đúng nào: thành viên tạm theo bậc cho tới khi sửa tệp.

## Phân quyền mô hình

Cổng so trường `model` của yêu cầu với danh sách được dùng (theo bậc hoặc nhóm); không khớp **đúng nguyên chuỗi** (kể cả thiếu) thì **HTTP 403** `model_not_allowed` kèm danh sách được dùng, không tới mô hình.
```bash
sudo ~/neu-agent-220/quota/quota.sh models student qwen3.5-35b-a3b-int4    # all = bỏ giới hạn (mặc định)
```
**Hiện máy chủ chỉ có một mô hình chat** (`qwen3.5-35b-a3b-int4` qua Kong), nên đây là cơ chế chuẩn bị sẵn cho khi có thêm mô hình. Danh sách mô hình `/agent/vllm/v1/models` vẫn đi thẳng tới Kong (chưa lọc theo nhóm); `GET /agent/quota` có `models` (null = mọi mô hình).

## Hạn mức theo tab

Ngoài hạn mức chung/ngày, có thể đặt hạn mức riêng cho từng tab (theo bậc trong `quota.json`, hoặc theo nhóm):
```bash
sudo ~/neu-agent-220/quota/quota.sh tablimit student code 2000000          # off = bỏ
```
Hết hạn mức của tab (vẫn có vượt thêm `grace_pct`) thì yêu cầu của **tab đó** bị từ chối **HTTP 402** `tab_quota_exceeded`, các tab khác vẫn dùng được. Token theo tab lưu ở bảng `tab_usage` (mã giả danh, ngày, tên tab, số token). Bậc/nhóm có hạn mức theo tab thì ứng dụng **phải** khai tab (bản cũ bị `tab_required`). Cùng giới hạn như phân quyền tab: tab do ứng dụng khai. `GET /agent/quota` có `tab_quota`.

## Đếm số lần bị từ chối

Mỗi lần cổng từ chối, bảng `denials` tăng một bộ đếm theo **(ngày, mã lỗi)**: `quota_exceeded`, `tab_quota_exceeded`, `tab_not_allowed`, `tab_required`, `model_not_allowed`, `busy`. **Không có mã người dùng, không có nhóm.** Trang quản trị (mục *Hạn mức token*) có bảng "Yêu cầu bị cổng từ chối theo lý do".

## Trang quản trị: cấu hình theo bậc
Trang `/agent/admin/quota` hiện cấu hình theo bậc (chỉ xem: hạn mức, tab, mô hình, hạn mức theo tab, miền email, chế độ). Cổng ghi bản xem này ra `/var/lib/neu-agent/quota/policy.json` mỗi lần nạp cấu hình (không có email; đặt riêng chỉ ghi số người). Đổi cấu hình theo bậc vẫn bằng `quota.sh` (tệp `/etc/neu-agent/quota.json` chỉ root đọc; trang quản trị không có quyền ghi hệ thống).

## Ghi nội dung hội thoại của tài khoản chỉ định (để nghiên cứu)

Mặc định cổng **không ghi nội dung** nào. Quản trị có thể bật ghi cho **đúng một số tài khoản** (thường là tài khoản thử nghiệm như `test01`) để nghiên cứu cách người dùng hỏi và mô hình trả lời:

```bash
sudo ~/neu-agent-220/quota/quota.sh capture add test01        # bật (khởi động lại cổng; áp dụng từ yêu cầu kế tiếp)
sudo ~/neu-agent-220/quota/quota.sh capture add 'test0*'       # theo tiền tố: mọi tài khoản TÊN bắt đầu bằng test0 (tối thiểu 3 ký tự; không bao giờ khớp email)
sudo ~/neu-agent-220/quota/quota.sh capture list              # ai đang được ghi + số dòng
sudo ~/neu-agent-220/quota/quota.sh capture export test01 7 > test01.jsonl   # xuất 7 ngày gần nhất (JSON Lines)
sudo ~/neu-agent-220/quota/quota.sh capture remove test01     # tắt (dữ liệu cũ vẫn còn)
sudo ~/neu-agent-220/quota/quota.sh capture purge test01      # xoá hết nội dung đã ghi của tài khoản đó
```

- **Chỗ lưu:** `/var/lib/neu-agent/quota/captures.db` (SQLite, quyền 640: người dùng dịch vụ + nhóm `neu-diag`; chế độ nhật ký DELETE để đọc thẳng được). Cho một user Linux đọc trực tiếp: `sudo quota.sh capture grant <user>` (thêm vào nhóm `neu-diag`, chỉ đọc; `revoke` để thu lại), rồi đọc bằng `sqlite3 -readonly` hoặc Python qua SSH — không cần xuất tệp, bảng `captures`; tự xoá dòng cũ hơn `capture.keep_days` (mặc định 90 ngày).
- **Mỗi dòng** = một lần gọi mô hình: tên tài khoản, nhóm cuộc trò chuyện (`conv`), phần **mới** của yêu cầu (các tin sau lần trả lời trước của trợ lý), **lời trả lời** (chữ và lệnh công cụ), lý do kết thúc, số token, thời gian, mã trạng thái. Không ghi IP, không ghi key.
- **Lấy dữ liệu:** dùng `capture export` (JSON Lines, chọn được `test0*`). Nếu chép thẳng `captures.db` phải chép kèm `captures.db-wal` (SQLite chế độ WAL), nếu không tệp trông như rỗng.
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
