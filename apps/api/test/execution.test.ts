import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('execution lifecycle', () => {
  let app: FastifyInstance;

  let tenantAId: string;
  let editorAToken: string;
  let viewerAToken: string;

  let tenantBId: string;
  let editorBToken: string;

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
    tenantBId = tenantB.id;
    const editorB = await createUser(tenantBId, 'editor');
    editorBToken = await app.jwt.sign({ tenantId: tenantBId, userId: editorB.id, role: 'editor' });
  });

  afterAll(async () => {
    await app.close();
  });

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createWorkflowAs(token: string, name: string, dag: unknown = validDag()) {
    return app.inject({ method: 'POST', url: '/workflows', headers: authed(token), payload: { name, dag } });
  }

  async function triggerAs(token: string, workflowId: string) {
    return app.inject({ method: 'POST', url: `/workflows/${workflowId}/trigger`, headers: authed(token) });
  }

  describe('starting a run', () => {
    it('creates a pending run with one pending step_run per dag step', async () => {
      const created = await createWorkflowAs(editorAToken, 'trigger-me');
      const workflowId = created.json().workflow.id;

      const response = await triggerAs(editorAToken, workflowId);
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.run.status).toBe('pending');
      expect(body.run.triggerType).toBe('manual');
      expect(body.run.workflowId).toBe(workflowId);
      expect(body.run.workflowVersionId).toBe(created.json().version.id);
      expect(body.steps.map((s: { stepKey: string; status: string }) => [s.stepKey, s.status])).toEqual([
        ['a', 'pending'],
        ['b', 'pending'],
      ]);
    });

    it('404s triggering a workflow that does not exist', async () => {
      const response = await triggerAs(editorAToken, '00000000-0000-0000-0000-000000000000');
      expect(response.statusCode).toBe(404);
    });

    it('blocks a viewer from triggering', async () => {
      const created = await createWorkflowAs(editorAToken, 'viewer-blocked');
      const response = await triggerAs(viewerAToken, created.json().workflow.id);
      expect(response.statusCode).toBe(403);
    });

    it('tenant B cannot trigger tenant A workflow via its real UUID', async () => {
      const created = await createWorkflowAs(editorAToken, 'cross-tenant-trigger');
      const response = await triggerAs(editorBToken, created.json().workflow.id);
      expect(response.statusCode).toBe(404);
    });
  });

  describe('execution history', () => {
    it('reads back a run with its steps by id', async () => {
      const created = await createWorkflowAs(editorAToken, 'history-detail');
      const triggered = await triggerAs(editorAToken, created.json().workflow.id);
      const runId = triggered.json().run.id;

      const response = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed(editorAToken) });
      expect(response.statusCode).toBe(200);
      expect(response.json().run.id).toBe(runId);
      expect(response.json().steps).toHaveLength(2);
      // the dashboard's workflow graph needs the DAG's dependsOn edges, not just step statuses.
      expect(response.json().dag).toEqual(validDag());
    });

    it('lists runs newest-first, scoped to the caller tenant', async () => {
      const created = await createWorkflowAs(editorAToken, 'history-list');
      const workflowId = created.json().workflow.id;
      const first = await triggerAs(editorAToken, workflowId);
      const second = await triggerAs(editorAToken, workflowId);

      const response = await app.inject({ method: 'GET', url: '/runs?limit=2', headers: authed(editorAToken) });
      expect(response.statusCode).toBe(200);
      const ids = response.json().items.map((r: { id: string }) => r.id);
      expect(ids[0]).toBe(second.json().run.id);
      expect(ids).toContain(first.json().run.id);
    });

    it('filters run history by status', async () => {
      const created = await createWorkflowAs(editorAToken, 'history-status');
      await triggerAs(editorAToken, created.json().workflow.id);

      const response = await app.inject({ method: 'GET', url: '/runs?status=pending', headers: authed(editorAToken) });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.every((r: { status: string }) => r.status === 'pending')).toBe(true);
    });

    it('filters run history by workflowId, scoped to the caller tenant', async () => {
      const created = await createWorkflowAs(editorAToken, 'history-by-workflow');
      const workflowId = created.json().workflow.id;
      const triggered = await triggerAs(editorAToken, workflowId);

      const otherWorkflow = await createWorkflowAs(editorAToken, 'history-other-workflow');
      await triggerAs(editorAToken, otherWorkflow.json().workflow.id);

      const response = await app.inject({
        method: 'GET',
        url: `/runs?workflowId=${workflowId}`,
        headers: authed(editorAToken),
      });
      expect(response.statusCode).toBe(200);
      const items = response.json().items as { id: string; workflowId: string }[];
      expect(items.map((r) => r.id)).toEqual([triggered.json().run.id]);
      expect(items.every((r) => r.workflowId === workflowId)).toBe(true);
    });

    it('tenant B cannot read tenant A run history via its real UUID', async () => {
      const created = await createWorkflowAs(editorAToken, 'isolated-run');
      const triggered = await triggerAs(editorAToken, created.json().workflow.id);
      const runId = triggered.json().run.id;

      const response = await app.inject({ method: 'GET', url: `/runs/${runId}`, headers: authed(editorBToken) });
      expect(response.statusCode).toBe(404);
    });
  });
});
