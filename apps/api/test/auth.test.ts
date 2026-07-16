import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, createUser, SEEDED_PASSWORD, validDag } from './fixtures.js';

describe('auth', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let editorEmail: string;

  beforeAll(async () => {
    app = buildApp();
    // Fastify defers plugin boot (and decorator wiring, e.g. app.jwt) until
    // ready()/inject()/listen() is called — force it now since this suite
    // calls app.jwt.sign() directly, not just through inject().
    await app.ready();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const editor = await createUser(tenantId, 'editor');
    editorEmail = editor.email;
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in with correct credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: editorEmail, password: SEEDED_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('accessToken');
  });

  it('rejects an unknown email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@test.dev', password: SEEDED_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects the wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: editorEmail, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a forged token (tampered signature)', async () => {
    const token = await app.jwt.sign({ tenantId, userId: 'x', role: 'editor' });
    const forged = `${token.slice(0, -5)}aaaaa`;

    const response = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await app.jwt.sign({ tenantId, userId: 'x', role: 'editor' }, { expiresIn: '1ms' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/workflows' });
    expect(response.statusCode).toBe(401);
  });

  it('blocks a viewer from writing, but allows reads', async () => {
    const viewer = await createUser(tenantId, 'viewer');
    const token = await app.jwt.sign({ tenantId, userId: viewer.id, role: 'viewer' });

    const writeResponse = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'viewer-attempt', dag: validDag() },
    });
    expect(writeResponse.statusCode).toBe(403);
    expect(writeResponse.json().error.code).toBe('FORBIDDEN');

    const readResponse = await app.inject({
      method: 'GET',
      url: '/workflows',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readResponse.statusCode).toBe(200);
  });
});
