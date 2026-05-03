# Task 1

## Step 0: Reset main.tex to a clean baseline (FIRST ACTION)
Before reading any file other than this Task1.md:
- Run exactly: `cp resume/starter.tex resume/main.tex`
- Do NOT read or modify `resume/starter.tex` directly at any point — `cp` copies it without exposing its contents to you.
- After the overwrite, treat the new contents of `resume/main.tex` as the current state for all later steps.


## Inputs

- Read `resume/main.tex` and `Prompting/Context/JD.txt` after step 0's cp completes.
- Use the details in `Prompting/Context/JD.txt` to update `resume/main.tex`.
- Do not read any other file.
- If this task requires running a script, you may execute it and inspect its output, but do not inspect its source code.


## Global Constraints (MANDATORY)

- Do NOT modify any LaTeX structure or commands (for example: `\section`, `\subsection`, `\textbf`, spacing, or formatting).
- Only change plain-text content inside existing lines or bullet points.
- Don't form the plan all at once. Consider steps sequentially and only be concerned about the current step.
- Only modify the content explicitly included in the current step's scope.
- Assume `resume/main.pdf` must remain one page.
- If at any point you encounter a non-zero exit code, a compile check failure that the per-step recovery rule does not resolve, a missing file, an ambiguous instruction, or a situation that would require guessing — stop and ask the human. Do not improvise around failures.
- Do not run any shell command other than the 3 explicitly allowed in step 0 and compile check section. No `git`, `ls`, `cat`, `pdflatex`, `wc`, `find`, etc. If a different command seems necessary, stop and ask the human with context on why you want to run it.


### Max character budget per editable area

| Area              | Budget |
| ----------------- | -----: |
| skills.languages  |     90 |
| skills.tools      |    190 |
| skills.coursework |    200 |
| skills.cert       |     90 |
| platinum.b1       |    220 |
| platinum.b2       |    220 |
| PMA.b1            |    220 |
| PMA.b2            |    110 |
| Turfco.b          |    110 |
| ga.b1             |    220 |
| ga.b2             |    115 |
| ta.b1             |    110 |

> **Budgets count rendered text only, excluding LaTeX markup.** Commands like `\textbf{}`, `\\`, and `\vspace{}` do not count toward the budget — but the bold label text and the spaces inside the rendered output do. For example, in `\textbf{Programming Languages}{: Python, C/C++, ...}`, the characters that count are `Programming Languages: Python, C/C++, ...`.

## Step 1: Update Skills & Relevant Coursework

**Scope:** `skills.languages`, `skills.tools`, `skills.coursework`, `skills.cert`. Locate each via its `% area:` anchor in `main.tex`.

Semantic note: items from the JD that are domain/topic names (e.g., "computer vision", "distributed systems") go into `skills.coursework`, not `skills.tools`.

For all 4 lists:
1. Build the candidate set:
   - Start with items already present in the list (post-Step 0).
   - Add every JD-mentioned item to the list that fits its category. Do not gate additions on whether `main.tex` already supports them.
2. Rank items by combining JD relevance and base content relevance, where "base content" = the existing `main.tex` bullets in Industry Experience, Academic Experience and Projects:
   - Tier 1 (highest): in the JD AND supported by base content.
   - Tier 2: in the JD but not supported by base content.
   - Tier 3 (lowest): in baseline but not in the JD.
   Ties within a tier may be broken arbitrarily.
3. Reorder the list left-to-right by rank, highest first.
4. If the list exceeds its character budget, drop items from the right end one at a time until it fits.

Each list MUST end at or below its character budget


## Step 2: Selective Replace/Paraphrase
**Scope:** `platinum.b2`, `Turfco.b`, `ga.b1`, `ga.b2`, `ta.b1`. Locate each via its `% area:` anchor in `main.tex`.

**Goal:** Edit the bullets in scope to surface JD vocabulary in these existing bullets to improve ATS keyword match. 

**Constraints:**
   - Process bullets in this fixed order: `platinum.b2 → Turfco.b → ga.b1 → ga.b2 → ta.b1`.
   - The "current state of `main.tex`" referenced by gates 2c and 2d is the state at the start of that bullet's edit — edits to earlier bullets do not retroactively invalidate later gates.
   - Word- or phrase-level edits from the four categories listed below; Do not rewrite bullets.
   - Do not change quantitative claims (numbers, percentages, scale).
   - If none of the 4 categories of edits fit a bullet, skip the bullet.
   - Ensure each edited bullet stays within the applicable character budget and compile rules:
        - Edits ≤ budget need no check; edits > budget+5 are forbidden.
        - If a bullet's edits land it in the [budget+1, budget+5] range, run `python3 scripts/compile_check.py`. If 'yes', keep the edits and move on. If 'no', revert that bullet's edits and move on.

For each bullet look for candidate edits in these four categories:
   a. **Verb swap** — replace a verb with the JD's verb if it has the same meaning (e.g., "built" → "architected").
   b. **Vague → JD-specific noun phrase** — replace a generic term with a JD-mentioned term when the bullet's actual work was in that domain (e.g., "data pipeline" → "ETL pipeline").
   c. **Tool surfacing** — name a tool the bullet implicitly used but didn't mention, if the JD names that tool, subject to: the surfaced tool appears somewhere in the current state of `main.tex` (any skills list post-Step 1 or another bullet). If the tool is not on the resume, skip the surfacing.
   d. **Tool substitution** — replace a tool with one the JD prefers, subject to verification of BOTH gates:
        - The substituted tool appears somewhere in the current state of `main.tex` (any skills list post-Step 1 or another bullet).
        - The bullet's described work survives the swap — the task's verbs, concepts, and quantities still make sense with the substituted tool. If they don't (e.g., "recursive CTEs" in a NoSQL swap, "NumPy vectorization" in a Go swap), do not apply.


## Step 3: Craft a Story

**Scope:** `PMA.b1` and `PMA.b2`. Locate via `% area:` anchors.

**Premise:** Assume the candidate is a strong fit for the JD. The PMA bullets should portray work that demonstrates that fit.

**Identify the strongest JD hooks (ranked):**
Score each JD item on these signals; the strongest hooks score on ≥3:
  1. Repeats across multiple JD sections (Overview, Typical Day, Expertise).
  2. Names a specific tool, technique, or system (not an abstract value).
  3. Goes beyond generic CS table-stakes for the role's level.
  4. Names the team's product domain or daily work surface.
Pick the top 2–3 hooks. These define what the project must showcase. If no JD item scores ≥3, drop the threshold to ≥2 and pick the top 2–3 by raw score. If still nothing scores ≥2, stop and ask the human — the JD is too generic to anchor a project narrative.

**Write the project:**
- Invent one cohesive intern project at PMA whose narrative directly exercises those 2–3 hooks. The project does not need to match anything PMA actually builds — it represents work the candidate could plausibly have done.
- Name 1–2 concrete tools/languages per bullet, drawn ONLY from items already present in main.tex post-Step 1 (skills.languages, skills.tools, skills.coursework). Do not introduce new tech.
- Prefer tools that are both (a) on the resume and (b) JD-aligned with the chosen hooks.
- Each bullet is outcome-led: start with a strong action verb, name the concrete work and the application layer (frontend, API, data, or infra), and end with an impact.
- `PMA.b1` (≤220 chars rendered): the headline build and its primary impact.
- `PMA.b2` (≤110 chars rendered): a secondary outcome from the same project — follow-on adoption, downstream reuse, performance, or reliability gain.
- Quantified impact preferred but not required if it would force fabrication; a credible qualitative outcome (adoption, unblocking, reuse) is acceptable. Numbers, if used, must be modest and defensible verbally in interview.


- Budget and compile enforcement:
    - Both bullets must end ≤ their character budget (PMA.b1 ≤ 220, PMA.b2 ≤ 110). A bullet > budget+5 must be rewritten before any compile check.
    - If either bullet lands in [budget+1, budget+5], run `python3 scripts/compile_check.py --final`. If 'yes', keep. If 'no', shorten b1 first then b2 until both are ≤ budget, then re-run. If still 'no', stop and ask the human.
    - If both bullets are ≤ budget, still run `python3 scripts/compile_check.py --final` once as a final gate. If 'no' stop and ask the human.

