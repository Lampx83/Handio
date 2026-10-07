"""Ví dụ mẫu để sinh viên học các khái niệm: lệnh slash, subagent, skill, hook, MCP.
Chạy `fitcode example` (hoặc /example trong phiên) để chép các file này vào thư mục .fitcode/ của dự án."""
from __future__ import annotations

import json
from pathlib import Path

FILES = {}

FILES[".fitcode/commands/doc.md"] = """---
description: Viết docstring/chú thích tiếng Việt cho một file
---
Đọc file $ARGUMENTS và bổ sung docstring ngắn gọn bằng tiếng Việt cho mọi hàm/lớp chưa có.
Không đổi logic. Sau khi sửa, chạy kiểm tra cú pháp (ví dụ `python -m py_compile`) để chắc chắn file vẫn chạy được.
"""

FILES[".fitcode/commands/todo-scan.md"] = """---
description: Quét TODO/FIXME trong dự án và lập kế hoạch xử lý
---
Dùng grep tìm các dòng chứa TODO hoặc FIXME trong dự án. Nhóm theo file, ước lượng độ khó (dễ/vừa/khó)
và đề xuất thứ tự xử lý. Chỉ báo cáo, không sửa file. $ARGUMENTS
"""

FILES[".fitcode/agents/reviewer.md"] = """---
name: reviewer
description: Reviewer mã nguồn nghiêm khắc, chỉ đọc. Dùng để rà soát file/thay đổi và nêu lỗi, rủi ro bảo mật, thiếu test.
tools: read_file, grep, glob, list_dir, bash
---
Bạn là reviewer mã nguồn cẩn thận. Với phạm vi được giao:
1. Đọc kỹ mã; nếu cần chạy `git diff` hoặc test để kiểm chứng (chỉ chạy lệnh đọc/kiểm tra).
2. Liệt kê vấn đề theo mức: NGHIÊM TRỌNG / VỪA / NHỎ, mỗi mục ghi file:dòng, mô tả, cách sửa gợi ý.
3. Kết thúc bằng 1-2 câu đánh giá chung. Không tự sửa mã.
"""

FILES[".fitcode/skills/python-style/SKILL.md"] = """---
name: python-style
description: Quy ước viết Python của khoa (đặt tên, kiểu dữ liệu, xử lý lỗi, test). Dùng khi viết hoặc review mã Python.
---
# Quy ước Python của Khoa CNTT

- Đặt tên: `snake_case` cho hàm/biến, `PascalCase` cho lớp, hằng số `UPPER_CASE`.
- Có type hint cho tham số và giá trị trả về của hàm công khai.
- Mỗi hàm làm một việc; hàm dài quá ~40 dòng thì tách.
- Bắt lỗi cụ thể (`except ValueError`), không dùng `except:` trống; không nuốt lỗi âm thầm.
- Mọi hàm xử lý logic phải có test `pytest` đi kèm (file `tests/test_*.py`), gồm ít nhất một trường hợp biên.
- Không để key/mật khẩu trong mã; đọc từ biến môi trường.
"""

FILES[".fitcode/hooks/guard_secrets.py"] = '''#!/usr/bin/env python3
"""Hook PreToolUse: chặn việc ghi/sửa file bí mật (.env, *.key, secrets*).
Đọc JSON từ stdin; thoát mã 2 + ghi lý do ra stderr để chặn và báo lại cho mô hình."""
import json, os, sys

event = json.load(sys.stdin)
path = (event.get("tool_input") or {}).get("path", "")
name = os.path.basename(path).lower()
if name == ".env" or name.endswith(".key") or name.endswith(".pem") or name.startswith("secret"):
    print("Không được sửa file bí mật '%s'. Hãy dùng biến môi trường và hướng dẫn người dùng tự cấu hình." % path, file=sys.stderr)
    sys.exit(2)
sys.exit(0)
'''

FILES[".fitcode/hooks/check_python.py"] = '''#!/usr/bin/env python3
"""Hook PostToolUse: sau khi sửa file .py, kiểm tra cú pháp ngay. Lỗi -> thoát mã 2 để mô hình tự sửa (vòng lặp kiểm chứng)."""
import json, py_compile, sys

event = json.load(sys.stdin)
path = (event.get("tool_input") or {}).get("path", "")
if path.endswith(".py"):
    try:
        py_compile.compile(path, doraise=True)
    except py_compile.PyCompileError as e:
        print("Lỗi cú pháp trong %s:\\n%s" % (path, e.msg), file=sys.stderr)
        sys.exit(2)
sys.exit(0)
'''

FILES[".fitcode/mcp/grades_server.py"] = '''#!/usr/bin/env python3
"""MCP server tối giản (stdio, JSON-RPC theo dòng): tính GPA và xếp loại.
Minh hoạ cách mở rộng công cụ cho agent bằng MCP."""
import json, sys

TOOLS = [
    {"name": "gpa", "description": "Tính điểm trung bình có trọng số tín chỉ (thang 10).",
     "inputSchema": {"type": "object", "properties": {"courses": {"type": "array", "items": {
         "type": "object", "properties": {"credits": {"type": "number"}, "score": {"type": "number"}},
         "required": ["credits", "score"]}}}, "required": ["courses"]}},
    {"name": "grade_letter", "description": "Đổi điểm thang 10 sang xếp loại chữ (A, B+, ...).",
     "inputSchema": {"type": "object", "properties": {"score": {"type": "number"}}, "required": ["score"]}},
]


def letter(s):
    for lim, l in ((9.0, "A+"), (8.5, "A"), (8.0, "B+"), (7.0, "B"), (6.5, "C+"), (5.5, "C"), (5.0, "D+"), (4.0, "D")):
        if s >= lim:
            return l
    return "F"


def call(name, a):
    if name == "gpa":
        tc = sum(c["credits"] for c in a["courses"])
        return "GPA = %.2f (tổng %g tín chỉ)" % (sum(c["credits"] * c["score"] for c in a["courses"]) / tc, tc) if tc else "Không có tín chỉ"
    if name == "grade_letter":
        return "Điểm %g -> %s" % (a["score"], letter(a["score"]))
    raise KeyError(name)


for line in sys.stdin:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    mid, method = msg.get("id"), msg.get("method")
    if mid is None:
        continue   # notification
    if method == "initialize":
        res = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "grades", "version": "1.0"}}
    elif method == "tools/list":
        res = {"tools": TOOLS}
    elif method == "tools/call":
        p = msg["params"]
        try:
            res = {"content": [{"type": "text", "text": call(p["name"], p.get("arguments") or {})}]}
        except Exception as e:
            res = {"content": [{"type": "text", "text": "Lỗi: %s" % e}], "isError": True}
    else:
        res = {}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}) + "\\n")
    sys.stdout.flush()
'''

EXAMPLE_SETTINGS = {
    "permissions": {"allow": ["bash(python3 -m pytest*)", "bash(python -m pytest*)", "bash(git add*)", "mcp__grades__*"],
                    "deny": ["bash(git push*)", "write_file(.env)"]},
    "hooks": {
        "PreToolUse": [{"matcher": "write_file|edit_file",
                        "hooks": [{"type": "command", "command": "python3 .fitcode/hooks/guard_secrets.py"}]}],
        "PostToolUse": [{"matcher": "write_file|edit_file",
                         "hooks": [{"type": "command", "command": "python3 .fitcode/hooks/check_python.py"}]}],
    },
    "mcpServers": {"grades": {"command": "python3", "args": [".fitcode/mcp/grades_server.py"]}},
}


def scaffold(root: Path) -> list:
    """Ghi các file ví dụ vào dự án (không ghi đè file đã có). Trả về danh sách file đã tạo."""
    created = []
    for rel, content in FILES.items():
        p = Path(root) / rel
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        created.append(rel)
    settings = Path(root) / ".fitcode" / "settings.json"
    target = settings if not settings.exists() else Path(root) / ".fitcode" / "settings.example.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(EXAMPLE_SETTINGS, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    created.append(str(target.relative_to(root)))
    return created
