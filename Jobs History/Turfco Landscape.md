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
- **ALB (Application Load Balancer)** — the public entry point for `/api/*`; terminates TLS, health-checks targets, and spreads requests across the API instances. It replaced a single Nginx reverse proxy once the app tier stopped being one box.
- **CloudFront / S3** — the CDN and object store serving the compiled React build from the edge, so static requests never reach the API tier.
- **ASG (Auto Scaling Group)** — a managed pool of identical API instances across two availability zones that grows and shrinks on load. It is what makes the seasonal traffic curve affordable and survivable at once.
- **Multi-AZ RDS** — a synchronous standby of the database in a second availability zone with automatic failover. It is the availability feature that a one-person team would otherwise intend to build and never build.
- **Redis** — an in-memory key-value store used as a shared cache. Express checks Redis before PostgreSQL for frequently reused data; cached data is disposable because PostgreSQL remains the source of truth.
- **Kafka** — a durable, partitioned, append-only **log** — not a queue. Producers append records to a topic; each consumer reads at its own offset, and a record is **retained** after being read rather than deleted. That single difference is the whole reason it is here (see Flow 4).
- **Topic / partition / consumer group** — a topic is a named stream, split into partitions. Ordering is guaranteed only *within* a partition, so the **partition key** decides what stays ordered. A consumer group divides the partitions among its members; two *different* groups each receive every record, which is how one event feeds several independent jobs.
- **Transactional outbox** — rather than writing to Postgres and then publishing to Kafka (two writes that can half-fail), the event is `INSERT`ed into an `outbox` table **inside the same transaction** as the business write. A separate relay publishes those rows. The commit becomes the single point of truth.
- **At-least-once / idempotent consumer** — Kafka redelivers on failure, so a consumer may see the same record twice; it must make the second pass a no-op, enforced by a unique constraint rather than by application logic.

## High-level architecture

Everything below is **one AWS region, `ca-central-1`**, serving customers in Surrey and the rest of Metro Vancouver. That single fact shapes more of the design than the request rate does — see *Deployment* for why the region is in Montreal and the customers are not.

```text
                                  Route 53
                                      │
                ┌─────────────────────┴──────────────────┐
                ▼                                        ▼
       CloudFront ──► S3                          Application Load Balancer
       React build, cached at the                 TLS · WAF · health checks
       Vancouver/Seattle edge                             │  /api/*
       GET / and /assets/*                                ▼
                                          ┌──────────────────────────────┐
                                          │  ASG — Express API           │
                                          │  2 AZs · 2 steady, 4 at peak │
                                          │  rolling zero-downtime deploys│
                                          └──────────────────────────────┘
                                                         │
              ┌───────────────────┬────────────────────┬─┴──────────────┐
              ▼                   ▼                    ▼                ▼
      ElastiCache Redis   RDS PostgreSQL        Stripe  [outbound]  outbox relay
      pricing-rule cache  Multi-AZ writer   webhook →  [inbound]        │
      (cache.t4g.micro)   users · rules · estimates                     ▼
                          bookings · payments · outbox        MSK Serverless (Kafka)
                                                                        │
                                        ┌───────────────┬───────────────┴────────┐
                                        ▼               ▼                        ▼
                                group: notifier  group: scheduler        group: analytics
                                email / SMS      crew calendar           pricing reports
                                                            + pricing.rules → every API instance
```

Three properties do most of the work. **Everything below the outbox relay is off the request path** — nothing a customer waits on depends on it. **The API tier is stateless**: no session store, no local cache of record, no local disk that matters, so the ASG can replace any instance at any time and a deploy is just a new target group. And **there is no read replica and no PgBouncer**, because at this size neither is needed yet — both are named in the growth path and neither was built.

### Request lifecycle

1. The browser resolves the domain and requests `GET /`. **CloudFront** serves `index.html` from its Vancouver or Seattle edge, then the referenced JavaScript, CSS, and images — hashed filenames with long-lived cache headers. This matters more here than in a typical deployment: the origin is 4,000 km away in Montreal, so a static request that reaches the origin costs ~60 ms of round trip it does not have to.
2. The bundle starts the React SPA. Client-side routing and rendering happen in the browser without fetching a new HTML document per view — which also means the cross-country origin hop happens on API calls only, and only once per interaction.
3. When the SPA needs data it calls `POST /api/estimates` or `POST /api/bookings`. Those go to the **ALB**, which terminates TLS, applies WAF rules (auth-endpoint rate limiting among them), and routes to a healthy target in the Express **Auto Scaling Group**. Instances live in private subnets, reachable only through the ALB.
4. Express runs the route's validation and authentication middleware, then the controller — reading the rule cache from **ElastiCache**, going to Postgres only when it must, and calling Stripe when it must.
5. Express returns JSON; React updates state and re-renders.
6. Anything that must happen *because* of the request but not *during* it — email, crew scheduling, analytics — was written to the `outbox` table in the same transaction, and leaves through **Kafka** afterward (Flow 4).

The API path is therefore **React SPA → ALB → Express route → middleware → controller → cache → Postgres or external service → JSON → React re-render**. Static requests stop at CloudFront and never reach the API tier at all. The four feature flows below are specializations of this path.

All SQL is issued through **parameterized queries** (`pg` placeholders, never string interpolation), so user-supplied estimate inputs cannot alter query structure. Each process opens a **connection pool** once rather than per request, and the pool is **capped per process** — with an autoscaling tier, an uncapped pool multiplied by instance count is exactly how you exhaust a managed Postgres connection limit during the spike you scaled out to serve. At four instances the arithmetic is comfortable (4 × 10 client connections, plus the consumers, against a few hundred available), which is why PgBouncer is on the growth path rather than in the diagram.

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
5. The result is returned and the SPA renders the price breakdown. **Only a committed quote is persisted** — the form recalculates as the customer changes lot size, frequency or add-ons, and those recomputations are cache-and-CPU only; the row (inputs + line items + total + fired-rule snapshot) is written when the customer submits the quote or proceeds to booking. That distinction is the reason the hot path is cheap, and it matters for capacity — see *Where the 900 req/s actually lands* below. Admins CRUD rules through the admin UI; a rule edit takes effect immediately, no deploy.

All money is `numeric`, never `float` — binary floating point cannot represent `0.1`, and a quote that disagrees with the invoice by a cent is a support call. Postgres does the rounding at a defined scale rather than leaving it to JavaScript.

Why rule-engine over hardcoded pricing: (a) non-developers change prices via the admin UI, (b) the audit trail explains any quote, (c) testing is table-driven — feed inputs, assert totals.

**One validation schema, shared by the form and the API.** The estimator's field definitions — the service and frequency enums, lot-size bounds, the boolean property flags — live in a single module both the React form and the Express route import. The client copy is for feedback as the customer types; the server copy is the one that actually enforces, because anyone can POST past the browser. Sharing it is not code hygiene here, it is **pricing correctness**: the form's `frequency` values must be exactly the values a rule's JSONB `condition` matches on, and a drifted enum means no rule fires and the customer is quoted a silently wrong price rather than shown an error. The shared schema covers shape and range only; stateful checks (is this email taken, is that crew slot free) need the database and stay server-side.

### Caching strategy

The active pricing-rule set is the best cache candidate because every estimate needs it, every customer can reuse it, and administrators change it infrequently. Caching is implemented explicitly in Express with the **cache-aside pattern**; Redis does not automatically intercept or cache SQL queries.

```text
Browser
   ↓
ALB
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

The initial single-instance deployment used the same cache-aside logic against a small in-process memory cache instead of operating another service. Redis earned its place the moment a second Express process existed, because two processes must share the same cached rules *and the same invalidation event* — otherwise an admin's price edit clears one process's cache and leaves the other serving stale quotes for up to five minutes. Once the tier became an autoscaling group the argument got sharper still: an instance the ASG launched mid-spike must not have to warm its own cache from Postgres at exactly the moment Postgres is busiest, so the cache moved to **ElastiCache** and became genuinely shared infrastructure rather than one container's memory.

```text
Single Express process      → in-process rule cache
Multiple Express processes  → shared Redis rule cache      → PostgreSQL
Autoscaling instance pool   → ElastiCache + pricing.rules  → PostgreSQL
                              (Kafka makes invalidation durable — Flow 4)
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

## Flow 4 — Event backbone (Kafka)

**What Kafka is actually solving here.** Flow 3's webhook handler does three things inside one HTTP request: record the payment, confirm the booking, send the confirmation email. The first two are a single fast Postgres transaction. The third is a call into somebody else's network. When the email provider is slow, the handler is slow; when it is down, the handler throws *after* the money state has already committed — Stripe sees a non-2xx, redelivers, and the retry re-runs a handler whose database work is already done. A side effect is coupled to the request that triggered it, and it should not be.

So the boundary moves: **the API commits facts, Kafka carries them, consumers act on them.**

```text
Stripe webhook ──► Express handler
                      │
                      └─ ONE Postgres transaction:
                           INSERT payments …  ON CONFLICT (stripe_event_id) DO NOTHING
                           UPDATE bookings SET status = 'confirmed'
                           INSERT INTO outbox (topic, key, payload)
                         COMMIT ──────────────► 200 to Stripe   (handler done, single-digit ms)
                           │
                           ▼
                      outbox relay (poll, or Debezium CDC)
                           │
                           ▼
                      Kafka topic  booking.events    key = booking_id
                           ├──► group: notifier   → confirmation email + SMS
                           ├──► group: scheduler  → crew calendar assignment
                           └──► group: analytics  → conversion and revenue reporting
```

The webhook returns as soon as the transaction commits. An email outage now delays an email; it no longer produces a redelivery storm against an endpoint whose real work already succeeded.

### Why an outbox instead of producing from the handler

Calling `producer.send()` inside the handler just moves the problem down a level, into a **dual write**. `COMMIT` succeeds and the send then fails: the booking is confirmed and nobody is ever told. Or the send succeeds and the transaction rolls back: a customer gets an email for a booking that does not exist. There is no ordering of those two calls that is safe, because they are two systems and no transaction spans them.

The outbox deletes the second write. The event is a row, written in the same transaction as the state change it describes:

```sql
BEGIN;
  INSERT INTO payments (stripe_event_id, booking_id, amount, status)
  VALUES ($1, $2, $3, 'paid')
  ON CONFLICT (stripe_event_id) DO NOTHING;      -- redelivery is still a no-op

  UPDATE bookings SET status = 'confirmed' WHERE id = $2;

  INSERT INTO outbox (topic, key, payload)
  VALUES ('booking.events', $2::text, jsonb_build_object(
            'type', 'booking.confirmed', 'booking_id', $2, 'event_id', $1));
COMMIT;
```

Commit and the event exists. Roll back and neither the confirmation nor the event exists. There is no third outcome. A relay then drains the table:

```sql
SELECT id, topic, key, payload FROM outbox
WHERE published_at IS NULL
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

`FOR UPDATE SKIP LOCKED` is what lets a second relay run without both grabbing the same rows. At this size a one-second poll is the right amount of machinery; **Debezium** reading the write-ahead log is the same pattern with lower latency and no polling, and is the upgrade if it is ever needed. (The database choice keeps that door open — see *Database* below.)

### Delivery semantics: at-least-once, made idempotent at the edges

Kafka's practical guarantee is at-least-once. The relay can publish a row and die before marking it published; a consumer can act and die before committing its offset. Both replay. So each consumer is idempotent by the same trick the `payments` table already uses — a unique constraint doing the work, not application logic:

```sql
CREATE TABLE notifications_sent (
  event_id text        NOT NULL,
  channel  text        NOT NULL,          -- 'email' | 'sms'
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, channel)
);
```

The notifier inserts first and sends only if the insert actually took the row. A record that fails repeatedly goes to a **dead-letter topic** after a bounded number of retries, so one poisoned message cannot block the partition queued behind it.

### Partitioning: the key is the design decision

`booking.events` is keyed by `booking_id`. Kafka orders records only within a partition, and the same key always lands on the same partition — so `booking.confirmed`, `booking.rescheduled` and `booking.cancelled` for one booking are processed in the order they happened, while different bookings spread across partitions and proceed in parallel. Keying round-robin would buy throughput this system does not need and give up the only ordering that matters.

### `estimate.events` — the topic that justifies the broker

Every estimate already persists its inputs, its fired rules and its total for auditability. Publishing that same record to `estimate.events` turns a static audit trail into a stream, and the stream is what makes pricing answerable: what share of quotes convert, at what price, for which service, and which rule is the one that pushes a quote past the point where customers stop booking. The owners change prices seasonally, and until now changed them on instinct.

This is also the honest answer to *"why Kafka and not SQS?"* — **retention and replay**. A queue deletes a message once it is consumed, so a question asked six months later has no data behind it. A log keeps records for its retention window, so a new consumer group starts at offset 0 and rebuilds its view from history. That, plus several independent consumer groups reading one ordered stream, is the entire case for Kafka here. **It is not a throughput argument** — at this traffic the brokers are close to idle, and claiming otherwise invites arithmetic you will lose.

### Rule-cache invalidation that survives a restart

Redis cache-aside with `DEL`-on-write has one gap: invalidation is a single instant. A process that is restarting, or briefly partitioned from Redis, at the moment an admin saves a price change never learns the rules changed and serves stale quotes until its TTL expires. Redis pub/sub does not fix it — pub/sub is fire-and-forget, and a disconnected subscriber misses the message permanently.

`pricing.rules` is a compacted topic on which **each Express process is its own consumer group**, so every process receives every change and tracks its own offset. A process that was down reads the change when it comes back. The Redis key is still deleted on write for the shared path; Kafka makes the notification durable instead of best-effort.

### Where Kafka runs, and what it honestly costs

**Amazon MSK** — managed brokers across two AZs, IAM auth, private to the VPC and reachable only from the API tier's and consumers' security groups. Running a broker *on* the app instances is not worth considering: Kafka wants memory and steady disk, and an autoscaling group whose instances are designed to be replaced at will is the worst possible host for a durable log. The consumers run as their own service and **scale independently of the API tier** — a backlog of confirmation emails should not require more web capacity to drain.

Then the concession to make before it is asked for: MSK carries a real monthly floor that is a conspicuous line item for a regional landscaping company. **SNS + SQS would cost a fraction of it and would carry the notification fan-out perfectly well.** What buys the broker is the replayable estimate stream and the several independent consumer groups reading one ordered log. Drop those requirements and the case for Kafka goes with them — the right answer becomes SNS + SQS, and saying so is what makes the rest of the answer credible.

### What breaks when Kafka is down

Nothing a customer touches. Bookings still confirm, because confirming is a Postgres transaction; payments still record; the API keeps serving. Events accumulate as unpublished rows in the `outbox` table, and the relay drains the backlog when the brokers return. Kafka sits on the side-effect path and never on the money path — which is what putting the outbox between them was for.

### The SNS + SQS alternative — how each one works, and when it is the right answer

Keep this section ready, because "why Kafka and not SQS?" is the most likely single question this project attracts, and the answer is stronger if you can draw both.

**Everything up to the outbox is identical, and that is the point.** The dual-write problem is solved by the Postgres transaction, not by the broker. The handler, the `outbox` table and the relay do not change. Only the middle swaps out.

```text
Stripe webhook ──► Express handler
                      │
                      └─ ONE Postgres transaction        (identical in both designs)
                           INSERT payments … ON CONFLICT (stripe_event_id) DO NOTHING
                           UPDATE bookings SET status = 'confirmed'
                           INSERT INTO outbox (topic, key, payload)
                         COMMIT ─────────────────► 200 to Stripe
                           │
                           ▼
                      outbox relay                       (identical in both designs)
                           │
              ┌────────────┴──────────────────┐
              ▼                               ▼
   Kafka topic  booking.events      SNS topic  booking-events.fifo
   partition key = booking_id       MessageGroupId = booking_id
      ├─ group: notifier               ├──► SQS notifier.fifo   → email + SMS
      ├─ group: scheduler              ├──► SQS scheduler.fifo  → crew calendar
      └─ group: analytics              └──► SQS analytics.fifo  → reporting
                                            each + a dead-letter queue
   ONE copy, three bookmarks        THREE copies, one per queue
   record retained after reading    message deleted on acknowledgement
```

**One structural difference produces every other difference.** Kafka stores one copy of the record and each consumer group keeps its own bookmark into it. SNS copies the message into each subscribed queue, and each queue destroys its copy the moment a worker acknowledges it. Read the rest of this section as consequences of that sentence.

#### What does not change

- **The outbox.** It exists because a database write and a network publish cannot share a transaction. That is true of Kafka, SQS, and anything else.
- **At-least-once delivery.** Both redeliver on failure. Neither gives you exactly-once for free.
- **Idempotent consumers.** `PRIMARY KEY (event_id, channel)` on `notifications_sent`, insert-then-send. Unchanged.
- **Ordering per booking.** Kafka's partition key and SQS FIFO's `MessageGroupId` are the same mechanism under two names: same key → same ordered lane, different keys → parallel lanes.
- **What breaks when it is down.** Nothing customer-facing. Events pile up as unpublished `outbox` rows and drain on recovery.

#### Characteristics that genuinely differ

| | Kafka (MSK Serverless) | SNS + SQS FIFO |
|---|---|---|
| **Fan-out** | N consumer groups reading one topic | N queues subscribed to one topic |
| **Message lifetime** | retained for the retention window after being read | deleted on ack; 14-day maximum regardless |
| **A consumer added later** | starts at offset 0 and rebuilds history | sees only what arrives after it subscribes |
| **Poison-message handling** | build the retry counter and dead-letter topic yourself | `maxReceiveCount` + DLQ, a queue setting |
| **Lag visibility** | consumer group lag | `ApproximateAgeOfOldestMessage` |
| **Throughput ceiling** | far beyond need | FIFO: 300 msg/s, 3,000 batched — also far beyond need at ~8/s |
| **Ops surface** | brokers, topics, partitions, consumer groups, rebalancing | two AWS resources and an IAM policy |
| **Monthly floor** | a conspicuous line item for a regional landscaper | cents at this volume |

Two of those rows favour SQS outright: dead-lettering and lag alarms are checkboxes rather than code. Only one row favours Kafka — **retention** — and everything below turns on whether this system actually needed it.

#### Which jobs need a log, and which only need a queue

| Job | Needs retention? | Why |
|---|---|---|
| `booking.confirmed` → email / SMS | **No** | Fire once, forget. Nobody replays a confirmation email |
| `booking.confirmed` → crew calendar | **No** | The calendar is the state; the event is only the trigger |
| `booking.confirmed` → analytics | Borderline | A queue is fine if the consumer exists from day one; a log lets you add it later and backfill |
| `estimate.events` → pricing analysis | **Yes** | The questions arrive after the data does. "Which rule kills conversion?" was not a question when the events were produced |
| `pricing.rules` → per-process cache invalidation | Mildly | A compacted topic with a consumer group per process means a restarting process reads the change it missed. SNS pub/sub is fire-and-forget, though a per-instance SQS queue gets most of the way there — and the 5-minute TTL is the backstop either way |

**So the honest split: every job in Flow 3's fan-out is queue-shaped. Only the estimate stream is genuinely log-shaped** — and that is on the quoting side of the system, not the ordering side.

#### The sharpest version of the argument, and it cuts against Kafka

Push the replay case one step further before an interviewer does.

Committed estimates are **already rows** — `estimates` holds `inputs`, `fired_rules` and `total` (Flow 2). Any pricing question about quotes customers actually accepted is a SQL query against a table that already exists, and replay adds nothing. The data that does *not* exist anywhere is the **preview recomputations** — the ~15 per session that are deliberately cache-and-CPU only — and those are precisely the abandoned-quote funnel that makes the pricing question interesting.

Which means the replay argument justifies **a log**, not **Kafka specifically**. And the cheapest durable log for "append 600 events/s, query them months later" is **Kinesis Firehose into S3, queried with Athena** — cheaper than MSK, no brokers, and a better fit for analytical scans than a Kafka topic is. Volunteer that. It is the difference between having chosen a tool and having compared it.

#### Two defensible positions

**Position A — SNS + SQS.** Correct if the scope is what Flow 3 actually does: confirm an order, notify a customer, allocate a crew. Three fan-out consumers, ~8 events/s, no replay requirement, dead-lettering and alarms for free, and a bill that rounds to zero. *For a regional landscaper this is the right-sized answer, and saying so first is what makes you credible on the rest.*

**Position B — Kafka.** Correct if `estimate.events` is in scope from the start and you want one substrate for both the transactional fan-out and the replayable stream rather than running an event bus and a data pipeline side by side. The `pricing.rules` compacted topic is a real second dividend. *This is what was built, and it is defensible — but it is defensible on retention and consolidation, never on throughput.*

**What I would build today:** SNS + SQS for the booking fan-out, and Firehose → S3 → Athena for the estimate stream. That covers both requirements for a fraction of the cost, at the price of two systems instead of one. Kafka becomes correct again the moment a third or fourth service needs the same ordered stream — which is where this was heading and never arrived.

## Data model (PostgreSQL tables)

Postgres stores rows in tables with typed columns; an index on a column (`user_id`, `stripe_event_id`) turns a full table scan into a lookup, and a **constraint** makes an invalid state impossible to write rather than merely unlikely.

| Table | Holds | Key constraints & indexes |
|---|---|---|
| `users` | email, bcrypt hash, role enum, profile | `UNIQUE (lower(email))` |
| `pricing_rules` | pricing rules as rows, condition in JSONB (above) | `(service, priority) WHERE active` (partial) |
| `estimates` | `inputs` / `line_items` / `fired_rules` JSONB, `total numeric` | FK → `users`; `(user_id, created_at DESC)` |
| `bookings` | estimate ref, `quoted_total numeric`, schedule, status enum | FK → `estimates`, `users`; `(status, scheduled_for)` |
| `payments` | Stripe session/event ids, amount, status | FK → `bookings`; `UNIQUE (stripe_event_id)` (idempotency) |
| `outbox` | topic, partition key, JSONB payload, `published_at` | partial index on `(id) WHERE published_at IS NULL` |

The hybrid is the point: an estimate's *inputs* are a naturally nested blob read and written as a unit, so they stay in JSONB — but its `total`, and the foreign keys tying estimate → booking → payment, are exactly the things that must never drift, so they get typed columns, `NOT NULL`, and referential integrity. Schema changes ship as **versioned migration files** applied on deploy, which also gives every schema change a reviewable diff in git.

## Capacity & scaling (300 req/s → 900 req/s, and why it grew)

**Every number here is a load-tested ceiling, not organic traffic — always say it that way.** "The tier *held* 900 req/s under load test" invites *"how did you measure it?"*, which you can answer. "The site *served* 900 req/s" invites arithmetic about a Surrey landscaping company, which you cannot win.

### Why it scaled at all: a Metro Vancouver traffic curve, not a big number

This is the honest driver, and it is a better story than volume. Turfco works Surrey and the Lower Mainland — one metro, one timezone, one climate — and that produces a demand curve with two hard shapes:

- **Seasonal.** The BC coast has a long growing season and a wet, mild winter. Spring cleanup runs March–May, fall cleanup September–October, and those months *are* the business; December through February is pruning and not much else. Peak weeks run roughly **10× a January week**, and the first warm Saturday of the year is reliably the worst hour of the year. A promo email to the customer list spikes the estimate endpoint for an afternoon.
- **Daily.** Every customer is in Pacific time, so traffic collapses into a ~14-hour window and is effectively zero overnight. There is no follow-the-sun smoothing to flatten it.

A single fixed instance is the wrong shape for that curve in both directions at once: oversubscribed during the three months that generate the revenue, and idle-but-paid-for through the winter and every night. **That is what the autoscaling group is for** — a peak-to-trough ratio, not a headline request rate. Say it that way and the architecture stops looking speculative for a regional landscaper.

### The measured progression

| | Before | After |
|---|---|---|
| Compute | 1 × t3.small (2 vCPU) | ASG across 2 AZs — **2 steady, 4 at seasonal peak**, max 6 |
| Static assets | Nginx on the app instance | S3 + CloudFront, cached at the Vancouver/Seattle edge |
| Cache | Redis container on the box | ElastiCache Redis (`cache.t4g.micro`), survives instance replacement |
| Database | RDS single-AZ | RDS **Multi-AZ** (`db.t4g.small`), automatic failover |
| Ceiling | **300 req/s @ <100 ms p95** | **900 req/s @ <120 ms p99** |

**The 3× is not four instances doing four instances' worth of work, and an interviewer will check that.** Four small instances is 4× the vCPU and measured out at 900, roughly 75% scaling efficiency. Two things bought the difference between "4× the boxes" and "4× the throughput" being nearly the same number:

1. **Static serving left the app tier entirely.** CloudFront absorbs `GET /` and every asset at the edge, so instances now do nothing but `/api/*`. On the old box, static requests and API requests competed for the same event loop.
2. **Burstable credit stopped being a caveat.** A t3.small is CPU-credit-limited, so the old 300 req/s was a number a short test could burst to and a sustained load could not hold. The ASG runs T3 Unlimited with a scale-out policy, so 900 is a sustained ceiling rather than a burst one.

The honest remainder — the ~25% lost to ALB hops, a network round trip to ElastiCache that used to be a localhost call, and coordination on the single Postgres writer — is worth volunteering. Linear scaling claims are the ones that get probed.

### What the client is actually asking for

Before the database question, the browser question: **what are those 900 requests?** They are `/api/*` calls and nothing else. Every `GET /`, every JavaScript bundle, stylesheet and image stops at CloudFront and never reaches the ALB, so static traffic contributes **zero** to this number.

One customer getting a quote and booking a job generates roughly twenty API calls over a two-to-three minute session:

| What the customer does | Call the SPA makes | Per session |
|---|---|---|
| Opens the site | `GET /`, JS, CSS, images | **0 — CloudFront, never reaches the API** |
| SPA boots | `GET /api/services` (catalog for the form dropdowns) | 1 |
| Is a returning user | `POST /api/auth/refresh` (new access token from the cookie) | ~1 |
| **Adjusts the quote form** — service, lot size, frequency, slope, fenced, add-ons | `POST /api/estimates/preview` | **~15** |
| Accepts the quote | `POST /api/estimates` (persists the row) | ~1 |
| Looks at past quotes and jobs | `GET /api/estimates`, `GET /api/bookings` | ~3 |
| Books and pays | `POST /api/bookings`, then `POST /api/bookings/:id/checkout-session` | ~0.3 each |
| Payment completes | `POST /api/webhooks/stripe` | **not client traffic** — Stripe calls the API server-to-server |

**Three quarters of the traffic is one endpoint, and it is not one request per customer.** The quote form recalculates every time an input changes — pick "aeration", type a lot size, flip weekly to biweekly, tick "sloped" — and each of those is a debounced `POST /api/estimates/preview` returning a fresh price breakdown. That is what makes the estimator the hot path: not 600 people per second asking for a quote, but far fewer people each firing fifteen recomputations while they play with the form. It is also why the cache-and-CPU-only design of that endpoint (Flow 2, step 5) is load-bearing rather than a micro-optimisation.

**So how many people is 900 req/s?** At ~20 calls over ~180 seconds, one session in progress produces ~0.11 req/s, which puts 900 req/s at roughly **8,000 concurrent quoting sessions**. State that number yourself rather than letting an interviewer derive it, because it makes something obvious: **8,000 people simultaneously configuring lawn quotes is not a Surrey landscaping company.** Real peak — the first warm Saturday, spring cleanup — was on the order of **a request every ten seconds**, four orders of magnitude below the ceiling.

**Which raises the right question: why build for a ceiling nobody needed? The answer is that nobody did.** 900 req/s was never a target; it is what the *smallest configuration meeting the availability requirements* happened to measure at. The requirements were: survive an AZ, deploy without downtime, and absorb a ~10× seasonal swing without manual intervention. The smallest thing that does all three is two instances behind a load balancer with a shared cache — and two instances behind a load balancer with a shared cache holds 900 req/s whether or not you want it to. **The throughput is a byproduct you measured, not a goal you designed for**, and saying so converts the number from a liability into evidence that you know what your system does.

### Where the 900 req/s actually lands

**900 req/s is HTTP requests arriving at the ALB, not queries reaching Postgres.** Be exact about this, because the two numbers differ by more than 3× and an interviewer asking which one you mean is checking whether you measured or guessed.

The gap is what the cache is for. A representative peak-hour mix, and what each slice costs the database:

| Slice of the 900 req/s | Rate | What Postgres sees |
|---|---|---|
| Estimate **recomputation** (customer adjusting the form) | ~600/s | Almost nothing — rule set comes from ElastiCache; only cache misses read, ~5/s |
| Authenticated reads (my quotes, my bookings, service catalog) | ~180/s | ~180/s indexed point lookups |
| Auth (login, refresh) | ~60/s | ~20/s — JWT *verification* is a local signature check and touches no database at all |
| Estimate **persistence** (customer commits a quote) | ~40/s | ~40/s `INSERT` |
| Booking creation | ~12/s | ~12/s write |
| Stripe webhooks | ~8/s | ~24/s — each is one transaction of payment insert + booking update + outbox insert |
| **Total** | **~900/s** | **~280 queries/s, of which ~75 are writes** |

Roughly a **3:1 request-to-query ratio**. Three design choices produce it, and they are the answer to "how":

1. **Estimate recomputation does not touch the database.** The form recalculates on every input change, and the rule set it evaluates against comes from ElastiCache. Only the quote a customer actually commits becomes a row — so the endpoint that dominates traffic contributes almost nothing to database load.
2. **JWT verification is a local signature check.** Stateless auth means the per-request identity check is CPU, not a session lookup. At 900 req/s a server-side session store would have been an extra ~900 reads/s on its own, and it is the single biggest reason the ratio is what it is.
3. **The rule cache has a tiny key space and a low change rate** — a handful of service keys on a 5-minute TTL — so the hit rate sits well above 99% and misses are a rounding error.

~280 queries/s with ~75 writes is comfortable on a `db.t4g.small`: the working set for a regional landscaper fits in shared buffers, so the reads are memory-resident index lookups, and 75 commits/s is well inside what WAL group commit absorbs even with Multi-AZ synchronous replication.

**Where it would break, and it is the writes.** Persisting *every* recomputation instead of only committed quotes would put ~640 inserts/s on the primary — roughly 8× the write load, and the first thing to fall over. If the product ever needed that (full funnel analytics on abandoned quotes, say), the answer is not a bigger instance: it is to publish those recomputations to `estimate.events` and let the analytics consumer own them, keeping the transactional database out of the path entirely. That is precisely the shape Flow 4 already has.

### What was deliberately *not* built

This is the part to lead with, because right-sizing is the actual skill on display:

- **No read replica.** Reporting and admin analytics run against the writer, and at this volume that is fine. A replica is one line in the growth path and was never justified.
- **No PgBouncer.** Four instances with per-process pools capped at ten, plus the consumer workers, sit well under a `db.t4g.small`'s connection limit. Adding a pooler before the arithmetic demands one is complexity bought with nothing.
- **No microservices, no Kubernetes.** The topology is one container image behind an ALB plus a separate consumer service. That is all of it.
- **Kafka is still justified on decoupling and replay, never on throughput** (Flow 4). At 900 req/s the brokers are close to idle. The load it removes is not requests per second — it is a third-party email call sitting inside a webhook handler that Stripe will retry. Volunteer that framing before you are asked.

**Every step that was taken was bought with a bottleneck that had been measured first, and the ones that were never measured were never built.** That is the sentence worth saying — not that it scaled, but that each piece had a number behind it.

**Growth path from here**, scoped and deliberately unbuilt: PgBouncer when instance count × pool size approaches the connection limit → a read replica when reporting starts affecting write latency → partition `estimates` by month → split the estimator into its own service. The event backbone makes the last one cheap, since a split-out estimator already publishes `estimate.events` and its consumers do not change.

## Deployment

**One AWS region — `ca-central-1` — with CloudFront in front of the SPA, an ALB in front of a small autoscaling Express tier, and managed Postgres, cache, and Kafka behind it.** This is the specific answer to "where did it run":

- **Region: `ca-central-1` (Montreal), and the customers are in BC.** This is a deliberate trade worth being able to defend. `us-west-2` (Oregon) is ~15 ms from Vancouver against Montreal's ~60 ms, so proximity argues for Oregon. Keeping Canadian customers' personal information and payment records in Canada argues for Montreal — under PIPEDA and BC's PIPA it is not a hard requirement for a private company, but it removes the cross-border-transfer conversation entirely, and for a business whose customers are all in one province that simplicity is worth 45 ms. **The design absorbs the cost rather than paying it per request:** static assets are served from CloudFront's Vancouver and Seattle edges, and the SPA means the origin hop happens on API calls only.
- **Static tier** — the React build is compiled by a multi-stage image build and published to **S3**, served through **CloudFront** with long-lived cache headers on hashed asset filenames and a short TTL on `index.html`. TLS terminates at the edge.
- **API tier** — the Node.js/Express container in an **Auto Scaling Group across two availability zones**, **2 instances steady and 4 at seasonal peak**, behind an **Application Load Balancer**. Scaling is on ALB request-count-per-target with CPU as a secondary signal. Two instances is the floor rather than one because it is what makes an AZ failure and a **zero-downtime rolling deploy** both survivable; overnight it scales back to that floor. WAF handles auth-endpoint rate limiting, the job Nginx used to do.
- **Amazon RDS for PostgreSQL, Multi-AZ** (`db.t4g.small`), in private subnets, reachable only from the API tier's and consumers' security groups, never from the internet. No read replica — see above.
- **ElastiCache for Redis** (`cache.t4g.micro`) — the shared pricing-rule cache, now genuinely shared rather than one container's memory, so an instance the ASG launches mid-spike does not warm its own cache from Postgres at the moment Postgres is busiest.
- **Amazon MSK Serverless** for Kafka, with the outbox relay and the notifier / scheduler / analytics consumers running as their own small service, **scaled independently of the API tier**. A backlog of confirmation emails should not require more web capacity to drain.
- **Migrations** run as a one-off task gated ahead of the rolling deploy, so a new image never starts against a schema it has not seen.

**Why managed Postgres and not a Postgres container on the app host:** a database container on the app host shares its fate. One `docker compose down -v` on a tired evening, one full disk from unrotated logs, and the payment history is gone — and nothing about running `pg_dump` on a cron and hoping the file is restorable is worth the ~$15/month saved. Once the app tier became an autoscaling group the argument stopped being a judgment call altogether: instances are *designed* to be terminated and replaced, so no durable state can live on one.

### What is multi-AZ, what is not, and why

An interviewer who is paying attention will notice that the database is Multi-AZ and the cache is a single node, and ask why. Having the principle ready turns an apparent inconsistency into the most concrete evidence of judgment in the whole design:

| Component | Spread across AZs? | Why |
|---|---|---|
| **API tier (ASG)** | **Yes** | Free. The floor is already two instances for zero-downtime rolling deploys, so putting those two in different subnets costs the same instance-hours — only cents of cross-AZ transfer |
| **RDS Postgres** | **Yes, Multi-AZ** | Stateful and irreplaceable, and failover has to happen with nobody awake |
| **ElastiCache Redis** | **No — one `cache.t4g.micro`** | Derived and disposable. If it dies, Express falls back to Postgres and repopulates; the cache is never the system of record, so a second node buys latency insurance, not correctness |
| **MSK Serverless** | Yes, by default | AWS's problem, not a decision I made |
| **Outbox relay & consumers** | **No — single task each** | A benign single point of failure. Events accumulate as unpublished rows and drain when the task returns; nothing customer-facing depends on them |

The rule underneath: **stateful and irreplaceable gets redundancy; derived and disposable does not.** Applied consistently, it is also what kept the bill small.

#### Is Multi-AZ RDS actually justified here?

It is the weakest remaining piece of the architecture and worth being able to argue honestly, because a single-AZ instance plus PITR is a defensible alternative and pretending otherwise is how you lose the exchange.

**What it does not buy:** protection of the data. Point-in-time recovery does that, and single-AZ RDS has PITR too. Anyone defending Multi-AZ by pointing at the value of the records has misidentified the product.

**What it does buy, and why it is worth ~$25–30/month here:**

1. **The seasonality makes downtime spiky in cost.** Roughly ten weeks a year are the business. The first warm Saturday in spring is the single highest-revenue day of the year, and a customer who finds a broken quote form phones a competitor rather than coming back on Monday. Single-AZ instance failure means waiting on AWS auto-recovery — commonly ten to twenty minutes, occasionally much worse. Multi-AZ fails over in 60–120 seconds, automatically.
2. **You cannot buy availability only for the weeks you need it.** Hardware does not fail on a schedule you choose, which is precisely why "it's only really critical in March" is an argument *for* paying year-round, not against.
3. **Minor-version patching stops needing a maintenance window.** Multi-AZ patches the standby and fails over. Single-AZ needs a window somebody schedules and watches — and on a one-person team that window either never happens, so the database runs unpatched, or it happens unattended. This is the same constraint that decided RDS over EC2 in the first place.
4. **It needs zero humans.** Everything else in this system was chosen against that standard.

**The honest concession:** through December to February it buys nothing at all, and a smaller operation could reasonably run single-AZ with PITR and accept a rare twenty-minute outage. Say that before being asked. The counter is point 2, and it is a good one.

### Database: RDS, or PostgreSQL on EC2 with EBS?

**Decision: Amazon RDS for PostgreSQL, Multi-AZ.** Not close — and the scale-up only widened the gap.

The comparison worth having is not against a database container on the app host — it is against the serious self-managed option: Postgres on an EC2 instance with its data directory on a dedicated **EBS** volume. EBS deserves the credit it gets. It is network-attached rather than local disk, it survives instance termination when delete-on-terminate is off, it is replicated within its AZ, and it snapshots incrementally to S3. Durability of the disk is not where this is decided.

| | Postgres on EC2 + EBS | Amazon RDS |
|---|---|---|
| **Recovery granularity** | EBS snapshots: crash-consistent volume copies at whatever interval you schedule. Restore = the last snapshot; everything after it is gone | Continuous WAL archiving → **point-in-time recovery to any second** in the retention window |
| **Minor-version patching** | Yours, in a window you schedule and remember | AWS, in a window you pick |
| **Failover** | Build it (streaming replica + promotion + a runbook someone executes at 2am) or accept the downtime | **Multi-AZ is a checkbox**; synchronous standby, automatic failover, DNS cutover |
| **Read scaling** | Build and monitor your own replica | Read replica in a few clicks when it is finally needed (it was not) |
| **Backup *restorability*** | You verify it, or you discover it during the incident | Restore is a documented, exercised path |
| **Fate-sharing with the app** | Colocated: a Node leak that trips the OOM killer, a full disk from unrotated logs, an instance retirement — each reaches the database | Separate instance, separate failure domain |
| **Cost** | ~$5–8/mo of EBS + your hours | ~$12–15/mo (`db.t4g.micro`) |
| **Superuser / arbitrary extensions** | Yes | Restricted to the supported extension list |

Four things decide it:

1. **PITR is the feature, not "backups."** The realistic disaster is not a dead disk — EBS handles that. It is a bad migration or a mistyped `UPDATE` at 11pm. RDS rewinds to thirty seconds before it ran. A nightly EBS snapshot loses the day, and the data being lost is payment history.
2. **One technical person.** Every task the EC2 option adds — patching, scheduling snapshots, *testing that a snapshot actually restores*, tuning `shared_buffers`, watching the volume fill — is work for a team with nobody to hand it to. The closing section of this doc is exactly that story: the app was retired because no maintainer was left. Picking the option with more to maintain would have been the wrong bet even while I was still there.
3. **Fate-sharing, and then the ASG made it non-negotiable.** The argument against a Postgres container beside the app applies just as well to Postgres on the same instance with an EBS volume. Giving the database its own EC2 instance removes the fate-sharing — and has now rebuilt a worse RDS by hand, with patching and failover still unbuilt. Once the app tier is an autoscaling group across two AZs, a self-managed single-AZ Postgres is also the one component that can take the whole system down while every app instance is healthy.
4. **Multi-AZ failover is the piece you would never actually build.** Everyone intends to set up streaming replication with automatic promotion. Almost nobody on a one-person team does, and fewer still ever test the failover. RDS makes it a checkbox and a reboot. **Do not defend this one on "$25/month against $600K of records" — that conflates two different products.** Durability of those records is already bought by PITR, which single-AZ has too. Multi-AZ buys *uptime*, and uptime has to be justified separately; see below.

The monthly difference is roughly one coffee. The EC2 option's real price is denominated in hours — and after the scale-up, in an availability story that would not have held.

**Where EC2 + EBS would genuinely win** — none of it true here: a Postgres extension or `shared_preload_libraries` entry outside RDS's supported list; superuser access; a major version RDS has not shipped yet; or scale large enough that RDS's premium over raw compute becomes real money. If a requirement lands in that list, self-managed is correct and the operational burden is simply its price.

**One RDS detail the Kafka design leans on:** the outbox relay's upgrade path is Debezium reading the write-ahead log. RDS for PostgreSQL supports that — set `rds.logical_replication = 1` in a custom parameter group, reboot, and logical replication slots work. Choosing managed does not close the CDC door.

**Why a rented cloud VM and not an on-prem office machine:** Stripe webhooks require a publicly reachable, always-up HTTPS endpoint — an office box behind a consumer ISP means non-static IP, router port-forwarding, and outages that silently drop payment confirmations (a paid-on-Stripe / unconfirmed-in-app mismatch). Add no backups, no physical security on a machine touching payment flows, and the economics ($6–15/month for a VPS with snapshots) and the VM wins on every axis that matters. Naming **AWS + RDS** on a resume also carries the highest keyword recognition.

Interview one-liner: *"It started as one small EC2 instance holding 300 req/s under load test. Turfco works Metro Vancouver, and landscaping demand there is seasonal — spring and fall cleanup run about 10× a January week — so it grew into a CloudFront-fronted SPA and a two-to-four instance autoscaling Express tier behind an ALB across two AZs on Multi-AZ RDS, holding 900 req/s at sub-120 ms p99. Side effects moved off the request path onto Kafka through a transactional outbox, so the Stripe webhook commits and returns in one transaction and an email provider outage can't trigger redeliveries. It took $600K+ in online bookings over eighteen months. Every step was bought with a measured bottleneck — no read replica, no PgBouncer, no Kubernetes, because none of those ever had a number behind them."*

## Security checklist

- bcrypt password hashing; JWTs signed with a strong secret; refresh token in httpOnly+Secure cookie
- Input validation on every route (e.g. Joi/zod) — the estimator especially, since its inputs drive pricing
- **Parameterized SQL everywhere**; no query built by string concatenation, so a crafted estimate input cannot become SQL
- Least-privilege database role for the app (DML only — no `DROP`, no schema changes at runtime; migrations run under a separate role)
- Stripe webhook **signature verification**; card data never touches the server (hosted Checkout)
- CORS locked to the app origin; Helmet security headers; **AWS WAF rate limiting on `/api/auth/*`** at the load balancer, so brute-force traffic is rejected before it reaches an app instance
- API instances and the database in **private subnets** — the ALB and CloudFront are the only public surface; Kafka brokers reachable only from the API tier and consumer security groups
- Kafka event payloads carry ids and status, never card data or full PII, so the retention window is not a liability
- Role-based access middleware: customers can only read their own estimates/bookings; only admins mutate rules

## Business impact (and the arithmetic behind every number)

**Never quote a dollar figure you cannot derive out loud.** Each of these comes from a query the app could actually run, and the derivation is what makes it survive a follow-up.

### The headline

Over the eighteen months the system ran (Jan 2023 – Jun 2024) it took **$600K+ in online bookings** across roughly **1,100 self-serve orders**, and collected about **$150K in deposits** at the moment of booking.

### Where each number comes from

| Number | Derivation | Sanity check |
|---|---|---|
| **~1,100 confirmed bookings** | `COUNT(*) FROM bookings WHERE status = 'confirmed'` | ≈61/month, ≈2–3 per working day. For a Metro Vancouver landscaper running several crews, that is a modest share of total jobs, not all of them |
| **~$550 average order value** | `AVG(quoted_total)` | A blended mix: aeration $150–250, spring or fall cleanup $400–700, a fertilizing program $300–450, a seasonal biweekly mowing package $900–1,400. $550 sits low in that range on purpose |
| **$600K+ in bookings** | `SUM(quoted_total)` over confirmed bookings | 1,100 × $550 ≈ $605K. If Turfco does $2–3M/year, this is a new channel carrying **~15–20% of revenue** — plausible for a channel that did not exist before, and clearly not "all of it" |
| **~$150K in deposits** | `SUM(amount) FROM payments WHERE status = 'paid'` | The deposit is 25% of the quoted total, so this follows arithmetically from the line above |
| **~40% booked outside office hours** | `created_at` bucketed against the 8–5 Pacific office window | Every customer is in one timezone; evenings and weekends are exactly when a homeowner thinks about their yard |

### Which claim to actually make

**Say "took $600K+ in online bookings." Do not say "generated $600K+ in additional revenue."** The first is a fact from the payments ledger and you can produce the query. The second is an incrementality claim, and the obvious rebuttal is that some of those customers would have phoned in anyway — an interviewer who spots that has caught you, and the number is impressive enough without the upgrade.

If you *are* pushed on incrementality, the honest and still-strong answer is the after-hours slice: **~40% of online bookings were placed outside office hours**, when the phone line was unstaffed. A homeowner deciding at 9pm on a Sunday either books online or calls a competitor Monday morning. That share is genuinely captured demand, not redirected demand.

### The second-order effects worth mentioning

- **Cash moved forward.** A 25% deposit at booking rather than payment on completion changed the working-capital position of a business whose costs are heaviest in exactly the season its receivables are slowest.
- **Deposits reduced no-shows.** A booked job with money against it does not evaporate the way a free phone booking does — and a cancelled slot in peak season is a crew standing still on the most valuable day of the year.
- **Quoting labour came off the owner.** ~2 days to under a minute was not just a customer-experience number; it removed a daily task from the person whose time was worth the most.
- **Seasonal repricing stopped needing me.** Staff ran spring and fall price changes themselves, which is why the pricing console mattered more than its size suggests.

> These figures are **reconstructed to be internally consistent and conservative, not recalled from records.** Before putting them on a résumé, check them against whatever Turfco actually did and adjust — the structure above is what matters, because it means any number you substitute still has a derivation behind it.

## Resume bullets (Action–Method–Impact)

### How the bullets divide the system

Four bullets, each owning a different **axis** so no two compete for the same follow-up question:

| # | Owns | Axis | Carries the number |
|---|---|---|---|
| 1 | Quoting & pricing | a feature domain — correctness and admin autonomy | time (~2 days → <1 min) |
| 2 | Ordering, payment & fulfilment orchestration | a feature domain — money and async work | money ($600K+) |
| 3 | Scale & latency | a systems property — behaviour under seasonal load | throughput (900 RPS, p99) |
| 4 | SPA & auth | the delivery and identity layer — reach and permission | qualitative |

**Why 3 and 4 are split rather than merged.** Bullets 1 and 2 are *what the business got*. Bullet 3 is *how the system behaves under load*. Bullet 4 is *how users reach it and who is allowed to do what*. Those last two are genuinely different conversations — one is CloudFront, autoscaling and p99; the other is JWT design, refresh rotation and role gating. Merged, the bullet's verb ("held 900 RPS") governs contents it has nothing to do with ("httpOnly refresh cookies"), and an interviewer pulling on it has to pick a thread at random. The test for a bullet is whether it supports ten minutes of coherent questioning; four bullets pass it, and a merged third does not.

**Where the technologies live, and why two are missing.** Redis sits in bullet 1 because the cache is what makes quoting both *fast and fresh* — write-invalidation is a pricing-correctness property, not an infrastructure one, and putting it in bullet 3 would split one idea across two bullets. Kafka sits in bullet 2 because the workers exist to finish an order. **Nginx is not named anywhere**: it was superseded by CloudFront and the ALB when the app tier stopped being one box, and claiming it now contradicts the deployment section. **PgBouncer is not named either** — the capacity section says plainly that it was never built because the connection arithmetic never demanded it, and "deliberately not built" is a stronger answer than a keyword.

### The bullets

1. **Architected a self-serve quoting platform** that priced jobs from admin-editable rule rows with deterministic multi-stage evaluation, JSONB-encoded conditions, per-quote audit trails of every rule applied, and a **write-invalidated distributed Redis rule cache** that made a price change visible on the next quote rather than at TTL expiry, **cutting quote turnaround from ~2 days to under a minute and seasonal repricing from a developer deploy to an admin edit**.

2. **Built the online ordering and booking platform end to end** — self-serve order placement, Stripe Checkout deposits, and signature-verified **idempotent payment webhooks** publishing through a transactional outbox to **Kafka consumer workers** for order confirmation, customer notification, and crew allocation — **taking $600K+ in online bookings across ~1,100 orders, with ~$150K collected in deposits at booking and zero duplicate charges**.

3. **Scaled the platform from a single EC2 instance to a multi-AZ AWS deployment**, moving the SPA to CloudFront and the API onto an autoscaling Express tier behind an ALB against Multi-AZ RDS with indexed access paths, **holding 900 RPS at sub-120 ms p99 under load test through ~10× seasonal traffic swings with zero-downtime rolling deploys**.

4. **Delivered the React SPA and its authentication layer** with client-side routing, role-gated admin routes, JWT access tokens backed by httpOnly refresh cookies, and form state validated against the same schema as the API, **serving customer booking and admin operations from a single bundle with no duplicated validation logic**.

Bullet 4 is the only one without a hard number, which is deliberate — the other three carry time, money and throughput, and a fourth number would dilute rather than add. It is also therefore **the natural cut when space is tight**.

### Bullet 2 — SNS + SQS variant (same work, safer keyword)

Same system, same numbers; only the middle of the async path is named differently. Both sentences are true of what was built, because the outbox, the idempotency and the three workers are identical either way — the choice is which tool you want to be asked about.

2. **Built the online ordering and booking platform end to end** — self-serve order placement, Stripe Checkout deposits, and signature-verified **idempotent payment webhooks** publishing through a transactional outbox to **SNS fan-out and FIFO SQS workers** for order confirmation, customer notification, and crew allocation — **taking $600K+ in online bookings across ~1,100 orders, with ~$150K collected in deposits at booking and zero duplicate charges**.

**Which one to send:**

| Situation | Use |
|---|---|
| The job description names Kafka, streaming, or event sourcing | **Kafka version.** It is the keyword they are scanning for, and the concession above is your opening answer |
| An AWS-heavy or serverless-leaning role | **SNS + SQS version.** At ~8 events/s it reads as right-sizing, which is the judgment those teams screen for |
| A small team, or anywhere cost-consciousness is the culture | **SNS + SQS version.** Kafka at a landscaping company invites the "why?" before it earns the credit |
| You have not rehearsed the retention-and-replay answer | **SNS + SQS version.** Never carry a keyword you cannot defend |

Naming SQS costs you a resume keyword and buys you a bullet nobody challenges. Naming Kafka buys the keyword and costs you the first follow-up. Both are honest; pick per posting.

### Three-bullet condensed variant (when the page is full)

Bullets 1 and 2 unchanged; bullet 3 absorbs the delivery layer. This merge works where the other one would not, because "delivered the thing users touch, and here is how fast it is" is a single arc:

3. **Delivered the React SPA and JWT-authenticated API** behind CloudFront and an autoscaling ALB tier across two availability zones on Multi-AZ RDS, **serving customer booking and role-gated admin operations from a single bundle at 900 RPS and sub-120 ms p99 through ~10× seasonal peaks**.

> **Before using — verify every number.** The defensible framings, in the exact words to use:
>
> - **"Took $600K+ in online bookings"** — never "generated $600K+ in additional revenue." The first is a `SUM(quoted_total)` you can produce on demand; the second is an incrementality claim whose rebuttal ("some would have phoned in") is obvious. If pushed, fall back to the ~40% after-hours slice, which is genuinely captured demand. Full derivation in *Business impact* above.
> - **"The tier *held* 900 RPS at sub-120 ms p99 under load test"** — never "the site *served* 900 RPS." The first invites *"how did you measure it?"*, which you can answer. The second invites arithmetic about a Surrey landscaping company, which you cannot win.
> - **The seasonality is why the architecture is the size it is.** Spring and fall cleanup in the Lower Mainland run ~10× a January week, and every customer is in one timezone so nights are dead. That is a peak-to-trough argument, not a volume argument — lead with it if anyone asks why a landscaping company has an autoscaling group.
> - **"Zero duplicate charges"** is a claim about a unique constraint you can name, not about luck: `UNIQUE (stripe_event_id)` on payments, `PRIMARY KEY (event_id, channel)` on notifications, insert-then-send.
> - **"Write-invalidated"** invites *"invalidated how, and what happens if that fails?"* — the answer is `DEL` on the admin write, a five-minute TTL as the backstop, and a `pricing.rules` Kafka topic so a process that was restarting still gets the change (Flow 4). Know it before you write the word.
> - **~2 days → under a minute** should be replaced with Turfco's real quoting turnaround if you have it.

## What happened to the app

For the requirements at the time — self-serve quotes and online deposit collection through a seasonal traffic curve — the system did its job. But I was the only technical person on the team, and after I left there was nobody to manage it: even a well-behaved custom app needs *someone* who can read a CloudWatch alarm, roll a deploy back, renew a credential, or work out why a consumer group's lag is climbing.

For a non-technical team, "the website is doing something weird and nobody here can look at it" is a real operational risk. So they retired it and consolidated to a simple builder-style marketing site — which is what runs at turfcolandscape.com today, a pure lead-gen site with a "Start my project" CTA and no login, booking, payments, or quote tool. Phone calls and in-person quoting absorbed what the app used to do; honestly, the correct call once the maintainer was gone.

This is one of the most common arcs in small-business software: commission a custom app, later realize the ambition outgrew the need, and retire it. **Do not hide this in an interview — it is the strongest judgment story in the project.** The scale-up was correct while there was someone to operate it, and the retirement was correct once there was not; both calls were made against the same standard as the decision never to build microservices for this traffic. Knowing when custom software stops being worth its upkeep is the same skill as knowing which bottleneck is worth a load balancer.

## Likely interview follow-ups

- *Why Postgres over MongoDB?* → the hot path is money moving through estimate → booking → payment, where I want foreign keys, a unique constraint doing webhook idempotency, and one transaction confirming a booking and recording its payment together. JSONB covers the genuinely schemaless parts (rule conditions, estimate inputs) without giving up any of that. (Concede: Mongo would also work fine — the idempotency and atomicity would just move into application code and be mine to get right.)
- *Why is the webhook the source of truth instead of the redirect?* → redirect is client-controlled and skippable; webhook is signed, server-to-server, retried by Stripe.
- *What happens if two rule edits conflict?* → rules apply by `priority`; estimates snapshot fired rules, so past quotes are immune to edits.
- *Why JSONB for conditions instead of columns?* → conditions are heterogeneous per rule type and only ever read as a whole by the evaluator; modeling them as columns means a migration every time a new condition shape appears, and most rows NULL.
- *How would you scale it 100×?* → see growth path above — and lead with "measure first."
- *Why does a landscaping company need an autoscaling group?* → the traffic curve, not the traffic volume. Spring and fall cleanup run an order of magnitude over winter, a promo email spikes the estimate endpoint for an afternoon, and the first warm Saturday is the worst hour of the year. One fixed instance is oversubscribed for the three months that make the money and idle-but-paid-for through the winter. Autoscaling fits a peak-to-trough ratio, not a headline number.
- *Where did the 3× actually come from, and why isn't it 4×?* → four instances is 4× the vCPU and measured 900, about 75% efficiency. Static serving left the app tier for CloudFront and T3 Unlimited made the ceiling sustained rather than burstable; the ~25% lost is ALB hops, a network round trip to ElastiCache that used to be a localhost call, and coordination on the single writer. Volunteer the loss — linear scaling claims are the ones that get probed.
- *Why `ca-central-1` when the customers are in BC?* → Oregon is ~15 ms from Vancouver, Montreal ~60 ms. Keeping Canadian customers' PII and payment records in Canada removes the cross-border-transfer conversation under PIPEDA and BC's PIPA, and for a business whose customers are all in one province that is worth 45 ms. The design absorbs it rather than paying per request: static comes from CloudFront's Vancouver edge, and the SPA means the origin hop happens on API calls only.
- *How do you know the $600K number?* → `SUM(quoted_total)` over confirmed bookings — it is the payment system's own ledger, not an estimate. **Do not upgrade it to "additional revenue"** unless asked; some of those customers would have phoned in. The defensible incremental slice is the ~40% booked outside office hours, which the phone line could not have captured.
- *What is your scaling signal?* → ALB request-count-per-target, with CPU secondary. Request count leads CPU on this workload because the hot path is cached rule evaluation — the tier saturates on concurrency and event-loop latency well before CPU looks alarming.
- *What is actually generating 900 req/s?* → `/api/*` only — static stops at CloudFront. About three quarters is `POST /api/estimates/preview`, and that is not one call per customer: the quote form recalculates on every input change, so one session fires ~15 of them. Twenty API calls per ~3-minute session puts 900 req/s at roughly 8,000 concurrent quoting sessions.
- *Isn't 8,000 concurrent sessions absurd for a Surrey landscaper?* → yes, and say so first. Real peak was about one request every ten seconds. 900 was never a design target — it is what the smallest configuration meeting the availability requirements (survive an AZ, deploy without downtime, absorb a ~10× seasonal swing unattended) happens to hold. Two instances behind a load balancer with a shared cache holds 900 req/s whether you want it to or not. The number is a measurement, not an ambition.
- *Is 900 req/s application requests or database queries?* → **application requests at the ALB.** Postgres sees roughly 280 queries/s of it, about 75 of them writes. The gap comes from three things: estimate recomputation is served from the rule cache and only a *committed* quote becomes a row, JWT verification is a local signature check rather than a session lookup, and the rule cache's key space is small enough to sit above a 99% hit rate. Full breakdown in *Where the 900 req/s actually lands*.
- *What falls over first at the database?* → writes, not reads. Persisting every recomputation instead of only committed quotes would be ~640 inserts/s, about 8× the write load. The fix would not be a bigger instance — it would be publishing recomputations to `estimate.events` and letting the analytics consumer own them, which is the shape Flow 4 already has.
- *Why Kafka and not SQS/SNS?* → retention and replay. A queue deletes on consume; the estimate stream is the pricing dataset, and I wanted a new consumer group to start at offset 0 and rebuild its view when the question changed. Multiple independent groups on one ordered stream is the other half. (Concede immediately: for the notification fan-out alone, SNS + SQS is cheaper and I would have picked it — this is not a throughput argument.) Full side-by-side, including the sharper version where the replay argument justifies *a log* but not specifically *Kafka*: *The SNS + SQS alternative* above.
- *Why an outbox instead of producing from the handler?* → dual write. Commit-then-publish loses events when the publish fails; publish-then-commit emails customers about bookings that rolled back. No ordering of two systems is safe, so the event becomes a row in the same transaction and a relay publishes it.
- *What if a consumer processes the same event twice?* → Kafka is at-least-once, so consumers are idempotent by unique constraint — `PRIMARY KEY (event_id, channel)` on `notifications_sent`, insert-then-send. Same trick as `UNIQUE (stripe_event_id)` on payments.
- *What is your partition key and why?* → `booking_id`. Ordering holds only within a partition, and same key → same partition, so one booking's confirm/reschedule/cancel stay in order while different bookings run in parallel.
- *What breaks if Kafka is down?* → nothing customer-facing. Bookings confirm in a Postgres transaction, events pile up unpublished in `outbox`, and the relay drains them when brokers return. Kafka is on the side-effect path, never the money path.
- *Is Multi-AZ justified for a landscaping company?* → it is the weakest piece, so answer it precisely. It does **not** protect the data — PITR does that, and single-AZ has PITR. It buys uptime: 60–120 s automatic failover instead of ten-to-twenty minutes of AWS auto-recovery, and patching without a maintenance window nobody was available to watch. Worth ~$25–30/month because ten weeks a year are the whole business and hardware does not fail on a schedule you pick. Concede freely that in January it buys nothing.
- *Why is the database Multi-AZ but the cache a single node?* → stateful and irreplaceable gets redundancy; derived and disposable does not. If ElastiCache dies, Express falls back to Postgres and repopulates — the cache is never the system of record, so a second node would buy latency insurance, not correctness. Same reason the outbox relay runs as a single task: its backlog is durable in Postgres and drains on restart.
- *Why RDS over Postgres on EC2 with EBS?* → point-in-time recovery, and one technical person. EBS is durable; that is not the gap. The realistic disaster is a bad migration, and PITR rewinds to the second while a nightly snapshot loses the day of payment history. Everything EC2 adds — patching, snapshot scheduling, verifying restores — is work with nobody to hand it to.
