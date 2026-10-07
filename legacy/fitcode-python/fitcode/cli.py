"""Giao diện dòng lệnh: REPL tương tác, lệnh slash, chế độ không tương tác (-p), login, doctor."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import time
from pathlib import Path

from . import __version__, config, ui
from .agent import Session, call_summary
from .examples import scaffold
from .extensions import expand_command
from .llm import Client, LLMError
from .permissions import MODES
from .tools import run_shell, undo_last

try:
    import readline  # noqa: F401  (lịch sử mũi tên lên/xuống)
except ImportError:
    readline = None

LOGO = r"""
  ___ ___ _____    ___         _
 | __|_ _|_   _|  / __|___  __| |___
 | _| | |  | |   | (__/ _ \/ _` / -_)
 |_| |___| |_|    \___\___/\__,_\___|"""

HELP = """Lệnh slash:
  /help               xem trợ giúp này
  /init               agent khám phá dự án và tạo FITCODE.md (bộ nhớ dự án)
  /plan               vào chế độ plan (chỉ đọc, lập kế hoạch rồi xin duyệt)
  /mode [tên]         xem/đổi chế độ quyền: default | acceptEdits | plan | bypass
  /compact [ghi chú]  tóm tắt hội thoại để giải phóng ngữ cảnh
  /context            xem mức dùng cửa sổ ngữ cảnh
  /clear              xoá hội thoại, bắt đầu lại
  /undo               hoàn tác lần sửa file gần nhất
  /todos              xem danh sách việc của agent
  /think [on|off]     bật/tắt chế độ suy nghĩ (chậm hơn nhưng kỹ hơn)
  /agents /skills /hooks /mcp /memory /commands   xem phần mở rộng đã nạp
  /cost               số token đã dùng trong phiên
  /export [file]      lưu hội thoại ra file markdown
  /example            chép ví dụ lệnh/agent/skill/hook/MCP vào .fitcode/
  /exit               thoát
Cú pháp khác:  @đường/dẫn  đính kèm nội dung file · !lệnh  chạy lệnh shell trực tiếp · \"\"\" ... \"\"\"  nhập nhiều dòng"""

INIT_PROMPT = ("Hãy khám phá dự án này (list_dir, đọc README/cấu hình, xem cấu trúc thư mục, tìm lệnh chạy và lệnh test) rồi tạo file "
               "FITCODE.md ở thư mục gốc để làm bộ nhớ dự án cho các phiên sau. Nội dung ngắn gọn (tối đa ~60 dòng, tiếng Việt): "
               "mục đích dự án; cấu trúc thư mục chính; cách cài đặt/chạy/test (lệnh chính xác); quy ước mã nguồn; điều cần tránh. "
               "Chỉ ghi những gì bạn đã xác minh bằng cách đọc file; không bịa.")


# ---------------------------------------------------------------- tiện ích
def expand_mentions(text: str, root: Path) -> str:
    """@đường/dẫn -> kèm nội dung file (tối đa ~12k ký tự mỗi file)."""
    extra = []
    for m in re.finditer(r"(?<!\S)@([^\s,;]+)", text):
        p = (root / m.group(1)).resolve()
        try:
            if not str(p).startswith(str(root.resolve())):
                continue
            if p.is_file():
                data = p.read_text(encoding="utf-8", errors="replace")
                if len(data) > 12000:
                    data = data[:12000] + "\n… (đã cắt bớt)"
                extra.append("[Nội dung @%s]\n```\n%s\n```" % (m.group(1), data))
            elif p.is_dir():
                names = sorted(x.name + ("/" if x.is_dir() else "") for x in p.iterdir())[:100]
                extra.append("[Thư mục @%s]\n%s" % (m.group(1), "\n".join(names)))
        except (OSError, UnicodeError):
            continue
    return text + ("\n\n" + "\n\n".join(extra) if extra else "")


def read_user_input(prompt: str) -> str:
    first = ui.read_line(prompt)
    s = first.strip()
    if s.startswith('"""'):
        lines = [s[3:]]
        while True:
            line = ui.read_line("… ")
            if line.strip().endswith('"""'):
                lines.append(line.rstrip()[:-3])
                break
            lines.append(line)
        return "\n".join(lines).strip()
    while first.endswith("\\"):
        first = first[:-1] + "\n" + ui.read_line("… ")
    return first


def ensure_state_dir(root: Path) -> Path:
    d = root / ".fitcode" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    gi = root / ".fitcode" / ".gitignore"
    if not gi.exists():
        gi.write_text("sessions/\nsettings.local.json\n", encoding="utf-8")
    return d


class Recorder:
    """Lưu hội thoại: last.json (để tiếp tục bằng -c) và <thời điểm>.jsonl (giảng viên có thể xem lại)."""

    def __init__(self, root: Path):
        try:
            self.dir = ensure_state_dir(root)
        except OSError:
            self.dir = None
        self.log = self.dir / (time.strftime("%Y%m%d-%H%M%S") + ".jsonl") if self.dir else None
        self.logged = 0

    def save(self, messages: list) -> None:
        if not self.dir:
            return
        try:
            (self.dir / "last.json").write_text(json.dumps(messages, ensure_ascii=False), encoding="utf-8")
            if len(messages) < self.logged:
                self.logged = 0
            with open(self.log, "a", encoding="utf-8") as f:
                for m in messages[self.logged:]:
                    f.write(json.dumps(dict(m, ts=int(time.time())), ensure_ascii=False) + "\n")
            self.logged = len(messages)
        except OSError:
            pass

    def load_last(self):
        try:
            return json.loads((self.dir / "last.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, AttributeError):
            return None


# ---------------------------------------------------------------- lệnh slash
def cmd_context(sess: Session) -> None:
    a = sess.main
    limit = sess.cfg.get("context_tokens", 32768)
    sys_tok = int(len(sess.system_prompt(None, 0)) / sess.chars_per_token)
    msg_tok = int(len(json.dumps(a.messages, ensure_ascii=False)) / sess.chars_per_token)
    tot = sys_tok + msg_tok
    pct = min(100, 100 * tot // limit)
    bar = "█" * (pct // 4) + "░" * (25 - pct // 4)
    ui.out("Ngữ cảnh  %s %d%%  (~%d / %d token)" % (bar, pct, tot, limit))
    ui.out("  system prompt + công cụ + bộ nhớ ~%d token · hội thoại ~%d token (%d tin nhắn)" % (sys_tok, msg_tok, len(a.messages)))
    if pct > 55:
        ui.out(ui.yellow("  Gần đầy: dùng /compact để tóm tắt hoặc /clear để bắt đầu lại."))


def cmd_export(sess: Session, arg: str) -> None:
    path = Path(arg or time.strftime("fitcode-%Y%m%d-%H%M%S.md"))
    lines = ["# Hội thoại FIT Code\n"]
    for m in sess.main.messages:
        r = m.get("role")
        if r == "user":
            lines.append("## Bạn\n\n" + (m.get("content") or "") + "\n")
        elif r == "assistant":
            if m.get("content"):
                lines.append("## Trợ lý\n\n" + m["content"] + "\n")
            for c in m.get("tool_calls") or []:
                lines.append("> gọi `%s(%s)`\n" % (c["function"]["name"], call_summary(c["function"]["name"], _safe_json(c["function"]["arguments"]))))
        elif r == "tool":
            lines.append("```\n%s\n```\n" % (m.get("content") or "")[:1500])
    path.write_text("\n".join(lines), encoding="utf-8")
    ui.out("Đã lưu vào %s" % path)


def _safe_json(s: str) -> dict:
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def handle_slash(sess: Session, line: str, rec: Recorder) -> bool:
    """Trả về True nếu cần thoát."""
    parts = line[1:].split(None, 1)
    name = parts[0] if parts else ""
    arg = parts[1].strip() if len(parts) > 1 else ""
    a = sess.main
    if name in ("exit", "quit", "q"):
        return True
    if name == "help":
        ui.out(HELP)
    elif name == "clear":
        a.messages.clear()
        ui.out(ui.gray("Đã xoá hội thoại."))
    elif name == "compact":
        if a.compact(focus=arg):
            ui.out(ui.gray("Đã tóm tắt. ") + ui.gray("~%d token." % a.estimate_tokens()))
        else:
            ui.out("Chưa có gì để tóm tắt.")
    elif name == "context":
        cmd_context(sess)
    elif name == "mode":
        if arg:
            try:
                sess.perms.set_mode(arg)
            except ValueError as e:
                ui.out(ui.red(str(e)))
                return False
        ui.out("Chế độ quyền hiện tại: " + ui.bold(sess.perms.mode) + ui.gray("   (có: " + ", ".join(MODES) + ")"))
    elif name == "plan":
        sess.perms.set_mode("plan")
        ui.out(ui.cyan("Đã vào chế độ plan: agent chỉ đọc và lập kế hoạch, rồi xin bạn duyệt."))
    elif name == "undo":
        ui.out(undo_last(sess.ctx))
    elif name == "todos":
        if sess.ctx.todos:
            sess.show_todos(sess.ctx.todos)
        else:
            ui.out("Chưa có việc nào.")
    elif name == "think":
        sess.thinking = (arg != "off") if arg in ("on", "off") else not sess.thinking
        ui.out("Chế độ suy nghĩ: " + ("bật" if sess.thinking else "tắt"))
    elif name == "cost":
        ui.out("Phiên này: %d lượt gọi · %d token vào · %d token ra · %.0fs" % (
            sess.calls, sess.prompt_tokens, sess.completion_tokens, time.time() - sess.started))
    elif name == "export":
        cmd_export(sess, arg)
    elif name == "example":
        files = scaffold(sess.root)
        sess.reload_extensions()
        ui.out("Đã tạo %d file ví dụ:\n%s\n%s" % (len(files), ui.indent("\n".join(files), 2),
                                                  ui.gray("Khởi động lại fitcode để nạp hook và MCP từ settings.json mới (lệnh/agent/skill nạp ngay).")))
    elif name == "agents":
        for d in sess.agent_defs.values():
            ui.out("  %s  %s %s" % (ui.bold(d.name), d.description, ui.gray("[%s]" % d.source)))
    elif name == "skills":
        if not sess.skills:
            ui.out("Chưa có skill (thư mục .fitcode/skills/<tên>/SKILL.md). Thử /example.")
        for s in sess.skills.values():
            ui.out("  %s  %s" % (ui.bold(s.name), s.description))
    elif name == "commands":
        for c in sess.commands.values():
            ui.out("  /%s  %s %s" % (ui.bold(c.name), c.description, ui.gray("[%s]" % c.source)))
    elif name == "hooks":
        n = sess.hooks.count()
        ui.out("%d hook đã cấu hình." % n if n else "Chưa có hook (cấu hình \"hooks\" trong .fitcode/settings.json). Thử /example.")
        for ev, entries in sess.hooks.hooks.items():
            for e in entries or []:
                for h in e.get("hooks") or []:
                    ui.out("  %s [%s] %s" % (ui.bold(ev), e.get("matcher", "*"), h.get("command")))
    elif name == "mcp":
        if not sess.mcp.servers and not sess.mcp.errors:
            ui.out("Chưa có MCP server (cấu hình \"mcpServers\" trong .fitcode/settings.json). Thử /example.")
        for n, s in sess.mcp.servers.items():
            ui.out("  %s  %d công cụ: %s" % (ui.bold(n), len(s.tools), ", ".join(t.get("name", "") for t in s.tools)))
        for n, e in sess.mcp.errors.items():
            ui.out(ui.red("  %s  lỗi: %s" % (n, e)))
    elif name == "memory":
        if not sess.memory:
            ui.out("Chưa có bộ nhớ dự án. Dùng /init để tạo FITCODE.md.")
        for n, t in sess.memory:
            ui.out("  %s (%d ký tự)" % (ui.bold(n), len(t)))
    elif name == "init":
        run_prompt(sess, INIT_PROMPT, rec)
    elif name in sess.commands:
        run_prompt(sess, expand_command(sess.commands[name], arg), rec)
    else:
        ui.out(ui.red("Không có lệnh /%s. Gõ /help." % name))
    return False


def run_prompt(sess: Session, text: str, rec: Recorder) -> None:
    try:
        sess.main.run_turn(expand_mentions(text, sess.root))
    except KeyboardInterrupt:
        sess.main.repair_history()
        ui.out(ui.yellow("\n⏹ Đã dừng. Bạn có thể nhập tiếp."))
    rec.save(sess.main.messages)


# ---------------------------------------------------------------- chạy chính
def banner(sess: Session) -> None:
    ui.out(ui.cyan(LOGO) + "  " + ui.gray("v%s" % __version__))
    host = re.sub(r"^https?://", "", sess.cfg["base_url"]).split("/")[0]
    ui.out(ui.gray("  mô hình %s @ %s" % (sess.cfg["model"], host)))
    ui.out(ui.gray("  thư mục: %s" % sess.root))
    bits = ["chế độ " + sess.perms.mode]
    if sess.memory:
        bits.append("bộ nhớ: " + ", ".join(n for n, _ in sess.memory))
    custom = [c for c in sess.commands.values() if c.source != "tích hợp"]
    if custom:
        bits.append("%d lệnh tuỳ biến" % len(custom))
    if sess.skills:
        bits.append("%d skill" % len(sess.skills))
    if sess.hooks.count():
        bits.append("%d hook" % sess.hooks.count())
    if sess.mcp.servers:
        bits.append("MCP: " + ", ".join(sess.mcp.servers))
    ui.out(ui.gray("  " + " · ".join(bits)))
    for n, e in sess.mcp.errors.items():
        ui.out(ui.red("  MCP '%s' lỗi: %s" % (n, e)))
    ui.out(ui.gray("  /help để xem lệnh · Ctrl+C để dừng agent · /exit để thoát\n"))


def repl(sess: Session, rec: Recorder) -> None:
    hr = sess.hooks.run("SessionStart")
    if hr.context:
        sess.main.messages.append({"role": "user", "content": "[Thông tin từ hook SessionStart]\n" + hr.context})
        sess.main.messages.append({"role": "assistant", "content": "Đã ghi nhận."})
    interrupts = 0
    while True:
        mode_tag = "" if sess.perms.mode == "default" else ui.magenta("[%s] " % sess.perms.mode)
        try:
            line = read_user_input(mode_tag + ui.bold(ui.green("› ")))
            interrupts = 0
        except EOFError:
            ui.out("")
            return
        except KeyboardInterrupt:
            interrupts += 1
            if interrupts >= 2:
                ui.out("")
                return
            ui.out(ui.gray("\n(nhấn Ctrl+C lần nữa hoặc gõ /exit để thoát)"))
            continue
        line = line.strip()
        if not line:
            continue
        if line.startswith("/"):
            if handle_slash(sess, line, rec):
                return
            continue
        if line.startswith("!"):
            code, outp, to = run_shell(line[1:], sess.root, 60)
            ui.out(outp.rstrip() + ("\n[mã thoát %d]" % code))
            continue
        run_prompt(sess, line, rec)


def cmd_login() -> int:
    ui.out("Nhập API key do giảng viên cấp (ký tự sẽ không hiện khi gõ).")
    key = getpass.getpass("Key: ").strip()
    if not key:
        ui.out(ui.red("Chưa nhập key."))
        return 1
    cfg = config.load(Path.cwd())
    cfg["key"] = key
    try:
        models = Client(cfg).models()
    except LLMError as e:
        ui.out(ui.red("Kiểm tra key thất bại: %s" % e))
        if ui.read_line("Vẫn lưu key này? [y/N] ").strip().lower() != "y":
            return 1
        models = []
    path = config.save_login(key)
    ui.out(ui.green("✓ Đã lưu key vào %s" % path) + (ui.gray("  (máy chủ có mô hình: %s)" % ", ".join(models)) if models else ""))
    return 0


def cmd_doctor(root: Path) -> int:
    cfg = config.load(root)
    ok = True
    ui.out("FIT Code %s · Python %s" % (__version__, sys.version.split()[0]))
    ui.out("Máy chủ: %s · mô hình: %s" % (cfg["base_url"], cfg["model"]))
    if not cfg.get("key"):
        ui.out(ui.red("✗ Chưa có key. Chạy `fitcode login`."))
        return 1
    c = Client(cfg)
    try:
        models = c.models()
        ui.out(ui.green("✓ Kết nối được, key hợp lệ") + ui.gray("  (mô hình: %s)" % ", ".join(models)))
    except LLMError as e:
        ui.out(ui.red("✗ %s" % e))
        return 1
    try:
        t0 = time.time()
        r = c.chat([{"role": "user", "content": "Trả lời đúng một từ: OK"}], max_tokens=16, thinking=False)
        ui.out(ui.green("✓ Gọi mô hình được") + ui.gray("  (%.1fs, trả lời: %s)" % (time.time() - t0, r["content"].strip()[:30])))
    except LLMError as e:
        ui.out(ui.red("✗ Gọi mô hình lỗi: %s" % e))
        ok = False
    try:
        tools = [{"type": "function", "function": {"name": "ping", "description": "ping", "parameters": {"type": "object", "properties": {}}}}]
        r = c.chat([{"role": "user", "content": "Hãy gọi công cụ ping."}], tools=tools, max_tokens=64, thinking=False)
        if r["tool_calls"]:
            ui.out(ui.green("✓ Gọi công cụ (tool calling) hoạt động"))
        else:
            ui.out(ui.yellow("! Mô hình không gọi công cụ trong thử nghiệm này (agent có thể kém ổn định)"))
    except LLMError as e:
        ui.out(ui.red("✗ Tool calling lỗi: %s" % e))
        ok = False
    return 0 if ok else 1


def main(argv=None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("login", "doctor", "example", "version"):
        sub = argv[0]
        if sub == "login":
            sys.exit(cmd_login())
        if sub == "doctor":
            sys.exit(cmd_doctor(Path.cwd()))
        if sub == "version":
            ui.out("fitcode %s" % __version__)
            return
        created = scaffold(Path.cwd())
        ui.out("Đã tạo:\n" + ui.indent("\n".join(created), 2))
        return
    ap = argparse.ArgumentParser(prog="fitcode", description="FIT Code: agent lập trình trên terminal (Qwen3.5 của Khoa CNTT, NEU).",
                                 epilog="Lệnh con: login · doctor · example · version")
    ap.add_argument("-p", "--print", dest="prompt", metavar="PROMPT", help="chạy một yêu cầu không tương tác rồi thoát")
    ap.add_argument("-c", "--continue", dest="cont", action="store_true", help="tiếp tục hội thoại gần nhất của dự án")
    ap.add_argument("--mode", choices=MODES, help="chế độ quyền ban đầu")
    ap.add_argument("--yolo", action="store_true", help="tự duyệt mọi thao tác (chỉ dùng trong thư mục thử nghiệm!)")
    ap.add_argument("--model", help="tên mô hình")
    ap.add_argument("--base-url", help="địa chỉ API (mặc định: máy chủ của khoa)")
    ap.add_argument("--add-dir", action="append", default=[], help="cho phép thêm thư mục ngoài dự án")
    ap.add_argument("--think", action="store_true", help="bật chế độ suy nghĩ")
    ap.add_argument("--max-steps", type=int, help="số bước tối đa mỗi lượt")
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--version", action="version", version="fitcode " + __version__)
    args = ap.parse_args(argv)
    if args.no_color:
        ui.set_color(False)
    root = Path.cwd()
    cfg = config.load(root)
    if args.model:
        cfg["model"] = args.model
    if args.base_url:
        cfg["base_url"] = args.base_url.rstrip("/")
    if args.mode:
        cfg["mode"] = args.mode
    if args.yolo:
        cfg["mode"] = "bypass"
    if args.think:
        cfg["thinking"] = True
    if args.max_steps:
        cfg["max_steps"] = args.max_steps
    if not cfg.get("key"):
        ui.out(ui.red("Chưa có API key.") + " Chạy `fitcode login` (hoặc đặt biến môi trường FITCODE_KEY).")
        sys.exit(1)
    interactive = args.prompt is None and sys.stdin.isatty()
    if args.prompt is None and not sys.stdin.isatty():
        ui.out(ui.red("Không có terminal tương tác. Dùng -p \"yêu cầu\" để chạy một lần."))
        sys.exit(1)
    sess = Session(cfg, root, interactive=interactive, extra_dirs=[Path(d) for d in args.add_dir])
    rec = Recorder(root)
    try:
        if args.cont:
            prev = rec.load_last()
            if prev:
                sess.main.messages = prev
                rec.logged = len(prev)
        if args.prompt is not None:
            text = sess.main.run_turn(expand_mentions(args.prompt, root))
            rec.save(sess.main.messages)
            if not sys.stdout.isatty() and text:
                pass
            sys.exit(0)
        banner(sess)
        if args.cont and sess.main.messages:
            ui.out(ui.gray("(đã nạp %d tin nhắn từ phiên trước)\n" % len(sess.main.messages)))
        repl(sess, rec)
    finally:
        sess.close()
