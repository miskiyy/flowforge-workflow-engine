import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { apiFetch, toQueryString } from './client.js';

export interface WorkflowDefinition {
  id: string;
  name: string;
  currentVersionId: string | null;
  cronExpression: string | null;
  createdAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  dag: WorkflowDagDefinition;
  createdBy: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListWorkflowsQuery {
  cursor?: string;
  limit?: number;
  name?: string;
  sort?: 'createdAt_asc' | 'createdAt_desc';
}

export function listWorkflows(token: string, query: ListWorkflowsQuery = {}): Promise<Page<WorkflowDefinition>> {
  return apiFetch(`/workflows${toQueryString(query)}`, { token });
}

export function getWorkflow(token: string, id: string): Promise<{ workflow: WorkflowDefinition; version: WorkflowVersion | null }> {
  return apiFetch(`/workflows/${id}`, { token });
}

export function listVersions(
  token: string,
  workflowId: string,
  query: { cursor?: string; limit?: number } = {},
): Promise<Page<WorkflowVersion>> {
  return apiFetch(`/workflows/${workflowId}/versions${toQueryString(query)}`, { token });
}

export interface CreateWorkflowInput {
  name: string;
  dag: WorkflowDagDefinition;
  cronExpression?: string;
}

export function createWorkflow(
  token: string,
  input: CreateWorkflowInput,
): Promise<{ workflow: WorkflowDefinition; version: WorkflowVersion }> {
  return apiFetch('/workflows', { token, method: 'POST', body: input });
}

export interface UpdateWorkflowInput {
  name?: string;
  dag?: WorkflowDagDefinition;
  /** Optimistic-concurrency token — omit for a blind overwrite, include to get a 409 BASE_VERSION_STALE on conflict (§7). */
  baseVersionId?: string;
  /** Omit to leave unchanged; null clears the schedule (PATCH /workflows/:id accepts both). */
  cronExpression?: string | null;
}

export function updateWorkflow(
  token: string,
  id: string,
  input: UpdateWorkflowInput,
): Promise<{ workflow: WorkflowDefinition; version: WorkflowVersion | null }> {
  return apiFetch(`/workflows/${id}`, { token, method: 'PATCH', body: input });
}

export function rollbackWorkflow(
  token: string,
  id: string,
  versionId: string,
): Promise<{ workflow: WorkflowDefinition; version: WorkflowVersion }> {
  return apiFetch(`/workflows/${id}/rollback/${versionId}`, { token, method: 'POST' });
}

export function deleteWorkflow(token: string, id: string): Promise<void> {
  return apiFetch(`/workflows/${id}`, { token, method: 'DELETE' });
}
