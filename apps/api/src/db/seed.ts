import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { and, eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/password.js';
import { createWorkflow } from '../workflows/repository.js';
import { db, pool } from './client.js';
import { USER_ROLES, tenants, users, workflowDefinitions, type UserRole } from './schema.js';

/** Fixed dev-only password for every seeded user — documented here and in README, never for production use. */
const SEED_PASSWORD = 'password123';

const SEED_TENANTS = [
  { name: 'Acme Inc', slug: 'acme' },
  { name: 'Globex Corp', slug: 'globex' },
];

async function findOrCreateTenant(name: string) {
  const [existing] = await db.select().from(tenants).where(eq(tenants.name, name));
  if (existing) return existing;
  const [created] = await db.insert(tenants).values({ name }).returning();
  if (!created) throw new Error(`failed to create tenant: ${name}`);
  return created;
}

async function findOrCreateUser(tenantId: string, email: string, role: UserRole) {
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email)));
  if (existing) return existing;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const [created] = await db.insert(users).values({ tenantId, email, passwordHash, role }).returning();
  if (!created) throw new Error(`failed to create user: ${email}`);
  return created;
}

/**
 * Example workflows so a first-time reviewer lands on something runnable
 * instead of an empty table (frontend-ux-revision.md R1). One per demo beat:
 * a clean success, a diamond fan-out, and a failure that skips its dependent.
 * Seeded for the first tenant only — the second stays empty, which also
 * demonstrates tenant isolation.
 */
const EXAMPLE_WORKFLOWS: { name: string; dag: WorkflowDagDefinition }[] = [
  {
    name: 'hello-http',
    dag: { steps: [{ key: 'fetch', type: 'http', dependsOn: [], method: 'GET', url: 'https://example.com' }] },
  },
  {
    // Diamond: seed -> {left, right} -> join. Shows the graph and parallel structure.
    name: 'fan-out',
    dag: {
      steps: [
        { key: 'seed', type: 'delay', dependsOn: [], durationMs: 300 },
        { key: 'left', type: 'delay', dependsOn: ['seed'], durationMs: 300 },
        { key: 'right', type: 'delay', dependsOn: ['seed'], durationMs: 300 },
        { key: 'join', type: 'delay', dependsOn: ['left', 'right'], durationMs: 300 },
      ],
    },
  },
  {
    // A host that can never resolve (RFC 2606 .invalid TLD) -> deterministic
    // fetch failure, offline, no external dependency. `notify` then skips,
    // showing failure propagation.
    name: 'flaky-endpoint',
    dag: {
      steps: [
        { key: 'call', type: 'http', dependsOn: [], method: 'GET', url: 'https://service.invalid/health' },
        { key: 'notify', type: 'http', dependsOn: ['call'], method: 'POST', url: 'https://example.com/notify' },
      ],
    },
  },
];

export async function seedExampleWorkflows(tenantId: string, userId: string): Promise<void> {
  for (const example of EXAMPLE_WORKFLOWS) {
    const [existing] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.name, example.name)));
    if (existing) continue;
    await createWorkflow({ tenantId, userId, name: example.name, dag: example.dag });
  }
}

/** Idempotent: safe to run repeatedly, only inserts rows that don't already exist. */
export async function seed(): Promise<void> {
  for (const [index, tenant] of SEED_TENANTS.entries()) {
    const { id: tenantId } = await findOrCreateTenant(tenant.name);
    let adminUserId: string | undefined;
    for (const role of USER_ROLES) {
      const user = await findOrCreateUser(tenantId, `${role}@${tenant.slug}.dev`, role);
      if (role === 'admin') adminUserId = user.id;
    }
    // Only the first tenant gets example workflows; the second stays empty.
    if (index === 0 && adminUserId) await seedExampleWorkflows(tenantId, adminUserId);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seed()
    .then(() => {
      console.log(`seed complete — password for all seeded users: ${SEED_PASSWORD}`);
      return pool.end();
    })
    .catch(async (err: unknown) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
