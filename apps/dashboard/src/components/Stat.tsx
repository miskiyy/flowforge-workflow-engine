/** Shared stat-card primitive — was HealthPage-only, now also used by OverviewPage's fleet summary. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint ? <div style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>{hint}</div> : null}
    </div>
  );
}
