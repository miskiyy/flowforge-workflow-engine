/**
 * In-process registry mapping a running run's id to the AbortController
 * `worker.ts` passed into `executeRun`. This is what actually makes
 * `signal`-based cancellation reachable (executor.ts's mechanism existed and
 * was tested from Phase 3.4 on, but nothing ever constructed a real
 * AbortController and wired it in). Single-process, in-memory — consistent
 * with this project's already-locked "no message broker" posture; a
 * multi-instance deployment would need this to be a shared/broadcast
 * mechanism (e.g. publish a cancel event other instances subscribe to)
 * instead of a local Map.
 */
const controllers = new Map<string, AbortController>();

export function registerRunController(runId: string, controller: AbortController): void {
  controllers.set(runId, controller);
}

export function unregisterRunController(runId: string): void {
  controllers.delete(runId);
}

/**
 * Best-effort, cooperative — matches executor.ts's own coarse-grained
 * between-levels check. Returns true if a live controller was found and
 * asked to stop; false means either the run isn't actually executing in
 * this process right now, or it already finished — the caller (execution/
 * repository.ts#cancelRun) doesn't treat `false` as an error, since the
 * run's real status is the source of truth, not this registry.
 */
export function requestRunCancellation(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}
