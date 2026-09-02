#!/bin/bash

# Navigate to the directory of the script
cd "$(dirname "$0")"
# Clean and compile the main.tex and starter.tex projects from scratch
latexmk -C main.tex
latexmk -pdf -synctex=1 -interaction=nonstopmode main.tex
latexmk -C starter.tex
latexmk -pdf -synctex=1 -interaction=nonstopmode starter.tex
latexmk -C bullet-bank.tex
latexmk -pdf -synctex=1 -interaction=nonstopmode bullet-bank.tex
# Open the generated PDF
open main.pdf
open starter.pdf
open bullet-bank.pdf
