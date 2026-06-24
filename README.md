# Notes

## Final Move Script

Edit the company and role values for each application, then run the command from the repo root:

```bash
./scripts/final_move.sh "Google" "Software Engineer II, Site Reliability"
```

## Template Tags

Mark a template commit with a normal lightweight tag:

```bash
git tag <tag-name> <commit-to-tag>
```

Move a normal tag to a new commit:

```bash
git tag -f <tag-name> <new-commit>
```

Mark a new template with an annotated tag:

```bash
git tag -a <tag-name> -m "<message-for-the-tag>" <commit-to-tag>
```

Move an annotated tag to a new commit:

```bash
git tag -fa <tag-name> -m "<new-message>" <new-commit>
```

If you want to reuse the existing annotated tag message, skip the `-m "<new-message>"` part.

## Building PDFs

If a PDF is not generated after saving a `.tex` file, first delete the generated add-on files and save the `.tex` file again.

If the PDF is still not generated, rebuild it from scratch with the relevant build script.

Run the relevant command from the repo root.

Resume:

```bash
bash resume/build.sh
```

Cover letter:

```bash
bash Cover_Letter/build.sh
```

Each script cleans and rebuilds both `main.tex` and `starter.tex`, then opens the generated PDFs.
