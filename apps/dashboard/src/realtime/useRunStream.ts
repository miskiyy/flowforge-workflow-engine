import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { useEffect, useReducer, useState } from 'react';
import { ApiError } from '../api/client.js';
import { fetchRun, type RunSnapshot } from '../api/runs.js';
import { TERMINAL_RUN_STATUSES, type RealtimeEvent, type RunDisplayStatus, type StepState } from './types.js';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface RunStreamState {
  run: { id: string; status: RunDisplayStatus } | null;
  dag: WorkflowDagDefinition | null;
  steps: Record<string, StepState>;
  events: RealtimeEvent[];
}

export type RunStreamAction = { type: 'SNAPSHOT'; snapshot: RunSnapshot } | { type: 'EVENT'; event: RealtimeEvent };

export const initialRunStreamState: RunStreamState = { run: null, dag: null, steps: {}, events: [] };

/**
 * A run opened after it already finished (shared link, page refresh, coming
 * back later) never had its live WS events witnessed by this session — the
 * REST snapshot's per-step start/finish timestamps are the only history
 * that exists. Reconstructs a synthetic event list from them so the
 * Timeline shows what happened instead of "No events yet" on a run that's
 * long done. Skipped steps have no synthesized entry — they were never
 * published as WS events live either (see api/realtime/events.ts).
 */
function synthesizeHistoricalEvents(snapshot: RunSnapshot): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  let seq = 0;
  function push(partial: Omit<RealtimeEvent, 'seq' | 'runId' | 'tenantId'>): void {
    events.push({ ...partial, seq: seq++, runId: snapshot.run.id, tenantId: '' });
  }

  if (snapshot.run.startedAt) push({ type: 'execution.started', ts: snapshot.run.startedAt });

  const orderedSteps = [...snapshot.steps].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return aTime - bTime;
  });
  for (const step of orderedSteps) {
    if (step.startedAt) {
      push({ type: 'step.running', ts: step.startedAt, stepKey: step.stepKey, attemptNumber: step.attemptNumber });
    }
    if (step.finishedAt && (step.status === 'succeeded' || step.status === 'failed')) {
      push({
        type: step.status === 'succeeded' ? 'step.succeeded' : 'step.failed',
        ts: step.finishedAt,
        stepKey: step.stepKey,
        ...(step.error !== null ? { error: step.error } : {}),
      });
    }
  }

  if (snapshot.run.finishedAt) {
    push({ type: snapshot.run.status === 'cancelled' ? 'execution.cancelled' : 'execution.completed', ts: snapshot.run.finishedAt });
  }

  return events;
}

/**
 * Pure — no socket/timer here — so the event-application logic is testable
 * without mounting a component or a fake WebSocket.
 */
export function runStreamReducer(state: RunStreamState, action: RunStreamAction): RunStreamState {
  if (action.type === 'SNAPSHOT') {
    const steps: Record<string, StepState> = {};
    for (const step of action.snapshot.steps) {
      steps[step.stepKey] = {
        stepKey: step.stepKey,
        status: step.status,
        attemptNumber: step.attemptNumber,
        ...(step.error !== null ? { error: step.error } : {}),
      };
    }
    // Only backfill when this session never witnessed any live events —
    // once real WS events exist, they're the authoritative history.
    const events =
      state.events.length === 0 && TERMINAL_RUN_STATUSES.has(action.snapshot.run.status)
        ? synthesizeHistoricalEvents(action.snapshot)
        : state.events;
    return { run: action.snapshot.run, dag: action.snapshot.dag, steps, events };
  }

  const { event } = action;
  const steps = { ...state.steps };
  let run = state.run;

  switch (event.type) {
    case 'execution.started':
      if (run) run = { ...run, status: 'running' };
      break;
    case 'step.queued':
      if (event.stepKey) steps[event.stepKey] = { stepKey: event.stepKey, status: 'queued' };
      break;
    case 'step.running':
      if (event.stepKey) {
        steps[event.stepKey] = { stepKey: event.stepKey, status: 'running', ...(event.attemptNumber !== undefined ? { attemptNumber: event.attemptNumber } : {}) };
      }
      break;
    case 'step.succeeded':
      if (event.stepKey) {
        steps[event.stepKey] = { stepKey: event.stepKey, status: 'succeeded', ...(event.attemptNumber !== undefined ? { attemptNumber: event.attemptNumber } : {}) };
      }
      break;
    case 'step.failed':
      if (event.stepKey) {
        steps[event.stepKey] = { stepKey: event.stepKey, status: 'failed', ...(event.error !== undefined ? { error: event.error } : {}) };
      }
      break;
    case 'execution.cancelled':
      if (run) run = { ...run, status: 'cancelled' };
      break;
    case 'execution.completed':
      // Deliberately not guessed here: the backend's wire event doesn't
      // distinguish succeeded/failed (see realtime/events.ts on the API side),
      // and the terminal REST resync triggered right after this event
      // supplies the authoritative final status instead of a coin-flip guess.
      break;
  }

  return { run, dag: state.dag, steps, events: [...state.events, event] };
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const TERMINAL_EVENT_TYPES = new Set(['execution.completed', 'execution.cancelled']);

/** 401/403/404 on the resync fetch can never succeed by retrying — the token or the run itself is invalid/gone. */
const PERMANENT_ERROR_STATUSES = new Set([401, 403, 404]);

export type SeqClassification = 'accept' | 'duplicate' | 'gap';

/**
 * Pure — no socket involved — so the duplicate/gap/accept decision is
 * directly unit-testable. `lastSeq === null` means "no baseline yet" (right
 * after a snapshot): the first event received always establishes the new
 * baseline rather than being gap-checked against a seq it can't know.
 */
export function classifySeq(lastSeq: number | null, seq: number): SeqClassification {
  if (lastSeq === null) return 'accept';
  if (seq <= lastSeq) return 'duplicate';
  if (seq !== lastSeq + 1) return 'gap';
  return 'accept';
}

export interface UseRunStreamResult extends RunStreamState {
  connectionStatus: ConnectionStatus;
  error: string | null;
}

/**
 * Owns the WS connection lifecycle for one run: connect, gap detection
 * (gap -> discard + REST resync, per the architecture doc), duplicate/stale
 * event rejection via `classifySeq`, exponential backoff reconnect (1s, 2s,
 * 4s... capped at 30s), and a final REST resync once the run reaches a
 * terminal state (the only way to see `skipped` steps, which aren't
 * published over the wire — see realtime/events.ts).
 *
 * Every socket handler is gated on `isStale()` (a per-connection generation
 * counter): once a connection is superseded (a reconnect opened a new
 * socket), any event that still arrives on the old one — a message the
 * browser had already buffered, a close event that fires after the fact —
 * is ignored rather than applied against state that's since moved on.
 */
export function useRunStream(apiUrl: string, wsUrl: string, runId: string, token: string): UseRunStreamResult {
  const [state, dispatch] = useReducer(runStreamReducer, initialRunStreamState);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastSeq: number | null = null;
    let connectionId = 0;
    // Tracks whichever socket is current, purely so unmount cleanup can close
    // it — every handler below closes over its own `mySocket` instead, so a
    // superseded connection's callbacks never act through this reference.
    let latestSocket: WebSocket | null = null;

    function scheduleReconnect(): void {
      if (cancelled) return;
      setConnectionStatus('reconnecting');
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        void resyncAndConnect();
      }, delay);
    }

    function openSocket(): void {
      if (cancelled) return;
      connectionId += 1;
      const myConnectionId = connectionId;
      let intentionalClose = false;
      const isStale = () => cancelled || myConnectionId !== connectionId;

      const mySocket = new WebSocket(`${wsUrl}/runs/${runId}/stream?token=${encodeURIComponent(token)}`);
      latestSocket = mySocket;

      mySocket.onopen = () => {
        if (isStale()) return;
        reconnectAttempt = 0;
        setConnectionStatus('open');
      };

      mySocket.onmessage = (message) => {
        if (isStale()) return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.data as string) as RealtimeEvent;
        } catch {
          return;
        }

        const classification = classifySeq(lastSeq, event.seq);
        if (classification === 'duplicate') return; // already applied (or older than) this event — ignore, no resync
        if (classification === 'gap') {
          intentionalClose = true;
          mySocket.close();
          void resyncAndConnect();
          return;
        }

        lastSeq = event.seq;
        dispatch({ type: 'EVENT', event });

        if (TERMINAL_EVENT_TYPES.has(event.type)) {
          intentionalClose = true;
          mySocket.close();
          setConnectionStatus('closed');
          fetchRun(apiUrl, runId, token)
            .then((snapshot) => {
              if (!isStale()) dispatch({ type: 'SNAPSHOT', snapshot });
            })
            .catch(() => {});
        }
      };

      mySocket.onclose = () => {
        if (isStale() || intentionalClose) return;
        scheduleReconnect();
      };
    }

    async function resyncAndConnect(): Promise<void> {
      if (cancelled) return;
      setConnectionStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      try {
        const snapshot = await fetchRun(apiUrl, runId, token);
        if (cancelled) return;
        dispatch({ type: 'SNAPSHOT', snapshot });
        lastSeq = null;

        // Already finished — nothing left to stream. Opening a socket here
        // would connect successfully and sit at "Live" forever, since a
        // terminal run's room never publishes another event.
        if (TERMINAL_RUN_STATUSES.has(snapshot.run.status)) {
          setConnectionStatus('closed');
          return;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && PERMANENT_ERROR_STATUSES.has(err.status)) {
          setError(err.message);
          setConnectionStatus('error');
          return; // unrecoverable — retrying a 401/403/404 will never succeed
        }
        scheduleReconnect();
        return;
      }
      openSocket();
    }

    void resyncAndConnect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      latestSocket?.close();
    };
  }, [apiUrl, wsUrl, runId, token]);

  return { ...state, connectionStatus, error };
}
