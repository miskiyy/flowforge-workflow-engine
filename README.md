# FlowForge

FlowForge is a real-time, multi-tenant workflow orchestration engine. This repository is organized as a monorepo using npm workspaces, featuring a Fastify backend API, a React + Vite dashboard frontend, and a shared types package.

---

## 📋 Prerequisites

Before running the project, ensure you have the following installed on your system:
- **Node.js**: version `20.x` or higher
- **npm**: version `10.x` or higher
- **Docker** and **Docker Compose**

---

## 🚀 Quick Start with Docker Compose

The easiest way to boot the entire stack (PostgreSQL database, API server, and Dashboard frontend) is using Docker Compose.

1. **Clone the repository** (if not already done).
2. **Build and start the services**:
   ```bash
   docker compose up --build
   ```
3. Once the services are healthy and running:
   - **Dashboard**: Access via [http://localhost:5173](http://localhost:5173)
   - **API Server**: Access via [http://localhost:3000](http://localhost:3000) (Health check: [http://localhost:3000/health](http://localhost:3000/health))
   - **PostgreSQL**: Running on host port `5433` (mapped to `5432` in the container — see `docker-compose.yml`)
4. Seed demo data (2 tenants, one admin/editor/viewer user each — see [Environment variables](#-environment-variables) below for the shared dev password):
   ```bash
   docker compose exec api node apps/api/dist/db/seed.js
   ```

---

## 🔑 Environment variables

Copy `.env.example` to `.env` for local (non-Docker) development; `docker-compose.yml` sets these directly for the containerized stack. All are read in `apps/api/src/config.ts` unless noted.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | API listen port. |
| `DATABASE_URL` | **yes** | — | Postgres connection string. |
| `JWT_SECRET` | **yes** | — | Access-token signing secret. Must be **≥32 characters in production** (`NODE_ENV=production`, which is baked into the API's Docker image) — `config.ts` throws on boot otherwise. |
| `JWT_EXPIRES_IN` | no | `15m` | Access-token lifetime. |
| `CORS_ORIGIN` | no | reflects any origin in dev, denies all in production | Comma-separated allowlist. |
| `AI_PROVIDER` | no | `mock` | `mock` needs no key and is what CI/tests use; `openrouter` calls a real model. |
| `OPENROUTER_API_KEY` | only if `AI_PROVIDER=openrouter` | — | Never commit a real value — only fails AI route registration if missing, never API boot. |
| `AI_MODEL` | no | `meta-llama/llama-3.1-8b-instruct:free` | Any OpenRouter model id. |
| `VITE_API_URL` | no | `http://localhost:3000` | Dashboard build-time only (Vite inlines it) — see the dashboard's Dockerfile note below. |

Seeded demo users (via `db:seed`, all tenants): `admin@acme.dev`, `editor@acme.dev`, `viewer@acme.dev` and the same three `@globex.dev` — shared dev-only password `password123`. `db:seed` also creates three example workflows (`hello-http`, `fan-out`, `flaky-endpoint`) for the Acme tenant so a first login lands on something runnable; Globex is left empty to demonstrate tenant isolation.

---

## 🛠️ Local Development Setup

If you want to run the API and Dashboard in development mode with hot reloading, follow these steps:

### 1. Install Dependencies
From the root of the project, run:
```bash
npm install
```

### 2. Start the Database
Start only the PostgreSQL database service using Docker Compose:
```bash
docker compose up postgres
```

### 3. Start the API Server
In a new terminal, run:
```bash
npm run dev -w apps/api
```
This boots the API server at [http://localhost:3000](http://localhost:3000) using `tsx watch` for automatic reloading on code changes.

### 4. Start the Dashboard
In another terminal, run:
```bash
npm run dev -w apps/dashboard
```
This runs the React frontend at [http://localhost:5173](http://localhost:5173) with hot module replacement (HMR).

---

## 🧪 Testing, Linting & Typechecking

All quality assurance checks can be run from the root of the monorepo:

* **Run all tests**:
  ```bash
  npm test
  ```
* **Run linting (ESLint + Prettier)**:
  ```bash
  npm run lint
  ```
* **Run TypeScript typechecks**:
  ```bash
  npm run typecheck
  ```
* **Build all packages/apps**:
  ```bash
  npm run build
  ```

---

## 📁 Repository Structure

* **`apps/api`**: Fastify server handling authentication, tenant isolation, CRUD, execution engine, WebSockets, and GraphQL. See [`apps/api/src/execution/README.md`](apps/api/src/execution/README.md) for the execution engine + worker pool, [`apps/api/src/realtime/README.md`](apps/api/src/realtime/README.md) for the WebSocket layer, [`apps/api/src/db/README.md`](apps/api/src/db/README.md) for the migration/index/log-storage write-up, [`apps/api/src/graphql/README.md`](apps/api/src/graphql/README.md) for the GraphQL layer, and [`apps/api/src/ai/README.md`](apps/api/src/ai/README.md) for the NL→workflow-proposal AI subsystem (including every deviation from `Task.md`'s Phase 5 spec).
* **`apps/dashboard`**: React + Vite user interface for visualization and control of workflows — see the [Frontend](#-frontend) section below for the route map, state-management tiers, and accessibility hardening, and [`apps/dashboard/src/realtime/README.md`](apps/dashboard/src/realtime/README.md) for the WebSocket client (`useRunStream`).
* **`packages/shared-types`**: TypeScript models, JSON schemas, and shared utilities shared between frontend and backend.
* **`infra/`**: Infrastructure configurations, including Dockerfiles.
* **[`ARCHITECTURE.md`](ARCHITECTURE.md)**: production AWS deployment shape (diagram + prose) — not what's running in `docker-compose.yml` today, but where it would go.
* **[`REVIEW.md`](REVIEW.md)**: the code-review exercise (a supplied flawed snippet was never included with this project's assignment materials — see the file itself).
* **[`phase0-self-review.md`](phase0-self-review.md)**: a real self-review this project ran against its own first PR, kept as a demonstration of the same review practice.

---

## 🏗️ Architecture overview

One Fastify process (`apps/api`) serves REST, the `WS /runs/:id/stream`
upgrade, and — since Phase 6 — an in-process worker pool
(`execution/worker.ts`) that polls `runs WHERE status='pending'` with
`FOR UPDATE SKIP LOCKED` and executes them. No message broker, no separate
worker service; see [Trade-offs](#-trade-offs) below for why.

```
tenant_id always comes from the verified JWT, never from the request body/params
        │
 auth/plugin.ts (JWT verify + RBAC) ──▶ workflows/routes.ts ──▶ workflows/repository.ts
                                              │                         │
                                              ▼                         ▼
                                     workflow_versions (immutable,   tenant-scoped
                                     one row per version)             Postgres queries
                                              │
                                              ▼ POST /workflows/:id/trigger
                                     execution/repository.ts (creates a 'pending' run)
                                              │
                                              ▼ picked up by
                                     execution/worker.ts (poll loop, SKIP LOCKED claim)
                                              │
                                              ▼
                                     execution/executor.ts (topo-order dispatch,
                                     retry/backoff, cancellation)
                                              │
                                              ├──▶ execution/step-handlers.ts (http/delay/
                                              │     script-stub/condition-stub)
                                              └──▶ realtime/publisher.ts ──▶ WS run_id room
```

`packages/shared-types` is the single source of truth for the DAG JSON
schema — the same schema object validates manually-authored workflows, the
AI-generated drafts, and (via `ajv.compile`) is exercised directly in tests.
See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how this would map onto AWS in
production.

**RBAC** is two composed preHandlers (`auth/plugin.ts`), not one flat
viewer/non-viewer check: `requireWrite` blocks `viewer` from any non-GET
method, and `requireAdmin` further blocks `editor` from the small set of
destructive or credential-rotating routes — deleting a workflow, and
minting/revoking its webhook token (`workflows/routes.ts`'s `adminGuard`).
Editor and admin are otherwise identical: day-to-day authoring, triggering,
and cancelling is deliberately not admin-gated.

---

## 🤖 AI feature: natural-language workflow builder

`POST /workflows/:id/propose` — a user describes a workflow in plain
English and gets back a draft DAG. Full design, prompt approach, token-limit
handling, and malformed-output guarding are documented in
[`apps/api/src/ai/README.md`](apps/api/src/ai/README.md); the short version:

- The system prompt embeds the **actual** `WorkflowDagDefinition` schema
  (imported from `@flowforge/shared-types`, never hand-copied) plus two
  typechecked few-shot examples.
- Every draft — AI-generated or hand-authored — passes through the
  **identical validator** (schema + Kahn's-algorithm cycle check) before it
  can be saved. The LLM gets no shortcut around that trust boundary.
- On validation failure, the specific error feeds back into a repair turn,
  capped at 2 retries (3 calls total) — then the best draft plus the errors
  is returned for the user to hand-fix. No infinite retry loop.
- Input is capped at 2000 characters, enforced server-side before any
  provider call; `max_tokens: 1500` per completion.
- `/propose` **persists nothing** — the draft is saved through the same
  `PATCH /workflows/:id` path a hand-edited workflow uses.

**Why not failure-analysis or smart-scheduling** (the brief's other two
options): both need real historical data — failed runs, run-time
distributions — from a system that's actually been running in production.
This system's engine has executed nothing outside tests and a handful of
demo triggers; building either feature now would mean generating advice
from no data, which is worse than not building it.

---

## 🖥️ Frontend

`apps/dashboard` — React 18 + Vite + TypeScript, built in the phased order
named in the approved frontend roadmap (P1–P9, then P10–P12 once `GET
/stats` and the per-step logs route landed — see below), then re-cut into
five UX batches after user testing (see
[First-run journey](#first-run-journey-ux-revision) and
`frontend-ux-revision.md`). No CSS framework, no component library: CSS
custom-property tokens (`src/styles/tokens.css`) plus inline styles, the same
"smallest-thing-that's-actually-correct" bias as the backend.

### Routes

| Route | Page | Notes |
|---|---|---|
| `/login` | `LoginPage` | Public; product one-liner + dev-only demo-credentials hint; redirects to `next` (or `/`) once authenticated |
| `/` | `OverviewPage` | Post-login landing — orients the user with three primary actions and a recent-runs strip |
| `/workflows` | `WorkflowsPage` | Paginated list, debounced name filter |
| `/workflows/new`, `/workflows/:id/edit` | `WorkflowEditorPage` | One page for both — create and edit share the exact same save mutation. `?mode=ai` opens the AI-first layout |
| `/workflows/:id` | `WorkflowDetailPage` | Graph, version history + rollback, trigger (primary action), delete |
| `/runs` | `RunsPage` | Cross-workflow history; status/workflow filters and pagination live in the URL |
| `/runs/:id` | `RunDetailPage` | Live WebSocket-driven execution view; per-step logs lazily expand inline; Cancel run while pending/running |
| `/health` | `HealthPage` | Active runs + 24h success/failure rate + avg duration, from `GET /stats` |
| `*` | `NotFoundPage` | |

### First-run journey (UX revision)

The original P1–P12 build assumed a user who already knew FlowForge and could
hand-author a DAG in JSON — so a first-time reviewer landed on an empty table
whose only path forward was a raw JSON void. A round of user testing produced
exactly that reaction ("I couldn't do anything"). The roadmap was re-cut into
five UX batches (`frontend-ux-revision.md`) that make the first run
self-explanatory:

- **`db:seed` now creates example workflows** (`hello-http`, `fan-out`,
  `flaky-endpoint`) for the first tenant, so a reviewer lands on something
  runnable and can open → trigger → watch a run go live **without writing any
  JSON**. The second tenant stays empty, which doubles as a tenant-isolation
  demo. Seed data only — no schema or contract change.
- **`/` is a real landing** (`OverviewPage`): a one-line description of what
  the app does, three primary actions (Generate with AI · Create manually ·
  Browse examples), and a recent-runs strip so live execution is visible from
  second one.
- **AI generation is a first-class entry point.** "Generate with AI" opens the
  editor in an AI-first layout (`?mode=ai`): the prompt leads, and the raw JSON
  editor is tucked into an "Advanced — edit JSON directly" disclosure. The
  panel still cannot write — Apply routes through the *same* save mutation a
  human uses. Manual authoring gets a one-step scaffold and an inline step
  reference instead of an empty `{"steps":[]}`.

### State management — four tiers, no Zustand

| Tier | Tool | What lives there |
|---|---|---|
| Server state | React Query | workflows, versions, runs, propose mutation |
| Session | React Context (`AuthProvider`) | `{ token, user, login, logout }` — changes ~twice per session |
| Realtime | `useReducer` inside `useRunStream` | live run/step/event state — kept **outside** React Query on purpose |
| Local | `useState` | form fields, dialogs, panel state |

**No Zustand, no Redux.** Nothing in this app is client state shared across
distant components that isn't already one of the tiers above — a store
would be a second source of truth sitting next to React Query. If a real
need for shared client state shows up later, the honest next step is React
Context first, not a state library.

**`useRunStream` stays outside React Query, deliberately.** It's a push
stream with seq/gap semantics (generation counters, gap-triggered REST
resync, capped exponential backoff) — not a request/response cache. Folding
it into `useQuery` would mean fighting the cache's refetch/staleness model
to reimplement what the hook already does correctly. See
[`src/realtime/README.md`](apps/dashboard/src/realtime/README.md).

### `localStorage` for the session token

The bearer token (plus the email captured at login — the JWT itself doesn't
carry it, see `apps/api/src/auth/plugin.ts`) lives in `localStorage`,
XSS-readable. The tradeoff is inherited, not chosen: the backend is frozen
and issues a bearer token, and the WS gateway already requires it as
`?token=` in the URL (`apps/api/src/realtime/gateway.ts`) — that posture
comes from the server contract. An httpOnly cookie would need a backend
change out of scope here. `sessionStorage` would only narrow the exposure
window, not close it, so this project doesn't pretend it's a fix.

### Desktop-first, not responsive-first

Built and tested for ≥1024px — an authenticated ops tool used at a desk,
not a consumer surface. Tablet- and mobile-width layouts were **not
built**; that's a named scope cut, not an oversight. Structural breakpoints
and a mobile read-only mode are the documented next step
(frontend-design.md §13) if this ever needs to run on a phone.

### Dark mode: cut, deliberately

One theme, light only — `src/styles/tokens.css` has exactly one color
token set. The primary scene this dashboard is judged in (a reviewer or
operator on a laptop, normally-lit room) doesn't need it, and a half-shipped
toggle — tokens present but no real contrast QA on a dark variant — is worse
than an honestly single-themed app. Nothing here assumes light-only in a way
that would need unwinding later; adding dark mode means adding a second
token set and auditing every color pairing in both directions.

### P10/P11: health panel + log expansion (previously blocked, now built)

Both were originally cut from this delivery — the design doc's own named
fallback for "if both blockers are refused: cut the health panel, cut log
expansion, keep everything else, document both." Neither blocker turned out
to require freezing the API further than it already was; both are
additive routes with no schema or contract change to anything existing:

- **Health panel (P10)** needed `GET /stats` (active runs, 24h
  success/failure rate, avg duration) — now a single aggregate query
  (`execution/repository.ts#getTenantRunStats`), never computed client-side
  by walking paginated `GET /runs` (that would defeat the point of an
  aggregate query). `HealthPage` polls it every 15s; `null` rates/durations
  render as "—", not "0%" — no data is a different statement from zero.
- **Log expansion (P11)** needed a per-step logs route
  (`GET /runs/:id/steps/:stepKey/logs`) — `execution/repository.ts#getStepLogs`
  already existed server-side, but no route called it. It exposes only
  `step_logs` (error strings, oldest first) — never `step_runs.output`,
  which can hold the raw response body of an `http` step fetch. `RunDetailPage`
  fetches lazily: nothing is requested until a step row's `<details>` is
  expanded.

### Accessibility (§12 hardening checklist)

- Status is never color-only: every badge, graph node, and diff row pairs
  its color with a glyph (`✓ ✗ ⟳ · ⊘` / `+ − ~`).
- Status colors meet WCAG AA (≥4.5:1 with white text) —
  `test/statusColor.test.ts` pins the exact values as a regression guard.
- Every interactive element is a real `<button>` or `<a>` — audited, zero
  `<div onClick>`.
- `:focus-visible` is a global rule (`src/styles/global.css`); nothing
  overrides it with `outline: none` without a `:focus-visible`-aware
  alternative (`DagEditor`'s textarea was the one violation found and fixed
  during this hardening pass).
- Route changes move focus to the new page's `<h1 tabIndex={-1}>`
  (`App.tsx`) — SPA navigation otherwise strands screen-reader focus.
- `aria-live="polite"` on the WS connection indicator and run status —
  announces transitions without spamming per WS event.
- The workflow graph is `role="img"` with an `aria-label` summarizing
  status counts, since an SVG DAG isn't readable node-by-node.
- Reduced motion: the running-node pulse is wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- `ErrorBoundary` (route-level, keyed by pathname) catches an unhandled
  render error without blanking the whole app — the failing route resets
  automatically on navigation.

**Manual-only, not exercised by this pass:** a real-browser 200% zoom
walkthrough and a full mouse-free keyboard walkthrough (login → create →
propose → apply → trigger → watch) — no browser was connected in this
session to drive one. A structural review (rem-based type scale, no
fixed-width containers beyond `max-width` constraints, no text-clipping
`overflow: hidden`) suggests both should hold, but that's a claim to verify,
not a substitute for actually doing it.

### Testing

Vitest + Testing Library (jsdom) — no real-browser or visual-diff coverage,
the same posture as the backend (see
[What's intentionally not tested](#-whats-intentionally-not-tested)). Every
page covers its four canonical states where applicable (loading, error,
empty, populated).

---

## ⚖️ Trade-offs

Every deliberate scope cut, and why — each of these was a locked decision
going in, not a shortcut discovered under deadline pressure.

- **No message broker.** The execution engine is an in-process worker pool
  polling `runs WHERE status='pending'` with `FOR UPDATE SKIP LOCKED`
  (`execution/worker.ts`), not Redis/BullMQ or SQS. That SQL pattern is
  exactly what makes it horizontally-safe if it's ever scaled to multiple
  API instances — two pollers can't claim the same row — so this isn't a
  toy implementation, it's the smallest thing that's actually correct at
  this scale. The production swap-in is named in
  [`ARCHITECTURE.md`](ARCHITECTURE.md#redis--only-if-the-broker-path-is-adopted).
- **GraphQL is a read+operate surface, not a 1:1 REST mirror.** `POST
  /graphql` ([`graphql/`](apps/api/src/graphql/README.md)) shares the exact
  same auth, tenant isolation, rate limiter, RBAC, and DAG validation as
  REST — reused, not reimplemented — but webhook-token minting/revocation
  stays REST-only. Bolting on every REST route as a GraphQL field for a
  checkbox seemed worse than a smaller surface that's actually load-bearing.
- **No distributed execution.** One process executes one run, still —
  there's no second worker service or cross-process step dispatch. *Within*
  one run, independent DAG-level steps now execute concurrently (bounded by
  `maxParallelSteps`, default 8 — `execution/executor.ts`), so a diamond's
  two parallel branches actually overlap instead of serializing for no
  dependency reason; levels themselves still run strictly one at a time,
  since a level's blocked/runnable decisions depend on the previous level's
  final statuses. Multiple *runs* execute concurrently too (bounded
  per-tenant, see `worker.ts`).
- **Log storage: one time-indexed Postgres table**, not a second engine
  (Elasticsearch/Loki) or table partitioning. Full justification —
  including the actual query pattern it serves and the cold-storage scale
  path — is in [`apps/api/src/db/README.md`](apps/api/src/db/README.md#log-storage-why-one-time-indexed-postgres-table-not-a-second-engine).
- **Sandbox hardening.** The `script` step type never spawns a real
  process — it's a stub that records the command it would have run
  (`execution/step-handlers.ts`), per this project's own locked decision
  against running arbitrary tenant-supplied commands without a real sandbox.
  gVisor or Firecracker microVMs are the documented production answer; that
  infrastructure is out of scope for this system's current maturity.
- **No additional monorepo tooling** (Nx/Turborepo). npm workspaces plus
  TypeScript project references is enough for three packages — a build
  orchestrator earns its cost at a package count and CI complexity this
  repo doesn't have.

---

## ⚠️ Known limitations

Gaps found and deliberately left open, documented rather than silently
shipped:

- **IPv6 SSRF coverage is loopback-only.** `workflows/guards.ts`'s host
  check (used at DAG-authoring time by both the manual and AI paths, and
  re-checked per redirect hop at fetch time by `step-handlers.ts`) only
  special-cases `::1`; broader IPv6 private-range parsing (ULA, link-local)
  is out of scope for the same reason the guard doesn't try to catch
  everything — it reduces blast radius, not a full network-layer sandbox.
- **The worker pool's per-tenant/global concurrency caps are in-memory,
  single-process.** Correct today (one process, and now holds *within* a
  poll tick too — see `execution/worker.ts`'s `claimPendingRuns`); if this
  ever runs as multiple API instances without the Redis-backed swap named
  in `ARCHITECTURE.md`, each instance would enforce its own cap
  independently rather than a shared one.
- **No real-browser accessibility pass.** `:focus-visible`, `aria-live`,
  and heading/landmark structure were audited by reading the code and
  covered by jsdom tests; a live 200% browser-zoom pass and a true
  mouse-free keyboard walkthrough were not performed (see the Frontend
  section's Accessibility subsection).

---

## 🧪 What's intentionally not tested

Named explicitly, per this project's own engineering conventions — gaps are
more useful stated than left for a reviewer to discover:

- **Load testing** — no numbers on requests/sec, concurrent runs, or
  worker-pool throughput under real load.
- **Chaos testing** — no fault injection (killed Postgres connections mid-
  transaction, a worker process dying mid-run, network partitions).
- **Cross-browser / visual regression testing** — the dashboard is tested
  with Vitest + Testing Library (jsdom); no real-browser or visual-diff
  coverage (Playwright/Cypress, Chromatic, etc.).
- **Performance benchmarking** — the one documented performance data point
  is the query-optimization EXPLAIN ANALYZE
  ([`db/README.md`](apps/api/src/db/README.md)); nothing broader (P50/P99
  latency under load, memory profiling).
- **Stress testing** the worker pool's backpressure — the per-tenant/global
  concurrency caps are implemented and unit-testable in isolation, but not
  exercised under actual multi-tenant contention.

---

## 🔭 What I'd do with more time

In priority order:

1. **Crash recovery for the worker pool.** A run claimed `'running'` by a
   process that then dies stays `'running'` forever — no lease, no
   heartbeat, no reaper. `stop()` only covers graceful shutdown, and the
   cancellation registry (`execution/cancellation.ts`) is in-memory, so a
   cancel request against a dead process's run has nothing to abort either.
2. **Frontend surfacing for cron/webhook.** Both trigger paths are
   API-complete and tested (`POST /workflows/:id/webhook-token`,
   `cronExpression` on create/update), but `WorkflowDetailPage` doesn't yet
   show a schedule editor or the webhook URL — reachable only via the API
   today.
3. **A distributed cancellation broadcast** if this ever runs as multiple
   API instances — today `execution/cancellation.ts`'s registry only sees
   runs claimed by *this* process; cancelling a run another instance is
   executing would need a pub/sub layer (Redis, matching the swap-in already
   named for the worker pool's concurrency caps).

Already done: global workflow timeout; real SSRF hardening at fetch time
(shared with the manual path, not just the AI proposal path's
authoring-time guard); retry wired into the worker pool with jitter and
per-tenant claim fairness within a single poll tick; **parallel step
dispatch within one run** (independent DAG-level steps now execute
concurrently, bounded by `maxParallelSteps`, not strictly one-at-a-time);
a working **`condition` step** (closed `{ left, op, right }` comparison,
gating dependents without failing the run); **`GET /stats`** and the
**Health panel**; a **per-step logs route** and lazy log expansion in the
run detail view; **cron and webhook triggers** — one shared `startRun` path
for manual/cron/webhook, an idempotency key preventing double-fires on
retry/replay, and a dependency-free cron matcher (see `execution/README.md`'s
"Trigger paths" section); **reachable run cancellation** — `POST
/runs/:id/cancel` cancels a `pending` run outright or requests cancellation
of a `running` one via an in-process abort registry, plus a Cancel button on
the live run view; and **a second E2E scenario** covering the failure/retry
path end-to-end (a step retries to exhaustion, fails the run, skips its
dependent — `e2e.test.ts`'s second `describe` block).
