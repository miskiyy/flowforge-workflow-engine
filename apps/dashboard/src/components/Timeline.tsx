import type { RealtimeEvent } from '../realtime/types.js';

const MAX_RENDERED_EVENTS = 200;

function describeEvent(event: RealtimeEvent): string {
  switch (event.type) {
    case 'execution.started':
      return 'Execution started';
    case 'execution.completed':
      return 'Execution completed';
    case 'execution.cancelled':
      return 'Execution cancelled';
    case 'step.queued':
      return `Step "${event.stepKey}" queued`;
    case 'step.running':
      return `Step "${event.stepKey}" running (attempt ${event.attemptNumber ?? 1})`;
    case 'step.succeeded':
      return `Step "${event.stepKey}" succeeded`;
    case 'step.failed':
      return `Step "${event.stepKey}" failed${event.error ? `: ${event.error}` : ''}`;
  }
}

/** Newest event first — matches how a live log is read (most recent activity at the top). */
export function Timeline({ events }: { events: RealtimeEvent[] }) {
  if (events.length === 0) {
    return (
      <p data-testid="timeline-empty" style={{ color: '#6b7280' }}>
        No events yet.
      </p>
    );
  }

  // An unbounded events array is the one real perf risk here — cap the rendered
  // list at the most recent 200 (frontend-design.md §9).
  const capped = events.length > MAX_RENDERED_EVENTS ? events.slice(events.length - MAX_RENDERED_EVENTS) : events;
  const ordered = [...capped].reverse();

  return (
    <>
      {events.length > MAX_RENDERED_EVENTS ? (
        <p data-testid="timeline-capped-note" style={{ color: '#6b7280', fontSize: 12 }}>
          Showing last {MAX_RENDERED_EVENTS} events.
        </p>
      ) : null}
      <ol data-testid="timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ordered.map((event) => (
          <li key={event.seq} data-testid="timeline-entry" style={{ padding: '4px 0', fontSize: 13 }}>
            <time dateTime={event.ts} style={{ color: '#6b7280', marginRight: 8 }}>
              {new Date(event.ts).toLocaleTimeString()}
            </time>
            {describeEvent(event)}
          </li>
        ))}
      </ol>
    </>
  );
}
