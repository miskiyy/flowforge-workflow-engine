import { ErrorState } from '../components/ErrorState.js';
import { PageIntro } from '../components/PageIntro.js';
import { formatDuration, Stat } from '../components/Stat.js';
import { useStats } from '../hooks/useStats.js';

/** The global health panel (P10) — one server-side aggregate (GET /stats), polled, never computed by paginating /runs in the browser. */
export function HealthPage() {
  const statsQuery = useStats();

  if (statsQuery.isError) {
    return (
      <div>
        <PageIntro title="Health" />
        <ErrorState message="Couldn't load execution stats." onRetry={() => void statsQuery.refetch()} />
      </div>
    );
  }

  const stats = statsQuery.data;

  return (
    <div>
      <PageIntro
        title="Health"
        description="Execution health for your tenant: what's running now, and outcomes over the last 24 hours."
      />
      {stats === undefined ? (
        <p data-testid="stats-loading" style={{ color: 'var(--ink-mut)' }}>
          Loading stats…
        </p>
      ) : (
        <div
          data-testid="stats-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-4)',
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
            value={stats.last24h.avgDurationMs === null ? '—' : formatDuration(stats.last24h.avgDurationMs)}
          />
        </div>
      )}
    </div>
  );
}
