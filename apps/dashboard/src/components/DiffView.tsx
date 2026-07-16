import type { DagDiff } from '../api/ai.js';

/** Diff semantics come from the server (§8) — never recomputed client-side. Glyphs, not color alone. */
export function DiffView({ diff }: { diff: DagDiff }) {
  return (
    <ul
      data-testid="diff-view"
      style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
    >
      {diff.added.map((key) => (
        <li key={`added-${key}`} data-testid="diff-row" data-diff-kind="added">
          <span aria-hidden="true">+</span> {key} <span style={{ color: 'var(--ink-mut)' }}>added</span>
        </li>
      ))}
      {diff.modified.map((entry) => (
        <li key={`modified-${entry.key}`} data-testid="diff-row" data-diff-kind="modified">
          <span aria-hidden="true">~</span> {entry.key} <span style={{ color: 'var(--ink-mut)' }}>{entry.fields.join(', ')}</span>
        </li>
      ))}
      {diff.removed.map((key) => (
        <li key={`removed-${key}`} data-testid="diff-row" data-diff-kind="removed">
          <span aria-hidden="true">−</span> {key} <span style={{ color: 'var(--ink-mut)' }}>removed</span>
        </li>
      ))}
      {diff.unchanged.map((key) => (
        <li key={`unchanged-${key}`} data-testid="diff-row" data-diff-kind="unchanged">
          <span aria-hidden="true">·</span> {key} <span style={{ color: 'var(--ink-mut)' }}>unchanged</span>
        </li>
      ))}
    </ul>
  );
}
