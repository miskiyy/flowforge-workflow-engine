import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client.js';
import { listMyTenants, switchTenant } from '../api/tenants.js';
import { useAuth } from '../auth/useAuth.js';
import { useToast } from './Toast.js';

/**
 * Org switcher — lists the tenants the user is a member of and swaps the active
 * token for the chosen one. Hidden when the user belongs to a single tenant, so
 * it costs nothing visually until multi-tenancy is actually in play.
 */
export function TenantSwitcher() {
  const { token, user, applyToken } = useAuth();
  const { showToast } = useToast();

  const { data } = useQuery({
    queryKey: ['myTenants'],
    queryFn: () => listMyTenants(token!),
    enabled: token !== null,
  });

  const switchMutation = useMutation({
    mutationFn: (tenantId: string) => switchTenant(token!, tenantId),
    onSuccess: (result) => {
      applyToken(result.accessToken); // persists the new-tenant token to localStorage
      // Hard reload rather than invalidateQueries: every cached query is scoped
      // to the old tenant, and a soft refetch races the token state update
      // (queryFn closes over the pre-switch token). A full remount reads the new
      // token from localStorage and refetches everything cleanly — the standard
      // "switch workspace = clean slate" pattern.
      window.location.assign('/overview');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Failed to switch workspace'),
  });

  const tenants = data?.tenants ?? [];
  if (tenants.length < 2) return null;

  return (
    <label style={{ display: 'block', padding: '0 var(--space-2)', marginBottom: 'var(--space-2)' }}>
      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', marginBottom: 2 }}>Workspace</span>
      <select
        aria-label="Switch workspace"
        value={user?.tenantId ?? ''}
        disabled={switchMutation.isPending}
        onChange={(event) => {
          if (event.target.value !== user?.tenantId) switchMutation.mutate(event.target.value);
        }}
        style={{ width: '100%', padding: 'var(--space-2)' }}
      >
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId}>
            {t.tenantName}
          </option>
        ))}
      </select>
    </label>
  );
}
