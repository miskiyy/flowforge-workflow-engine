import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import { buildExecutionContext, type ExecutionContext } from '../src/execution/context.js';
import {
  computeRetryDelayMs,
  executeRun,
  type ExecuteRunOptions,
  type RetryPolicy,
  type StepExecutor,
  type StepOutcome,
} from '../src/execution/executor.js';
import { finishRun, getRun, getStepLogs, startRun } from '../src/execution/repository.js';
import { runStep as realRunStep } from '../src/execution/step-handlers.js';
import { createWorkflow } from '../src/workflows/repository.js';
import { createTenant, createUser } from './fixtures.js';

// A silent logger keeps test output free of the (correctly, per Phase 3.5)
// structured console logs executeRun now emits on every call — the
// 'structured logging' describe block below is the one place that actually
// asserts on those events.
const silentLogger = { info: () => {}, error: () => {} };
function exec(context: ExecutionContext, runStep: StepExecutor, options: ExecuteRunOptions = {}) {
  return executeRun(context, runStep, { logger: silentLogger, ...options });
}

function fakeSleep(log: number[]): (ms: number) => Promise<void> {
  return async (ms) => {
    log.push(ms);
  };
}

const diamondDag = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'c', type: 'delay', dependsOn: ['a'], durationMs: 1 },
    { key: 'd', type: 'delay', dependsOn: ['b', 'c'], durationMs: 1 },
  ],
};

const independentBranchesDag = {
  steps: [
    { key: 'x', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'y', type: 'delay', dependsOn: [], durationMs: 1 },
  ],
};

describe('executeRun', () => {
  async function setUpRun(dag: unknown) {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition, version } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: `executor-${tenant.id}`,
      dag: dag as WorkflowDagDefinition,
    });
    const { run } = await startRun({ tenantId: tenant.id, userId: user.id, workflowId: definition.id });
    const context = buildExecutionContext({
      runId: run.id,
      tenantId: tenant.id,
      workflowVersionId: version.id,
      status: 'pending',
      dag: version.dagDefinition,
    });
    return { tenantId: tenant.id, runId: run.id, context };
  }

  it('runs a linear dag to success and persists each step output', async () => {
    const { tenantId, runId, context } = await setUpRun({
      steps: [
        { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
        { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
      ],
    });

    const runStep: StepExecutor = async (step) => ({ status: 'succeeded', output: { ran: step.key } });
    const result = await exec(context, runStep);

    expect(result.runStatus).toBe('succeeded');
    expect(result.steps).toEqual({ a: 'succeeded', b: 'succeeded' });

    const { run, steps } = await getRun(tenantId, runId);
    expect(run.status).toBe('succeeded');
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(steps.find((s) => s.stepKey === 'a')?.output).toEqual({ ran: 'a' });
    expect(steps.find((s) => s.stepKey === 'b')?.output).toEqual({ ran: 'b' });
  });

  it('propagates a failure transitively through a diamond and skips every dependent', async () => {
    const { tenantId, runId, context } = await setUpRun(diamondDag);

    const runStep: StepExecutor = async (step): Promise<StepOutcome> =>
      step.key === 'a' ? { status: 'failed', error: 'boom' } : { status: 'succeeded' };
    const result = await exec(context, runStep);

    expect(result.runStatus).toBe('failed');
    expect(result.steps).toEqual({ a: 'failed', b: 'skipped', c: 'skipped', d: 'skipped' });

    const { steps } = await getRun(tenantId, runId);
    expect(steps.find((s) => s.stepKey === 'a')?.error).toBe('boom');
    expect(steps.filter((s) => s.status === 'skipped').map((s) => s.stepKey).sort()).toEqual(['b', 'c', 'd']);
  });

  it('does not skip a step that has no dependency on the failed step', async () => {
    const { context } = await setUpRun(independentBranchesDag);

    const runStep: StepExecutor = async (step): Promise<StepOutcome> =>
      step.key === 'x' ? { status: 'failed', error: 'x failed' } : { status: 'succeeded' };
    const result = await exec(context, runStep);

    expect(result.runStatus).toBe('failed');
    expect(result.steps).toEqual({ x: 'failed', y: 'succeeded' });
  });

  it('runs each level in topological order, but steps within a level are unordered relative to each other', async () => {
    const { context } = await setUpRun(diamondDag);
    const callOrder: string[] = [];

    const runStep: StepExecutor = async (step) => {
      callOrder.push(step.key);
      return { status: 'succeeded' };
    };
    await exec(context, runStep);

    expect(callOrder[0]).toBe('a'); // level 0
    expect(callOrder.slice(1, 3).sort()).toEqual(['b', 'c']); // level 1, order not guaranteed
    expect(callOrder[3]).toBe('d'); // level 2
  });

  it('dispatches steps within one DAG level concurrently, not one at a time', async () => {
    const { context } = await setUpRun(independentBranchesDag);
    let inFlight = 0;
    let maxInFlight = 0;

    const runStep: StepExecutor = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { status: 'succeeded' };
    };
    const result = await exec(context, runStep);

    expect(result.runStatus).toBe('succeeded');
    expect(maxInFlight).toBe(2); // x and y share no dependency edge — both in flight at once
  });

  it('bounds level concurrency to maxParallelSteps', async () => {
    const { context } = await setUpRun({
      steps: Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, type: 'delay' as const, dependsOn: [], durationMs: 1 })),
    });
    let inFlight = 0;
    let maxInFlight = 0;

    const runStep: StepExecutor = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { status: 'succeeded' };
    };
    const result = await exec(context, runStep, { maxParallelSteps: 2 });

    expect(result.runStatus).toBe('succeeded');
    expect(maxInFlight).toBe(2);
  });

  it('treats a thrown error from the step executor as a failed step, not a retry', async () => {
    const { context } = await setUpRun({
      steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
    });
    let calls = 0;

    const runStep: StepExecutor = async () => {
      calls += 1;
      throw new Error('network exploded');
    };
    const result = await exec(context, runStep);

    expect(calls).toBe(1);
    expect(result.runStatus).toBe('failed');
    expect(result.steps).toEqual({ a: 'failed' });
  });

  describe('retry policy', () => {
    it('retries a failing step up to maxAttempts, then succeeds within the limit', async () => {
      const { tenantId, runId, context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const retryPolicy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 1000 };
      const delays: number[] = [];
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return calls < 3 ? { status: 'failed', error: `attempt ${calls} failed` } : { status: 'succeeded', output: 'ok' };
      };
      const result = await exec(context, runStep, { retryPolicy, sleep: fakeSleep(delays) });

      expect(calls).toBe(3);
      expect(result.runStatus).toBe('succeeded');
      expect(delays).toEqual([10, 20]); // exponential backoff before attempt 2 and attempt 3

      const { steps } = await getRun(tenantId, runId);
      const stepA = steps.find((s) => s.stepKey === 'a')!;
      expect(stepA.status).toBe('succeeded');
      expect(stepA.attemptNumber).toBe(3);
    });

    it('stops at maxAttempts and fails the step (retry limit enforced)', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const retryPolicy: RetryPolicy = { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 1000 };
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return { status: 'failed', error: 'always fails' };
      };
      const result = await exec(context, runStep, { retryPolicy, sleep: fakeSleep([]) });

      expect(calls).toBe(2);
      expect(result.runStatus).toBe('failed');
      expect(result.steps).toEqual({ a: 'failed' });
    });

    it('computes exponential backoff capped at maxDelayMs', () => {
      const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 350 };
      expect(computeRetryDelayMs(policy, 1)).toBe(100);
      expect(computeRetryDelayMs(policy, 2)).toBe(200);
      expect(computeRetryDelayMs(policy, 3)).toBe(350); // 400 capped to 350
      expect(computeRetryDelayMs(policy, 4)).toBe(350);
    });

    it('does not retry by default (maxAttempts=1 preserves Phase 3.3 behavior)', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return { status: 'failed', error: 'nope' };
      };
      await exec(context, runStep);

      expect(calls).toBe(1);
    });

    it('rejects an invalid retry policy (maxAttempts < 1) instead of leaving a step stuck pending', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      await expect(exec(context, runStep, { retryPolicy: { maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 } })).rejects.toThrow(
        /maxAttempts must be an integer >= 1/,
      );
    });
  });

  // Audit C2: retry was built and tested but worker.ts never passed a
  // retryPolicy, so no step ever retried in production. worker.ts now also
  // passes `random: Math.random` for jitter — assert that plumbing here.
  describe('jitter (audit C2)', () => {
    it('computeRetryDelayMs stays within [0.5x, 1x] of the capped exponential when a random source is injected', () => {
      const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000 };
      expect(computeRetryDelayMs(policy, 1, () => 0)).toBe(50);
      expect(computeRetryDelayMs(policy, 1, () => 1)).toBe(100);
      expect(computeRetryDelayMs(policy, 1, () => 0.5)).toBe(75);
      // No random source passed -> unchanged from the pre-jitter deterministic value tests already rely on.
      expect(computeRetryDelayMs(policy, 1)).toBe(100);
    });

    it('executeRun threads options.random into the retry delay it actually sleeps for', async () => {
      const { context } = await setUpRun({ steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }] });
      const retryPolicy: RetryPolicy = { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000 };
      const delays: number[] = [];
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return calls < 2 ? { status: 'failed', error: 'x' } : { status: 'succeeded' };
      };
      await exec(context, runStep, { retryPolicy, sleep: fakeSleep(delays), random: () => 0 });

      expect(delays).toEqual([50]); // half of the 100ms exponential delay, thanks to the injected random
    });
  });

  // Audit C3: `timed_out` was in RUN_STATUSES and finishRun's signature but
  // nothing ever set it — worker.ts now passes timeoutMs into executeRun.
  describe('workflow timeout (audit C3)', () => {
    it('force-fails in-flight work once the deadline passes, marking the run timed_out (not cancelled)', async () => {
      const { tenantId, runId, context } = await setUpRun(diamondDag);
      const callOrder: string[] = [];

      const runStep: StepExecutor = async (step) => {
        callOrder.push(step.key);
        if (step.key === 'a') await new Promise((resolve) => setTimeout(resolve, 30));
        return { status: 'succeeded' };
      };
      const result = await exec(context, runStep, { timeoutMs: 10 });

      expect(callOrder).toEqual(['a']); // b/c/d never started — the deadline passed before the next between-step check
      expect(result.runStatus).toBe('timed_out');
      expect(result.steps).toEqual({ a: 'succeeded', b: 'skipped', c: 'skipped', d: 'skipped' });

      const { run } = await getRun(tenantId, runId);
      expect(run.status).toBe('timed_out');
    });

    it('does not time out a run that finishes within the deadline', async () => {
      const { context } = await setUpRun({ steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }] });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      const result = await exec(context, runStep, { timeoutMs: 5000 });

      expect(result.runStatus).toBe('succeeded');
    });
  });

  describe('failure recording', () => {
    it('records a log entry for every failed attempt, independent of the final status', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const retryPolicy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 };
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return calls < 3 ? { status: 'failed', error: `attempt ${calls} failed` } : { status: 'succeeded' };
      };
      await exec(context, runStep, { retryPolicy, sleep: async () => {} });

      const { steps } = await getRun(context.tenantId, context.runId);
      const stepA = steps.find((s) => s.stepKey === 'a')!;
      const logs = await getStepLogs(stepA.id);

      expect(logs.map((l) => l.message)).toEqual(['attempt 1 failed', 'attempt 2 failed']);
      expect(logs.every((l) => l.level === 'error')).toBe(true);
    });
  });

  // Uses the real worker StepExecutor (step-handlers.ts), not a fake one —
  // this is the end-to-end proof that the schema, guards.ts's dependency
  // check, and executor.ts's falseBranches gating all agree with each other.
  describe('condition step gating (Task.md conditional-branch requirement)', () => {
    it('a false condition skips only its own dependents — the condition step itself succeeds, the run succeeds', async () => {
      const { tenantId, runId, context } = await setUpRun({
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'gate', type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'failed' },
          { key: 'b', type: 'delay', dependsOn: ['gate'], durationMs: 1 },
          { key: 'c', type: 'delay', dependsOn: [], durationMs: 1 }, // no relation to the gate — must be unaffected
        ],
      });

      const result = await exec(context, realRunStep);

      expect(result.runStatus).toBe('succeeded');
      expect(result.steps).toEqual({ a: 'succeeded', gate: 'succeeded', b: 'skipped', c: 'succeeded' });

      const { steps } = await getRun(tenantId, runId);
      const gateRow = steps.find((s) => s.stepKey === 'gate')!;
      expect(gateRow.status).toBe('succeeded'); // a closed gate is not a failure
      expect(gateRow.output).toMatchObject({ result: false, actual: 'succeeded' });
    });

    it('a true condition lets its dependents run normally', async () => {
      const { context } = await setUpRun({
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'gate', type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' },
          { key: 'b', type: 'delay', dependsOn: ['gate'], durationMs: 1 },
        ],
      });

      const result = await exec(context, realRunStep);

      expect(result.runStatus).toBe('succeeded');
      expect(result.steps).toEqual({ a: 'succeeded', gate: 'succeeded', b: 'succeeded' });
    });
  });

  describe('cancellation', () => {
    it('stops before the next step, skips everything unreached, and marks the run cancelled', async () => {
      const { tenantId, runId, context } = await setUpRun(diamondDag);
      const controller = new AbortController();
      const callOrder: string[] = [];

      const runStep: StepExecutor = async (step) => {
        callOrder.push(step.key);
        if (step.key === 'a') controller.abort();
        return { status: 'succeeded' };
      };
      const result = await exec(context, runStep, { signal: controller.signal });

      expect(callOrder).toEqual(['a']); // b/c/d never started
      expect(result.runStatus).toBe('cancelled');
      expect(result.steps).toEqual({ a: 'succeeded', b: 'skipped', c: 'skipped', d: 'skipped' });

      const { run } = await getRun(tenantId, runId);
      expect(run.status).toBe('cancelled');
    });

    it('a pre-aborted signal skips every step without invoking the executor', async () => {
      const { context } = await setUpRun(diamondDag);
      const controller = new AbortController();
      controller.abort();
      let calls = 0;

      const runStep: StepExecutor = async () => {
        calls += 1;
        return { status: 'succeeded' };
      };
      const result = await exec(context, runStep, { signal: controller.signal });

      expect(calls).toBe(0);
      expect(result.runStatus).toBe('cancelled');
      expect(result.steps).toEqual({ a: 'skipped', b: 'skipped', c: 'skipped', d: 'skipped' });
    });
  });

  describe('structured logging', () => {
    it('emits run/step-correlated events for a run that retries then succeeds', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const events: { event: string; level: string; fields: Record<string, unknown> }[] = [];
      const logger = {
        info: (event: string, fields: Record<string, unknown>) => events.push({ event, level: 'info', fields }),
        error: (event: string, fields: Record<string, unknown>) => events.push({ event, level: 'error', fields }),
      };
      let calls = 0;

      const runStep: StepExecutor = async (): Promise<StepOutcome> => {
        calls += 1;
        return calls < 2 ? { status: 'failed', error: 'flaky' } : { status: 'succeeded' };
      };
      await executeRun(context, runStep, {
        retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
        sleep: async () => {},
        logger,
      });

      expect(events.map((e) => e.event)).toEqual([
        'run.started',
        'step.queued',
        'step.running',
        'step.attempt_failed',
        'step.retrying',
        'step.running',
        'step.succeeded',
        'run.finished',
      ]);
      // Every step-level event carries the run/step correlation id.
      for (const e of events.filter((e) => e.event.startsWith('step.'))) {
        expect(e.fields).toMatchObject({ runId: context.runId, tenantId: context.tenantId, stepKey: 'a' });
      }
      expect(events.find((e) => e.event === 'step.attempt_failed')?.level).toBe('error');
    });
  });

  describe('edge cases', () => {
    it('rejects executing a run that is already running (no double execution)', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      // First call succeeds and moves the run to a terminal state...
      await exec(context, runStep);
      // ...so re-executing the same run must fail loudly, not silently redo work.
      await expect(exec(context, runStep)).rejects.toThrow();
    });

    it('rejects finishing a run at the repository layer before it was ever started', async () => {
      const { tenantId, runId } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });

      // The run is still 'pending' (never went through markRunRunning) —
      // this must fail loudly at the real DB code path, not just in the
      // pure lifecycle unit tests.
      await expect(finishRun(tenantId, runId, 'succeeded')).rejects.toThrow();
    });

    it('rejects executing a run that does not exist', async () => {
      const { context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const bogusContext = { ...context, runId: '00000000-0000-0000-0000-000000000000' };
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      await expect(exec(bogusContext, runStep)).rejects.toThrow();
    });

    it('stores null output when a successful step returns no output', async () => {
      const { tenantId, runId, context } = await setUpRun({
        steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }],
      });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      await exec(context, runStep);

      const { steps } = await getRun(tenantId, runId);
      expect(steps.find((s) => s.stepKey === 'a')?.output).toBeNull();
    });

    it('handles a step declaring the same dependency twice without breaking scheduling', async () => {
      const { context } = await setUpRun({
        steps: [
          { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
          { key: 'b', type: 'delay', dependsOn: ['a', 'a'], durationMs: 1 },
        ],
      });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });

      const result = await exec(context, runStep);

      expect(result.runStatus).toBe('succeeded');
      expect(result.steps).toEqual({ a: 'succeeded', b: 'succeeded' });
    });

    it(
      'executes a realistically-large linear chain correctly without a performance regression',
      async () => {
        // 100 steps is generous for a hand-authored or LLM-generated workflow
        // (Task.md scopes this as a 4-day MVP, not a data-pipeline DAG engine).
        // Each step transition is its own DB transaction by design (Phase
        // 3.2's auditability tradeoff) — this asserts that cost stays linear
        // in step count, not that it's zero.
        const STEP_COUNT = 100;
        const steps = Array.from({ length: STEP_COUNT }, (_, i) => ({
          key: `s${i}`,
          type: 'delay' as const,
          dependsOn: i === 0 ? [] : [`s${i - 1}`],
          durationMs: 1,
        }));
        const { context } = await setUpRun({ steps });
        const callOrder: string[] = [];

        const runStep: StepExecutor = async (step) => {
          callOrder.push(step.key);
          return { status: 'succeeded' };
        };

        const startedAt = Date.now();
        const result = await exec(context, runStep);
        const elapsedMs = Date.now() - startedAt;

        expect(result.runStatus).toBe('succeeded');
        expect(callOrder).toEqual(steps.map((s) => s.key));
        expect(elapsedMs).toBeLessThan(10_000);
      },
      15_000,
    );
  });
});
