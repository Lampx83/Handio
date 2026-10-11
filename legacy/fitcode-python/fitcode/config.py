"""Cấu hình: gộp theo thứ tự ưu tiên tăng dần
mặc định < ~/.fitcode/config.json < ~/.fitcode/settings.json
< <dự án>/.fitcode/settings.json < <dự án>/.fitcode/settings.local.json < biến môi trường."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

DEFAULTS = {
    "base_url": "http://127.0.0.1:8037/vllm/v1",   # đặt địa chỉ gateway thật bằng FITCODE_BASE_URL hoặc config.json
    "model": "qwen3.5-35b-a3b-int4",
    "key_header": "x-ollama-seckey",
    "context_tokens": 32768,        # cửa sổ ngữ cảnh của máy chủ
    "max_output_tokens": 4096,
    "temperature": 0.3,
    "thinking": False,
    "mode": "default",              # default | acceptEdits | plan | bypass
    "max_steps": 40,
    "permissions": {"allow": [], "deny": []},
    "hooks": {},
    "mcpServers": {},
}


def home_dir() -> Path:
    return Path(os.environ.get("FITCODE_HOME") or (Path.home() / ".fitcode"))


def _read_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        print("Cảnh báo: không đọc được %s (%s)" % (path, e))
        return {}


def merge(a: dict, b: dict) -> dict:
    """Gộp đệ quy: dict gộp theo khoá, list nối lại, còn lại b ghi đè a."""
    out = dict(a)
    for k, v in b.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = merge(out[k], v)
        elif k in out and isinstance(out[k], list) and isinstance(v, list):
            out[k] = out[k] + [x for x in v if x not in out[k]]
        else:
            out[k] = v
    return out


def load(project_root: Path) -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    home = home_dir()
    for p in (home / "config.json", home / "settings.json",
              project_root / ".fitcode" / "settings.json",
              project_root / ".fitcode" / "settings.local.json"):
        cfg = merge(cfg, _read_json(p))
    env = os.environ
    if env.get("FITCODE_BASE_URL"):
        cfg["base_url"] = env["FITCODE_BASE_URL"]
    if env.get("FITCODE_MODEL"):
        cfg["model"] = env["FITCODE_MODEL"]
    if env.get("FITCODE_KEY"):
        cfg["key"] = env["FITCODE_KEY"]
    cfg["base_url"] = cfg["base_url"].rstrip("/")
    return cfg


def save_login(key: str, base_url: str = None) -> Path:
    """Lưu key vào ~/.fitcode/config.json (chỉ chủ sở hữu đọc được)."""
    home = home_dir()
    home.mkdir(parents=True, exist_ok=True)
    path = home / "config.json"
    data = _read_json(path)
    data["key"] = key
    if base_url:
        data["base_url"] = base_url
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return path
