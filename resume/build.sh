#!/bin/bash

# Navigate to the directory of the script
cd "$(dirname "$0")"

# Build the named archetypes (e.g. `build.sh Java Master`), or every <Name>/<Name>.tex folder if none are given
if [ $# -gt 0 ]; then
  names=("$@")
else
  names=()
  for dir in */; do
    names+=("${dir%/}")
  done
fi

for name in "${names[@]}"; do
  if [ ! -f "$name/$name.tex" ]; then
    echo "Skipping $name: $name/$name.tex not found"
    continue
  fi
  # Clean and compile from scratch, then open the generated PDF
  (cd "$name" && latexmk -C "$name.tex" && latexmk -pdf -synctex=1 -interaction=nonstopmode "$name.tex")
  open "$name/$name.pdf"
done
