import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  createTenant,
  createUser,
  cyclicDag,
  duplicateKeyDag,
  malformedDag,
  unknownDependencyDag,
  validDag,
} from './fixtures.js';

describe('workflows', () => {
  let app: FastifyInstance;

  let tenantAId: string;
  let editorAToken: string;
  let adminAToken: string;
  let viewerAToken: string;

  let tenantBId: string;
  let editorBToken: string;

  beforeAll(async () => {
    app = buildApp();
    // Fastify defers plugin boot (and decorator wiring, e.g. app.jwt) until
    // ready()/inject()/listen() is called — force it now since this suite
    // calls app.jwt.sign() directly, not just through inject().
    await app.ready();

    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    const editorA = await createUser(tenantAId, 'editor');
    const adminA = await createUser(tenantAId, 'admin');
    const viewerA = await createUser(tenantAId, 'viewer');
    editorAToken = await app.jwt.sign({ tenantId: tenantAId, userId: editorA.id, role: 'editor' });
    adminAToken = await app.jwt.sign({ tenantId: tenantAId, userId: adminA.id, role: 'admin' });
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
    return app.inject({
      method: 'POST',
      url: '/workflows',
      headers: authed(token),
      payload: { name, dag },
    });
  }

  describe('create -> version -> patch -> rollback', () => {
    it('creates a workflow with an immutable v1', async () => {
      const response = await createWorkflowAs(editorAToken, 'lifecycle-workflow');
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.workflow.name).toBe('lifecycle-workflow');
      expect(body.version.versionNumber).toBe(1);
      expect(body.workflow.currentVersionId).toBe(body.version.id);
    });

    it('PATCH with a new dag creates version 2 and repoints current, never touching v1', async () => {
      const created = await createWorkflowAs(editorAToken, 'patch-workflow');
      const workflowId = created.json().workflow.id;
      const v1Id = created.json().version.id;

      const patched = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
        payload: { dag: validDag({ steps: [{ key: 'solo', type: 'delay', dependsOn: [], durationMs: 1 }] }) },
      });

      expect(patched.statusCode).toBe(200);
      const patchedBody = patched.json();
      expect(patchedBody.version.versionNumber).toBe(2);
      expect(patchedBody.workflow.currentVersionId).toBe(patchedBody.version.id);
      expect(patchedBody.workflow.currentVersionId).not.toBe(v1Id);

      const versions = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}/versions`,
        headers: authed(editorAToken),
      });
      const versionNumbers = versions.json().items.map((v: { versionNumber: number }) => v.versionNumber);
      expect(versionNumbers.sort()).toEqual([1, 2]);

      // v1's dag is exactly what was submitted at creation — untouched by the patch.
      const v1 = versions.json().items.find((v: { id: string }) => v.id === v1Id);
      expect(v1.dag).toEqual(validDag());
    });

    it('a name-only PATCH does not create a new version', async () => {
      const created = await createWorkflowAs(editorAToken, 'name-only');
      const workflowId = created.json().workflow.id;

      const patched = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
        payload: { name: 'renamed' },
      });

      expect(patched.statusCode).toBe(200);
      expect(patched.json().version).toBeNull();
      expect(patched.json().workflow.name).toBe('renamed');

      const versions = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}/versions`,
        headers: authed(editorAToken),
      });
      expect(versions.json().items).toHaveLength(1);
    });

    it('rollback repoints current_version_id without creating a new version', async () => {
      const created = await createWorkflowAs(editorAToken, 'rollback-workflow');
      const workflowId = created.json().workflow.id;
      const v1Id = created.json().version.id;

      await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
        payload: { dag: validDag({ steps: [{ key: 'solo', type: 'delay', dependsOn: [], durationMs: 1 }] }) },
      });

      const rollback = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/rollback/${v1Id}`,
        headers: authed(editorAToken),
      });

      expect(rollback.statusCode).toBe(200);
      expect(rollback.json().workflow.currentVersionId).toBe(v1Id);
      expect(rollback.json().version.versionNumber).toBe(1);

      const versions = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}/versions`,
        headers: authed(editorAToken),
      });
      // still exactly 2 versions — rollback repoints, it does not delete or duplicate.
      expect(versions.json().items).toHaveLength(2);
    });
  });

  describe('soft delete', () => {
    it('deletes a workflow and filters it from get/list', async () => {
      const created = await createWorkflowAs(editorAToken, 'to-delete');
      const workflowId = created.json().workflow.id;

      const del = await app.inject({
        method: 'DELETE',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
      });
      expect(del.statusCode).toBe(204);

      const get = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
      });
      expect(get.statusCode).toBe(404);

      const list = await app.inject({
        method: 'GET',
        url: `/workflows?name=to-delete`,
        headers: authed(editorAToken),
      });
      expect(list.json().items).toHaveLength(0);
    });
  });

  describe('validation', () => {
    it('rejects a schema-invalid dag (missing required field)', async () => {
      const response = await createWorkflowAs(editorAToken, 'bad-schema', malformedDag);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DAG');
    });

    it('rejects duplicate step keys', async () => {
      const response = await createWorkflowAs(editorAToken, 'dup-keys', duplicateKeyDag);
      expect(response.statusCode).toBe(422);
      expect(JSON.stringify(response.json().error.details)).toMatch(/duplicate/);
    });

    it('rejects an unknown dependency reference', async () => {
      const response = await createWorkflowAs(editorAToken, 'bad-dep', unknownDependencyDag);
      expect(response.statusCode).toBe(422);
      expect(JSON.stringify(response.json().error.details)).toMatch(/unknown dependency/);
    });

    it('rejects a cyclic dag', async () => {
      const response = await createWorkflowAs(editorAToken, 'cyclic', cyclicDag);
      expect(response.statusCode).toBe(422);
      expect(JSON.stringify(response.json().error.details)).toMatch(/cycle/);
    });

    // Audit C1: proven live against a running stack — an ordinary editor
    // could POST/PATCH an http step targeting a private/loopback address
    // (e.g. the cloud metadata endpoint) because only the AI proposal path
    // called checkGuards. Both write paths now share the same guard as
    // ai/propose.ts (workflows/routes.ts's validateAndGuardDag).
    it('rejects an http step targeting a private/loopback address on manual create (SSRF guard, not just the AI path)', async () => {
      const ssrfDag = {
        steps: [{ key: 'probe', type: 'http', dependsOn: [], method: 'GET', url: 'http://169.254.169.254/latest/meta-data' }],
      };
      const response = await createWorkflowAs(editorAToken, 'ssrf-probe', ssrfDag);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DAG');
      expect(JSON.stringify(response.json().error.details)).toMatch(/not allowed/);
    });

    it('rejects the same SSRF url on PATCH', async () => {
      const created = await createWorkflowAs(editorAToken, 'patch-ssrf-target');
      const { workflow } = created.json();

      const ssrfDag = {
        steps: [{ key: 'probe', type: 'http', dependsOn: [], method: 'GET', url: 'http://127.0.0.1:8080/internal' }],
      };
      const response = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflow.id}`,
        headers: authed(editorAToken),
        payload: { dag: ssrfDag },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DAG');
    });
  });

  describe('pagination and filtering', () => {
    it('paginates the workflow list with a cursor', async () => {
      const prefix = `page-${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        await createWorkflowAs(editorAToken, `${prefix}-${i}`);
      }

      const firstPage = await app.inject({
        method: 'GET',
        url: `/workflows?name=${prefix}&limit=2&sort=createdAt_asc`,
        headers: authed(editorAToken),
      });
      expect(firstPage.json().items).toHaveLength(2);
      expect(firstPage.json().nextCursor).not.toBeNull();

      const secondPage = await app.inject({
        method: 'GET',
        url: `/workflows?name=${prefix}&limit=2&sort=createdAt_asc&cursor=${firstPage.json().nextCursor}`,
        headers: authed(editorAToken),
      });
      expect(secondPage.json().items).toHaveLength(1);
      expect(secondPage.json().nextCursor).toBeNull();

      const firstNames = firstPage.json().items.map((w: { name: string }) => w.name);
      const secondNames = secondPage.json().items.map((w: { name: string }) => w.name);
      expect(new Set([...firstNames, ...secondNames]).size).toBe(3);
    });

    it('filters by name substring', async () => {
      const uniqueName = `findme-${Date.now()}`;
      await createWorkflowAs(editorAToken, uniqueName);
      await createWorkflowAs(editorAToken, `unrelated-${Date.now()}`);

      const response = await app.inject({
        method: 'GET',
        url: `/workflows?name=findme`,
        headers: authed(editorAToken),
      });

      const names = response.json().items.map((w: { name: string }) => w.name);
      expect(names).toContain(uniqueName);
      expect(names.every((n: string) => n.includes('findme'))).toBe(true);
    });
  });

  describe('RBAC', () => {
    it('allows editor and admin to write, blocks viewer', async () => {
      const editorResponse = await createWorkflowAs(editorAToken, 'rbac-editor');
      expect(editorResponse.statusCode).toBe(201);

      const adminResponse = await createWorkflowAs(adminAToken, 'rbac-admin');
      expect(adminResponse.statusCode).toBe(201);

      const viewerResponse = await createWorkflowAs(viewerAToken, 'rbac-viewer');
      expect(viewerResponse.statusCode).toBe(403);
    });

    it('lets viewer read', async () => {
      const response = await app.inject({ method: 'GET', url: '/workflows', headers: authed(viewerAToken) });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('tenant isolation', () => {
    it('tenant B cannot read, patch, delete, or rollback tenant A workflow via its real UUID', async () => {
      const created = await createWorkflowAs(editorAToken, 'isolated-workflow');
      const workflowId = created.json().workflow.id;
      const versionId = created.json().version.id;

      const get = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: authed(editorBToken),
      });
      expect(get.statusCode).toBe(404);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorBToken),
        payload: { name: 'hijacked' },
      });
      expect(patch.statusCode).toBe(404);

      const del = await app.inject({
        method: 'DELETE',
        url: `/workflows/${workflowId}`,
        headers: authed(editorBToken),
      });
      expect(del.statusCode).toBe(404);

      const rollback = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/rollback/${versionId}`,
        headers: authed(editorBToken),
      });
      expect(rollback.statusCode).toBe(404);

      // tenant A can still see it — it was never actually affected.
      const stillThere = await app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it('tenant B does not see tenant A workflows in its list', async () => {
      const response = await app.inject({ method: 'GET', url: '/workflows', headers: authed(editorBToken) });
      const names = response.json().items.map((w: { name: string }) => w.name);
      expect(names).not.toContain('isolated-workflow');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 once a tenant exceeds its bucket capacity', async () => {
      const tenant = await createTenant();
      const editor = await createUser(tenant.id, 'editor');
      const token = await app.jwt.sign({ tenantId: tenant.id, userId: editor.id, role: 'editor' });

      // Bucket capacity is 50 (see workflows/routes.ts) — capacity+1 requests
      // to a tenant that has made no other calls guarantees exactly one 429.
      const results = await Promise.all(
        Array.from({ length: 51 }, (_, i) => createWorkflowAs(token, `rate-limit-${i}`)),
      );

      const statusCodes = results.map((r) => r.statusCode);
      expect(statusCodes.filter((code) => code === 201)).toHaveLength(50);
      expect(statusCodes.filter((code) => code === 429)).toHaveLength(1);
    });
  });

  describe('cron_expression validation', () => {
    it('accepts a valid cron expression at create time', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: authed(editorAToken),
        payload: { name: 'cron-valid', dag: validDag(), cronExpression: '*/5 * * * *' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().workflow.cronExpression).toBe('*/5 * * * *');
    });

    it('rejects an invalid cron expression at create time', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows',
        headers: authed(editorAToken),
        payload: { name: 'cron-invalid', dag: validDag(), cronExpression: 'not a cron' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_CRON');
    });

    it('accepts setting, then clearing (null), a cron expression via PATCH', async () => {
      const created = await createWorkflowAs(editorAToken, 'cron-patch-target');
      const workflowId = created.json().workflow.id;

      const set = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
        payload: { cronExpression: '0 9 * * *' },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json().workflow.cronExpression).toBe('0 9 * * *');

      const cleared = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowId}`,
        headers: authed(editorAToken),
        payload: { cronExpression: null },
      });
      expect(cleared.json().workflow.cronExpression).toBeNull();
    });

    it('rejects an invalid cron expression via PATCH', async () => {
      const created = await createWorkflowAs(editorAToken, 'cron-patch-invalid');
      const response = await app.inject({
        method: 'PATCH',
        url: `/workflows/${created.json().workflow.id}`,
        headers: authed(editorAToken),
        payload: { cronExpression: '99 * * * *' },
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('webhook token lifecycle', () => {
    it('has no webhook token until one is generated', async () => {
      const created = await createWorkflowAs(editorAToken, 'webhook-lifecycle');
      expect(created.json().workflow.webhookToken).toBeNull();
    });

    it('generates a new token, and regenerating replaces the old one', async () => {
      const created = await createWorkflowAs(editorAToken, 'webhook-regen');
      const workflowId = created.json().workflow.id;

      const first = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/webhook-token`,
        headers: authed(editorAToken),
      });
      expect(first.statusCode).toBe(200);
      const firstToken = first.json().workflow.webhookToken;
      expect(firstToken).toMatch(/^[0-9a-f-]{36}$/);

      const second = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/webhook-token`,
        headers: authed(editorAToken),
      });
      expect(second.json().workflow.webhookToken).not.toBe(firstToken);
    });

    it('blocks a viewer from generating a webhook token', async () => {
      const created = await createWorkflowAs(editorAToken, 'webhook-viewer-blocked');
      const response = await app.inject({
        method: 'POST',
        url: `/workflows/${created.json().workflow.id}/webhook-token`,
        headers: authed(viewerAToken),
      });
      expect(response.statusCode).toBe(403);
    });

    it('404s generating a token for another tenant\'s workflow', async () => {
      const created = await createWorkflowAs(editorAToken, 'webhook-cross-tenant');
      const response = await app.inject({
        method: 'POST',
        url: `/workflows/${created.json().workflow.id}/webhook-token`,
        headers: authed(editorBToken),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
