import { describe, expect, it } from 'vitest';
import { registerRunController, requestRunCancellation, unregisterRunController } from '../src/execution/cancellation.js';

describe('run cancellation registry', () => {
  it('aborts the registered controller and returns true', () => {
    const controller = new AbortController();
    registerRunController('run-1', controller);

    expect(requestRunCancellation('run-1')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('returns false for a run with no registered controller', () => {
    expect(requestRunCancellation('never-registered')).toBe(false);
  });

  it('returns false once a controller has been unregistered', () => {
    const controller = new AbortController();
    registerRunController('run-2', controller);
    unregisterRunController('run-2');

    expect(requestRunCancellation('run-2')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });
});
