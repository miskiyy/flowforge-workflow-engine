import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fetchStepLogs } from '../api/runs.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ConnectionStatusIndicator } from '../components/ConnectionStatusIndicator.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Timeline } from '../components/Timeline.js';
import { useToast } from '../components/Toast.js';
import { WorkflowGraph } from '../components/WorkflowGraph.js';
import { useCancelRun } from '../hooks/useCancelRun.js';
import type { StepDisplayStatus } from '../realtime/types.js';
import { useRunStream } from '../realtime/useRunStream.js';

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const CANCELLABLE_RUN_STATUSES = new Set(['pending', 'running']);

/** http(s):// -> ws(s):// — one origin, one env var, no separate WS URL to configure. */
export function toWsUrl(apiUrl: string): string {
  return apiUrl.replace(/^http/, 'ws');
}

/**
 * Lazy per-step log expansion (P11): nothing is fetched until the <details>
 * is opened, and the status in the query key re-fetches after each
 * transition so a retrying step's log lines appear as they happen.
 */
function StepLogs({ apiUrl, runId, stepKey, status, token }: { apiUrl: string; runId: string; stepKey: string; status: string; token: string }) {
  const logsQuery = useQuery({
    queryKey: ['stepLogs', runId, stepKey, status],
    queryFn: () => fetchStepLogs(apiUrl, runId, stepKey, token),
  });

  if (logsQuery.isError) return <p style={{ color: 'var(--status-failed)', margin: 'var(--space-2) 0 0' }}>Couldn&apos;t load logs.</p>;
  if (!logsQuery.data) return <p style={{ color: 'var(--ink-mut)', margin: 'var(--space-2) 0 0' }}>Loading logs…</p>;
  if (logsQuery.data.items.length === 0) {
    return <p style={{ color: 'var(--ink-mut)', margin: 'var(--space-2) 0 0' }}>No log entries — this step has no failed attempts.</p>;
  }
  return (
    <ol
      data-testid="step-logs"
      style={{
        listStyle: 'none',
        margin: 'var(--space-2) 0 0',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {logsQuery.data.items.map((log, index) => (
        <li key={index} style={{ display: 'flex', gap: 'var(--space-3)', padding: '2px 0' }}>
          <span style={{ color: 'var(--ink-mut)', whiteSpace: 'nowrap' }}>{new Date(log.ts).toLocaleTimeString()}</span>
          <span style={{ color: log.level === 'error' ? 'var(--status-failed)' : 'var(--ink)' }}>{log.message}</span>
        </li>
      ))}
    </ol>
  );
}

function StepRow({ apiUrl, runId, stepKey, status, token }: { apiUrl: string; runId: string; stepKey: string; status: StepDisplayStatus; token: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details data-testid="step-status-row" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer' }}>
        {stepKey}: <StatusBadge status={status} />
      </summary>
      {open ? <StepLogs apiUrl={apiUrl} runId={runId} stepKey={stepKey} status={status} token={token} /> : null}
    </details>
  );
}

export function RunDetailPage({ apiUrl, runId, token }: { apiUrl: string; runId: string; token: string }) {
  const { connectionStatus, run, dag, steps, events, error } = useRunStream(apiUrl, toWsUrl(apiUrl), runId, token);
  const stepKeys = Object.keys(steps).sort();
  const queryClient = useQueryClient();
  const cancelRun = useCancelRun();
  const { showToast } = useToast();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // Invalidate run history exactly once per terminal transition, so a finished
  // run's status is reflected there without re-firing on every re-render (§7).
  const invalidatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (run && TERMINAL_RUN_STATUSES.has(run.status) && invalidatedFor.current !== run.id) {
      invalidatedFor.current = run.id;
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  }, [run, queryClient]);

  return (
    <main data-testid="live-run-page">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <h1 tabIndex={-1} title={runId} style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>
          Run <code>{runId.slice(0, 8)}</code>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {run && CANCELLABLE_RUN_STATUSES.has(run.status) ? (
            <button type="button" onClick={() => setCancelConfirmOpen(true)} disabled={cancelRun.isPending}>
              {cancelRun.isPending ? 'Cancelling…' : 'Cancel run'}
            </button>
          ) : null}
          <ConnectionStatusIndicator status={connectionStatus} />
        </div>
      </header>

      {cancelConfirmOpen ? (
        <ConfirmDialog
          title="Cancel this run?"
          description="A pending run stops immediately; a running run finishes its in-flight step first, then stops before the next one."
          confirmLabel="Cancel run"
          onConfirm={() => {
            cancelRun.mutate(runId, { onError: () => showToast('Could not cancel this run — try again.') });
            setCancelConfirmOpen(false);
          }}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      ) : null}

      {connectionStatus === 'error' ? (
        <p data-testid="live-run-error" role="alert">
          Couldn&apos;t load this run: {error}
        </p>
      ) : !dag || !run ? (
        <p data-testid="live-run-loading">Loading run…</p>
      ) : (
        <>
          {/* Gap detection discards and REST-resyncs — never blank the graph while that's in flight (§9). */}
          {connectionStatus === 'reconnecting' ? (
            <p data-testid="resync-hint" style={{ color: '#6b7280', fontSize: 13 }}>
              Resyncing…
            </p>
          ) : null}

          <p data-testid="run-status" aria-live="polite">
            Run status: <strong>{run.status}</strong>
          </p>

          {run.status === 'pending' ? (
            <p data-testid="run-pending">Waiting for a worker to pick this up — it usually starts within a couple of seconds.</p>
          ) : (
            <>
              <ProgressBar steps={steps} totalSteps={dag.steps.length} />

              <section aria-label="Workflow graph">
                <WorkflowGraph dag={dag} steps={steps} />
              </section>

              <section aria-label="Step statuses">
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
                  {stepKeys.map((stepKey) => (
                    <li key={stepKey}>
                      <StepRow apiUrl={apiUrl} runId={runId} stepKey={stepKey} status={steps[stepKey]!.status} token={token} />
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Timeline">
                <h2>Timeline</h2>
                <Timeline events={events} />
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
