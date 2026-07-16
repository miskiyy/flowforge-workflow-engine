import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import type { RunDisplayStatus, StepDisplayStatus } from '../realtime/types.js';
import { apiFetch, toQueryString } from './client.js';
import type { Page } from './workflows.js';

export interface RunSnapshotStep {
  stepKey: string;
  status: StepDisplayStatus;
  attemptNumber: number;
  error: string | null;
}

export interface RunSnapshot {
  run: { id: string; status: RunDisplayStatus };
  steps: RunSnapshotStep[];
  dag: WorkflowDagDefinition;
}

/**
 * GET /runs/:id — the REST resync baseline used by useRunStream on initial
 * load, reconnect, and gap recovery. `apiUrl` stays an explicit parameter
 * (rather than the env-configured default) because useRunStream is unit
 * tested against an arbitrary origin.
 */
export function fetchRun(apiUrl: string, runId: string, token: string): Promise<RunSnapshot> {
  return apiFetch<RunSnapshot>(`/runs/${runId}`, { token, baseUrl: apiUrl });
}

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggerType: string;
  triggeredBy: string;
  status: RunDisplayStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface StepRunSummary {
  id: string;
  stepKey: string;
  attemptNumber: number;
  status: StepDisplayStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ListRunsQuery {
  cursor?: string;
  limit?: number;
  status?: RunDisplayStatus;
  workflowId?: string;
}

export function listRuns(token: string, query: ListRunsQuery = {}): Promise<Page<RunSummary>> {
  return apiFetch(`/runs${toQueryString(query)}`, { token });
}

export function triggerRun(token: string, workflowId: string): Promise<{ run: RunSummary; steps: StepRunSummary[] }> {
  return apiFetch(`/workflows/${workflowId}/trigger`, { token, method: 'POST' });
}

/** A pending run is cancelled immediately; a running one only requests cancellation — the run reaches 'cancelled' asynchronously (useRunStream picks up the transition over the WS). */
export function cancelRun(token: string, runId: string): Promise<{ run: RunSummary; cancelledImmediately: boolean }> {
  return apiFetch(`/runs/${runId}/cancel`, { token, method: 'POST' });
}

export interface StepLogLine {
  ts: string;
  level: string;
  message: string;
}

/** Per-step log lines (failed-attempt history) — step_logs only, the API never exposes step_runs.output. */
export function fetchStepLogs(
  apiUrl: string,
  runId: string,
  stepKey: string,
  token: string,
): Promise<{ items: StepLogLine[] }> {
  return apiFetch(`/runs/${runId}/steps/${encodeURIComponent(stepKey)}/logs`, { token, baseUrl: apiUrl });
}

export interface RunStats {
  activeRuns: number;
  last24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number | null;
  };
}

export function fetchStats(token: string): Promise<RunStats> {
  return apiFetch('/stats', { token });
}
