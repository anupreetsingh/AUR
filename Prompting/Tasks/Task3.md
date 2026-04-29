# Task 3

Using `Prompting/Context/JD.txt` and the updated `resume/main.tex` from Task 1, regenerate `Prompting/Artifacts/JD_Outreach.txt` by resetting the template and filling all bracket placeholders.

## Global Constraints (MANDATORY)

- Treat the current `resume/main.tex` as the Task 1 output and the only resume source of truth for this task.
- Do NOT pull wording from `resume/starter.tex`, older resume versions, or any pre-Task-1 baseline.
- `Prompting/Context/JD_Outreach_Templates.txt` is the immutable source of truth. Do NOT modify it under any circumstances.
- All edits happen ONLY in `Prompting/Artifacts/JD_Outreach.txt`.
- Only replace text inside square brackets (for example: `[Name]`, `[role]`, `[company/location phrase]`, `[work specifics based on role]`, `[why company and fit]`).
- Do NOT change any other wording, punctuation, structure, or formatting in `Prompting/Artifacts/JD_Outreach.txt`.
- `[Name]` must remain `[Name]` in every section.
- Work sequentially. At each step, only use `Prompting/Context/JD.txt`, the current contents of `resume/main.tex`, the current contents of `Prompting/Artifacts/JD_Outreach.txt`, and that step's rules.
- Each placeholder type must use the same filled value everywhere it appears.
- Prefer wording that reflects the exact JD alignment already established in Task 1 rather than generic resume-summary language.

### Resume Source Priority

When filling placeholders, prefer resume evidence in this order:

1. Newly written or materially updated Task 1 content that directly matches the JD.
2. Reordered skills/coursework content from Task 1 Step 1.
3. Minor paraphrases introduced in Task 1 Step 2.
4. Other unchanged but still JD-relevant content in `resume/main.tex`.

## Step 0: Reset `JD_Outreach.txt` to a clean baseline

**Scope:** `Prompting/Artifacts/JD_Outreach.txt`

- Overwrite `Prompting/Artifacts/JD_Outreach.txt` with the full contents of `Prompting/Context/JD_Outreach_Templates.txt`.
- Do NOT modify `Prompting/Context/JD_Outreach_Templates.txt` at any point.
- After the overwrite, treat the new contents of `Prompting/Artifacts/JD_Outreach.txt` as the working file for Step 1.

## Step 1: Fill bracket placeholders

**Scope:** `Prompting/Artifacts/JD_Outreach.txt`

- Replace every bracket placeholder across all sections (Talent/HR, Employee, Hiring Manager, Why This Company / Why Me) using the rules below.
- Reuse the same filled value for each repeated placeholder type across all sections.

### Bracket Fill Rules

#### `[role]`

- Use the exact job title from the JD.

#### `[company/location phrase]`

- If the JD clearly identifies the employer and location, fill this as: `at [Company] in [Location]`
- If the JD clearly identifies the employer but not the location, fill this as: `at [Company]`
- If the employer is undisclosed but the location is known, fill this as: `in [Location]`
- If both employer and location are unavailable, fill this as: `with your company`

#### `[work specifics based on role]`

- Write a short phrase under 20 words summarizing the most relevant work from the Task 1 version of `resume/main.tex`.
- Pull from the updated skills section and the most JD-relevant experience bullets.
- If Task 1 introduced a strong JD-specific PMA story, prefer distilling that story first.
- Do NOT copy resume bullets verbatim. Convert them into a natural, conversational phrase.

#### `[why company and fit]`

- Write one specific statement under 40 words.
- The statement must create a clear bridge: the company or role problem in the JD plus the concrete way the Task 1 resume shows you can help.
- Prefer day-to-day role problems, product details, users, workflows, or impact from the JD over generic mission language.
- Prefer resume evidence that was strengthened in Task 1, especially reordered skills and any newly crafted JD-aligned bullets.
- Do NOT copy JD or resume lines verbatim. Distill them into a concise, natural statement.
- If the employer is undisclosed, reference the role, mission, or problem space instead of naming the company.
- Avoid generic fit lines unless they also name a concrete problem and a resume-backed contribution.

#### `[Name]`

- Do NOT fill. Leave as `[Name]` in every section.
