import { Link } from 'react-router-dom';
import type { RunSummary } from '../api/runs.js';
import { ActionCard } from '../components/ActionCard.js';
import { IconEdit, IconGrid, IconSparkle } from '../components/icons.js';
import { PageIntro } from '../components/PageIntro.js';
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
    <div>
      <div className="grid-bg" style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', margin: '0 0 var(--space-4)' }}>
        <PageIntro
          title="Build, run, and watch workflows"
          description="Compose steps into a DAG, execute them, and watch each step run live. Describe what you want in plain English and FlowForge drafts the workflow — you review every change before it's saved."
        />

        <ActionCard
          primary
          icon={IconSparkle}
          title="Generate with AI"
          description="Describe what you want; review the draft — added, removed, and changed steps — before saving."
          to="/workflows/new?mode=ai"
          cta="Generate"
        />
      </div>

      {stats ? (
        <div
          data-testid="fleet-stats"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-8)',
        }}
      >
        <ActionCard
          icon={IconEdit}
          title="Create manually"
          description="Author the DAG as JSON with an inline step reference."
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

      <section
        aria-label="How to test FlowForge"
        className="card"
        style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-8)' }}
      >
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: '0 0 var(--space-1)' }}>New here? Try it in four steps</h2>
        <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-6)' }}>
          A round trip from example to live run takes under a minute.
        </p>
        <ol
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--space-4)',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          <li aria-hidden="true" style={{ position: 'absolute', top: 17, left: '12.5%', right: '12.5%', height: 2, background: 'var(--border)' }} />
          {ONBOARDING_STEPS.map((step, index) => (
            <li key={step.title} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--bg)',
                  border: '2px solid var(--accent-subtle-border)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                }}
              >
                {index + 1}
              </span>
              <p style={{ fontWeight: 600, fontSize: 'var(--text-sm)', margin: 0 }}>{step.title}</p>
              <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)', margin: 0, lineHeight: 1.5 }}>{step.description}</p>
            </li>
          ))}
        </ol>
        <p style={{ margin: 'var(--space-5) 0 0', fontSize: 'var(--text-sm)' }}>
          <Link to="/workflows">Browse examples</Link> · <Link to="/workflows/new?mode=ai">Generate with AI</Link>
        </p>
      </section>

      <section aria-label="Recent runs">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Recent runs</h2>
          <Link to="/runs">View all</Link>
        </div>
        {runsQuery.isError ? (
          <p style={{ color: 'var(--ink-mut)' }}>Couldn&apos;t load recent runs.</p>
        ) : (
          <RecentRuns runs={runsQuery.data?.items ?? []} nameById={nameById} />
        )}
      </section>
    </div>
  );
}
