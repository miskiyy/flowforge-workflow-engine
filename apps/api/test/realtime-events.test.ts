import { describe, expect, it } from 'vitest';
import { mapLogEventToRealtimeEvent, serializeEvent } from '../src/realtime/events.js';

describe('mapLogEventToRealtimeEvent', () => {
  const runId = 'run-1';
  const tenantId = 'tenant-1';

  it('maps run.started to execution.started', () => {
    expect(mapLogEventToRealtimeEvent('run.started', { runId, tenantId })).toEqual({
      type: 'execution.started',
      runId,
      tenantId,
    });
  });

  it('maps step.queued to step.queued with stepKey', () => {
    expect(mapLogEventToRealtimeEvent('step.queued', { runId, tenantId, stepKey: 'a' })).toEqual({
      type: 'step.queued',
      runId,
      tenantId,
      stepKey: 'a',
    });
  });

  it('maps step.running to step.running with stepKey + attemptNumber (from "attempt" field)', () => {
    expect(mapLogEventToRealtimeEvent('step.running', { runId, tenantId, stepKey: 'a', attempt: 2 })).toEqual({
      type: 'step.running',
      runId,
      tenantId,
      stepKey: 'a',
      attemptNumber: 2,
    });
  });

  it('maps step.succeeded to step.succeeded with attemptNumber', () => {
    expect(mapLogEventToRealtimeEvent('step.succeeded', { runId, tenantId, stepKey: 'a', attempt: 1 })).toEqual({
      type: 'step.succeeded',
      runId,
      tenantId,
      stepKey: 'a',
      attemptNumber: 1,
    });
  });

  it('maps step.failed to step.failed with the error message', () => {
    expect(mapLogEventToRealtimeEvent('step.failed', { runId, tenantId, stepKey: 'a', error: 'boom' })).toEqual({
      type: 'step.failed',
      runId,
      tenantId,
      stepKey: 'a',
      error: 'boom',
    });
  });

  it('maps run.finished with a non-cancelled status to execution.completed', () => {
    expect(mapLogEventToRealtimeEvent('run.finished', { runId, tenantId, status: 'succeeded' })).toEqual({
      type: 'execution.completed',
      runId,
      tenantId,
    });
    expect(mapLogEventToRealtimeEvent('run.finished', { runId, tenantId, status: 'failed' })).toEqual({
      type: 'execution.completed',
      runId,
      tenantId,
    });
  });

  it('maps run.finished with status cancelled to execution.cancelled', () => {
    expect(mapLogEventToRealtimeEvent('run.finished', { runId, tenantId, status: 'cancelled' })).toEqual({
      type: 'execution.cancelled',
      runId,
      tenantId,
    });
  });

  it('returns null for engine events outside the realtime vocabulary', () => {
    expect(mapLogEventToRealtimeEvent('step.attempt_failed', { runId, tenantId, stepKey: 'a' })).toBeNull();
    expect(mapLogEventToRealtimeEvent('step.retrying', { runId, tenantId, stepKey: 'a' })).toBeNull();
    expect(mapLogEventToRealtimeEvent('step.skipped', { runId, tenantId, stepKey: 'a' })).toBeNull();
  });
});

describe('serializeEvent', () => {
  it('round-trips through JSON', () => {
    const event = {
      type: 'step.running' as const,
      runId: 'run-1',
      tenantId: 'tenant-1',
      seq: 3,
      ts: '2026-07-15T00:00:00.000Z',
      stepKey: 'a',
      attemptNumber: 1,
    };
    expect(JSON.parse(serializeEvent(event))).toEqual(event);
  });
});
