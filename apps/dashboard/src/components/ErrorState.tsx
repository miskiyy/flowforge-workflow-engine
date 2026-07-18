import { IconAlertTriangle } from './icons.js';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="error-state" role="alert" className="card" style={{ padding: 'var(--space-12) var(--space-6)', textAlign: 'center' }}>
      <span
        aria-hidden="true"
        className="icon-well"
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          margin: '0 auto var(--space-4)',
          background: 'rgba(255, 122, 122, 0.12)',
          color: 'var(--status-failed)',
        }}
      >
        <IconAlertTriangle width={22} height={22} />
      </span>
      <p style={{ color: 'var(--ink)', margin: '0 0 var(--space-4)' }}>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
