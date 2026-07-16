import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { apiFetch } from './client.js';

/** Mirrors apps/api/src/ai/diff.ts — duplicated per the realtime/types.ts convention (separate deployables). */
export interface DagDiffModifiedStep {
  key: string;
  fields: string[];
}

export interface DagDiff {
  added: string[];
  removed: string[];
  modified: DagDiffModifiedStep[];
  unchanged: string[];
}

export interface ProposeResult {
  proposedDag: WorkflowDagDefinition;
  diff: DagDiff;
  warnings: { path: string; message: string }[];
  meta: {
    model: string;
    attempts: number;
    cached: boolean;
    usage: { promptTokens: number; completionTokens: number };
  };
}

export interface ProposeInput {
  /** A workflow UUID, or the literal 'new' for a greenfield proposal. */
  workflowId: string;
  prompt: string;
  /** Required unless workflowId === 'new' — enforced server-side. */
  baseVersionId?: string;
}

/** POST /workflows/:id/propose — persists nothing; the AI cannot write (§8). */
export function proposeWorkflow(token: string, input: ProposeInput): Promise<ProposeResult> {
  const { workflowId, ...body } = input;
  return apiFetch(`/workflows/${workflowId}/propose`, { token, method: 'POST', body });
}
