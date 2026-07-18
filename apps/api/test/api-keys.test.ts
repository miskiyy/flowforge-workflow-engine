import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, createUser } from './fixtures.js';

describe('api keys', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let adminToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const admin = await createUser(tenantId, 'admin');
    const editor = await createUser(tenantId, 'editor');
    adminToken = await app.jwt.sign({ tenantId, userId: admin.id, role: 'admin' });
    editorToken = await app.jwt.sign({ tenantId, userId: editor.id, role: 'editor' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createKey(label: string, role?: string): Promise<{ id: string; secret: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: role ? { label, role } : { label },
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().apiKey.id, secret: res.json().secret };
  }

  it('mints a key, returns the plaintext secret once, and never leaks it again', async () => {
    const { id, secret } = await createKey('ci-deploy');
    expect(secret.startsWith('ff_')).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    const found = list.json().items.find((k: { id: string }) => k.id === id);
    expect(found).toBeTruthy();
    // No secret / hash ever comes back on the list.
    expect(JSON.stringify(list.json())).not.toContain(secret);
    expect(found).not.toHaveProperty('keyHash');
    expect(found).not.toHaveProperty('secret');
  });

  it('authenticates a real request using the minted key (the single door)', async () => {
    const { secret } = await createKey('reader');
    const res = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('scopes the key to its own tenant', async () => {
    const otherTenant = await createTenant();
    const otherAdmin = await createUser(otherTenant.id, 'admin');
    const otherToken = await app.jwt.sign({ tenantId: otherTenant.id, userId: otherAdmin.id, role: 'admin' });
    // Key minted under the OTHER tenant.
    const otherKeyRes = await app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { label: 'other-tenant-key' },
    });
    const otherSecret = otherKeyRes.json().secret;

    // It must not appear in THIS tenant's key list.
    const list = await app.inject({
      method: 'GET',
      url: '/api-keys',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(JSON.stringify(list.json())).not.toContain(otherKeyRes.json().apiKey.id);
    // And it still authenticates — as its own tenant, not this one.
    const authed = await app.inject({ method: 'GET', url: '/workflows', headers: { authorization: `Bearer ${otherSecret}` } });
    expect(authed.statusCode).toBe(200);
  });

  it('rejects a revoked key', async () => {
    const { id, secret } = await createKey('to-revoke');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api-keys/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: '/workflows', headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a garbage key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { authorization: 'Bearer ff_not-a-real-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is admin-only to manage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { label: 'editor-attempt' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('honours the key role — a viewer key cannot write', async () => {
    const { secret } = await createKey('viewer-key', 'viewer');
    const res = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${secret}` },
      payload: { name: 'x', dag: { steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }] } },
    });
    expect(res.statusCode).toBe(403);
  });
});
