# Task 4

Using the details in `Prompting/Context/SD.txt`, update `resume/main.tex`.

## Global Constraints (MANDATORY)

- Do NOT modify any LaTeX structure or commands (for example: `\section`, `\subsection`, `\textbf`, spacing, or formatting).
- Only change plain-text content inside existing lines or bullet points.
- Consider steps sequentially and at each step, only use: the SD, the current contents of `resume/main.tex`, and that step's rules.
- Only modify the content explicitly included in the current step's scope.
- Assume `resume/main.pdf` must remain one page. Run the compile check after every step before moving to the next one.
- If the compile check fails, revise only the edits made in that step until it passes again.
- If an area exceeds its budget by 5 characters or fewer and the added text clearly improves value, trigger an immediate compile check and allow it if the compile check still passes.
- Since there is no JD, infer company-relevant technologies, engineering responsibilities, and keywords from what the company builds, the domain it operates in, and the problems it solves as described in `Prompting/Context/SD.txt`.

### Max character budget per editable area

| Area              | Budget |
| ----------------- | -----: |
| skills.languages  |     90 |
| skills.tools      |    180 |
| skills.coursework |    180 |
| skills.cert       |     90 |
| platinum.b2       |    220 |
| PMA.b1            |    220 |
| PMA.b2            |    110 |
| Turfco.b          |    110 |
| ga.b1             |    220 |
| ga.b2             |    110 |
| ta.b1             |    110 |

> **Budgets count rendered text only, excluding LaTeX markup.** Commands like `\textbf{}`, `\\`, and `\vspace{}` do not count toward the budget — but the bold label text and the spaces inside the rendered output do.

### Compile check

- After Step 0, 1 and 2: run `python3 scripts/compile_check.py` (verifies the resume still fits on one page assuming PMA bullets are maxed at their budgets for Step 3. The CLI prints only `yes` or `no`; `yes` means pass and `no` means fail).
- After Step 3: run `python3 scripts/compile_check.py --final` (compiles `resume/main.tex` as-is, with the actual Step 3 PMA bullet text, and verifies the final resume is one page. The CLI prints only `yes` or `no`; `yes` means pass and `no` means fail).

## Step 0: Reset main.tex to a clean baseline

**Scope:** `resume/main.tex`

- Overwrite `resume/main.tex` with the full contents of `resume/starter.tex`.
- Do NOT modify `resume/starter.tex` at any point. It is the baseline source of truth.
- After the overwrite, treat the new contents of `resume/main.tex` as the current state for all later steps.

## Step 1: Update Skills & Relevant Coursework

**Scope:** `\section{SKILLS / RELEVANT COURSEWORK}`

- Infer the programming languages, frameworks, tools, and domain keywords the company likely uses based on `Prompting/Context/SD.txt`.
- Add complementary tools or frameworks that naturally pair with the inferred technologies.
- Move the most company-relevant items to the front of each list.
- If any list exceeds its character budget, remove the least relevant items from the end of that list.

## Step 2: Selective Replace/Paraphrase

**Scope:** `platinum.b2`, `turfco.b`, `ga.b1`, `ga.b2`, and `ta.b1`

- Review `platinum.b2`, `turfco.b`, `ga.b1`, `ga.b2`, and `ta.b1`.
- If slight wording changes or replacements would meaningfully improve alignment with the company described in `Prompting/Context/SD.txt`, make them.
- Prioritize unique company-relevant keywords, workflows, or product/problem-space language that are not already captured well in Step 1.
- If the company is developer/product oriented, `turfco.b` is usually the strongest place to introduce software/product keywords.
- If the company is AI, data, infrastructure, or cybersecurity oriented, `platinum.b2` is usually the strongest place to introduce technical workflow or systems keywords.
- Use `ga.b1`, `ga.b2`, and `ta.b1` only if slight paraphrases add clear company relevance without sounding forced.
- Keep the edits minor and natural. If the change does not add real company value, leave the content unchanged.

## Step 3: Craft a Story

**Scope:** `PMA.b1` and `PMA.b2`

- Use 3–4 high-priority company-relevant keywords that were added in Step 1 and not already introduced in Step 2.
- Write 2 brand-new PMA bullets for the AI Engineer Intern role that describe a plausible, production-grade, end-to-end workflow handled by the intern.
- Use engineering patterns that transfer directly to the target company's work as inferred from `Prompting/Context/SD.txt` (for example: workflow automation, NLP pipelines, backend/API integration, data or system orchestration, and production deployment).
- Write each bullet in STAR style: `[Situation/Task in <=10 words] + [Action with specific technologies inferred from the SD] + [Quantified result or production impact]`.
- Each bullet must include at least 2 tools or technologies that are plausibly part of the company's stack.
- Prefer responsibilities that sound like core engineering work for the company, such as building and deploying software, shipping production-ready code, integrating systems, or working cross-functionally.
- If you include performance numbers, keep them modest and easy to justify verbally in a future interview.
- `PMA.b1` is the primary bullet and should carry the main story.
- `PMA.b2` is the supporting bullet.
