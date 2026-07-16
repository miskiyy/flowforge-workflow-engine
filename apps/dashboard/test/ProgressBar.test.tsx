import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { computeProgress, ProgressBar } from '../src/components/ProgressBar.js';
import type { StepState } from '../src/realtime/types.js';

describe('computeProgress', () => {
  it('counts succeeded/failed/skipped as done, running/pending/queued as not', () => {
    const steps: Record<string, StepState> = {
      a: { stepKey: 'a', status: 'succeeded' },
      b: { stepKey: 'b', status: 'failed' },
      c: { stepKey: 'c', status: 'skipped' },
      d: { stepKey: 'd', status: 'running' },
    };
    expect(computeProgress(steps, 4)).toEqual({ total: 4, done: 3, percent: 75 });
  });

  it('is 0% for zero total steps without dividing by zero', () => {
    expect(computeProgress({}, 0)).toEqual({ total: 0, done: 0, percent: 0 });
  });

  it('uses totalSteps as the denominator, not the number of steps seen so far', () => {
    // Only 1 of 5 DAG steps has reported any state yet (events arrive incrementally over WS) —
    // the denominator must stay 5, not shrink to 1 (frontend-design.md §9).
    const steps: Record<string, StepState> = { a: { stepKey: 'a', status: 'succeeded' } };
    expect(computeProgress(steps, 5)).toEqual({ total: 5, done: 1, percent: 20 });
  });
});

describe('ProgressBar', () => {
  it('renders the done/total count and percent using totalSteps as the denominator', () => {
    const steps: Record<string, StepState> = {
      a: { stepKey: 'a', status: 'succeeded' },
      b: { stepKey: 'b', status: 'pending' },
    };
    render(<ProgressBar steps={steps} totalSteps={2} />);
    expect(screen.getByTestId('progress-label')).toHaveTextContent('1 / 2 steps complete');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });
});
