#!/bin/bash

if [ $# -ne 2 ]; then
  echo "Usage: ./final_move.sh <Company> <Role>"
  exit 1
fi

DEST="/Users/manpreetsingh/Documents/Job Hunt/Resume/Tentative/$1-$2"
mkdir -p "$DEST"
cp "$(dirname "$0")/main.pdf" "$DEST/Anupreet Resume.pdf"

# Edit this line for every company and role and paste it in terminal: 
# ./resume/final_move.sh "Google" "Software Engineer II, Site Reliability"
