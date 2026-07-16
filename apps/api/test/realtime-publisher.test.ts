import { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { createRealtimeExecutionLogger, RunPublisher } from '../src/realtime/publisher.js';

/** A minimal stand-in for a `ws` WebSocket — avoids a real socket/port for pure unit tests. */
function mockSocket(readyState: number = WebSocket.OPEN) {
  const send = vi.fn();
  const ws = { readyState, send } as unknown as WebSocket;
  return { ws, send };
}

describe('RunPublisher', () => {
  it("delivers a published event only to sockets in that run's room (room isolation)", () => {
    const publisher = new RunPublisher();
    const socketA = mockSocket();
    const socketB = mockSocket();
    publisher.join('run-a', socketA.ws);
    publisher.join('run-b', socketB.ws);

    publisher.publish('run-a', { type: 'execution.started', runId: 'run-a', tenantId: 't1' });

    expect(socketA.send).toHaveBeenCalledTimes(1);
    expect(socketB.send).not.toHaveBeenCalled();
  });

  it('fans out one publish to every socket subscribed to the same run', () => {
    const publisher = new RunPublisher();
    const socketA = mockSocket();
    const socketB = mockSocket();
    publisher.join('run-a', socketA.ws);
    publisher.join('run-a', socketB.ws);

    publisher.publish('run-a', { type: 'execution.started', runId: 'run-a', tenantId: 't1' });

    expect(socketA.send).toHaveBeenCalledTimes(1);
    expect(socketB.send).toHaveBeenCalledTimes(1);
    expect(socketA.send).toHaveBeenCalledWith(socketB.send.mock.calls[0]?.[0]);
  });

  it('assigns a strictly increasing seq per run, independent of other rooms', () => {
    const publisher = new RunPublisher();
    const socketA = mockSocket();
    publisher.join('run-a', socketA.ws);

    publisher.publish('run-a', { type: 'execution.started', runId: 'run-a', tenantId: 't1' });
    publisher.publish('run-a', { type: 'step.queued', runId: 'run-a', tenantId: 't1', stepKey: 'x' });

    const seqs = socketA.send.mock.calls.map((call) => (JSON.parse(call[0] as string) as { seq: number }).seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('skips sockets that are not open', () => {
    const publisher = new RunPublisher();
    const closedSocket = mockSocket(WebSocket.CLOSED);
    publisher.join('run-a', closedSocket.ws);

    publisher.publish('run-a', { type: 'execution.started', runId: 'run-a', tenantId: 't1' });

    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it('does nothing (no throw) when publishing to a run with no subscribers', () => {
    const publisher = new RunPublisher();
    expect(() =>
      publisher.publish('empty-run', { type: 'execution.started', runId: 'empty-run', tenantId: 't1' }),
    ).not.toThrow();
  });

  it('stops delivering to a socket after it leaves, and cleans up empty rooms', () => {
    const publisher = new RunPublisher();
    const socketA = mockSocket();
    publisher.join('run-a', socketA.ws);
    publisher.leave('run-a', socketA.ws);

    expect(publisher.roomSize('run-a')).toBe(0);
    publisher.publish('run-a', { type: 'execution.started', runId: 'run-a', tenantId: 't1' });
    expect(socketA.send).not.toHaveBeenCalled();
  });
});

describe('createRealtimeExecutionLogger', () => {
  it('publishes only the events in the realtime vocabulary, to the room named in the log fields', () => {
    const publisher = new RunPublisher();
    const socket = mockSocket();
    publisher.join('run-a', socket.ws);
    const base = { info: vi.fn(), error: vi.fn() };

    const logger = createRealtimeExecutionLogger(publisher, base);
    logger.info('run.started', { runId: 'run-a', tenantId: 't1' });
    logger.info('step.retrying', { runId: 'run-a', tenantId: 't1', stepKey: 'a', attempt: 1, delayMs: 10 });
    logger.error('step.failed', { runId: 'run-a', tenantId: 't1', stepKey: 'a', error: 'boom' });

    // base logger still receives every event, unfiltered.
    expect(base.info).toHaveBeenCalledTimes(2);
    expect(base.error).toHaveBeenCalledTimes(1);

    // only run.started and step.failed are in the realtime vocabulary.
    expect(socket.send).toHaveBeenCalledTimes(2);
    const types = socket.send.mock.calls.map((call) => (JSON.parse(call[0] as string) as { type: string }).type);
    expect(types).toEqual(['execution.started', 'step.failed']);
  });
});
