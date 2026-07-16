# Realtime (Phase 4.1)

WebSocket infrastructure only — publishing execution events to `run_id`-scoped
rooms. No dashboard, no consumer. The execution engine stays the single
source of truth: nothing here writes to `runs`/`step_runs`, and executor.ts's
scheduling/retry/cancellation logic is untouched except for one additive log
line (`step.queued`, emitted right before a step starts — see
`execution/executor.ts`).

## Layers

```
realtime/
  events.ts      pure types + serialization + log-event -> realtime-event mapping
  publisher.ts   RunPublisher (room registry + fan-out) and the ExecutionLogger adapter
  gateway.ts     WS /runs/:id/stream — connection lifecycle + auth + room join
```

## Wire contract

```
{ type, runId, tenantId, seq, ts, stepKey?, attemptNumber?, error? }
```

`type` is one of `execution.started`, `step.queued`, `step.running`,
`step.succeeded`, `step.failed`, `execution.completed`, `execution.cancelled`
— the seven events this phase is scoped to. `seq` is a monotonic per-run
counter assigned at publish time (not derived from `step_runs.attempt_number`
or any DB column) so a client can detect a dropped message by checking for
gaps, without a replay buffer on the server.

## How the executor's events reach a socket

`executor.ts` already takes an injectable `ExecutionLogger` (Phase 3.5) that
fires on every state transition. `createRealtimeExecutionLogger` wraps that
same interface: on each `info`/`error` call it forwards to the existing
console logger unchanged, then maps the subset of events in the realtime
vocabulary (`mapLogEventToRealtimeEvent`, `events.ts`) and publishes them to
that run's room. Nothing in `executor.ts` imports or knows about `ws`,
`RunPublisher`, or rooms — the only coupling is the `ExecutionLogger`
interface that already existed.

`execution/worker.ts` (Phase 6) is the dispatcher that actually calls
`executeRun` in production. `server.ts` wires the two together: it passes
`createRealtimeExecutionLogger(app.realtimePublisher)` as the worker pool's
logger, so a run the worker executes fans its events out to this run's WS
room the same way a directly-called `executeRun` would in a test.

## Auth

Browsers can't set custom headers on a WebSocket handshake, so the JWT
travels as `?token=` instead of the `Authorization: Bearer` header the REST
routes use. Verified with the same `app.jwt` instance `auth/plugin.ts`
already registers — no second JWT implementation. A connection is only
admitted to a room after `execution/repository.ts`'s tenant-scoped `getRun`
confirms the token's tenant owns that run; missing run and wrong-tenant both
reject with 404 (never 403), matching the REST history endpoints, so a probe
can't distinguish "doesn't exist" from "not yours."

## Rooms

One `Set<WebSocket>` per `run_id`, in-process (`publisher.ts`). Scoped
subscriptions, not broadcast-to-all, per Task.md's locked decision. A room is
created on first join and deleted once its last socket leaves — no unbounded
growth from short-lived runs.

`ponytail: in-process only — a second API instance won't see rooms opened on
another instance. Task.md's architecture doc names Redis pub/sub as the swap
when the api/ws split happens; not needed at this scale.`

## Explicitly not here

- Dashboard/UI consumer of these events (Phase 4.2+).
- A worker/dispatcher calling `executeRun` in production — still Phase 3's
  deferred scope; this module only prepares the logger it will need.
- Gap-recovery/replay on the server — `seq` lets a client *detect* a gap; the
  documented recovery is a REST resync (`flowforge-analysis.md` §"Gap
  detection"), not a server-side replay buffer.
