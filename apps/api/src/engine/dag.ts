import { Ajv } from 'ajv';
import * as ajvFormats from 'ajv-formats';
import { WorkflowDagDefinition, type DagStepDefinition } from '@flowforge/shared-types';

/**
 * Pure, framework-free DAG engine (Phase 3.1): JSON -> validated in-memory
 * graph -> deterministic execution order. No execution/dispatch logic here —
 * this only decides *what order* steps could run in, not running them.
 */

// ajv-formats ships a nested copy of ajv's types for its peer dependency, so
// its default export's declared type doesn't structurally match the `Ajv` we
// import above — cast to the call signature we actually use (same workaround
// as packages/shared-types/src/dag.test.ts).
const addFormats = ajvFormats.default as unknown as (instance: Ajv) => Ajv;
const ajv = addFormats(new Ajv({ allErrors: true }));
const validateSchema = ajv.compile(WorkflowDagDefinition);

export interface DagValidationError {
  path: string;
  message: string;
}

/** Adjacency built from a structurally-valid DAG: step lookup + forward edges (dep -> dependents). */
export interface DagGraph {
  steps: ReadonlyMap<string, DagStepDefinition>;
  dependents: ReadonlyMap<string, readonly string[]>;
}

export type DagParseResult = { valid: true; graph: DagGraph } | { valid: false; errors: DagValidationError[] };

/**
 * JSON -> in-memory graph. Checks the shape (JSON schema) then the rules a
 * schema can't express: duplicate step keys, self-deps, and deps that don't
 * reference a real step. Returns specific, field-pathed errors on failure.
 */
export function parseDag(input: unknown): DagParseResult {
  if (!validateSchema(input)) {
    const errors = (validateSchema.errors ?? []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'invalid',
    }));
    return { valid: false, errors };
  }

  const dag = input as WorkflowDagDefinition;
  const errors: DagValidationError[] = [];
  const steps = new Map<string, DagStepDefinition>();

  for (const step of dag.steps) {
    if (steps.has(step.key)) {
      errors.push({ path: `/steps/${step.key}`, message: `duplicate step key: ${step.key}` });
    }
    steps.set(step.key, step);
  }

  const dependents = new Map<string, string[]>();
  for (const step of dag.steps) {
    for (const dep of step.dependsOn) {
      if (dep === step.key) {
        errors.push({
          path: `/steps/${step.key}/dependsOn`,
          message: `step cannot depend on itself: ${step.key}`,
        });
      } else if (!steps.has(dep)) {
        errors.push({
          path: `/steps/${step.key}/dependsOn`,
          message: `unknown dependency "${dep}" referenced by step "${step.key}"`,
        });
      } else {
        dependents.set(dep, [...(dependents.get(dep) ?? []), step.key]);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, graph: { steps, dependents } };
}

export interface DagExecutionOrder {
  /** Deterministic flattened topological order (steps sorted by key within each level). */
  order: string[];
  /** Steps grouped into levels: each level's steps have all deps satisfied by earlier levels. */
  levels: string[][];
}

export type TopoSortResult =
  | ({ valid: true } & DagExecutionOrder)
  | { valid: false; errors: DagValidationError[]; cycle: string[] };

/**
 * Kahn's algorithm (in-degree based, not recursive DFS) so a cycle reports
 * the offending step keys instead of stack-overflowing. Processes the graph
 * one full "ready" batch (level) at a time, which doubles as the concurrent-
 * execution grouping — steps in the same level share no dependency edge.
 * Ties within a level are broken by step key for deterministic output.
 */
export function topoSort(graph: DagGraph): TopoSortResult {
  const inDegree = new Map<string, number>();
  for (const [key, step] of graph.steps) inDegree.set(key, step.dependsOn.length);

  const order: string[] = [];
  const levels: string[][] = [];
  let ready = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([key]) => key).sort();

  while (ready.length > 0) {
    levels.push(ready);
    order.push(...ready);

    const next = new Set<string>();
    for (const key of ready) {
      for (const dependent of graph.dependents.get(key) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.add(dependent);
      }
    }
    ready = [...next].sort();
  }

  if (order.length < graph.steps.size) {
    const cycle = [...graph.steps.keys()].filter((key) => !order.includes(key)).sort();
    return {
      valid: false,
      cycle,
      errors: [{ path: '/steps', message: `cycle detected among steps: ${cycle.join(' -> ')}` }],
    };
  }

  return { valid: true, order, levels };
}

export type DagBuildResult =
  | ({ valid: true } & DagExecutionOrder)
  | { valid: false; errors: DagValidationError[] };

/** Convenience entry point: raw JSON -> validated, cycle-free, deterministically ordered plan. */
export function buildExecutionPlan(input: unknown): DagBuildResult {
  const parsed = parseDag(input);
  if (!parsed.valid) return parsed;

  const sorted = topoSort(parsed.graph);
  if (!sorted.valid) return { valid: false, errors: sorted.errors };

  return { valid: true, order: sorted.order, levels: sorted.levels };
}
