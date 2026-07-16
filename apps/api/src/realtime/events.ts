/**
 * Realtime wire contract — pure types + serialization, no socket/DB import
 * here so this stays unit-testable without a live connection.
 */
export const REALTIME_EVENT_TYPES = [
  'execution.started',
  'step.queued',
  'step.running',
  'step.succeeded',
  'step.failed',
  'execution.completed',
  'execution.cancelled',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEvent {
  type: RealtimeEventType;
  runId: string;
  tenantId: string;
  /** Monotonic per-run counter assigned at publish time, so clients can detect a dropped message. */
  seq: number;
  ts: string;
  stepKey?: string;
  attemptNumber?: number;
  error?: string;
}

export function serializeEvent(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

/**
 * Translates the execution engine's structured log events (see
 * ExecutionLogger in execution/executor.ts) into the realtime wire vocabulary.
 * Only the seven events Phase 4.1 is scoped to publish are mapped — engine
 * events with no realtime meaning (step.retrying, step.attempt_failed,
 * step.skipped) return null and are simply not pushed.
 */
export function mapLogEventToRealtimeEvent(
  event: string,
  fields: Record<string, unknown>,
): Omit<RealtimeEvent, 'seq' | 'ts'> | null {
  const runId = fields.runId as string;
  const tenantId = fields.tenantId as string;

  switch (event) {
    case 'run.started':
      return { type: 'execution.started', runId, tenantId };
    case 'step.queued':
      return { type: 'step.queued', runId, tenantId, stepKey: fields.stepKey as string };
    case 'step.running':
      return {
        type: 'step.running',
        runId,
        tenantId,
        stepKey: fields.stepKey as string,
        attemptNumber: fields.attempt as number,
      };
    case 'step.succeeded':
      return {
        type: 'step.succeeded',
        runId,
        tenantId,
        stepKey: fields.stepKey as string,
        attemptNumber: fields.attempt as number,
      };
    case 'step.failed':
      return {
        type: 'step.failed',
        runId,
        tenantId,
        stepKey: fields.stepKey as string,
        error: fields.error as string,
      };
    case 'run.finished':
      return { type: fields.status === 'cancelled' ? 'execution.cancelled' : 'execution.completed', runId, tenantId };
    default:
      return null;
  }
}
