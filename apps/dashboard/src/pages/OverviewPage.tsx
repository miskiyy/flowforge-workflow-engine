import { Link } from 'react-router-dom';
import type { RunSummary } from '../api/runs.js';
import { ActionCard } from '../components/ActionCard.js';
import { IconEdit, IconGrid, IconSparkle } from '../components/icons.js';
import { formatDuration, Stat } from '../components/Stat.js';
import type { RunDisplayStatus } from '../realtime/types.js';
import { useRuns } from '../hooks/useRuns.js';
import { useStats } from '../hooks/useStats.js';
import { useWorkflows } from '../hooks/useWorkflows.js';

const RUN_STATUS_COLOR: Record<RunDisplayStatus, string> = {
  pending: 'var(--status-pending)',
  running: 'var(--status-running)',
  succeeded: 'var(--status-succeeded)',
  failed: 'var(--status-failed)',
  timed_out: 'var(--status-failed)',
  cancelled: 'var(--status-skipped)',
};

const ONBOARDING_STEPS = [
  { title: 'Browse an example', description: 'Open a seeded workflow — try fan-out — to see a real DAG.' },
  { title: 'Trigger it', description: 'Press Trigger. The run starts and you jump straight to the live view.' },
  { title: 'Watch it run', description: 'The graph lights up as each step runs, with a live timeline beside it.' },
  { title: 'Generate with AI', description: 'Describe a workflow in a sentence and review the draft before saving.' },
];

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function RecentRuns({ runs, nameById }: { runs: RunSummary[]; nameById: Map<string, string> }) {
  if (runs.length === 0) {
    return (
      <p data-testid="recent-runs-empty" style={{ color: 'var(--ink-mut)' }}>
        No runs yet. Open an example workflow and trigger it to see runs here.
      </p>
    );
  }
  return (
    <ul data-testid="recent-runs" className="card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {runs.map((run, index) => (
        <li
          key={run.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            borderTop: index === 0 ? 'none' : '1px solid var(--border)',
          }}
        >
          <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            {nameById.get(run.workflowId) ?? run.workflowId.slice(0, 8)}
          </span>
          <span style={{ color: RUN_STATUS_COLOR[run.status], fontSize: 'var(--text-sm)' }}>{run.status}</span>
          <span style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>{relativeTime(run.createdAt)}</span>
          <Link to={`/runs/${run.id}`}>{run.status === 'running' || run.status === 'pending' ? 'Watch' : 'Open'}</Link>
        </li>
      ))}
    </ul>
  );
}

/** Post-login landing: orient the user, then route them to the three primary actions (frontend-ux-revision.md §6). */
export function OverviewPage() {
  const runsQuery = useRuns({ limit: 5 });
  const workflowsQuery = useWorkflows({ limit: 100 });
  const statsQuery = useStats();

  const nameById = new Map((workflowsQuery.data?.items ?? []).map((workflow) => [workflow.id, workflow.name]));
  const stats = statsQuery.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: '0 var(--space-4)' }}>
      {/* Hero Welcome banner */}
      <div className="grid-bg" style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-8) var(--space-6)', border: '1px solid var(--border)', background: 'radial-gradient(circle at 10% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 60%)' }}>
        <h1 tabIndex={-1} style={{ fontSize: '32px', fontWeight: 'bold', margin: '0 0 var(--space-2)', color: '#fff', letterSpacing: '-0.02em' }}>Build, run, and watch workflows</h1>
        <p style={{ color: 'var(--ink-mut)', margin: 0, maxWidth: '72ch', fontSize: '15px', lineHeight: 1.6 }}>
          Compose steps into a DAG, execute them, and watch each step run live. Describe what you want in plain English and FlowForge drafts the workflow — you review every change before it's saved.
        </p>
      </div>

      {/* Fleet Stats (if available) */}
      {stats ? (
        <div
          data-testid="fleet-stats"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-4)',
          }}
        >
          <Stat label="Active runs" value={String(stats.activeRuns)} hint="pending or running right now" />
          <Stat
            label="Success rate (24h)"
            value={stats.last24h.successRate === null ? '—' : `${Math.round(stats.last24h.successRate * 100)}%`}
          />
          <Stat
            label="Avg duration (24h)"
            value={stats.last24h.avgDurationMs === null ? '—' : formatDuration(stats.last24h.avgDurationMs)}
          />
        </div>
      ) : null}

      {/* Primary Actions Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--space-4)',
        }}
      >
        <ActionCard
          primary
          icon={IconSparkle}
          title="Generate with AI"
          description="Describe what you want; review the draft — added, removed, and changed steps — before saving."
          to="/workflows/new?mode=ai"
          cta="Generate"
        />
        <ActionCard
          icon={IconEdit}
          title="Create manually"
          description="Author the DAG manually as JSON with an inline step reference."
          to="/workflows/new"
          cta="New"
        />
        <ActionCard
          icon={IconGrid}
          title="Browse examples"
          description="Open a seeded workflow, run it, and watch it execute live."
          to="/workflows"
          cta="Examples"
        />
      </div>

      {/* Grid of Onboarding & Recent Runs */}
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 4fr', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* New here? Try it in four steps */}
        <section
          aria-label="How to test FlowForge"
          className="card"
          style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <div>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: '0 0 var(--space-1)', color: '#fff' }}>New here? Try it in four steps</h2>
            <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)', margin: 0 }}>
              A round trip from example to live run takes under a minute.
            </p>
          </div>

          <ol
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step.title} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'rgba(37, 99, 235, 0.1)',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    color: 'var(--accent)',
                    fontWeight: 'bold',
                    fontSize: 'var(--text-xs)',
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: '#fff' }}>{step.title}</div>
                  <div style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)', marginTop: '2px', lineHeight: 1.4 }}>{step.description}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Recent Runs */}
        <section aria-label="Recent runs">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0, color: '#fff' }}>Recent Runs</h2>
            <Link to="/runs" style={{ fontSize: 'var(--text-xs)' }}>View all</Link>
          </div>
          {runsQuery.isError ? (
            <p style={{ color: 'var(--ink-mut)' }}>Couldn&apos;t load recent runs.</p>
          ) : (
            <RecentRuns runs={runsQuery.data?.items ?? []} nameById={nameById} />
          )}
        </section>
      </div>
    </div>
  );
}
