import type { DagStepDefinition } from '@flowforge/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRuntimeContext } from '../src/execution/executor.js';
import { runStep } from '../src/execution/step-handlers.js';

function step(overrides: Partial<DagStepDefinition> & { type: DagStepDefinition['type'] }): DagStepDefinition {
  return { key: 's', dependsOn: [], ...overrides } as DagStepDefinition;
}

/** Only `condition` steps read the runtime — everything else can ignore it, so tests default to "no dependency ever resolved". */
const noopRuntime: StepRuntimeContext = { getDependencyStatus: () => undefined };

function runtimeWith(statuses: Record<string, string>): StepRuntimeContext {
  return { getDependencyStatus: (key) => statuses[key] as ReturnType<StepRuntimeContext['getDependencyStatus']> };
}

describe('runStep (the worker pool default StepExecutor)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delay: succeeds after the configured duration', async () => {
    const outcome = await runStep(step({ type: 'delay', durationMs: 5 }), noopRuntime);
    expect(outcome).toEqual({ status: 'succeeded', output: { waitedMs: 5 } });
  });

  it('http: a 2xx response is a success carrying status + body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200, statusText: 'OK' })),
    );
    const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com' }), noopRuntime);
    expect(outcome).toEqual({ status: 'succeeded', output: { status: 200, body: '{"ok":true}' } });
  });

  it('http: a non-2xx response is a failed step, not a thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' })));
    const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com' }), noopRuntime);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('500');
  });

  it('script: never executes anything — always a stubbed success carrying the would-be command', async () => {
    const outcome = await runStep(step({ type: 'script', command: 'rm -rf /', args: ['--yes'], timeoutMs: 1000 }), noopRuntime);
    expect(outcome).toEqual({
      status: 'succeeded',
      output: { stubbed: true, command: 'rm -rf /', args: ['--yes'] },
    });
  });

  describe('condition: closed { left, op, right } comparison — no eval', () => {
    it('eq true: branchTaken is true when the referenced dependency matches', async () => {
      const outcome = await runStep(
        step({ type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' }),
        runtimeWith({ a: 'succeeded' }),
      );
      expect(outcome).toEqual({
        status: 'succeeded',
        branchTaken: true,
        output: { left: '$.steps.a.status', op: 'eq', right: 'succeeded', actual: 'succeeded', result: true },
      });
    });

    it('eq false: the step still succeeds, but branchTaken is false — a closed gate, not a failure', async () => {
      const outcome = await runStep(
        step({ type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' }),
        runtimeWith({ a: 'failed' }),
      );
      expect(outcome.status).toBe('succeeded');
      expect(outcome.branchTaken).toBe(false);
    });

    it('neq: inverts the comparison', async () => {
      const outcome = await runStep(
        step({ type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'neq', right: 'succeeded' }),
        runtimeWith({ a: 'failed' }),
      );
      expect(outcome.branchTaken).toBe(true);
    });

    it('fails loudly (not silently) if the referenced dependency somehow has no recorded status', async () => {
      const outcome = await runStep(
        step({ type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' }),
        noopRuntime,
      );
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toMatch(/no recorded status/i);
    });
  });

  // Audit C1: the manual/human `POST /workflows` path had no fetch-time SSRF
  // enforcement at all — only ai/propose.ts's authoring-time checkGuards did.
  // These assert the fetch-time guard actually fires from the real worker
  // StepExecutor, not just from checkGuards' own unit tests.
  describe('http: SSRF guard at fetch time', () => {
    it('rejects a loopback/link-local/private URL without ever calling fetch', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'http://169.254.169.254/latest/meta-data' }), noopRuntime);

      expect(outcome.status).toBe('failed');
      expect(outcome.error).toMatch(/not allowed/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('re-checks a redirect target, rejecting a public URL that 302s into a private IP', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/internal' } }),
        ),
      );

      const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com/redirector' }), noopRuntime);

      expect(outcome.status).toBe('failed');
      expect(outcome.error).toMatch(/not allowed/i);
    });

    it('follows a redirect to a public URL and returns the final response', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }))
          .mockResolvedValueOnce(new Response('{"done":true}', { status: 200, statusText: 'OK' })),
      );

      const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com/redirector' }), noopRuntime);

      expect(outcome).toEqual({ status: 'succeeded', output: { status: 200, body: '{"done":true}' } });
    });

    it('passes an AbortSignal so a hung endpoint cannot pin the worker forever', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com' }), noopRuntime);

      const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe('manual');
    });

    it('caps the stored response body without buffering the whole thing first', async () => {
      const bigBody = 'x'.repeat(10_000);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bigBody, { status: 200 })));

      const outcome = await runStep(step({ type: 'http', method: 'GET', url: 'https://example.com' }), noopRuntime);

      expect(outcome.status).toBe('succeeded');
      expect((outcome.output as { body: string }).body).toHaveLength(4096);
    });
  });
});
