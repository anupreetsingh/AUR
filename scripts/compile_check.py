#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
RESUME_DIR = ROOT_DIR / "resume"
MAIN_TEX = RESUME_DIR / "main.tex"
COMPILE_TEX = SCRIPTS_DIR / "compile_check.tex"
COMPILE_PDF = SCRIPTS_DIR / "compile_check.pdf"
TARGETS = {
    "PMA.b1": 220,
    "PMA.b2": 110,
}
CLEANUP_PATTERNS = [
    "compile_check.aux",
    "compile_check.fdb_latexmk",
    "compile_check.fls",
    "compile_check.log",
    "compile_check.out",
    "compile_check.pdf",
    "compile_check.synctex.gz",
    "compile_check.tex",
]


def emit(result: bool) -> int:
    sys.stdout.write("yes\n" if result else "no\n")
    return 0 if result else 1


def filler(length: int) -> str:
    token = "qzxvkr"
    pieces: list[str] = []
    remaining = length

    while remaining > 0:
        if not pieces:
            chunk = token[:remaining]
            pieces.append(chunk)
            remaining -= len(chunk)
            continue

        if remaining == 1:
            pieces.append(" ")
            remaining -= 1
            continue

        pieces.append(" ")
        remaining -= 1
        chunk = token[: min(len(token), remaining)]
        pieces.append(chunk)
        remaining -= len(chunk)

    return "".join(pieces)


def replace_bullet_line(original: str, text: str) -> str:
    match = re.match(r"^(\s*-\s*)(.*?)(\\\\)?\s*$", original)
    if not match:
        raise ValueError("Unexpected bullet format")

    prefix = match.group(1)
    linebreak = match.group(3) or ""
    return f"{prefix}{text}{linebreak}"


def replace_after_marker(lines: list[str], marker: str, text: str) -> bool:
    marker_indexes = [idx for idx, line in enumerate(lines) if line.strip() == f"% area: {marker}"]
    if len(marker_indexes) != 1:
        return False

    target_index = marker_indexes[0] + 1
    if target_index >= len(lines):
        return False

    lines[target_index] = replace_bullet_line(lines[target_index], text)
    return True


def replace_pma_by_structure(lines: list[str], texts: list[str]) -> bool:
    accelerator_index = next(
        (idx for idx, line in enumerate(lines) if "{Product Manager Accelerator}" in line),
        None,
    )
    if accelerator_index is None:
        return False

    bullet_indexes: list[int] = []
    for idx in range(accelerator_index, len(lines)):
        stripped = lines[idx].lstrip()
        if stripped.startswith("\\resumeSubheading") and idx > accelerator_index:
            break
        if re.match(r"^\s*-\s*", lines[idx]):
            bullet_indexes.append(idx)
            if len(bullet_indexes) == 2:
                break

    if len(bullet_indexes) != 2:
        return False

    for idx, text in zip(bullet_indexes, texts):
        lines[idx] = replace_bullet_line(lines[idx], text)

    return True


def build_temp_source(source: str) -> str | None:
    lines = source.splitlines()
    filled = {key: filler(length) for key, length in TARGETS.items()}

    marker_success = True
    for key, text in filled.items():
        marker_success = replace_after_marker(lines, key, text) and marker_success

    if not marker_success:
        lines = source.splitlines()
        structure_success = replace_pma_by_structure(lines, [filled["PMA.b1"], filled["PMA.b2"]])
        if not structure_success:
            return None

    return "\n".join(lines) + "\n"


def cleanup_artifacts() -> None:
    for name in CLEANUP_PATTERNS:
        path = SCRIPTS_DIR / name
        if path.exists():
            path.unlink()


def compile_and_check(keep_artifacts: bool = False, final: bool = False) -> bool:
    if shutil.which("latexmk") is None or shutil.which("pdfinfo") is None:
        return False

    if not MAIN_TEX.exists():
        return False

    source = MAIN_TEX.read_text(encoding="utf-8")
    if final:
        temp_source = source
    else:
        temp_source = build_temp_source(source)
        if temp_source is None:
            return False

    COMPILE_TEX.write_text(temp_source, encoding="utf-8")
    env = os.environ.copy()
    extra_texinputs = str(RESUME_DIR)
    existing_texinputs = env.get("TEXINPUTS", "")
    env["TEXINPUTS"] = (
        f"{extra_texinputs}{os.pathsep}{existing_texinputs}"
        if existing_texinputs
        else f"{extra_texinputs}{os.pathsep}"
    )

    try:
        compile_result = subprocess.run(
            [
                "latexmk",
                "-pdf",
                "-interaction=nonstopmode",
                "-halt-on-error",
                COMPILE_TEX.name,
            ],
            cwd=SCRIPTS_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            check=False,
        )
        if compile_result.returncode != 0 or not COMPILE_PDF.exists():
            return False

        info_result = subprocess.run(
            ["pdfinfo", COMPILE_PDF.name],
            cwd=SCRIPTS_DIR,
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
    finally:
        if not keep_artifacts:
            cleanup_artifacts()


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep generated compile-check artifacts in scripts/ for debugging.",
    )
    parser.add_argument(
        "--final",
        action="store_true",
        help="Compile main.tex as-is without substituting PMA filler. "
             "Use after Step 3 to verify the actual final state is one page.",
    )
    args = parser.parse_args()
    return emit(compile_and_check(keep_artifacts=args.keep, final=args.final))


if __name__ == "__main__":
    raise SystemExit(main())
