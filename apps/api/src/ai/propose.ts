import { randomUUID, createHash } from 'node:crypto';
import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { env } from '../config.js';
import { BaseVersionStaleError } from '../lib/errors.js';
import { getWorkflow } from '../workflows/repository.js';
import { validateDag, type DagValidationError } from '../workflows/dag-validation.js';
import { checkGuards } from '../workflows/guards.js';
import { diffDag, type DagDiff } from './diff.js';
import { AiDraftInvalidError } from './errors.js';
import { buildPromptMessages } from './prompt.js';
import type { DagProposer, Usage } from './provider.js';

const MAX_ATTEMPTS = 3; // 1 generate + max 2 repairs — a hard bound, no condition extends it (ai-subsystem-design.md §9)
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

export interface ProposeInput {
  tenantId: string;
  /** A workflow UUID, or the literal 'new' for a greenfield proposal. */
  workflowId: string;
  /** Required unless workflowId === 'new' — enforced by the route schema, not here. */
  baseVersionId?: string;
  prompt: string;
}

export interface ProposeResult {
  proposedDag: WorkflowDagDefinition;
  diff: DagDiff;
  /** Always [] today — no semantic-advisory generator is specified beyond the design doc's illustrative UI mockup (§16). The field exists for forward compatibility. */
  warnings: DagValidationError[];
  meta: {
    model: string;
    attempts: number;
    cached: boolean;
    usage: Usage;
  };
}

export interface ProposeDeps {
  provider: DagProposer;
  cache: ProposalCache;
  model: string;
}

/**
 * `{ level, event, ...fields }` — matches the shape execution/executor.ts's
 * consoleExecutionLogger already uses, reproduced locally so ai/ stays
 * self-contained (nothing outside ai/ needs to import from it, and ai/
 * needn't import execution/ just for a log line shape). Never logs raw
 * prompt/completion text — only a hash and structural facts. Silenced in
 * tests, matching app.ts's own `logger: ... !== 'test'` convention.
 */
function logAiEvent(event: string, fields: Record<string, unknown>): void {
  if (env.isTest) return;
  console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

/** tenantId is mandatory in the key — a cross-tenant cache hit would be a tenancy breach through a side channel (ai-subsystem-design.md §13). */
export function computeCacheKey(tenantId: string, baseVersionId: string | undefined, prompt: string): string {
  const normalized = normalizePrompt(prompt);
  return createHash('sha256').update(`${tenantId}:${baseVersionId ?? 'new'}:${normalized}`).digest('hex');
}

interface CacheEntry {
  result: ProposeResult;
  expiresAt: number;
}

/**
 * In-process Map + TTL — no Redis, consistent with Task.md's locked
 * no-broker decision, same swap story as TokenBucketLimiter. Bounded (FIFO
 * eviction past CACHE_MAX_ENTRIES) so it can't leak memory. Only successful
 * (200) results are ever cached — a transient provider outage must not pin
 * a failure for 5 minutes.
 */
export class ProposalCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  get(key: string): ProposeResult | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.result;
  }

  set(key: string, result: ProposeResult): void {
    if (!this.entries.has(key) && this.entries.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { result, expiresAt: this.now() + CACHE_TTL_MS });
  }
}

type ParseDraftResult = { ok: true; draft: unknown } | { ok: false };

/**
 * Tolerant JSON extraction, tried in order: (a) JSON.parse; (b) a fenced
 * ```json block; (c) the first balanced {...} span. JSON mode is requested
 * (ai/openrouter.ts), not strict structured output — free models are
 * inconsistent about honoring `response_format`, and the canonical schema
 * is strict-mode-incompatible anyway (ai-subsystem-design.md §0, §7). This
 * is the deviation from Task.md:130's "structured-output mode, not
 * parse-JSON-from-prose" — recorded here and in ai/README.md.
 */
export function parseDraft(text: string): ParseDraftResult {
  try {
    return { ok: true, draft: JSON.parse(text) };
  } catch {
    // fall through to the next strategy
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    try {
      return { ok: true, draft: JSON.parse(fenced[1]) };
    } catch {
      // fall through to the next strategy
    }
  }

  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return { ok: true, draft: JSON.parse(text.slice(start, i + 1)) };
          } catch {
            break;
          }
        }
      }
    }
  }

  return { ok: false };
}

async function loadBaseDag(
  tenantId: string,
  workflowId: string,
  baseVersionId: string | undefined,
): Promise<WorkflowDagDefinition | null> {
  if (workflowId === 'new') return null;

  const { version } = await getWorkflow(tenantId, workflowId); // tenant-scoped; throws NotFoundError if missing/wrong tenant
  if (!version || version.id !== baseVersionId) throw new BaseVersionStaleError();
  return version.dagDefinition;
}

/**
 * Orchestrator — no I/O of its own beyond what it delegates. Cache lookup,
 * then load the tenant-scoped base version, then a bounded repair loop:
 * generate -> parseDraft -> validateDag (EXISTING — the trust boundary,
 * never reimplemented) -> guards -> on success, diff + cache; on failure,
 * feed the errors back and retry, up to MAX_ATTEMPTS. See
 * ai-subsystem-design.md §2 for the full sequence.
 */
export async function proposeDag(input: ProposeInput, deps: ProposeDeps): Promise<ProposeResult> {
  const proposalId = randomUUID();
  const promptSha256 = createHash('sha256').update(normalizePrompt(input.prompt)).digest('hex');
  logAiEvent('ai.propose.started', {
    proposalId,
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    promptSha256,
  });

  const cacheKey = computeCacheKey(input.tenantId, input.baseVersionId, input.prompt);
  const cached = deps.cache.get(cacheKey);
  if (cached) {
    logAiEvent('ai.propose.cache_hit', { proposalId, tenantId: input.tenantId, workflowId: input.workflowId });
    return { ...cached, meta: { ...cached.meta, cached: true } };
  }

  const baseDag = await loadBaseDag(input.tenantId, input.workflowId, input.baseVersionId);

  const usage: Usage = { promptTokens: 0, completionTokens: 0 };
  let priorAttempt: { draftText: string; errors: DagValidationError[] } | undefined;
  let lastDraftValue: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = buildPromptMessages(baseDag, input.prompt, priorAttempt);
    const started = Date.now();
    // Provider errors (timeout, 5xx after SDK transport retries, 429) propagate
    // uncaught — that's a transport failure, a different mechanism from the
    // repair loop below (ai-subsystem-design.md §9), and becomes a 503.
    const completion = await deps.provider.complete(messages);
    usage.promptTokens += completion.usage.promptTokens;
    usage.completionTokens += completion.usage.completionTokens;
    logAiEvent('ai.propose.attempt', {
      proposalId,
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      model: deps.model,
      attempt,
      latencyMs: Date.now() - started,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
    });

    const parsed = parseDraft(completion.text);
    if (!parsed.ok) {
      const errors: DagValidationError[] = [{ path: '/', message: 'model did not return parseable JSON' }];
      logAiEvent('ai.propose.invalid', { proposalId, attempt, errorCount: errors.length, errorPaths: ['/'] });
      priorAttempt = { draftText: completion.text, errors };
      lastDraftValue = completion.text;
      continue;
    }
    lastDraftValue = parsed.draft;

    const validation = validateDag(parsed.draft);
    if (!validation.valid) {
      logAiEvent('ai.propose.invalid', {
        proposalId,
        attempt,
        errorCount: validation.errors.length,
        errorPaths: validation.errors.map((e) => e.path),
      });
      priorAttempt = { draftText: completion.text, errors: validation.errors };
      continue;
    }

    const guardErrors = checkGuards(parsed.draft as WorkflowDagDefinition);
    if (guardErrors.length > 0) {
      logAiEvent('ai.propose.guard_rejected', {
        proposalId,
        attempt,
        errorCount: guardErrors.length,
        errorPaths: guardErrors.map((e) => e.path),
      });
      priorAttempt = { draftText: completion.text, errors: guardErrors };
      continue;
    }

    const proposedDag = parsed.draft as WorkflowDagDefinition;
    const result: ProposeResult = {
      proposedDag,
      diff: diffDag(baseDag, proposedDag),
      warnings: [],
      meta: { model: deps.model, attempts: attempt, cached: false, usage },
    };
    deps.cache.set(cacheKey, result);
    logAiEvent('ai.propose.succeeded', { proposalId, tenantId: input.tenantId, workflowId: input.workflowId, attempt });
    return result;
  }

  logAiEvent('ai.propose.failed', { proposalId, tenantId: input.tenantId, workflowId: input.workflowId, attempts: MAX_ATTEMPTS });
  throw new AiDraftInvalidError(priorAttempt?.errors ?? [], lastDraftValue);
}
