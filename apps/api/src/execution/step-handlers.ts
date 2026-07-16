import type { DagStepDefinition } from '@flowforge/shared-types';
import { isDisallowedHost, parseConditionLeft } from '../workflows/guards.js';
import type { StepExecutor, StepOutcome } from './executor.js';

/** Real HTTP calls truncate the response body kept in step_runs.output — full bodies belong in step_logs, not a JSONB column read on every dashboard poll. */
const HTTP_RESPONSE_BODY_CAP = 4096;
const HTTP_FETCH_TIMEOUT_MS = 10_000;
const HTTP_MAX_REDIRECTS = 5;

/**
 * Audit C1: `ai/guards.ts`'s check runs once at authoring time and cannot
 * stop DNS rebinding or a redirect into a private IP. Re-checked here on
 * every hop, at the moment of the real fetch, which is the only place that
 * can actually catch either.
 */
function assertSafeUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL protocol must be http or https, got "${url.protocol}"`);
  }
  if (isDisallowedHost(url.hostname)) {
    throw new Error(`URL host "${url.hostname}" is loopback, link-local, or a private network address, and is not allowed`);
  }
  return url;
}

/** Manual redirect handling so every hop — not just the first URL — passes assertSafeUrl. */
async function safeFetch(rawUrl: string, init: RequestInit): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= HTTP_MAX_REDIRECTS; hop++) {
    const url = assertSafeUrl(currentUrl);
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS) });
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');
    if (!isRedirect || !location) return response;
    currentUrl = new URL(location, url).toString();
  }
  throw new Error(`too many redirects (>${HTTP_MAX_REDIRECTS})`);
}

/** Reads at most capBytes off the stream instead of buffering the full body before truncating — a large response no longer OOMs the worker. */
async function readCappedBody(response: Response, capBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let bytesRead = 0;
  try {
    while (bytesRead < capBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    result += decoder.decode();
    void reader.cancel().catch(() => {});
  }
  return result.slice(0, capBytes);
}

async function runHttpStep(step: Extract<DagStepDefinition, { type: 'http' }>): Promise<StepOutcome> {
  let response: Response;
  try {
    response = await safeFetch(step.url, {
      method: step.method,
      ...(step.headers !== undefined ? { headers: step.headers } : {}),
      ...(step.body !== undefined ? { body: JSON.stringify(step.body) } : {}),
    });
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  const body = await readCappedBody(response, HTTP_RESPONSE_BODY_CAP);

  if (!response.ok) {
    return { status: 'failed', error: `HTTP ${response.status} ${response.statusText}`, output: { status: response.status, body } };
  }
  return { status: 'succeeded', output: { status: response.status, body } };
}

function runDelayStep(step: Extract<DagStepDefinition, { type: 'delay' }>): Promise<StepOutcome> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: 'succeeded', output: { waitedMs: step.durationMs } }), step.durationMs);
  });
}

/**
 * Task.md's locked decision: "sandboxed subprocess stub with hard timeout,
 * no network/fs, never eval." This is the stub half of that — it never
 * spawns a process (a real sandbox — gVisor/Firecracker — is the documented
 * production answer, see execution/README.md), so there is no command to
 * time out. It always succeeds, carrying the command it would have run, so a
 * workflow author can see the step shape working end-to-end before real
 * sandboxed execution exists.
 */
function runScriptStep(step: Extract<DagStepDefinition, { type: 'script' }>): Promise<StepOutcome> {
  return Promise.resolve({
    status: 'succeeded',
    output: { stubbed: true, command: step.command, args: step.args ?? [] },
  });
}

/**
 * phase0-self-review.md's Option 1, now adopted: `left`/`op`/`right` is a
 * closed comparison object, not a string — no parser, no eval. The
 * referenced step is guaranteed to be a direct dependency (workflows/
 * guards.ts's checkConditionStep) and therefore already resolved by the
 * time this runs (executor.ts's level ordering), so `runtime.getDependencyStatus`
 * always returns a real status here, never undefined.
 *
 * The comparison itself always "succeeds" as a step — it evaluated cleanly.
 * `branchTaken: false` is how it tells the scheduler to gate its dependents
 * closed without recording the step itself as failed (executor.ts's
 * `falseBranches` set).
 */
function runConditionStep(
  step: Extract<DagStepDefinition, { type: 'condition' }>,
  runtime: Parameters<StepExecutor>[1],
): Promise<StepOutcome> {
  const referencedKey = parseConditionLeft(step.left);
  const actual = runtime.getDependencyStatus(referencedKey);
  if (actual === undefined) {
    // Guarded against at authoring time (checkConditionStep) — reaching this
    // means stored data is corrupt, not a user input error.
    return Promise.resolve({
      status: 'failed',
      error: `condition step "${step.key}" references step "${referencedKey}", which has no recorded status`,
    });
  }

  const result = step.op === 'eq' ? actual === step.right : actual !== step.right;
  return Promise.resolve({
    status: 'succeeded',
    branchTaken: result,
    output: { left: step.left, op: step.op, right: step.right, actual, result },
  });
}

/** The worker pool's real StepExecutor — see execution/README.md for what each handler intentionally does and does not do. */
export const runStep: StepExecutor = (step: DagStepDefinition, runtime): Promise<StepOutcome> => {
  switch (step.type) {
    case 'http':
      return runHttpStep(step);
    case 'delay':
      return runDelayStep(step);
    case 'script':
      return runScriptStep(step);
    case 'condition':
      return runConditionStep(step, runtime);
  }
};
