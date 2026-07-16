import type { DagStepDefinition } from '@flowforge/shared-types';
import type { ExecutionContext } from './context.js';
import type { RunStatus, StepStatus } from './lifecycle.js';
import {
  finishRun,
  markRunRunning,
  markStepFailed,
  markStepRetrying,
  markStepRunning,
  markStepSkipped,
  markStepSucceeded,
  recordStepLog,
} from './repository.js';

/**
 * The step scheduler/executor. It walks the DAG's precomputed levels
 * (Phase 3.1 engine): steps within one level share no dependency edge, so
 * each level is dispatched concurrently (bounded by maxParallelSteps) and
 * awaited before the next level starts — parallel where possible, sequential
 * where required. It invokes an injected `StepExecutor` per step so this
 * module stays ignorant of what a step actually does (http/script/delay/
 * condition handlers live in step-handlers.ts).
 */
export interface StepOutcome {
  status: 'succeeded' | 'failed';
  output?: unknown;
  error?: string;
  /**
   * Condition-step gating (Task.md's "conditional branch" requirement): a
   * `condition` step that evaluates false is still a *successful* step (the
   * comparison itself didn't fail) but its dependents must not run. `undefined`
   * for every other step type — only step-handlers.ts's condition handler
   * ever sets this.
   */
  branchTaken?: boolean;
}

/**
 * What a step handler can see about steps that already finished — read-only,
 * scoped to statuses (not full output), since only `condition` needs it
 * today and workflows/guards.ts requires its `left` reference to be a direct
 * dependency, which the level-ordering guarantee (executor.ts's scheduling)
 * has already resolved by the time this is called.
 */
export interface StepRuntimeContext {
  getDependencyStatus(stepKey: string): StepStatus | undefined;
}

export type StepExecutor = (step: DagStepDefinition, runtime: StepRuntimeContext) => Promise<StepOutcome>;

/** Phase 3.4 — retry policy. maxAttempts=1 (the default) means no retry: identical to the pre-3.4 engine. */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const NO_RETRY_POLICY: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

/**
 * Exponential backoff, capped, with equal jitter: half the capped delay is
 * fixed, half is randomized, so the result always stays within
 * [0.5x, 1x] of the capped exponential value and never exceeds maxDelayMs.
 * `random` defaults to a constant 1 (no jitter) so every existing caller
 * that doesn't pass one keeps getting the old deterministic value — tests
 * can still assert exact delays; production (worker.ts) passes Math.random.
 */
export function computeRetryDelayMs(policy: RetryPolicy, failedAttempt: number, random: () => number = () => 1): number {
  const exponential = policy.baseDelayMs * 2 ** (failedAttempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.round(capped * (0.5 + 0.5 * random()));
}

/**
 * maxAttempts < 1 would mean a step's attempt loop never runs at all, so it
 * would still be sitting 'pending' when the caller tries to mark it
 * succeeded/failed — an illegal transition (InvalidStepTransitionError)
 * thrown from deep inside the persistence layer with no clue what caused
 * it. Reject the bad config up front, at the boundary, instead.
 */
function assertValidRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error(`retryPolicy.maxAttempts must be an integer >= 1, got ${policy.maxAttempts}`);
  }
}

/** Structured, run/step-correlated logging — injectable so callers can route it anywhere; defaults to stdout/stderr. */
export interface ExecutionLogger {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

export const consoleExecutionLogger: ExecutionLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
};

export interface ExecuteRunOptions {
  /**
   * Checked once before each step is *started* — cooperative, coarse-grained
   * cancellation between steps. It does not interrupt a step already in
   * flight or a retry backoff already in progress; that would need the
   * injected StepExecutor itself to honor the signal, which is its own
   * concern, not the scheduler's.
   */
  signal?: AbortSignal;
  /**
   * Global workflow deadline (audit C3). Same coarse-grained, between-steps
   * check as `signal` — it dominates per-step retry budgets (Task.md:100)
   * because a step whose own attempt loop keeps failing/backing off never
   * gets to run past the next between-step check. Distinct from `signal`
   * so the run ends up `timed_out`, not `cancelled`.
   */
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  /**
   * How many steps of one DAG level may be in flight at once. Defaults to
   * DEFAULT_MAX_PARALLEL_STEPS; 1 reproduces the old strictly-sequential
   * dispatch (useful for deterministic ordering in tests).
   */
  maxParallelSteps?: number;
  /** Injectable so tests never wait on a real retry delay. */
  sleep?: (ms: number) => Promise<void>;
  logger?: ExecutionLogger;
  /** Retry backoff jitter source; defaults to computeRetryDelayMs's own no-jitter default. Production passes Math.random. */
  random?: () => number;
}

export interface ExecuteRunResult {
  runStatus: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled' | 'timed_out'>;
  steps: Record<string, StepStatus>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wide fan-outs stay bounded: a 100-step level never fires 100 concurrent HTTP fetches from one run. */
export const DEFAULT_MAX_PARALLEL_STEPS = 8;

/** Minimal bounded-concurrency map — items are claimed via a shared index, so at most `limit` callbacks are in flight. */
async function mapWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}

async function invokeStep(runStep: StepExecutor, step: DagStepDefinition, runtime: StepRuntimeContext): Promise<StepOutcome> {
  try {
    return await runStep(step, runtime);
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Runs one step to completion: attempts up to `retryPolicy.maxAttempts`
 * times, recording each failed attempt (Failure recording) and backing off
 * between attempts (Retry delay), until it succeeds or exhausts its
 * retry limit.
 */
async function runStepWithRetry(
  context: ExecutionContext,
  step: DagStepDefinition,
  runStep: StepExecutor,
  runtime: StepRuntimeContext,
  retryPolicy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
  logger: ExecutionLogger,
  random: (() => number) | undefined,
): Promise<StepOutcome> {
  const correlation = { runId: context.runId, tenantId: context.tenantId, stepKey: step.key };
  let lastOutcome: StepOutcome = { status: 'failed', error: 'step never attempted' };

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
    logger.info('step.running', { ...correlation, attempt });
    const runningRow = await markStepRunning(context.tenantId, context.runId, step.key, attempt);
    const outcome = await invokeStep(runStep, step, runtime);

    if (outcome.status === 'succeeded') {
      logger.info('step.succeeded', { ...correlation, attempt });
      return outcome;
    }

    lastOutcome = outcome;
    logger.error('step.attempt_failed', { ...correlation, attempt, error: outcome.error });
    await recordStepLog(runningRow.id, 'error', outcome.error ?? 'step failed');

    const attemptsRemain = attempt < retryPolicy.maxAttempts;
    if (attemptsRemain) {
      const delayMs = computeRetryDelayMs(retryPolicy, attempt, random);
      logger.info('step.retrying', { ...correlation, attempt, delayMs });
      await markStepRetrying(context.tenantId, context.runId, step.key, attempt);
      await sleep(delayMs);
    }
  }

  return lastOutcome;
}

/**
 * Because `context.plan.levels` groups steps so that every step's
 * dependencies live in an *earlier* level, all dependency statuses are final
 * before a level starts — so failure propagation is just: if any dependency
 * failed or was skipped, skip this step too, without calling the executor.
 * That's transitive for free (a skip recorded for `b` skips `d` that depends
 * on `b`) and requires no separate graph walk. Steps within one level share
 * no dependency edge, so they run concurrently (Task.md: parallel where
 * possible, sequential where required), bounded by maxParallelSteps.
 *
 * Cancellation and timeout both reuse the same "unreached steps get
 * skipped" idea: the abort check runs between levels (in-flight steps finish
 * naturally, exactly as an in-flight step always has), and every step that
 * never got a status recorded is, by definition, cut off — so it's marked
 * 'skipped'. The run itself becomes 'timed_out' if the workflow deadline
 * (`timeoutMs`) is what fired, otherwise 'cancelled', never 'failed'.
 */
export async function executeRun(
  context: ExecutionContext,
  runStep: StepExecutor,
  options: ExecuteRunOptions = {},
): Promise<ExecuteRunResult> {
  const retryPolicy = options.retryPolicy ?? NO_RETRY_POLICY;
  assertValidRetryPolicy(retryPolicy);
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;
  const timeoutSignal = options.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined;
  const random = options.random;
  const logger = options.logger ?? consoleExecutionLogger;
  const correlation = { runId: context.runId, tenantId: context.tenantId };

  logger.info('run.started', correlation);
  // The worker pool claims a pending run by transitioning it to 'running'
  // atomically as part of its FOR UPDATE SKIP LOCKED poll query (see
  // execution/worker.ts), so the context it hands in already has
  // status: 'running' — transitioning again here would be a second,
  // illegal pending->running move on an already-running row.
  if (context.status === 'pending') {
    await markRunRunning(context.tenantId, context.runId);
  }

  const stepsByKey = new Map(context.dag.steps.map((step) => [step.key, step]));
  const statuses = new Map<string, StepStatus>();
  // Steps whose branch a condition gated closed (result: false) — a
  // *successful* step, but its dependents must not run. Kept separate from
  // `statuses` so the recorded DB/status stays 'succeeded' (the comparison
  // itself didn't fail) while the scheduler still treats it as blocking.
  const falseBranches = new Set<string>();
  const maxParallelSteps = options.maxParallelSteps ?? DEFAULT_MAX_PARALLEL_STEPS;
  const runtime: StepRuntimeContext = { getDependencyStatus: (stepKey) => statuses.get(stepKey) };

  for (const level of context.plan.levels) {
    if (timeoutSignal?.aborted || signal?.aborted) break;

    const runnable: DagStepDefinition[] = [];
    for (const stepKey of level) {
      const step = stepsByKey.get(stepKey);
      if (!step) throw new Error(`execution plan references unknown step "${stepKey}"`);

      const blocked = step.dependsOn.some((dep) => {
        const depStatus = statuses.get(dep);
        return depStatus === 'failed' || depStatus === 'skipped' || falseBranches.has(dep);
      });

      if (blocked) {
        logger.info('step.skipped', { ...correlation, stepKey, reason: 'upstream_failed' });
        await markStepSkipped(context.tenantId, context.runId, stepKey);
        statuses.set(stepKey, 'skipped');
      } else {
        runnable.push(step);
      }
    }

    await mapWithConcurrency(runnable, maxParallelSteps, async (step) => {
      logger.info('step.queued', { ...correlation, stepKey: step.key });
      const outcome = await runStepWithRetry(context, step, runStep, runtime, retryPolicy, sleep, logger, random);

      if (outcome.status === 'succeeded') {
        await markStepSucceeded(context.tenantId, context.runId, step.key, outcome.output);
        statuses.set(step.key, 'succeeded');
        if (outcome.branchTaken === false) {
          logger.info('step.branch_closed', { ...correlation, stepKey: step.key });
          falseBranches.add(step.key);
        }
      } else {
        logger.error('step.failed', { ...correlation, stepKey: step.key, error: outcome.error });
        await markStepFailed(context.tenantId, context.runId, step.key, outcome.error ?? 'step failed');
        statuses.set(step.key, 'failed');
      }
    });
  }

  const cutOff = context.plan.order.some((stepKey) => !statuses.has(stepKey));
  if (cutOff) {
    const finalStatus = timeoutSignal?.aborted ? 'timed_out' : 'cancelled';
    for (const stepKey of context.plan.order) {
      if (!statuses.has(stepKey)) {
        logger.info('step.skipped', { ...correlation, stepKey, reason: finalStatus });
        await markStepSkipped(context.tenantId, context.runId, stepKey);
        statuses.set(stepKey, 'skipped');
      }
    }
    await finishRun(context.tenantId, context.runId, finalStatus);
    logger.info('run.finished', { ...correlation, status: finalStatus });
    return { runStatus: finalStatus, steps: Object.fromEntries(statuses) };
  }

  const runStatus: Extract<RunStatus, 'succeeded' | 'failed'> = [...statuses.values()].some((s) => s === 'failed')
    ? 'failed'
    : 'succeeded';
  await finishRun(context.tenantId, context.runId, runStatus);
  logger.info('run.finished', { ...correlation, status: runStatus });

  return { runStatus, steps: Object.fromEntries(statuses) };
}
