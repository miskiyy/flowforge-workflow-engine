import { randomUUID } from 'node:crypto';
import { db } from '../src/db/client.js';
import { tenants, users, type UserRole } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';
import { ensureMembership } from '../src/memberships/repository.js';

export async function createTenant(name = `tenant-${randomUUID()}`) {
  const [tenant] = await db.insert(tenants).values({ name }).returning();
  if (!tenant) throw new Error('failed to create tenant');
  return tenant;
}

export const SEEDED_PASSWORD = 'password123';

export async function createUser(tenantId: string, role: UserRole) {
  const email = `${role}-${randomUUID()}@test.dev`;
  const passwordHash = await hashPassword(SEEDED_PASSWORD);
  const [user] = await db.insert(users).values({ tenantId, email, passwordHash, role }).returning();
  if (!user) throw new Error('failed to create user');
  // Mirror real signup: a user is a member of their home tenant.
  await ensureMembership(user.id, tenantId, role);
  return user;
}

/** Adds an existing user to a second tenant — the multi-tenant setup a switch test needs. */
export async function addMembership(userId: string, tenantId: string, role: UserRole) {
  await ensureMembership(userId, tenantId, role);
}

/** A minimal, schema-valid linear DAG: delay -> http. */
export function validDag(overrides: { steps?: unknown[] } = {}) {
  return {
    steps: overrides.steps ?? [
      { key: 'a', type: 'delay', dependsOn: [], durationMs: 100 },
      { key: 'b', type: 'http', dependsOn: ['a'], method: 'GET', url: 'https://example.com' },
    ],
  };
}

export const cyclicDag = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: ['b'], durationMs: 100 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 100 },
  ],
};

export const duplicateKeyDag = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 100 },
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 200 },
  ],
};

export const unknownDependencyDag = {
  steps: [{ key: 'a', type: 'delay', dependsOn: ['ghost'], durationMs: 100 }],
};

export const malformedDag = {
  steps: [{ key: 'a', type: 'delay', dependsOn: [] }], // missing required durationMs
};
