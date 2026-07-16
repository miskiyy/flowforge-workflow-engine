# Realtime client (Phase 4.2 + 4.3 hardening)

```
realtime/
  types.ts         wire contract, mirrors apps/api/src/realtime/events.ts
  useRunStream.ts  connection lifecycle + the pure runStreamReducer/classifySeq helpers
```

`useRunStream(apiUrl, wsUrl, runId, token)` owns one run's live view end to
end: REST resync -> WS connect -> apply events -> recover from drops. Two
pieces are exported as plain functions specifically so the hardening logic
below is unit-testable without a socket or a component:

- `runStreamReducer` — event -> state, pure.
- `classifySeq(lastSeq, seq)` — `'accept' | 'duplicate' | 'gap'`, pure.

## Reconnect strategy

Exponential backoff — 1s, 2s, 4s, ... capped at 30s — on any unexpected
`close`. Every reconnect **resyncs via REST first, then reopens the socket**
(never assumes the stream picks up where it left off), so whatever changed
while disconnected — including a run that finished entirely while offline —
is reflected immediately once the connection is back.

## Stale event handling

Each call to `openSocket()` bumps a `connectionId` counter and every handler
on that socket closes over its own `myConnectionId` + `isStale()` check. Once
a connection is superseded (a gap or a drop triggered a reconnect), any
event that still arrives on the *old* socket — a message the browser had
already buffered, a `close` that fires after the fact — is silently ignored
instead of being applied against state that has already moved on. Handlers
also close over their own socket instance (`mySocket`) rather than a shared
mutable variable, so closing "this connection" can never accidentally close
a newer one that has already replaced it.

## Duplicate event handling

`classifySeq(lastSeq, seq)`:

- `seq === lastSeq + 1` -> `'accept'` — the expected next event.
- `seq <= lastSeq` -> `'duplicate'` — already seen (exact replay) or older
  than what's already applied (a late-arriving straggler). Dropped silently;
  does **not** trigger a resync — a duplicate is not a gap.
- `seq > lastSeq + 1` -> `'gap'` — something was missed. Discards the
  connection and does a full REST resync rather than trying to patch the
  hole (simpler and more correct than a replay buffer for this scope).
- `lastSeq === null` (right after a snapshot) -> `'accept'` unconditionally —
  there is no seq to compare against yet, so the first event received
  becomes the new baseline.

## Disconnect recovery

A dropped connection always resyncs via REST before reopening the socket
(see Reconnect strategy above), so recovery isn't just "a new socket
opens" — it's "the UI reflects whatever the server did while we were gone."
`lastSeq` is reset to `null` on every resync for the same reason `classifySeq`
treats `null` as "accept unconditionally": the client has no way to know
what seq a REST snapshot corresponds to (`seq` is an in-memory counter on
the API's `RunPublisher`, not derived from any persisted column), so gap
checking can only resume once a real event re-establishes the baseline.

## Loading / error states

`connectionStatus` includes `'error'` alongside
`connecting | open | reconnecting | closed`. The REST resync
(`api/runs.ts#fetchRun`) throws `ApiError` carrying the HTTP status; 401,
403, and 404 are treated as **permanent** — retrying can never succeed
(bad/expired token, or a run that doesn't exist) — so the hook stops and
surfaces `connectionStatus: 'error'` + a message instead of looping
reconnect attempts forever. Any other failure (network blip, 5xx) is
treated as transient and goes through the normal backoff-reconnect path.
`RunDetailPage` renders three mutually exclusive states: the error message,
a loading placeholder (no snapshot yet), or the live view (itself split into
a "waiting for a worker" message while `run.status === 'pending'`, or the
full graph/progress/timeline once it starts).
