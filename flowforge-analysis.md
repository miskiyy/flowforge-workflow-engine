# FlowForge — Principal Engineer Analysis
### Real-Time Multi-Tenant Workflow Orchestration Engine — 4-Day Take-Home

---

## 0. Reality Check Before Anything Else

This brief, taken literally, is 3-4 weeks of work for a small team: a DAG execution engine with retry/backoff, multi-tenant RBAC API (REST + optional GraphQL), a real-time dashboard with WebSocket/SSE, two data stores with a justified split, Docker + CI/CD + an AWS architecture doc, full test pyramid + a Git history with a PR review, and an LLM feature with prompt-engineering docs — in **4 days**, solo.

That's the first real signal: **this is not primarily a "can you build all of this" test — it's a "what do you cut, and how do you justify it" test.** Any candidate who submits all 15 items at uniform depth either (a) has boilerplate from a previous project, or (b) skimped on quality everywhere to hit breadth, which is worse than doing 60% of it well. A principal engineer reviewing submissions is going to reward someone who explicitly scoped down and stated why, over someone who claims to have "finished everything."

**Recommended posture for the actual submission:** build A, B, D fully; build a deliberately minimal C and G; do E and F as thin-but-real slices; and write one paragraph per cut area in the README explaining the trade-off. This document assumes that posture and flags it wherever relevant.

**Note:** Sections 1-15 describe that scoped-down MVP posture. Sections 16-18 at the end are full-depth build-outs of the dashboard, infrastructure, and AI feature — for when there's more time/tooling available than the 4-day solo constraint assumes.

---

## 1. Requirement Decomposition

| Area | Letter | Real ask | Depth needed for MVP |
|---|---|---|---|
| Execution engine | A | DAG parse, topo sort, parallel/sequential execution, retries, timeout | **Full** — this is the core skill being tested |
| API layer | B | CRUD + versioning, triggers, tenant isolation, JWT+RBAC, validation | **Full** — REST only, skip GraphQL |
| Dashboard | C | Live status, DAG viz, run history, health panel, caching | **Thin** — one real-time view, not five polished ones |
| Data layer | D | Relational schema, log store strategy, query optimization, migration | **Full** — schema + one EXPLAIN + one migration, not a full migration framework |
| Infra | E | Dockerfile, compose, CI, architecture doc | **Thin-but-real** — compose must actually run; arch doc can be a diagram + prose, no IaC code |
| Code quality | F | Git hygiene, tests, REVIEW.md, README | **Full** — cheapest area to get right and most visible to a reviewer |
| AI feature | G | One of three options, with prompt-engineering write-up | **Thin** — pick natural-language-to-DAG, smallest surface area |

**Hidden dependency chain:** D blocks A (engine needs schema to persist state) and B (API needs schema to serve). C blocks on A+B emitting events. G blocks on A+B existing to generate against. So the build order is forced regardless of how the sections are numbered: **D → A → B → (C, G) → E wraps everything → F is continuous.**

---

## 2. Hidden Requirements

These aren't stated outright but are implied by the language used, and missing them is what separates a pass from a strong pass:

1. **"Founding engineer" framing** — they want to see judgment under ambiguity and cost-consciousness, not just correctness. Every unjustified dependency or service is a small mark against you.
2. **"Not just whether it works"** — this is explicitly telling you the README's trade-offs section and REVIEW.md carry real weight. Don't treat them as an afterthought.
3. **"Justify your choice" (data layer)** and **"document your prompt engineering approach"** — they want written reasoning artifacts, not just code. Budget real time for these, not 10 minutes at the end.
4. **Retry logic "exponential backoff, max retries" + "global workflow timeout"** — implies you need to reason about the interaction between per-step retry budgets and the overall timeout (a step retrying for 5 minutes inside a workflow with a 2-minute timeout is a bug candidate they're likely to probe).
5. **Multi-tenant isolation "strictly separated"** — implies they will check whether tenant A can enumerate or infer tenant B's data via IDs, error messages, or timing — not just whether a `tenant_id` column exists.
6. **"Deliberately flawed code snippet" for REVIEW.md** — this snippet is coming from them, separately. It's testing whether you can give calibrated, specific, kind-but-honest code review — a proxy for how you'll behave in real PRs on their team. Don't be vague or purely positive.
7. **Versioning + rollback** implies immutable version rows, not update-in-place — this single design choice cascades into your schema and your API semantics (a "rollback" is really "set current_version_id back," not "delete forward versions").
8. **Cron + webhook + manual triggers** implies a **trigger abstraction**, not three parallel code paths — they're testing whether you generalize or duplicate.
9. **"Message broker if used" (parenthetical, optional)** is a trap disguised as an option — it signals they expect you to *justify not using one* if you don't, since a DAG engine with retries and async steps is the canonical case for a queue. Skipping it is defensible for a 4-day MVP, but only if you say so explicitly.

---

## 3. Functional Requirements

**Execution Engine**
- Parse a JSON/YAML DAG definition into an in-memory graph; reject cycles at validation time with a clear error (which nodes form the cycle).
- Topologically sort; steps with no unmet dependencies execute concurrently, bounded by a concurrency limit per workflow run.
- Step types: `http`, `script` (sandboxed — see risks), `delay`, `condition` (branch based on prior step output).
- Per-step retry: exponential backoff with jitter, configurable max attempts.
- Workflow-level timeout that force-fails all in-flight steps and marks the run `timed_out`.

**API**
- CRUD on workflow definitions; every save creates a new immutable version; `PATCH /workflows/{id}/rollback/{version}` sets current pointer.
- `POST /workflows/{id}/trigger` (manual), cron field on the workflow for scheduled triggers, `POST /webhooks/{token}` for webhook triggers.
- Cursor-based pagination + filter query params on all list endpoints; a token-bucket rate limiter per tenant.
- JWT auth; roles `Admin` (manage users/tenant), `Editor` (CRUD workflows, trigger), `Viewer` (read-only) enforced via middleware, not per-handler checks.
- Input validation via a schema library (e.g., Zod/Joi) at the API boundary — never trust the DAG JSON past that point.

**Dashboard**
- One live-updating run view (WebSocket) showing step-by-step status transitions.
- Static DAG visualization (can reuse a library — this is not where your engineering time should go).
- Run history table: status, duration, per-step logs on click.
- Health panel: active runs, 24h success/failure rate, average duration — computed, not hand-maintained.

**Data**
- Schema for tenants, users, workflow_definitions, workflow_versions, runs, step_runs.
- Separate append-only store or a dedicated logs table (partitioned or TTL'd) for execution logs.
- One demonstrated index-driven query optimization with `EXPLAIN ANALYZE` before/after.
- One reversible migration script.

**AI Feature**
- Natural-language → DAG: user submits a text description, LLM returns a DAG JSON matching your schema, validated by the same validator the manual API uses (critical — see Section 5) before it's ever persisted or run.

---

## 4. Non-Functional Requirements

- **Isolation**: tenant scoping enforced at the query layer (see Section 11), not just the API layer — assume someone will forge a JWT claim or an ID in a URL.
- **Idempotency**: webhook and retry paths must be idempotent (retried step executions shouldn't double-fire an HTTP side effect if avoidable — document this as a known limitation if you don't fully solve it).
- **Observability**: structured logs with a run/step correlation ID; this matters more than a metrics dashboard for a 4-day scope.
- **Backpressure**: the execution engine must not accept unbounded concurrent runs — cap in-flight workflow executions per tenant.
- **Security**: parameterized queries only, JWT signature + expiry verification, secrets via env vars never committed, script-step execution sandboxed or explicitly stubbed with a documented risk note.
- **Testability**: the DAG engine must be usable with fake clocks/mocked step executors — don't let it depend on real `sleep()` or real HTTP in unit tests.

---

## 5. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Arbitrary script execution** (`script` step type) | This is a remote code execution vector if implemented naively (`eval`, `child_process.exec` on user input) | For the MVP: sandbox via a subprocess with no network/filesystem access and a hard CPU/time limit, or — more honestly for 4 days — stub it and document that production would use gVisor/Firecracker/a dedicated worker with no host access. Don't `eval()` anything, ever, even for a demo. |
| **Cycle/self-referential DAGs crashing the sorter** | Naive DFS topo-sort without visited-state tracking infinite-loops | Standard Kahn's algorithm (in-degree based) naturally detects cycles as "nodes left over with no valid ordering" — use it over recursive DFS. |
| **Tenant data leakage via IDs** | Sequential integer PKs let tenant A guess tenant B's workflow IDs | UUIDs for all externally-exposed IDs; every query scoped by `tenant_id` derived from the JWT, never from a request parameter. |
| **Retry storms** | Exponential backoff without a cap can retry for hours; combined with a broker, can also DDoS a downstream webhook target | Cap max backoff (e.g., 60s) and max attempts (e.g., 5); circuit-break a step type after N consecutive failures across runs. |
| **WebSocket fan-out cost** | Naive "push every event to every connected client" doesn't scale past a demo | Scope subscriptions to `run_id` rooms; for the take-home this is fine as-is, but say so in the trade-offs section. |
| **LLM generating invalid or malicious DAGs** | Direct LLM output written to the execution engine is an injection vector | Route LLM output through the exact same JSON-schema validator as the manual API — never a separate, looser path. |
| **Scope creep killing the polish areas** | Spending day 3 perfecting the DAG visualizer instead of writing tests | Timebox explicitly (Section 15) and protect Section F — it's cheap and high-signal. |

---

## 6. Engineering Trade-offs (decide these, then say so in the README)

- **Message broker: skip it.** For a 4-day MVP, an in-process async job runner (e.g., Node's event loop + a bounded worker pool, or Python's `asyncio` + a task queue table) is defensible and faster to build/test than standing up Redis+BullMQ or RabbitMQ. State the production alternative in the README rather than half-implementing a broker.
- **GraphQL: skip it.** It's explicitly a bonus. A well-documented REST API beats a half-finished GraphQL layer.
- **Log store: don't stand up a second database engine.** "Separate store" doesn't have to mean "separate technology." A dedicated, time-partitioned `step_logs` table in the same Postgres instance (or an S3/object-storage dump for raw stdout if you want to demonstrate the pattern) satisfies the requirement without adding an operational dependency you won't have time to justify or test.
- **Script step sandboxing: stub + document, don't build a sandbox from scratch.** Building real isolation (containers-per-step, gVisor) in 4 days is either fake security theater or a week of work by itself. Say what you'd do in production and move on.
- **GraphQL/REST versioning of the API itself**: not asked for — don't add `/v1/` speculative infrastructure; YAGNI applies here as much as anywhere.
- **ORM vs raw SQL**: use a lightweight query builder (Knex/Drizzle/SQLAlchemy Core) over a heavy ORM — you need the EXPLAIN-plan exercise to be legible, and heavy ORMs obscure the generated SQL.
- **Frontend framework**: React with a minimal state layer (no Redux) — this is not a frontend architecture test, don't over-invest here.

---

## 7. Suggested Architecture

**Stack** (optimized for "one person, 4 days, defensible in a review"):

- **Language/runtime**: TypeScript on Node.js, end to end (backend + frontend). One language reduces context-switching overhead under time pressure and lets you share the DAG-definition types between client and server.
- **API framework**: Fastify (lighter and faster to set up correctly with schema validation than Express+middleware soup; built-in JSON schema validation dovetails with Section 4's input-validation requirement).
- **Database**: PostgreSQL. Relational fits the tenant/user/workflow/version/run model naturally, and gives you the EXPLAIN-plan exercise for free.
- **Execution engine**: a plain in-process module — no framework. This is the part they're actually evaluating; framework magic here would hide your reasoning, not showcase it.
- **Async/job execution**: an in-process worker pool reading from a `runs`/`step_runs` table with a `status` column (poll-based, short interval) — the "job queue" pattern without a broker dependency. Document that Redis+BullMQ or SQS would replace this at real scale.
- **Real-time push**: native WebSocket (`ws` library) scoped by run-id rooms; SSE is a reasonable swap and arguably simpler if you don't need bidirectional — pick one and don't build both.
- **Frontend**: React + Vite, plain `fetch`/WebSocket client, no heavy state library.
- **Auth**: JWT (short-lived access token), role claim embedded, verified via middleware.

```
┌─────────────┐      REST/WS       ┌───────────────────┐
│  Dashboard   │◄──────────────────►│   Fastify API      │
│  (React)     │                    │  (auth, CRUD,      │
└─────────────┘                    │   validation, RBAC) │
                                     └─────────┬──────────┘
                                               │
                                     ┌─────────▼──────────┐
                                     │  Execution Engine    │
                                     │  (DAG parse/sort,    │
                                     │   retry, timeout)    │
                                     └─────────┬──────────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                  ┌───────────────┐   ┌────────────────┐   ┌───────────────┐
                  │  PostgreSQL    │   │  step_logs      │   │  LLM API      │
                  │  (core schema) │   │  (partitioned   │   │  (NL→DAG)     │
                  │                │   │   log table)    │   │               │
                  └───────────────┘   └────────────────┘   └───────────────┘
```

---

## 8. Domain Model

**Core entities and relationships:**

- `Tenant` 1—* `User` (every user belongs to exactly one tenant; no cross-tenant users for MVP simplicity)
- `Tenant` 1—* `WorkflowDefinition`
- `WorkflowDefinition` 1—* `WorkflowVersion` (each version is immutable once created; holds the DAG JSON)
- `WorkflowDefinition` 1—1 `currentVersion` pointer (nullable rollback target)
- `WorkflowVersion` 1—* `Run` (a run always executes a specific, pinned version — never "latest," to make retries/audits deterministic)
- `Run` 1—* `StepRun` (one row per DAG node execution, including retried attempts as either separate rows or an `attempt_number` column — prefer the latter to keep the run graph legible)
- `Run` — `TriggerType` (`manual` | `cron` | `webhook`) + `triggeredBy` (user id or webhook token, nullable)
- `User` *—* `Role` — for MVP scope, a single `role` enum column on the user is sufficient; a full RBAC join table is overengineering unless multi-role-per-user is explicitly needed (it isn't stated).

**Key modeling decision worth stating in your README:** `WorkflowVersion` is immutable and `Run` always references a version, not a definition — this is what makes rollback, audit, and "what exactly ran" queries trivial instead of requiring event-sourcing gymnastics.

---

## 9. API Design (REST)

```
POST   /auth/login                          → { accessToken }

GET    /workflows?cursor=&limit=&status=    → paginated list, tenant-scoped
POST   /workflows                            → create (creates definition + v1)
GET    /workflows/:id                        → current version + metadata
PATCH  /workflows/:id                        → creates a NEW version (never mutates existing)
DELETE /workflows/:id                        → soft delete (tombstone, not hard delete — audit trail)
GET    /workflows/:id/versions                → version history
POST   /workflows/:id/rollback/:versionId     → moves currentVersion pointer

POST   /workflows/:id/trigger                 → manual run, returns runId
POST   /webhooks/:token                       → webhook-triggered run (token maps to a workflow)

GET    /runs?cursor=&limit=&status=&workflowId=  → paginated, tenant-scoped
GET    /runs/:id                               → run detail + step statuses
GET    /runs/:id/steps/:stepId/logs             → paginated logs for one step

GET    /health/summary                         → active runs, 24h success/fail rate, avg duration

WS     /runs/:id/stream                        → live step status events, scoped to that run
```

**Cross-cutting:**
- Every route behind auth middleware except `/auth/login` and `/webhooks/:token` (webhook uses its own opaque-token auth, not JWT).
- `tenant_id` is *derived from the JWT claim server-side* on every query — never accepted as a request parameter, even implicitly via a body field. This is the single most important line in this whole document for the isolation requirement.
- Role check middleware: `Viewer` blocked from all non-GET; `Editor` blocked from user/tenant management; `Admin` unrestricted within their own tenant.
- Standard error envelope: `{ error: { code, message, details? } }`, with validation errors returning field-level detail from the schema validator.

---

## 10. Folder Structure

```
flowforge/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── workflows/          # CRUD + versioning
│   │   │   │   ├── runs/               # trigger, list, detail
│   │   │   │   ├── webhooks/
│   │   │   │   └── health/
│   │   │   ├── engine/                 # the core skill on display
│   │   │   │   ├── dagParser.ts
│   │   │   │   ├── topoSort.ts
│   │   │   │   ├── executor.ts
│   │   │   │   ├── retry.ts
│   │   │   │   └── stepHandlers/       # http.ts, script.ts, delay.ts, condition.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.sql
│   │   │   │   ├── migrations/
│   │   │   │   └── queries/
│   │   │   ├── realtime/               # ws room management
│   │   │   ├── ai/                     # NL→DAG feature
│   │   │   ├── middleware/             # auth, rbac, rateLimit, validation
│   │   │   └── server.ts
│   │   └── test/
│   │       ├── unit/                   # engine + validators
│   │       ├── integration/            # API endpoints
│   │       └── e2e/                    # one full workflow run
│   └── dashboard/
│       ├── src/
│       │   ├── components/ (DagView, RunHistory, HealthPanel, LiveRun)
│       │   ├── hooks/ (useRunStream, useWorkflows)
│       │   └── api/
│       └── test/
├── packages/
│   └── shared-types/                   # DAG definition schema, shared FE/BE
├── infra/
│   ├── docker/ (Dockerfile.api, Dockerfile.dashboard)
│   ├── docker-compose.yml
│   └── ARCHITECTURE.md
├── .github/workflows/ci.yml
├── REVIEW.md
└── README.md
```

Rationale: a `packages/shared-types` split is the one piece of "monorepo" structure worth the setup cost, because the DAG schema must be identical on client (visualizer, NL-builder preview) and server (validator, engine) — duplicating it is a bug waiting to happen. Beyond that, resist adding more monorepo tooling (Nx/Turborepo) — it's setup time you don't have and isn't being tested.

---

## 11. Database Schema

```sql
-- Core tenancy
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

-- Workflow definitions + immutable versions
CREATE TABLE workflow_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    current_version_id UUID,          -- FK added after workflow_versions exists
    cron_expression TEXT,             -- nullable; scheduled trigger config
    webhook_token UUID,               -- nullable; unique opaque token for webhook trigger
    deleted_at TIMESTAMPTZ,           -- soft delete
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflow_definitions(id),
    version_number INT NOT NULL,
    dag_definition JSONB NOT NULL,    -- validated against shared schema before insert
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_id, version_number)
);

ALTER TABLE workflow_definitions
    ADD CONSTRAINT fk_current_version
    FOREIGN KEY (current_version_id) REFERENCES workflow_versions(id);

-- Runs and steps
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','cron','webhook')),
    triggered_by UUID REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','timed_out')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE step_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id),
    step_key TEXT NOT NULL,           -- node id within the DAG definition
    attempt_number INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','retrying')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- High-volume execution logs, partitioned by month, kept separate from step_runs
-- so that log volume never bloats the hot-path table used for dashboard queries.
CREATE TABLE step_logs (
    id BIGSERIAL,
    step_run_id UUID NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL,
    message TEXT NOT NULL
) PARTITION BY RANGE (ts);
```

**Query optimization example to actually produce for the submission:**
`GET /runs?workflowId=X&status=failed` on an unindexed `runs` table forces a sequential scan once row counts grow. Add `CREATE INDEX idx_runs_tenant_workflow_status ON runs (tenant_id, workflow_id, status, created_at DESC);` and show the `EXPLAIN ANALYZE` before (`Seq Scan`, high cost) and after (`Index Scan`, low cost) — this is a small, legible, real demonstration, which is exactly what's being asked for. Don't over-engineer with five speculative indexes; justify the one you add.

**Migration script**: one file adding `webhook_token` to `workflow_definitions` with a `UNIQUE` constraint and a backfill for existing rows (`gen_random_uuid()` default) — small, safe, reversible, real.

---

## 12. Message Flow

**Trigger → execution → completion (manual trigger example):**

1. `POST /workflows/:id/trigger` → API validates role (`Editor`+), inserts a `runs` row (`status=pending`), returns `runId` immediately (202-style, non-blocking).
2. Worker pool picks up the pending run, loads `workflow_versions.dag_definition`, runs `topoSort()`.
3. Executor walks the sorted graph: for each step whose dependencies are all `succeeded`, dispatch it (bounded concurrency); insert/update its `step_runs` row to `running`.
4. On each step status transition, executor (a) writes to `step_runs`/`step_logs`, and (b) publishes an event to the WS room for that `runId`.
5. Dashboard, subscribed to `/runs/:id/stream`, receives the event and updates the DAG node's color/state client-side — no polling.
6. On step failure: retry logic checks `attempt_number` vs. max; if retries remain, schedule with backoff and re-dispatch; if exhausted, mark step `failed`, and propagate: any downstream step that depended on it is marked `skipped` (not silently left `pending` forever).
7. When all steps reach a terminal state (or the workflow timeout fires first), the executor marks the `run` `succeeded`/`failed`/`timed_out`, updates `finished_at`, and emits a final WS event.
8. Health panel numbers are a simple aggregate query over `runs` for the last 24h — computed on request, not a separately maintained running counter, since correctness and simplicity outweigh performance at this row-count.

**Cron trigger flow** differs only at step 1: a lightweight scheduler (checks `cron_expression` fields once a minute against current time) inserts the same `pending` run row — everything downstream is identical, which is the payoff of the trigger abstraction from Section 2.9.

---

## 13. Testing Strategy

- **Unit — DAG engine**: parser rejects malformed/cyclic input with specific errors; topo-sort produces a valid ordering for known fixture graphs (linear, diamond, disconnected components); retry logic hits exact expected attempt counts and backoff intervals using a fake clock/timer (never real `setTimeout` in a unit test).
- **Unit — validators**: JSON-schema validation for both the manual API path and the LLM-output path, using the identical validator (this test *is* the proof that the security mitigation in Section 5 actually holds).
- **Integration — API**: spin up the real Fastify app against a test Postgres (Testcontainers or a docker-compose test service) — CRUD, versioning/rollback, pagination, rate limiting, and RBAC (assert a `Viewer` token gets 403 on write routes; assert tenant A's token cannot fetch tenant B's workflow by ID even when guessed correctly).
- **E2E — one full run**: create a workflow via API → trigger it → poll/subscribe until terminal state → assert final `run.status` and step outcomes match the fixture DAG's expected shape. One well-chosen E2E test beats five shallow ones — don't over-invest here.
- **Explicitly out of scope, and say so**: load testing, chaos/failure-injection testing, cross-browser dashboard testing. Naming what you didn't test is more credible than silence.

---

## 14. Deployment Strategy

- **Dockerfile (API)**: multi-stage — `deps` stage installs and caches node_modules, `build` stage compiles TypeScript, final stage copies only `dist/` + `node_modules` (production-only) into a slim `node:20-alpine` runtime image, non-root user.
- **docker-compose.yml**: `api`, `dashboard`, `postgres` (with a named volume + init SQL mount), and nothing else for the MVP — no broker service, matching the trade-off in Section 6.
- **CI (GitHub Actions)**: on push/PR — install → lint → typecheck → unit+integration tests (spinning up Postgres as a service container) → build Docker image → (optionally) push to a registry on `main`. Keep it to one workflow file; don't build a matrix of Node versions or OS targets that nobody asked for.
- **Production architecture doc** (prose + one diagram, not IaC code): ALB → ECS Fargate service (API, auto-scaled on CPU/request count) → RDS Postgres (Multi-AZ) → a managed Redis (ElastiCache) *if and when* the in-process worker pool is replaced by BullMQ at real scale → S3 for cold log storage beyond the partitioned table's retention window → CloudFront + S3 static hosting for the dashboard build. Explicitly note *why* Fargate over EKS (no cluster ops overhead justified at this scale) and RDS over self-managed Postgres (managed failover/backups outweigh the cost delta for a startup's founding-engineer-stage infra).

---

## 15. Development Roadmap (4 days)

**Day 1 — Foundation + Engine core**
- Schema (Section 11) + one migration; project scaffold (folder structure, CI skeleton).
- DAG parser, Kahn's-algorithm topo sort, cycle detection — with unit tests written alongside, not after.

**Day 2 — Execution + API**
- Executor: dependency-respecting dispatch, retry/backoff, workflow timeout.
- API: auth/JWT/RBAC middleware, workflow CRUD+versioning, trigger endpoints, validation, pagination, rate limiting.
- Integration tests for the API as it's built, not batched at the end.

**Day 3 — Realtime, Data depth, AI feature**
- WebSocket run-status streaming; minimal dashboard consuming it (live view + run history — DAG visualizer can be a thin wrapper around an existing library, not custom-built).
- Query optimization + EXPLAIN write-up.
- NL→DAG feature: prompt template, output routed through the shared validator, a short prompt-engineering write-up (approach, token-limit handling via truncating/summarizing the NL input, and malformed-output guarding via schema validation + a single retry-with-error-feedback loop).

**Day 4 — Infra, hardening, and the "soft" deliverables**
- Dockerfile + compose, verify `docker compose up` actually works from a clean clone (do this early on day 4, not at 11pm).
- Finish CI pipeline; one feature-branch PR with a real description.
- E2E test; health panel; REVIEW.md (budget real, focused time here — see Section 2.6).
- README: setup, architecture overview, and — most importantly — the trade-offs section naming everything scoped down and why (GraphQL, broker, sandboxing, log store technology, monorepo tooling).

**Explicit cut list to state in the README if time runs short, in priority order to restore if extra time appears:** GraphQL endpoint → smart scheduling/failure-analysis (already deferred, only one AI feature was required) → optimistic UI/client caching polish → second E2E scenario → real message broker swap-in.

---

## 16. Deep Dive — Dashboard (Section C, Full Depth)

The "thin" version above scoped this down for the 4-day constraint. Here is what it looks like built out fully, if the extra time/tooling is available.

**Client architecture**
- React + Vite. **React Query** owns all REST-fetched state (workflow list, run history, health summary) — query keys scoped `['workflows', tenantId]`, `['runs', tenantId, filters]`. **WebSocket-driven run state is deliberately kept out of React Query's cache** and lives in a small dedicated store (`useRunStream` hook + `useReducer`), because it's a live overlay on top of the last-known REST snapshot, not cacheable request/response data — conflating the two causes stale-state bugs where a WS event arrives before the initial REST fetch resolves.

**DAG auto-layout**
- Don't hand-roll graph layout. Use `dagre` (or `elkjs` for larger graphs) to compute node positions from the same adjacency list the backend topo-sorts — layered left-to-right for sequential flow, siblings stacked vertically for parallel branches. Render with SVG, not Canvas (SVG gives free hit-testing/hover/click on nodes, which Canvas doesn't, and this graph is never going to have thousands of nodes where Canvas's perf advantage would matter).
- Node coloring is a pure function of `step_runs.status`: `pending` (gray) → `running` (pulsing blue, CSS animation not JS-driven) → `succeeded` (green) → `failed` (red) → `skipped` (dashed gray, for downstream steps orphaned by an upstream failure — Section 12, step 6).

**Real-time protocol**
- WS message: `{ type: 'step.status', runId, stepKey, attemptNumber, status, seq, ts }`. The `seq` field is a monotonic per-run counter assigned server-side at write time.
- **Gap detection**: client tracks the last `seq` it processed per run; if an incoming message's `seq` isn't `lastSeq + 1`, the client has missed an event (dropped connection, tab backgrounded) — it discards the stream state and does a full `GET /runs/:id` REST resync rather than trying to patch the gap. Simpler and more correct than a replay buffer for this scope.
- **Reconnection**: exponential backoff (1s, 2s, 4s... capped at 30s) on WS close; on reconnect, always resync via REST first, then resume the stream — never trust that the stream picks up where it left off.

**Run history**
- Server-side pagination + filtering (status, workflow, date range) via the `/runs` endpoint — never load the full history client-side and filter in JS.
- Virtualized list (`react-window` or `@tanstack/react-virtual`) once row counts exceed ~100, so the DOM node count stays bounded regardless of history depth.
- Row expansion lazily fetches `/runs/:id/steps/:stepId/logs`, itself paginated (cursor on `step_logs.id`) — logs can be arbitrarily large; never fetch a step's full log in one request.

**Health panel**
- The 24h aggregate (`active runs`, `success/failure rate`, `avg duration`) is expensive to compute from a raw scan of `runs` once the table is large. Two options, pick based on data volume you expect: (a) a Postgres **materialized view** refreshed every minute via `pg_cron` or a scheduled job — simplest, good up to moderate scale; (b) a **rollup table** (`health_stats_hourly`) incrementally updated by the executor on every run completion — more work, but avoids a full-table scan even at high volume. Recommendation: start with (a); it's a five-line view definition and one scheduled refresh, and only graduate to (b) if the materialized-view refresh itself becomes a bottleneck.
- Client polls this endpoint on a 30s interval (not WebSocket-pushed — it's a summary stat, not an event stream, and doesn't need sub-second freshness).

**Optimistic UI**
- **Trigger run**: clicking "Run" immediately renders a `pending` run row and DAG with all nodes gray, before the `POST /trigger` response returns. On success, the optimistic row is reconciled with the real `runId` (WS subscription switches to it). On failure, the optimistic row is removed and a toast shown — no silent failure.
- **Rollback**: clicking "Rollback to v3" immediately flips the UI's "current version" badge, then confirms against the API response; reverts + toast on error.
- Anything that isn't trivially reversible in the UI (e.g., delete) does **not** get optimistic treatment — wait for the real response. Optimistic updates are a UX nicety for low-risk, easily-undone actions, not a blanket pattern.

**Client caching**
- React Query `staleTime` tuned per resource: workflow list 30s (changes rarely), run list 5s (changes often), health summary 30s. Any mutation (create/update/trigger/rollback) invalidates the relevant query keys explicitly rather than relying on time-based staleness alone.

---

## 17. Deep Dive — Infrastructure & Deployment (Section E, Full Depth)

**Dockerfile (API) — multi-stage**

```dockerfile
# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
    && npm prune --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
USER app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

**docker-compose.yml — full local stack**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: flowforge
      POSTGRES_USER: flowforge
      POSTGRES_PASSWORD: local_dev_only
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flowforge"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    # Only needed if the broker-backed executor variant is used instead of
    # the in-process worker pool — see the MVP trade-off in Section 6.
    # Included here for the full-depth build; comment out for the minimal MVP.

  api:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.api
    environment:
      DATABASE_URL: postgres://flowforge:local_dev_only@postgres:5432/flowforge
      REDIS_URL: redis://redis:6379
      JWT_SECRET: local_dev_only
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }

  dashboard:
    build:
      context: .
      dockerfile: infra/docker/Dockerfile.dashboard
    environment:
      VITE_API_URL: http://localhost:3000
    ports: ["5173:5173"]
    depends_on: [api]

volumes:
  pgdata:
```

**CI pipeline (GitHub Actions)**

```yaml
name: ci
on: [push, pull_request]

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: flowforge_test
          POSTGRES_USER: flowforge
          POSTGRES_PASSWORD: test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U flowforge"
          --health-interval 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:integration
        env:
          DATABASE_URL: postgres://flowforge:test@localhost:5432/flowforge_test
      - run: npm run build
      - name: Build Docker image
        run: docker build -f infra/docker/Dockerfile.api -t flowforge-api:${{ github.sha }} .
```

**Production architecture on AWS (full)**

```
Internet
   │
   ▼
 Route 53 → CloudFront (dashboard static assets, S3 origin)
   │
   ▼
 ALB (public subnets, 2 AZs)
   │
   ├── target group → ECS Fargate service "api" (private subnets, 2 AZs)
   │        autoscaling: target-tracking on ALB RequestCountPerTarget + CPU
   │        min 2 tasks (HA floor), max N (cost-capped per environment)
   │
   └── target group → ECS Fargate service "ws" (if split from "api" for
            independent scaling of long-lived WebSocket connections —
            see note below)

 Private subnets also host:
   - RDS PostgreSQL, Multi-AZ, automated backups + PITR, parameter group
     tuned for connection pooling headroom (pair with RDS Proxy if Fargate
     task count grows, to avoid connection exhaustion)
   - ElastiCache Redis (if the broker-backed executor variant is deployed),
     used for the job queue (BullMQ) and as the WebSocket pub/sub backbone
     across multiple "ws" tasks (a single Fargate task's in-memory room
     map doesn't work once you scale past one instance — Redis pub/sub is
     what makes "publish to run X's room" work cluster-wide)

 Cross-cutting:
   - Secrets Manager for DB creds / JWT signing key, injected as task
     env vars at deploy time — never baked into the image
   - CloudWatch: structured JSON logs from Fargate tasks, alarms on
     5xx rate, task health, RDS CPU/connections, queue depth (if Redis
     path used)
   - WAF on the ALB (basic rate-based rule + managed rule groups) —
     cheap insurance, minutes to add, worth it before any public launch
   - S3 lifecycle rule moves `step_logs` partitions older than N days
     to cold storage / Glacier once they're rolled off the hot Postgres
     partition (ties back to the partitioned schema in Section 11)
```

**Why Fargate over EKS**: no cluster control-plane to operate at founding-engineer stage — the operational overhead of EKS isn't justified until the team and workload are large enough to need Kubernetes-specific primitives (custom operators, multi-tenant cluster sharing). Revisit if/when that's true.

**Why RDS over self-managed Postgres**: managed automated failover, backups, and patching outweigh the cost delta for a startup that can't afford a DB outage to also be a 2am page for the one founding engineer.

**Splitting "api" and "ws" into separate services**: worth calling out even though the MVP runs them together — WebSocket connections are long-lived and don't autoscale the same way stateless REST request/response does (a rolling deploy that drains connections behaves differently for each). Not needed at MVP traffic, but the architecture doc should name it as the first split you'd make.

**IaC**: Terraform, structured as modules — `network` (VPC/subnets/security groups), `data` (RDS, ElastiCache), `compute` (ECS cluster/services/task defs), `edge` (ALB, CloudFront, Route 53), `iam` (task roles, least-privilege per service). Full HCL isn't included here — that's a real implementation task, not an architecture decision — but naming the module boundaries up front is what keeps a first Terraform pass from turning into one 2,000-line file.

---

## 18. Deep Dive — AI-Powered Enhancement (Section G, Full Depth)

**Feature**: Natural-language workflow builder (`POST /workflows/generate`) — chosen over the other two options because it has the smallest, most testable surface area (structured-output generation against a known schema) versus failure-analysis (needs real failure data to be convincing) or smart-scheduling (needs real historical volume to produce meaningful suggestions, which a 4-day-old system won't have).

**Endpoint**
```
POST /workflows/generate
Body: { description: string }
Response: { draftDag: WorkflowDagDefinition, warnings?: string[] }
```
Deliberately does **not** persist anything — it returns a draft the user reviews/edits in the same UI as a manually-built DAG, then saves via the normal `POST /workflows` path. This keeps the LLM path and the manual path converging on one code path for validation and persistence, rather than becoming a second, less-trusted way to get data into the system.

**Prompt design**
- **System prompt** fixes: (a) the exact DAG JSON schema (the same schema object the backend validator uses — generated from one source of truth, not hand-copied into the prompt, so they can't drift apart), (b) the closed vocabulary of valid step types (`http`, `script`, `delay`, `condition`) and their required fields, (c) an explicit instruction to output only structured data matching the schema, no prose.
- **Structured output**, not "ask nicely for JSON in prose": use the model provider's native structured-output / tool-use mode (schema-constrained generation) rather than parsing JSON out of a free-text completion — this is a meaningfully more reliable class of guarantee than prompt instructions alone, and removes an entire category of "the model wrapped it in a code fence" or "added a sentence before the JSON" failure modes.
- **Few-shot examples** (2-3, embedded in the system prompt): one linear sequential workflow, one with a parallel branch, one with a conditional branch — chosen to cover the structural variety the model needs to generalize from, not to cover every step type combinatorially.

**Token-limit handling**
- Client-side cap on the NL input (e.g., 2,000 characters) with an inline warning before submit — cheaper and clearer than discovering a truncation failure server-side.
- For descriptions that imply a large number of steps, use a **two-pass generation** instead of one large completion: pass 1 extracts a flat step list (names + types) from the description; pass 2, given that step list plus the original description, generates the edges/dependencies. This keeps each individual completion small and focused, and makes failures easier to isolate (a bad step list vs. a bad dependency graph are different, separately-debuggable problems).
- `max_tokens` on the generation call sized to a realistic worst case (e.g., ~20 steps) rather than left unbounded — a runaway generation is a cost and latency risk, not just a correctness one.

**Guarding against malformed or unsafe output**
- Every draft DAG, before it's returned to the client *or* persisted, goes through the **identical validator** used for manually-authored workflows (schema validation, then the same Kahn's-algorithm cycle check from Section 5) — there is exactly one trust boundary in the system for "is this a valid DAG," and the LLM path does not get a shortcut around it.
- **Retry-with-feedback loop**: if validation fails, the validator's specific error is fed back to the model in a follow-up turn ("the previous output failed validation: `<error>` — return corrected JSON only"), capped at 2 retries. Past that, don't keep burning tokens hoping it converges — return the best draft plus the validation errors to the user so they can hand-fix it in the normal editor. A visible partial failure beats a silent one or an infinite retry loop.
- **Prompt-injection awareness**: the NL description is user-supplied text being used to generate content that can include `script`-type steps. Treat any `script` body the model produces with the exact same sandboxing/stubbing posture as a manually-authored script (Section 5) — the generation path doesn't get to be more trusted just because it's "AI-generated," if anything it should be treated as less trusted since the input is unstructured text that could contain adversarial instructions.
- **Separate rate limiting**: `/workflows/generate` is metered independently from the general per-tenant API rate limit, since LLM calls carry real per-call cost — reuse the token-bucket infrastructure already built for Section B rather than inventing a second rate-limiting mechanism.
- **Caching**: hash the NL input and cache the generated draft for a short TTL (e.g., 5 minutes) — mainly to avoid re-paying for accidental duplicate submissions (double-click, retry-on-timeout) rather than as a general cost-optimization strategy.

**Documenting the other two options (not built, but worth two sentences each in the README so the reviewer sees you considered the trade-off)**
- *Intelligent failure analysis* would need a corpus of real failures to be more useful than a generic "check your HTTP endpoint" response — low signal from a system that's only run a handful of test workflows, so it was deprioritized for this scope.
- *Smart scheduling* is a genuinely bad fit for a 4-day-old system: recommending "optimal windows" requires historical run-time distribution data that doesn't exist yet — this is the clearest case in the whole brief of a feature that's premature relative to the system's actual maturity, and saying so is itself a signal of judgment.
