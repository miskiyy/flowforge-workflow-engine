import { apiFetch } from './client.js';

export type Role = 'admin' | 'editor' | 'viewer';

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  role: Role;
  createdAt: string;
  lastUsedAt: string | null;
}

export function listApiKeys(token: string): Promise<{ items: ApiKey[] }> {
  return apiFetch('/api-keys', { token });
}

/** `secret` is the full `ff_...` token — present exactly once, here. Store it now; it can never be fetched again. */
export function createApiKey(token: string, input: { label: string; role?: Role }): Promise<{ apiKey: ApiKey; secret: string }> {
  return apiFetch('/api-keys', { token, method: 'POST', body: input });
}

export function revokeApiKey(token: string, id: string): Promise<void> {
  return apiFetch(`/api-keys/${id}`, { token, method: 'DELETE' });
}
