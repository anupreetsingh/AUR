# Task 2

Using the details in `Prompting/Context/JD.txt` and the updated `resume/main.tex` from Task 1, update `Cover_Letter/main.tex`.

## Global Constraints (MANDATORY)

- Do NOT modify any LaTeX structure or commands (for example: `\documentclass`, `\usepackage`, spacing, or formatting).
- Only change plain-text content inside existing command values or body paragraphs.
- Consider steps sequentially and at each step, only use: the JD, the current contents of `resume/main.tex`, the current contents of `Cover_Letter/main.tex`, and that step's rules.
- Only modify the content explicitly included in the current step's scope.
- Use only details that are directly supported by `Prompting/Context/JD.txt` and the Task 1 version of `resume/main.tex`.
- The cover letter must read as one coherent argument, not as a prose version of the resume.
- Each body paragraph must have a distinct job: `body.p1` = company/role hook, `body.p2` = strongest proof, `body.p3` = fit + close.

### Resume Source Priority

When writing the cover letter, evaluate the **final state** of `resume/main.tex` as a whole against `Prompting/Context/JD.txt` and pick the evidence that best matches the JD. Do NOT privilege content simply because it was newly written or edited in Task 1; pre-existing roles, projects, and coursework are eligible on equal footing.

Ranking when choosing what to cite:

1. Strongest JD overlap, regardless of which section (industry experience, academic experience, projects, or skills/coursework) it lives in. "Overlap" means shared technologies, problem space, product surface, users, or scale.
2. Among items with comparable overlap, prefer the most recent experience.
3. If the JD emphasizes a domain the resume covers obliquely (e.g. payments, real-time systems, marketplace flows, ML/AI, security/compliance), pull from any role or project that touches that domain --- including older work or class projects --- rather than forcing in the most recent role.
4. For the closing, draw on skills/coursework only when a specific item materially strengthens the fit. Rotate which 2--3 items you cite based on the JD's primary axis (scale/data, product breadth, ML/AI, frontend craft, security, etc.) instead of defaulting to the same triplet across applications.

## Step 0: Reset main.tex to a clean baseline

**Scope:** `Cover_Letter/main.tex`

- Overwrite `Cover_Letter/main.tex` with the full contents of `Cover_Letter/starter.tex`.
- Do NOT modify `Cover_Letter/starter.tex` at any point. It is the baseline source of truth.
- After the overwrite, treat the new contents of `Cover_Letter/main.tex` as the current state for all later steps.

## Step 1: Update Company / Role Variables

**Scope:** `vars.companyName`, `vars.companyTeam`, `vars.roleTitle`, `vars.companyCity`, and `vars.salutation`

- Fill `\companyName`, `\companyTeam`, `\roleTitle`, `\companyCity`, and `\salutation` using the JD.
- Use the exact company name and exact role title from the JD when they are clearly stated.
- Use the exact team, product group, or division name if the JD clearly provides one. Otherwise use a clean generic value that fits the existing template, such as `Hiring Team`.
- Use the clearest location string supported by the JD for `\companyCity`.
- Leave `\letterDate` as `\today` unless the user explicitly asks for a fixed date.
- Keep `\salutation` natural and conservative. Default to `Dear \companyName{} Hiring Team,` unless the JD clearly supports a more specific team-facing salutation.

## Step 2: Write the Opening

**Scope:** `body.p1`

- Replace the starter placeholder text in the first body paragraph.
- State the exact role and reference the team, product, users, or engineering problem the JD emphasizes.
- Lead with a concrete company/problem hook, not generic mission language.
- Explain in one clear sentence why that work aligns with the kind of engineering problems you most want to solve.
- Keep the tone direct, specific, and natural. Do not overstate enthusiasm or invent claims not supported by the resume.

## Step 3: Craft the Evidence Story

**Scope:** `body.p2`

- Use 3–4 high-priority JD keywords that were added in Task 1 and not already introduced in Step 2.
- Replace the starter placeholder text in the second body paragraph with the strongest evidence paragraph from the updated `resume/main.tex`.
- Lead with the single most recent or most relevant experience.
- Name the technologies, responsibilities, and outcomes that mirror the JD.
- Include defensible quantified outcomes when available.
- Build the paragraph around one primary proof story. If a second experience adds a distinct signal, include it only as a brief supporting clause rather than a second full story.
- Do NOT turn this paragraph into a keyword list or a recap of multiple unrelated resume bullets.
- Keep the paragraph focused on transferable engineering work that directly supports the target role.

## Step 4: Write the Closing

**Scope:** `body.p3`

- Replace the starter placeholder text in the third body paragraph.
- Write a tight closing paragraph that explains why your background fits the team's work and how you would contribute.
- Reference coursework, projects, or tools only when they strengthen that fit directly. Do NOT turn the closing into a stack inventory.
- Close with a forward-looking sentence about contributing to the team, collaborating cross-functionally, or shipping well-tested software in the role.
- Keep the paragraph concise, confident, and specific.
