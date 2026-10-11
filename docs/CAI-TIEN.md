# Cải tiến Handio liên tục

Mục tiêu: Handio được cập nhật **đều đặn và có lý do** — dựa trên (1) người dùng thật đang dùng thế nào, (2) công nghệ và mô hình đang thay đổi ra sao, (3) phần mềm tương tự đang làm gì. Không chạy theo từng tính năng của người khác: chỉ làm khi nó giải quyết vấn đề của sinh viên và cán bộ NEU, giữ được cam kết riêng tư và chạy được trong hạ tầng của trường.

## Nhịp làm việc

| Chu kỳ | Việc | Thời lượng | Kết quả |
|---|---|---|---|
| **Hằng tuần** | Rà soát: số liệu sử dụng + tín hiệu thị trường → chọn ≤ 3 việc | ~30 phút | Một báo cáo `docs/improvement/YYYY-MM-DD.md` + cập nhật [BACKLOG.md](BACKLOG.md) |
| **Khi có lỗi** | Sửa và phát hành PATCH | ngay | Bản vá ([RELEASE.md](RELEASE.md)) |
| **2–4 tuần** | Gom các việc đã chọn → phát hành MINOR | — | Bản mới + CHANGELOG |
| **Hằng quý** | Xem lại hướng đi, danh sách theo dõi, chi phí/mô hình | 1–2 giờ | Điều chỉnh BACKLOG và radar |

Báo cáo tuần có thể do người hoặc do trợ lý soạn thảo tự động (xem “Tự động hoá”); **người quyết định** việc nào được làm và phát hành.

## Nguồn 1 — Dữ liệu sử dụng (trang quản trị)

Xem `https://ai.neu.edu.vn/agent/admin/` ([DIAGNOSTICS.md](DIAGNOSTICS.md)). Câu hỏi cố định mỗi tuần:

| Câu hỏi | Xem ở đâu | Dấu hiệu cần hành động |
|---|---|---|
| Người ta có quay lại không? | Tăng trưởng → phễu, gắn bó, ngủ đông | Nhiều người chỉ dùng 1 lượt; “dùng ≥ 2 ngày” thấp |
| Tab nào được dùng, tab nào bị bỏ? | Cách sử dụng → Tab | Một tab ít lượt/người dù nhiều người thử |
| Agent làm việc có tốt không? | Chất lượng → kết quả lượt, công cụ, tín hiệu | Tỷ lệ lỗi/lặp/chạm giới hạn bước tăng; công cụ lỗi > 25% |
| Có chậm không? | Chất lượng → thời gian một lượt, token đầu | p95 tăng; prompt gấp trăm lần trả lời |
| Họ dùng gì để vào? | Cách sử dụng → Nền tảng, phiên bản | Bản web áp đảo → ưu tiên web; nhiều người còn bản cũ → xem cơ chế cập nhật |
| Bản mới có được cập nhật không? | Phát hành & cập nhật | Tỷ lệ cập nhật thấp sau 1 tuần |

Mọi số liệu chỉ là **hành vi tổng hợp, không có nội dung hội thoại** và người dùng chỉ hiện dưới mã giả danh. Muốn hiểu *vì sao* một việc thất bại, dùng nút **Báo lỗi** trong ứng dụng (người dùng tự chọn gửi ghi chú) hoặc hỏi trực tiếp vài người dùng — không thu nội dung hội thoại ngầm. Mở rộng thu thập chỉ làm **công khai, có thông báo và có công tắc** (xem mục “Quyền riêng tư” dưới đây).

## Nguồn 2 và 3 — Xu hướng công nghệ và phần mềm tương tự

Danh sách theo dõi (sửa trực tiếp tệp này khi thay đổi). Mỗi tuần chỉ cần liếc các trang “có gì mới”; mỗi quý rà lại danh sách.

| Nhóm | Theo dõi | Nơi xem |
|---|---|---|
| Agent lập trình (đối chuẩn cho tab **Code**) | Claude Code, GitHub Copilot (agent mode), Cursor, Windsurf, OpenAI Codex CLI, Gemini CLI | Trang changelog/phát hành của từng sản phẩm (GitHub Releases, `cursor.com/changelog`, `github.blog/changelog`) |
| Trợ lý văn phòng (đối chuẩn cho tab **Work**) | Microsoft 365 Copilot, Google Workspace + Gemini, ChatGPT (agent, canvas), Claude (tệp, Office) | Trang “what’s new” của từng sản phẩm |
| Thiết kế (tab **Design**) | Canva AI, Figma AI, Claude/ChatGPT artifacts | như trên |
| Giao thức & hệ sinh thái | Model Context Protocol (MCP), Agent Skills, hooks, sandbox | `modelcontextprotocol.io`, tài liệu từng sản phẩm |
| Mô hình chạy trong trường | Qwen và các mô hình mở khác; vLLM | GitHub Releases `QwenLM`, `vllm-project/vllm`, bảng xếp hạng mô hình mở |
| Giáo dục | Cách các trường dùng AI trong dạy lập trình, quy định về AI trong giáo dục | tin tức giáo dục đại học, hướng dẫn của Bộ GD&ĐT |

Với mỗi phát hiện, ghi vào báo cáo tuần 3 điều: **cái gì mới**, **nó giải quyết vấn đề gì của người dùng NEU**, **ta có thiếu nó không** (dựa vào dữ liệu nguồn 1). Không có vấn đề tương ứng trong dữ liệu thì chỉ ghi chú theo dõi, chưa làm.

## Chấm điểm và chọn việc

Mỗi mục trong [BACKLOG.md](BACKLOG.md) có: **Bằng chứng** (số liệu hoặc nguồn), **Tác động** (1–5: bao nhiêu người, mức đau), **Công sức** (S/M/L), **Rủi ro** (riêng tư, bảo mật, vỡ tương thích). Ưu tiên cao nhất: *tác động cao, công sức nhỏ, có bằng chứng từ dữ liệu*. Ưu tiên thấp: *theo trào lưu, không có bằng chứng người dùng cần*. Mỗi chu kỳ chọn **tối đa 3** việc để làm trọn vẹn, kèm cách đo thành công (chỉ số nào cải thiện, bao nhiêu).

## Vòng khép kín

1. **Đo** (trang quản trị) → 2. **Hiểu** (báo lỗi, hỏi người dùng, đọc các phát hiện) → 3. **Chọn** (BACKLOG, tối đa 3) → 4. **Làm** (ghi CHANGELOG khi xong từng việc) → 5. **Phát hành** ([RELEASE.md](RELEASE.md)) → 6. **Đo lại** sau 1–2 tuần: chỉ số đã chọn có tốt hơn không? Không thì ghi bài học vào báo cáo và điều chỉnh.

## Quyền riêng tư (giới hạn cứng)

- Thu thập chỉ ở mức **hành vi không nội dung** như hiện nay ([DIAGNOSTICS.md](DIAGNOSTICS.md)). Muốn thu thêm (email, đơn vị, nội dung hội thoại) phải: thông báo rõ khi mở ứng dụng, có công tắc tắt, cập nhật [SECURITY.md](SECURITY.md) và tài liệu, và (với nội dung hội thoại) do **người dùng chủ động chia sẻ**. Thu ngầm là không chấp nhận được và không phù hợp Nghị định 13/2023/NĐ-CP.
- Số liệu và báo cáo tuần không chứa tên/email người dùng; chỉ dùng mã giả danh.

## Tự động hoá

Có thể đặt một tác vụ định kỳ (mỗi tuần) cho trợ lý: lấy `stats.json` từ máy 220 (qua SSH của người vận hành), đọc các nguồn trong danh sách theo dõi, soạn báo cáo tuần theo [mẫu](improvement/MAU-BAO-CAO.md) và đề xuất cập nhật BACKLOG. Tác vụ **chỉ soạn tài liệu**: không tự sửa mã, không tự phát hành, không tự đẩy lên GitHub hay máy chủ — người quyết định.
