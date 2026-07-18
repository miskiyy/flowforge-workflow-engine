import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/plugin.js';
import { db } from '../db/client.js';
import { apiKeys, type UserRole } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';

export type ApiKeyRow = typeof apiKeys.$inferSelect;

const TOKEN_PREFIX = 'ff_';
// ff_ + 6 chars is enough to recognise a key in a list without being a useful
// fraction of the ~192-bit secret.
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 6;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
  return { token, hash: sha256(token), prefix: token.slice(0, DISPLAY_PREFIX_LEN) };
}

export interface CreateApiKeyInput {
  tenantId: string;
  createdBy: string;
  label: string;
  role: UserRole;
}

/** Returns the plaintext token exactly once — only its sha256 hash is persisted, so it can never be shown again. */
export async function createApiKey(input: CreateApiKeyInput): Promise<{ row: ApiKeyRow; token: string }> {
  const { token, hash, prefix } = generateToken();
  const [row] = await db
    .insert(apiKeys)
    .values({
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      label: input.label,
      role: input.role,
      keyHash: hash,
      prefix,
    })
    .returning();
  if (!row) throw new Error('failed to create api key');
  return { row, token };
}

/** Active (non-revoked) keys for a tenant. Never returns key_hash — callers serialize only non-secret fields. */
export async function listApiKeys(tenantId: string): Promise<ApiKeyRow[]> {
  return db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

/** Soft-revoke (sets revoked_at) — scoped to the tenant so one tenant can't revoke another's key. */
export async function revokeApiKey(tenantId: string, id: string): Promise<void> {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) throw new NotFoundError('API key not found');
}

/**
 * Resolves a presented `ff_...` token to an AuthUser, or null if unknown/revoked.
 * The secret names its own tenant (same inverted posture as the webhook route,
 * webhooks/routes.ts): userId is the key's creator so downstream FKs stay valid.
 */
export async function authenticateApiKey(token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256(token)), isNull(apiKeys.revokedAt)));
  if (!row) return null;

  // Best-effort usage stamp: one indexed update on the auth path.
  // ponytail: synchronous write, batch/async it only if key-auth QPS ever bites.
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return { tenantId: row.tenantId, userId: row.createdBy, role: row.role };
}
