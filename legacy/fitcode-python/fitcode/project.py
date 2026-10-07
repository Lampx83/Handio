"""Nhận diện nhanh dự án (ngôn ngữ, lệnh test, git) để gợi ý cho agent — đỡ phải đoán lệnh."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path
from typing import List

from .tools import IGNORE_DIRS

LANGS = {".py": "Python", ".js": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript/React", ".jsx": "JavaScript/React",
         ".java": "Java", ".go": "Go", ".rs": "Rust", ".c": "C", ".cpp": "C++", ".cs": "C#", ".php": "PHP", ".rb": "Ruby",
         ".html": "HTML", ".css": "CSS", ".sql": "SQL"}


def _files(root: Path, limit: int = 3000):
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for f in filenames:
            yield Path(dirpath) / f
            n += 1
            if n >= limit:
                return


def _git(root: Path, *args: str) -> str:
    try:
        r = subprocess.run(["git"] + list(args), cwd=str(root), capture_output=True, text=True, timeout=4)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def detect(root: Path) -> List[str]:
    root = Path(root)
    files = list(_files(root))
    counts = {}
    for f in files:
        lang = LANGS.get(f.suffix.lower())
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    lines = []
    if counts:
        top = sorted(counts.items(), key=lambda kv: -kv[1])[:3]
        lines.append("Languages: " + ", ".join("%s (%d files)" % kv for kv in top))
    names = {f.name for f in files}
    tests = []
    py_tests = [f for f in files if f.suffix == ".py" and (f.name.startswith("test_") or f.name.endswith("_test.py"))]
    if py_tests:
        uses_pytest = False
        for f in py_tests[:8]:
            try:
                if "import pytest" in f.read_text(encoding="utf-8", errors="ignore"):
                    uses_pytest = True
                    break
            except OSError:
                pass
        has_pytest = importlib.util.find_spec("pytest") is not None
        if uses_pytest and has_pytest:
            tests.append("python3 -m pytest -q")
        elif uses_pytest:
            tests.append("pytest is NOT installed here (pip install pytest) — or rewrite tests with unittest")
        else:
            tests.append("python3 -m unittest discover -v   (tests use unittest)")
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            scripts = (json.loads(pkg.read_text(encoding="utf-8")).get("scripts") or {})
            if "test" in scripts:
                tests.append("npm test")
            if "start" in scripts:
                lines.append("Run: npm start")
        except (OSError, ValueError):
            pass
    if "go.mod" in names:
        tests.append("go test ./...")
    if "Cargo.toml" in names:
        tests.append("cargo test")
    if "pom.xml" in names:
        tests.append("mvn -q test")
    mk = root / "Makefile"
    if mk.is_file():
        try:
            if "\ntest:" in "\n" + mk.read_text(encoding="utf-8", errors="ignore"):
                tests.append("make test")
        except OSError:
            pass
    if tests:
        lines.append("Test command(s): " + " | ".join(tests))
    elif counts:
        lines.append("No tests detected: consider adding tests before big changes.")
    if _git(root, "rev-parse", "--is-inside-work-tree") == "true":
        dirty = [l for l in _git(root, "status", "--porcelain").splitlines() if l.strip()]
        lines.append("Git: repository, %s" % ("%d uncommitted change(s)" % len(dirty) if dirty else "working tree clean"))
    else:
        lines.append("Git: not a repository")
    return lines
