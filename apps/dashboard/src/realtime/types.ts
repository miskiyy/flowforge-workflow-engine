/**
 * Mirrors the wire contract published by apps/api/src/realtime/events.ts.
 * Duplicated rather than imported from a shared package because the API and
 * dashboard are separate deployables and this is the only consumer; if a
 * third consumer shows up, promote this to packages/shared-types instead.
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
  seq: number;
  ts: string;
  stepKey?: string;
  attemptNumber?: number;
  error?: string;
}

/** Every state a step can be in on the dashboard, including the WS-only "queued" moment. */
export type StepDisplayStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StepState {
  stepKey: string;
  status: StepDisplayStatus;
  attemptNumber?: number;
  error?: string;
}

export type RunDisplayStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
