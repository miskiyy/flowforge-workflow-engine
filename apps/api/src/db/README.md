# Data layer — migration, index, and log-storage notes

Companion to `db/schema.ts` and `db/migrations/`. Covers the Phase 6 data-depth
deliverables: the `0004` migration, the query optimization it enables, and why
`step_logs` is a plain Postgres table rather than a separate store.

## Migration `0004_add_workflow_id_to_runs.sql`

`runs` already carried `workflow_version_id` (a run pins the exact DAG
definition it executed — deterministic audit/replay, see `schema.ts`). It did
not carry `workflow_id`, so "show me every run for workflow X" required a join
through `workflow_versions` on every request. This migration denormalizes
`workflow_id` onto `runs`:

1. Add the column nullable (a populated table can't get a `NOT NULL` column in
   one step).
2. Backfill from `workflow_versions` — every run has exactly one
   `workflow_version_id`, and every version belongs to exactly one workflow,
   so the join is total; no row is left null.
3. Set `NOT NULL` now that every row has a value.
4. Add the foreign key to `workflow_definitions(id)`.
5. Add `idx_runs_tenant_workflow_status` (see below).

It's numbered `0004`, not `0002` — `0002`/`0003` already landed during Phase 3
for `step_runs.output`/status and the `cancelled` run status. This is simply
the next migration in sequence; it plays the role Task.md's tracker calls
"migration 0002" (written before those two existed).

**Reversal** isn't automated — the migration runner (`db/migrate.ts`) only
applies forward, by design, matching every migration in this repo. The exact
rollback SQL is documented as a trailing comment in the migration file itself
and is safe to run by hand:

```sql
drop index idx_runs_tenant_workflow_status;
alter table runs drop constraint runs_workflow_id_fkey;
alter table runs drop column workflow_id;
delete from schema_migrations where name = '0004_add_workflow_id_to_runs.sql';
```

## Query optimization: `GET /runs?workflowId=X&status=failed`

This is the dashboard's run-history filter — tenant-scoped (always), by
workflow, by status, newest first. Before this migration the query wasn't
expressible at all (no `workflow_id` column); after adding the column, the
only relevant index was `runs_tenant_id_idx` (single column). Measured on a
seeded 300k-row `runs` table, 20 workflows, ~15k rows per workflow:

**Before** (`runs_tenant_id_idx` only — `tenant_id` alone isn't selective
enough with a single active tenant, so the planner reasonably prefers a
sequential scan over the table over an index-then-filter):

```
Limit  (cost=8053.66..8056.11 rows=21 width=120) (actual time=258.820..267.163 rows=21 loops=1)
  ->  Gather Merge  (actual time=258.815..267.152 rows=21 loops=1)
        Workers Launched: 2
        ->  Sort  (actual time=243.783..243.787 rows=17 loops=3)
              Sort Key: created_at DESC, id DESC
              ->  Parallel Seq Scan on runs  (actual time=0.241..240.392 rows=1243 loops=3)
                    Filter: (tenant_id = $1) AND (workflow_id = $2) AND (status = 'failed')
                    Rows Removed by Filter: 98757
Planning Time: 17.681 ms
Execution Time: 267.855 ms
```

**After** adding `idx_runs_tenant_workflow_status on runs (tenant_id,
workflow_id, status, created_at desc)`:

```
Limit  (cost=1.76..30.53 rows=21 width=120) (actual time=1.408..1.463 rows=21 loops=1)
  ->  Incremental Sort  (actual time=1.403..1.407 rows=21 loops=1)
        Sort Key: created_at DESC, id DESC
        Presorted Key: created_at
        ->  Index Scan using idx_runs_tenant_workflow_status on runs  (actual time=0.658..0.878 rows=22 loops=1)
              Index Cond: (tenant_id = $1) AND (workflow_id = $2) AND (status = 'failed')
Planning Time: 5.386 ms
Execution Time: 1.600 ms
```

**267.9ms → 1.6ms (~167x), 4,913 buffer hits → 34.** Full unedited `psql`
output for both runs is in [`explain-evidence.txt`](./explain-evidence.txt).

**Why this shape.** `tenant_id` leads because every query in this codebase is
tenant-scoped first — every other column is only ever filtered *within* a
tenant, never across one, so it must be the leftmost key for the index to be
usable at all. `workflow_id` and `status` follow because they're this
endpoint's actual filter predicates and drizzle-orm/pg-core's default `btree`
handles equality on both directly. `created_at desc` trails so the existing
"newest first" `ORDER BY` (`workflows/repository.ts`'s keyset pagination
scheme, reused here) is satisfied by the index's existing order instead of a
separate sort — that's why the "after" plan shows `Incremental Sort` /
`Presorted Key: created_at` instead of a full sort, and why the row estimate
drops from parallel-scanning ~300k rows to an index range scan.

**Why only this one index.** Every other `runs` read in this codebase
(`GET /runs/:id`, `GET /runs` with no filters, worker-pool polling on
`status='pending' FOR UPDATE SKIP LOCKED`) is already covered by the primary
key or `runs_tenant_id_idx`. Adding more indexes than the query patterns that
exist today is exactly the "five speculative indexes" Task.md calls out — each
one is a write-side cost (every `INSERT`/`UPDATE` on `runs` maintains every
index) paid for a read pattern nobody has yet. If a new hot-path query shows
up, the fix is another `EXPLAIN ANALYZE` and another single justified index,
not a preemptive one now.

## Log storage: why one time-indexed Postgres table, not a second engine

`step_logs` is a plain table — `step_run_id`, `ts`, `level`, `message` — with
one composite index on `(step_run_id, ts)`. No partitioning, no separate
document store, no append-only log service.

For a 4-day MVP at the traffic this system actually sees, every log read is
"give me this step's logs in order," which a `(step_run_id, ts)` btree already
answers in one index scan. A second storage engine (Elasticsearch, Loki, a
dedicated time-series DB) adds an operational surface — another service to
run, monitor, and keep consistent with Postgres — to solve a scale problem
this system doesn't have yet. Table partitioning by time is the same
trade-off one level down: real value once log volume is large enough that a
single table's indexes stop fitting in memory or `VACUUM` gets expensive,
pure overhead before that point ("partitioning theater," per Task.md's locked
decisions).

The scale path, when log volume actually warrants it: age out `step_logs` rows
older than a retention window (say 30–90 days) to S3, optionally through
Glacier for long-tail compliance retention, and keep only the retention window
hot in Postgres. That's a background job and a retention policy, not a schema
change — the table shape doesn't have to move for it to work.
