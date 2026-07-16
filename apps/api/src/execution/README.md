# Execution engine

Pure, framework-free workflow execution: given a validated DAG and a way to
run one step, walk it to completion deterministically. No Fastify import
anywhere in this directory except `routes.ts`.

## Layers

```
packages/shared-types/dag.ts   JSON schema — the DAG shape (steps, dependsOn)
apps/api/src/engine/dag.ts     parseDag + topoSort -> deterministic order/levels (Phase 3.1)
apps/api/src/execution/
  lifecycle.ts                 pure run/step status state machines (Phase 3.2/3.3)
  context.ts                   ExecutionContext = run metadata + the dag's execution plan
  repository.ts                persistence: runs/step_runs/step_logs, tenant-scoped
  executor.ts                  executeRun() — the scheduler/retry/cancellation loop (Phase 3.3/3.4)
  step-handlers.ts             the real StepExecutor: http/delay/script/condition (Phase 6)
  worker.ts                    the poll-claim-execute loop that calls executeRun (Phase 6)
  routes.ts                    HTTP surface: POST trigger, GET run/list (Phase 3.2 only)
```

`executeRun` is the only piece that knows how to *drive* a run; everything
below it (repository, lifecycle) is dumb persistence + validated transitions,
and everything above it (routes) never calls `executeRun` directly — trigger
only creates a `pending` run. `worker.ts` is what actually calls it: a
`setInterval` poll loop, started from `server.ts` (not from `app.ts`, which
tests build directly — see worker.ts's own comment), that claims pending
runs with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` and
executes each with the real step handlers below. This was Task.md's Phase 3
"Worker pool" bullet, originally deferred and built in Phase 6 once it became
clear the required E2E test (and Phase 6's own "trigger it, watch it run"
gate) needs something to actually advance a run — see `worker.ts` for the
full reasoning.

## Trigger paths — one shared entry point, not three code paths

Task.md:102's requirement: manual, cron, and webhook triggers must all
create the exact same shape of `pending` run, not three divergent
implementations. All three call `execution/repository.ts#startRun` directly:

- **Manual** — `POST /workflows/:id/trigger` (`execution/routes.ts`, JWT-authenticated).
- **Cron** — `apps/api/src/scheduling/scheduler.ts`'s `runCronTick`, invoked
  every 60s by `startCronScheduler` (started from `server.ts`, alongside the
  worker pool). Evaluates every workflow with a non-null `cron_expression`
  (`scheduling/cron.ts`'s dependency-free 5-field matcher, UTC) against the
  current instant and calls `startRun` with `triggerType: 'cron'` and an
  idempotency key derived from the current UTC minute
  (`minuteBucketKey`) — a tick that re-evaluates the same minute (a slow
  tick, a process restart) hits the unique index on
  `(workflow_id, idempotency_key)` and reuses the existing run instead of
  creating a duplicate.
- **Webhook** — `POST /webhooks/:token` (`webhooks/routes.ts`), the one
  *public* route in the API — opaque-token auth, not JWT, per Task.md:102.
  The token is server-generated (`POST /workflows/:id/webhook-token`, never
  client-supplied — it's a bearer secret) and looked up with no tenant
  filter, since the token itself names its tenant. An optional
  `Idempotency-Key` header lets a webhook sender's own retry/redelivery
  reuse the same run instead of double-firing.

Because all three converge on `startRun`, a run created by any trigger is
indistinguishable downstream — the worker pool, realtime publisher, and
dashboard don't know or care which path created it; only `runs.trigger_type`
records which one did.

## Step handlers (`step-handlers.ts`, Phase 6)

The worker's default `StepExecutor`. Each handler's scope is deliberately
bounded to what's already decided elsewhere in this repo — nothing here
introduces new design:

- **`delay`** — a real `setTimeout`. No open questions.
- **`http`** — a real `fetch`, with `redirect: 'manual'` and every hop
  (including redirect targets) re-checked against `workflows/guards.ts`'s
  SSRF host guard — the same one `workflows/routes.ts` and `ai/propose.ts`
  use at authoring time, now also enforced here at fetch time, which is the
  only place that can actually catch DNS rebinding or a redirect into a
  private IP (audit C1). `AbortSignal.timeout` bounds each hop so a hung
  endpoint can't pin a worker slot forever. Non-2xx or a thrown network/guard
  error is a failed step (so retry policy applies naturally). Response
  bodies are read off the stream and capped at 4KB *while reading* — not
  buffered in full and truncated after — before being stored in
  `step_runs.output`.
- **`script`** — Task.md's already-locked decision: "sandboxed subprocess
  stub with hard timeout, no network/fs, never eval." It never spawns a
  process (a real sandbox — gVisor/Firecracker — is the documented production
  answer), so it always succeeds, carrying the command it would have run.
- **`condition`** — phase0-self-review.md's Option 1, now adopted: a closed
  `{ left, op, right }` comparison object, not a string. `left` must be
  `$.steps.<key>.status` where `<key>` is one of the condition step's own
  `dependsOn` entries (workflows/guards.ts enforces this at write time, since
  a schema alone can't express "references a sibling array element"); `op`
  is `eq`/`neq`; `right` is one of `succeeded`/`failed`/`skipped`. No parser,
  no eval — the comparison always succeeds as a step (it evaluated cleanly),
  but a false result closes the gate: the step's own dependents are skipped
  (`executor.ts`'s `falseBranches` set), without failing the run. This is the
  DAG engine's only branching primitive — there's no separate "if/else step
  type," a false condition is just a targeted skip.

## Two state machines (`lifecycle.ts`)

**Run status:** `pending → running → {succeeded, failed, timed_out, cancelled}`.
All four end states are terminal — no transition leaves them.

**Step status:** `pending → running → {succeeded, failed}`, or
`pending → skipped` directly (blocked by a failed/skipped dependency, or
never reached because the run was cancelled), or the retry loop
`running → retrying → running → ...` until it succeeds or exhausts
`retryPolicy.maxAttempts`.

Both are enforced at the persistence boundary (`repository.ts`'s
`transitionStep`/`markRunRunning`/`finishRun`), not just in application code —
an illegal transition throws `InvalidRunTransitionError`/
`InvalidStepTransitionError` from the DB-backed call itself, so a bug two
layers up (e.g. calling `executeRun` twice on the same run) fails loudly
instead of corrupting state.

## Scheduling (`executor.ts`)

`context.plan.levels` (from the Phase 3.1 engine) groups steps so that every
step's dependencies live in a strictly earlier level. Walking levels in
order means every dependency has already been resolved by the time its
dependent's level is reached — so failure propagation is just "if a
dependency's recorded status is `failed` or `skipped`, skip this step too,
without calling the executor." That's transitive for free (skipping `b`
skips whatever depends on `b`, a level later) and needs no second graph walk.

Steps *within* one level share no dependency edge, so they run concurrently,
bounded by `maxParallelSteps` (default `DEFAULT_MAX_PARALLEL_STEPS = 8`, via
a small claim-based worker pool — `mapWithConcurrency`). Levels themselves
still run strictly one at a time: level *N+1* never starts until every step
in level *N* has a final status, since a level's dispatch decisions (which
steps are blocked vs. runnable) depend on that. This is "parallel where
possible, sequential where required" (Task.md's Core Requirement A), not a
speculative optimization — a wide fan-out (e.g. an AI-generated diamond)
actually executes its independent branches concurrently instead of
serializing them for no dependency reason.

## Retry (Phase 3.4)

`RetryPolicy = { maxAttempts, baseDelayMs, maxDelayMs }`. Delay is
exponential, capped, with equal jitter: `computeRetryDelayMs`'s `random`
parameter defaults to a constant (`() => 1`, no jitter) so existing tests
can still assert exact backoff values, but `worker.ts` passes `Math.random`
in production, so the real delay lands anywhere in
`[0.5 * min(baseDelayMs * 2^(attempt-1), maxDelayMs), min(...)]` — never
above the cap.

`executeRun`'s own default is still `NO_RETRY_POLICY` (`maxAttempts: 1`) —
retry is opt-in per call, not baked into the scheduler. `worker.ts` is the
one caller that opts in, passing a real `retryPolicy` (audit C2: this used
to be built and unit-tested but never actually passed from the worker, so
no step ever retried in production).

Every failed attempt is recorded twice: `step_runs.error` holds the *latest*
failure reason (what a status view shows), and a `step_logs` row is written
per attempt (what a full retry history/audit trail needs) — `error` alone
would lose earlier attempts' reasons once a later attempt overwrites it.

`maxAttempts < 1` is rejected up front with a clear error, rather than
silently leaving a step stuck `pending` forever (see `assertValidRetryPolicy`).

## Cancellation (Phase 3.4, reachable since P6)

A standard `AbortSignal` is checked **between levels** only — not mid-step,
not mid-retry-backoff, and not between two steps of the same in-flight
level (those are already awaited together). If a step's own work needs to
be interruptible mid-flight, that's the injected `StepExecutor`'s
responsibility (it receives no signal today; a future step-handlers phase
would thread one through if a handler needs it). This keeps the scheduler's
cancellation logic to a single `if (signal?.aborted) break` — coarse-grained,
but simple and correct.

When the loop stops early, every step that never got a status recorded is
by definition cut off by cancellation, so it's marked `skipped` and the run
becomes `cancelled` (distinct from `failed` — it wasn't a failure).

**Reaching it from the API** — `POST /runs/:id/cancel` (`execution/routes.ts`),
backed by two cases in `execution/repository.ts#cancelRun`:

- **`pending`** — cancelled immediately, in the same transaction: the run
  moves straight to `cancelled` (`lifecycle.ts` now allows
  `pending -> cancelled` directly, since no step has been dispatched yet)
  and every still-`pending` `step_run` is bulk-marked `skipped`.
- **`running`** — cancellation is only *requested*. `execution/
  cancellation.ts` is an in-process `Map<runId, AbortController>` that
  `worker.ts` populates for every run it claims (registered before
  `executeRun`, unregistered in the `finally`); the route looks up that
  controller and calls `.abort()`. The run reaches `cancelled` asynchronously,
  whenever the executor's own between-levels check next runs — same
  coarse-grained mechanism as `timeoutMs`, not a new one. If a running run
  somehow has no registered controller (this process isn't the one
  executing it), the request is silently a no-op rather than an error — the
  run's real status in Postgres is the source of truth, not this registry.

A user-facing 409 (`RUN_ALREADY_TERMINAL`) rejects cancelling a run that's
already finished — `isTerminalRunStatus` is checked explicitly before
`assertRunTransition` runs, so a normal race (double-click, a run finishing
just before the cancel request lands) gets a clean error response instead of
the `InvalidRunTransitionError` the other transition-guarded functions in
this file throw (those are "should never happen" internal-bug signals, never
meant to reach an HTTP caller directly).

## Logging

`ExecuteRunOptions.logger` (default: `consoleExecutionLogger`, structured
JSON on stdout/stderr) emits one event per state transition —
`run.started`, `step.queued`, `step.running`, `step.succeeded`,
`step.attempt_failed`, `step.retrying`, `step.failed`, `step.skipped`,
`run.finished` — every step-level event carrying `{ runId, tenantId, stepKey }`
so log lines correlate back to a run/step (Task.md's cross-cutting
invariant). It's injectable, not hardcoded to `console`, so a real
deployment can route it into whatever structured-logging pipeline it
already has without touching this module — `realtime/publisher.ts`'s
`createRealtimeExecutionLogger` is exactly that: it wraps this same
interface to fan a subset of these events out to `run_id`-scoped WebSocket
rooms (see `apps/api/src/realtime/README.md` — Phase 4.1) without
executor.ts knowing realtime infrastructure exists.

## Known performance characteristic

Each step transition (`running`, `retrying`, `succeeded`/`failed`, `skipped`)
is its own DB transaction — a deliberate Phase 3.2 auditability tradeoff
(every intermediate state is durable, not just the final one), not an
oversight. Measured cost is linear in step count (~100 sequential steps
completes in ~3s in the test suite against local Postgres; see
`executor.test.ts`'s "large linear chain" test) — fine at the scale this
project targets (hand-authored or LLM-generated workflows, realistically
tens of steps). If DAGs ever needed to reach into the thousands of steps,
the fix would be batching step-transition writes rather than optimizing the
scheduler itself, which is already O(n).

## Workflow timeout (Phase 3.4 / audit C3)

`ExecuteRunOptions.timeoutMs` sets a global workflow deadline via
`AbortSignal.timeout` — checked at the same between-steps points as
`signal`, so it dominates per-step retry budgets exactly as Task.md:100
requires (a step's own attempt loop never gets to run past the next
between-step check once the deadline has passed). Every step still unreached
when the deadline fires is marked `skipped` and the run becomes `timed_out`
(distinct from `cancelled`, which is what the same cutoff produces when
`signal` fired instead of `timeoutMs`). `worker.ts` passes a fixed
`MAX_RUN_DURATION_MS`; `DelayStep.durationMs` also has a 300s maximum
(`packages/shared-types/src/dag.ts`) so no single step can hang indefinitely
between checks.

This is deliberately the same coarse-grained, between-levels mechanism as
cancellation — it does not abort a step already in flight. That's fine in
practice: `http` now has its own per-hop `AbortSignal.timeout` (see above),
`delay` is capped, `script` is a synchronous stub, and `condition` is
synchronous — so no handler can block past the next check indefinitely.

## Explicitly not here

- **Crash recovery.** A run claimed `'running'` by a process that then dies
  stays `'running'` forever — no lease, no heartbeat, no reaper. `stop()`
  only covers graceful shutdown. (Also the reason `execution/cancellation.ts`'s
  registry doesn't need to survive a restart: a dead process's runs are
  already stuck, cancellable or not, until a reaper exists.)
