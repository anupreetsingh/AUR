# Task 5

Using `Prompting/Context/SD.txt` and the updated `resume/main.tex` from Task 4, regenerate `Prompting/Artifacts/SD_Outreach.txt` by resetting the template and filling all bracket placeholders. The audience is a founder or founding member of an early-stage startup.

## Global Constraints (MANDATORY)

- Treat the current `resume/main.tex` as the Task 4 output and the only resume source of truth for this task.
- Do NOT pull wording from `resume/starter.tex`, older resume versions, or any pre-Task-4 baseline.
- `Prompting/Context/SD_Outreach_Templates.txt` is the immutable source of truth. Do NOT modify it under any circumstances.
- All edits happen ONLY in `Prompting/Artifacts/SD_Outreach.txt`.
- Only replace text inside square brackets (for example: `[Hook]`, `[Name]`, `[Company Name]`, `[Product Hook]`, `[Opportunity Phrase]`, `[Work Pitch]`).
- Do NOT change any other wording, punctuation, structure, or formatting in `Prompting/Artifacts/SD_Outreach.txt`.
- `[Name]` must remain `[Name]` in every section.
- Work sequentially. At each step, only use `Prompting/Context/SD.txt`, the current contents of `resume/main.tex`, the current contents of `Prompting/Artifacts/SD_Outreach.txt`, and that step's rules.
- Each placeholder type must use the same filled value everywhere it appears.
- Since there is no JD, infer all company-relevant content from `Prompting/Context/SD.txt`: what the company builds, the domain it operates in, the market it serves, and the problems it solves.
- Prefer wording that sounds concrete and founder-relevant rather than generic recruiting language.

### Resume Source Priority

When filling placeholders, prefer resume evidence in this order:

1. The single most SD-aligned verifiable industry or project bullet in the Task 4 version of `resume/main.tex`.
2. Reordered skills/coursework content from Task 4 Step 1.
3. Minor paraphrases introduced in Task 4 Step 2.
4. Newly written PMA story content from Task 4 Step 3, but only if it creates clearly better SD overlap without sounding less credible than an existing verifiable bullet.

## Step 0: Reset `SD_Outreach.txt` to a clean baseline

**Scope:** `Prompting/Artifacts/SD_Outreach.txt`

- Overwrite `Prompting/Artifacts/SD_Outreach.txt` with the full contents of `Prompting/Context/SD_Outreach_Templates.txt`.
- Do NOT modify `Prompting/Context/SD_Outreach_Templates.txt` at any point.
- After the overwrite, treat the new contents of `Prompting/Artifacts/SD_Outreach.txt` as the working file for Step 1.

## Step 1: Fill bracket placeholders

**Scope:** `Prompting/Artifacts/SD_Outreach.txt`

- Replace every bracket placeholder in the founder/founding engineer outreach template using the rules below.
- Reuse the same filled value for each repeated placeholder type across the full file.

### Bracket Fill Rules

#### `[Hook]`

- Use a subject line with at most 8 words.
- Distill the company's core value proposition from `Prompting/Context/SD.txt` into a single intriguing phrase that signals you understand the product.
- Avoid generic phrases like `Quick Question` or `Reaching out`.

#### `[Name]`

- Do NOT fill. Leave as `[Name]`.

#### `[Company Name]`

- Extract the exact company name from `Prompting/Context/SD.txt`.
- Reuse the exact same value everywhere it appears.

#### `[Product Hook]`

- Write a noun phrase, not a sentence, that completes `...building with [Product Hook]`.
- Pull the central product mechanic from `Prompting/Context/SD.txt` using the company's own nouns and verbs where possible.
- Keep it plain-language and low-jargon.
- Maximum 12 words.

#### `[Opportunity Phrase]`

- Write a short phrase describing the opportunity you are interested in.
- If the SD or user context explicitly names a role, fill this as `the [Role] role`.
- If no explicit role exists, use a natural alternative such as `working with the team` or `the engineering work at [Company Name]`.
- Keep it concise and founder-appropriate.

#### `[Work Pitch]`

- Write a concise phrase that completes `I've worked on [Work Pitch].`
- Source it from the single most SD-aligned work in the Task 4 version of `resume/main.tex`.
- Prefer concrete systems or workflow language over generic skill lists.
- Do NOT copy resume bullets verbatim. Distill them into natural, plain-language phrasing.
- The phrase should sound credible in the sentence `I've worked on [Work Pitch].`
