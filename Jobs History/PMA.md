# PMA — Assignment Review Platform (Product Manager Accelerator)

A Django + React web app where PM trainees submit PRD drafts assignments, an AI agent flags common mistakes against a coaching rubric, and coaches use the aggregated flags to plan sessions faster.

---

## 1. High-level flow (start → end)

```
Trainee (browser)
   │  submits assignment (text / doc upload)
   ▼
React SPA  ──HTTPS/JSON──▶  Django REST API (on AWS)
   │                             │
   │                             ├─ 1. persist submission ──▶ DynamoDB (+ S3 for file bodies)
   │                             └─ 2. enqueue analysis job ─▶ SQS queue
   │                                                             │
   │                                                             ▼
   │                                                    AI Agent (Lambda, SQS-triggered)
   │                                                    ├─ pulls rubric for that assignment
   │                                                    ├─ calls LLM with rubric-grounded prompt
   │                                                    └─ writes structured flags ──▶ DynamoDB
   │                                                             │
   ▼                                                             ▼
Coach dashboard (React) ◀──── aggregated flags per cohort ◀── Django API
```

One sentence version: a submission enters through the React SPA, Django persists it and hands it to an async AI worker, the worker scores it against the rubric and writes back structured "mistake flags," and the coach dashboard rolls those flags up per cohort so the coach walks into a session already knowing what to teach.

### Request lifecycle

1. **Resolve and load the application.** The browser resolves the site's domain through DNS. Route 53 may serve as both the domain registrar and the authoritative DNS provider, but it does not handle or forward the HTTP request; it returns the address associated with the CloudFront distribution. The browser then establishes an HTTPS connection to CloudFront.
2. **Serve the React SPA.** CloudFront returns cached copies of the application's static HTML, JavaScript, and CSS. On a cache miss, it retrieves those assets from the S3 origin, caches them, and returns them to the browser. The React application then runs entirely in the user's browser; CloudFront and S3 only deliver its static assets.
3. **Accept a submission.** When a trainee submits a PDF, React sends an API request through CloudFront to API Gateway, which invokes the Lambda function hosting the Django API.
4. **Persist and enqueue.** Django stores the PDF in S3, records its metadata and initial status in DynamoDB, and publishes an analysis job to SQS. It then immediately returns a successful response, allowing the UI to confirm the submission without waiting for the LLM analysis.
5. **Analyze asynchronously.** SQS triggers a separate AI-worker Lambda. The worker retrieves the PDF and its assignment rubric, calls the hosted LLM with rubric-grounded instructions, validates the resulting mistake flags, and writes the structured flags and updated status to DynamoDB.
6. **Retrieve and review the results.** The worker never communicates directly with React. The frontend later requests the submission's status and results from the Django API, which reads them from DynamoDB. Coaches can then review each AI-suggested flag and either confirm or dismiss it.

Two things matter about this shape:

1. **The AI analysis is asynchronous.** The trainee gets an instant "submitted ✓" — they never wait on an LLM call (which can take 10–30s or fail). The flags appear when ready.
2. **The system's real customer is the coach, not the trainee.** The per-submission flags are an intermediate product; the deliverable is the *cohort-level aggregation* ("11 of 15 trainees confused outputs with outcomes in Assignment 3") that lets a coach plan a session around actual gaps instead of re-reading every submission.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Cohort** | One run of the accelerator program (e.g., "Spring 2025"). ~15–40 trainees, fixed set of assignments, one or more coaches. |
| **Assignment** | A prompt trainees respond to (e.g., "Write a PRD for feature X"), paired with a **rubric**. |
| **Rubric** | Coach-authored list of criteria + known common mistakes (e.g., "no success metric," "solution stated before problem"). This is what grounds the AI — the agent checks against it rather than free-form "grading." |
| **Submission** | One trainee's response to one assignment. |
| **Flag** | One structured finding on a submission: `{mistake_category, severity, excerpt, explanation}`. Machine-written, coach-verifiable. |
| **AI Agent** | The async worker that turns (submission + rubric) into flags via an LLM call. "Agent" because it does a multi-step job — fetch rubric, chunk the doc, call the model, validate the output schema, retry on bad JSON — not just a single completion. |
| **Human-in-the-loop review** | The review model where AI proposes structured flags, but a coach confirms or dismisses them before they affect trainee-facing feedback. Interview phrasing: **"I designed this as a human-in-the-loop review system: the AI accelerated first-pass analysis, while coaches kept final judgment and quality control."** |

---

## 3. Components (in dependency order)

### 3.1 Data layer — DynamoDB (+ S3)

DynamoDB is a serverless documnet store that stores data as:

- Tables — collections of related data
- Items — records within a table
- Attributes — fields within an item
Each item is identified using a primary key:
- Partition key — determines where the item is stored
- Optional sort key — allows multiple related items to share a partition key

Everything else reads/writes here, so it comes first.

**Single-table design**, keyed so that every access pattern is one query:

| Entity | PK | SK |
|---|---|---|
| Cohort | `COHORT#<id>` | `META` |
| Assignment | `COHORT#<id>` | `ASSIGN#<id>` |
| Submission | `COHORT#<id>` | `ASSIGN#<id>#SUB#<trainee_id>` |
| Flags (per submission) | `COHORT#<id>` | `ASSIGN#<id>#SUB#<trainee_id>#FLAGS` |

- Coach dashboard's core query — *"all submissions + flags for assignment 3 in this cohort"* — is a single partition query with an SK `begins_with` prefix. No joins, no scans.
- A GSI on `TRAINEE#<id>` gives the trainee their own submission history.
- Large bodies (uploaded PDFs/docs) go to **S3**; DynamoDB stores the S3 key. DynamoDB has a 400KB item limit, and you don't want document blobs in your query path anyway.

### 3.2 Backend — Django + DRF

- **Django REST Framework** API: auth (session/JWT), role-based access (trainee vs. coach vs. admin), CRUD for cohorts/assignments/rubrics, submission intake, flag read endpoints.
- Django's admin site doubles as the internal ops tool for setting up a new cohort — near-zero extra code, and it's a big reason Django over Flask/FastAPI here.
- On submission intake, Django does exactly two things synchronously: write to DynamoDB/S3, push a message to **SQS**. Then it returns 201. All slow work is downstream.

### 3.3 AI Agent — Lambda function triggered by SQS

One invocation = one submission analyzed. The pipeline, in order:

1. **Trigger:** SQS delivers `{submission_id}` to the Lambda.
2. **Fetch** submission text (S3) and the assignment's rubric (DynamoDB).
3. **Prompt** the LLM: rubric criteria + mistake taxonomy injected into the system prompt, submission as user content, output forced into a JSON schema of flags. Grounding in the coach's own rubric is what keeps flags relevant and consistent instead of generic "AI feedback."
4. **Validate** the response against the flag schema (Pydantic); retry with a repair prompt on malformed output.
5. **Write** flags to DynamoDB with `status=ai_suggested`.

- Coaches can mark a flag *confirmed* or *dismissed* in the dashboard — **human-in-the-loop review**, so the AI drafts and the coach decides. Dismissal rates per mistake-category were the feedback signal for tuning prompts between cohorts.
- Failure handling: SQS redrive + dead-letter queue. A failed analysis never loses the submission — the flags just stay pending and the job can be replayed. Lambda's 15-min cap is ample for one analysis (a few LLM calls with retries).

### 3.4 Frontend — React SPA

- **Trainee view:** assignment list, submission form/upload, past submissions with their (coach-confirmed) feedback.
- **Coach view:** the payoff screen — per-assignment matrix of trainees × mistake categories, sortable by frequency, with drill-down into each flagged excerpt. Session planning = reading this one screen instead of 30–40 documents.
- Built and deployed as static assets to **S3 behind CloudFront**; talks to Django purely over the JSON API.

### 3.5 AWS deployment

```
Route 53 → CloudFront ──▶ S3 (React static assets)
                └────────▶ API Gateway → Lambda (Django API, container image)
                                              └─ enqueues ──▶ SQS ──▶ Lambda (AI agent)
DynamoDB + S3 (data)          Secrets Manager (LLM API key, Django secret)
CloudWatch (logs/alarms)
```

- **Everything is pay-per-request; nothing runs between requests.** Django ships as a Lambda container image (via Lambda Web Adapter) behind API Gateway; the AI agent is a second, smaller Lambda triggered by SQS. Both share a common Python package for models and validation.
- Sized to reality: peak load is ~10 concurrent users on a deadline evening — well inside Lambda's default concurrency. Occasional 2–3s cold starts are acceptable for an internal tool.
- Idle cost between cohorts is ~$1–2/month (Route 53, Secrets Manager, S3/DynamoDB storage). That's what made **reuse across cohort cycles** practical — the stack sits dormant for free and wakes on the first request of the next cohort, no re-provisioning.

---

## 4. Why this tech stack (decision log)

Start from the actual scale, because it drives everything: **≤40 users, ~10 concurrent at deadline peaks, ~200 submissions per cohort, ~10 MB of data per cohort.** The only heavy compute — LLM inference — happens on the provider's hardware; our code is I/O-bound orchestration that runs for seconds. So there is no load problem. The real requirements are: durability of slow async AI jobs, ~zero cost while dormant between cohorts, and ~zero administration for a team with no ops capacity. Every choice below follows from those three, and the discipline is refusing components that a "production web app" reflex would add but this scale can't justify.

**DynamoDB — vs MongoDB:** data-model-wise it's a wash (both document stores). The difference is operational: DynamoDB on-demand bills per request, so at zero traffic it costs essentially nothing — no instance running. MongoDB means either an Atlas cluster (always-on monthly bill whether anyone submits or not) or self-hosting on EC2 (patching, backups, and paying for a DB server for a tens-of-users app). DynamoDB is also inside the AWS trust boundary — the Lambdas authenticate via IAM role, no connection string or VPC peering to a third-party cluster. Mongo's real edge — ad-hoc queries and aggregation pipelines — only matters when access patterns are unknown; here they're few and fixed (by cohort/assignment/trainee), so DynamoDB's key-design constraint costs nothing.

**DynamoDB — vs Postgres/RDS:** the right default for most Django apps, rejected for the same idle-cost reason (RDS is always-on) and because nothing here needs joins or cross-table transactions — flags are variable-shape documents and every query is one partition.

**Django + DRF — vs FastAPI/Flask:** FastAPI's async edge is moot (all slow work goes to the queue, so API workers never block on anything). Django wins on what you'd otherwise rebuild: auth with role-based permissions, DRF serializers, and the **admin site** — a free ops console where a non-engineer coordinator sets up each new cohort's assignments and rubrics with zero custom UI. Python throughout also means the API and the AI worker share models and validation code.

**SQS + Lambda worker — vs synchronous:** LLM calls take 10–30s and fail nondeterministically; inline they'd tie up the API, time out, and lose failed analyses without a trace. The queue makes intake instant and the job durable — this is the one piece of "architecture" the app genuinely needs. **vs Celery + Redis:** Celery exists to manage a fleet of worker processes you own, and Redis means an always-on ElastiCache instance — both solve problems this app doesn't have. SQS→Lambda gets the same durability with native dead-letter queues, zero processes to manage, and $0 at idle.

**Lambda for the API — vs ECS Fargate + ALB:** the reflex pattern for Django is containers behind a load balancer, but priced honestly that's ~$55–75/month of always-on floor (two Fargate tasks + ALB) serving ~10 concurrent users — infrastructure for load that doesn't exist. Django runs fine as a Lambda container image behind API Gateway (Lambda Web Adapter); the costs are occasional 2–3s cold starts and slightly fiddlier packaging, acceptable for an authenticated internal tool. Containers earn their keep at sustained traffic, which this app never has. **vs EC2:** all of the above plus patching and sizing an instance.

**React SPA on S3/CloudFront — vs Django templates:** the coach dashboard (sortable trainee × mistake matrix with drill-downs) is genuinely interactive client state — the one screen that must feel like an app. Static assets on a CDN cost ~nothing to serve, and frontend deploys decouple from API deploys. **vs Next.js/SSR:** SSR earns its keep on SEO/first-paint for public pages; this is an authenticated internal tool with zero SEO surface.

**Hosted LLM API + rubric prompting — vs fine-tuning:** no training data exists at pilot time, and prompting keeps the mistake taxonomy editable — a coach changes a rubric row and the agent's behavior changes immediately (the "new cohort, zero code" property). **vs self-hosting a model:** GPU inference is the ultimate always-on cost for a few hundred calls per deadline; per-token pricing matches the bursty shape. **vs free-form "grade this":** without a fixed taxonomy, flag categories drift between submissions and the cohort-level counts — the actual product — become meaningless.

**Product-shape decisions:** human-in-the-loop flags (`ai_suggested` → coach confirms/dismisses) because one hallucinated flag shown to a paying trainee costs more trust than review costs time — and dismissal rates doubled as the prompt-tuning signal. Aggregation at cohort level because the ~40% speedup comes from the rollup, not per-submission review: one matrix instead of N documents.

**When this design stops being right:** the fully-serverless choice is a bet on the scale staying small. Sustained traffic (thousands of daily users) would flip the Lambda-vs-containers math back toward Fargate; unknown/exploratory query needs would flip DynamoDB toward Postgres. Knowing the flip points is the strongest version of the design argument: the architecture isn't "serverless is best," it's "at *this* measured scale, anything always-on is waste."

---

## 5. Resume bullets (Action–Method–Impact)

Metrics the system naturally produces (numbers below are calibrated placeholders — **replace with real values**, assuming ~25 trainees × ~8 assignments per cohort):

- **Volume:** submissions analyzed (~200/cohort, 800+ across 4 cycles) — a fact from the DB, the most probe-proof number.
- **Coach time:** prep per session, before → after (~5 h reading every submission → ~2 h reviewing the matrix).
- **AI quality:** % of AI-suggested flags coaches confirmed (~80%) — exists by design in the confirm/dismiss data.
- **Trainee turnaround:** feedback latency, before → after (~1 week batch grading → same-day).
- **Cost/reuse:** cohort cycles served without re-provisioning; idle infra cost between cohorts (~$2/mo).

The bullets:

1. **Developed** a Django + React assignment-review platform **using** an async AI agent (SQS-triggered Lambda) that flags rubric-based mistakes in submissions, **cutting** coach session prep from ~5 to ~2 hours by replacing per-submission review with a cohort-level mistake matrix.

2. **Architected** a fully serverless AWS stack **using** Lambda, single-table DynamoDB, S3/CloudFront, and queue-decoupled LLM analysis, **sustaining** 4 cohort cycles and 800+ analyzed submissions with no re-provisioning at ~$3/month idle cost.

3. **Implemented** human-in-the-loop AI review **using** schema-validated LLM output, coach confirm/dismiss flows, and dead-letter-queue retries, **achieving** an ~80% coach-confirmation rate on AI flags while cutting trainee feedback turnaround from ~1 week to same-day.
