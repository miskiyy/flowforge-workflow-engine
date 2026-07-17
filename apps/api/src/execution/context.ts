import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { buildExecutionPlan, type DagExecutionOrder } from '../engine/dag.js';
import type { RunStatus } from './lifecycle.js';

/**
 * The read-only bundle a future executor (Phase 3.3+) needs to run a run:
 * which steps, in what order, for which run/tenant/version. Building it is
 * pure — no DB write, no step dispatch — so the executor can be handed a
 * plain object instead of reaching back into the repository itself.
 */
export interface ExecutionContext {
  runId: string;
  tenantId: string;
  workflowVersionId: string;
  status: RunStatus;
  dag: WorkflowDagDefinition;
  plan: DagExecutionOrder;
}

export interface BuildExecutionContextInput {
  runId: string;
  tenantId: string;
  workflowVersionId: string;
  status: RunStatus;
  dag: WorkflowDagDefinition;
}

/**
 * A stored workflow version's dag already passed validation at write time
 * (dag-validation.ts), so a rejection here means stored data is corrupt —
 * that's a programmer/data-integrity error, not a user input one.
 */
export function buildExecutionContext(input: BuildExecutionContextInput): ExecutionContext {
  const plan = buildExecutionPlan(input.dag);
  if (!plan.valid) {
    throw new Error(
      `stored workflow version ${input.workflowVersionId} has an invalid dag: ${plan.errors
        .map((e) => e.message)
        .join('; ')}`,
    );
  }

  return {
    runId: input.runId,
    tenantId: input.tenantId,
    workflowVersionId: input.workflowVersionId,
    status: input.status,
    dag: input.dag,
    plan: { order: plan.order, levels: plan.levels },
  };
}
