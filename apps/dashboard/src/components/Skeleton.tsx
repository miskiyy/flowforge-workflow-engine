export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div data-testid="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} style={{ height: 16, margin: 'var(--space-2) 0', borderRadius: 4, background: 'var(--border)' }} />
      ))}
    </div>
  );
}
