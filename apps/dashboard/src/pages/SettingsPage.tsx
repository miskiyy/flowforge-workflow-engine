import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createApiKey, listApiKeys, revokeApiKey, type ApiKey, type Role } from '../api/apiKeys.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/useAuth.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { DataTable } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorState } from '../components/ErrorState.js';
import { PageIntro } from '../components/PageIntro.js';
import { Skeleton } from '../components/Skeleton.js';
import { useToast } from '../components/Toast.js';

const KEY_ROLES: Role[] = ['viewer', 'editor', 'admin'];

export function SettingsPage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [label, setLabel] = useState('');
  const [role, setRole] = useState<Role>('editor');
  // Shown once, right after creation — the only time the plaintext secret exists client-side.
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: () => listApiKeys(token!),
    enabled: token !== null && isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: () => createApiKey(token!, { label: label.trim(), role }),
    onSuccess: (result) => {
      setFreshSecret(result.secret);
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Failed to create key'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiKey(token!, id),
    onSuccess: () => {
      showToast('API key revoked');
      void queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Failed to revoke key'),
  });

  if (!isAdmin) {
    return (
      <div>
        <PageIntro title="Settings" description="API keys for this workspace." />
        <EmptyState title="Admins only" description="Only the admin role can view and manage this workspace's API keys." />
      </div>
    );
  }

  return (
    <div>
      <PageIntro
        title="Settings"
        description="Per-tenant API keys let external systems authenticate as this workspace — the same access a user has, without a login."
      />

      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Create an API key</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (label.trim()) createMutation.mutate();
          }}
          style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-sm)' }}>Label</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. ci-deploy"
              aria-label="API key label"
              style={{ padding: 'var(--space-2)' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-sm)' }}>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="API key role" style={{ padding: 'var(--space-2)' }}>
              {KEY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary" disabled={!label.trim() || createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Generate key'}
          </button>
        </form>

        {freshSecret ? (
          <div
            data-testid="fresh-secret"
            style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--accent-subtle-border)', borderRadius: 8, background: 'var(--accent-subtle)' }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Copy this key now — it won't be shown again.</p>
            <code style={{ display: 'block', margin: 'var(--space-2) 0', wordBreak: 'break-all' }}>{freshSecret}</code>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(freshSecret);
                  showToast('Copied to clipboard');
                }}
              >
                Copy
              </button>
              <button type="button" onClick={() => setFreshSecret(null)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <h2 style={{ fontSize: 'var(--text-lg)' }}>Active keys</h2>
      {isPending ? (
        <Skeleton rows={3} />
      ) : isError ? (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load API keys.'} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No API keys yet" description="Generate one above to let a script or service call the API as this workspace." />
      ) : (
        <DataTable
          rowKey={(row) => row.id}
          rows={data.items}
          columns={[
            { key: 'label', header: 'Label', cell: (row) => row.label },
            { key: 'prefix', header: 'Key', cell: (row) => <code>{row.prefix}…</code> },
            { key: 'role', header: 'Role', cell: (row) => row.role },
            { key: 'lastUsed', header: 'Last used', cell: (row) => (row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : 'Never') },
            {
              key: 'actions',
              header: 'Actions',
              cell: (row) => (
                <button type="button" onClick={() => setPendingRevoke(row)} disabled={revokeMutation.isPending}>
                  Revoke
                </button>
              ),
            },
          ]}
        />
      )}

      {pendingRevoke ? (
        <ConfirmDialog
          title={`Revoke "${pendingRevoke.label}"?`}
          description="Any system using this key will immediately lose access. This can't be undone."
          confirmLabel="Revoke"
          onConfirm={() => {
            revokeMutation.mutate(pendingRevoke.id);
            setPendingRevoke(null);
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      ) : null}
    </div>
  );
}
