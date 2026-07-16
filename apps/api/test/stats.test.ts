import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { finishRun, markRunRunning } from '../src/execution/repository.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('GET /stats', () => {
  let app: FastifyInstance;

  let tenantAId: string;
  let editorAToken: string;
  let editorBToken: string;
  let workflowAId: string;

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
      payload: { name: 'stats-fixture', dag: validDag() },
    });
    workflowAId = created.json().workflow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function trigger(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowAId}/trigger`,
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    return response.json().run.id;
  }

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/stats' });
    expect(response.statusCode).toBe(401);
  });

  it('reports null rates for a tenant with no finished runs — no data is not 0%', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: { authorization: `Bearer ${editorBToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      activeRuns: 0,
      last24h: { total: 0, succeeded: 0, failed: 0, successRate: null, avgDurationMs: null },
    });
  });

  it('aggregates active runs and 24h outcomes, scoped to the caller tenant', async () => {
    // one pending (active), one succeeded, one failed, one timed_out
    await trigger();
    for (const status of ['succeeded', 'failed', 'timed_out'] as const) {
      const runId = await trigger();
      await markRunRunning(tenantAId, runId);
      await finishRun(tenantAId, runId, status);
    }

    const response = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: { authorization: `Bearer ${editorAToken}` },
    });
    expect(response.statusCode).toBe(200);

    const stats = response.json();
    expect(stats.activeRuns).toBe(1);
    expect(stats.last24h.total).toBe(3);
    expect(stats.last24h.succeeded).toBe(1);
    expect(stats.last24h.failed).toBe(2); // failed + timed_out
    expect(stats.last24h.successRate).toBeCloseTo(1 / 3);
    expect(stats.last24h.avgDurationMs).toBeGreaterThanOrEqual(0);

    // tenant B still sees none of it
    const other = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: { authorization: `Bearer ${editorBToken}` },
    });
    expect(other.json().activeRuns).toBe(0);
    expect(other.json().last24h.total).toBe(0);
  });
});
