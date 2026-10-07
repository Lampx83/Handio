# FIT Code

Agent lập trình chạy trên terminal, dùng mô hình **Qwen3.5** của Khoa CNTT (NEU) để sinh viên thực hành môn **FIT-VIBE** (Vibe Coding / Agentic Coding) mà **không cần tài khoản Claude hay Codex**.

- Chỉ dùng thư viện chuẩn của Python (>= 3.8), không cài thêm gói nào; đóng gói thành **một file** `fitcode.pyz`.
- Mã nguồn tự viết, cùng ý tưởng với các công cụ agent hiện nay (không dùng mã của Claude Code hay Codex).
- Mỗi sinh viên dùng key riêng do giảng viên cấp; mọi lệnh gọi đi qua gateway của Khoa (có giới hạn tốc độ và thống kê).

## Cài đặt (sinh viên)

1. Cần Python 3.8 trở lên (`python3 --version`).
2. Tải file `fitcode.pyz` (giảng viên cung cấp đường dẫn) và đặt vào một thư mục, ví dụ `~/bin/`.
3. Nhập key lần đầu:

   ```bash
   python3 fitcode.pyz login
   python3 fitcode.pyz doctor      # kiểm tra kết nối, key, gọi mô hình, gọi công cụ
   ```

4. Vào thư mục dự án bất kỳ và chạy:

   ```bash
   cd du-an-cua-toi
   python3 /đường/dẫn/fitcode.pyz
   ```

Mẹo: đặt bí danh `alias fitcode='python3 ~/bin/fitcode.pyz'` (Linux/macOS) hoặc tạo file `fitcode.bat` chứa `python "%USERPROFILE%\bin\fitcode.pyz" %*` (Windows).
Có thể đặt key bằng biến môi trường `FITCODE_KEY` thay cho `login`.

## Dùng thế nào

```
› Thêm chức năng đăng ký vào app.py và viết test cho nó
```

Agent sẽ: đọc mã → lập danh sách việc → sửa file (hiện diff, hỏi bạn trước khi ghi) → chạy test → đọc lỗi → sửa lại → báo cáo.
Mỗi thao tác sửa file hoặc chạy lệnh được hỏi: `Enter/y` đồng ý · `a` luôn đồng ý loại này trong phiên · `n` từ chối · hoặc gõ lý do để agent đổi hướng.

| Cú pháp | Ý nghĩa |
|---|---|
| `@src/app.py` | đính kèm nội dung file/thư mục vào câu hỏi |
| `!git status` | chạy lệnh shell trực tiếp (không qua agent) |
| `"""` … `"""` hoặc `\` cuối dòng | nhập nhiều dòng |
| `Ctrl+C` | dừng agent đang làm việc (hai lần ở dấu nhắc để thoát) |
| `fitcode -p "yêu cầu"` | chạy một lần không tương tác (script/CI) |
| `fitcode -c` | tiếp tục hội thoại gần nhất của thư mục này |

Lệnh slash: `/help` `/init` `/plan` `/mode` `/compact` `/context` `/clear` `/undo` `/todos` `/think` `/agents` `/skills` `/commands` `/hooks` `/mcp` `/memory` `/cost` `/export` `/example` `/review` `/commit` `/fix-tests` `/explain` `/exit`.

## Đối chiếu với các bài FIT-VIBE

| Bài | Khái niệm | Trong FIT Code |
|---|---|---|
| 1 | Tổng quan agentic coding | vòng lặp agent: mô hình ⇄ công cụ (`fitcode/agent.py`, khoảng 500 dòng, đọc được hết) |
| 2 | Kiến trúc CLI, **context window**, **bộ nhớ dự án**, workflow **Explore → Plan → Code → Commit** | `/context` xem mức dùng ngữ cảnh; tự lược kết quả công cụ cũ và tự `/compact`; `/init` tạo `FITCODE.md` (cũng đọc `AGENTS.md`, `CLAUDE.md`); `/plan` (chỉ đọc, lập kế hoạch, xin duyệt) rồi thực hiện; `/commit` |
| 3 | **Subagents** & **Hooks** | `.fitcode/agents/*.md` (công cụ `task`, ngữ cảnh riêng); `hooks` trong `settings.json` (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) |
| 4 | **Slash commands**, **Skills**, **MCP** | `.fitcode/commands/*.md` (có `$ARGUMENTS`); `.fitcode/skills/<tên>/SKILL.md`; `mcpServers` trong `settings.json` (client MCP qua stdio) |
| 5 | **Harness**: debug, review, verification loop | agent tự chạy test và sửa; hook `PostToolUse` kiểm tra cú pháp ngay sau mỗi lần sửa; `/review`; quy tắc "phải đọc file trước khi sửa"; `/fix-tests` |
| 6 | Kiến trúc CLI, **sandbox**, `AGENTS.md` | chỉ ghi trong thư mục dự án (chống `../` và symlink); lệnh nguy hiểm bị chặn cứng; `AGENTS.md` được nạp |
| 7 | **Tool permission**, refactor nhiều file | 4 chế độ quyền `default · acceptEdits · plan · bypass`; quy tắc `allow`/`deny` như `bash(git push*)`; `/undo` |
| 8 | Hoàn thiện project & demo | `/export` lưu hội thoại; `fitcode -p` để chạy tự động |

Chạy `fitcode example` (hoặc `/example`) trong một thư mục để chép bộ ví dụ vào `.fitcode/`: lệnh `/doc`, `/todo-scan`; subagent `reviewer`; skill `python-style`; hook chặn sửa file bí mật và hook kiểm tra cú pháp Python; MCP server `grades` (tính GPA). Mỗi file đều ngắn, có chú thích, để sinh viên đọc và sửa.

### Cấu hình `.fitcode/settings.json`

```json
{
  "mode": "default",
  "permissions": { "allow": ["bash(python3 -m pytest*)", "mcp__grades__*"],
                   "deny":  ["bash(git push*)", "write_file(.env)"] },
  "hooks": { "PostToolUse": [{ "matcher": "write_file|edit_file",
             "hooks": [{ "type": "command", "command": "python3 .fitcode/hooks/check_python.py" }] }] },
  "mcpServers": { "grades": { "command": "python3", "args": [".fitcode/mcp/grades_server.py"] } }
}
```

Thứ tự ưu tiên cấu hình: mặc định < `~/.fitcode/` < `.fitcode/settings.json` (nộp cùng dự án) < `.fitcode/settings.local.json` (riêng bạn) < biến môi trường.
Hook nhận JSON qua stdin; mã thoát `0` bình thường, `2` chặn (nội dung stderr được gửi lại cho mô hình), mã khác chỉ cảnh báo.

## An toàn — đọc kỹ

- **Đây không phải sandbox thật.** Công cụ file bị giới hạn trong thư mục dự án, nhưng lệnh `bash` chạy với quyền của bạn. Đọc lệnh trước khi bấm Enter; chỉ dùng `--yolo`/`bypass` trong thư mục thử nghiệm. Với lớp học, nên chạy trong máy ảo/container hoặc tài khoản riêng.
- Lệnh nguy hiểm (`sudo`, `rm -rf /`, `curl | sh`, `git push --force`…) luôn bị chặn, kể cả ở chế độ bypass.
- Nội dung dự án gửi tới máy chủ mô hình của Khoa; **không đưa mật khẩu, khóa API, dữ liệu cá nhân vào dự án** khi dùng agent.
- Key lưu ở `~/.fitcode/config.json` (quyền chỉ chủ sở hữu đọc). Hội thoại được ghi vào `.fitcode/sessions/` để bạn tiếp tục (`-c`) và giảng viên có thể xem lại khi cần (thư mục này đã được `.gitignore`).

## Khác biệt và giới hạn so với Claude Code / Codex

- Mô hình nhỏ hơn: làm tốt bài rõ yêu cầu (viết hàm, sửa lỗi, test, refactor vừa phải); dễ sai ở tác vụ rất dài, nhiều file, hoặc kiến thức hiếm. **Luôn yêu cầu chạy test và tự kiểm chứng** — đó cũng là mục tiêu của bài Harness.
- Cửa sổ ngữ cảnh khoảng 32 nghìn token: tránh đưa cả file lớn vào; dùng `/context`, `/compact`.
- Không có: hoàn thiện lệnh bằng Tab, chạy song song nhiều subagent, duyệt web, chế độ chỉnh sửa trong IDE.
- Tên lệnh, định dạng file cấu hình và hook **khác** với Claude Code/Codex (ý tưởng tương đương). Khi chuyển sang công cụ thật, sinh viên chỉ cần đổi cú pháp.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| `Key sai hoặc chưa gửi kèm` | `python3 fitcode.pyz login` nhập lại key |
| `Key này không được dùng mô hình chat` | key chỉ có quyền embedding; xin giảng viên key chat |
| `Mô hình đang khởi động` | chờ vài phút, công cụ tự thử lại |
| `Chạm giới hạn lệnh/phút` | công cụ tự đợi rồi thử lại; tránh chạy nhiều agent cùng lúc bằng một key |
| Agent lặp mãi một lỗi | Ctrl+C, nêu rõ hướng sửa, hoặc `/clear` rồi giao lại việc nhỏ hơn |
| Windows hiện ký tự lạ | dùng Windows Terminal; hoặc `--no-color` |

## Phát triển

```bash
python3 -m unittest discover -s tests   # 33 test, dùng máy chủ giả lập, không cần mạng
./build.sh                               # tạo dist/fitcode.pyz
python3 -m fitcode                       # chạy trực tiếp từ mã nguồn
```

Cấu trúc: `agent.py` (vòng lặp, ngữ cảnh, subagent) · `tools.py` · `permissions.py` · `hooks.py` · `mcp.py` · `extensions.py` (lệnh, skill, agent, bộ nhớ) · `llm.py` (streaming, thử lại) · `cli.py` (REPL, lệnh slash) · `examples.py`.
