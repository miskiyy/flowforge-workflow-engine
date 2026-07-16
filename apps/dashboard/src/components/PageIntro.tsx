import type { ReactNode } from 'react';

/** Heading + one-line description, so a screen says what it is (frontend-ux-revision.md §4). */
export function PageIntro({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <h1 tabIndex={-1} style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>
          {title}
        </h1>
        {action ?? null}
      </div>
      {description ? (
        <p style={{ color: 'var(--ink-mut)', marginTop: 'var(--space-2)', maxWidth: '60ch', lineHeight: 1.6 }}>{description}</p>
      ) : null}
    </header>
  );
}
