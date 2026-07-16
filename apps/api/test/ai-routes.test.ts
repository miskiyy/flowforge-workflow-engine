import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resolveProvider } from '../src/ai/routes.js';
import type { ChatMessage, DagProposer } from '../src/ai/provider.js';
import { createTenant, createUser, validDag } from './fixtures.js';
import { createWorkflow, listVersions, updateWorkflow } from '../src/workflows/repository.js';

const VALID_DAG = validDag() as unknown as WorkflowDagDefinition;

describe('POST /workflows/:id/propose', () => {
  let app: FastifyInstance;
  let providerCalls: ChatMessage[][];

  let tenantAId: string;
  let editorAToken: string;
  let viewerAToken: string;

  let tenantBId: string;
  let editorBToken: string;

  beforeAll(async () => {
    providerCalls = [];
    const provider: DagProposer = {
      complete: async (messages) => {
        providerCalls.push(messages);
        return { text: JSON.stringify(validDag()), usage: { promptTokens: 10, completionTokens: 5 } };
      },
    };
    app = buildApp({ aiProvider: provider });
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

  it('returns a proposal (diff + meta) for a greenfield ("new") request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/new/propose',
      headers: authed(editorAToken),
      payload: { prompt: 'add a delay step' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.proposedDag.steps).toBeInstanceOf(Array);
    expect(body.diff.added.length).toBeGreaterThan(0);
    expect(body.meta.attempts).toBe(1);
    expect(body.meta.cached).toBe(false);
  });

  it('blocks a viewer with 403, and the provider is never called', async () => {
    const before = providerCalls.length;
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/new/propose',
      headers: authed(viewerAToken),
      payload: { prompt: 'add a delay step' },
    });

    expect(response.statusCode).toBe(403);
    expect(providerCalls).toHaveLength(before);
  });

  it('rejects a prompt over 2000 chars with 400, and the provider is never called', async () => {
    const before = providerCalls.length;
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/new/propose',
      headers: authed(editorAToken),
      payload: { prompt: 'x'.repeat(2001) },
    });

    expect(response.statusCode).toBe(400);
    expect(providerCalls).toHaveLength(before);
  });

  it('404s when the workflow belongs to a different tenant, even via its real UUID', async () => {
    const editorA2 = await createUser(tenantAId, 'editor');
    const { definition, version } = await createWorkflow({ tenantId: tenantAId, userId: editorA2.id, name: 'wf', dag: VALID_DAG });

    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${definition.id}/propose`,
      headers: authed(editorBToken),
      payload: { prompt: 'anything', baseVersionId: version.id },
    });

    expect(response.statusCode).toBe(404);
  });

  it('409s on a stale baseVersionId', async () => {
    const editor = await createUser(tenantAId, 'editor');
    const token = await app.jwt.sign({ tenantId: tenantAId, userId: editor.id, role: 'editor' });
    const { definition, version: v1 } = await createWorkflow({ tenantId: tenantAId, userId: editor.id, name: 'wf', dag: VALID_DAG });
    await updateWorkflow({ tenantId: tenantAId, userId: editor.id, workflowId: definition.id, dag: VALID_DAG }); // moves current_version_id

    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${definition.id}/propose`,
      headers: authed(token),
      payload: { prompt: 'anything', baseVersionId: v1.id },
    });

    expect(response.statusCode).toBe(409);
  });

  it('400s when baseVersionId is provided for a new ("new") workflow', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/new/propose',
      headers: authed(editorAToken),
      payload: { prompt: 'anything', baseVersionId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('400s when baseVersionId is omitted for an existing workflow', async () => {
    const editor = await createUser(tenantAId, 'editor');
    const token = await app.jwt.sign({ tenantId: tenantAId, userId: editor.id, role: 'editor' });
    const { definition } = await createWorkflow({ tenantId: tenantAId, userId: editor.id, name: 'wf', dag: VALID_DAG });

    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${definition.id}/propose`,
      headers: authed(token),
      payload: { prompt: 'anything' },
    });
    expect(response.statusCode).toBe(400);
  });

  describe('rate limiting', () => {
    it('returns 429 once a tenant exceeds the AI bucket capacity', async () => {
      const tenant = await createTenant();
      const editor = await createUser(tenant.id, 'editor');
      const token = await app.jwt.sign({ tenantId: tenant.id, userId: editor.id, role: 'editor' });

      // AI bucket capacity is 5 (see ai/routes.ts, a much tighter bucket than
      // CRUD's) — capacity+1 requests from a tenant with no other AI calls
      // guarantees exactly one 429.
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          app.inject({
            method: 'POST',
            url: '/workflows/new/propose',
            headers: authed(token),
            payload: { prompt: 'add a delay step' },
          }),
        ),
      );

      const statusCodes = results.map((r) => r.statusCode);
      expect(statusCodes.filter((code) => code === 200)).toHaveLength(5);
      expect(statusCodes.filter((code) => code === 429)).toHaveLength(1);
    });
  });

  describe('integration: /propose writes nothing, PATCH is the only persistence path', () => {
    it('propose alone creates no version; applying the proposal via PATCH does', async () => {
      const editor = await createUser(tenantAId, 'editor');
      const token = await app.jwt.sign({ tenantId: tenantAId, userId: editor.id, role: 'editor' });
      const { definition, version: v1 } = await createWorkflow({ tenantId: tenantAId, userId: editor.id, name: 'wf', dag: VALID_DAG });

      const proposeResponse = await app.inject({
        method: 'POST',
        url: `/workflows/${definition.id}/propose`,
        headers: authed(token),
        payload: { prompt: 'add a step', baseVersionId: v1.id },
      });
      expect(proposeResponse.statusCode).toBe(200);
      const { proposedDag } = proposeResponse.json();

      const versionsAfterPropose = await listVersions({ tenantId: tenantAId, workflowId: definition.id, limit: 10 });
      expect(versionsAfterPropose.items).toHaveLength(1); // /propose wrote nothing

      const patchResponse = await app.inject({
        method: 'PATCH',
        url: `/workflows/${definition.id}`,
        headers: authed(token),
        payload: { dag: proposedDag, baseVersionId: v1.id },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patched = patchResponse.json();
      expect(patched.version.id).not.toBe(v1.id);
      expect(patched.workflow.currentVersionId).toBe(patched.version.id); // current_version_id moved

      const versionsAfterPatch = await listVersions({ tenantId: tenantAId, workflowId: definition.id, limit: 10 });
      expect(versionsAfterPatch.items).toHaveLength(2); // PATCH is what actually persisted a version
    });
  });
});

describe('resolveProvider', () => {
  it('returns a MockProposer when aiProvider is "mock", regardless of key', () => {
    const result = resolveProvider({ aiProvider: 'mock', aiModel: 'x' });
    expect(result.ok).toBe(true);
  });

  it('fails (does not throw) when aiProvider is "openrouter" and no key is configured', () => {
    const result = resolveProvider({ aiProvider: 'openrouter', aiModel: 'x' });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('OPENROUTER_API_KEY') });
  });

  it('succeeds when aiProvider is "openrouter" and a key is configured', () => {
    const result = resolveProvider({ aiProvider: 'openrouter', openrouterApiKey: 'sk-test', aiModel: 'x' });
    expect(result.ok).toBe(true);
  });
});
