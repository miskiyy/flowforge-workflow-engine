import { WebSocket } from 'ws';
import type { ExecutionLogger } from '../execution/executor.js';
import { consoleExecutionLogger } from '../execution/executor.js';
import { mapLogEventToRealtimeEvent, serializeEvent, type RealtimeEvent } from './events.js';

/**
 * Room registry + fan-out: one room per run_id, matching Task.md's locked
 * "scope subscriptions to run_id rooms, not broadcast-to-all" decision.
 * In-process only — a second API instance would need Redis pub/sub to see
 * the same rooms, which is exactly the swap the architecture doc names as
 * the first split when this moves off a single instance.
 */
export class RunPublisher {
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly seqByRun = new Map<string, number>();

  join(runId: string, ws: WebSocket): void {
    let sockets = this.rooms.get(runId);
    if (!sockets) {
      sockets = new Set();
      this.rooms.set(runId, sockets);
    }
    sockets.add(ws);
  }

  leave(runId: string, ws: WebSocket): void {
    const sockets = this.rooms.get(runId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) {
      this.rooms.delete(runId);
      this.seqByRun.delete(runId);
    }
  }

  roomSize(runId: string): number {
    return this.rooms.get(runId)?.size ?? 0;
  }

  publish(runId: string, event: Omit<RealtimeEvent, 'seq' | 'ts'>): void {
    const seq = (this.seqByRun.get(runId) ?? 0) + 1;
    this.seqByRun.set(runId, seq);

    const sockets = this.rooms.get(runId);
    if (!sockets || sockets.size === 0) return;

    const payload = serializeEvent({ ...event, seq, ts: new Date().toISOString() });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

/**
 * Adapts a RunPublisher into the executor's ExecutionLogger interface — the
 * injection point Phase 3.4 already built for exactly this — so wiring
 * realtime publishing into a run never requires touching executor.ts's
 * scheduling logic. Every log event already carries `runId` in its fields,
 * so one shared logger instance can serve every run in the process. Still
 * calls `base` (defaults to the existing console logger) so structured log
 * output keeps flowing unchanged.
 */
export function createRealtimeExecutionLogger(
  publisher: RunPublisher,
  base: ExecutionLogger = consoleExecutionLogger,
): ExecutionLogger {
  function forward(event: string, fields: Record<string, unknown>): void {
    const mapped = mapLogEventToRealtimeEvent(event, fields);
    if (mapped) publisher.publish(mapped.runId, mapped);
  }

  return {
    info(event, fields) {
      base.info(event, fields);
      forward(event, fields);
    },
    error(event, fields) {
      base.error(event, fields);
      forward(event, fields);
    },
  };
}
