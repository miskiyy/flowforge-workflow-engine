import { describe, expect, it } from 'vitest';
import {
  assertRunTransition,
  assertStepTransition,
  canTransitionRun,
  canTransitionStep,
  InvalidRunTransitionError,
  InvalidStepTransitionError,
  isTerminalRunStatus,
} from '../src/execution/lifecycle.js';

describe('run status lifecycle', () => {
  it('allows pending -> running', () => {
    expect(canTransitionRun('pending', 'running')).toBe(true);
  });

  it('allows running -> each terminal status', () => {
    expect(canTransitionRun('running', 'succeeded')).toBe(true);
    expect(canTransitionRun('running', 'failed')).toBe(true);
    expect(canTransitionRun('running', 'timed_out')).toBe(true);
  });

  it('rejects skipping pending straight to succeeded/failed/timed_out', () => {
    expect(canTransitionRun('pending', 'succeeded')).toBe(false);
    expect(canTransitionRun('pending', 'failed')).toBe(false);
    expect(canTransitionRun('pending', 'timed_out')).toBe(false);
  });

  it('allows pending -> cancelled directly — a queued run never needs to pass through running to be cancelled', () => {
    expect(canTransitionRun('pending', 'cancelled')).toBe(true);
  });

  it('rejects any transition out of a terminal status', () => {
    for (const terminal of ['succeeded', 'failed', 'timed_out', 'cancelled'] as const) {
      expect(canTransitionRun(terminal, 'running')).toBe(false);
      expect(canTransitionRun(terminal, 'pending')).toBe(false);
    }
  });

  it('rejects re-entering the same status', () => {
    expect(canTransitionRun('running', 'running')).toBe(false);
    expect(canTransitionRun('pending', 'pending')).toBe(false);
  });

  it('assertRunTransition throws InvalidRunTransitionError on an illegal move', () => {
    expect(() => assertRunTransition('succeeded', 'running')).toThrow(InvalidRunTransitionError);
  });

  it('assertRunTransition is a no-op on a legal move', () => {
    expect(() => assertRunTransition('pending', 'running')).not.toThrow();
  });

  it('identifies terminal statuses', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('timed_out')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('pending')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
  });

  it('allows running -> cancelled', () => {
    expect(canTransitionRun('running', 'cancelled')).toBe(true);
  });
});

describe('step status lifecycle', () => {
  it('allows pending -> running -> succeeded/failed', () => {
    expect(canTransitionStep('pending', 'running')).toBe(true);
    expect(canTransitionStep('running', 'succeeded')).toBe(true);
    expect(canTransitionStep('running', 'failed')).toBe(true);
  });

  it('allows pending -> skipped directly, without ever running', () => {
    expect(canTransitionStep('pending', 'skipped')).toBe(true);
  });

  it('rejects skipping a step that already started running', () => {
    expect(canTransitionStep('running', 'skipped')).toBe(false);
  });

  it('rejects any transition out of a terminal status', () => {
    for (const terminal of ['succeeded', 'failed', 'skipped'] as const) {
      expect(canTransitionStep(terminal, 'running')).toBe(false);
      expect(canTransitionStep(terminal, 'pending')).toBe(false);
    }
  });

  it('assertStepTransition throws InvalidStepTransitionError on an illegal move', () => {
    expect(() => assertStepTransition('succeeded', 'running')).toThrow(InvalidStepTransitionError);
  });

  it('assertStepTransition is a no-op on a legal move', () => {
    expect(() => assertStepTransition('pending', 'skipped')).not.toThrow();
  });

  it('allows the retry loop: running -> retrying -> running', () => {
    expect(canTransitionStep('running', 'retrying')).toBe(true);
    expect(canTransitionStep('retrying', 'running')).toBe(true);
  });

  it('rejects skipping or finishing a step mid-retry', () => {
    expect(canTransitionStep('retrying', 'skipped')).toBe(false);
    expect(canTransitionStep('retrying', 'succeeded')).toBe(false);
    expect(canTransitionStep('retrying', 'failed')).toBe(false);
  });
});
