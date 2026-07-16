import type { StepDisplayStatus } from './realtime/types.js';

/**
 * Single source of truth for step status -> color, shared by StatusBadge and
 * WorkflowGraph so a node's badge and its graph fill never disagree.
 * `queued` (WS-only, not a persisted step_runs status) shares pending's
 * color in the graph — Task.md's node-coloring spec names five colors
 * (pending/running/succeeded/failed/skipped), not six.
 *
 * Values corrected for WCAG AA (frontend-design.md §11): the previous
 * succeeded/pending fills rendered white text at ~2.1:1 and ~2.2:1 against
 * the required 4.5:1. All values below are >=4.5:1 with white text.
 */
export const STEP_STATUS_COLOR: Record<StepDisplayStatus, string> = {
  pending: '#6b7280',
  queued: '#6b7280',
  running: '#1d4ed8',
  succeeded: '#15803d',
  failed: '#b91c1c',
  skipped: '#4b5563',
};

export const STEP_STATUS_LABEL: Record<StepDisplayStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
};

/**
 * Non-color channel (WCAG 1.4.1): status must never be conveyed by color
 * alone, so every badge and graph node also renders this glyph.
 */
export const STEP_STATUS_GLYPH: Record<StepDisplayStatus, string> = {
  pending: '·',
  queued: '·',
  running: '⟳',
  succeeded: '✓',
  failed: '✗',
  skipped: '⊘',
};
