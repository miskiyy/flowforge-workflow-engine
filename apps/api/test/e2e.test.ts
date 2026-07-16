import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { StepExecutor } from '../src/execution/executor.js';
import { runStep as realRunStep } from '../src/execution/step-handlers.js';
import { startWorkerPool, type WorkerPool } from '../src/execution/worker.js';
import { createTenant, createUser, SEEDED_PASSWORD } from './fixtures.js';

/**
 * The one required end-to-end test (Task.md Phase 6 / F): drives the real
 * HTTP surface exactly as a user or the dashboard would — login, create,
 * trigger — then waits on the worker pool (execution/worker.ts) to actually
 * run the workflow to a terminal state, and asserts the final run + step
 * shape. `app.inject()` is Fastify's real request/response pipeline (full
 * routing, validation, auth, handlers) without opening a socket — the same
 * mechanism every other integration test in this suite uses — so this test
 * differs from them only in going through real login (not a minted JWT) and
 * in actually letting the run execute instead of asserting it stays
 * 'pending'.
 *
 * Uses only `delay` steps: deterministic and network-free, so the test
 * doesn't depend on an external HTTP endpoint being reachable in CI (see
 * README's "what's intentionally not tested" — no live network step here).
 */
describe('e2e: login -> create workflow -> execute -> terminal state', () => {
  let app: FastifyInstance;
  let workerPool: WorkerPool;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    // Fast poll interval so the test doesn't wait on the production default (2s).
    workerPool = startWorkerPool({ pollIntervalMs: 50 });
  });

  afterAll(async () => {
    await workerPool.stop();
    await app.close();
  });

  it('runs a real workflow end to end and persists the final run + step shape', async () => {
    const tenant = await createTenant();
    const editor = await createUser(tenant.id, 'editor');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: editor.email, password: SEEDED_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const { accessToken } = login.json() as { accessToken: string };
    const authed = { authorization: `Bearer ${accessToken}` };

    const dag = {
      steps: [
        { key: 'first', type: 'delay', dependsOn: [], durationMs: 10 },
        { key: 'second', type: 'delay', dependsOn: ['first'], durationMs: 10 },
      ],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: authed,
      payload: { name: 'e2e-linear-delay', dag },
    });
    expect(created.statusCode).toBe(201);
    const workflowId = created.json().workflow.id as string;

    const triggered = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/trigger`,
      headers: authed,
    });
    expect(triggered.statusCode).toBe(201);
    const runId = triggered.json().run.id as string;
    expect(triggered.json().run.status).toBe('pending');

    const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
    const deadline = Date.now() + 10_000;
    let finalRun: { id: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const response = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed });
      const body = response.json();
      if (TERMINAL_STATUSES.has(body.run.status)) {
        finalRun = body.run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    if (!finalRun) throw new Error('run did not reach a terminal state within the test deadline');
    expect(finalRun.status).toBe('succeeded');

    const final = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed });
    const body = final.json();
    expect(body.run.workflowId).toBe(workflowId);
    expect(body.run.startedAt).not.toBeNull();
    expect(body.run.finishedAt).not.toBeNull();
    expect(body.steps.map((s: { stepKey: string; status: string }) => [s.stepKey, s.status])).toEqual([
      ['first', 'succeeded'],
      ['second', 'succeeded'],
    ]);

    const listed = await app.inject({ method: 'GET', url: `/runs?workflowId=${workflowId}`, headers: authed });
    expect(listed.json().items.map((r: { id: string }) => r.id)).toEqual([runId]);
  }, 15_000);
});

/**
 * The failure/retry path, end to end — the gap the first E2E test names
 * (it only covers the success path). Uses a `flakyStepExecutor` (real
 * step-handlers.ts for every step except one forced failure) so the retry
 * behavior is deterministic without depending on a real network endpoint
 * being reachable in CI, same posture as the success-path test above.
 */
describe('e2e: a step exhausts its retries -> failed run, downstream steps skipped', () => {
  let app: FastifyInstance;
  let workerPool: WorkerPool;

  const flakyStepExecutor: StepExecutor = async (step, runtime) => {
    if (step.key === 'flaky') return { status: 'failed', error: 'simulated failure for the retry E2E' };
    return realRunStep(step, runtime);
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    workerPool = startWorkerPool({ pollIntervalMs: 50, stepExecutor: flakyStepExecutor });
  });

  afterAll(async () => {
    await workerPool.stop();
    await app.close();
  });

  it('retries the flaky step to exhaustion, records every attempt, fails the run, and skips its dependent', async () => {
    const tenant = await createTenant();
    const editor = await createUser(tenant.id, 'editor');
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: editor.email, password: SEEDED_PASSWORD },
    });
    const { accessToken } = login.json() as { accessToken: string };
    const authed = { authorization: `Bearer ${accessToken}` };

    const dag = {
      steps: [
        { key: 'setup', type: 'delay', dependsOn: [], durationMs: 5 },
        { key: 'flaky', type: 'delay', dependsOn: ['setup'], durationMs: 1 }, // executor forces this one to fail
        { key: 'downstream', type: 'delay', dependsOn: ['flaky'], durationMs: 1 },
      ],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: authed,
      payload: { name: 'e2e-retry-exhausted', dag },
    });
    const workflowId = created.json().workflow.id as string;

    const triggered = await app.inject({ method: 'POST', url: `/workflows/${workflowId}/trigger`, headers: authed });
    const runId = triggered.json().run.id as string;

    const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
    const deadline = Date.now() + 15_000;
    let finalRun: { id: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const response = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed });
      const body = response.json();
      if (TERMINAL_STATUSES.has(body.run.status)) {
        finalRun = body.run;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!finalRun) throw new Error('run did not reach a terminal state within the test deadline');
    expect(finalRun.status).toBe('failed');

    const final = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed });
    const steps = final.json().steps as { stepKey: string; status: string; attemptNumber: number; error: string | null }[];
    expect(steps.find((s) => s.stepKey === 'setup')?.status).toBe('succeeded');
    const flakyStep = steps.find((s) => s.stepKey === 'flaky')!;
    expect(flakyStep.status).toBe('failed');
    expect(flakyStep.attemptNumber).toBe(3); // DEFAULT_RETRY_POLICY.maxAttempts (worker.ts)
    expect(flakyStep.error).toContain('simulated failure');
    expect(steps.find((s) => s.stepKey === 'downstream')?.status).toBe('skipped'); // never reached — its dependency failed

    const logs = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/steps/flaky/logs`,
      headers: authed,
    });
    // one log line per failed attempt (3 attempts, all failed)
    expect(logs.json().items).toHaveLength(3);
    expect(logs.json().items.every((l: { message: string }) => l.message.includes('simulated failure'))).toBe(true);
  }, 20_000);
});
