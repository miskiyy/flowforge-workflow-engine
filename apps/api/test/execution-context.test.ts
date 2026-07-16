import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import { buildExecutionContext } from '../src/execution/context.js';
import { cyclicDag, validDag } from './fixtures.js';

describe('buildExecutionContext', () => {
  it('bundles run metadata with the dag execution plan', () => {
    const context = buildExecutionContext({
      runId: 'run-1',
      tenantId: 'tenant-1',
      workflowVersionId: 'version-1',
      status: 'pending',
      dag: validDag() as WorkflowDagDefinition,
    });

    expect(context.runId).toBe('run-1');
    expect(context.status).toBe('pending');
    expect(context.plan.order).toEqual(['a', 'b']);
    expect(context.plan.levels).toEqual([['a'], ['b']]);
  });

  it('throws on a stored dag that fails validation (data integrity, not user error)', () => {
    expect(() =>
      buildExecutionContext({
        runId: 'run-1',
        tenantId: 'tenant-1',
        workflowVersionId: 'version-1',
        status: 'pending',
        dag: cyclicDag as WorkflowDagDefinition,
      }),
    ).toThrow(/invalid dag/);
  });
});
