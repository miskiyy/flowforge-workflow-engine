import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../src/api/runs.js';
import { initialRunStreamState, runStreamReducer } from '../src/realtime/useRunStream.js';
import type { RealtimeEvent } from '../src/realtime/types.js';

const dag: WorkflowDagDefinition = {
  steps: [
    { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
    { key: 'b', type: 'delay', dependsOn: ['a'], durationMs: 1 },
  ],
};

const snapshot: RunSnapshot = {
  run: { id: 'run-1', status: 'pending' },
  dag,
  steps: [
    { stepKey: 'a', status: 'pending', attemptNumber: 1, error: null },
    { stepKey: 'b', status: 'pending', attemptNumber: 1, error: null },
  ],
};

function event(partial: Partial<RealtimeEvent> & Pick<RealtimeEvent, 'type' | 'seq'>): RealtimeEvent {
  return { runId: 'run-1', tenantId: 't1', ts: '2026-07-15T00:00:00.000Z', ...partial };
}

describe('runStreamReducer', () => {
  it('SNAPSHOT hydrates run, dag, and per-step status from a REST resync', () => {
    const state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    expect(state.run).toEqual({ id: 'run-1', status: 'pending' });
    expect(state.dag).toBe(dag);
    expect(state.steps.a).toEqual({ stepKey: 'a', status: 'pending', attemptNumber: 1 });
  });

  it('execution.started flips run status to running', () => {
    const hydrated = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    const state = runStreamReducer(hydrated, { type: 'EVENT', event: event({ type: 'execution.started', seq: 1 }) });
    expect(state.run?.status).toBe('running');
  });

  it('step.running then step.succeeded updates that step only, leaving siblings untouched', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, {
      type: 'EVENT',
      event: event({ type: 'step.running', seq: 2, stepKey: 'a', attemptNumber: 1 }),
    });
    expect(state.steps.a?.status).toBe('running');
    expect(state.steps.b?.status).toBe('pending');

    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'step.succeeded', seq: 3, stepKey: 'a', attemptNumber: 1 }) });
    expect(state.steps.a).toEqual({ stepKey: 'a', status: 'succeeded', attemptNumber: 1 });
  });

  it('step.failed records the error message on that step', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, {
      type: 'EVENT',
      event: event({ type: 'step.failed', seq: 2, stepKey: 'a', error: 'boom' }),
    });
    expect(state.steps.a).toEqual({ stepKey: 'a', status: 'failed', error: 'boom' });
  });

  it('a fresh step.running clears a stale error from a prior failed attempt', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'step.failed', seq: 2, stepKey: 'a', error: 'boom' }) });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'step.running', seq: 3, stepKey: 'a', attemptNumber: 2 }) });
    expect(state.steps.a?.error).toBeUndefined();
  });

  it('execution.cancelled sets run status to cancelled', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'execution.cancelled', seq: 2 }) });
    expect(state.run?.status).toBe('cancelled');
  });

  it('execution.completed does not guess a run status (the wire event cannot distinguish succeeded/failed)', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'execution.started', seq: 1 }) });
    const before = state.run?.status;
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'execution.completed', seq: 2 }) });
    expect(state.run?.status).toBe(before);
  });

  it('appends every applied event to the timeline log, in order', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'execution.started', seq: 1 }) });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'step.running', seq: 2, stepKey: 'a' }) });
    expect(state.events.map((e) => e.type)).toEqual(['execution.started', 'step.running']);
  });

  it('a later SNAPSHOT (resync) replaces steps wholesale, e.g. surfacing a skipped step never seen over the wire', () => {
    let state = runStreamReducer(initialRunStreamState, { type: 'SNAPSHOT', snapshot });
    state = runStreamReducer(state, { type: 'EVENT', event: event({ type: 'step.failed', seq: 2, stepKey: 'a', error: 'boom' }) });

    const finalSnapshot: RunSnapshot = {
      run: { id: 'run-1', status: 'failed' },
      dag,
      steps: [
        { stepKey: 'a', status: 'failed', attemptNumber: 1, error: 'boom' },
        { stepKey: 'b', status: 'skipped', attemptNumber: 1, error: null },
      ],
    };
    state = runStreamReducer(state, { type: 'SNAPSHOT', snapshot: finalSnapshot });

    expect(state.steps.b?.status).toBe('skipped');
    expect(state.run?.status).toBe('failed');
    // events log (the timeline) is preserved across a resync, not wiped.
    expect(state.events).toHaveLength(1);
  });
});
