import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div data-testid="empty-state" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
      <p style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{title}</p>
      {description ? (
        <p style={{ color: 'var(--ink-mut)', marginTop: 'var(--space-2)' }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--space-4)' }}>{action}</div> : null}
    </div>
  );
}
