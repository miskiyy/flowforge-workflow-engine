import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { describe, expect, it } from 'vitest';
import { checkGuards } from '../src/workflows/guards.js';

function dagWithUrl(url: string): WorkflowDagDefinition {
  return { steps: [{ key: 'a', type: 'http', dependsOn: [], method: 'GET', url }] };
}

function dagWithCommand(command: string): WorkflowDagDefinition {
  return { steps: [{ key: 'a', type: 'script', dependsOn: [], command, timeoutMs: 1000 }] };
}

describe('checkGuards — SSRF (http.url)', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data', 'cloud metadata endpoint'],
    ['http://localhost/admin', 'localhost'],
    ['http://127.0.0.1:8080', '127.0.0.1'],
    ['http://10.0.0.5/internal', '10.0.0.0/8'],
    ['file:///etc/passwd', 'file:// protocol'],
    ['http://192.168.1.1/router', '192.168.0.0/16'],
  ])('rejects %s (%s)', (url) => {
    const errors = checkGuards(dagWithUrl(url));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toBe('/steps/a/url');
  });

  it('allows a public https URL', () => {
    expect(checkGuards(dagWithUrl('https://api.example.com/data'))).toEqual([]);
  });

  it('allows a public http URL', () => {
    expect(checkGuards(dagWithUrl('http://example.com/data'))).toEqual([]);
  });
});

describe('checkGuards — script.command allowlist', () => {
  it('rejects a command not on the allowlist', () => {
    const errors = checkGuards(dagWithCommand('rm -rf /'));
    expect(errors).toEqual([{ path: '/steps/a/command', message: expect.stringContaining('rm -rf /') }]);
  });

  it('allows an allowlisted command', () => {
    expect(checkGuards(dagWithCommand('echo'))).toEqual([]);
  });
});

describe('checkGuards — fan-out sanity', () => {
  it('rejects a DAG with more than 50 steps', () => {
    const steps = Array.from({ length: 51 }, (_, i) => ({
      key: `s${i}`,
      type: 'delay' as const,
      dependsOn: [],
      durationMs: 1,
    }));
    const errors = checkGuards({ steps });
    expect(errors).toEqual([{ path: '/steps', message: expect.stringContaining('51') }]);
  });

  it('allows exactly 50 steps', () => {
    const steps = Array.from({ length: 50 }, (_, i) => ({
      key: `s${i}`,
      type: 'delay' as const,
      dependsOn: [],
      durationMs: 1,
    }));
    expect(checkGuards({ steps })).toEqual([]);
  });
});

describe('checkGuards — condition.left must reference a step in dependsOn', () => {
  it('rejects a condition that references a step not listed in its own dependsOn', () => {
    const dag: WorkflowDagDefinition = {
      steps: [
        { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
        { key: 'gate', type: 'condition', dependsOn: [], left: '$.steps.a.status', op: 'eq', right: 'succeeded' },
      ],
    };
    const errors = checkGuards(dag);
    expect(errors).toEqual([
      { path: '/steps/gate/left', message: expect.stringContaining('dependsOn') },
    ]);
  });

  it('allows a condition whose left references a real dependency', () => {
    const dag: WorkflowDagDefinition = {
      steps: [
        { key: 'a', type: 'delay', dependsOn: [], durationMs: 1 },
        { key: 'gate', type: 'condition', dependsOn: ['a'], left: '$.steps.a.status', op: 'eq', right: 'succeeded' },
      ],
    };
    expect(checkGuards(dag)).toEqual([]);
  });
});

describe('checkGuards — clean DAG', () => {
  it('returns no findings for a DAG with no http/script steps', () => {
    const dag: WorkflowDagDefinition = { steps: [{ key: 'a', type: 'delay', dependsOn: [], durationMs: 1 }] };
    expect(checkGuards(dag)).toEqual([]);
  });
});
