# Turfco — (Full Stack Developer)

Turfco Landscape App System Design

A customer-facing web app for a landscaping company: a visitor describes their property and the service they want, gets an **instant price estimate** from a rule-based engine, creates an account, books the job, and pays a deposit online. Staff use an admin view to manage pricing rules and bookings.

## Key terms (defined before use)

- **PERN** — PostgreSQL (relational database), Express (Node.js HTTP framework), React (frontend SPA), Node.js (JS runtime). One language across the application tier, SQL at the storage tier.
- **SPA (Single-Page App)** — the React bundle loads once; navigation and rendering happen client-side, and the page talks to the backend only through JSON API calls.
- **JWT (JSON Web Token)** — a signed token the server issues at login; the client sends it on every request so the server can verify identity **without a session lookup** (stateless auth).
- **Rule-based cost estimation engine** — pricing logic expressed as **data** (rows in a `pricing_rules` table: conditions + rate adjustments) instead of hardcoded `if/else`, evaluated server-side against the customer's inputs.
- **JSONB** — PostgreSQL's binary JSON column type. Used for the genuinely schemaless parts (a rule's condition, an estimate's inputs and line items) while everything with relationships and money stays in typed, constrained columns.
- **Stripe Checkout / webhook** — Stripe hosts the card-entry page (so card data never touches our servers → minimal PCI scope); a **webhook** is Stripe calling *our* API afterward to tell us, server-to-server, that the payment actually succeeded.
- **Reverse proxy (Nginx)** — the single public entry point; terminates TLS, serves the static React build, and forwards `/api/*` to the Node process.
- **Redis** — an in-memory key-value store used as a shared cache. Express checks Redis before PostgreSQL for frequently reused data; cached data is disposable because PostgreSQL remains the source of truth.

## High-level architecture

```
Browser
   │  HTTPS
   ▼
Nginx frontend container (public entry point)
   ├── GET / or /assets/* ──► React build (index.html, JavaScript, CSS, images)
   │
   └── /api/* ──► Node.js / Express backend container
                       │
                       ├──► Amazon RDS for PostgreSQL (users, rules, estimates, bookings, payments)
                       ├──► Stripe (create Checkout session)          [outbound]
                       ◄─── Stripe webhook → /api/webhooks/stripe     [inbound, signed]
                       └──► Email service (booking confirmations)     [outbound]
```

The production frontend image is built from the React project. A multi-stage build compiles the React source into static files and copies them into the Nginx image, conventionally under `/usr/share/nginx/html`. The running frontend container therefore contains Nginx and the compiled React build; it does not run a React or Node development server.

### Request lifecycle

1. The browser sends `GET /` over HTTPS to the public Nginx frontend container.
2. Nginx returns `index.html`. The browser then requests the referenced JavaScript, CSS, images, and other assets, which Nginx also serves directly from the compiled React build.
3. The JavaScript bundle starts the React SPA in the browser. Client-side routing and rendering happen there without downloading a new HTML document for each view.
4. When the SPA needs application data, it sends a request such as `POST /api/estimates` or `POST /api/bookings` to the same public origin.
5. Nginx recognizes the `/api/*` prefix and reverse-proxies the request over the private container network to the Express backend container; the backend is not exposed directly to the internet.
6. Express runs the route's validation and authentication middleware, executes the controller and business logic, and communicates with PostgreSQL, Stripe, or the email service as required.
7. Express returns a JSON response to Nginx, which relays it to the browser. React updates its state and re-renders the relevant UI.

The API path is therefore **React SPA → Nginx → Express route → middleware → controller → external service or PostgreSQL → JSON response → Nginx → React re-render**. Static frontend requests stop at Nginx and never reach Express. The three feature flows below are specializations of the API path.

All SQL is issued through **parameterized queries** (`pg` placeholders, never string interpolation), so user-supplied estimate inputs cannot alter query structure. A connection **pool** is opened once per process rather than per request — a small RDS instance allows far fewer connections than Node will happily try to open.

## Flow 1 — Authentication

1. **Register:** `POST /api/auth/register` → validate input → hash password with **bcrypt** (never store plaintext) → `INSERT INTO users` with `role = 'customer'`.
2. **Login:** `POST /api/auth/login` → bcrypt-compare → issue a short-lived **access JWT** (~15 min, kept in memory on the client) and a long-lived **refresh token** (httpOnly, Secure cookie — invisible to JS, so XSS can't steal it).
3. **Authenticated request:** client sends `Authorization: Bearer <JWT>` → an Express **auth middleware** verifies the signature and expiry, attaches `req.user`, and a **role middleware** gates admin routes (`role = 'admin'` for rule editing, booking management).
4. **Refresh:** when the access token expires, `POST /api/auth/refresh` reads the cookie and issues a new access token — the user stays logged in without re-entering credentials.

Why JWT over server sessions here: the API stays stateless (any process restart or second instance needs no shared session store), which is the right trade at this traffic level.

Role is a `user_role` enum column, not a free-text string — a typo'd role can't silently become an unrecognized value that some middleware treats as truthy.

## Flow 2 — Cost estimation (the rule engine)

**The core idea: pricing is data, not code.** Turfco's owners change prices seasonally; that must not require a redeploy.

1. Customer fills the estimate form: service type (mowing, aeration, fertilizing, cleanup…), lot size, frequency (one-time / weekly / biweekly), property details (slope, fenced, obstacles).
2. `POST /api/estimates` → validation → the engine loads the **active rule set** from the `pricing_rules` table (cached for 5 min as described under Caching strategy — rules change rarely, so this cuts a DB round trip from the hottest endpoint).
3. Evaluation is a **deterministic pipeline**: start from the service's base rate → apply matching *quantity rules* (e.g. `$ per 1000 sq ft` tiers) → apply *multiplier rules* (slope +15%, weekly frequency ×0.9 discount) → apply *flat surcharges* (travel fee by postal-code zone) → clamp to a configured minimum job price.
4. A rule is one row; only its `condition` is schemaless, so it lives in JSONB while everything the engine sorts, filters, or does arithmetic on stays typed:

   ```sql
   CREATE TABLE pricing_rules (
     id        bigserial PRIMARY KEY,
     service   text        NOT NULL,
     type      rule_type   NOT NULL,          -- enum: quantity | multiplier | surcharge
     condition jsonb       NOT NULL,          -- {"field":"frequency","op":"eq","value":"weekly"}
     factor    numeric(6,3) NOT NULL,
     priority  int         NOT NULL,
     active    boolean     NOT NULL DEFAULT true
   );

   CREATE INDEX ON pricing_rules (service, priority) WHERE active;
   ```

   Rules are read `ORDER BY priority`, and the engine records **which rules fired** into the saved estimate — so every quoted price is auditable and reproducible.
5. The estimate row (inputs + line items + total + fired-rule snapshot) is saved and returned; the SPA renders the price breakdown. Admins CRUD rules through the admin UI; a rule edit takes effect immediately, no deploy.

All money is `numeric`, never `float` — binary floating point cannot represent `0.1`, and a quote that disagrees with the invoice by a cent is a support call. Postgres does the rounding at a defined scale rather than leaving it to JavaScript.

Why rule-engine over hardcoded pricing: (a) non-developers change prices via the admin UI, (b) the audit trail explains any quote, (c) testing is table-driven — feed inputs, assert totals.

### Caching strategy

The active pricing-rule set is the best cache candidate because every estimate needs it, every customer can reuse it, and administrators change it infrequently. Caching is implemented explicitly in Express with the **cache-aside pattern**; Redis does not automatically intercept or cache SQL queries.

```text
Browser
   ↓
Nginx
   ↓
Express backend
   ├──► Redis: look up active pricing rules
   │       ├── cache hit  ──► evaluate estimate with cached rules
   │       └── cache miss ──► query PostgreSQL
   │                              │
   │                              └──► store result in Redis with a five-minute TTL
   └──► PostgreSQL remains the source of truth
```

On an estimate request, Express first looks for a key such as `pricing-rules:mowing` in Redis. A cache hit avoids the SQL query. On a miss, Express loads the active rules from PostgreSQL, stores them in Redis with a five-minute **TTL (time to live)**, and then evaluates the estimate. When an administrator changes a pricing rule, the API deletes the affected cache key so the next estimate reloads fresh rules immediately rather than waiting for the TTL.

The initial single-backend deployment used the same cache-aside logic against a small in-process memory cache instead of operating another service. Redis earned its place once a second Express process existed, because two processes must share the same cached rules *and the same invalidation event* — otherwise an admin's price edit clears one process's cache and leaves the other serving stale quotes for up to five minutes:

```text
Single Express process     → in-process rule cache
Multiple Express processes  → shared Redis rule cache → PostgreSQL
```

Redis is not used for payment state, booking availability, or arbitrary one-off queries where stale results would be risky or cache reuse would be low. If Redis is unavailable or loses its data, Express falls back to PostgreSQL and repopulates the cache; Redis never becomes the system of record.

## Flow 3 — Booking & payment

1. From an estimate, `POST /api/bookings` creates a booking with `status = 'pending_payment'` and the **estimate total snapshotted** into `quoted_total` (a later rule change must not reprice an existing booking).
2. The API creates a **Stripe Checkout session** for the deposit (e.g. 25%) with the booking id in metadata, and returns the redirect URL; the customer pays on Stripe's hosted page.
3. **The webhook is the source of truth, not the browser redirect** (a user can close the tab after paying): Stripe calls `POST /api/webhooks/stripe`; the handler verifies the **webhook signature**, and on `checkout.session.completed` marks the payment `paid` and the booking `confirmed`, then sends the confirmation email.
4. The handler is **idempotent**, and this is where a relational store pays for itself. Recording the event and confirming the booking happen in **one transaction**, with the dedupe enforced by the database rather than by application logic:

   ```sql
   BEGIN;
     INSERT INTO payments (stripe_event_id, booking_id, amount, status)
     VALUES ($1, $2, $3, 'paid')
     ON CONFLICT (stripe_event_id) DO NOTHING;      -- redelivery is a no-op

     UPDATE bookings SET status = 'confirmed' WHERE id = $2;
   COMMIT;
   ```

   A redelivered webhook can't double-confirm, and there is no window where a payment row exists but the booking never flipped (or vice versa) because a process died between two writes. Unhandled event types are acked with 200 so Stripe stops retrying.

## Data model (PostgreSQL tables)

Postgres stores rows in tables with typed columns; an index on a column (`user_id`, `stripe_event_id`) turns a full table scan into a lookup, and a **constraint** makes an invalid state impossible to write rather than merely unlikely.

| Table | Holds | Key constraints & indexes |
|---|---|---|
| `users` | email, bcrypt hash, role enum, profile | `UNIQUE (lower(email))` |
| `pricing_rules` | pricing rules as rows, condition in JSONB (above) | `(service, priority) WHERE active` (partial) |
| `estimates` | `inputs` / `line_items` / `fired_rules` JSONB, `total numeric` | FK → `users`; `(user_id, created_at DESC)` |
| `bookings` | estimate ref, `quoted_total numeric`, schedule, status enum | FK → `estimates`, `users`; `(status, scheduled_for)` |
| `payments` | Stripe session/event ids, amount, status | FK → `bookings`; `UNIQUE (stripe_event_id)` (idempotency) |

The hybrid is the point: an estimate's *inputs* are a naturally nested blob read and written as a unit, so they stay in JSONB — but its `total`, and the foreign keys tying estimate → booking → payment, are exactly the things that must never drift, so they get typed columns, `NOT NULL`, and referential integrity. Schema changes ship as **versioned migration files** applied on deploy, which also gives every schema change a reviewable diff in git.

## Capacity & scaling honesty (300 req/s measured)

**300 req/s is a load-tested ceiling, not organic traffic — always say it that way.** It is what one instance held under synthetic load at **sub-100 ms p95**; real demand sat far below it. Framed as actual traffic the number collapses under an interviewer's arithmetic (300 req/s ≈ 26M requests/day for a regional landscaping company), and the claim you can defend is the more impressive one anyway: you measured the ceiling instead of guessing at it.

- **Where the headroom comes from:** at 300 req/s the estimate endpoint is the hot path, and it is served almost entirely out of the cached rule set — the request never reaches Postgres. Node's event loop handles that volume of in-memory rule evaluation plus JSON serialization comfortably on 2 vCPUs. The cache is load-bearing at this rate, not a nicety.
- **Where it breaks first:** the database connection pool, not CPU. Every cache miss and every booking write borrows a connection, and a small RDS instance allows on the order of ~100 — which is why the pool is capped per process rather than left to grow on demand.
- **Burstable-instance caveat:** a t3.small is CPU-credit-limited, so a short load test bursts fine while *continuously* serving 300 req/s would need T3 Unlimited or a fixed-performance instance. Concede this before being asked; it reads as rigor.
- So the design intentionally avoids: microservices, message queues, Kubernetes, and horizontal autoscaling. **The engineering judgment is knowing not to build them** — the measured ceiling sits far above real demand, so the complexity would cost more than it buys.
- What the scale *does* justify: Nginx rate limiting on `/api/auth/*` (brute-force protection), the rule cache, the indexes above, RDS automated backups and point-in-time recovery, a container restart policy, and basic monitoring (uptime check + error logging with pino → log file / free tier of a log service).
- **Growth path** (if real demand ever approached the ceiling): run multiple backend processes across cores → promote the rule cache from in-process to Redis (done) → put PgBouncer in front of Postgres before connection count becomes the bottleneck → add a read replica for reporting queries → split the estimator into its own service. Each step is incremental; nothing in the current design blocks it.

## Deployment

**The single instance = an AWS EC2 (or Lightsail) instance running the frontend and backend containers, with PostgreSQL on Amazon RDS.** This is the specific answer to "where did it run":

- **One AWS EC2 t3.small (or Lightsail) instance** running Ubuntu and Docker Compose — administered over **SSH**. Deployments pull the versioned frontend and backend images, run pending database migrations, and recreate the containers.
- **Frontend container**: an Nginx image containing the compiled React build. It terminates TLS, serves the SPA and its assets, proxies `/api/*` to the backend container, and rate-limits `/api/auth/*`.
- **Backend container**: the Node.js/Express API. It is reachable by Nginx over the private Compose network but does not publish a public host port.
- **Amazon RDS for PostgreSQL** (smallest burstable instance) for the database — automated backups, point-in-time recovery, and patching handled by AWS, reachable only from the instance's security group, never from the public internet.

**Why managed Postgres and not a Postgres container on the same box:** a database container on the app host shares its fate. One `docker compose down -v` on a tired evening, one full disk from unrotated logs, and the payment history is gone — and nothing about running `pg_dump` on a cron and hoping the file is restorable is worth the ~$15/month saved. RDS also moves backup verification and minor-version patching off a one-person team.

**Why a rented cloud VM and not an on-prem office machine:** Stripe webhooks require a publicly reachable, always-up HTTPS endpoint — an office box behind a consumer ISP means non-static IP, router port-forwarding, and outages that silently drop payment confirmations (a paid-on-Stripe / unconfirmed-in-app mismatch). Add no backups, no physical security on a machine touching payment flows, and the economics ($6–15/month for a VPS with snapshots) and the VM wins on every axis that matters. Naming **AWS + RDS** on a resume also carries the highest keyword recognition.

Interview one-liner: *"A single small EC2 instance ran an Nginx frontend container and an Express backend container against managed Postgres on RDS — it held 300 req/s at sub-100 ms p95 under load test, far above real demand, and the growth path (multiple backend processes → shared Redis cache → PgBouncer → read replica) was known but deliberately deferred."*

## Security checklist

- bcrypt password hashing; JWTs signed with a strong secret; refresh token in httpOnly+Secure cookie
- Input validation on every route (e.g. Joi/zod) — the estimator especially, since its inputs drive pricing
- **Parameterized SQL everywhere**; no query built by string concatenation, so a crafted estimate input cannot become SQL
- Least-privilege database role for the app (DML only — no `DROP`, no schema changes at runtime; migrations run under a separate role)
- Stripe webhook **signature verification**; card data never touches the server (hosted Checkout)
- CORS locked to the app origin; Helmet security headers; rate limiting on auth endpoints
- Role-based access middleware: customers can only read their own estimates/bookings; only admins mutate rules

## Resume bullets (Action–Method–Impact)

Chosen two — one for the estimator (the differentiator), one for auth + payments (the production-hardening story):

1. **Engineered a rule-based cost estimation engine** (Node.js/Express, PostgreSQL) that priced jobs from admin-configurable pricing rules with a full audit trail of applied rules, **replacing manual quoting with instant self-serve estimates and cutting quote turnaround from ~2 days to under a minute**.
2. **Secured and automated the booking pipeline** by implementing JWT authentication with refresh-token rotation and role-based access control, and integrating Stripe Checkout with signature-verified webhooks made idempotent by a unique-constraint upsert — **moving deposit collection online with zero duplicate charges across redelivered events**.

Alternates (swap in if a posting emphasizes different skills):

- **Designed and deployed the full PERN stack** behind an Nginx reverse proxy with TLS, rate limiting, and indexed PostgreSQL queries, **sustaining 300 req/s at sub-100 ms p95 latency on a single low-cost instance**.
- **Reduced pricing-change lead time from a code deploy to an instant admin edit** by modeling pricing logic as rule rows with JSONB conditions and a cache invalidated on write, **letting non-technical staff run seasonal price updates independently**.

> **Before using:** verify/replace the numbers (2 days, 300 req/s, sub-100 ms p95) with real ones — interviewers probe quantified claims. On 300 req/s specifically: the honest and stronger framing is "one instance *held* 300 req/s under load test," not "the site *served* 300 req/s." The first invites "how did you measure it?"; the second invites arithmetic you will lose.

## What happened to the app

For the requirements at the time — self-serve quotes and online deposit collection — the system was well designed and right-sized. But I was the only technical person on the team, and after I left there was nobody to manage it: even a well-behaved custom app needs *someone* who can SSH into the server, renew certificates, update dependencies, or investigate a failed webhook.

For a non-technical team, "the website is doing something weird and nobody here can look at it" is a real operational risk. So they retired it and consolidated to a simple builder-style marketing site — which is what runs at turfcolandscape.com today, a pure lead-gen site with a "Start my project" CTA and no login, booking, payments, or quote tool. Phone calls and in-person quoting absorbed what the app used to do; honestly, the correct call once the maintainer was gone.

This is one of the most common arcs in small-business software: commission a custom app, later realize the ambition outgrew the need, and retire it. Knowing when custom software stops being worth its upkeep is the same judgment as deliberately not building microservices for 1K hits/day (see Capacity & scaling above).

## Likely interview follow-ups

- *Why Postgres over MongoDB?* → the hot path is money moving through estimate → booking → payment, where I want foreign keys, a unique constraint doing webhook idempotency, and one transaction confirming a booking and recording its payment together. JSONB covers the genuinely schemaless parts (rule conditions, estimate inputs) without giving up any of that. (Concede: Mongo would also work fine — the idempotency and atomicity would just move into application code and be mine to get right.)
- *Why is the webhook the source of truth instead of the redirect?* → redirect is client-controlled and skippable; webhook is signed, server-to-server, retried by Stripe.
- *What happens if two rule edits conflict?* → rules apply by `priority`; estimates snapshot fired rules, so past quotes are immune to edits.
- *Why JSONB for conditions instead of columns?* → conditions are heterogeneous per rule type and only ever read as a whole by the evaluator; modeling them as columns means a migration every time a new condition shape appears, and most rows NULL.
- *How would you scale it 100×?* → see growth path above — and lead with "measure first."
