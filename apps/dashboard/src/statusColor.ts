import type { StepDisplayStatus } from './realtime/types.js';

/**
 * Single source of truth for step status -> color, shared by StatusBadge and
 * WorkflowGraph so a node's badge and its graph fill never disagree.
 * `queued` (WS-only, not a persisted step_runs status) shares pending's
 * color in the graph — Task.md's node-coloring spec names five colors
 * (pending/running/succeeded/failed/skipped), not six. Mirrors the
 * `--status-*` tokens in tokens.css (kept in sync manually, same as the
 * API/dashboard type duplication elsewhere).
 *
 * Values corrected for WCAG AA (frontend-design.md §11): these are light
 * pastel fills (the dark theme's glow/status palette), so badge and graph
 * text pairs with them as dark ink (var(--bg)), not white — all five are
 * >=4.5:1 against a dark-ink foreground.
 */
export const STEP_STATUS_COLOR: Record<StepDisplayStatus, string> = {
  pending: '#8c909f',
  queued: '#8c909f',
  running: '#6d94ff',
  succeeded: '#4ade80',
  failed: '#ff7a7a',
  skipped: '#6b7280',
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
