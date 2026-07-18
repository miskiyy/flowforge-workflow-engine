import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { USER_ROLES } from '../db/schema.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyRow } from './repository.js';

const RoleSchema = Type.Union(USER_ROLES.map((role) => Type.Literal(role)));

const CreateApiKeyBody = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 100 }),
  // The key's own role, capped at what it can do. Defaults to editor (author +
  // run, but not destroy/rotate) — least privilege for automation.
  role: Type.Optional(RoleSchema),
});

const ApiKeyIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

/** Non-secret projection — the raw token and its hash never leave the create response / the database respectively. */
function serializeApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    label: row.label,
    prefix: row.prefix,
    role: row.role,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function registerApiKeyRoutes(app: FastifyInstance): void {
  const limiter = new TokenBucketLimiter({ capacity: 50, refillPerSecond: 25 });
  const rateLimit = async (request: FastifyRequest): Promise<void> => {
    if (!limiter.consume(request.authUser.tenantId)) throw new TooManyRequestsError();
  };

  // Minting and revoking credentials is an admin-only concern (same posture as
  // rotating a workflow's webhook secret in workflows/routes.ts).
  const adminGuard = [app.authenticate, rateLimit, app.requireWrite, app.requireAdmin];

  app.post('/api-keys', { schema: { body: CreateApiKeyBody }, preHandler: adminGuard }, async (request, reply) => {
    const body = request.body as { label: string; role?: (typeof USER_ROLES)[number] };
    const { row, token } = await createApiKey({
      tenantId: request.authUser.tenantId,
      createdBy: request.authUser.userId,
      label: body.label,
      role: body.role ?? 'editor',
    });
    // `secret` is present exactly once, here — clients must store it now.
    return reply.status(201).send({ apiKey: serializeApiKey(row), secret: token });
  });

  app.get('/api-keys', { preHandler: adminGuard }, async (request) => {
    const rows = await listApiKeys(request.authUser.tenantId);
    return { items: rows.map(serializeApiKey) };
  });

  app.delete('/api-keys/:id', { schema: { params: ApiKeyIdParams }, preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await revokeApiKey(request.authUser.tenantId, id);
    return reply.status(204).send();
  });
}
