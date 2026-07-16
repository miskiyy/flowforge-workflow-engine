import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunStream } from '../src/realtime/useRunStream.js';
import { MockWebSocket } from './mockWebSocket.js';

const dag = { steps: [{ key: 'a', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };

function snapshotResponse(overrides: Partial<{ status: string; stepStatus: string }> = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        run: { id: 'run-1', status: overrides.status ?? 'pending' },
        dag,
        steps: [{ stepKey: 'a', status: overrides.stepStatus ?? 'pending', attemptNumber: 1, error: null }],
      }),
  };
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

describe('useRunStream (websocket client)', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(snapshotResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resyncs via REST, then opens a WS connection carrying the token as a query param', async () => {
    renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith('http://api.test/runs/run-1', expect.objectContaining({ headers: { Authorization: 'Bearer tok-123' } }));
    expect(MockWebSocket.latest().url).toBe('ws://api.test/runs/run-1/stream?token=tok-123');
  });

  it('reports connection status through connecting -> open', async () => {
    const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    expect(result.current.connectionStatus).toBe('connecting');

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());

    await waitFor(() => expect(result.current.connectionStatus).toBe('open'));
  });

  it('applies incoming events to step state as they arrive (auto-updating)', async () => {
    const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());
    await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

    act(() => {
      MockWebSocket.latest().simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a', attemptNumber: 1 });
    });

    await waitFor(() => expect(result.current.steps.a?.status).toBe('running'));
  });

  it('detects a seq gap, discards stream state, and resyncs via a fresh REST call + new socket', async () => {
    const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());
    await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

    act(() => {
      MockWebSocket.latest().simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a' });
    });
    await waitFor(() => expect(result.current.steps.a?.status).toBe('running'));

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotResponse({ stepStatus: 'succeeded' }));

    // seq jumps 1 -> 3: a gap.
    act(() => {
      MockWebSocket.latest().simulateMessage({ type: 'step.succeeded', runId: 'run-1', tenantId: 't1', seq: 3, ts: 'x', stepKey: 'a' });
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.steps.a?.status).toBe('succeeded'));
  });

  it('reconnects with backoff after an unexpected server close, resyncing first', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());
    await vi.waitFor(() => expect(result.current.connectionStatus).toBe('open'));

    act(() => MockWebSocket.latest().simulateServerClose());
    await vi.waitFor(() => expect(result.current.connectionStatus).toBe('reconnecting'));
    expect(MockWebSocket.instances).toHaveLength(1); // no immediate reconnect — waiting out the backoff

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2); // resynced before reconnecting, per the documented recovery flow
  });

  it('closes the socket and does a final resync once the run reaches a terminal state', async () => {
    const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());
    await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotResponse({ status: 'succeeded', stepStatus: 'succeeded' }));

    act(() => {
      MockWebSocket.latest().simulateMessage({ type: 'execution.completed', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x' });
    });

    await waitFor(() => expect(result.current.connectionStatus).toBe('closed'));
    expect(MockWebSocket.latest().readyState).toBe(MockWebSocket.CLOSED);
    await waitFor(() => expect(result.current.run?.status).toBe('succeeded'));
  });

  it('tears down the socket and timers on unmount', async () => {
    const { unmount } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    act(() => MockWebSocket.latest().simulateOpen());

    unmount();
    expect(MockWebSocket.latest().readyState).toBe(MockWebSocket.CLOSED);
  });

  describe('Phase 4.3 hardening', () => {
    it('ignores a duplicate event (same seq redelivered) without re-applying it or triggering a resync', async () => {
      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      act(() => MockWebSocket.latest().simulateOpen());
      await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

      const message = { type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a', attemptNumber: 1 };
      act(() => MockWebSocket.latest().simulateMessage(message));
      await waitFor(() => expect(result.current.events).toHaveLength(1));

      // redeliver the exact same event (seq 1 again) — a real duplicate, not a gap.
      act(() => MockWebSocket.latest().simulateMessage(message));

      // give any (incorrect) resync a chance to happen before asserting it didn't.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current.events).toHaveLength(1);
      expect(MockWebSocket.instances).toHaveLength(1); // no gap-triggered reconnect
      expect(fetch).toHaveBeenCalledTimes(1); // only the initial resync
    });

    it('ignores an older seq (replay from behind the current position) the same way as an exact duplicate', async () => {
      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      act(() => MockWebSocket.latest().simulateOpen());
      await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

      act(() => MockWebSocket.latest().simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a' }));
      act(() => MockWebSocket.latest().simulateMessage({ type: 'step.succeeded', runId: 'run-1', tenantId: 't1', seq: 2, ts: 'x', stepKey: 'a' }));
      await waitFor(() => expect(result.current.steps.a?.status).toBe('succeeded'));

      // a stale, already-seen seq (1) arrives after seq 2 was already applied.
      act(() => MockWebSocket.latest().simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a' }));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current.steps.a?.status).toBe('succeeded'); // not regressed back to running
      expect(result.current.events).toHaveLength(2);
    });

    it('ignores a message from a superseded connection (stale socket) after a gap-triggered reconnect', async () => {
      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const firstSocket = MockWebSocket.latest();
      act(() => firstSocket.simulateOpen());
      await waitFor(() => expect(result.current.connectionStatus).toBe('open'));

      act(() => firstSocket.simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a' }));
      await waitFor(() => expect(result.current.steps.a?.status).toBe('running'));

      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotResponse({ stepStatus: 'succeeded' }));
      // trigger a gap on the first socket, which supersedes it with a second connection.
      act(() => firstSocket.simulateMessage({ type: 'step.succeeded', runId: 'run-1', tenantId: 't1', seq: 3, ts: 'x', stepKey: 'a' }));
      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
      await waitFor(() => expect(result.current.steps.a?.status).toBe('succeeded'));

      const eventsBefore = result.current.events.length;
      // the superseded (first) socket receives one more stray message — must be ignored entirely.
      act(() => firstSocket.simulateMessage({ type: 'step.failed', runId: 'run-1', tenantId: 't1', seq: 4, ts: 'x', stepKey: 'a', error: 'stale' }));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(result.current.steps.a?.status).toBe('succeeded'); // untouched by the stale socket's message
      expect(result.current.events).toHaveLength(eventsBefore);
      expect(MockWebSocket.instances).toHaveLength(2); // no extra reconnect triggered by the stale message
    });

    it('surfaces a permanent error (404 — run not found) and stops retrying instead of looping forever', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(errorResponse(404));
      vi.useFakeTimers();

      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'missing-run', 'tok-123'));

      await vi.waitFor(() => expect(result.current.connectionStatus).toBe('error'));
      expect(result.current.error).toContain('404');
      expect(MockWebSocket.instances).toHaveLength(0); // never attempted to open a socket

      const fetchCallsAtError = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000); // well past any backoff window
      });
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsAtError); // no retry loop
      expect(result.current.connectionStatus).toBe('error');
    });

    it('keeps retrying (does not give up) on a transient/server error, unlike a permanent one', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(errorResponse(503));
      vi.useFakeTimers();

      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
      await vi.waitFor(() => expect(result.current.connectionStatus).toBe('reconnecting'));

      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotResponse());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      expect(result.current.connectionStatus).not.toBe('error');
    });

    it('recovers the correct state after a full disconnect: reconnect resyncs to whatever changed while offline', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useRunStream('http://api.test', 'ws://api.test', 'run-1', 'tok-123'));
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      act(() => MockWebSocket.latest().simulateOpen());
      await vi.waitFor(() => expect(result.current.connectionStatus).toBe('open'));

      act(() => MockWebSocket.latest().simulateMessage({ type: 'step.running', runId: 'run-1', tenantId: 't1', seq: 1, ts: 'x', stepKey: 'a' }));
      await vi.waitFor(() => expect(result.current.steps.a?.status).toBe('running'));

      // connection drops entirely — while "offline," the run finishes on the server.
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotResponse({ status: 'succeeded', stepStatus: 'succeeded' }));
      act(() => MockWebSocket.latest().simulateServerClose());
      await vi.waitFor(() => expect(result.current.connectionStatus).toBe('reconnecting'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000); // first backoff step
      });

      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
      await vi.waitFor(() => expect(result.current.steps.a?.status).toBe('succeeded'));
      expect(result.current.run?.status).toBe('succeeded');

      act(() => MockWebSocket.latest().simulateOpen());
      await vi.waitFor(() => expect(result.current.connectionStatus).toBe('open'));
    });
  });
});
