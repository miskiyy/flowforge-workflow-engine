import type { DagStepDefinition, WorkflowDagDefinition } from '@flowforge/shared-types';

export interface ModifiedStep {
  key: string;
  fields: string[];
}

export interface DagDiff {
  added: string[];
  removed: string[];
  modified: ModifiedStep[];
  unchanged: string[];
}

/** Deep-equal via JSON — safe here because DAG steps are plain JSON-shaped data (no Date/function/undefined-hole fields). */
function fieldsThatDiffer(a: DagStepDefinition, b: DagStepDefinition): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differing: string[] = [];
  for (const key of keys) {
    if (key === 'key') continue; // identity, not a reportable field change
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (JSON.stringify(av) !== JSON.stringify(bv)) differing.push(key);
  }
  return differing.sort();
}

/**
 * Pure: base -> proposed, keyed by step `key` (not array position, so
 * reordering steps is never reported as a change). `base === null` is the
 * greenfield case — every proposed step is "added".
 */
export function diffDag(base: WorkflowDagDefinition | null, proposed: WorkflowDagDefinition): DagDiff {
  const baseSteps = new Map((base?.steps ?? []).map((step) => [step.key, step]));
  const proposedSteps = new Map(proposed.steps.map((step) => [step.key, step]));

  const added: string[] = [];
  const modified: ModifiedStep[] = [];
  const unchanged: string[] = [];

  for (const [key, proposedStep] of proposedSteps) {
    const baseStep = baseSteps.get(key);
    if (!baseStep) {
      added.push(key);
      continue;
    }
    const fields = fieldsThatDiffer(baseStep, proposedStep);
    if (fields.length > 0) modified.push({ key, fields });
    else unchanged.push(key);
  }

  const removed = [...baseSteps.keys()].filter((key) => !proposedSteps.has(key));

  return {
    added: added.sort(),
    removed: removed.sort(),
    modified: modified.sort((a, b) => a.key.localeCompare(b.key)),
    unchanged: unchanged.sort(),
  };
}
