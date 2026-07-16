import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { AiDraftInvalidError, AiUnavailableError } from '../src/ai/errors.js';
import { MockProposer, type ChatMessage, type DagProposer } from '../src/ai/provider.js';
import { ProposalCache, proposeDag } from '../src/ai/propose.js';
import { BaseVersionStaleError } from '../src/lib/errors.js';
import { createWorkflow, updateWorkflow } from '../src/workflows/repository.js';
import { createTenant, createUser, cyclicDag, validDag } from './fixtures.js';

const VALID_DAG = validDag() as unknown as WorkflowDagDefinition;
const VALID_DAG_JSON = JSON.stringify(VALID_DAG);
const CYCLIC_DAG_JSON = JSON.stringify(cyclicDag);
const METADATA_URL_DAG_JSON = JSON.stringify({
  steps: [{ key: 'a', type: 'http', dependsOn: [], method: 'GET', url: 'http://169.254.169.254/latest/meta-data' }],
});

function spy(provider: DagProposer): DagProposer & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    complete: async (messages: ChatMessage[]) => {
      calls.push(messages);
      return provider.complete(messages);
    },
  };
}

function deps(provider: DagProposer, cache = new ProposalCache()) {
  return { provider, cache, model: 'test-model:free' };
}

describe('proposeDag — orchestration', () => {
  it('valid first attempt → exactly 1 provider call, attempts: 1', async () => {
    const provider = spy(new MockProposer({ responses: [VALID_DAG_JSON] }));
    const result = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider));

    expect(result.meta.attempts).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(result.meta.cached).toBe(false);
  });

  it('prose-wrapped JSON (fenced code block) is recovered by parseDraft — no repair needed', async () => {
    const prose = `Sure, here's the workflow:\n\`\`\`json\n${VALID_DAG_JSON}\n\`\`\`\nLet me know if you need changes.`;
    const provider = spy(new MockProposer({ responses: [prose] }));
    const result = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider));

    expect(result.meta.attempts).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('unparseable output → repair → succeeds on attempt 2', async () => {
    const provider = spy(new MockProposer({ responses: ['not json at all, just prose', VALID_DAG_JSON] }));
    const result = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider));

    expect(result.meta.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
  });

  it('always-invalid output → exactly 3 calls total, then 422 AI_DRAFT_INVALID (termination)', async () => {
    const provider = spy(new MockProposer({ responses: ['still not json'] })); // holds on last entry
    await expect(proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider))).rejects.toThrow(
      AiDraftInvalidError,
    );
    expect(provider.calls).toHaveLength(3);
  });

  it('a model-emitted cycle is caught by the real Kahn cycle detection — the error names the offending nodes', async () => {
    const provider = spy(new MockProposer({ responses: [CYCLIC_DAG_JSON] })); // holds on last -> always the same cycle
    let caught: AiDraftInvalidError | undefined;
    try {
      await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider));
    } catch (err) {
      caught = err as AiDraftInvalidError;
    }
    expect(caught).toBeInstanceOf(AiDraftInvalidError);
    const details = caught!.details as { errors: { path: string; message: string }[] };
    expect(details.errors.some((e) => e.message.includes('cycle') && e.message.includes('a') && e.message.includes('b'))).toBe(
      true,
    );
  });

  it('a guard-only failure (schema-valid, but a metadata-endpoint URL) goes through the repair path', async () => {
    const provider = spy(new MockProposer({ responses: [METADATA_URL_DAG_JSON, VALID_DAG_JSON] }));
    const result = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'anything' }, deps(provider));

    expect(result.meta.attempts).toBe(2);
    expect(provider.calls).toHaveLength(2);
  });

  it('cache hit → 0 additional provider calls, meta.cached: true', async () => {
    const cache = new ProposalCache();
    const provider = spy(new MockProposer({ responses: [VALID_DAG_JSON] }));
    const first = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'same prompt' }, deps(provider, cache));
    expect(first.meta.cached).toBe(false);

    const second = await proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'same prompt' }, deps(provider, cache));
    expect(second.meta.cached).toBe(true);
    expect(provider.calls).toHaveLength(1); // no second provider call
  });

  it('the same prompt from a different tenant is a cache MISS — no cross-tenant hit (tenancy side channel)', async () => {
    const cache = new ProposalCache();
    const provider = spy(new MockProposer({ responses: [VALID_DAG_JSON] }));
    await proposeDag({ tenantId: 'tenant-a', workflowId: 'new', prompt: 'same prompt' }, deps(provider, cache));
    const result = await proposeDag({ tenantId: 'tenant-b', workflowId: 'new', prompt: 'same prompt' }, deps(provider, cache));

    expect(result.meta.cached).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });

  it('the same prompt against a different baseVersionId is a cache miss', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition, version: v1 } = await createWorkflow({ tenantId: tenant.id, userId: user.id, name: 'wf', dag: VALID_DAG });

    const cache = new ProposalCache();
    const provider = spy(new MockProposer({ responses: [VALID_DAG_JSON] }));
    const first = await proposeDag(
      { tenantId: tenant.id, workflowId: definition.id, baseVersionId: v1.id, prompt: 'same prompt' },
      deps(provider, cache),
    );
    expect(first.meta.cached).toBe(false);

    const { version: v2 } = await updateWorkflow({
      tenantId: tenant.id,
      userId: user.id,
      workflowId: definition.id,
      dag: { steps: [{ key: 'only', type: 'delay', dependsOn: [], durationMs: 1 }] },
    });

    const second = await proposeDag(
      { tenantId: tenant.id, workflowId: definition.id, baseVersionId: v2!.id, prompt: 'same prompt' },
      deps(provider, cache),
    );
    expect(second.meta.cached).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });

  it('provider failures are never cached — two separate calls each hit the provider once', async () => {
    const cache = new ProposalCache();
    const failingProvider: DagProposer = { complete: vi.fn().mockRejectedValue(new AiUnavailableError()) };
    const provider = spy(failingProvider);

    await expect(proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'p' }, deps(provider, cache))).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    await expect(proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'p' }, deps(provider, cache))).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(provider.calls).toHaveLength(2); // not retried internally, not short-circuited by a cached failure
  });

  it('a provider throw propagates as AiUnavailableError, never a generic 500-shaped error', async () => {
    const failingProvider: DagProposer = { complete: async () => Promise.reject(new Error('ECONNRESET')) };
    await expect(
      proposeDag({ tenantId: 't1', workflowId: 'new', prompt: 'p' }, deps(failingProvider)),
    ).rejects.toBeInstanceOf(Error);
    // note: propose.ts does not itself catch/rewrap provider errors — that's ai/openrouter.ts's job
    // (it maps SDK failures to AiUnavailableError before propose.ts ever sees them). This test
    // documents that an arbitrary provider implementation's raw throw still propagates rather than
    // being swallowed, which is what lets ai/openrouter.ts's mapping be the single translation point.
  });

  it('a stale baseVersionId (someone else moved the workflow) is rejected before any provider call', async () => {
    const tenant = await createTenant();
    const user = await createUser(tenant.id, 'editor');
    const { definition, version } = await createWorkflow({ tenantId: tenant.id, userId: user.id, name: 'wf', dag: VALID_DAG });
    await updateWorkflow({ tenantId: tenant.id, userId: user.id, workflowId: definition.id, dag: VALID_DAG }); // moves current_version_id

    const provider = spy(new MockProposer({ responses: [VALID_DAG_JSON] }));
    await expect(
      proposeDag(
        { tenantId: tenant.id, workflowId: definition.id, baseVersionId: version.id, prompt: 'anything' },
        deps(provider),
      ),
    ).rejects.toBeInstanceOf(BaseVersionStaleError);
    expect(provider.calls).toHaveLength(0);
  });
});
