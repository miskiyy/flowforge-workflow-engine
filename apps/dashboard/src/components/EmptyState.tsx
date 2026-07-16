import type { ReactNode } from 'react';
import { IconInbox } from './icons.js';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div data-testid="empty-state" className="card" style={{ padding: 'var(--space-12) var(--space-6)', textAlign: 'center' }}>
      <span
        aria-hidden="true"
        className="icon-well"
        style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto var(--space-4)' }}
      >
        <IconInbox width={22} height={22} />
      </span>
      <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, margin: 0 }}>{title}</p>
      {description ? (
        <p style={{ color: 'var(--ink-mut)', marginTop: 'var(--space-2)', maxWidth: '48ch', marginInline: 'auto' }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--space-5)' }}>{action}</div> : null}
    </div>
  );
}
