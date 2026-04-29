#!/bin/bash

if [ $# -ne 2 ]; then
  echo "Usage: ./scripts/final_move.sh <Company> <Role>"
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="/Users/manpreetsingh/Documents/Job Hunt/Resume/Tentative/$1-$2"

mkdir -p "$DEST"

# Resume (always expected)
RESUME_PDF="$PROJECT_ROOT/resume/main.pdf"
if [ -f "$RESUME_PDF" ]; then
  cp "$RESUME_PDF" "$DEST/Anupreet Resume.pdf"
else
  echo "Warning: $RESUME_PDF not found -- skipping resume copy."
fi

# Cover letter (only if it has been compiled)
CL_PDF="$PROJECT_ROOT/Cover_Letter/main.pdf"
if [ -f "$CL_PDF" ]; then
  cp "$CL_PDF" "$DEST/Anupreet Cover Letter.pdf"
else
  echo "Note: $CL_PDF not found -- skipping cover letter copy."
fi

# Edit this line for every company and role and paste it in terminal:
# ./scripts/final_move.sh "Google" "Software Engineer II, Site Reliability"
