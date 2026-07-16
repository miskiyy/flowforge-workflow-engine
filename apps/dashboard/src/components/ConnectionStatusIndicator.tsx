import type { ConnectionStatus } from '../realtime/useRunStream.js';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  open: '● Live',
  reconnecting: 'Reconnecting…',
  closed: 'Finished',
  error: "Couldn't load this run.",
};

const COLOR: Record<ConnectionStatus, string> = {
  connecting: '#9ca3af',
  open: '#22c55e',
  reconnecting: '#f59e0b',
  closed: '#6b7280',
  error: '#ef4444',
};

/** aria-live="polite" — announces connection transitions without spamming per WS event (§12). */
export function ConnectionStatusIndicator({ status }: { status: ConnectionStatus }) {
  return (
    <span
      data-testid="connection-status"
      data-status={status}
      aria-live="polite"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: COLOR[status],
        }}
      />
      {LABEL[status]}
    </span>
  );
}
