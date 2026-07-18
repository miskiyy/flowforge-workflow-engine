import { STEP_STATUS_COLOR, STEP_STATUS_GLYPH, STEP_STATUS_LABEL } from '../statusColor.js';
import type { StepDisplayStatus } from '../realtime/types.js';

export function StatusBadge({ status }: { status: StepDisplayStatus }) {
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--bg)',
        backgroundColor: STEP_STATUS_COLOR[status],
      }}
    >
      <span aria-hidden="true">{STEP_STATUS_GLYPH[status]}</span> {STEP_STATUS_LABEL[status]}
    </span>
  );
}
