# Notes

## Copy PDF into Tentative/

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

## Compiling PDFs

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

## Resume `main.tex` Structure

Each `\section` has a `SectionList` that keeps heading items (`\DLSubheadingItem`, `\SLSubheadingItemFF`, `\SLSubheadingItemTF`, `\SLSubheadingItemLink`) and `\BulletPoints` at the same level. Every `SectionList` item ends with a `\vspace{-7pt}` in its macro definition that pulls the item below it upwards.

Inside `\BulletPoints` is another itemize environment that renders each `\item` in the argument as a dashed bullet.

## AMI(Action + Method + Impact) framework

```text
Accomplished X by doing Y, resulting in Z
```

Start with a strong action verb, explain the specific method or tool, then close with the result.

```text
[Action verb] [what you did] by [Method/Tool/Approach], resulting in [measurable or observable impact].
```

Examples:

```text
Built a customer analytics dashboard by integrating Stripe and PostgreSQL data, reducing weekly reporting time by 6 hours.

Improved API response time by adding Redis caching and optimizing database indexes, cutting average latency from 800ms to 220ms.

Automated deployment workflows by creating GitHub Actions pipelines, reducing manual release steps and preventing configuration drift.

Increased onboarding completion by redesigning the signup flow and adding progress indicators, improving conversion from 62% to 78%.

Reduced production errors by adding validation and structured logging, helping engineers identify root causes faster.
```

### Reusable Templates

```text
Improved [metric/process/system] by [specific technical action], resulting in [business/user/team impact].

Reduced [problem/cost/time/errors] by [method], saving [time/money/effort] or improving [metric].

Built [feature/system/tool] using [technology/approach], enabling [users/team/business] to [benefit].

Automated [manual workflow] by [implementation], reducing [manual work/errors/delay].

Increased [desired outcome] by [change made], improving [metric/result].
```
