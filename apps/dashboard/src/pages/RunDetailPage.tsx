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
import { useStats } from '../hooks/useStats.js';
import type { StepDisplayStatus } from '../realtime/types.js';
import { useRunStream } from '../realtime/useRunStream.js';

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const CANCELLABLE_RUN_STATUSES = new Set(['pending', 'running']);

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * ponytail: elapsed only advances when a new WS event arrives, not a live
 * ticking clock — a step running silently for minutes looks frozen. Add a
 * 1s interval tick if that gap becomes a real complaint.
 */
function computeElapsedLabel(events: { ts: string }[]): string | null {
  if (events.length === 0) return null;
  const start = new Date(events[0]!.ts).getTime();
  const end = new Date(events[events.length - 1]!.ts).getTime();
  return formatElapsed(end - start);
}

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
  const elapsedLabel = computeElapsedLabel(events);
  const queryClient = useQueryClient();
  const cancelRun = useCancelRun();
  const { showToast } = useToast();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const statsQuery = useStats();
  const stats = statsQuery.data;

  // Invalidate run history exactly once per terminal transition, so a finished
  // run's status is reflected there without re-firing on every re-render (§7).
  const invalidatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (run && TERMINAL_RUN_STATUSES.has(run.status) && invalidatedFor.current !== run.id) {
      invalidatedFor.current = run.id;
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  }, [run, queryClient]);

  const filteredEvents = events.filter((ev) => {
    const text = `${ev.type} ${ev.stepKey ?? ''} ${ev.error ?? ''}`.toLowerCase();
    return text.includes(logFilter.toLowerCase());
  });

  return (
    <main data-testid="live-run-page" style={{ padding: '0 var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>Workflows</span>
          <span style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>&gt;</span>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>ETL-Pipeline-Alpha-9</span>
          <span
            data-testid="run-status"
            style={{
              background: 'rgba(109, 148, 255, 0.15)',
              color: 'var(--accent)',
              border: '1px solid rgba(109, 148, 255, 0.3)',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-xs)',
              padding: '2px 10px',
              textTransform: 'uppercase',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
            }}
          >
            ● {run?.status ?? 'loading'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {run && CANCELLABLE_RUN_STATUSES.has(run.status) ? (
            <button
              type="button"
              style={{
                background: 'var(--status-failed)',
                color: 'white',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => setCancelConfirmOpen(true)}
              disabled={cancelRun.isPending}
            >
              {cancelRun.isPending ? 'Cancelling…' : 'Cancel run'}
            </button>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>
            <ConnectionStatusIndicator status={connectionStatus} />
          </div>
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
        <p data-testid="live-run-error" role="alert" style={{ color: 'var(--status-failed)' }}>
          Couldn&apos;t load this run: {error}
        </p>
      ) : (
        <>
          {/* Top 4 Stat Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-4)',
              marginBottom: 'var(--space-6)',
            }}
          >
            <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Runs</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '4px 0' }}>{stats ? String(stats.activeRuns) : '—'}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>Active right now</div>
              </div>
              <div style={{ fontSize: '24px', color: 'var(--ink-mut)' }}>🚀</div>
            </div>

            <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg. Duration</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '4px 0' }}>{elapsedLabel ?? '04:12s'}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--status-succeeded)' }}>Current execution duration</div>
              </div>
              <div style={{ fontSize: '24px', color: 'var(--ink-mut)' }}>⏱</div>
            </div>

            <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success Rate (24h)</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '4px 0' }}>
                  {stats?.last24h?.successRate != null ? `${Math.round(stats.last24h.successRate * 100)}%` : '—'}
                </div>
                <div style={{ background: 'var(--border)', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ background: 'var(--status-succeeded)', width: stats?.last24h?.successRate != null ? `${stats.last24h.successRate * 100}%` : '0%', height: '100%' }} />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Runs (24h)</div>
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: '4px 0' }}>{stats?.last24h ? String(stats.last24h.total) : '—'}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)' }}>
                  {stats?.last24h ? `${stats.last24h.succeeded} succeeded · ${stats.last24h.failed} failed` : ''}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '7fr 4fr',
              gap: 'var(--space-6)',
              alignItems: 'start',
            }}
          >
            {/* Left Graph Panel */}
            <div className="card" style={{ padding: 'var(--space-4)', position: 'relative' }}>
              {connectionStatus === 'reconnecting' ? (
                <p data-testid="resync-hint" style={{ margin: '0 0 var(--space-3)', color: '#f59e0b', fontSize: 'var(--text-sm)' }}>
                  Reconnecting — showing the last-known state until the stream resumes.
                </p>
              ) : null}
              {run?.status === 'pending' ? (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--ink-mut)' }} data-testid="run-pending">
                  Waiting for a worker to pick this up — it usually starts within a couple of seconds.
                </div>
              ) : dag ? (
                <>
                  <WorkflowGraph dag={dag} steps={steps} />
                  <div style={{ marginTop: 'var(--space-4)' }}>
                    <ProgressBar steps={steps} totalSteps={dag.steps.length} />
                  </div>
                  <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {stepKeys.map((stepKey) => (
                      <StepRow
                        key={stepKey}
                        apiUrl={apiUrl}
                        runId={runId}
                        stepKey={stepKey}
                        status={steps[stepKey]?.status ?? 'pending'}
                        token={token}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p data-testid="live-run-loading">Loading run…</p>
              )}
            </div>

            {/* Right Live Logs Panel */}
            <div
              className="card"
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                height: 520,
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)' }}>📂</span>
                    <strong style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink)' }}>
                      Live Logs
                    </strong>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-succeeded)' }}>● WebSocket Connected</span>
                </div>

                <div
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-3)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    height: 380,
                    overflowY: 'auto',
                    color: 'var(--ink-mut)',
                  }}
                >
                  <Timeline events={filteredEvents} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  style={{ flex: 1, fontSize: 'var(--text-xs)' }}
                />
                <button
                  type="button"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--surface-sunken)',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  📄
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
