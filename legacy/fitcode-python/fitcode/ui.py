"""Hiển thị trên terminal: màu, diff, spinner, hỏi quyền. Chỉ dùng thư viện chuẩn."""
from __future__ import annotations

import difflib
import re
import os
import shutil
import sys
import threading
import time


def _supports_color() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    if not sys.stdout.isatty():
        return False
    if os.name == "nt":
        os.system("")  # bật chuỗi ANSI trên Windows 10+
    return True


COLOR = _supports_color()


def set_color(on: bool) -> None:
    global COLOR
    COLOR = on


def _w(code: str, s: str) -> str:
    return "\x1b[%sm%s\x1b[0m" % (code, s) if COLOR else s


def bold(s): return _w("1", s)
def dim(s): return _w("2", s)
def red(s): return _w("31", s)
def green(s): return _w("32", s)
def yellow(s): return _w("33", s)
def blue(s): return _w("34", s)
def magenta(s): return _w("35", s)
def cyan(s): return _w("36", s)
def gray(s): return _w("90", s)


def out(s: str = "", end: str = "\n") -> None:
    sys.stdout.write(s + end)
    sys.stdout.flush()


def width() -> int:
    return shutil.get_terminal_size((100, 20)).columns


def indent(s: str, n: int) -> str:
    pad = " " * n
    return "\n".join(pad + line for line in s.splitlines())


def truncate_lines(text: str, n: int) -> str:
    lines = text.splitlines()
    if len(lines) <= n:
        return text
    return "\n".join(lines[:n]) + "\n… (còn %d dòng)" % (len(lines) - n)


def render_diff(old: str, new: str, path: str, max_lines: int = 60) -> str:
    """Diff dạng unified, tô màu."""
    diff = list(difflib.unified_diff(
        old.splitlines(), new.splitlines(), "a/" + path, "b/" + path, lineterm="", n=2))
    if not diff:
        return gray("(không có thay đổi)")
    out_lines = []
    for line in diff[:max_lines + 2]:
        if line.startswith("+++") or line.startswith("---"):
            out_lines.append(bold(line))
        elif line.startswith("@@"):
            out_lines.append(cyan(line))
        elif line.startswith("+"):
            out_lines.append(green(line))
        elif line.startswith("-"):
            out_lines.append(red(line))
        else:
            out_lines.append(gray(line))
    if len(diff) > max_lines + 2:
        out_lines.append(gray("… (diff còn %d dòng)" % (len(diff) - max_lines - 2)))
    return "\n".join(out_lines)


class Spinner:
    """Vòng xoay chờ phản hồi đầu tiên của mô hình (chỉ khi chạy trong terminal)."""
    FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

    def __init__(self, label: str = "Đang suy nghĩ"):
        self.label = label
        self._stop = threading.Event()
        self._thread = None
        self.enabled = sys.stderr.isatty() and COLOR

    def start(self, label: str = None):
        if label:
            self.label = label
        if not self.enabled or self._thread:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        i = 0
        t0 = time.time()
        while not self._stop.is_set():
            sys.stderr.write("\r%s %s… %ds " % (cyan(self.FRAMES[i % len(self.FRAMES)]), self.label, time.time() - t0))
            sys.stderr.flush()
            i += 1
            time.sleep(0.1)

    def stop(self):
        if self._thread:
            self._stop.set()
            self._thread.join()
            self._thread = None
            sys.stderr.write("\r" + " " * (len(self.label) + 14) + "\r")
            sys.stderr.flush()


def read_line(prompt: str) -> str:
    """Đọc một dòng; EOF được coi là thoát."""
    try:
        return input(prompt)
    except EOFError:
        raise


class MarkdownStream:
    """Hiển thị markdown theo dòng khi mô hình đang sinh (streaming): tiêu đề, danh sách, **đậm**, `mã`, khối ```.
    Trạng thái được giữ giữa các lần feed nên cắt chuỗi ở đâu cũng cho cùng kết quả."""

    def __init__(self, write=None, color=None):
        self.w = write or (lambda t: (sys.stdout.write(t), sys.stdout.flush()))
        self.color = COLOR if color is None else color
        self.in_fence = False
        self._reset_line()

    def _reset_line(self):
        self.kind = None      # None (chưa quyết định) | plain | h | quote | code | fence_open | fence_close
        self.head = ""
        self.bold = self.code = self.star = False
        self.skip_space = False

    # ---- API ----
    def feed(self, text: str) -> None:
        if not self.color:
            self.w(text)
            return
        for ch in text:
            self._ch(ch)

    def flush(self) -> None:
        if not self.color:
            return
        if self.kind is None and self.head:
            self._plain_head()
        if self.star:
            self.w("*")
            self.star = False
        self.w("\x1b[0m")

    # ---- nội bộ ----
    def _ch(self, ch: str) -> None:
        if ch == "\n":
            self._end_line()
            return
        if self.kind is None:
            self.head += ch
            self._decide()
        else:
            self._emit(ch)

    def _plain_head(self):
        h, self.head, self.kind = self.head, "", "plain"
        for c in h:
            self._emit(c)

    def _decide(self):
        h = self.head
        if self.in_fence:
            if h.startswith("```"):
                self.kind, self.head = "fence_close", ""
                self.w("\x1b[90m└" + h[3:])
            elif len(h) >= 3 or not "```".startswith(h):
                self.kind, self.head = "code", ""
                self.w("\x1b[90m│ \x1b[0m\x1b[37m" + h)
            return
        c = h[0]
        if h.isspace():
            self.w(h)
            self.head = ""
        elif c == "#":
            if h.strip("#") == "":
                return
            if h.rstrip("#") == "" or re.fullmatch(r"#{1,6} ", h) is None:
                if re.fullmatch(r"#{1,6}", h):
                    return
                self._plain_head()
            else:
                self.kind, self.head = "h", ""
                self.w("\x1b[1;36m")
        elif c in "-*":
            if h in ("-", "*"):
                return
            if h in ("- ", "* "):
                self.kind, self.head = "plain", ""
                self.w("\x1b[36m•\x1b[0m ")
            else:
                self._plain_head()
        elif c == ">":
            self.kind, self.head, self.skip_space = "quote", "", True
            self.w("\x1b[90m▎ ")
        elif c == "`":
            if len(h) < 3 and set(h) == {"`"}:
                return
            if h == "```":
                self.kind, self.head = "fence_open", ""
                self.w("\x1b[90m┌ ")
            else:
                self._plain_head()
        else:
            self._plain_head()

    def _emit(self, ch: str) -> None:
        k = self.kind
        if k == "quote" and self.skip_space and ch == " ":
            self.skip_space = False
            return
        self.skip_space = False
        if k in ("code", "h", "quote", "fence_open", "fence_close"):
            self.w(ch)
            return
        # plain: **đậm** và `mã` trong dòng
        if self.star:
            self.star = False
            if ch == "*":
                self.bold = not self.bold
                self.w("\x1b[1m" if self.bold else "\x1b[22m")
                return
            self.w("*")
        if ch == "*":
            self.star = True
        elif ch == "`":
            self.code = not self.code
            self.w("\x1b[36m" if self.code else "\x1b[39m")
        else:
            self.w(ch)

    def _end_line(self) -> None:
        if self.kind is None and self.head:
            self._plain_head()
        if self.star:
            self.w("*")
        if self.kind == "fence_open":
            self.in_fence = True
        elif self.kind == "fence_close":
            self.in_fence = False
        self.w("\x1b[0m\n")
        self._reset_line()
