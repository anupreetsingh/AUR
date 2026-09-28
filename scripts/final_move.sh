#!/bin/bash

if [ $# -ne 3 ]; then
  echo "Usage: ./scripts/final_move.sh <Archetype> <Company> <Role>"
  echo "  e.g. ./scripts/final_move.sh Java \"Amazon\" \"SDE I\""
  exit 1
fi

ARCHETYPE="$1"
COMPANY="$2"
ROLE="$3"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="/Users/manpreetsingh/Documents/Job Hunt/Resume/Tentative/$COMPANY-$ROLE"

RESUME_REL="resume/$ARCHETYPE"
RESUME_TEX="$PROJECT_ROOT/$RESUME_REL/$ARCHETYPE.tex"
RESUME_PDF="$PROJECT_ROOT/$RESUME_REL/$ARCHETYPE.pdf"

extract_tex_value() {
  local key="$1"
  local file="$2"
  sed -nE "s/^\\\\newcommand\\{\\\\${key}\\}\\{(.*)\\}$/\\1/p" "$file" | head -n 1
}

is_tracked() {
  git -C "$PROJECT_ROOT" ls-files --error-unmatch "$1" >/dev/null 2>&1
}

build_dated_dest() {
  local base_dest="$1"
  local dated_dest
  local counter=2
  local date_suffix

  date_suffix="$(date '+%B %e' | tr -s ' ' | sed 's/ /-/g')"
  dated_dest="${base_dest}-${date_suffix}"

  while [ -e "$dated_dest" ]; do
    dated_dest="${base_dest}-${date_suffix}-${counter}"
    counter=$((counter + 1))
  done

  printf '%s\n' "$dated_dest"
}

# Resume checks run before anything is created or copied
if [ ! -f "$RESUME_TEX" ]; then
  echo "Error: $RESUME_REL/$ARCHETYPE.tex not found. Available archetypes:"
  for dir in "$PROJECT_ROOT"/resume/*/; do
    name="$(basename "$dir")"
    [ -f "$dir$name.tex" ] && echo "  $name"
  done
  exit 1
fi

if [ ! -f "$RESUME_PDF" ]; then
  echo "Error: $RESUME_REL/$ARCHETYPE.pdf not found -- compile $ARCHETYPE.tex first."
  exit 1
fi

if [ "$RESUME_PDF" -ot "$RESUME_TEX" ]; then
  echo "Error: $ARCHETYPE.pdf is older than $ARCHETYPE.tex -- recompile before saving."
  exit 1
fi

if command -v pdfinfo >/dev/null 2>&1; then
  PAGES="$(pdfinfo "$RESUME_PDF" | sed -nE 's/^Pages:[[:space:]]+([0-9]+)[[:space:]]*$/\1/p')"
  if [ "$PAGES" != "1" ]; then
    read -r -p "$ARCHETYPE.pdf is $PAGES pages. Continue anyway? [y/N] " page_choice
    case "$page_choice" in
      y|Y|yes|Yes) ;;
      *) echo "Aborted."; exit 1 ;;
    esac
  fi
else
  echo "Note: pdfinfo not found -- skipping page-count check."
fi

if [ -e "$DEST" ]; then
  echo "Destination path already exists:"
  echo "  $DEST"

  while true; do
    read -r -p "Choose [r]eplace or create [n]ew dated folder: " folder_choice

    case "$folder_choice" in
      r|R|replace|Replace)
        rm -rf "$DEST"
        break
        ;;
      n|N|new|New)
        DEST="$(build_dated_dest "$DEST")"
        echo "Using new folder:"
        echo "  $DEST"
        break
        ;;
      *)
        echo "Please enter 'r' to replace or 'n' to create a dated folder."
        ;;
    esac
  done
fi

mkdir -p "$DEST"

# Resume PDF, plus the exact .tex it was built from
cp "$RESUME_PDF" "$DEST/Anupreet Resume.pdf"
cp "$RESUME_TEX" "$DEST/$ARCHETYPE.tex"

# Cover letter (only if Cover_Letter/main.tex is filled in for this company/role and compiled)
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
elif [ "$CL_COMPANY" != "$COMPANY" ] || [ "$CL_ROLE" != "$ROLE" ]; then
  echo "Note: current cover letter is for '$CL_COMPANY' / '$CL_ROLE', not '$COMPANY' / '$ROLE' -- skipping cover letter copy."
elif [ "$CL_PDF" -ot "$CL_TEX" ]; then
  echo "Note: Cover_Letter/main.pdf is older than Cover_Letter/main.tex -- skipping cover letter copy."
else
  cp "$CL_PDF" "$DEST/Anupreet Cover Letter.pdf"
fi

echo "Saved $ARCHETYPE resume to:"
echo "  $DEST"

# Role-specific tweaks shouldn't leak into the next application: offer to reset
# the archetype to its last commit (the tweaked .tex is already saved in $DEST)
if ! is_tracked "$RESUME_REL/$ARCHETYPE.tex"; then
  echo "Note: $RESUME_REL/$ARCHETYPE.tex isn't committed yet -- commit it so future tweaks can be reset after saving."
elif ! git -C "$PROJECT_ROOT" diff --quiet HEAD -- "$RESUME_REL/$ARCHETYPE.tex"; then
  echo "$ARCHETYPE.tex has uncommitted edits (a copy was saved with the PDF)."

  while true; do
    read -r -p "[r]eset $ARCHETYPE.tex to its last commit or [k]eep the edits? " reset_choice

    case "$reset_choice" in
      r|R|reset|Reset)
        # Restore the .tex before the .pdf so the PDF isn't flagged as stale next time
        git -C "$PROJECT_ROOT" checkout HEAD -- "$RESUME_REL/$ARCHETYPE.tex"
        if is_tracked "$RESUME_REL/$ARCHETYPE.pdf"; then
          git -C "$PROJECT_ROOT" checkout HEAD -- "$RESUME_REL/$ARCHETYPE.pdf"
        else
          echo "Recompile $ARCHETYPE.tex -- $ARCHETYPE.pdf still shows the tweaked version."
        fi
        break
        ;;
      k|K|keep|Keep)
        break
        ;;
      *)
        echo "Please enter 'r' to reset or 'k' to keep."
        ;;
    esac
  done
fi
