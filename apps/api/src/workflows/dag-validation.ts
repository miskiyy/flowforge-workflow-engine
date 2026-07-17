import { buildExecutionPlan, type DagValidationError } from '../engine/dag.js';

export type { DagValidationError };

export interface DagValidationResult {
  valid: boolean;
  errors: DagValidationError[];
}

/**
 * The single validation path for both manually-authored and (later,
 * Phase 5) LLM-generated DAGs. Delegates to the pure engine (schema shape,
 * duplicate/unknown/self dependency checks, Kahn's-algorithm cycle
 * detection) and discards the execution order this call site doesn't need.
 */
export function validateDag(input: unknown): DagValidationResult {
  const result = buildExecutionPlan(input);
  return result.valid ? { valid: true, errors: [] } : { valid: false, errors: result.errors };
}
