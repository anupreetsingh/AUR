# Notes

## Resume Workflow

- `resume/Master/Master.tex` — the full 2-page resume with every bullet. Improve bullets here first, then copy the change into the archetypes that use that bullet.
- `resume/<Archetype>/<Archetype>.tex` — a 1-page cut for a role type (e.g. `Java/Java.tex`). Folder and file names must match. The committed version is the clean baseline.
- New archetype: copy an existing folder and rename both. Old tagged versions make good starting points: `git show AI_Developer:resume/main.tex > resume/AI/AI.tex`.
- Per application: commit any real improvements first, then make role-specific tweaks (e.g. bold DynamoDB), recompile, and save from the repo root:

```bash
./scripts/final_move.sh Java "Google" "Software Engineer II, Site Reliability"
```

This copies the PDF and the tweaked `.tex` (plus the cover letter, if it matches the company/role) into `Tentative/<Company>-<Role>/`. It refuses a PDF older than its `.tex` and asks before saving one longer than 1 page. It then offers to reset the archetype to its last commit, so the tweak doesn't leak into the next application.

## Compiling PDFs

Dependency: the `cm-super` fonts must be installed, or the PDFs silently compile with bitmap fonts that break copy-paste (dropped `fi` ligatures and dashes) and lose the bold small-caps name header:

```bash
tlmgr init-usertree
tlmgr --usermode install cm-super
```

If a PDF is not generated after saving a `.tex` file, first delete the generated add-on files and save the `.tex` file again.

If the PDF is still not generated, rebuild it from scratch with the relevant build script.

Run the relevant command from the repo root.

Resume (all archetypes, or only the ones named):

```bash
./resume/build.sh
./resume/build.sh Java Master
```

Cover letter (`main.tex` and `starter.tex`):

```bash
./Cover_Letter/build.sh
```

Each script cleans and rebuilds from scratch, then opens the generated PDFs.

## Resume `.tex` Structure

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

### Bolding

When deciding what to bold for each sentence, think of the recruiter screening your resume and for each bullet they are able to see "Built **X**, moved **Y**":

- **X** — the feature, system, or project name.
- **Y** — the measurable metric.

Examples:

```text
Built a customer analytics dashboard by integrating Stripe and PostgreSQL data, reducing weekly reporting time by 6 hours.

Improved API response time by adding Redis caching and optimizing database indexes, cutting average latency from 800ms to 220ms.

Automated deployment workflows by creating GitHub Actions pipelines, reducing manual release steps and preventing configuration drift.

Increased onboarding completion by redesigning the signup flow and adding progress indicators, improving conversion from 62% to 78%.

Reduced production errors by adding validation and structured logging, helping engineers identify root causes faster.
```

**Reusable Templates:**

```text
Improved [metric/process/system] by [specific technical action], resulting in [business/user/team impact].

Reduced [problem/cost/time/errors] by [method], saving [time/money/effort] or improving [metric].

Built [feature/system/tool] using [technology/approach], enabling [users/team/business] to [benefit].

Automated [manual workflow] by [implementation], reducing [manual work/errors/delay].

Increased [desired outcome] by [change made], improving [metric/result].
```
