import { apiFetch } from './client.js';
import type { Role } from './apiKeys.js';

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  role: Role;
}

export function listMyTenants(token: string): Promise<{ tenants: TenantMembership[] }> {
  return apiFetch('/me/tenants', { token });
}

export function switchTenant(token: string, tenantId: string): Promise<{ accessToken: string }> {
  return apiFetch('/auth/switch-tenant', { token, method: 'POST', body: { tenantId } });
}
