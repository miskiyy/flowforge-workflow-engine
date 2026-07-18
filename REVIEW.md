# REVIEW.md

The brief's code-review exercise ("review a deliberately flawed code
snippet") was never actually supplied with this project's assignment
materials — there was no separate file to review. Rather than leave this
requirement unmet, the snippet below was written to be representative: a
teammate's PR adding a "bulk retry failed runs" endpoint to FlowForge,
containing the kind of mistakes this codebase's own `guards.ts`,
`step-handlers.ts`, and `worker.ts` comments explicitly call out and guard
against elsewhere (SSRF, tenant leakage, unbounded concurrency). Reviewed
exactly as if it landed as a real PR against `apps/api`.

---

## The PR under review

**Title:** `feat: bulk-retry failed runs for a workflow`
**Description:** "Adds `POST /workflows/:id/retry-failed` so an operator can
re-trigger every failed run for a workflow in one call, instead of
retriggering them one at a time from the dashboard."

```ts
// apps/api/src/execution/routes.ts

app.post('/workflows/:id/retry-failed', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { tenantId } = request.body as { tenantId: string };

  const query = `
    SELECT * FROM runs
    WHERE workflow_id = '${id}' AND status = 'failed' AND tenant_id = '${tenantId}'
  `;
  const { rows } = await pool.query(query);

  const retried = [];
  for (const run of rows) {
    try {
      const result = await startRun({
        tenantId,
        workflowId: id,
        triggerType: 'manual',
      });
      retried.push(result.run.id);
    } catch (err) {
      console.log('retry failed, skipping', err);
    }
  }

  reply.send({ retriedCount: retried.length, retried });
});
```

---

## Review comments

**1. Blocker — `tenantId` comes from the request body, not the verified JWT.**
`const { tenantId } = request.body` means any authenticated caller can pass
any tenant's ID and retry (and read the row count of) another tenant's
failed runs. Every other route in this codebase reads `tenantId` from
`request.authUser.tenantId`, populated by the `authenticate` preHandler
from the verified token (see `auth/plugin.ts` — "tenant_id always comes
from the verified JWT, never from the request body/params"). This one
route breaks that invariant, and it's the one invariant this whole app is
built around. This needs to be `request.authUser.tenantId`, full stop, and
the route needs `preHandler: [app.authenticate, app.requireWrite]` like
every sibling route — as written there's no auth check on this handler at
all.

**2. Blocker — SQL injection via string interpolation.**
`WHERE workflow_id = '${id}' ... tenant_id = '${tenantId}'` builds the
query by concatenating unsanitized input directly into SQL text. A
`workflowId` of `' OR '1'='1` returns every run in the table; something
worse can drop it. Every other query in `execution/repository.ts` and
`workflows/repository.ts` goes through Drizzle's query builder or
parameterized `pool.query(sql, [params])` calls specifically to make this
class of bug impossible by construction — this handler bypasses that
entirely by hand-rolling SQL as a template string.

**3. High — no route-level input validation.**
There's no TypeBox schema on `params` or `body` (compare to every route in
`workflows/routes.ts`, which validates `id` as `Type.String({format:
'uuid'})`). A non-UUID `id` reaches the database as a raw string instead of
400ing at the framework level, and `tenantId` isn't validated as a string
at all — if the body is malformed, this throws an unhandled 500 instead of
a clean 400.

**4. High — unbounded, unpaginated `SELECT *`.**
A workflow with 50,000 historical failed runs loads all 50,000 rows into
process memory in one query, then retries all of them in a single request.
Every list endpoint elsewhere in this API is cursor-paginated with a
`limit` cap of 100 (`workflows/routes.ts`'s `ListWorkflowsQuery`,
`execution/routes.ts`'s `ListRunsQuery`) specifically to prevent this. This
also has no time bound — "failed" runs from a year ago get retried
alongside ones from five minutes ago, which is very unlikely to be what an
operator wants.

**5. High — sequential `await` in the loop serializes N runs behind one
request/response cycle.**
Retrying 500 failed runs means 500 sequential `startRun` calls before the
HTTP response is sent — the request will time out long before it finishes,
and the client has no way to know how many succeeded if it does. This
project's own executor bounds concurrency deliberately
(`execution/executor.ts`'s `maxParallelSteps`, default 8) rather than
either serializing everything or firing everything at once; this handler
does neither correctly — it's not concurrent (so it's slow) and it's also
not rate-limited (so a large enough batch would thundering-herd the
worker pool's per-tenant concurrency cap the moment it did try to run
concurrently). This needs to run as a background job that the caller polls
or gets notified on, not inline in the request handler.

**6. Medium — the failure branch silently swallows errors.**
`catch (err) { console.log(...) }` means if `startRun` fails for a
tenant-isolation reason, a bad workflow state, or a database error, the
caller gets a `200` with a slightly lower `retriedCount` and *no
indication anything went wrong*. At minimum, failed items need to come
back in the response (`{ retried: [...], failed: [{ runId, error }] }`) so
the caller can distinguish "nothing was in the failed state" from
"12 retries silently errored."

**7. Medium — no rate limiting.**
Every other write route in this API goes through the same
`TokenBucketLimiter` shape (`workflows/routes.ts`, `execution/routes.ts`) —
this one has none, and it's the one route in the API capable of enqueuing
an arbitrary number of runs in a single call, which is exactly the
situation rate limiting exists to bound.

**8. Nit — the route doesn't check whether the workflow itself belongs to
the caller's tenant before querying its runs.** Even after fixing #1, this
should still look up the workflow definition first (like every other
`/workflows/:id/...` route does via `getWorkflow(tenantId, id)`) so a
request for a workflow ID that doesn't exist — or belongs to another
tenant post-fix — 404s instead of silently returning zero rows, which
reads to the caller exactly like "there were no failed runs."

---

## Suggested revision

```ts
// apps/api/src/execution/routes.ts

const RetryFailedParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const RetryFailedQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

app.post(
  '/workflows/:id/retry-failed',
  {
    schema: { params: RetryFailedParams, querystring: RetryFailedQuery },
    preHandler: [app.authenticate, rateLimit, app.requireWrite],
  },
  async (request, reply) => {
    const { id: workflowId } = request.params as { id: string };
    const { limit } = request.query as { limit?: number };
    const tenantId = request.authUser.tenantId; // never from body/params

    // 404s if the workflow doesn't exist or belongs to another tenant —
    // same check every other /workflows/:id route makes first.
    await getWorkflow(tenantId, workflowId);

    // Parameterized, tenant-scoped, and capped — never an unbounded SELECT *.
    const failedRuns = await listRuns({
      tenantId,
      workflowId,
      status: 'failed',
      limit: limit ?? 20,
    });

    // Bounded concurrency — same idea as executor.ts's mapWithConcurrency
    // (private to that module; a shared version returning per-item results,
    // not just void, would need its own small utility) — not one-at-a-time,
    // not all-at-once.
    const outcomes = await mapWithConcurrencyCollecting(failedRuns.items, 8, async (run) => {
      try {
        const result = await startRun({ tenantId, workflowId, triggerType: 'manual' });
        return { ok: true as const, runId: run.id, newRunId: result.run.id };
      } catch (err) {
        return { ok: false as const, runId: run.id, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const retried = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);
    return reply.send({ retriedCount: retried.length, retried, failed });
  },
);
```

This fixes #1–#5 and #8 directly. #6 is fixed by returning `failed`
instead of swallowing it. #7 is fixed by reusing the same `rateLimit`
preHandler every other write route in this file already defines. It still
doesn't fully solve #5 for a very large `failedRuns.items` — a true fix
moves this to a background job — but capping `limit` to 50 and running it
under the same bounded-concurrency helper the executor already uses keeps
a single request from being able to take down the worker pool, which was
the acute risk.
