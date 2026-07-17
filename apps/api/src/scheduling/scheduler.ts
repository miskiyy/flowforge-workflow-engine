import { and, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workflowDefinitions } from '../db/schema.js';
import { startRun } from '../execution/repository.js';
import type { ExecutionLogger } from '../execution/executor.js';
import { consoleExecutionLogger } from '../execution/executor.js';
import { matchesCron, minuteBucketKey } from './cron.js';

const DEFAULT_TICK_INTERVAL_MS = 60_000;

export interface CronSchedulerOptions {
  logger?: ExecutionLogger;
  tickIntervalMs?: number;
  /** Injectable so tests can drive a fixed instant instead of the wall clock. */
  now?: () => Date;
}

export interface CronScheduler {
  stop(): void;
}

/**
 * Task.md:102 — "cron scheduler (checks cron_expression each minute, inserts
 * same pending run)". One shared trigger path: this calls the identical
 * `startRun` the manual-trigger route and the webhook route both call, just
 * with `triggerType: 'cron'` and a per-minute idempotency key, so a run
 * created this way is indistinguishable downstream (worker pool, realtime,
 * dashboard) from any other trigger source.
 *
 * All tenants, one process — consistent with this project's already-locked
 * "no message broker, no separate worker service" posture (execution/worker.ts).
 */
export interface RunCronTickOptions {
  logger?: ExecutionLogger;
  now?: () => Date;
}

/**
 * One evaluation pass over every workflow with a cron_expression, exported
 * standalone (not just wrapped in setInterval) so tests can await a single
 * deterministic tick instead of racing real timers against async DB work.
 */
export async function runCronTick(options: RunCronTickOptions = {}): Promise<void> {
  const logger = options.logger ?? consoleExecutionLogger;
  const now = options.now ?? (() => new Date());
  const nowDate = now();
  const idempotencyKey = minuteBucketKey(nowDate);

  const candidates = await db
    .select({
      id: workflowDefinitions.id,
      tenantId: workflowDefinitions.tenantId,
      cronExpression: workflowDefinitions.cronExpression,
    })
    .from(workflowDefinitions)
    .where(and(isNull(workflowDefinitions.deletedAt), isNotNull(workflowDefinitions.cronExpression)));

  for (const workflow of candidates) {
    if (!workflow.cronExpression || !matchesCron(workflow.cronExpression, nowDate)) continue;

    try {
      const result = await startRun({
        tenantId: workflow.tenantId,
        workflowId: workflow.id,
        triggerType: 'cron',
        idempotencyKey,
      });
      if (!result.deduped) {
        logger.info('cron.triggered', { workflowId: workflow.id, tenantId: workflow.tenantId, runId: result.run.id });
      }
    } catch (err) {
      logger.error('cron.trigger_failed', {
        workflowId: workflow.id,
        tenantId: workflow.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startCronScheduler(options: CronSchedulerOptions = {}): CronScheduler {
  const logger = options.logger ?? consoleExecutionLogger;
  const tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const now = options.now;
  let stopped = false;

  const interval = setInterval(() => {
    if (stopped) return;
    runCronTick({ logger, ...(now ? { now } : {}) }).catch((err: unknown) => {
      logger.error('cron.tick_failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }, tickIntervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
