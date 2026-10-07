"""Nạp phần mở rộng do người dùng định nghĩa: bộ nhớ dự án, lệnh slash, skills, subagents."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .config import home_dir

MEMORY_FILES = ("FITCODE.md", "AGENTS.md", "CLAUDE.md", ".fitcode/FITCODE.md", "FITCODE.local.md")
MAX_MEMORY_CHARS = 6000


def parse_frontmatter(text: str) -> Tuple[dict, str]:
    """Phân tích khối '---' đầu file (cú pháp YAML tối giản: key: value)."""
    if not text.startswith("---"):
        return {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        k, v = line.split(":", 1)
        v = v.strip().strip("'\"")
        meta[k.strip()] = v
    return meta, m.group(2)


def _split_list(v: str) -> List[str]:
    v = (v or "").strip().strip("[]")
    return [x.strip().strip("'\"") for x in v.split(",") if x.strip()]


# ---------------- bộ nhớ dự án ----------------
def load_memory(root: Path) -> List[Tuple[str, str]]:
    """Trả về [(tên file, nội dung)] theo thứ tự nạp."""
    found = []
    seen = set()
    candidates = [home_dir() / "FITCODE.md"] + [Path(root) / n for n in MEMORY_FILES]
    for p in candidates:
        try:
            if p.is_file() and p.resolve() not in seen:
                seen.add(p.resolve())
                text = p.read_text(encoding="utf-8", errors="replace").strip()
                if text:
                    if len(text) > MAX_MEMORY_CHARS:
                        text = text[:MAX_MEMORY_CHARS] + "\n… (đã cắt bớt)"
                    found.append((str(p.relative_to(root)) if str(p).startswith(str(root)) else str(p), text))
        except OSError:
            continue
    return found


# ---------------- lệnh slash tuỳ biến ----------------
@dataclass
class Command:
    name: str
    description: str
    body: str
    source: str


BUNDLED_COMMANDS = {
    "review": Command("review", "Đọc thay đổi git hiện tại và nhận xét như một reviewer",
                      "Hãy review các thay đổi chưa commit trong dự án. Chạy `git status` và `git diff` (và `git diff --staged`), "
                      "đọc các file liên quan nếu cần. Nêu: (1) lỗi logic/bảo mật, (2) thiếu test, (3) gợi ý cải thiện, "
                      "sắp theo mức nghiêm trọng. Không sửa file. $ARGUMENTS", "tích hợp"),
    "commit": Command("commit", "Tạo commit git với thông điệp phù hợp",
                      "Chạy `git status` và `git diff` để xem thay đổi, rồi soạn thông điệp commit ngắn gọn (dòng đầu <= 72 ký tự, "
                      "nói rõ 'làm gì và vì sao'), sau đó `git add` các file liên quan và `git commit`. Không commit file bí mật (.env, key). $ARGUMENTS",
                      "tích hợp"),
    "explain": Command("explain", "Giải thích mã/dự án cho người mới",
                       "Giải thích bằng tiếng Việt, dễ hiểu cho sinh viên: $ARGUMENTS. Đọc các file cần thiết trước khi giải thích; "
                       "nêu luồng chạy chính và file quan trọng.", "tích hợp"),
    "fix-tests": Command("fix-tests", "Chạy test, đọc lỗi và sửa đến khi qua",
                         "Chạy bộ test của dự án (tự tìm lệnh phù hợp: pytest, npm test...). Nếu có test lỗi: đọc thông báo lỗi, tìm nguyên nhân gốc, "
                         "sửa mã (không sửa test cho khớp lỗi trừ khi test sai), chạy lại. Lặp tối đa 5 lần rồi báo cáo kết quả. $ARGUMENTS",
                         "tích hợp"),
}


def load_commands(root: Path) -> Dict[str, Command]:
    cmds = dict(BUNDLED_COMMANDS)
    for base in (home_dir() / "commands", Path(root) / ".fitcode" / "commands"):
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*.md")):
            rel = f.relative_to(base).with_suffix("")
            name = ":".join(rel.parts)
            try:
                meta, body = parse_frontmatter(f.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            desc = meta.get("description") or (body.strip().splitlines() or [""])[0][:80]
            cmds[name] = Command(name, desc, body.strip(), str(f))
    return cmds


def expand_command(cmd: Command, args: str) -> str:
    body = cmd.body
    words = args.split()
    for i, w in enumerate(words[:9], 1):
        body = body.replace("$%d" % i, w)
    body = re.sub(r"\$[1-9]", "", body)
    if "$ARGUMENTS" in body:
        return body.replace("$ARGUMENTS", args).strip()
    return (body + ("\n\n" + args if args else "")).strip()


# ---------------- skills ----------------
@dataclass
class Skill:
    name: str
    description: str
    body: str
    path: Path


def load_skills(root: Path) -> Dict[str, Skill]:
    skills = {}
    for base in (home_dir() / "skills", Path(root) / ".fitcode" / "skills"):
        if not base.is_dir():
            continue
        for d in sorted(p for p in base.iterdir() if p.is_dir()):
            f = d / "SKILL.md"
            if not f.is_file():
                continue
            try:
                meta, body = parse_frontmatter(f.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            name = meta.get("name") or d.name
            skills[name] = Skill(name, meta.get("description", ""), body.strip(), d)
    return skills


# ---------------- subagents ----------------
@dataclass
class AgentDef:
    name: str
    description: str
    prompt: str
    tools: Optional[List[str]]      # None = tất cả (trừ task)
    source: str


BUNDLED_AGENTS = {
    "explore": AgentDef("explore", "Khám phá, tìm kiếm trong mã nguồn (chỉ đọc). Dùng khi cần tìm hiểu nhiều file mà không muốn làm đầy ngữ cảnh chính.",
                        "Bạn là agent khám phá mã nguồn, chỉ đọc. Tìm câu trả lời nhanh bằng grep/glob/read_file, "
                        "rồi báo cáo ngắn gọn (tối đa ~15 dòng): file nào, hàm nào, làm gì. Không đoán; không sửa file.",
                        ["read_file", "list_dir", "glob", "grep"], "tích hợp"),
    "general": AgentDef("general", "Agent đa dụng cho một việc con độc lập, nhiều bước.",
                        "Bạn là agent thực hiện một việc con được giao. Hoàn thành trọn vẹn rồi báo cáo ngắn gọn kết quả và các file đã thay đổi.",
                        None, "tích hợp"),
}


def load_agents(root: Path) -> Dict[str, AgentDef]:
    agents = dict(BUNDLED_AGENTS)
    for base in (home_dir() / "agents", Path(root) / ".fitcode" / "agents"):
        if not base.is_dir():
            continue
        for f in sorted(base.glob("*.md")):
            try:
                meta, body = parse_frontmatter(f.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
            name = meta.get("name") or f.stem
            tools = _split_list(meta["tools"]) if meta.get("tools") else None
            agents[name] = AgentDef(name, meta.get("description", ""), body.strip(), tools, str(f))
    return agents
