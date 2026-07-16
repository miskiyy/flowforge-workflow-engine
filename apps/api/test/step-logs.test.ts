import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { markStepRunning, recordStepLog } from '../src/execution/repository.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('GET /runs/:id/steps/:stepKey/logs', () => {
  let app: FastifyInstance;

  let tenantAId: string;
  let editorAToken: string;
  let editorBToken: string;
  let runId: string;
  let stepRunIdA: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    const editorA = await createUser(tenantAId, 'editor');
    editorAToken = await app.jwt.sign({ tenantId: tenantAId, userId: editorA.id, role: 'editor' });

    const tenantB = await createTenant();
    const editorB = await createUser(tenantB.id, 'editor');
    editorBToken = await app.jwt.sign({ tenantId: tenantB.id, userId: editorB.id, role: 'editor' });

    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${editorAToken}` },
      payload: { name: 'logs-fixture', dag: validDag() },
    });
    const triggered = await app.inject({
      method: 'POST',
      url: `/workflows/${created.json().workflow.id}/trigger`,
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    runId = triggered.json().run.id;

    // simulate a failed attempt's log line on step "a"
    const stepA = await markStepRunning(tenantAId, runId, 'a');
    stepRunIdA = stepA.id;
    await recordStepLog(stepRunIdA, 'error', 'connect ETIMEDOUT');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the step log lines, oldest first', async () => {
    await recordStepLog(stepRunIdA, 'error', 'connect ECONNREFUSED');

    const response = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/steps/a/logs`,
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    expect(response.statusCode).toBe(200);

    const items = response.json().items;
    expect(items.map((log: { level: string; message: string }) => [log.level, log.message])).toEqual([
      ['error', 'connect ETIMEDOUT'],
      ['error', 'connect ECONNREFUSED'],
    ]);
    // never step_runs.output — the response shape is ts/level/message only
    expect(Object.keys(items[0]).sort()).toEqual(['level', 'message', 'ts']);
  });

  it('returns an empty list for a step that never logged', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/steps/b/logs`,
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('404s an unknown step key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/steps/ghost/logs`,
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('404s cross-tenant access via a real run id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/steps/a/logs`,
      headers: { authorization: `Bearer ${editorBToken}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: `/runs/${runId}/steps/a/logs` });
    expect(response.statusCode).toBe(401);
  });
});
