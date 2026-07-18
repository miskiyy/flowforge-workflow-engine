import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { DataTable } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorState } from '../components/ErrorState.js';
import { PageIntro } from '../components/PageIntro.js';
import { Skeleton } from '../components/Skeleton.js';
import { useRuns } from '../hooks/useRuns.js';
import { useStats } from '../hooks/useStats.js';
import { Stat, formatDuration as formatStatsDuration } from '../components/Stat.js';
import type { RunDisplayStatus } from '../realtime/types.js';

const STATUS_OPTIONS: RunDisplayStatus[] = ['pending', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'];
const PAGE_LIMIT = 20;

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Filters and pagination live in the URL (not component state) — shareable and back-button correct, per this phase's DoD. */
export function RunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status');
  const workflowId = searchParams.get('workflowId');
  const cursor = searchParams.get('cursor');

  const query = useMemo(
    () => ({
      limit: PAGE_LIMIT,
      ...(status ? { status: status as RunDisplayStatus } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    [status, workflowId, cursor],
  );

  const { data, isPending, isError, error, refetch } = useRuns(query);
  const statsQuery = useStats();

  function updateFilter(key: 'status' | 'workflowId', value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    setSearchParams(next);
  }

  function goNext() {
    if (!data?.nextCursor) return;
    const next = new URLSearchParams(searchParams);
    next.set('cursor', data.nextCursor);
    setSearchParams(next);
  }

  const stats = statsQuery.data;

  return (
    <div>
      <PageIntro title="History" description="Execution history and health across every workflow, filterable by status and workflow." />

      {/* Merged Health Stats Grid */}
      {stats !== undefined && (
        <div
          data-testid="stats-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <Stat label="Active runs" value={String(stats.activeRuns)} hint="pending or running right now" />
          <Stat
            label="Runs finished (24h)"
            value={String(stats.last24h.total)}
            hint={`${stats.last24h.succeeded} succeeded · ${stats.last24h.failed} failed`}
          />
          <Stat
            label="Success rate (24h)"
            value={stats.last24h.successRate === null ? '—' : `${Math.round(stats.last24h.successRate * 100)}%`}
            {...(stats.last24h.successRate === null ? { hint: 'no finished runs in the window yet' } : {})}
          />
          <Stat
            label="Avg run duration (24h)"
            value={stats.last24h.avgDurationMs === null ? '—' : formatStatsDuration(stats.last24h.avgDurationMs)}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <label>
          Status{' '}
          <select aria-label="Filter by status" value={status ?? ''} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workflow ID{' '}
          <input
            aria-label="Filter by workflow ID"
            defaultValue={workflowId ?? ''}
            onBlur={(event) => updateFilter('workflowId', event.target.value)}
          />
        </label>
      </div>

      {isPending ? (
        <Skeleton rows={5} />
      ) : isError ? (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load runs.'} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No runs yet" description="Trigger a workflow to see its execution history here." />
      ) : (
        <>
          <DataTable
            rowKey={(row) => row.id}
            rows={data.items}
            columns={[
              { key: 'status', header: 'Status', cell: (row) => <span data-status={row.status}>{row.status}</span> },
              { key: 'workflow', header: 'Workflow', cell: (row) => row.workflowId },
              { key: 'trigger', header: 'Trigger', cell: (row) => row.triggerType },
              { key: 'started', header: 'Started', cell: (row) => (row.startedAt ? new Date(row.startedAt).toLocaleString() : '—') },
              { key: 'duration', header: 'Duration', cell: (row) => formatDuration(row.startedAt, row.finishedAt) },
              { key: 'actions', header: '', cell: (row) => <Link to={`/runs/${row.id}`}>View</Link> },
            ]}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={() => navigate(-1)} disabled={!cursor}>
              Previous
            </button>
            <button type="button" onClick={goNext} disabled={!data.nextCursor}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
