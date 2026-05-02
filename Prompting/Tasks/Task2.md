# Task 2

## Step 0: Reset main.tex to a clean baseline (FIRST ACTION)
Before reading any file other than this Task2.md:
- Run exactly: `cp Cover_Letter/starter.tex Cover_Letter/main.tex`
- Do NOT read or modify `Cover_Letter/starter.tex` directly at any point — `cp` copies it without exposing its contents to you.
- After the overwrite, treat the new contents of `Cover_Letter/main.tex` as the current state for all later steps.


## Inputs

- Read `Cover_Letter/main.tex`, `resume/main.tex` (the Task 1 final state), and `Prompting/Context/JD.txt` after step 0's cp completes.
- Use the details in `Prompting/Context/JD.txt` and `resume/main.tex` to update `Cover_Letter/main.tex`.
- Do not read any other file.
- If this task requires running a script or compile command, you may execute the explicitly allowed commands and inspect their output, but do not inspect their source code.




## Global Constraints (MANDATORY)

- Do NOT modify any LaTeX structure or commands (for example: `\documentclass`, `\usepackage`, `\newcommand`, spacing, or formatting).
- Only change plain-text content inside existing command values or body paragraphs.
- Only modify the content explicitly included in the current step's scope.
- Use only details that are directly supported by `Prompting/Context/JD.txt` and `resume/main.tex`. 
- The cover letter must read as one coherent argument, not as a prose version of the resume.
- If at any point you encounter a non-zero exit code,stop and ask the human. Do not improvise around failures.
- Do not bother runnig any shell commands not mentioned here.
- Every editable area should be within its character budget.


### Max character budget per editable area. Locate each via its `% Area:` anchor in `main.tex`.

| Area              | Budget |
| ----------------- | -----: |
| companyName       |     60 |
| companyTeam       |     60 |
| roleTitle         |     80 |
| companyCity       |     60 |
| body.p1           |    400 |
| body.p2           |   1050 |
| body.p3           |    900 |

> **Budgets count rendered text only, excluding LaTeX markup.** Commands like `\textbf{}`, `\\`, `\vspace{}`, and `\roleTitle{}` do not count toward the budget — but the text they expand to (e.g. the actual role title) and the spaces inside the rendered output do.


## Style Rules

- No em dashes (`---` or `—`) in body paragraphs. Use commas, parentheses, or two short sentences.
- Do NOT open `body.p1` with a generic company-mission summary line ("X's Engineering org is integrating AI/ML into products that connect millions...", "X is committed to..."). Lead with role-specific or applicant-specific framing instead.
- Keep the tone direct, specific, and natural. Do not overstate enthusiasm or invent claims not supported by the resume.


## Step 1: Update Company / Role Variables

**Scope:** `\companyName`, `\companyTeam`, `\roleTitle`, `\companyCity`. 

- Fill each variable using the JD.
- Use the exact company name and exact role title from the JD when they are clearly stated.
- Use the exact team, product group, or division name if the JD clearly provides one. Otherwise use a clean generic value that fits the existing template (e.g. `Engineering` when the JD names an Engineering org without a specific team; `Hiring Team` as a fallback). Avoid duplicating "Hiring Team" in both the addressee block and `\companyTeam`.
- Use the clearest location string supported by the JD for `\companyCity`. If the JD lists multiple cities, default to the first listed or the city the user is targeting.


## Step 2: Write the Opening (body.p1)

**Scope:** `body.p1`. 
**Goal:** Explain why the applicant is applying to this role by mapping JD responsibilities to applicant fit.

- Identify 2–3 concrete responsibilities from the JD's day-to-day work sections (e.g. "What You'll Do", "Typical Day", "Responsibilities", "Expertise"), not company mission lines. These are the hooks.
- For each hook, name the applicant experience (internship, graduate project, academic role) that maps to it. Keep the mapping framing-level: name the experience, not its tools, frameworks, or quantified outcomes. Those belong in `body.p2`.
- Start by stating the (`\roleTitle{}`) once
- 2–4 short sentences total.
- Do NOT begin with a generic company-mission summary. Lead with what about the role's responsibilities drew the applicant in.


## Step 3: Justify with Ranked Work Evidence (body.p2)

**Scope:** `body.p2`. 
**Goal:** Justify the fit by discussing work from `resume/main.tex` ranked by relevance to the role description in `Prompting/Context/JD.txt`.

- Build the candidate set from all work entries in current state of `resume/main.tex`: Industry Experience (Platinum, PMA, Turfco), Academic Experience (Graduate Assistant, Teaching Assistant), and Projects.
- Score each candidate by JD overlap (shared technologies, problem space, product surface, users, scale, role-level expectations). Most recent breaks ties.
- Discuss the top 2–4 candidates in descending rank order. Lead with the strongest fit.
- For each item: name the concrete stack/tool, the work done, and a defensible quantified outcome when the resume supports one. Keep numbers modest and interview-defensible.
- Do NOT force a fixed split (e.g. AI/ML half vs. production half). If the JD is AI-heavy, lean AI; if production-heavy, lean production. Drop low-rank items rather than padding.
- Defensibility rule: do NOT swap a resume stack for a JD-named stack the resume does not back up (e.g. Ruby/Rails, Swift, Kotlin). Use the closest defensible stack the resume actually carries; surface unsupported stacks only at the skills level.
- Use 3–4 high-priority JD keywords from `resume/main.tex` not already introduced in `body.p1`.
- Do NOT recap every resume bullet. Each named item must do real argumentative work for the JD fit.



## Step 4: Write the Closing (body.p3)

**Scope:** `body.p3`. **Goal:** Cover JD soft/culture signals and logistics, show applicant fit on each, and close with how the applicant would like to hear back.

- Identify 2–3 Soft/Culture signals or logistics from the JD: collaboration values, ownership, learning posture, on-call/incident response, code-review and testing culture, mentorship/teaching, location/relocation/remote stance, work authorization, start date or timeline, compensation transparency, interview process notes.
- For each, write a single concise clause about how it suits the applicant. Pull supporting fit from `resume/main.tex` only when the resume actually backs it (e.g. GA's code reviews and Agile/Scrum work for a JD review-culture signal; TA office-hours mentorship for a JD onboarding/mentorship signal; campus location for a JD city/relocation signal).
- Do NOT fabricate logistical claims (e.g. visa status, relocation willingness, start date) that the JD does not name AND the user has not supplied. If a JD logistic has no defensible signal on either side, skip it.
- Close with a forward-looking sentence stating how the applicant would like to hear back: a conversation with the team, the next interview step, or a specific time-bound follow-up. Direct, without overstating enthusiasm.
- Do NOT turn the closing into a stack inventory or a recap of resume bullets.
