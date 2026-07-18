import type { StepState } from '../realtime/types.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'skipped']);

export interface Progress {
  total: number;
  done: number;
  percent: number;
}

/**
 * Pure so the fraction-complete math is testable without rendering anything.
 * `totalSteps` must come from `dag.steps.length` (authoritative) — never
 * `Object.keys(steps).length`, which grows as WS events arrive and would
 * make the bar's denominator move mid-run (frontend-design.md §9).
 */
export function computeProgress(steps: Record<string, StepState>, totalSteps: number): Progress {
  const done = Object.values(steps).filter((s) => TERMINAL_STATUSES.has(s.status)).length;
  const percent = totalSteps === 0 ? 0 : Math.round((done / totalSteps) * 100);
  return { total: totalSteps, done, percent };
}

export function ProgressBar({ steps, totalSteps }: { steps: Record<string, StepState>; totalSteps: number }) {
  const { total, done, percent } = computeProgress(steps, totalSteps);

  return (
    <div data-testid="progress-bar">
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: 'var(--surface-high)', borderRadius: 4, height: 8, overflow: 'hidden' }}
      >
        <div style={{ width: `${percent}%`, background: 'var(--accent)', height: '100%', transition: 'width var(--duration-base) var(--ease-out)' }} />
      </div>
      <p data-testid="progress-label">
        {done} / {total} steps complete
      </p>
    </div>
  );
}
