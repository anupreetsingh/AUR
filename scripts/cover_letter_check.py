#!/usr/bin/env python3

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
COVER_LETTER_DIR = ROOT_DIR / "Cover_Letter"
MAIN_TEX = COVER_LETTER_DIR / "main.tex"
MAIN_PDF = COVER_LETTER_DIR / "main.pdf"


def emit(result: bool) -> int:
    sys.stdout.write("yes\n" if result else "no\n")
    return 0 if result else 1


def compile_and_check() -> bool:
    if shutil.which("latexmk") is None or shutil.which("pdfinfo") is None:
        return False

    if not MAIN_TEX.exists():
        return False

    compile_result = subprocess.run(
        [
            "latexmk",
            "-pdf",
            "-interaction=nonstopmode",
            "-halt-on-error",
            MAIN_TEX.name,
        ],
        cwd=COVER_LETTER_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if compile_result.returncode != 0 or not MAIN_PDF.exists():
        return False

    info_result = subprocess.run(
        ["pdfinfo", MAIN_PDF.name],
        cwd=COVER_LETTER_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    if info_result.returncode != 0:
        return False

    pages_match = re.search(r"^Pages:\s+(\d+)\s*$", info_result.stdout, re.MULTILINE)
    if pages_match is None:
        return False

    return pages_match.group(1) == "1"


def main() -> int:
    return emit(compile_and_check())


if __name__ == "__main__":
    raise SystemExit(main())
