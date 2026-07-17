import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { workflowDefinitions } from '../src/db/schema.js';
import { listRuns } from '../src/execution/repository.js';
import { runCronTick, startCronScheduler } from '../src/scheduling/scheduler.js';
import { createWorkflow } from '../src/workflows/repository.js';
import { createTenant, createUser, validDag as rawValidDag } from './fixtures.js';

const silentLogger = { info: () => {}, error: () => {} };
const validDag = () => rawValidDag() as WorkflowDagDefinition;

describe('runCronTick', () => {
  it('creates a cron-triggered run for a workflow whose schedule matches the given instant', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'scheduled',
      dag: validDag(),
      cronExpression: '* * * * *', // matches every minute
    });

    await runCronTick({ logger: silentLogger, now: () => new Date('2026-07-16T03:27:00Z') });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]!.triggerType).toBe('cron');
  });

  it('does not trigger a workflow with no cron_expression', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'unscheduled',
      dag: validDag(),
    });

    await runCronTick({ logger: silentLogger });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items).toHaveLength(0);
  });

  it('does not trigger a workflow whose schedule does not match the given instant', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'noon-only',
      dag: validDag(),
      cronExpression: '0 12 * * *',
    });

    await runCronTick({ logger: silentLogger, now: () => new Date('2026-07-16T03:27:00Z') });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items).toHaveLength(0);
  });

  it('does not create a second cron run for the same workflow within the same minute (idempotency)', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'fast-tick',
      dag: validDag(),
      cronExpression: '* * * * *',
    });

    const fixedNow = () => new Date('2026-07-16T03:27:00Z');
    await runCronTick({ logger: silentLogger, now: fixedNow });
    await runCronTick({ logger: silentLogger, now: fixedNow }); // simulates two ticks landing in the same minute

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items).toHaveLength(1);
  });

  it('triggers again once the minute bucket advances', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'every-minute',
      dag: validDag(),
      cronExpression: '* * * * *',
    });

    await runCronTick({ logger: silentLogger, now: () => new Date('2026-07-16T03:27:00Z') });
    await runCronTick({ logger: silentLogger, now: () => new Date('2026-07-16T03:28:00Z') });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items.filter((r) => r.triggerType === 'cron')).toHaveLength(2);
  });

  it('skips a soft-deleted workflow even if it still carries a cron_expression', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'deleted-but-scheduled',
      dag: validDag(),
      cronExpression: '* * * * *',
    });
    await db.update(workflowDefinitions).set({ deletedAt: new Date() }).where(eq(workflowDefinitions.id, definition.id));

    await runCronTick({ logger: silentLogger });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items).toHaveLength(0);
  });

  it('one workflow failing to start (no current version) does not stop the tick from evaluating the rest', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const broken = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'no-current-version',
      dag: validDag(),
      cronExpression: '* * * * *',
    });
    // startRun 409s on a workflow with no current_version_id — force that state directly.
    await db.update(workflowDefinitions).set({ currentVersionId: null }).where(eq(workflowDefinitions.id, broken.definition.id));

    const healthy = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'healthy',
      dag: validDag(),
      cronExpression: '* * * * *',
    });

    await runCronTick({ logger: silentLogger });

    const brokenRuns = await listRuns({ tenantId: tenant.id, workflowId: broken.definition.id, limit: 10 });
    const healthyRuns = await listRuns({ tenantId: tenant.id, workflowId: healthy.definition.id, limit: 10 });
    expect(brokenRuns.items).toHaveLength(0);
    expect(healthyRuns.items).toHaveLength(1);
  });
});

describe('startCronScheduler', () => {
  it('runs ticks on the configured interval until stopped', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition } = await createWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      name: 'interval-driven',
      dag: validDag(),
      cronExpression: '* * * * *',
    });

    await new Promise<void>((resolve) => {
      const scheduler = startCronScheduler({ logger: silentLogger, tickIntervalMs: 20 });
      setTimeout(() => {
        scheduler.stop();
        // give the last in-flight tick a moment to finish its DB write
        setTimeout(resolve, 100);
      }, 60);
    });

    const { items } = await listRuns({ tenantId: tenant.id, workflowId: definition.id, limit: 10 });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
