import type { DagStepDefinition, WorkflowDagDefinition } from '@flowforge/shared-types';
import type { DagValidationError } from './dag-validation.js';

const MAX_STEPS = 50;

/** Deny-by-default — Task.md's sandboxed-subprocess-with-no-net/fs posture (28), authoring-time half. */
const ALLOWED_SCRIPT_COMMANDS = new Set(['echo', 'true', 'false', 'sleep', 'cat', 'node']);

/**
 * Lexical-only loopback/link-local/RFC1918 check on the literal hostname.
 * Also re-checked at fetch time, per redirect hop, in
 * execution/step-handlers.ts's runHttpStep — this authoring-time check
 * alone cannot stop DNS rebinding or a redirect into a private IP. IPv6
 * coverage here is loopback only (`::1`); broader IPv6 private-range
 * parsing is out of scope for the same reason — this guard reduces blast
 * radius, it does not by itself close the hole.
 */
export function isDisallowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower === '[::1]') return true;

  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(lower);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);

  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata endpoint
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function checkHttpStep(step: Extract<DagStepDefinition, { type: 'http' }>): DagValidationError | null {
  let url: URL;
  try {
    url = new URL(step.url);
  } catch {
    return { path: `/steps/${step.key}/url`, message: `invalid URL: "${step.url}"` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { path: `/steps/${step.key}/url`, message: `URL protocol must be http or https, got "${url.protocol}"` };
  }
  if (isDisallowedHost(url.hostname)) {
    return {
      path: `/steps/${step.key}/url`,
      message: `URL host "${url.hostname}" is loopback, link-local, or a private network address, and is not allowed`,
    };
  }
  return null;
}

function checkScriptStep(step: Extract<DagStepDefinition, { type: 'script' }>): DagValidationError | null {
  if (!ALLOWED_SCRIPT_COMMANDS.has(step.command)) {
    return { path: `/steps/${step.key}/command`, message: `command "${step.command}" is not on the allowed command list` };
  }
  return null;
}

const CONDITION_LEFT_PATTERN = /^\$\.steps\.([^.]+)\.status$/;

/** Extracts the step key a condition's `left` references — schema already enforces the `$.steps.<key>.status` shape. */
export function parseConditionLeft(left: string): string {
  const match = CONDITION_LEFT_PATTERN.exec(left);
  if (!match?.[1]) throw new Error(`condition "left" does not match the expected shape: "${left}"`);
  return match[1];
}

/**
 * The schema can validate `left`'s *shape* but not that the referenced step
 * is actually a resolved dependency by the time this condition runs — that's
 * a cross-field, DAG-shape concern, same category as the SSRF/command/
 * fan-out checks above. Requiring the referenced key to be in `dependsOn`
 * guarantees the executor has a final status for it (same-or-earlier level)
 * before the condition is evaluated (executor.ts's level-ordering guarantee).
 */
function checkConditionStep(step: Extract<DagStepDefinition, { type: 'condition' }>): DagValidationError | null {
  const referencedKey = parseConditionLeft(step.left);
  if (!step.dependsOn.includes(referencedKey)) {
    return {
      path: `/steps/${step.key}/left`,
      message: `condition references step "${referencedKey}", which must be listed in this step's dependsOn`,
    };
  }
  return null;
}

/**
 * Pure, no I/O. Catches what the JSON schema structurally cannot: SSRF-prone
 * URLs, disallowed script commands, and DAG-bomb fan-out. Returns the same
 * `DagValidationError[]` shape `validateDag` does, so findings flow into the
 * AI repair loop through the identical channel as schema errors (ai/propose.ts)
 * — one mechanism, not two. Lives next to validateDag (not under ai/) because
 * it is a DAG-safety check, not an AI concern: both the manual
 * `POST/PATCH /workflows` path (workflows/routes.ts) and the AI proposal path
 * call this same function, so a human and a model are held to one policy
 * (audit C1 — this guard used to be ai/-only, which is why the manual path
 * had no SSRF/command/fan-out enforcement at all).
 */
export function checkGuards(dag: WorkflowDagDefinition): DagValidationError[] {
  const errors: DagValidationError[] = [];

  if (dag.steps.length > MAX_STEPS) {
    errors.push({
      path: '/steps',
      message: `workflow has ${dag.steps.length} steps, exceeding the limit of ${MAX_STEPS}`,
    });
  }

  for (const step of dag.steps) {
    if (step.type === 'http') {
      const error = checkHttpStep(step);
      if (error) errors.push(error);
    } else if (step.type === 'script') {
      const error = checkScriptStep(step);
      if (error) errors.push(error);
    } else if (step.type === 'condition') {
      const error = checkConditionStep(step);
      if (error) errors.push(error);
    }
  }

  return errors;
}
