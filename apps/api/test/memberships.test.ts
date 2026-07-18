import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { addMembership, createTenant, createUser } from './fixtures.js';

/** Decodes a JWT payload without verifying — tests only assert on claims we just minted. */
function claims(token: string): { tenantId: string; role: string; userId: string } {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('memberships + tenant switching', () => {
  let app: FastifyInstance;
  let homeTenantId: string;
  let otherTenantId: string;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    const home = await createTenant('Home Co');
    const other = await createTenant('Other Co');
    homeTenantId = home.id;
    otherTenantId = other.id;
    const user = await createUser(homeTenantId, 'admin'); // createUser also makes the home membership
    userId = user.id;
    await addMembership(userId, otherTenantId, 'viewer'); // member of a second tenant, lower role there
    token = await app.jwt.sign({ tenantId: homeTenantId, userId, role: 'admin' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the tenants the user belongs to', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/tenants', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().tenants.map((t: { tenantId: string }) => t.tenantId);
    expect(ids).toContain(homeTenantId);
    expect(ids).toContain(otherTenantId);
  });

  it('switches to another tenant and issues a token carrying that tenant + its role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/switch-tenant',
      headers: { authorization: `Bearer ${token}` },
      payload: { tenantId: otherTenantId },
    });
    expect(res.statusCode).toBe(200);
    const switched = claims(res.json().accessToken);
    expect(switched.tenantId).toBe(otherTenantId);
    expect(switched.role).toBe('viewer'); // role is per-tenant, taken from the membership, not the caller
    expect(switched.userId).toBe(userId);
  });

  it('refuses to switch to a tenant the user is not a member of', async () => {
    const strangerTenant = await createTenant('Stranger Co');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/switch-tenant',
      headers: { authorization: `Bearer ${token}` },
      payload: { tenantId: strangerTenant.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});
