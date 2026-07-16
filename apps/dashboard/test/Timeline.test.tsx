import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/components/Timeline.js';
import type { RealtimeEvent } from '../src/realtime/types.js';

function event(partial: Partial<RealtimeEvent> & Pick<RealtimeEvent, 'type' | 'seq'>): RealtimeEvent {
  return { runId: 'run-1', tenantId: 't1', ts: '2026-07-15T00:00:00.000Z', ...partial };
}

describe('Timeline', () => {
  it('shows a placeholder when there are no events yet', () => {
    render(<Timeline events={[]} />);
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });

  it('renders one entry per event, newest first', () => {
    render(
      <Timeline
        events={[
          event({ type: 'execution.started', seq: 1 }),
          event({ type: 'step.running', seq: 2, stepKey: 'a', attemptNumber: 1 }),
        ]}
      />,
    );
    const entries = screen.getAllByTestId('timeline-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Step "a" running');
    expect(entries[1]).toHaveTextContent('Execution started');
  });

  it('includes the error message for a failed step', () => {
    render(<Timeline events={[event({ type: 'step.failed', seq: 1, stepKey: 'a', error: 'boom' })]} />);
    expect(screen.getByTestId('timeline-entry')).toHaveTextContent('Step "a" failed: boom');
  });

  it('caps the rendered list at the most recent 200 events with a note', () => {
    const events = Array.from({ length: 250 }, (_, i) => event({ type: 'step.running', seq: i + 1, stepKey: 'a', attemptNumber: 1 }));
    render(<Timeline events={events} />);

    expect(screen.getByTestId('timeline-capped-note')).toHaveTextContent('Showing last 200 events.');
    const entries = screen.getAllByTestId('timeline-entry');
    expect(entries).toHaveLength(200);
    // newest first — seq 250 (the very last event) leads.
    expect(entries[0]).toHaveTextContent('attempt 1');
  });

  it('does not show the capped note under the 200-event threshold', () => {
    render(<Timeline events={[event({ type: 'execution.started', seq: 1 })]} />);
    expect(screen.queryByTestId('timeline-capped-note')).not.toBeInTheDocument();
  });
});
