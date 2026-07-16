export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="error-state" role="alert" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
      <p style={{ color: 'var(--status-failed)' }}>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
