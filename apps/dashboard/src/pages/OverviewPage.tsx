import { Link } from 'react-router-dom';
import type { RunSummary } from '../api/runs.js';
import { ActionCard } from '../components/ActionCard.js';
import { PageIntro } from '../components/PageIntro.js';
import type { RunDisplayStatus } from '../realtime/types.js';
import { useRuns } from '../hooks/useRuns.js';
import { useWorkflows } from '../hooks/useWorkflows.js';

const RUN_STATUS_COLOR: Record<RunDisplayStatus, string> = {
  pending: 'var(--status-pending)',
  running: 'var(--status-running)',
  succeeded: 'var(--status-succeeded)',
  failed: 'var(--status-failed)',
  timed_out: 'var(--status-failed)',
  cancelled: 'var(--status-skipped)',
};

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

  const nameById = new Map((workflowsQuery.data?.items ?? []).map((workflow) => [workflow.id, workflow.name]));

  return (
    <div>
      <PageIntro
        title="Build, run, and watch workflows"
        description="Compose steps into a DAG, execute them, and watch each step run live. Describe a workflow in plain English or author it directly."
      />

      <section
        aria-label="How to test FlowForge"
        className="card"
        style={{ padding: 'var(--space-4) var(--space-6)', marginBottom: 'var(--space-8)' }}
      >
        <p style={{ fontWeight: 600, margin: '0 0 var(--space-2)' }}>New here? Try it in four steps</p>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--ink-mut)', lineHeight: 1.7 }}>
          <li>
            Open an example workflow — <Link to="/workflows">Browse examples</Link> (try <code>fan-out</code>).
          </li>
          <li>
            Press <strong>Trigger</strong>. The run starts and you jump straight to the live view.
          </li>
          <li>Watch the graph light up green as each step runs, with a live timeline beside it.</li>
          <li>
            Then try <Link to="/workflows/new?mode=ai">Generate with AI</Link> — describe a workflow in a sentence and
            review the draft before saving.
          </li>
        </ol>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-8)',
        }}
      >
        <ActionCard
          primary
          title="Generate with AI"
          description="Describe what you want; review the draft before saving."
          to="/workflows/new?mode=ai"
          cta="Generate"
        />
        <ActionCard
          title="Create manually"
          description="Author the DAG as JSON with an inline step reference."
          to="/workflows/new"
          cta="New"
        />
        <ActionCard
          title="Browse examples"
          description="Open a seeded workflow, run it, and watch it execute live."
          to="/workflows"
          cta="Examples"
        />
      </div>

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
