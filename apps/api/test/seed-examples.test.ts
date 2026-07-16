import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { workflowDefinitions } from '../src/db/schema.js';
import { seedExampleWorkflows } from '../src/db/seed.js';
import { createTenant, createUser } from './fixtures.js';

describe('seedExampleWorkflows', () => {
  it('creates the example workflows and is idempotent', async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, 'admin');

    await seedExampleWorkflows(tenant.id, admin.id);
    const first = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.tenantId, tenant.id));
    expect(first).toHaveLength(3);
    expect(first.map((w) => w.name).sort()).toEqual(['fan-out', 'flaky-endpoint', 'hello-http']);
    // Every seeded workflow points at a persisted v1.
    expect(first.every((w) => w.currentVersionId !== null)).toBe(true);

    // Re-running inserts nothing new.
    await seedExampleWorkflows(tenant.id, admin.id);
    const second = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.tenantId, tenant.id));
    expect(second).toHaveLength(3);
  });
});
