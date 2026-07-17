import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { and, asc, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { db, pool, type Tx } from '../db/client.js';
import { runs, stepLogs, stepRuns, workflowDefinitions, workflowVersions } from '../db/schema.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { assertRunTransition, assertStepTransition, isTerminalRunStatus, type RunStatus, type StepStatus } from './lifecycle.js';

export type RunRow = typeof runs.$inferSelect;
export type StepRunRow = typeof stepRuns.$inferSelect;
export type StepLogRow = typeof stepLogs.$inferSelect;

export type TriggerType = 'manual' | 'cron' | 'webhook';

export interface StartRunInput {
  tenantId: string;
  workflowId: string;
  /** Absent for cron/webhook triggers — there's no acting user. */
  userId?: string;
  /** Defaults to 'manual' — the only trigger type routes.ts's manual endpoint ever passes. */
  triggerType?: TriggerType;
  /**
   * Cron/webhook only (Task.md:102's "avoid double-fire on retry"). A replayed
   * webhook delivery or a scheduler tick that re-evaluates the same minute
   * reuses the same key, so the unique index on (workflow_id,
   * idempotency_key) turns a would-be duplicate insert into a lookup of the
   * run that already exists instead.
   */
  idempotencyKey?: string;
}

export interface StartRunResult {
  run: RunRow;
  steps: StepRunRow[];
  /** True if `idempotencyKey` matched an existing run instead of creating a new one. */
  deduped: boolean;
}

/**
 * Starts execution: pins the workflow's *current* version, creates the run
 * (status 'pending') and one pending step_runs row per DAG step so history
 * has a row for every step from the start. Nothing here dispatches a step —
 * moving a run to 'running' and beyond is a later phase's job.
 */
export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  return db.transaction(async (tx) => {
    const [workflow] = await tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.id, input.workflowId),
          eq(workflowDefinitions.tenantId, input.tenantId),
          isNull(workflowDefinitions.deletedAt),
        ),
      );
    if (!workflow) throw new NotFoundError('Workflow not found');
    if (!workflow.currentVersionId) {
      throw new AppError(409, 'NO_CURRENT_VERSION', 'Workflow has no version to run');
    }

    if (input.idempotencyKey !== undefined) {
      const [existingRun] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.workflowId, workflow.id), eq(runs.idempotencyKey, input.idempotencyKey)));
      if (existingRun) {
        const steps = await tx.select().from(stepRuns).where(eq(stepRuns.runId, existingRun.id)).orderBy(asc(stepRuns.stepKey));
        return { run: existingRun, steps, deduped: true };
      }
    }

    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflow.currentVersionId));
    if (!version) throw new NotFoundError('Workflow version not found');

    const [run] = await tx
      .insert(runs)
      .values({
        tenantId: input.tenantId,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        triggerType: input.triggerType ?? 'manual',
        triggeredBy: input.userId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'pending',
      })
      .returning();
    if (!run) throw new Error('failed to create run');

    const steps = await tx
      .insert(stepRuns)
      .values(version.dagDefinition.steps.map((step) => ({ runId: run.id, stepKey: step.key, status: 'pending' as const })))
      .returning();

    return { run, steps, deduped: false };
  });
}

async function loadTenantRunForUpdate(tx: Tx, tenantId: string, runId: string): Promise<RunRow> {
  const [run] = await tx
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.tenantId, tenantId)))
    .for('update');
  if (!run) throw new NotFoundError('Run not found');
  return run;
}

export interface CancelRunResult {
  run: RunRow;
  /**
   * True: the run was still 'pending' and is cancelled immediately, right
   * here, in this transaction. False: the run was 'running' — this only
   * *requests* cancellation (the caller, execution/routes.ts, asks the
   * in-process executor via execution/cancellation.ts's abort registry);
   * the run reaches 'cancelled' asynchronously, on the executor's own next
   * between-levels check.
   */
  cancelledImmediately: boolean;
}

/**
 * A user-facing action, unlike the other transitions in this file — cancelling
 * an already-terminal run is a normal thing for a caller to attempt (a race
 * with the run finishing, or a second cancel click), not a programmer error,
 * so it's rejected with a clean AppError here rather than letting
 * assertRunTransition's InvalidRunTransitionError (meant for "should never
 * happen" internal bugs) reach the HTTP layer unhandled.
 */
export async function cancelRun(tenantId: string, runId: string): Promise<CancelRunResult> {
  return db.transaction(async (tx) => {
    const run = await loadTenantRunForUpdate(tx, tenantId, runId);

    if (isTerminalRunStatus(run.status as RunStatus)) {
      throw new AppError(409, 'RUN_ALREADY_TERMINAL', `Run is already "${run.status}" and cannot be cancelled`);
    }

    if (run.status === 'running') {
      return { run, cancelledImmediately: false };
    }

    assertRunTransition('pending', 'cancelled');
    const [updated] = await tx
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(runs.id, run.id))
      .returning();
    if (!updated) throw new Error('failed to cancel run');

    // Every step_run made by startRun starts 'pending' — none of them ever
    // ran, so a bulk pending->skipped update needs no per-row transition
    // check (that transition is unconditionally legal from 'pending').
    await tx.update(stepRuns).set({ status: 'skipped' }).where(and(eq(stepRuns.runId, run.id), eq(stepRuns.status, 'pending')));

    return { run: updated, cancelledImmediately: true };
  });
}

/** Moves a run into 'running'. Throws InvalidRunTransitionError if it isn't currently 'pending'. */
export async function markRunRunning(tenantId: string, runId: string): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await loadTenantRunForUpdate(tx, tenantId, runId);
    assertRunTransition(run.status as RunStatus, 'running');

    const [updated] = await tx
      .update(runs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(runs.id, run.id))
      .returning();
    if (!updated) throw new Error('failed to update run');
    return updated;
  });
}

/** Moves a run into a terminal status. Throws InvalidRunTransitionError if the run isn't 'running'. */
export async function finishRun(
  tenantId: string,
  runId: string,
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled',
): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await loadTenantRunForUpdate(tx, tenantId, runId);
    assertRunTransition(run.status as RunStatus, status);

    const [updated] = await tx
      .update(runs)
      .set({ status, finishedAt: new Date() })
      .where(eq(runs.id, run.id))
      .returning();
    if (!updated) throw new Error('failed to update run');
    return updated;
  });
}

async function loadStepRunForUpdate(tx: Tx, runId: string, stepKey: string): Promise<StepRunRow> {
  const [step] = await tx
    .select()
    .from(stepRuns)
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.stepKey, stepKey)))
    .for('update');
  if (!step) throw new NotFoundError(`Step run not found: ${stepKey}`);
  return step;
}

interface StepTransitionExtra {
  output?: unknown;
  error?: string;
  attemptNumber?: number;
}

/** Verifies the run belongs to the tenant, then applies a validated step-status transition. */
async function transitionStep(
  tenantId: string,
  runId: string,
  stepKey: string,
  to: StepStatus,
  extra: StepTransitionExtra = {},
): Promise<StepRunRow> {
  return db.transaction(async (tx) => {
    await loadTenantRunForUpdate(tx, tenantId, runId);
    const step = await loadStepRunForUpdate(tx, runId, stepKey);
    assertStepTransition(step.status as StepStatus, to);

    // startedAt is set once, on the first attempt — a retry re-entering
    // 'running' keeps the original start time so duration reflects the
    // whole retry sequence, not just the last attempt.
    const timestamps =
      to === 'running'
        ? step.startedAt
          ? {}
          : { startedAt: new Date() }
        : to === 'succeeded' || to === 'failed'
          ? { finishedAt: new Date() }
          : {};

    const [updated] = await tx
      .update(stepRuns)
      .set({ status: to, ...timestamps, ...extra })
      .where(eq(stepRuns.id, step.id))
      .returning();
    if (!updated) throw new Error('failed to update step run');
    return updated;
  });
}

export function markStepRunning(tenantId: string, runId: string, stepKey: string, attemptNumber = 1): Promise<StepRunRow> {
  return transitionStep(tenantId, runId, stepKey, 'running', { attemptNumber });
}

/** A failed attempt with retries remaining — records the attempt before the executor sleeps and retries. */
export function markStepRetrying(tenantId: string, runId: string, stepKey: string, attemptNumber: number): Promise<StepRunRow> {
  return transitionStep(tenantId, runId, stepKey, 'retrying', { attemptNumber });
}

export function markStepSucceeded(tenantId: string, runId: string, stepKey: string, output?: unknown): Promise<StepRunRow> {
  return transitionStep(tenantId, runId, stepKey, 'succeeded', { output: output ?? null });
}

export function markStepFailed(tenantId: string, runId: string, stepKey: string, error: string): Promise<StepRunRow> {
  return transitionStep(tenantId, runId, stepKey, 'failed', { error });
}

/** A step whose dependency already failed/skipped, or was never reached because the run was cancelled. */
export function markStepSkipped(tenantId: string, runId: string, stepKey: string): Promise<StepRunRow> {
  return transitionStep(tenantId, runId, stepKey, 'skipped');
}

/** Failure recording: one row per failed attempt, so retry history survives even though step_runs.error only holds the latest. */
export async function recordStepLog(stepRunId: string, level: string, message: string): Promise<void> {
  await db.insert(stepLogs).values({ stepRunId, level, message });
}

export async function getStepLogs(stepRunId: string): Promise<StepLogRow[]> {
  return db.select().from(stepLogs).where(eq(stepLogs.stepRunId, stepRunId)).orderBy(asc(stepLogs.ts));
}

/**
 * Tenant-scoped read for the per-step logs route (P11): the run must belong
 * to the caller's tenant before any log row is visible. Only step_logs comes
 * back — never step_runs.output, which can hold a raw http response body
 * (audit C1's exposure concern).
 */
export async function getStepLogsForRun(tenantId: string, runId: string, stepKey: string): Promise<StepLogRow[]> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.tenantId, tenantId)));
  if (!run) throw new NotFoundError('Run not found');

  const [step] = await db
    .select()
    .from(stepRuns)
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.stepKey, stepKey)));
  if (!step) throw new NotFoundError(`Step run not found: ${stepKey}`);

  return getStepLogs(step.id);
}

export async function getRun(
  tenantId: string,
  runId: string,
): Promise<{ run: RunRow; steps: StepRunRow[]; dag: WorkflowDagDefinition }> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.tenantId, tenantId)));
  if (!run) throw new NotFoundError('Run not found');

  // A run pins an exact workflow_version_id (see db/schema.ts), so the DAG
  // shape a dashboard needs to render the graph comes from that version, not
  // from the workflow's (possibly since-changed) current version.
  const [version] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, run.workflowVersionId));
  if (!version) throw new Error(`run ${run.id} references missing workflow_version ${run.workflowVersionId}`);

  const steps = await db.select().from(stepRuns).where(eq(stepRuns.runId, run.id)).orderBy(asc(stepRuns.stepKey));
  return { run, steps, dag: version.dagDefinition };
}

export interface TenantRunStats {
  activeRuns: number;
  last24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number | null;
  };
}

/**
 * The health panel's aggregate (GET /stats) — one query, computed in Postgres,
 * never by paginating GET /runs client-side. "failed" folds in timed_out
 * (both are unsuccessful terminal outcomes); cancelled runs count toward
 * total but neither rate's numerator. Rates/averages are null, not 0, when
 * nothing finished in the window — "no data" and "0% success" are different
 * statements.
 */
export async function getTenantRunStats(tenantId: string): Promise<TenantRunStats> {
  const { rows } = await pool.query<{
    active: string;
    total_24h: string;
    succeeded_24h: string;
    failed_24h: string;
    avg_duration_ms: string | null;
  }>(
    `select
       count(*) filter (where status in ('pending', 'running')) as active,
       count(*) filter (where finished_at >= now() - interval '24 hours') as total_24h,
       count(*) filter (where status = 'succeeded' and finished_at >= now() - interval '24 hours') as succeeded_24h,
       count(*) filter (where status in ('failed', 'timed_out') and finished_at >= now() - interval '24 hours') as failed_24h,
       avg(extract(epoch from (finished_at - started_at)) * 1000)
         filter (where started_at is not null and finished_at >= now() - interval '24 hours') as avg_duration_ms
     from runs
     where tenant_id = $1`,
    [tenantId],
  );

  const row = rows[0];
  if (!row) throw new Error('stats aggregate returned no row');
  const total = Number(row.total_24h);
  const succeeded = Number(row.succeeded_24h);
  return {
    activeRuns: Number(row.active),
    last24h: {
      total,
      succeeded,
      failed: Number(row.failed_24h),
      successRate: total > 0 ? succeeded / total : null,
      avgDurationMs: row.avg_duration_ms === null ? null : Math.round(Number(row.avg_duration_ms)),
    },
  };
}

export interface ListRunsInput {
  tenantId: string;
  workflowId?: string;
  workflowVersionId?: string;
  status?: RunStatus;
  cursor?: string;
  limit: number;
}

/** Execution history: tenant-scoped, newest first, keyset-paginated — same cursor scheme as workflows/repository.ts. */
export async function listRuns(input: ListRunsInput): Promise<{ items: RunRow[]; nextCursor: string | null }> {
  const cursor = input.cursor ? decodeRunCursor(input.cursor) : undefined;

  const conditions = [eq(runs.tenantId, input.tenantId)];
  if (input.workflowId !== undefined) conditions.push(eq(runs.workflowId, input.workflowId));
  if (input.workflowVersionId !== undefined) conditions.push(eq(runs.workflowVersionId, input.workflowVersionId));
  if (input.status !== undefined) conditions.push(eq(runs.status, input.status));
  if (cursor) {
    conditions.push(
      or(lt(runs.createdAt, cursor.createdAt), and(eq(runs.createdAt, cursor.createdAt), lt(runs.id, cursor.id)))!,
    );
  }

  const rows = await db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeRunCursor(last.createdAt, last.id) : null;

  return { items, nextCursor };
}

function encodeRunCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeRunCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
  }
}
