import { RUN_STATUSES, STEP_RUN_STATUSES } from '../db/schema.js';

/**
 * Pure run-status state machine (Phase 3.2) — independent of persistence and
 * of step execution. A future executor calls these to decide whether a
 * transition it wants to make is legal; nothing here touches the DB or runs
 * a step.
 */
export type RunStatus = (typeof RUN_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  // pending -> cancelled: a queued-but-unclaimed run can be cancelled outright
  // (execution/repository.ts#cancelRun) — it never needs to pass through
  // 'running' first since no step has been dispatched yet.
  pending: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};

export class InvalidRunTransitionError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`cannot transition run from "${from}" to "${to}"`);
  }
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws InvalidRunTransitionError if the transition isn't legal; a no-op otherwise. */
export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new InvalidRunTransitionError(from, to);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Pure step-status state machine. A step goes pending -> running ->
 * succeeded/failed, or pending -> skipped directly when the scheduler
 * determines a dependency already failed/skipped, or was never reached
 * because the run was cancelled — it never runs either way. On a failed
 * attempt with retries remaining (Phase 3.4), running -> retrying -> running
 * loops until either success, exhausted attempts, or cancellation.
 */
export type StepStatus = (typeof STEP_RUN_STATUSES)[number];

const ALLOWED_STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  pending: ['running', 'skipped'],
  running: ['succeeded', 'failed', 'retrying'],
  retrying: ['running'],
  succeeded: [],
  failed: [],
  skipped: [],
};

export class InvalidStepTransitionError extends Error {
  constructor(
    readonly from: StepStatus,
    readonly to: StepStatus,
  ) {
    super(`cannot transition step from "${from}" to "${to}"`);
  }
}

export function canTransitionStep(from: StepStatus, to: StepStatus): boolean {
  return ALLOWED_STEP_TRANSITIONS[from].includes(to);
}

export function assertStepTransition(from: StepStatus, to: StepStatus): void {
  if (!canTransitionStep(from, to)) throw new InvalidStepTransitionError(from, to);
}
