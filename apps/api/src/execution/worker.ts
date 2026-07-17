import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { workflowVersions } from '../db/schema.js';
import { registerRunController, unregisterRunController } from './cancellation.js';
import { buildExecutionContext } from './context.js';
import { consoleExecutionLogger, executeRun, type ExecutionLogger, type RetryPolicy, type StepExecutor } from './executor.js';
import { runStep as defaultStepExecutor } from './step-handlers.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT_RUNS = 10;
const MAX_CONCURRENT_RUNS_PER_TENANT = 3;

/** Retry, exponential backoff with jitter (Task.md:99) — audit C2 found this built and tested but never passed to executeRun. */
const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30_000 };

/** Global workflow deadline (Task.md:100) — audit C3 found `timed_out` unreachable because nothing ever set executeRun's timeoutMs. */
const MAX_RUN_DURATION_MS = 15 * 60 * 1000;

interface ClaimedRun {
  id: string;
  tenant_id: string;
  workflow_version_id: string;
}

export interface WorkerPoolOptions {
  stepExecutor?: StepExecutor;
  logger?: ExecutionLogger;
  pollIntervalMs?: number;
}

export interface WorkerPool {
  /** Stops polling and waits for every already-claimed run to reach a terminal status before resolving. */
  stop(): Promise<void>;
}

/**
 * Task.md's Phase 3 worker pool, built here in Phase 6 because nothing else
 * in this codebase ever calls `executeRun` on a real request — see
 * execution/README.md. One process, `setInterval`-driven poll loop, no
 * separate worker service (Task.md's locked "no message broker" decision).
 *
 * The claim query is a single atomic
 * `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` — the
 * standard Postgres job-queue idiom. That one statement is both the claim
 * and the pending->running transition, so two pollers (this process on its
 * next tick, or a horizontally-scaled second process) can never claim the
 * same row. `executeRun` is told the run is already 'running' (see the
 * `context.status` check added to executor.ts) so it doesn't try to
 * transition it again.
 */
export function startWorkerPool(options: WorkerPoolOptions = {}): WorkerPool {
  const stepExecutor = options.stepExecutor ?? defaultStepExecutor;
  const logger = options.logger ?? consoleExecutionLogger;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const inFlightByTenant = new Map<string, number>();
  let totalInFlight = 0;
  let stopped = false;

  function trackStart(tenantId: string): void {
    totalInFlight += 1;
    inFlightByTenant.set(tenantId, (inFlightByTenant.get(tenantId) ?? 0) + 1);
  }

  function trackEnd(tenantId: string): void {
    totalInFlight -= 1;
    const remaining = (inFlightByTenant.get(tenantId) ?? 1) - 1;
    if (remaining <= 0) inFlightByTenant.delete(tenantId);
    else inFlightByTenant.set(tenantId, remaining);
  }

  /**
   * Bounded in-flight runs per tenant (Task.md's backpressure requirement).
   * Audit C4: claiming from a single global `order by created_at limit N`
   * query let one tenant with a deep backlog claim the whole tick's
   * capacity, because MAX_CONCURRENT_RUNS_PER_TENANT was only enforced
   * *between* ticks (via inFlightByTenant), never *within* one. Fixed by
   * claiming per tenant, each capped at its own remaining headroom, oldest-
   * waiting tenant first — one UPDATE per tenant with pending work rather
   * than one query with a per-row per-tenant cap (Postgres forbids `FOR
   * UPDATE` alongside a window function in the same select), which is fine
   * at this scale: at most a handful of tenants have pending work on any
   * given 2s tick.
   */
  async function claimPendingRuns(limit: number): Promise<ClaimedRun[]> {
    if (limit <= 0) return [];

    const { rows: pendingTenants } = await pool.query<{ tenant_id: string }>(
      `select tenant_id from runs where status = 'pending' group by tenant_id order by min(created_at) asc`,
    );

    const claimed: ClaimedRun[] = [];
    for (const { tenant_id } of pendingTenants) {
      if (claimed.length >= limit) break;
      const headroom = MAX_CONCURRENT_RUNS_PER_TENANT - (inFlightByTenant.get(tenant_id) ?? 0);
      if (headroom <= 0) continue;

      const take = Math.min(headroom, limit - claimed.length);
      const result = await pool.query<ClaimedRun>(
        `update runs
         set status = 'running', started_at = now()
         where id in (
           select id from runs
           where status = 'pending' and tenant_id = $1
           order by created_at asc
           for update skip locked
           limit $2
         )
         returning id, tenant_id, workflow_version_id`,
        [tenant_id, take],
      );
      claimed.push(...result.rows);
    }
    return claimed;
  }

  async function executeClaimedRun(claimed: ClaimedRun): Promise<void> {
    trackStart(claimed.tenant_id);
    // Registered before executeRun so a cancel request arriving at any point
    // during this run's lifetime finds a live controller — this is what
    // actually makes execution/repository.ts#cancelRun's "running" path
    // reachable (executor.ts's `signal` handling existed and was tested from
    // Phase 3.4 on, but nothing ever constructed a real AbortController).
    const controller = new AbortController();
    registerRunController(claimed.id, controller);
    try {
      const [version] = await db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.id, claimed.workflow_version_id));
      if (!version) {
        throw new Error(`run ${claimed.id} references missing workflow_version ${claimed.workflow_version_id}`);
      }

      const context = buildExecutionContext({
        runId: claimed.id,
        tenantId: claimed.tenant_id,
        workflowVersionId: claimed.workflow_version_id,
        status: 'running',
        dag: version.dagDefinition,
      });
      await executeRun(context, stepExecutor, {
        logger,
        retryPolicy: DEFAULT_RETRY_POLICY,
        random: Math.random,
        timeoutMs: MAX_RUN_DURATION_MS,
        signal: controller.signal,
      });
    } catch (err) {
      logger.error('worker.run_failed', {
        runId: claimed.id,
        tenantId: claimed.tenant_id,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      unregisterRunController(claimed.id);
      trackEnd(claimed.tenant_id);
    }
  }

  async function pollOnce(): Promise<void> {
    const capacity = MAX_CONCURRENT_RUNS - totalInFlight;
    if (capacity <= 0) return;
    const claimed = await claimPendingRuns(capacity);
    for (const run of claimed) {
      void executeClaimedRun(run);
    }
  }

  const interval = setInterval(() => {
    if (stopped) return;
    pollOnce().catch((err: unknown) => {
      logger.error('worker.poll_failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }, pollIntervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(interval);
      // Let already-claimed runs finish naturally rather than aborting mid-step.
      while (totalInFlight > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}
