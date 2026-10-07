# Tóm tắt bài giảng FIT-VIBE 2026 — Buổi 1 (để hệ thống bám sát khoá học)

*Nguồn: “Lesson note FIT-VIBE Buổi 1: Vibe Coding – Agentic Coding” (ThS. Nguyễn Quốc Thái). Đây là bản **tóm tắt và đối chiếu** do nhóm phát triển viết lại, không phải bản gốc.*

## Lộ trình 8 buổi của học phần
| Buổi | Chủ đề |
|---|---|
| 1 | Tổng quan: Vibe Coding – Agentic Coding; Claude Code, Codex, Cursor |
| 2 | Claude Code cơ bản: CLI, **context window**, **CLAUDE.md**, quy trình **E-P-C-C** (Explore – Plan – Code – Commit) |
| 3 | Claude Code nâng cao: **Subagents** và **Hooks** |
| 4 | Claude Code nâng cao: **Slash commands**, **Skills**, **MCP** |
| 5 | **Harness**: gỡ lỗi, rà soát, vòng kiểm chứng |
| 6 | Codex cơ bản: Codex CLI, **sandbox**, **AGENTS.md** |
| 7 | Codex nâng cao: **tool permission**, **multi-file refactor** |
| 8 | Dự án: hoàn thiện và trình bày sản phẩm cuối khoá (chọn đề tài từ buổi 1) |

## Nội dung buổi 1 (các khái niệm và thuật ngữ cần dùng thống nhất)
1. **LLM** dự đoán **token** tiếp theo, lặp lại nhiều lần; mã nguồn cũng là văn bản nên LLM viết được mã; chất lượng phụ thuộc **ngữ cảnh (prompt)**.
2. **Ba tầng**: *Mô hình* (GPT, Gemini, Claude) – *Ứng dụng hội thoại* (ChatGPT, Gemini app, Claude.ai) – *Công cụ lập trình/agent* (Codex, Gemini CLI, Claude Code, Cursor). Ghi nhớ: Claude là mô hình; Claude Code là công cụ agent dùng mô hình Claude.
3. **Chọn mô hình** theo ba yếu tố: năng lực – tốc độ – chi phí (năng lực cao cho lập kế hoạch/gỡ lỗi nhiều tệp; tốc độ cao cho sửa nhỏ, đổi tên, viết test mẫu, tra cú pháp). Danh sách mô hình thay đổi nhanh: tra trang chính thức.
4. **Ba giới hạn của LLM**: *hallucination* (bịa hàm/tham số/thư viện), *knowledge cutoff* (API lỗi thời), *context window* (chỉ dẫn đầu bị sót khi phiên dài). **Hoạt động gợi ý**: hỏi chatbot cách dùng một thư viện Python **không có thật** (vd `neu-fit-autograde`) rồi xem có bị bịa không → vì sao phải đọc và chạy thử mã AI sinh ra.
5. **Ba mức hỗ trợ lập trình**: Mức 1 *gợi ý mã* (Copilot, 2021) → Mức 2 *hỏi đáp* (ChatGPT; chép mã sang trình soạn thảo) → Mức 3 *agent* (Cursor, Claude Code, Codex; AI tự đọc, sửa tệp, chạy lệnh; người lập trình giao việc và rà soát).
6. **Vibe coding** (Andrej Karpathy, 02/2025): mô tả ý định bằng ngôn ngữ tự nhiên, đánh giá theo kết quả chạy. Vòng lặp 4 bước: **See** (quan sát kết quả/lỗi/giao diện) → **Say** (mô tả vấn đề/yêu cầu) → **Run** (chạy thử) → **Copy-paste** (gửi nguyên văn thông báo lỗi cho AI).
7. **Phạm vi áp dụng** — phù hợp: bản mẫu/trình diễn, viết test cho mã có sẵn, tìm hiểu mã mới/sửa lỗi; **cẩn trọng**: yêu cầu chưa rõ, hệ thống thanh toán/y tế/bảo mật; **không phù hợp**: học một kiến thức mới (mục tiêu là hiểu bản chất).
8. **Vibe coding ≠ agentic coding**: agentic có *kế hoạch + tệp ngữ cảnh dự án*, *kiểm thử để xác nhận*, *rà soát từng phần thay đổi (diff)*, *giới hạn quyền, chạy trong sandbox*, cho *dự án thực, làm nhóm*. Hai hiểu lầm: “không cần biết lập trình” (sai: vẫn phải đọc hiểu mã agent đổi) và “luôn tự động chấp nhận mọi thay đổi” (chỉ cho việc quen thuộc, rủi ro thấp).
9. **Vòng lặp agent**: agent = LLM + công cụ (tool) + vòng lặp; *User –Prompt→ LLM –Tool call→ Tool –Observation→ LLM … –Answer→ User*. Mô hình **chỉ đề xuất** lời gọi công cụ dạng JSON (vd `{"tool":"Bash","input":{"command":"pytest -q"}}`); **host** (chương trình chủ) mới kiểm tra quyền/sandbox, xin người dùng duyệt, thực thi, rồi gửi kết quả (observation) về LLM. Cơ chế an toàn đặt ở host. Mỗi vòng tốn token và có thể phát sinh lỗi → theo dõi quá trình.
10. **Rủi ro và nguyên tắc**: *Bảo mật* — không nhập khoá API/mật khẩu/dữ liệu cá nhân vào prompt; đọc kỹ từng lệnh (đặc biệt `rm`, `git push`); kiểm tra thư viện AI gợi ý có tồn tại. *Liêm chính học thuật* — theo quy định học phần, ghi rõ phần có AI hỗ trợ, giải thích được mọi dòng mã đã nộp. *Kỹ năng* — tự làm trước rồi hỏi; dùng AI để được giải thích, không chỉ làm hộ. **Nguyên tắc: người commit mã chịu trách nhiệm toàn bộ mã nguồn, kể cả phần AI sinh ra.**
11. **Cấu trúc prompt hiệu quả**: **Mục tiêu** (cần làm gì) – **Ngữ cảnh** (tệp nào, chỉ định bằng cú pháp `@file`) – **Ràng buộc** (phạm vi thay đổi và điểm dừng).
    - Chưa rõ: “Sửa lỗi trong ứng dụng.”
    - Rõ: “Thêm ô chọn vai trò vào thanh bên của @app.py, không thay đổi cách đọc API key. Lập kế hoạch trước và dừng lại trước khi sửa mã để tôi rà soát.”
12. **Thao tác cơ bản** của công cụ: `@tệp` đưa tệp vào prompt; `!lệnh` chạy lệnh shell; `Shift+Tab` bật plan mode; `Esc` dừng agent; `/model` chọn mô hình; `/init` tạo `AGENTS.md`; gõ `/` xem danh sách lệnh. Tệp ngữ cảnh dự án: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex, Cursor), `.cursor/rules` (Cursor). Kiểm soát an toàn: *permission modes* (Claude Code), *sandbox + phê duyệt* (Codex).
13. **Demo chatbot** (Streamlit + google-genai, mô hình Gemini): thư mục trống → `python3 -m venv .venv` → khởi động agent → Prompt 1 (chatbot có nhớ ngữ cảnh: `app.py`, đọc `GEMINI_API_KEY` từ môi trường/`.env`, hướng dẫn trên giao diện nếu thiếu khoá, lịch sử trong `session_state`, tạo `requirements.txt` và `.env.example`, chạy thử) → điền khoá vào `.env` → `pip install -r requirements.txt` → `streamlit run app.py` → kiểm tra nhớ ngữ cảnh (“Tên tôi là Lan” rồi “Tên tôi là gì?”) → Prompt 2 (thêm ô chọn vai trò ở thanh bên: Trợ lý học lập trình, Gia sư tiếng Anh, Người phỏng vấn tuyển dụng; mỗi vai trò có system instruction riêng, trả lời tiếng Việt, đổi vai trò thì xoá hội thoại, không đổi cách đọc API key).
    **Quan sát**: (a) agent hay làm thêm ngoài yêu cầu (streaming, nút xoá hội thoại) → phải rà diff; (b) agent không phải lúc nào cũng tự kiểm tra/chạy thử → luôn tự chạy lại sau mỗi thay đổi; (c) khoá API chỉ để trong `.env`, chỉ chia sẻ `.env.example`. Khi lỗi: **gửi nguyên văn traceback**, không tự diễn giải; lỗi 404 thường do tên mô hình đã đổi → tra tài liệu và sửa. **Bài tập tại lớp**: làm lại hai bước rồi thêm một vai trò tự chọn.
14. **Câu hỏi ôn tập**: (1) vì sao LLM không “tra đáp án”, giới hạn nào; (2) Claude vs Claude Code, ví dụ tương tự bên OpenAI; (3) bốn bước See–Say–Run, khi nào không nên vibe coding; (4) thành phần nào quyết định lệnh có được thực thi, vì sao quan trọng; (5) viết lại prompt “Sửa lỗi trong ứng dụng” cho đủ mục tiêu–ngữ cảnh–ràng buộc.

## Hệ quả cho NEU Agent (đối chiếu)
- Dùng **đúng thuật ngữ**: See–Say–Run–Copy-paste; Mục tiêu–Ngữ cảnh–Ràng buộc; Mức 1/2/3; E-P-C-C; host/permission modes/sandbox.
- Hỗ trợ **`@file`**, `!lệnh`, `/model`, `/init` (tạo **AGENTS.md**), `/` danh sách lệnh, `Shift+Tab`, `Esc` — giống thao tác học viên sẽ gặp ở Claude Code/Codex.
- Có các tính năng của Buổi 2–7: context window (thước + `/context`), tệp ngữ cảnh dự án (AGENTS.md, CLAUDE.md), E-P-C-C (plan mode, commit), **subagents tuỳ biến, hooks, slash commands tuỳ biến, skills, MCP**, permission modes, giải thích sandbox/phê duyệt, refactor nhiều tệp, vòng kiểm chứng.
- Hỗ trợ demo **chatbot Streamlit** (Python venv, tiến trình nền, mở trình duyệt tới localhost) và **hoạt động thư viện không có thật** (công cụ kiểm tra gói có tồn tại trên PyPI/npm).
- Agent **không làm thêm ngoài yêu cầu** (đề xuất thay vì tự làm), **tự chạy kiểm tra** sau khi sửa, **không ghi khoá API vào mã** (đọc từ môi trường/.env, tạo .env.example), cảnh báo thư viện không kiểm chứng được.
