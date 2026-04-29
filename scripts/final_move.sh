#!/bin/bash

if [ $# -ne 2 ]; then
  echo "Usage: ./scripts/final_move.sh <Company> <Role>"
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="/Users/manpreetsingh/Documents/Job Hunt/Resume/Tentative/$1-$2"

extract_tex_value() {
  local key="$1"
  local file="$2"
  sed -nE "s/^\\\\newcommand\\{\\\\${key}\\}\\{(.*)\\}$/\\1/p" "$file" | head -n 1
}

mkdir -p "$DEST"

# Resume (always expected)
RESUME_PDF="$PROJECT_ROOT/resume/main.pdf"
if [ -f "$RESUME_PDF" ]; then
  cp "$RESUME_PDF" "$DEST/Anupreet Resume.pdf"
else
  echo "Warning: $RESUME_PDF not found -- skipping resume copy."
fi

# Cover letter (only if Task 2 has produced a matching, compiled letter)
CL_DIR="$PROJECT_ROOT/Cover_Letter"
CL_TEX="$CL_DIR/main.tex"
CL_STARTER="$CL_DIR/starter.tex"
CL_PDF="$CL_DIR/main.pdf"
CL_COMPANY="$(extract_tex_value companyName "$CL_TEX")"
CL_ROLE="$(extract_tex_value roleTitle "$CL_TEX")"

if [ ! -f "$CL_TEX" ] || [ ! -f "$CL_PDF" ]; then
  echo "Note: cover letter source or PDF missing -- skipping cover letter copy."
elif cmp -s "$CL_TEX" "$CL_STARTER"; then
  echo "Note: Cover_Letter/main.tex still matches starter.tex -- skipping cover letter copy."
elif [ -z "$CL_COMPANY" ] || [ -z "$CL_ROLE" ]; then
  echo "Note: could not read company/role from Cover_Letter/main.tex -- skipping cover letter copy."
elif [ "$CL_COMPANY" = "Company Name" ] || [ "$CL_ROLE" = "Role Title" ]; then
  echo "Note: cover letter variables still use starter placeholders -- skipping cover letter copy."
elif [ "$CL_COMPANY" != "$1" ] || [ "$CL_ROLE" != "$2" ]; then
  echo "Note: current cover letter is for '$CL_COMPANY' / '$CL_ROLE', not '$1' / '$2' -- skipping cover letter copy."
elif [ "$CL_PDF" -ot "$CL_TEX" ]; then
  echo "Note: Cover_Letter/main.pdf is older than Cover_Letter/main.tex -- skipping cover letter copy."
else
  cp "$CL_PDF" "$DEST/Anupreet Cover Letter.pdf"
fi

# Edit this line for every company and role and paste it in terminal:
# ./scripts/final_move.sh "Google" "Software Engineer II, Site Reliability"
