import { describe, expect, it } from 'vitest';
import { pool } from '../src/db/client.js';
import type { StepExecutor } from '../src/execution/executor.js';
import { startRun } from '../src/execution/repository.js';
import { startWorkerPool } from '../src/execution/worker.js';
import { createWorkflow } from '../src/workflows/repository.js';
import { createTenant, createUser } from './fixtures.js';

const silentLogger = { info: () => {}, error: () => {} };

async function countRunning(tenantId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from runs where tenant_id = $1 and status = 'running'`,
    [tenantId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Audit C4: `claimPendingRuns` used to be a single global
 * `order by created_at limit N` query with no per-tenant partition — a
 * tenant with 0 in-flight and a deep backlog could claim the entire tick's
 * capacity in one shot, because MAX_CONCURRENT_RUNS_PER_TENANT was only
 * enforced *between* ticks (via inFlightByTenant), never *within* one.
 */
describe('worker pool — per-tenant backpressure holds within a single poll tick (audit C4)', () => {
  it('claims at most MAX_CONCURRENT_RUNS_PER_TENANT runs for one tenant even with a much deeper backlog', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: `worker-c4-${tenant.id}`,
      dag: { steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }] },
    });

    // 5 pending runs — well above MAX_CONCURRENT_RUNS_PER_TENANT (3) and
    // easily satisfiable within MAX_CONCURRENT_RUNS (10) if the per-tenant
    // cap didn't hold.
    for (let i = 0; i < 5; i++) {
      await startRun({ tenantId: tenant.id, userId: user.id, workflowId: definition.id });
    }

    // Holds every claimed run 'running' long enough to observe the claim
    // without hanging the test on a real delay.
    const stepExecutor: StepExecutor = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { status: 'succeeded' };
    };

    const workerPool = startWorkerPool({ stepExecutor, pollIntervalMs: 50, logger: silentLogger });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200)); // after at least one tick, well before steps resolve

      const runningCount = await countRunning(tenant.id);
      expect(runningCount).toBeGreaterThan(0);
      expect(runningCount).toBeLessThanOrEqual(3);
    } finally {
      await workerPool.stop();
    }
  }, 10_000);
});
