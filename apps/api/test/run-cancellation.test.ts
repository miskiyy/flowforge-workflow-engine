import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { startWorkerPool, type WorkerPool } from '../src/execution/worker.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('POST /runs/:id/cancel', () => {
  let app: FastifyInstance;
  let tenantAId: string;
  let editorAToken: string;
  let viewerAToken: string;
  let editorBToken: string;
  let workflowId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    const editorA = await createUser(tenantAId, 'editor');
    const viewerA = await createUser(tenantAId, 'viewer');
    editorAToken = await app.jwt.sign({ tenantId: tenantAId, userId: editorA.id, role: 'editor' });
    viewerAToken = await app.jwt.sign({ tenantId: tenantAId, userId: viewerA.id, role: 'viewer' });

    const tenantB = await createTenant();
    const editorB = await createUser(tenantB.id, 'editor');
    editorBToken = await app.jwt.sign({ tenantId: tenantB.id, userId: editorB.id, role: 'editor' });

    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${editorAToken}` },
      payload: { name: 'cancel-fixture', dag: validDag() },
    });
    workflowId = created.json().workflow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function trigger(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/trigger`,
      headers: authed(editorAToken),
    });
    return response.json().run.id;
  }

  it('cancels a pending run immediately, skipping every step', async () => {
    const runId = await trigger();

    const response = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: authed(editorAToken) });
    expect(response.statusCode).toBe(200);
    expect(response.json().cancelledImmediately).toBe(true);
    expect(response.json().run.status).toBe('cancelled');

    const read = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed(editorAToken) });
    expect(read.json().run.status).toBe('cancelled');
    expect(read.json().steps.every((s: { status: string }) => s.status === 'skipped')).toBe(true);
  });

  it('409s cancelling a run that is already terminal', async () => {
    const runId = await trigger();
    await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: authed(editorAToken) }); // now cancelled

    const response = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: authed(editorAToken) });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('RUN_ALREADY_TERMINAL');
  });

  it('blocks a viewer from cancelling', async () => {
    const runId = await trigger();
    const response = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: authed(viewerAToken) });
    expect(response.statusCode).toBe(403);
  });

  it('404s cancelling another tenant\'s run', async () => {
    const runId = await trigger();
    const response = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: authed(editorBToken) });
    expect(response.statusCode).toBe(404);
  });

  it('404s an unknown run id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/runs/00000000-0000-0000-0000-000000000000/cancel',
      headers: authed(editorAToken),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /runs/:id/cancel — a running run', () => {
  let app: FastifyInstance;
  let workerPool: WorkerPool;
  let tenantId: string;
  let editorToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    workerPool = startWorkerPool({ pollIntervalMs: 30 });

    const tenant = await createTenant();
    tenantId = tenant.id;
    const editor = await createUser(tenantId, 'editor');
    editorToken = await app.jwt.sign({ tenantId, userId: editor.id, role: 'editor' });
  });

  afterAll(async () => {
    await workerPool.stop();
    await app.close();
  });

  it('requests cancellation of an in-flight run, which reaches cancelled asynchronously, skipping the unreached step', async () => {
    const dag = {
      steps: [
        { key: 'slow', type: 'delay', dependsOn: [], durationMs: 2000 },
        { key: 'after', type: 'delay', dependsOn: ['slow'], durationMs: 1 },
      ],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { name: 'cancel-running', dag },
    });
    const workflowId = created.json().workflow.id;

    const triggered = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/trigger`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    const runId = triggered.json().run.id;

    // Wait for the worker pool to actually claim it (status: running) before cancelling.
    const claimedDeadline = Date.now() + 5000;
    while (Date.now() < claimedDeadline) {
      const read = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: { authorization: `Bearer ${editorToken}` } });
      if (read.json().run.status === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/cancel`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().cancelledImmediately).toBe(false);
    expect(cancelResponse.json().run.status).toBe('running'); // not yet — the executor finalizes it

    const deadline = Date.now() + 5000;
    let finalStatus: string | undefined;
    while (Date.now() < deadline) {
      const read = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: { authorization: `Bearer ${editorToken}` } });
      if (read.json().run.status !== 'running' && read.json().run.status !== 'pending') {
        finalStatus = read.json().run.status;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    expect(finalStatus).toBe('cancelled');

    const final = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: { authorization: `Bearer ${editorToken}` } });
    const afterStep = final.json().steps.find((s: { stepKey: string }) => s.stepKey === 'after');
    expect(afterStep.status).toBe('skipped'); // never reached
  }, 15_000);
});
