import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('POST /webhooks/:token', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let editorToken: string;
  let adminToken: string;
  let workflowId: string;
  let webhookToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const tenant = await createTenant();
    tenantId = tenant.id;
    const editor = await createUser(tenantId, 'editor');
    const admin = await createUser(tenantId, 'admin');
    editorToken = await app.jwt.sign({ tenantId, userId: editor.id, role: 'editor' });
    adminToken = await app.jwt.sign({ tenantId, userId: admin.id, role: 'admin' });

    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { name: 'webhook-fixture', dag: validDag() },
    });
    workflowId = created.json().workflow.id;

    // Minting/revoking the webhook secret is admin-only (workflows/routes.ts) — editor authors and triggers workflows, not their credentials.
    const tokenResponse = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/webhook-token`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    webhookToken = tokenResponse.json().workflow.webhookToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('triggers a run with no authentication, using only the token', async () => {
    const response = await app.inject({ method: 'POST', url: `/webhooks/${webhookToken}` });
    expect(response.statusCode).toBe(201);
    expect(response.json().run.status).toBe('pending');
    expect(response.json().deduped).toBe(false);
  });

  it('404s an unknown token', async () => {
    const response = await app.inject({ method: 'POST', url: '/webhooks/00000000-0000-0000-0000-000000000000' });
    expect(response.statusCode).toBe(404);
  });

  it('400s a non-UUID token', async () => {
    const response = await app.inject({ method: 'POST', url: '/webhooks/not-a-uuid' });
    expect(response.statusCode).toBe(400);
  });

  it('dedupes a replayed delivery via the Idempotency-Key header', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/webhooks/${webhookToken}`,
      headers: { 'idempotency-key': 'delivery-123' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().deduped).toBe(false);

    const replay = await app.inject({
      method: 'POST',
      url: `/webhooks/${webhookToken}`,
      headers: { 'idempotency-key': 'delivery-123' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().deduped).toBe(true);
    expect(replay.json().run.id).toBe(first.json().run.id);
  });

  it('404s once the token is revoked', async () => {
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/workflows/${workflowId}/webhook-token`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(revoke.json().workflow.webhookToken).toBeNull();

    const response = await app.inject({ method: 'POST', url: `/webhooks/${webhookToken}` });
    expect(response.statusCode).toBe(404);
  });
});
